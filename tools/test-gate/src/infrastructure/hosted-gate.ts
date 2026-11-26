import { z } from 'zod';

import { canaryViolations } from '../domain/canary.js';
import { inPerimeter } from '../domain/mutation.js';
import { replayCases, replayViolations, type ReplayEntry } from '../domain/replay.js';
import { jobOf, parseGateConfig, ReplayRecordSchema } from './config.js';
import { changedFiles, CONFIG_PATH, mutationScope, type Output } from './gate.js';
import { GitRepository } from './git.js';
import {
  HOSTED_COSTS,
  HOSTED_LANES,
  parseLanePolicy,
  parseMutationCosts,
  planHostedSlices,
  type HostedSlice,
} from './hosted-lots.js';
import { jsonText, parseJson } from './json.js';
import { mutationLots } from './mutation-inventory.js';
import { requireNativeMutationReport } from './mutation-report.js';
import { combineHostedNative, projectNative } from './mutation-shards.js';
import { verifyMutationCatalog } from './mutation-catalog.js';
import { CucumberRunner, replayAll, sha256 } from './replay.js';
import { Workspace } from './workspace.js';

const MANIFEST = 'mutation-inventory.json';
const NATIVE = 'mutation/native.json';
const LANE_COMMANDS: readonly (string | undefined)[] = ['inventory', 'verify', 'replay'];
const origin = (lane: number) => `reports/mutation-shards/${lane}`;
const receipt = (lane: number) => `reports/replay-shards/${lane}/replay.json`;
const timingReceipt = (lane: number) => `reports/replay-shards/${lane}/timings.json`;
const Receipt = z.strictObject({
  producer: z.string().regex(/^[a-f0-9]{64}$/),
  manifest: z.string().regex(/^[a-f0-9]{64}$/),
  record: ReplayRecordSchema,
});

/**
 * `hosted-gate lanes`, `inventory|verify|replay <lot>` or `collect <plan annoncé>`, run in `root`. Every command
 * derives the plan again from the checkout it runs in (the judged commit, its first parent, the two descriptive files
 * of the tree): a lane takes its slice from it, and `collect`, the judge, requires the receipts of exactly its lanes.
 * What the plan job announced starts the lanes and is compared with the plan of the judge; it is never read as one.
 */
export async function runHostedGate(
  args: readonly string[],
  root: string,
  out: Output,
  workspace = new Workspace(root),
): Promise<number> {
  const [command, selected] = args;
  const lane = Number(selected);
  // A matrix of GitHub Actions holds at most 256 jobs: three digits name any lane a plan can open.
  const validLane = args.length === 2 && /^[1-9][0-9]{0,2}$/.test(String(selected));
  const planning = command === 'lanes' && args.length === 1;
  const collecting = command === 'collect' && args.length === 2;
  // The lanes of the plan, as `lanes` leaves them for the job that starts them and for the download of the judge.
  const announcement = 'reports/mutation-lanes.json';
  try {
    if (!planning && !collecting && (!validLane || !LANE_COMMANDS.includes(command)))
      throw new Error('usage : hosted-gate lanes | inventory|verify|replay <lot> | collect <plan annoncé>');
    if (planning) workspace.remove(announcement);
    if (command === 'inventory') workspace.remove('reports/' + MANIFEST);
    if (command === 'replay') {
      workspace.remove(receipt(lane));
      workspace.remove(timingReceipt(lane));
    }
    const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
    const read = (path: string) => {
      const bytes = workspace.readBytes(path);
      if (bytes === null) throw new Error(path + ' absent');
      return decoder.decode(bytes);
    };
    const config = parseGateConfig(read(CONFIG_PATH));
    if ('failure' in config) throw new Error(config.failure);
    const { canary, replay } = config;
    if (collecting) {
      workspace.remove(config.reports.mutation);
      if (replay !== undefined) workspace.remove(replay.record);
    }
    if (canary === undefined || replay === undefined || jobOf(config, 'linux')?.mutation !== true)
      throw new Error('configuration Linux sans canari, mutation ou rejeu');
    const repository = new GitRepository(root);
    const { head, firstParent, destination } = repository.judged(config.destination);
    const changes = changedFiles(repository, workspace, firstParent, config);
    const { debt, perimeter } = mutationScope(config, changes, workspace, repository, firstParent);
    if ('failure' in debt.current || (debt.parent !== null && 'failure' in debt.parent))
      throw new Error('registre de dette illisible');
    const full = await mutationLots(root, perimeter, canary.file, (file) => workspace.readSource(file));
    const timing = parseMutationCosts(read(HOSTED_COSTS));
    if ('failure' in timing) throw new Error(HOSTED_COSTS + ' : ' + timing.failure);
    const policy = parseLanePolicy(read(HOSTED_LANES));
    if ('failure' in policy) throw new Error(HOSTED_LANES + ' : ' + policy.failure);
    const slices = planHostedSlices(full, canary.file, read, timing, policy, root);
    const planned = slices.map((_, index) => String(index + 1));
    const lanes = `[${planned.join(',')}]`;
    if (LANE_COMMANDS.includes(command) && lane > slices.length)
      throw new Error(`lot ${lane} hors du plan re-dérivé (${slices.length} lot(s))`);
    const manifest = (number: number) => {
      // The admitted lane indexes the dense result of planHostedSlices. Read both fields before writing.
      const { lots, patterns } = slices[number - 1] as HostedSlice;
      return {
        lots,
        patterns,
        text: jsonText({ head, firstParent, destination, lane: number, lots, patterns }),
      };
    };
    const proved = (number: number, directory: string) => {
      const { lots, patterns, text } = manifest(number);
      if (!workspace.readBytes(directory + '/' + MANIFEST)?.equals(Buffer.from(text)))
        throw new Error('inventaire différent du périmètre courant pour le lot ' + number);
      const native = read(directory + '/' + NATIVE);
      const proof = projectNative(native, lots, patterns);
      // The projection must carry its static marks before any of its verdicts, the canary's included, is read.
      const projected = requireNativeMutationReport(jsonText(proof.raw));
      if (canaryViolations(canary, projected).length !== 0)
        throw new Error('canari de mutation refusé dans le lot ' + number);
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
    if (planning) {
      workspace.write(announcement, lanes + '\n');
      out.write(`plan hébergé : ${slices.length} lot(s) -> ${announcement}\n`);
    } else if (command === 'inventory') {
      const slice = manifest(lane);
      workspace.write('reports/' + MANIFEST, slice.text);
      out.write(`lot ${lane} : ${slice.lots.length} fichier(s), ${slice.patterns.length} plage(s)\n`);
    } else if (command === 'verify') {
      const { tests } = proved(lane, 'reports');
      await verifyMutationCatalog(root, tests);
      out.write(`lot natif ${lane} vérifié\n`);
    } else if (command === 'replay') {
      const directory = origin(lane);
      const { cases, nativeHash, manifestHash, tests } = proved(lane, directory);
      await verifyMutationCatalog(root, tests);
      const producer = sha256(read(directory + '/producer'));
      const work = workspace.path(replay.work);
      workspace.remove(work);
      const timings: { file: string; id: string; status: string; elapsedMs: number }[] = [];
      const entries = await replayAll(
        cases,
        workspace,
        new CucumberRunner(root, replay.profile, work),
        replay.limitMs,
        {
          discoverRuntimeErrors: true,
          onTiming: ({ file, id, status }, elapsedMs) => {
            timings.push({ file, id, status, elapsedMs: Math.round(elapsedMs) });
          },
        },
      );
      workspace.write(
        timingReceipt(lane),
        jsonText({ producer, manifest: manifestHash, report: nativeHash, mutants: timings }),
      );
      workspace.write(
        receipt(lane),
        jsonText({ producer, manifest: manifestHash, record: { report: nativeHash, mutants: entries } }),
      );
      out.write(
        `lot de rejeu ${lane} : ${entries.length} mutant(s), ${entries.filter(({ divergence }) => divergence !== null).length} divergence(s)\n`,
      );
    } else {
      // The announced plan is given by a job that runs the code it plans for: compared, never echoed nor read.
      if (selected !== lanes)
        throw new Error(`plan annoncé différent du plan re-dérivé (${slices.length} lot(s))`);
      for (const directory of ['reports/mutation-shards', 'reports/replay-shards']) {
        if (workspace.list(directory).some((name) => !planned.includes(name)))
          throw new Error('reçu hors du plan re-dérivé dans ' + directory);
      }
      const producers = [];
      const receipts: ReplayEntry[] = [];
      const errors: string[] = [];
      for (let number = 1; number <= slices.length; number++) {
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
      const combined = await combineHostedNative(root, producers, full, canary.file, slices.length);
      // Keep the exact native results available to diagnose the whole campaign if replay refuses it.
      workspace.write(config.reports.mutation, combined);
      if (errors.length !== 0) throw new Error(errors.join('\n'));
      workspace.write(replay.record, jsonText({ report: sha256(combined), mutants: receipts }));
      out.write(
        `plan re-dérivé : ${slices.length} producteur(s) vérifié(s), ${receipts.length} verdict(s) rejoué(s)\n`,
      );
    }
    return 0;
  } catch (error) {
    out.write(`porte de test hébergée : ${(error as Error).message}\n`);
    return 1;
  }
}
