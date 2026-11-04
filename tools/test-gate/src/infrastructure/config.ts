import { z } from 'zod';
import type { GateBase } from '../domain/count.js';
import type { Job } from '../domain/layout.js';
import type { ReplayRecord } from '../domain/replay.js';
import type { ReadFailure } from '../domain/violation.js';
import { parseJson } from './json.js';

const Glob = z.string().min(1);
const FileSet = z.strictObject({ include: z.array(Glob).min(1), exclude: z.array(Glob) });
const Path = z.string().min(1);

/** Schema of tools/test-gate/gate.json, the descriptive configuration of the gate. */
export const GateConfigSchema = z.strictObject({
  production: FileSet,
  features: FileSet,
  jobs: z.record(Glob, z.strictObject({ features: z.array(Glob).min(1), mutation: z.boolean() })),
  /** The mutation debt registry (rule 6), relative to the repository root. */
  debt: Path,
  /** Rule 7: the module whose mutants have a known status, and the status of every mutant of each function. */
  canary: z
    .strictObject({
      file: Path,
      functions: z.record(z.string().min(1), z.enum(['Killed', 'Survived', 'NoCoverage'])),
    })
    .optional(),
  /**
   * Rule 7: `test-gate replay` runs `cucumber-js --profile <profile>` in the root, writes its runs under `work` and the
   * record `check` reads at `record`. `limitMs` stops a run that does not end (a Timeout mutant has its own limit).
   */
  replay: z
    .strictObject({
      profile: z.string().min(1),
      record: Path,
      work: Path,
      limitMs: z.number().int().positive(),
    })
    .optional(),
  reports: z.strictObject({
    cucumber: Path,
    mutation: Path,
    base: Path,
    plan: Path,
    report: Path,
    baseOut: Path,
  }),
});

export type GateConfig = z.infer<typeof GateConfigSchema>;

/** Schema of the replay record (domain/replay.ts ReplayRecord), written by `test-gate replay`. */
export const ReplayRecordSchema = z.strictObject({
  report: z.string().min(1),
  mutants: z.array(
    z.strictObject({
      file: z.string().min(1),
      id: z.string().min(1),
      status: z.string().min(1),
      divergence: z.string().min(1).nullable(),
    }),
  ),
});

/** Schema of gate-base.json (written by the gate, read back from the artifact of the last green main run). */
export const GateBaseSchema = z.strictObject({
  job: z.string().min(1),
  sha: z.string().min(1),
  count: z.number().int().nonnegative(),
  pickles: z.array(z.string()),
});

export function parseGateConfig(text: string): GateConfig | ReadFailure {
  return parseJson(GateConfigSchema, text);
}

export function parseReplayRecord(text: string): ReplayRecord | ReadFailure {
  return parseJson(ReplayRecordSchema, text);
}

export function parseGateBase(text: string): GateBase | ReadFailure {
  return parseJson(GateBaseSchema, text);
}

/** The named job, or null when gate.json does not declare it. */
export function jobOf(config: GateConfig, name: string): Job | null {
  const job = config.jobs[name];
  return job === undefined ? null : { name, ...job };
}
