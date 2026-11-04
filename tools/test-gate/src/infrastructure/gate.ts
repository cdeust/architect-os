import { parseArguments } from '../domain/arguments.js';
import type { BaseInput } from '../domain/count.js';
import { parseUnifiedDiff, wholeFile, type ChangedFile } from '../domain/diff.js';
import { isJobFeature, matchesAny, type Job } from '../domain/layout.js';
import { retiredFiles } from '../domain/debt.js';
import { canaryViolations } from '../domain/canary.js';
import { inPerimeter, mutatePatterns, perimeterOf, type MutantRecord } from '../domain/mutation.js';
import { replayCases } from '../domain/replay.js';
import { baseOf, renderReport } from '../domain/report.js';
import type { StaticSet } from '../domain/run.js';
import { evaluate } from '../domain/verdict.js';
import { jobOf, parseGateBase, parseGateConfig, parseReplayRecord, type GateConfig } from './config.js';
import { parseCucumberReport } from './cucumber-report.js';
import { generateDebt, readDebt } from './debt.js';
import { GitRepository } from './git.js';
import { compileFeature } from './gherkin.js';
import { jsonText } from './json.js';
import { parseMutationReport } from './mutation-report.js';
import { CucumberRunner, replayAll, sha256 } from './replay.js';
import { Workspace } from './workspace.js';
import { resolve } from 'node:path';

/** The descriptive configuration, relative to the repository root. */
export const CONFIG_PATH = 'tools/test-gate/gate.json';

export interface Output {
  write(text: string): unknown;
}

function staticSet(paths: readonly string[], read: (path: string) => string): StaticSet {
  const ids: string[] = [];
  const errors: string[] = [];
  for (const path of paths) {
    const compiled = compileFeature(path, read(path));
    if ('failure' in compiled) errors.push(compiled.failure);
    else ids.push(...compiled);
  }
  return { ids, errors };
}

/** The diff against the first parent (every tracked file without one), plus untracked files as whole additions. */
export function changedFiles(
  repository: GitRepository,
  workspace: Workspace,
  firstParent: string | null,
): ChangedFile[] {
  const whole = (path: string) => wholeFile(path, workspace.read(path) as string);
  const present = (path: string) => workspace.read(path) !== null;
  return [
    ...(firstParent === null
      ? repository.tracked().filter(present).map(whole)
      : parseUnifiedDiff(repository.diff(firstParent))),
    ...repository.untracked().map(whole),
  ];
}

/** The mutation debt registry and the perimeter Stryker must mutate: rule 5's, plus the files of retired entries. */
function mutationScope(
  config: GateConfig,
  changes: readonly ChangedFile[],
  workspace: Workspace,
  repository: GitRepository,
  firstParent: string | null,
) {
  const debt = readDebt(config.debt, workspace, repository, firstParent);
  const production = workspace.glob(config.production);
  return { debt, perimeter: perimeterOf(config, changes, retiredFiles(debt, production)) };
}

/** The inputs of rule 7, null when gate.json declares neither a canary nor a replay. */
function controlOf(config: GateConfig, workspace: Workspace, mutationText: string | null) {
  if (config.canary === undefined && config.replay === undefined) return null;
  const record = config.replay === undefined ? null : workspace.read(config.replay.record);
  return {
    canary: config.canary ?? null,
    replay:
      config.replay === undefined ? null : { record: record === null ? null : parseReplayRecord(record) },
    reportHash: mutationText === null ? null : sha256(mutationText),
  };
}

/**
 * `test-gate replay [--all]`: replays the verdicts of the mutation report (the perimeter of rule 5 and the canary, or
 * every mutant), writes the record `check` reads, and returns 1 when a verdict or the canary is contradicted.
 */
async function replayCommand(config: GateConfig, root: string, all: boolean, out: Output): Promise<number> {
  const workspace = new Workspace(root);
  const settings = config.replay;
  if (settings === undefined) {
    out.write(`porte de test : ${CONFIG_PATH} ne déclare pas de rejeu\n`);
    return 1;
  }
  const text = workspace.read(config.reports.mutation);
  const report = text === null ? { failure: `${config.reports.mutation} absent` } : parseMutationReport(text);
  if ('failure' in report) {
    out.write(`porte de test : rapport de mutation illisible : ${report.failure}\n`);
    return 1;
  }
  const canary = config.canary;
  let selected = (_file: string, _mutant: MutantRecord) => true;
  if (!all) {
    const repository = new GitRepository(root);
    const { firstParent } = repository.commits();
    const changes = changedFiles(repository, workspace, firstParent);
    const { perimeter } = mutationScope(config, changes, workspace, repository, firstParent);
    selected = (file, mutant) => file === canary?.file || inPerimeter(perimeter, file, mutant);
  }
  workspace.remove(settings.work);
  const runner = new CucumberRunner(root, settings.profile, resolve(root, settings.work));
  const mutants = await replayAll(replayCases(report, selected), workspace, runner, settings.limitMs);
  workspace.write(settings.record, jsonText({ report: sha256(text as string), mutants }));
  const divergent = mutants.filter((entry) => entry.divergence !== null);
  const wrongCanary = canary === undefined ? [] : canaryViolations(canary, report);
  out.write(
    [
      `rejeu : ${mutants.length} mutant(s), ${divergent.length} divergence(s) -> ${settings.record}`,
      ...divergent.map((entry) => `- ${entry.file} #${entry.id} ${entry.status} : ${entry.divergence}`),
      ...wrongCanary.map((violation) => `- ${violation.text}`),
      '',
    ].join('\n'),
  );
  return divergent.length === 0 && wrongCanary.length === 0 ? 0 : 1;
}

function gate(
  config: GateConfig,
  job: Job,
  command: 'plan' | 'check',
  root: string,
  env: NodeJS.ProcessEnv,
  out: Output,
) {
  const workspace = new Workspace(root);
  const repository = new GitRepository(root);
  const { head, firstParent } = repository.commits();
  const changes = changedFiles(repository, workspace, firstParent);
  // A job without mutation does not read the mutation debt registry.
  const scope = job.mutation ? mutationScope(config, changes, workspace, repository, firstParent) : null;
  const reports = config.reports;
  if (command === 'plan') {
    // The canary is mutated whole in every run with mutation: rule 7 reads it before any verdict on the code.
    const canary = config.canary === undefined ? [] : [config.canary.file];
    const mutate = scope === null ? [] : mutatePatterns(scope.perimeter, canary);
    workspace.write(reports.plan, jsonText({ job: job.name, head, firstParent, mutate }));
    out.write(`plan ${job.name} : ${mutate.length} motif(s) à muter -> ${reports.plan}\n`);
    return 0;
  }
  const inJob = (path: string) => isJobFeature(config, job, path);
  const staticNow = staticSet(
    workspace.glob(config.features).filter(inJob),
    (path) => workspace.read(path) as string,
  );
  const staticParent =
    firstParent === null
      ? []
      : staticSet(repository.filesAt(firstParent).filter(inJob), (path) => repository.show(firstParent, path))
          .ids;
  const cucumber = workspace.read(reports.cucumber);
  const baseText = workspace.read(reports.base);
  const base: BaseInput = baseText === null ? null : parseGateBase(baseText);
  const mutationText = workspace.read(reports.mutation);
  const verdict = evaluate({
    job: job.name,
    head,
    firstParent,
    staticNow,
    staticParent,
    run:
      cucumber === null
        ? { failure: `${reports.cucumber} absent` }
        : parseCucumberReport(cucumber, (uri) => matchesAny(uri, job.features)),
    base,
    mutation:
      scope === null
        ? null
        : {
            ...scope,
            report:
              mutationText === null
                ? { failure: `${reports.mutation} absent` }
                : parseMutationReport(mutationText),
            control: controlOf(config, workspace, mutationText),
          },
  });
  const report = renderReport(verdict);
  workspace.write(reports.report, report);
  const summary = env['GITHUB_STEP_SUMMARY'];
  if (summary !== undefined && summary !== '') workspace.append(summary, report);
  if (verdict.green) workspace.write(reports.baseOut, jsonText(baseOf(verdict)));
  else workspace.remove(reports.baseOut);
  out.write(report);
  return verdict.green ? 0 : 1;
}

/**
 * `test-gate plan|check [--job <name>]`, `test-gate debt` or `test-gate replay [--all]` run in `root`, the process argv as given by Node.
 * Returns the exit code: 0 green (or plan or debt registry written), 1 red or unusable input. Never throws on a bad input: it is reported and red.
 */
export async function runGate(
  argv: readonly string[],
  root: string,
  env: NodeJS.ProcessEnv,
  out: Output,
): Promise<number> {
  const refuse = (failure: string) => {
    out.write(`porte de test : ${failure}\n`);
    return 1;
  };
  const [, , ...args] = argv;
  const command = parseArguments(args);
  if ('failure' in command) return refuse(command.failure);
  const text = new Workspace(root).read(CONFIG_PATH);
  if (text === null) return refuse(`${CONFIG_PATH} absent`);
  const config = parseGateConfig(text);
  if ('failure' in config) return refuse(`${CONFIG_PATH} : ${config.failure}`);
  if (command.name === 'debt') {
    const written = generateDebt(config, new Workspace(root));
    if ('failure' in written) return refuse(written.failure);
    out.write(written.summary);
    return 0;
  }
  if (command.name === 'replay') return replayCommand(config, root, command.all, out);
  const job = jobOf(config, command.job);
  if (job === null) return refuse(`job inconnu : ${command.job}`);
  return gate(config, job, command.name, root, env, out);
}
