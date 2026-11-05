import { Given as CucumberGiven, Then as CucumberThen, When as CucumberWhen } from '@cucumber/cucumber';

/** Structural view of the root World (features/support/world.ts); a component cannot import across projects. */
export interface BrokerWorld {
  state: Record<string, unknown>;
  cleanups: (() => Promise<void> | void)[];
}

// Instantiation expressions: step functions get `this: BrokerWorld` (IDefineStep is generic in the World type,
// node_modules/@cucumber/cucumber/lib/support_code_library_builder/types.d.ts).
export const Given = CucumberGiven<BrokerWorld>;
export const When = CucumberWhen<BrokerWorld>;
export const Then = CucumberThen<BrokerWorld>;

export function slot<T>(world: BrokerWorld, key: string, create: () => T): T {
  return (world.state[key] ??= create()) as T;
}
