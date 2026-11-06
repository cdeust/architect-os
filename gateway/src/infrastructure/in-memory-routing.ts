import type { DataOpName, TaskEnding, DataOpInput } from '@architect-os/contracts';
import type { Clock, Scheduler, ServiceResponse, TaskGrant } from '../domain/ports.js';
import type {
  DataClient,
  Ids,
  ModuleCall,
  ModuleClient,
  TaskRegistry,
  TaskSandboxes,
  TaskTokens,
} from '../domain/routing.js';

const answer = (text: string): ServiceResponse => ({ structured: undefined, text, isError: false });

/** What a module does with a call, in a scenario. */
export type ModuleBehaviour = (call: ModuleCall) => Promise<ServiceResponse>;

/** The modules of a scenario: each answers its name, its tool and its arguments, unless it is given a behaviour. */
export class InMemoryModules implements ModuleClient {
  readonly behaviours = new Map<string, ModuleBehaviour>();

  async call(call: ModuleCall): Promise<ServiceResponse> {
    const behaviour = this.behaviours.get(call.module);
    return behaviour === undefined
      ? answer(`${call.module}/${call.tool} ${JSON.stringify(call.args)}`)
      : behaviour(call);
  }
}

/** Data of a scenario: answers the operation and its arguments. */
export class InMemoryDataClient implements DataClient {
  async execute(op: DataOpName, args: Record<string, unknown>): Promise<ServiceResponse> {
    return answer(`${op} ${JSON.stringify(args)}`);
  }
}

/** The registry of a scenario: the tasks opened and the ends written, in order; unavailable, as data down. */
export class InMemoryTaskRegistry implements TaskRegistry {
  readonly opened: DataOpInput<'tasks.open'>[] = [];
  readonly ended: { task: string; ending: TaskEnding }[] = [];
  /** The failure of data, while it is down. */
  unavailable: Error | undefined;

  async open(task: DataOpInput<'tasks.open'>): Promise<void> {
    this.opened.push(task);
  }

  async end(task: string, ending: TaskEnding): Promise<void> {
    if (this.unavailable !== undefined) throw this.unavailable;
    this.ended.push({ task, ending });
  }
}

/** The tokens of a scenario: granted and retired, in order. */
export class InMemoryTaskTokens implements TaskTokens {
  readonly granted: TaskGrant[] = [];
  readonly retired: string[] = [];

  async grant(grant: TaskGrant): Promise<void> {
    this.granted.push(grant);
  }

  async retire(token: string): Promise<void> {
    this.retired.push(token);
  }
}

/** The sandboxes of a scenario: the tasks whose groups were stopped, in order. */
export class InMemoryTaskSandboxes implements TaskSandboxes {
  readonly stopped: string[] = [];

  async stop(task: string): Promise<void> {
    this.stopped.push(task);
  }
}

/** Identifiers of a scenario: `<kind>-1`, `<kind>-2`, … per kind. */
export class SequentialIds implements Ids {
  private readonly counts = new Map<string, number>();

  next(kind: 'task' | 'token' | 'call'): string {
    const count = (this.counts.get(kind) ?? 0) + 1;
    this.counts.set(kind, count);
    return `${kind}-${count}`;
  }
}

/** The time of a scenario: it passes when the scenario says, and the work due runs in the order it falls due. */
export class ManualTime implements Clock, Scheduler {
  private current: number;
  private readonly pending = new Set<{ at: number; work: () => void }>();

  constructor(start: Date) {
    this.current = start.getTime();
  }

  now(): Date {
    return new Date(this.current);
  }

  after(ms: number, work: () => void): void {
    this.pending.add({ at: this.current + ms, work });
  }

  /** Lets `ms` pass: each work due runs at its time, earliest first, work scheduled meanwhile included. */
  pass(ms: number): void {
    const until = this.current + ms;
    for (;;) {
      const due = [...this.pending].filter((item) => item.at <= until).sort((a, b) => a.at - b.at)[0];
      if (due === undefined) break;
      this.pending.delete(due);
      this.current = due.at;
      due.work();
    }
    this.current = until;
  }
}
