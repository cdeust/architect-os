import { parseArguments } from '../domain/arguments.js';
import type { BaseInput } from '../domain/count.js';
import { parseUnifiedDiff, wholeFile, type ChangedFile } from '../domain/diff.js';
import { isJobFeature, isProduction, matchesAny, type Job } from '../domain/layout.js';
import { retiredFiles } from '../domain/debt.js';
import { canaryViolations } from '../domain/canary.js';
import { inPerimeter, mutatePatterns, perimeterOf, type MutantRecord } from '../domain/mutation.js';
import { replayCases, replayViolations } from '../domain/replay.js';
import { distributeReplayFiles } from '../domain/replay-lots.js';
import { baseOf, renderReport } from '../domain/report.js';
import type { StaticSet } from '../domain/run.js';
import { evaluate } from '../domain/verdict.js';
import { jobOf, parseGateBase, parseGateConfig, parseReplayRecord, type GateConfig } from './config.js';
import { parseCucumberReport, parseCucumberShards } from './cucumber-report.js';
import { generateDebt, readDebt, realignDebt } from './debt.js';
import { GitRepository } from './git.js';
import { compileFeature } from './gherkin.js';
import { jsonText } from './json.js';
import { parseMutationReport } from './mutation-report.js';
import { CucumberRunner, replayAll, sha256 } from './replay.js';
import { Workspace } from './workspace.js';
import { resolve } from 'node:path';

/** The descriptive configuration, relative to the repository root. */
export const CONFIG_PATH = 'tools/test-gate/gate.json';
const INVENTORY_PATH = 'reports/mutation-inventory.json';
const NATIVE_MUTATION_PATH = 'reports/mutation/native.json';

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
  include: (path: string) => boolean = () => true,
): ChangedFile[] {
  const whole = (path: string) => wholeFile(path, workspace.read(path) as string);
  const present = (path: string) => workspace.read(path) !== null;
  return [
    ...(firstParent === null
      ? repository.tracked().filter(include).filter(present).map(whole)
      : parseUnifiedDiff(repository.diff(firstParent)).filter(({ path }) => include(path))),
    ...repository.untracked().filter(include).map(whole),
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
async function replayCommand(
  config: GateConfig,
  root: string,
  mode: 'all' | 'normal' | 'collect' | 1 | 2,
  out: Output,
): Promise<number> {
  const workspace = new Workspace(root);
  const settings = config.replay;
  if (settings === undefined) {
    out.write(`porte de test : ${CONFIG_PATH} ne déclare pas de rejeu\n`);
    return 1;
  }
  const sharded = mode === 1 || mode === 2 || mode === 'collect';
  const target = mode === 1 || mode === 2 ? replayShardPath(mode) : settings.record;
  workspace.remove(target);
  const bytes = workspace.readBytes(config.reports.mutation);
  const text =
    bytes === null ? null : new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  const report =
    text === null ? { failure: `${config.reports.mutation} absent` } : parseMutationReport(text, sharded);
  if ('failure' in report) {
    out.write(`porte de test : rapport de mutation illisible : ${report.failure}\n`);
    return 1;
  }
  const canary = config.canary;
  let selected = (_file: string, _mutant: MutantRecord) => true;
  let batches: ReturnType<typeof distributeReplayFiles> | undefined;
  if (mode !== 'all') {
    const repository = new GitRepository(root);
    const { firstParent } = repository.commits();
    const changes = changedFiles(repository, workspace, firstParent);
    const { perimeter, debt } = mutationScope(config, changes, workspace, repository, firstParent);
    selected = (file, mutant) => file === canary?.file || inPerimeter(perimeter, file, mutant);
    if (sharded) {
      if ('failure' in debt.current || (debt.parent !== null && 'failure' in debt.parent))
        throw new Error('registre de dette illisible');
      const { verifyMutationCatalog } = await import('./mutation-catalog.js');
      await verifyMutationCatalog(root, report.tests);
      const { mutationLots } = await import('./mutation-inventory.js');
      const lots = await mutationLots(root, perimeter, canary?.file, (file) => workspace.read(file));
      batches = distributeReplayFiles(lots);
    }
  }
  const reportHash = sha256(text as string);
  const cases = replayCases(report, selected);
  const inReplayLot = (shard: 1 | 2, file: string, mutant: MutantRecord) => {
    if (file === canary?.file && /^[12]\//.test(mutant.id)) return mutant.id.startsWith(String(shard) + '/');
    return batches?.[shard === 1 ? 0 : 1].has(file) === true;
  };
  if (batches !== undefined) {
    if (cases.some(({ file }) => !batches[0].has(file) && !batches[1].has(file)))
      throw new Error('mutant à rejouer sans lot');
    if (mode === 'collect') {
      const collected = ([1, 2] as const).flatMap((shard) => {
        const receiptText = workspace.read(replayShardPath(shard));
        const receipt = receiptText === null ? null : parseReplayRecord(receiptText);
        const required = cases.filter(({ file, mutant }) => inReplayLot(shard, file, mutant));
        if (receipt === null) throw new Error('lot de rejeu absent : ' + shard);
        const issues = replayViolations(required, receipt, reportHash);
        if (issues.length)
          throw new Error('lot de rejeu ' + shard + ' : ' + issues.map(({ text }) => text).join('\n'));
        if ('failure' in receipt) throw new Error(receipt.failure);
        return receipt.mutants;
      });
      workspace.write(target, jsonText({ report: reportHash, mutants: collected }));
      out.write('lots de rejeu vérifiés : ' + collected.length + ' mutant(s)\n');
      return 0;
    }
  }
  workspace.remove(settings.work);
  const runner = new CucumberRunner(root, settings.profile, resolve(root, settings.work));
  const due =
    mode === 1 || mode === 2 ? cases.filter(({ file, mutant }) => inReplayLot(mode, file, mutant)) : cases;
  const mutants = await replayAll(due, workspace, runner, settings.limitMs);
  workspace.write(target, jsonText({ report: reportHash, mutants }));
  const divergent = mutants.filter((entry) => entry.divergence !== null);
  const wrongCanary = canary === undefined ? [] : canaryViolations(canary, report);
  out.write(
    [
      `rejeu : ${mutants.length} mutant(s), ${divergent.length} divergence(s) -> ${target}`,
      ...divergent.map((entry) => `- ${entry.file} #${entry.id} ${entry.status} : ${entry.divergence}`),
      ...wrongCanary.map((violation) => `- ${violation.text}`),
      '',
    ].join('\n'),
  );
  return divergent.length === 0 && wrongCanary.length === 0 ? 0 : 1;
}

function replayShardPath(shard: number): string {
  return 'reports/replay-shards/' + shard + '/replay.json';
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
  const shards = env['AOS_CUCUMBER_SHARDS'];
  const inScope = (uri: string) => matchesAny(uri, job.features);
  const run = (() => {
    if (shards !== undefined) {
      // GitHub Actions limits a job matrix to 256 jobs (docs.github.com/en/actions/reference/limits).
      if (!/^[1-9]\d*$/.test(shards) || Number(shards) > 256)
        return { failure: 'nombre de lots Cucumber invalide' };
      const reports = Array.from({ length: Number(shards) }, (_, i) =>
        workspace.read(`reports/cucumber-shards/${i + 1}/cucumber.ndjson`),
      );
      return parseCucumberShards(reports, inScope);
    }
    const cucumber = workspace.read(reports.cucumber);
    return cucumber === null
      ? { failure: `${reports.cucumber} absent` }
      : parseCucumberReport(cucumber, inScope);
  })();
  const baseText = workspace.read(reports.base);
  const base: BaseInput = baseText === null ? null : parseGateBase(baseText);
  const mutationText = workspace.read(reports.mutation);
  const verdict = evaluate({
    job: job.name,
    head,
    firstParent,
    staticNow,
    staticParent,
    run,
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
 * `test-gate plan|check [--job <name>]`, `test-gate debt [realign]` or `test-gate replay [--all]` run in `root`, the process argv as given by Node.
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
  const workspace = new Workspace(root);
  if (command.name === 'inventory') workspace.remove(INVENTORY_PATH);
  const text = workspace.read(CONFIG_PATH);
  if (text === null) return refuse(`${CONFIG_PATH} absent`);
  const config = parseGateConfig(text);
  if ('failure' in config) return refuse(`${CONFIG_PATH} : ${config.failure}`);
  if (command.name === 'realign') {
    const realigned = realignDebt(config, new Workspace(root));
    if ('failure' in realigned) return refuse(realigned.failure);
    out.write(realigned.summary);
    return realigned.aligned ? 0 : 1;
  }
  if (command.name === 'debt') {
    const written = generateDebt(config, new Workspace(root));
    if ('failure' in written) return refuse(written.failure);
    out.write(written.summary);
    return 0;
  }
  if (command.name === 'replay' || command.name === 'replay-collect') {
    const mode =
      command.name === 'replay-collect' ? 'collect' : (command.shard ?? (command.all ? 'all' : 'normal'));
    try {
      return await replayCommand(config, root, mode, out);
    } catch (error) {
      return refuse((error as Error).message);
    }
  }
  const job = jobOf(config, command.job);
  if (job === null) return refuse(`job inconnu : ${command.job}`);
  if (
    command.name === 'inventory' ||
    command.name === 'inventory-check' ||
    command.name === 'inventory-project' ||
    command.name === 'inventory-collect'
  ) {
    const project = command.name === 'inventory-project';
    if (project || command.name === 'inventory-collect') workspace.remove(config.reports.mutation);
    if (!job.mutation) return refuse('le job ne prévoit pas de mutation');
    try {
      const repository = new GitRepository(root);
      const { head, firstParent } = repository.commits();
      const changes = changedFiles(repository, workspace, firstParent, (file) => isProduction(config, file));
      const { debt, perimeter } = mutationScope(config, changes, workspace, repository, firstParent);
      if ('failure' in debt.current) throw new Error('registre de dette illisible : ' + debt.current.failure);
      if (debt.parent !== null && 'failure' in debt.parent)
        throw new Error('registre de dette illisible au premier parent : ' + debt.parent.failure);
      const { mutationLots } = await import('./mutation-inventory.js');
      const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
      const lots = await mutationLots(root, perimeter, config.canary?.file, (file) => {
        const bytes = workspace.readBytes(file);
        return bytes === null ? null : decoder.decode(bytes);
      });
      const { combineNative, nativeScope, nativeShard, projectNative } = await import('./mutation-shards.js');
      const canary = config.canary?.file;
      const manifest = (shard?: 1 | 2) => {
        const planned = shard === undefined ? lots : nativeShard(lots, canary, shard);
        return {
          planned,
          text: jsonText({
            head,
            firstParent,
            job: job.name,
            shard,
            lots: planned,
          }),
        };
      };
      const checkNative = (path: string, rawPath: string, shard?: 1 | 2) => {
        const expected = manifest(shard);
        if (workspace.readBytes(path)?.equals(Buffer.from(expected.text)) !== true)
          throw new Error('inventaire absent ou différent du périmètre courant : ' + path);
        const bytes = workspace.readBytes(rawPath);
        if (bytes === null) throw new Error('rapport de mutation absent : ' + rawPath);
        return projectNative(decoder.decode(bytes), expected.planned);
      };
      if (command.name === 'inventory-collect') {
        const proofs = ([1, 2] as const).map((shard) => {
          const directory = 'reports/mutation-shards/' + shard + '/';
          const proof = checkNative(
            directory + INVENTORY_PATH.slice('reports/'.length),
            directory + NATIVE_MUTATION_PATH.slice('reports/'.length),
            shard,
          );
          if (config.canary !== undefined && canaryViolations(config.canary, proof.report).length > 0)
            throw new Error('canari de mutation refusé dans le lot ' + shard);
          return proof;
        });
        const combined = await combineNative(root, proofs, lots, canary);
        workspace.write(config.reports.mutation, jsonText(combined));
        out.write('producteurs de mutation vérifiés : ' + proofs.length + '\n');
        return 0;
      }
      const { planned, text: inventoryText } = manifest(command.shard);
      if (command.name !== 'inventory') {
        const { raw } = checkNative(
          INVENTORY_PATH,
          project ? NATIVE_MUTATION_PATH : config.reports.mutation,
          command.shard,
        );
        if (project)
          workspace.write(
            config.reports.mutation,
            jsonText({ ...raw, gateNativeScope: nativeScope(planned) }),
          );
        out.write('lots de mutation vérifiés : ' + planned.length + ' lot(s)\n');
        return 0;
      }
      workspace.write(INVENTORY_PATH, inventoryText);
      out.write(`inventaire ${job.name} : ${planned.length} lot(s) de mutations -> ${INVENTORY_PATH}\n`);
      return 0;
    } catch (error) {
      if (command.name === 'inventory') workspace.remove(INVENTORY_PATH);
      return refuse((error as Error).message);
    }
  }
  return gate(config, job, command.name, root, env, out);
}
