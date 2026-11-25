// The delivery command (docs/design/orchestration-fable-5-2.md §14, « Étape 1, la commande de livraison »): six phases
// over the ports, the first that fails ends the run. Everything is bound to the one hash read in phase 1; no phase
// reads HEAD again. A port that throws is not a reason of the list: the error leaves `deliver` as it is.
import type { DeliverConfig } from '../domain/config.js';
import { ciState } from '../domain/ci.js';
import { planPublication, type RemoteBranch } from '../domain/plan.js';
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
  RuleSuite,
} from '../domain/ports.js';
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

/** What phase 1 found: the branches to push, and where every branch of the file was. */
interface Started {
  ok: true;
  entry: DeliveryEntry;
  publish: string[];
  remotes: RemoteBranch[];
}

type Start = Started | { ok: false; reason: Reason };

function refuse(reason: Reason): Start {
  return { ok: false, reason };
}

/** Phase 1. */
function prerequisites(options: DeliverOptions, config: DeliverConfig, repository: Repository): Start {
  if (repository.holdsNestedRepository()) return refuse("dépôt imbriqué dans l'arbre");
  if (!repository.isClean()) return refuse('arbre non propre');
  const hash = repository.head();
  if (!/^[0-9a-f]{40}$/.test(hash)) return refuse('empreinte de commit invalide');
  repository.fetch();
  const remotes: RemoteBranch[] = [];
  for (const branch of config.branches) {
    const head = repository.remoteHead(branch);
    if (head === undefined) return refuse('branche distante absente');
    remotes.push({ branch, head });
  }
  for (const remote of remotes) {
    if (remote.head !== hash && !repository.isAncestor(remote.head, hash)) {
      return refuse("la branche distante n'est pas un ancêtre du commit");
    }
  }
  const plan = planPublication(hash, remotes);
  if (!plan.ok) return refuse(plan.reason);
  for (const path of config.appendOnly) {
    if (repository.deletedLines(plan.parent, hash, path) !== 0) {
      return refuse('un fichier en ajout seul a perdu des lignes');
    }
  }
  const trial = trialBranch(config.trialPrefix, options.name);
  if (trial === undefined || config.branches.includes(trial)) return refuse("nom de branche d'essai refusé");
  const entry: DeliveryEntry = {
    outcome: 'delivered',
    hash,
    trial,
    parent: plan.parent,
    ci: { attempts: 0, polls: 0 },
    gate: undefined,
    published: [],
    ruleSuites: new Map(),
  };
  return { ok: true, entry, publish: plan.publish, remotes };
}

/** Phase 2. */
function pushTrial(entry: DeliveryEntry, repository: Repository): Stop | undefined {
  if (repository.push(entry.hash, entry.trial) === 'refused') {
    return { phase: "branche d'essai", reason: "push de la branche d'essai refusé" };
  }
  return undefined;
}

/** Phase 3. */
async function playGate(entry: DeliveryEntry, gate: Gate): Promise<Stop | undefined> {
  if (gate.verdictHash() === entry.hash) {
    entry.gate = 'reused';
    return undefined;
  }
  entry.gate = 'ran';
  if ((await gate.run()) !== 0) return { phase: 'porte', reason: 'porte rouge' };
  if (gate.verdictHash() !== entry.hash) {
    return { phase: 'porte', reason: 'le verdict de la porte ne nomme pas ce commit' };
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
  const jobNames = [
    ...config.requiredJobs,
    ...Object.values(config.jobDependencies ?? {}).flatMap((group) => group.producers),
  ];
  let requestedAttempt: number | undefined;
  let unnumberedRerunPending = false;
  for (let poll = 1; poll <= config.ciPolls; poll++) {
    if (poll > 1) await clock.sleep(config.pollSeconds);
    entry.ci.polls = poll;
    const run = forge.run(entry.hash, config.workflow, jobNames);
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

/** The evaluation of the push of the hash to a branch, polled; undefined when none came. */
async function readRuleSuite(
  entry: DeliveryEntry,
  branch: string,
  config: DeliverConfig,
  forge: Forge,
  clock: Clock,
): Promise<RuleSuite | undefined> {
  for (let poll = 1; poll <= config.ruleSuitePolls; poll++) {
    if (poll > 1) await clock.sleep(config.pollSeconds);
    const suite = forge.ruleSuite(branch, entry.hash);
    if (suite !== undefined) return suite;
  }
  return undefined;
}

/**
 * Phase 5: every branch of the file, in order; `behind` are the ones pushed, the others are already at the hash. Just
 * before, every branch is read again and must be where phase 1 found it (`remotes`), at the hash or at the parent.
 */
async function publish(
  entry: DeliveryEntry,
  remotes: readonly RemoteBranch[],
  behind: readonly string[],
  config: DeliverConfig,
  ports: DeliverPorts,
): Promise<Stop | undefined> {
  const { repository, forge, clock } = ports;
  repository.fetch();
  if (remotes.some((remote) => repository.remoteHead(remote.branch) !== remote.head)) {
    return { phase: 'publication', reason: 'une branche distante a bougé' };
  }
  for (const branch of config.branches) {
    if (behind.includes(branch)) {
      if (repository.push(entry.hash, branch) === 'refused') {
        return { phase: 'publication', reason: 'push refusé' };
      }
      entry.published.push(branch);
    }
    const suite = await readRuleSuite(entry, branch, config, forge, clock);
    if (suite === undefined) return { phase: 'publication', reason: 'évaluation du ruleset introuvable' };
    entry.ruleSuites.set(branch, suite);
    if (suite !== 'pass') return { phase: 'publication', reason: "le ruleset n'a pas rendu pass" };
  }
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
  const gate = await playGate(entry, ports.gate);
  if (gate !== undefined) return gate;
  progress.phase('CI');
  const ci = await awaitCi(entry, config, ports.forge, ports.clock);
  if (ci !== undefined) return ci;
  if (options.until === 'ci') {
    entry.outcome = 'ready';
    return undefined;
  }
  progress.phase('publication');
  const refused = await publish(entry, start.remotes, start.publish, config, ports);
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
  const start = prerequisites(options, config, ports.repository);
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
