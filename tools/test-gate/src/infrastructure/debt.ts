import {
  debtEntries,
  realign,
  renderGenerated,
  renderRealigned,
  type DebtInput,
  type DebtRegistry,
} from '../domain/debt.js';
import { isProduction } from '../domain/layout.js';
import type { ReadFailure } from '../domain/violation.js';
import { z } from 'zod';
import type { GateConfig } from './config.js';
import type { GitRepository } from './git.js';
import { jsonText, parseJson } from './json.js';
import { parseMutationReport } from './mutation-report.js';
import type { Workspace } from './workspace.js';

const Position = z.strictObject({
  line: z.number().int().positive(),
  column: z.number().int().nonnegative(),
});

/** Schema of the mutation debt registry (gate.json `debt`). */
export const DebtRegistrySchema = z.strictObject({
  survivors: z.array(
    z.strictObject({
      file: z.string().min(1),
      start: Position,
      end: Position,
      mutator: z.string().min(1),
      original: z.string(),
      replacement: z.string(),
    }),
  ),
});

export function parseDebtRegistry(text: string): DebtRegistry | ReadFailure {
  return parseJson(DebtRegistrySchema, text);
}

/** The text of the given files that exist in the working tree. */
function sourcesOf(files: Iterable<string>, workspace: Workspace): Map<string, string> {
  const sources = new Map<string, string>();
  for (const file of files) {
    const text = workspace.read(file);
    if (text !== null) sources.set(file, text);
  }
  return sources;
}

/** The registry of the working tree and of the first parent, and which of their files exist in the tree. */
export function readDebt(
  path: string,
  workspace: Workspace,
  repository: GitRepository,
  firstParent: string | null,
): DebtInput {
  const text = workspace.read(path);
  const current = text === null ? { failure: `${path} absent` } : parseDebtRegistry(text);
  const parent =
    firstParent === null || !repository.filesAt(firstParent).includes(path)
      ? null
      : parseDebtRegistry(repository.show(firstParent, path));
  const entries = [current, parent].flatMap((registry) =>
    registry === null || 'failure' in registry ? [] : registry.survivors,
  );
  const present = new Set(entries.map((entry) => entry.file).filter((file) => workspace.exists(file)));
  const sources = sourcesOf(
    entries.map((entry) => entry.file),
    workspace,
  );
  return { path, current, parent, present, sources };
}

/**
 * `test-gate debt`: writes the registry from the mutation report. The summary to print, or the reason the gate
 * refuses: the registry can only shrink, so it is never regenerated.
 */
export function generateDebt(config: GateConfig, workspace: Workspace): { summary: string } | ReadFailure {
  if (workspace.exists(config.debt)) {
    return {
      failure: `le registre ne peut que rétrécir : on ne le régénère pas (${config.debt} existe déjà)`,
    };
  }
  const text = workspace.read(config.reports.mutation);
  const report = text === null ? { failure: `${config.reports.mutation} absent` } : parseMutationReport(text);
  if ('failure' in report) return { failure: `rapport de mutation illisible : ${report.failure}` };
  // Production files only: the canary of rule 7 is mutated in the same run and keeps its survivors on purpose.
  const survivors = debtEntries(report).filter((entry) => isProduction(config, entry.file));
  workspace.write(config.debt, jsonText({ survivors }));
  return { summary: renderGenerated(config.debt, survivors) };
}

/** Compare the committed registry with the native report without changing the checkout. */
export function compareDebt(
  config: GateConfig,
  workspace: Workspace,
  git: GitRepository,
): { summary: string } | ReadFailure {
  const committed = 'reports/mutation-debt.committed.json';
  const computed = 'reports/mutation-debt.computed.json';
  workspace.remove(committed);
  workspace.remove(computed);
  const text = git.show('HEAD', config.debt);
  workspace.write(committed, text);
  const result = generateDebt({ ...config, debt: computed }, workspace);
  if ('failure' in result) return result;
  if (workspace.read(computed) !== text) return { failure: 'registre de dette différent du rapport complet' };
  return result;
}

/**
 * `test-gate debt realign`: puts the entries of the registry back on their text and writes it when one moved. The
 * summary to print and whether every entry points at its text afterwards, or the reason the gate refuses.
 */
export function realignDebt(
  config: GateConfig,
  workspace: Workspace,
): { summary: string; aligned: boolean } | ReadFailure {
  const text = workspace.read(config.debt);
  const registry = text === null ? { failure: `${config.debt} absent` } : parseDebtRegistry(text);
  if ('failure' in registry) return { failure: `registre de dette illisible : ${registry.failure}` };
  const result = realign(
    registry.survivors,
    sourcesOf(
      registry.survivors.map((entry) => entry.file),
      workspace,
    ),
  );
  if (result.moved > 0) workspace.write(config.debt, jsonText({ survivors: result.survivors }));
  return {
    summary: renderRealigned(config.debt, result.moved, result.stuck),
    aligned: result.stuck.length === 0,
  };
}
