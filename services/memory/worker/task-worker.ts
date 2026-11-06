import {
  TOOLS,
  TaskInputSchema,
  ZERO_COST,
  type Cost,
  type Evidence,
  type WorkerOutput,
} from '@architect-os/contracts';
import { z } from 'zod';
import type { AgentProfile } from './agent-file.js';

/**
 * The gateway as the worker of an agent tool sees it, on its own stdin and stdout (docs/design/platform-v3-srt.md, §2,
 * Un seul transport, brick 1b.5): the input of its call, the relay of its calls under the identifier of that call, and
 * its output, given once. The adapter is infrastructure/platform-channel.ts.
 */
export interface PlatformChannel {
  input(): Promise<unknown>;
  /** The text of the answer of a module tool at its address `<domain>.<tool>`, and whether it is a refusal. */
  relay(address: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }>;
  complete(output: WorkerOutput): Promise<void>;
}

/** One run of the agent of a task profile (agents/<name>.md) for one call. */
export interface AgentRun {
  readonly tool: string;
  readonly input: unknown;
  readonly agent: AgentProfile;
  /** JSON Schema the structured output must satisfy: the data contract of the tool. */
  readonly outputSchema: Record<string, unknown>;
  readonly maxTurns: number;
  readonly relay: PlatformChannel['relay'];
}

/** What the agent gives: its structured output and the records it read, or the stop of the SDK at its max_turns. */
export type AgentEnd =
  | {
      readonly maxTurnsReached?: undefined;
      readonly structured: unknown;
      readonly evidence: Evidence[];
      readonly cost: Cost;
    }
  | { readonly maxTurnsReached: true; readonly cost: Cost };

/** Port to the agent runtime: the Agent SDK adapter is infrastructure/sdk-task-agent.ts; tests script one. */
export interface TaskAgent {
  run(run: AgentRun): Promise<AgentEnd>;
}

/** The code the gateway reads as the SDK stopping the agent at its max_turns (gateway, worker-session.ts). */
export const MAX_TURNS_CODE = 'MAX_TURNS_EXCEEDED';

/** The bounds of an evidence and of a list of them (decision 3, packages/contracts/src/result.ts). */
export const EVIDENCE_BOUNDS = { items: 50, source: 64, ref: 256, excerpt: 2000 } as const;

const failed = (code: string, message: string, cost: Cost = ZERO_COST): WorkerOutput => ({
  status: 'failed',
  data: null,
  evidence: [],
  cost,
  error: { code, message },
});

/** The evidence of a run within its bounds: the first 50, each field cut at its length, nothing rejected. */
export function bounded(evidence: readonly Evidence[]): Evidence[] {
  return evidence.slice(0, EVIDENCE_BOUNDS.items).map((item) => ({
    source: item.source.slice(0, EVIDENCE_BOUNDS.source),
    ref: item.ref.slice(0, EVIDENCE_BOUNDS.ref),
    ...(item.excerpt === undefined ? {} : { excerpt: item.excerpt.slice(0, EVIDENCE_BOUNDS.excerpt) }),
  }));
}

/**
 * Serves one call: takes its input, runs the agent of its task profile, and gives its output once. Every failure is an
 * output with a named code, never an exception through the channel: an input that breaks its contract, a tool without
 * contract, the agent stopped at its max_turns, or the agent failing.
 */
export async function serveTask(
  channel: PlatformChannel,
  agent: TaskAgent,
  profile: AgentProfile,
): Promise<void> {
  await channel.complete(await outputOf(channel, agent, profile));
}

async function outputOf(
  channel: PlatformChannel,
  agent: TaskAgent,
  profile: AgentProfile,
): Promise<WorkerOutput> {
  const parsed = TaskInputSchema.safeParse(await channel.input());
  if (!parsed.success) return failed('WORKER_FAILED', parsed.error.message);
  const { tool, input, limits } = parsed.data;
  const contract = Object.hasOwn(TOOLS, tool) ? TOOLS[tool as keyof typeof TOOLS] : undefined;
  if (contract === undefined) return failed('WORKER_FAILED', `no contract for ${tool}`);
  let end: AgentEnd;
  try {
    end = await agent.run({
      tool,
      input,
      agent: profile,
      // draft-07: Claude Code refuses the `$schema` of draft 2020-12, zod's default ("--json-schema is not a valid
      // JSON Schema: no schema with key or ref", features/integration/agent-worker.feature).
      outputSchema: z.toJSONSchema(contract.data, { target: 'draft-07' }) as Record<string, unknown>,
      maxTurns: limits.max_turns,
      relay: (address, args) => channel.relay(address, args),
    });
  } catch (error) {
    return failed('WORKER_FAILED', error instanceof Error ? error.message : String(error));
  }
  if (end.maxTurnsReached) return failed(MAX_TURNS_CODE, `stopped at ${limits.max_turns} turns`, end.cost);
  return { status: 'ok', data: end.structured, evidence: bounded(end.evidence), cost: end.cost };
}
