import type { DataOpName, TaskEnding, DataOpInput } from '@architect-os/contracts';
import type { ServiceResponse, TaskGrant } from './ports.js';

/**
 * The ports of the routing of a task (docs/design/platform-v3-srt.md, §2, Identifiant d'appel and Bornes
 * opérationnelles, brick 1b.4). Each has an in-memory adapter (src/infrastructure/in-memory-routing.ts).
 */

/** One `tools/call` to a module: its call identifier goes in `_meta`, its deadline is `timeoutMs` and `signal`. */
export interface ModuleCall {
  module: string;
  tool: string;
  args: Record<string, unknown>;
  call: string;
  timeoutMs: number;
  signal: AbortSignal;
}

/** Port: the modules, children of the gateway on stdio. Rejects with GatewayError SERVICE_UNAVAILABLE when unreachable. */
export interface ModuleClient {
  call(call: ModuleCall): Promise<ServiceResponse>;
}

/** Port: the typed operations of data, for the modules that call back. */
export interface DataClient {
  execute(op: DataOpName, args: Record<string, unknown>): Promise<ServiceResponse>;
}

/** Port: the tasks of the registry (data, `tasks.*`): opened once, ended once with their reason. */
export interface TaskRegistry {
  open(task: DataOpInput<'tasks.open'>): Promise<void>;
  end(task: string, ending: TaskEnding): Promise<void>;
}

/** Port: the token of a task at the broker; the UsageForwarder, which re-grants them at the return of data. */
export interface TaskTokens {
  grant(grant: TaskGrant): Promise<void>;
  retire(token: string): Promise<void>;
}

/** Port: the sandboxes of a task (its process groups, `kill(-pgid)`); a module, shared between tasks, is not one. */
export interface TaskSandboxes {
  stop(task: string): Promise<void>;
}

/** Port: opaque identifiers, random, without cryptography (§2): `${kind}-…`. */
export interface Ids {
  next(kind: 'task' | 'token' | 'call'): string;
}
