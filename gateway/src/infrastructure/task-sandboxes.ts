import type { Sandbox } from '@architect-os/sandbox';
import type { TaskSandboxes } from '../domain/routing.js';

/**
 * The sandboxes of each task (its worker, brick 1b.5), stopped with the task: `stop` kills each process group
 * (`kill(-pgid)`, packages/sandbox, `Sandbox.stop`). A sandbox of a task is never launched again: the task has ended.
 */
export class TaskSandboxGroups implements TaskSandboxes {
  private readonly groups = new Map<string, Sandbox[]>();

  add(task: string, sandbox: Sandbox): void {
    this.groups.set(task, [...(this.groups.get(task) ?? []), sandbox]);
  }

  async stop(task: string): Promise<void> {
    const sandboxes = this.groups.get(task) ?? [];
    this.groups.delete(task);
    await Promise.all(sandboxes.map((sandbox) => sandbox.stop()));
  }
}
