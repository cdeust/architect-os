import { Given as CucumberGiven, Then as CucumberThen, When as CucumberWhen } from '@cucumber/cucumber';
import { fileURLToPath } from 'node:url';

/** Structural view of the root World (features/support/world.ts); a component cannot import across projects. */
export interface DeliverWorld {
  state: Record<string, unknown>;
  cleanups: (() => Promise<void> | void)[];
}

// Instantiation expressions: IDefineStep is generic in the World type
// (node_modules/@cucumber/cucumber/lib/support_code_library_builder/types.d.ts).
export const Given = CucumberGiven<DeliverWorld>;
export const When = CucumberWhen<DeliverWorld>;
export const Then = CucumberThen<DeliverWorld>;

/** The root of this repository. */
export const REPOSITORY = fileURLToPath(new URL('../../../../', import.meta.url));
