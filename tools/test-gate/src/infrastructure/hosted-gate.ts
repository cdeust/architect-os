import { z } from 'zod';
import { resolve } from 'node:path';
import { canaryViolations } from '../domain/canary.js';
import { isProduction } from '../domain/layout.js';
import { inPerimeter } from '../domain/mutation.js';
import { replayCases, replayViolations, type ReplayEntry } from '../domain/replay.js';
import { jobOf, parseGateConfig, ReplayRecordSchema } from './config.js';
import { changedFiles, CONFIG_PATH, mutationScope, type Output } from './gate.js';
import { GitRepository } from './git.js';
import { HOSTED_COSTS, HOSTED_LANES, planHostedSlices, type MutationCosts } from './hosted-lots.js';
import { jsonText, parseJson } from './json.js';
import { mutationLots } from './mutation-inventory.js';
import { verifyMutationLots } from './mutation-lot-proof.js';
import { parseMutationReport } from './mutation-report.js';
import { combineNative, projectNative } from './mutation-shards.js';
import { verifyMutationCatalog } from './mutation-catalog.js';
import { CucumberRunner, replayAll, sha256 } from './replay.js';
import { Workspace } from './workspace.js';

const MANIFEST = 'mutation-inventory.json';
const NATIVE = 'mutation/native.json';
const origin = (lane: number) => `reports/mutation-shards/${lane}`;
const receipt = (lane: number) => `reports/replay-shards/${lane}/replay.json`;
const Receipt = z.strictObject({
  producer: z.string().regex(/^[a-f0-9]{64}$/),
  manifest: z.string().regex(/^[a-f0-9]{64}$/),
  record: ReplayRecordSchema,
});

export async function runHostedGate(
  args: readonly string[],
  root: string,
  out: Output,
  count = HOSTED_LANES,
): Promise<number> {
  const [command, selected] = args;
  const lane = Number(selected);
  const validLane = args.length === 2 && /^[1-9][0-9]*$/.test(selected ?? '') && lane <= count;
  const collecting = command === 'collect' && args.length === 1;
  const workspace = new Workspace(root);
  try {
    if (!collecting && (!validLane || !['inventory', 'verify', 'replay'].includes(command ?? '')))
      throw new Error('usage : hosted-gate inventory|verify|replay <lot> | collect');
    if (command === 'inventory') workspace.remove('reports/' + MANIFEST);
    if (command === 'replay') workspace.remove(receipt(lane));
    const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
    const read = (path: string) => {
      const bytes = workspace.readBytes(path);
      if (bytes === null) throw new Error(path + ' absent');
      return decoder.decode(bytes);
    };
    const config = parseGateConfig(read(CONFIG_PATH));
    if ('failure' in config) throw new Error(config.failure);
    const { canary, replay } = config;
    if (canary === undefined || replay === undefined || jobOf(config, 'linux')?.mutation !== true)
      throw new Error('configuration Linux sans canari, mutation ou rejeu');
    if (collecting) {
      workspace.remove(config.reports.mutation);
      workspace.remove(replay.record);
    }
    const repository = new GitRepository(root);
    const { head, firstParent } = repository.commits();
    const changes = changedFiles(repository, workspace, firstParent, (file) => isProduction(config, file));
    const { debt, perimeter } = mutationScope(config, changes, workspace, repository, firstParent);
    if ('failure' in debt.current || (debt.parent !== null && 'failure' in debt.parent))
      throw new Error('registre de dette illisible');
    const full = await mutationLots(root, perimeter, canary.file, read);
    const timing = JSON.parse(read(HOSTED_COSTS)) as MutationCosts;
    const slices = planHostedSlices(full, canary.file, read, timing, count);
    const manifest = (number: number) => {
      const slice = slices[number - 1];
      if (slice === undefined) throw new Error('lot natif absent : ' + number);
      return { ...slice, text: jsonText({ head, firstParent, lane: number, ...slice }) };
    };
    const proved = (number: number, directory: string) => {
      const { lots, patterns, text } = manifest(number);
      if (!workspace.readBytes(directory + '/' + MANIFEST)?.equals(Buffer.from(text)))
        throw new Error('inventaire différent du périmètre courant pour le lot ' + number);
      const native = read(directory + '/' + NATIVE);
      const proof = projectNative(native, lots, patterns);
      if (canaryViolations(canary, proof.report).length !== 0)
        throw new Error('canari de mutation refusé dans le lot ' + number);
      const projected = parseMutationReport(jsonText(proof.raw), true);
      if ('failure' in projected) throw new Error(projected.failure);
      return {
        proof,
        cases: replayCases(
          projected,
          (file, mutant) => file === canary.file || inPerimeter(perimeter, file, mutant),
        ),
        tests: projected.tests,
        nativeHash: sha256(native),
        manifestHash: sha256(text),
      };
    };
    if (command === 'inventory') {
      const planned = manifest(lane);
      workspace.write('reports/' + MANIFEST, planned.text);
      out.write(`lot ${lane} : ${planned.lots.length} fichier(s), ${planned.patterns.length} plage(s)\n`);
    } else if (command === 'verify') {
      const { tests } = proved(lane, 'reports');
      await verifyMutationCatalog(root, tests);
      out.write(`lot natif ${lane} vérifié\n`);
    } else if (command === 'replay') {
      const directory = origin(lane);
      const { cases, nativeHash, manifestHash, tests } = proved(lane, directory);
      await verifyMutationCatalog(root, tests);
      const producer = sha256(read(directory + '/producer'));
      const work = resolve(root, replay.work);
      workspace.remove(work);
      const entries = await replayAll(
        cases,
        workspace,
        new CucumberRunner(root, replay.profile, work),
        replay.limitMs,
      );
      workspace.write(
        receipt(lane),
        jsonText({ producer, manifest: manifestHash, record: { report: nativeHash, mutants: entries } }),
      );
      out.write(
        `lot de rejeu ${lane} : ${entries.length} mutant(s), ${entries.filter(({ divergence }) => divergence !== null).length} divergence(s)\n`,
      );
    } else {
      const producers = [];
      const receipts: ReplayEntry[] = [];
      const errors: string[] = [];
      for (let number = 1; number <= count; number++) {
        const directory = origin(number);
        const { proof, cases, nativeHash, manifestHash } = proved(number, directory);
        producers.push(proof);
        const received = parseJson(Receipt, read(receipt(number)));
        if ('failure' in received) throw new Error(received.failure);
        if (received.manifest !== manifestHash || received.producer !== sha256(read(directory + '/producer')))
          throw new Error('provenance du rejeu différente pour le lot ' + number);
        const issues = replayViolations(cases, received.record, nativeHash);
        errors.push(...issues.map(({ text }) => `lot ${number} : ${text}`));
        receipts.push(...received.record.mutants.map((entry) => ({ ...entry, id: number + '/' + entry.id })));
      }
      const combined = jsonText(await combineNative(root, producers, full, canary.file, true));
      const report = parseMutationReport(combined, true);
      if ('failure' in report) throw new Error(report.failure);
      const expected = full.map((lot) =>
        lot.file === canary.file ? { ...lot, mutants: slices.flatMap(() => lot.mutants) } : lot,
      );
      const mismatch = verifyMutationLots(expected, report, (id) => {
        throw new Error('mutant ignoré hors projection finale : ' + id);
      });
      if (mismatch !== null) throw new Error(mismatch.failure);
      // Keep the exact native results available to diagnose the whole campaign if replay refuses it.
      workspace.write(config.reports.mutation, combined);
      if (errors.length !== 0) throw new Error(errors.join('\n'));
      workspace.write(replay.record, jsonText({ report: sha256(combined), mutants: receipts }));
      out.write(`${count} producteurs vérifiés, ${receipts.length} verdict(s) rejoué(s)\n`);
    }
    return 0;
  } catch (error) {
    out.write(`porte de test hébergée : ${(error as Error).message}\n`);
    return 1;
  }
}
