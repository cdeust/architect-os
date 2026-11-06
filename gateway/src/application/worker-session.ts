import {
  ErrorCodeSchema,
  TOOLS,
  WorkerOutputSchema,
  ZERO_COST,
  type Cost,
  type ErrorCode,
  type Result,
} from '@architect-os/contracts';
import { GatewayError } from '../domain/errors.js';
import type { ServiceResponse } from '../domain/ports.js';
import type { WorkerChannel } from '../domain/routing.js';

/** The code a worker gives when the Agent SDK stopped it at its max_turns (services/memory/worker). */
export const MAX_TURNS_CODE = 'MAX_TURNS_EXCEEDED';

const failure = (code: ErrorCode, message: string, task: string, cost: Cost = ZERO_COST): Result<never> => ({
  status: 'failed',
  data: null,
  evidence: [],
  run_id: task,
  cost,
  error: { code, message },
});

/**
 * What the gateway serves a worker on its streams, for one call of an agent tool (docs/design/platform-v3-srt.md, §2,
 * Un seul transport, and §3, step 6): the input of the call, the relay of its calls under the identifier of the call it
 * serves (its identity is this closure, never an argument), and its output, given once and validated against the
 * worker contract, its evidence bounded (decision 3), and the data contract of the tool. A failure is a Result.
 */
export class WorkerSession implements WorkerChannel {
  private output: Result<unknown> | undefined;
  /** Whether the worker said the Agent SDK stopped it at its max_turns. */
  maxTurnsReached = false;

  constructor(
    private readonly task: string,
    private readonly tool: string,
    private readonly args: Record<string, unknown>,
    private readonly maxTurns: number,
    private readonly relayTo: (address: string, args: Record<string, unknown>) => Promise<ServiceResponse>,
  ) {}

  input(): Record<string, unknown> {
    return { tool: this.tool, input: this.args, limits: { max_turns: this.maxTurns } };
  }

  relay(address: string, args: Record<string, unknown>): Promise<ServiceResponse> {
    return this.relayTo(address, args);
  }

  complete(raw: unknown): string {
    if (this.output !== undefined)
      throw new GatewayError('FORBIDDEN_CALL', `the output of ${this.task} ${this.tool} is already given`);
    this.output = this.resultOf(raw);
    return this.output.status;
  }

  /** The Result of the run, once its worker ended: its output, or a failure when it gave none. */
  result(): Result<unknown> {
    return this.output ?? failure('WORKER_FAILED', 'the worker ended without its output', this.task);
  }

  private resultOf(raw: unknown): Result<unknown> {
    const parsed = WorkerOutputSchema.safeParse(raw);
    if (!parsed.success) return failure('WORKER_OUTPUT_INVALID', parsed.error.message, this.task);
    const output = parsed.data;
    if (output.status !== 'ok') {
      this.maxTurnsReached = output.error?.code === MAX_TURNS_CODE;
      const code = ErrorCodeSchema.safeParse(output.error?.code);
      const fallback: ErrorCode = output.status === 'failed' ? 'WORKER_FAILED' : 'NEEDS_CLARIFICATION';
      return {
        status: output.status,
        data: null,
        evidence: output.evidence,
        run_id: this.task,
        cost: output.cost,
        error: {
          code: code.success ? code.data : fallback,
          message: output.error?.message ?? 'the worker gave no message',
        },
      };
    }
    const contract = Object.hasOwn(TOOLS, this.tool) ? TOOLS[this.tool as keyof typeof TOOLS] : undefined;
    if (contract === undefined)
      return failure('WORKER_OUTPUT_INVALID', `no contract for ${this.tool}`, this.task, output.cost);
    const data = contract.data.safeParse(output.data);
    if (!data.success) return failure('WORKER_OUTPUT_INVALID', data.error.message, this.task, output.cost);
    return { status: 'ok', data: data.data, evidence: output.evidence, run_id: this.task, cost: output.cost };
  }
}
