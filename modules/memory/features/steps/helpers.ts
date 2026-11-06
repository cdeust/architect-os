import assert from 'node:assert/strict';
import { Given as CucumberGiven, Then as CucumberThen, When as CucumberWhen } from '@cucumber/cucumber';

/** Structural view of the root World (features/support/world.ts); a component cannot import across projects. */
export interface ModuleWorld {
  state: Record<string, unknown>;
  cleanups: (() => Promise<void> | void)[];
}

// Instantiation expressions: step functions get `this: ModuleWorld` (IDefineStep is generic in the World type,
// node_modules/@cucumber/cucumber/lib/support_code_library_builder/types.d.ts).
export const Given = CucumberGiven<ModuleWorld>;
export const When = CucumberWhen<ModuleWorld>;
export const Then = CucumberThen<ModuleWorld>;

export function required<T>(value: T | undefined, what: string): T {
  assert.ok(value !== undefined, `${what} must be given first`);
  return value;
}
