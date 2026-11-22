import { z } from 'zod';

export const specRoute = z.strictObject({
  provider: z.enum(['openai', 'google', 'anthropic']),
  model: z.string().regex(/^[a-z0-9][a-z0-9._:-]*$/),
});
const id = z.string().min(1);
export const specInvocation = z.object({
  invocation_id: id,
  subagent_type: id,
  description: z.string(),
  prompt: z.string().min(1),
  model: id,
  model_route: specRoute,
  isolation: z.literal('none'),
  effort: z.enum(['low', 'medium', 'high']).optional(),
});
export const specHostAction = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('spawn_subagents'),
    purpose: z.enum(['draft', 'judge', 'review', 'probe']),
    batch_id: id,
    invocations: z.array(specInvocation).min(1),
  }),
  z.object({
    kind: z.literal('ask_user'),
    question_id: id,
    header: z.string(),
    description: z.string(),
    options: z.array(z.object({ label: id, description: z.string().optional() })).nullable(),
    multi_select: z.boolean().default(false),
  }),
  z.object({ kind: z.literal('write_file'), path: id, content: z.string() }),
  z.object({
    kind: z.literal('done'),
    summary: z.string(),
    outcome: z.object({
      status: z.enum(['passed', 'needs_attention']),
      reasons: z.array(z.string()),
    }),
  }),
  z.object({ kind: z.literal('failed'), reason: z.string(), step: id }),
]);
export type SpecHostAction = z.infer<typeof specHostAction>;
export type SpecInvocation = z.infer<typeof specInvocation>;
export type SpecRoute = z.infer<typeof specRoute>;

export const specRunId = z.string().regex(/^run_[a-z0-9]+_[a-z0-9]+$/);
const offset = z.number().int().nonnegative();
export const specActionPage = z.object({
  run_id: specRunId,
  action: specHostAction,
  __page: z.object({ offset, count: offset, total: offset, next_offset: offset.nullable() }),
});
export const specHostResult = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('subagent_batch_result'),
    batch_id: id,
    responses: z.array(
      z.object({
        invocation_id: id,
        raw_text: z.string().optional(),
        error: z.string().optional(),
        model_receipt: specRoute.optional(),
      }),
    ),
  }),
  z.object({ kind: z.literal('user_answer'), question_id: id, selected: z.array(id), freeform: z.string() }),
  z.object({ kind: z.literal('file_written'), path: id, bytes: offset }),
]);
export type SpecHostResult = z.infer<typeof specHostResult>;

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const authority = z.strictObject({
  route: specRoute,
  account: id,
  billing: z.literal('subscription'),
  quota: z.number().int().positive().safe(),
});
export const specPlanningConfig = z
  .strictObject({
    bundle_sha256: digest,
    feature_description: z.string().trim().min(1),
    plan_step: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/),
    prd_context: z
      .enum(['proposal', 'feature', 'bug', 'incident', 'poc', 'mvp', 'release', 'cicd'])
      .optional(),
    request_size: z.enum(['tiny', 'standard']).optional(),
    drafter: authority,
    reviewer: authority,
    panel_reviewer: authority.optional(),
  })
  .refine(
    ({ drafter, reviewer, panel_reviewer }) =>
      drafter.route.provider !== reviewer.route.provider &&
      drafter.route.model !== reviewer.route.model &&
      (!panel_reviewer ||
        (panel_reviewer.route.provider !== drafter.route.provider &&
          panel_reviewer.route.model !== reviewer.route.model &&
          panel_reviewer.route.model !== drafter.route.model)),
  );
export type SpecPlanningConfig = z.infer<typeof specPlanningConfig>;
export type SpecAccount = z.infer<typeof authority>;

export const specHostAnswer = z.strictObject({
  run_id: specRunId,
  action_sha256: digest,
  selected: z.array(id),
  freeform: z.string(),
});
export type SpecHostAnswer = z.infer<typeof specHostAnswer>;

const modelReceipt = z.object({
  invocation_id: id,
  raw_text: z.string().optional(),
  error: z.string().optional(),
  model_receipt: specRoute.optional(),
});
export const specHostJournal = z.strictObject({
  version: z.literal(1),
  config_sha256: digest,
  run_id: specRunId.optional(),
  terminal: z
    .strictObject({
      define_sha256: digest,
      reviewed_plan_sha256: digest,
    })
    .optional(),
  history: z.array(
    z.object({
      action: specHostAction,
      phase: z.enum(['pending', 'dispatching', 'submitting', 'acknowledged']),
      reservations: z.array(id),
      receipts: z.array(modelReceipt),
      result: specHostResult.optional(),
    }),
  ),
});
export type SpecHostJournal = z.infer<typeof specHostJournal>;
