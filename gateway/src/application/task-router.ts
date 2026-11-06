import {
  DATA_OPS,
  type ClientProfile,
  type DataOpName,
  type ModuleManifest,
  type TaskEnding,
  type Topology,
} from '@architect-os/contracts';
import { GatewayError, type GatewayErrorCode } from '../domain/errors.js';
import type { AuditLog, Clock, Scheduler, ServiceResponse } from '../domain/ports.js';
import type {
  DataClient,
  Ids,
  ModuleClient,
  TaskRegistry,
  TaskSandboxes,
  TaskTokens,
} from '../domain/routing.js';

/** An open task: the bounds of its profile, its token, its calls so far. Forgotten once it ends. */
interface OpenTask {
  task: string;
  profile: ClientProfile;
  token: string;
  deadline: number;
  calls: number;
}

/** A call in flight, what its identifier stands for (§2, Identifiant d'appel). */
interface Call {
  task: OpenTask;
  module: ModuleManifest;
  depth: number;
  deadline: number;
  abort: AbortController;
  /** Why it was cancelled, once it is. */
  cancelled?: GatewayErrorCode;
}

/** The task and the calling module of a caller; `refusal` when it names no open task nor call in flight. */
interface Origin {
  task?: OpenTask;
  from: Call | null;
  subject: string;
  refusal?: GatewayError;
}

/**
 * Who calls: the client of a task, or a module with the identifier of the call it serves. The presentation resolves the
 * task of a client from what the client presented (its token), never from an argument of the call.
 */
export type Caller = { task: string } | { call: string };

/** Who ends a task: the bounds (the gateway), the client that completes it, or the owner that cancels it. */
type Ender = 'gateway' | 'client' | string;

/**
 * Routes the calls of the tasks to the modules of the topology (docs/design/platform-v3-srt.md, §2, brick 1b.4). A
 * call gets a fresh identifier, tied to its task, its module, its depth and its deadline, and invalid once the call
 * returns; a module calls back with it, and the task and the caller come from it, never from an argument. A bound
 * reached or the cancellation by the owner ends the task: its calls in flight are cancelled, its token retired, its
 * sandboxes stopped, its end written to the registry, and it is forgotten. Every call and refusal is audited.
 */
export class TaskRouter {
  private readonly tasks = new Map<string, OpenTask>();
  private readonly calls = new Map<string, Call>();
  private readonly addresses: Map<string, ModuleManifest>;

  constructor(
    private readonly topology: Topology,
    private readonly modules: ModuleClient,
    private readonly data: DataClient,
    private readonly registry: TaskRegistry,
    private readonly tokens: TaskTokens,
    private readonly sandboxes: TaskSandboxes,
    private readonly audit: AuditLog,
    private readonly clock: Clock,
    private readonly scheduler: Scheduler,
    private readonly ids: Ids,
  ) {
    this.addresses = new Map(
      topology.catalog.modules.flatMap((module) =>
        module.tools.map((tool) => [`${module.domain}.${tool.name}`, module] as const),
      ),
    );
  }

  /** Opens a task under a profile of the topology; its deadline ends it. */
  async open(client: string, profileName: string): Promise<{ task: string; token: string }> {
    const profile = this.topology.clients.profiles.find((candidate) => candidate.name === profileName);
    if (profile === undefined) throw new GatewayError('UNKNOWN_PROFILE', `no profile ${profileName}`);
    const task = this.ids.next('task');
    const token = this.ids.next('token');
    const deadline = this.now() + profile.max_duration_ms;
    await this.registry.open({
      task,
      client,
      profile: profile.name,
      deadline_at: new Date(deadline).toISOString(),
    });
    await this.tokens.grant({ token, task });
    this.tasks.set(task, { task, profile, token, deadline, calls: 0 });
    this.scheduler.after(profile.max_duration_ms, () => void this.end(task, 'deadline', 'gateway'));
    return { task, token };
  }

  /** A `tools/call` of a module, at its address `<domain>.<tool>`, by the client of a task or by a module. */
  async call(caller: Caller, address: string, args: Record<string, unknown>): Promise<ServiceResponse> {
    const origin = this.origin(caller);
    return this.journal(
      'task' in caller ? caller.task : origin.task?.task,
      origin.subject,
      address,
      async () => {
        if (origin.refusal !== undefined) throw origin.refusal;
        const task = origin.task!;
        const module = this.addresses.get(address);
        if (module === undefined) throw new GatewayError('UNKNOWN_TOOL', `no module serves ${address}`);
        const allowed = origin.from === null ? task.profile.modules : origin.from.module.calls_allowed;
        if (!allowed.includes(module.name))
          throw new GatewayError('FORBIDDEN_CALL', `${origin.subject} may not call ${module.name}`);
        const depth = (origin.from?.depth ?? 0) + 1;
        if (depth > task.profile.max_depth)
          throw new GatewayError('DEPTH_EXCEEDED', `depth ${depth} beyond ${task.profile.max_depth}`);
        if (task.calls >= task.profile.max_calls) {
          await this.end(task.task, 'max_calls', 'gateway');
          throw new GatewayError('MAX_CALLS_EXCEEDED', `${task.profile.max_calls} calls already`);
        }
        task.calls += 1;
        const now = this.now();
        const deadline = Math.min(origin.from?.deadline ?? task.deadline, now + module.timeout_ms);
        return this.dispatch(task, module, address, args, depth, deadline, now);
      },
    );
  }

  /** A data operation of a module that calls back: refused when it writes a table outside its writes_tables. */
  async operate(call: string, op: string, args: Record<string, unknown>): Promise<ServiceResponse> {
    const origin = this.origin({ call });
    return this.journal(origin.task?.task, origin.subject, op, async () => {
      if (origin.refusal !== undefined) throw origin.refusal;
      const from = origin.from!;
      if (!Object.hasOwn(DATA_OPS, op)) throw new GatewayError('UNKNOWN_TOOL', `no data operation ${op}`);
      const writes: readonly string[] = DATA_OPS[op as DataOpName].writes;
      const outside = writes.filter((table) => !from.module.writes_tables.includes(table));
      if (outside.length > 0)
        throw new GatewayError('FORBIDDEN_WRITE', `${from.module.name} may not write ${String(outside)}`);
      return this.data.execute(op as DataOpName, args);
    });
  }

  /** The client completes its task. */
  async complete(task: string): Promise<void> {
    await this.journal(task, 'client', 'task.complete', async () => {
      if (!(await this.end(task, 'completed', 'client'))) throw unknownTask(task);
    });
  }

  /** The owner cancels a task: the cancellation tool is of the owner's profile alone (§2, Bornes opérationnelles). */
  async cancel(profileName: string, task: string): Promise<void> {
    await this.journal(task, profileName, 'task.cancel', async () => {
      const profile = this.topology.clients.profiles.find((candidate) => candidate.name === profileName);
      if (profile?.owner !== true) throw new GatewayError('FORBIDDEN_CALL', `${profileName} may not cancel`);
      if (!(await this.end(task, 'cancelled', profileName))) throw unknownTask(task);
    });
  }

  /** What a call identifier stands for while its call is in flight; undefined otherwise. */
  describe(id: string): { task: string; module: string; depth: number; deadline: string } | undefined {
    const call = this.calls.get(id);
    if (call === undefined) return undefined;
    const { task, module, depth, deadline } = call;
    return { task: task.task, module: module.name, depth, deadline: new Date(deadline).toISOString() };
  }

  private async dispatch(
    task: OpenTask,
    module: ModuleManifest,
    address: string,
    args: Record<string, unknown>,
    depth: number,
    deadline: number,
    now: number,
  ): Promise<ServiceResponse> {
    const id = this.ids.next('call');
    const call: Call = { task, module, depth, deadline, abort: new AbortController() };
    this.calls.set(id, call);
    this.scheduler.after(deadline - now, () => this.cancelCall(id, 'DEADLINE_EXCEEDED'));
    const tool = address.slice(module.domain.length + 1);
    const signal = call.abort.signal;
    let answer: ServiceResponse;
    try {
      answer = await this.modules.call({
        module: module.name,
        tool,
        args,
        call: id,
        timeoutMs: deadline - now,
        signal,
      });
    } catch (error) {
      throw call.cancelled === undefined ? error : cancelled(id, call.cancelled);
    } finally {
      this.calls.delete(id);
    }
    // A module that answers once its call is cancelled is not routed: its caller has its refusal.
    if (call.cancelled !== undefined) throw cancelled(id, call.cancelled);
    return answer;
  }

  /** Cancels a call in flight: its identifier is invalid, its module sees its signal aborted, its caller gets `code`. */
  private cancelCall(id: string, code: GatewayErrorCode): void {
    const call = this.calls.get(id);
    if (call === undefined) return;
    this.calls.delete(id);
    call.cancelled = code;
    call.abort.abort();
  }

  /**
   * Ends an open task once: its calls cancelled, its token retired, its sandboxes stopped, its end in the registry.
   * The three effects run whatever one of them meets (data down, for the registry): a failure is audited with its
   * code, and the task stays ended for the gateway. False when the task is not open.
   */
  private async end(task: string, ending: TaskEnding, by: Ender): Promise<boolean> {
    const open = this.tasks.get(task);
    if (open === undefined) return false;
    this.tasks.delete(task);
    for (const [id, call] of this.calls) if (call.task === open) this.cancelCall(id, 'TASK_ENDED');
    const effects = await Promise.allSettled([
      this.tokens.retire(open.token),
      this.sandboxes.stop(task),
      this.registry.end(task, ending),
    ]);
    const failed = effects.find((effect) => effect.status === 'rejected');
    await this.audit.record({
      at: this.clock.now().toISOString(),
      task,
      subject: by,
      tool: `task.end:${ending}`,
      owner: null,
      outcome: failed === undefined ? 'ok' : 'error',
      ...(failed === undefined ? {} : { error_code: codeOf(failed.reason) }),
      duration_ms: 0,
    });
    return true;
  }

  /** The task and the calling module of a caller, or its refusal when it names no open task nor call in flight. */
  private origin(caller: Caller): Origin {
    if ('task' in caller) {
      const task = this.tasks.get(caller.task);
      return task === undefined
        ? { from: null, subject: 'client', refusal: unknownTask(caller.task) }
        : { task, from: null, subject: 'client' };
    }
    const from = this.calls.get(caller.call);
    return from === undefined
      ? { from: null, subject: 'unknown', refusal: new GatewayError('UNAUTHORIZED', 'not a call identifier') }
      : { task: from.task, from, subject: from.module.name };
  }

  private now(): number {
    return this.clock.now().getTime();
  }

  /** Runs `work` and audits it, ok or refused with its code. */
  private async journal<T>(
    task: string | undefined,
    subject: string,
    tool: string,
    work: () => Promise<T>,
  ): Promise<T> {
    const started = this.now();
    const entry = {
      ...(task === undefined ? {} : { task }),
      subject,
      tool,
      owner: null,
      at: new Date(started).toISOString(),
    };
    try {
      const value = await work();
      await this.audit.record({ ...entry, outcome: 'ok', duration_ms: this.now() - started });
      return value;
    } catch (error) {
      await this.audit.record({
        ...entry,
        outcome: 'error',
        error_code: codeOf(error),
        duration_ms: this.now() - started,
      });
      throw error;
    }
  }
}

const unknownTask = (task: string) => new GatewayError('UNKNOWN_TASK', `no open task ${task}`);
const cancelled = (id: string, code: GatewayErrorCode) => new GatewayError(code, `call ${id} cancelled`);
const codeOf = (error: unknown): string => (error instanceof GatewayError ? error.code : 'INTERNAL');
