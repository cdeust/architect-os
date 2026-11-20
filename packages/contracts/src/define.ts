import { z } from 'zod';

// Producer c5fc803ae0cd5b154c60fdbc8843698be3042d0b, packages/core/src/domain/define-handoff.ts.
export function defineHandoffSchema() {
  const requirementId = z.string().regex(/^(?:FR|NFR)-\d{1,9}$/);
  const acceptanceId = z.string().regex(/^AC-\d{1,9}$/);
  const statement = z
    .string()
    .refine((text) => /[\p{L}\p{N}]/u.test(text.replace(/(?<![\w-])(?:FR|NFR)-\d{1,9}(?![\w-])/g, '')));

  return z
    .strictObject({
      version: z.literal(1),
      run_id: z.string().min(1),
      requirements: z.array(z.strictObject({ id: requirementId, text: statement })).min(1),
      acceptance: z
        .array(
          z.strictObject({
            id: acceptanceId,
            text: statement,
            requirement_ids: z.array(requirementId).min(1),
          }),
        )
        .min(1),
    })
    .refine(({ requirements, acceptance }) => {
      const ids = new Set(requirements.map(({ id }) => id));
      const covered = new Set(acceptance.flatMap(({ requirement_ids }) => requirement_ids));
      return (
        ids.size === requirements.length &&
        new Set(acceptance.map(({ id }) => id)).size === acceptance.length &&
        acceptance.every(({ requirement_ids }) => new Set(requirement_ids).size === requirement_ids.length) &&
        ids.size === covered.size &&
        [...covered].every((id) => ids.has(id))
      );
    });
}

export type DefineHandoff = z.infer<ReturnType<typeof defineHandoffSchema>>;

export function parseDefinePlanningReply(content: readonly unknown[]) {
  const [part] = z.tuple([z.object({ type: z.literal('text'), text: z.string() })]).parse(content);
  return z.strictObject({ handoff: defineHandoffSchema() }).parse(JSON.parse(part.text));
}
