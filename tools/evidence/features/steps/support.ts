import { Given as CucumberGiven, Then as CucumberThen, When as CucumberWhen } from '@cucumber/cucumber';
import { fileURLToPath } from 'node:url';

/** Structural view of the root World (features/support/world.ts); a component cannot import across projects. */
export interface EvidenceWorld {
  state: Record<string, unknown>;
  cleanups: (() => Promise<void> | void)[];
}

// Instantiation expressions: IDefineStep is generic in the World type
// (node_modules/@cucumber/cucumber/lib/support_code_library_builder/types.d.ts).
export const Given = CucumberGiven<EvidenceWorld>;
export const When = CucumberWhen<EvidenceWorld>;
export const Then = CucumberThen<EvidenceWorld>;

export const FIXTURES = fileURLToPath(new URL('../../fixtures/', import.meta.url));

/** A step argument that may hold JSON escapes such as \u0001, which a feature file cannot carry as itself. */
export const unescape = (text: string): string => JSON.parse(`"${text}"`) as string;
