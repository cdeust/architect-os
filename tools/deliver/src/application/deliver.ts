// The delivery command (docs/design/orchestration-fable-5-2.md §14, « Étape 1, la commande de livraison »): six phases
// over the ports, the first that fails ends the run. Everything is bound to the one hash read in phase 1; no phase
// reads HEAD again. The destination is never pushed: the run ends with a pull request to it, on the work branch, which
// it opens or finds (docs/design/exigences-spec.md, §4). A port that throws is not a reason of the list: the error
// leaves `deliver` as it is.
import { createHash } from 'node:crypto';
import type { DeliverConfig } from '../domain/config.js';
import { onlyAppended } from '../domain/append-only.js';
import { ciState } from '../domain/ci.js';
import { planPublication } from '../domain/plan.js';
import type {
  CiRun,
  Clock,
  DeliveryEntry,
  DeliveryLog,
  Forge,
  Gate,
  Phase,
  Progress,
  Reason,
  Repository,
} from '../domain/ports.js';
import {
  pullRequestBody,
  pullRequestTitle,
  type ParseRecord,
  type StepRecordView,
} from '../domain/pull-request.js';
import { trialBranch } from '../domain/trial.js';

export interface DeliverOptions {
  readonly name: string;
  readonly until: 'end' | 'ci';
}

export interface DeliverPorts {
  readonly repository: Repository;
  readonly forge: Forge;
  readonly gate: Gate;
  readonly clock: Clock;
  readonly log: DeliveryLog;
  readonly progress: Progress;
  /** The schema of the Step record, over the text the commit holds. */
  readonly parseRecord: ParseRecord;
}

/** A run stopped by a precondition: nothing was done, nothing is logged. */
export interface Refusal {
  outcome: 'stopped';
  phase: 'préalables';
  reason: Reason;
}

export type Delivery = DeliveryEntry | Refusal;

interface Stop {
  phase: Phase;
  reason: Reason;
}

/** What phase 1 found: the work branch, where the remote had it, and the record of the step. */
interface Started {
  ok: true;
  entry: DeliveryEntry;
  work: string;
  /** Where the work branch was (undefined: the remote had no work branch). */
  remote: string | undefined;
  /** The work branch is behind the hash, or absent, and is pushed. */
  push: boolean;
  record: StepRecordView;
}

type Start = Started | { ok: false; reason: Reason };

function refuse(reason: Reason): Start {
  return { ok: false, reason };
}

/** The branches of the name, or the reason they are refused. */
function branchesOf(
  options: DeliverOptions,
  config: DeliverConfig,
): { trial: string; work: string } | { reason: Reason } {
  const trial = trialBranch(config.trialPrefix, options.name);
  // The name passed the expression of the trial branch: the work branch is the other prefix and the same name.
  const work = `${config.workPrefix}${options.name}`;
  if (trial === undefined || trial === work) return { reason: "nom de branche d'essai refusé" };
  // A push to the destination is what its ruleset refuses outside a pull request: the delivery never asks for one.
  if (trial === config.destination || work === config.destination) {
    return { reason: "la destination n'accepte qu'une pull request" };
  }
  return { trial, work };
}

/** The record of the step, as the commit holds it, or the reason it is refused. */
function recordOf(
  hash: string,
  name: string,
  repository: Repository,
  parseRecord: ParseRecord,
): StepRecordView | Reason {
  const bytes = repository.committedFile(hash, `steps/${name}/record.json`);
  if (bytes === undefined) return "enregistrement d'étape absent";
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return "enregistrement d'étape refusé";
  }
  const record = parseRecord(text);
  // A record of another step, copied in this folder, is not the record of this one.
  if (record === undefined || record.step !== name) return "enregistrement d'étape refusé";
  return record;
}

/** Phase 1. */
function prerequisites(
  options: DeliverOptions,
  config: DeliverConfig,
  repository: Repository,
  parseRecord: ParseRecord,
): Start {
  if (repository.holdsNestedRepository()) return refuse("dépôt imbriqué dans l'arbre");
  if (!repository.isClean()) return refuse('arbre non propre');
  const hash = repository.head();
  if (!/^[0-9a-f]{40}$/.test(hash)) return refuse('empreinte de commit invalide');
  const branches = branchesOf(options, config);
  if ('reason' in branches) return refuse(branches.reason);
  repository.fetch();
  const work = repository.remoteHead(branches.work);
  const plan = planPublication(hash, work, (ancestor) => repository.isAncestor(ancestor, hash));
  if (!plan.ok) return refuse(plan.reason);
  const record = recordOf(hash, options.name, repository, parseRecord);
  if (typeof record === 'string') return refuse(record);
  const entry: DeliveryEntry = {
    outcome: 'delivered',
    hash,
    trial: branches.trial,
    ci: { attempts: 0, polls: 0 },
    gate: undefined,
    published: [],
  };
  return { ok: true, entry, work: branches.work, remote: work, push: plan.push, record };
}

/** Phase 2. */
function pushTrial(entry: DeliveryEntry, repository: Repository): Stop | undefined {
  if (repository.push(entry.hash, entry.trial) === 'refused') {
    return { phase: "branche d'essai", reason: "push de la branche d'essai refusé" };
  }
  return undefined;
}

/**
 * Phase 3: a green verdict of the gate for this commit, reused or played, and the destination commit it judged the commit
 * against, which is the base of the append-only files: the delivery compares nothing with the destination itself.
 */
async function playGate(
  entry: DeliveryEntry,
  config: DeliverConfig,
  gate: Gate,
  repository: Repository,
): Promise<Stop | undefined> {
  let verdict = gate.verdict();
  if (verdict?.hash === entry.hash) entry.gate = 'reused';
  else {
    entry.gate = 'ran';
    if ((await gate.run()) !== 0) return { phase: 'porte', reason: 'porte rouge' };
    verdict = gate.verdict();
    if (verdict?.hash !== entry.hash) {
      return { phase: 'porte', reason: 'le verdict de la porte ne nomme pas ce commit' };
    }
  }
  const base = verdict.destination;
  if (base === undefined)
    return { phase: 'porte', reason: 'le verdict de la porte ne nomme pas de destination' };
  entry.base = base;
  for (const path of config.appendOnly) {
    if (!onlyAppended(repository.committedFile(base, path), repository.committedFile(entry.hash, path))) {
      return { phase: 'porte', reason: "un fichier en ajout seul a changé ailleurs qu'à sa fin" };
    }
  }
  return undefined;
}

/** Phase 4. */
async function awaitCi(
  entry: DeliveryEntry,
  config: DeliverConfig,
  forge: Forge,
  clock: Clock,
): Promise<Stop | undefined> {
  const groups = Object.values(config.jobDependencies ?? {});
  const jobNames = groups.some((group) => group.plannedProducers !== undefined)
    ? 'all'
    : [...config.requiredJobs, ...groups.flatMap((group) => group.producers)];
  let requestedAttempt: number | undefined;
  let unnumberedRerunPending = false;
  for (let poll = 1; poll <= config.ciPolls; poll++) {
    if (poll > 1) await clock.sleep(config.pollSeconds);
    entry.ci.polls = poll;
    const run = forge.run(entry.hash, config.workflow, entry.trial, jobNames);
    if (run !== undefined) {
      entry.ci.run = run.id;
      if (entry.ci.attempts === 0) entry.ci.attempts = 1;
    }
    // The forge can still show the completed attempt immediately after accepting the rerun request.
    if (run !== undefined && !run.completed) unnumberedRerunPending = false;
    const state =
      unnumberedRerunPending || (run?.attempt ?? 0) <= (requestedAttempt ?? Number.NEGATIVE_INFINITY)
        ? undefined
        : ciState(run, config.requiredJobs, config.jobDependencies);
    if (state === 'green') return undefined;
    if (state === 'failed') return { phase: 'CI', reason: 'CI rouge' };
    if (state === 'no-runner' && entry.ci.attempts >= config.ciAttempts) {
      return { phase: 'CI', reason: 'aucun runner après le nombre de tentatives permis' };
    }
    if (state === 'no-runner' && poll < config.ciPolls) {
      // `no-runner` is decided of a run that exists (ciState).
      const rejected = run as CiRun;
      forge.rerunFailed(rejected.id);
      requestedAttempt = rejected.attempt;
      unnumberedRerunPending = requestedAttempt === undefined;
      entry.ci.attempts++;
    }
  }
  return { phase: 'CI', reason: 'CI sans réponse' };
}

/**
 * Phase 5. Just before, the work branch is read again and must be where phase 1 found it: at the hash, behind it, or
 * absent. It is pushed when it is behind or absent; then the pull request from it to the destination is opened, or the
 * open one found.
 */
function publish(
  entry: DeliveryEntry,
  start: Started,
  config: DeliverConfig,
  ports: DeliverPorts,
): Stop | undefined {
  const { repository, forge } = ports;
  repository.fetch();
  if (repository.remoteHead(start.work) !== start.remote) {
    return { phase: 'publication', reason: 'une branche distante a bougé' };
  }
  if (start.push) {
    if (repository.push(entry.hash, start.work) === 'refused') {
      return { phase: 'publication', reason: 'push refusé' };
    }
    entry.published.push(start.work);
  }
  const body = pullRequestBody(start.record, {
    repository: config.repository,
    hash: entry.hash,
    name: start.record.step,
  });
  const opened = forge.openPullRequest({
    head: start.work,
    base: config.destination,
    hash: entry.hash,
    title: pullRequestTitle(config.pullRequestTitle, start.record.step),
    body,
  });
  if (!opened.ok) return { phase: 'publication', reason: opened.reason };
  entry.pullRequest = {
    number: opened.number,
    url: opened.url,
    created: opened.created,
    body: createHash('sha256').update(body).digest('hex'),
  };
  return undefined;
}

/** Phases 2 to 6, over a commit that passed the preconditions. */
async function play(
  entry: DeliveryEntry,
  start: Started,
  options: DeliverOptions,
  config: DeliverConfig,
  ports: DeliverPorts,
): Promise<Stop | undefined> {
  const { progress } = ports;
  progress.phase("branche d'essai");
  const trial = pushTrial(entry, ports.repository);
  if (trial !== undefined) return trial;
  progress.phase('porte');
  const gate = await playGate(entry, config, ports.gate, ports.repository);
  if (gate !== undefined) return gate;
  progress.phase('CI');
  const ci = await awaitCi(entry, config, ports.forge, ports.clock);
  if (ci !== undefined) return ci;
  if (options.until === 'ci') {
    entry.outcome = 'ready';
    return undefined;
  }
  progress.phase('publication');
  const refused = publish(entry, start, config, ports);
  if (refused !== undefined) return refused;
  progress.phase('rangement');
  ports.repository.deleteRemoteBranch(entry.trial);
  return undefined;
}

export async function deliver(
  options: DeliverOptions,
  config: DeliverConfig,
  ports: DeliverPorts,
): Promise<Delivery> {
  ports.progress.phase('préalables');
  const start = prerequisites(options, config, ports.repository, ports.parseRecord);
  if (!start.ok) return { outcome: 'stopped', phase: 'préalables', reason: start.reason };
  const { entry } = start;
  const stop = await play(entry, start, options, config, ports);
  if (stop !== undefined) {
    entry.outcome = 'stopped';
    entry.phase = stop.phase;
    entry.reason = stop.reason;
  }
  ports.log.append(entry);
  return entry;
}
