import { createHash } from 'node:crypto';
import {
  parseReviewedPlanReply,
  specActionPage,
  specRunId,
  type SpecAccount,
  type SpecHostAction,
  type SpecHostAnswer,
  type SpecHostJournal,
  type SpecHostResult,
  type SpecInvocation,
  type SpecPlanningConfig,
  type SpecRoute,
} from '@architect-os/contracts';
import { reviewedProposal } from './verified-proposal.js';

type Tool = 'start_pipeline' | 'submit_action_result' | 'get_pipeline_state';
type Entry = SpecHostJournal['history'][number];
type Batch = Extract<SpecHostAction, { kind: 'spawn_subagents' }>;

export interface SpecHost {
  call(tool: Tool, args: Record<string, unknown>): Promise<string>;
  authorize(account: SpecAccount): Promise<boolean>;
  invoke(
    invocation: SpecInvocation,
    account: SpecAccount,
  ): Promise<{
    text: string;
    route: SpecRoute;
    account: string;
    billing: 'subscription';
  }>;
  load(): SpecHostJournal | undefined;
  save(state: SpecHostJournal): void;
  readArtifact(path: string): Uint8Array;
  writeArtifact(path: string, content: string): void;
}

export const actionDigest = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fileDigest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const matches = (a: SpecRoute, b: SpecRoute) => a.provider === b.provider && a.model === b.model;
const accountKey = ({ route, account }: SpecAccount) => JSON.stringify([route.provider, account]);

function runId(text: string) {
  return specRunId.parse(JSON.parse(text)?.run_id);
}

async function pendingAction(host: SpecHost, run_id: string): Promise<SpecHostAction> {
  const request = async (invocation_offset: number) =>
    specActionPage.parse(
      JSON.parse(await host.call('get_pipeline_state', { run_id, format: 'action', invocation_offset })),
    );
  const page = await request(0);
  if (page.run_id !== run_id || page.__page.offset !== 0) throw Error('SPEC_ACTION_RUN_MISMATCH');
  if (page.action.kind !== 'spawn_subagents') {
    if (page.__page.next_offset !== null) throw Error('SPEC_ACTION_PAGE_INVALID');
    return page.action;
  }
  const batch = { ...page.action, invocations: [] as SpecInvocation[] };
  const total = page.__page.total;
  let action = page.action;
  let paging = page.__page;
  for (;;) {
    if (paging.count !== action.invocations.length || paging.total !== total)
      throw Error('SPEC_ACTION_PAGE_INVALID');
    batch.invocations.push(...action.invocations);
    const offset = paging.next_offset;
    if (offset === null) break;
    if (offset !== batch.invocations.length || offset >= total) throw Error('SPEC_ACTION_PAGE_INVALID');
    const next = await request(offset);
    if (next.run_id !== run_id || next.__page.offset !== offset) throw Error('SPEC_ACTION_PAGE_CHANGED');
    switch (next.action.kind) {
      case 'spawn_subagents':
        if (next.action.batch_id !== batch.batch_id || next.action.purpose !== batch.purpose)
          throw Error('SPEC_ACTION_PAGE_CHANGED');
        action = next.action;
        paging = next.__page;
        break;
      default:
        throw Error('SPEC_ACTION_PAGE_CHANGED');
    }
  }
  if (
    batch.invocations.length !== total ||
    new Set(batch.invocations.map((item) => item.invocation_id)).size !== total
  )
    throw Error('SPEC_ACTION_PAGE_INVALID');
  return batch;
}

function authorizedAccounts(config: SpecPlanningConfig) {
  const accounts = [
    config.drafter,
    config.reviewer,
    ...(config.panel_reviewer ? [config.panel_reviewer] : []),
  ];
  const limits = new Map<string, number>();
  for (const account of accounts) {
    const key = accountKey(account);
    if (limits.has(key) && limits.get(key) !== account.quota) throw Error('SPEC_ACCOUNT_QUOTA_CONFLICT');
    limits.set(key, account.quota);
  }
  return { accounts, limits };
}

async function dispatchBatch(
  host: SpecHost,
  state: SpecHostJournal,
  entry: Entry,
  action: Batch,
  { accounts, limits }: ReturnType<typeof authorizedAccounts>,
): Promise<SpecHostResult> {
  if (entry.phase === 'dispatching') {
    const receipts = new Map(entry.receipts.map((receipt) => [receipt.invocation_id, receipt]));
    const responses = action.invocations.map(({ invocation_id }) => receipts.get(invocation_id));
    if (entry.receipts.length !== responses.length || !responses.every((reply) => reply !== undefined)) {
      throw Error('SPEC_INVOCATION_OUTCOME_UNKNOWN');
    }
    return { kind: 'subagent_batch_result', batch_id: action.batch_id, responses };
  }
  const selected = action.invocations.map((item) =>
    item.model === item.model_route.model
      ? accounts.find((account) => matches(account.route, item.model_route))
      : undefined,
  );
  const checked = selected.filter((account): account is SpecAccount => account !== undefined);
  const counts = new Map<string, number>();
  for (const key of [...state.history.flatMap((record) => record.reservations), ...checked.map(accountKey)])
    counts.set(key, (counts.get(key) ?? 0) + 1);
  const refused =
    checked.length !== selected.length ||
    [...counts].some(([key, count]) => count > (limits.get(key) ?? 0)) ||
    !(await Promise.all(checked.map((account) => host.authorize(account).catch(() => undefined)))).every(
      Boolean,
    );
  if (refused)
    return {
      kind: 'subagent_batch_result',
      batch_id: action.batch_id,
      responses: action.invocations.map(({ invocation_id }) => ({
        invocation_id,
        error: 'SPEC_ACCOUNT_OR_QUOTA_REFUSED',
      })),
    };
  entry.phase = 'dispatching';
  entry.reservations = checked.map(accountKey);
  host.save(state);
  let journalFailure: { error: unknown } | undefined;
  const turns = action.invocations.map(async (invocation, index) => {
    const account = checked[index]!;
    const response = await Promise.resolve()
      .then(() => host.invoke(invocation, account))
      .then((reply) => {
        if (
          reply.account !== account.account ||
          reply.billing !== account.billing ||
          !matches(reply.route, account.route) ||
          !reply.text.trim()
        )
          return { invocation_id: invocation.invocation_id, error: 'SPEC_NATIVE_RECEIPT_REFUSED' };
        return {
          invocation_id: invocation.invocation_id,
          raw_text: reply.text,
          model_receipt: reply.route,
        };
      })
      .catch(() => ({ invocation_id: invocation.invocation_id, error: 'SPEC_NATIVE_RECEIPT_REFUSED' }));
    if (!journalFailure) {
      entry.receipts.push(response);
      try {
        host.save(state);
      } catch (error) {
        journalFailure = { error };
      }
    }
    return response;
  });
  // The journal owns the whole batch even if one turn rejects; wait for every turn before returning its error.
  await Promise.allSettled(turns);
  if (journalFailure) throw journalFailure.error;
  return { kind: 'subagent_batch_result', batch_id: action.batch_id, responses: await Promise.all(turns) };
}

function artifactPath(run: string, path: string) {
  const parts = path.split('/');
  if (
    parts.length !== 3 ||
    parts[0] !== 'prd-output' ||
    parts[1] !== run.slice(0, 8) ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(parts[2]!)
  )
    throw Error('SPEC_ARTIFACT_PATH_REFUSED');
  return parts[2]!;
}

export async function driveSpec(
  host: SpecHost,
  config: SpecPlanningConfig,
  resume: boolean,
  answer?: SpecHostAnswer,
) {
  const authority = authorizedAccounts(config);
  const digest = actionDigest(config);
  const existing = host.load();
  if (Boolean(existing) !== resume || (existing && existing.config_sha256 !== digest))
    throw Error('SPEC_RUN_JOURNAL_MISMATCH');
  const state: SpecHostJournal = existing ?? { version: 1, config_sha256: digest, history: [] };
  if (!existing) {
    host.save(state);
    const { feature_description, plan_step, prd_context, request_size } = config;
    state.run_id = runId(
      await host.call('start_pipeline', { feature_description, plan_step, prd_context, request_size }),
    );
    host.save(state);
  }
  if (!state.run_id) throw Error('SPEC_START_OUTCOME_UNKNOWN');
  const run_id = state.run_id;
  const reviewedOutcome = { status: 'reviewed' as const, run_id, step: config.plan_step };
  if (state.terminal) {
    if (
      fileDigest(host.readArtifact('define.json')) !== state.terminal.define_sha256 ||
      fileDigest(host.readArtifact('reviewed-plan.json')) !== state.terminal.reviewed_plan_sha256
    ) {
      throw Error('SPEC_TERMINAL_ARTIFACT_CHANGED');
    }
    return reviewedOutcome;
  }
  for (;;) {
    const action = await pendingAction(host, run_id);
    const sha = actionDigest(action);
    let entry = state.history.at(-1);
    if (entry?.phase === 'submitting') {
      if (actionDigest(entry.action) === sha) throw Error('SPEC_SUBMISSION_OUTCOME_UNKNOWN');
      entry.phase = 'acknowledged';
    }
    if (!entry || entry.phase === 'acknowledged') {
      // A new entry follows acknowledgment of its predecessor. An earlier matching batch cannot run again.
      if (
        action.kind === 'spawn_subagents' &&
        state.history.some(({ action: prior }) => actionDigest(prior) === sha)
      ) {
        throw Error('SPEC_ACKNOWLEDGED_BATCH_REISSUED');
      }
      entry = { action, phase: 'pending', reservations: [], receipts: [] };
      state.history.push(entry);
      host.save(state);
    } else if (actionDigest(entry.action) !== sha) {
      throw Error('SPEC_PENDING_ACTION_CHANGED');
    }

    if (action.kind === 'failed') return { status: 'failed' as const, run_id, action };
    if (action.kind === 'done') {
      if (action.outcome.status === 'needs_attention')
        return { status: 'needs_attention' as const, run_id, action };
      // Spec signs the compact JSON file with its LF, while the MCP text part omits the LF.
      const define = (await host.call('get_pipeline_state', { run_id, format: 'define_handoff_v1' })) + '\n';
      const proposal = await host.call('get_pipeline_state', {
        run_id,
        format: 'reviewed_plan_v1',
        plan_step: config.plan_step,
      });
      const content = [{ type: 'text', text: proposal }];
      const { reviewed_plan: plan, define_review: scope } = parseReviewedPlanReply(content);
      if (
        !matches(plan.drafter, config.drafter.route) ||
        !matches(plan.reviewer, config.reviewer.route) ||
        !matches(scope.drafter, config.drafter.route) ||
        !matches(scope.reviewer, config.reviewer.route)
      ) {
        throw Error('SPEC_PROJECTION_ROUTE_MISMATCH');
      }
      const reviewed = reviewedProposal(Buffer.from(define), run_id, config.plan_step, content);
      host.writeArtifact('define.json', define);
      host.writeArtifact('reviewed-plan.json', reviewed);
      state.terminal = {
        define_sha256: fileDigest(define),
        reviewed_plan_sha256: fileDigest(reviewed),
      };
      host.save(state);
      return reviewedOutcome;
    }

    let result = entry.result;
    if (!result) {
      if (action.kind === 'ask_user') {
        if (!answer) return { status: 'question' as const, run_id, action_sha256: sha, action };
        if (answer.run_id !== run_id || answer.action_sha256 !== sha) throw Error('SPEC_ANSWER_MISMATCH');
        result = {
          kind: 'user_answer',
          question_id: action.question_id,
          selected: answer.selected,
          freeform: answer.freeform,
        };
        answer = undefined;
      } else if (action.kind === 'write_file') {
        host.writeArtifact(artifactPath(run_id, action.path), action.content);
        result = { kind: 'file_written', path: action.path, bytes: Buffer.byteLength(action.content) };
      } else {
        result = await dispatchBatch(host, state, entry, action, authority);
      }
    }
    entry.result = result;
    host.save(state);
    entry.phase = 'submitting';
    host.save(state);
    const submitted = runId(await host.call('submit_action_result', { run_id, result }));
    if (submitted !== run_id) throw Error('SPEC_ACTION_RUN_MISMATCH');
    entry.phase = 'acknowledged';
    host.save(state);
  }
}
