import { randomUUID } from 'node:crypto';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { DataOpInput, DataOpName, TaskEnding } from '@architect-os/contracts';
import { GatewayError } from '../domain/errors.js';
import type { ServiceResponse } from '../domain/ports.js';
import type { DataClient, Ids, TaskRegistry } from '../domain/routing.js';

/** The MCP client of data, as the adapters of data use it. */
export type DataCaller = Pick<Client, 'callTool'>;
type Caller = DataCaller;

/**
 * An answer of a `tools/call` as the gateway forwards it: its structured content, the text of its first content when
 * that is text (empty otherwise), and its error flag (node_modules/@modelcontextprotocol/sdk/dist/esm/types.d.ts,
 * `CallToolResultSchema`).
 */
export function toResponse(response: Record<string, unknown>): ServiceResponse {
  const first = (response.content as { type: string; text?: string }[])[0];
  return {
    structured: response.structuredContent as Record<string, unknown> | undefined,
    text: first?.type === 'text' ? String(first.text) : '',
    isError: response.isError === true,
  };
}

/**
 * One operation of data over its MCP server (data/src/presentation/mcp-server.ts): its answer, untouched. Data is
 * unavailable when the `tools/call` fails or when data answers INTERNAL (its store unreachable), as for usage
 * (src/infrastructure/usage-adapters.ts, McpUsageSink).
 */
async function operate(
  data: Caller,
  op: DataOpName,
  args: Record<string, unknown>,
): Promise<ServiceResponse> {
  let response;
  try {
    response = await data.callTool({ name: op, arguments: args });
  } catch (error) {
    throw new GatewayError('SERVICE_UNAVAILABLE', `data did not answer ${op}: ${String(error)}`);
  }
  const answer = toResponse(response);
  if (answer.isError && answer.structured?.['code'] === 'INTERNAL')
    throw new GatewayError('SERVICE_UNAVAILABLE', `data cannot reach its store for ${op}`);
  return answer;
}

/** The data operations of the modules that call back, forwarded to data; a refusal of data is an answer. */
export class McpDataClient implements DataClient {
  constructor(private readonly data: Caller) {}

  execute(op: DataOpName, args: Record<string, unknown>): Promise<ServiceResponse> {
    return operate(this.data, op, args);
  }
}

/** The tasks of the registry, by `tasks.open` and `tasks.end` of data; a refusal of data is an error. */
export class McpTaskRegistry implements TaskRegistry {
  constructor(private readonly data: Caller) {}

  async open(task: DataOpInput<'tasks.open'>): Promise<void> {
    await this.write('tasks.open', task);
  }

  async end(task: string, ending: TaskEnding): Promise<void> {
    await this.write('tasks.end', { task, ending });
  }

  private async write(op: DataOpName, args: Record<string, unknown>): Promise<void> {
    const answer = await operate(this.data, op, args);
    if (answer.isError) throw new Error(`data refused ${op}: ${answer.text}`);
  }
}

/** Opaque identifiers, random, without cryptography (§2): `<kind>-<uuid>`. */
export class RandomIds implements Ids {
  next(kind: 'task' | 'token' | 'call'): string {
    return `${kind}-${randomUUID()}`;
  }
}
