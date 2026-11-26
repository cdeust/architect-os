import { z } from 'zod';

// The state of a Step (docs/design/orchestration-fable-5-2.md, §15, step A): the vocabulary that the `StepStore` port of
// packages/sandbox and the `steps.*` operations of data share. Schemas only, no logic: the schema of the content of each
// kind stays with the port, that validates it before any adapter writes it.

/** The name of a Step, of a session or of a check: it enters a file name, the expression is what makes it safe. */
export const StepNameSchema = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/);

/**
 * What `npm run step` retains of a Step, by kind. The kinds of a session or a check carry its name; the four others
 * are one per Step.
 */
export const StepArtifactKindSchema = z.enum([
  'scout.measure',
  'scout.facts',
  'build.brief',
  'build.measure',
  'build.report',
  'check',
  'review.brief',
  'review.measure',
  'review.verdict',
]);
export type StepArtifactKind = z.infer<typeof StepArtifactKindSchema>;

/** The kinds that are one per Step, and so carry no name. */
export const UNNAMED_STEP_ARTIFACT_KINDS: readonly StepArtifactKind[] = [
  'build.brief',
  'build.measure',
  'build.report',
  'review.brief',
];

/** The bound of the bytes of one artifact, on every adapter: 1 MiB, the bound of a file the host reads to cite. */
export const STEP_ARTIFACT_MAX_BYTES = 1_048_576;

/** An event of a Step: a phase starts or ends. No free text: an event carries no session output. */
export const StepEventTypeSchema = z.enum(['phase.started', 'phase.ended']);
export const StepPhaseSchema = z.enum(['scouts', 'build', 'checks', 'reviews']);
export const StepEventSchema = z.strictObject({ type: StepEventTypeSchema, phase: StepPhaseSchema });
export type StepEvent = z.infer<typeof StepEventSchema>;
