import { Given as CucumberGiven, Then as CucumberThen, When as CucumberWhen } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Structural view of the root World (features/support/world.ts); a component cannot import across projects. */
export interface RuntimeWorld {
  state: Record<string, unknown>;
  cleanups: (() => Promise<void> | void)[];
}

// Instantiation expressions: IDefineStep is generic in the World type
// (node_modules/@cucumber/cucumber/lib/support_code_library_builder/types.d.ts).
export const Given = CucumberGiven<RuntimeWorld>;
export const When = CucumberWhen<RuntimeWorld>;
export const Then = CucumberThen<RuntimeWorld>;

/** The committed policy file of this tool. */
export const POLICY_PATH = fileURLToPath(new URL('../../admission.json', import.meta.url));

/** The value a step stored under `key`; a missing one means the Given/When steps are in the wrong order. */
export function kept<T>(world: RuntimeWorld, key: string): T {
  const value = world.state[key];
  assert.notEqual(value, undefined, `nothing stored under "${key}": a previous step is missing`);
  return value as T;
}

/** A real directory for one scenario, removed after it; its path holds a space and is its own real path. */
export function scratchDirectory(world: RuntimeWorld): string {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'runtime scratch-')));
  world.cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

/**
 * A step argument that may hold JSON escapes such as \r or \u0000, which a feature file cannot carry as itself. In a cell
 * of Examples, Gherkin has already turned \n into a line end: it is put back as an escape first.
 */
export const unescape = (text: string): string => JSON.parse(`"${text.replaceAll('\n', '\\n')}"`) as string;

/** The bytes of a marker written as text in a feature file, as UTF-8. */
export const markerBytes = (text: string): Uint8Array => new TextEncoder().encode(unescape(text));
