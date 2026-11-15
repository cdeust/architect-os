import type { TaskRouter } from '../application/task-router.js';
import type { Identity, ServiceClient, ServiceResponse } from '../domain/ports.js';

/**
 * The services of the clients' front, reached through the task router (docs/design/platform-v3-srt.md, §2): one task
 * per call, opened for the authenticated subject, ended whatever the call did. One profile per gateway for now (the
 * only committed client profile is `owner`, topology/clients.json); a profile per client belongs to brick 2.
 * An answer whose task cannot be ended is not returned: the refusal of `complete` is, so a client may see a refusal
 * after the effect of its call (a memory written), and call again.
 */
export class RouterServices implements ServiceClient {
  constructor(
    private readonly router: Pick<TaskRouter, 'open' | 'call' | 'complete'>,
    private readonly profile: string,
  ) {}

  async invoke(
    service: string,
    tool: string,
    args: Record<string, unknown>,
    identity: Identity,
  ): Promise<ServiceResponse> {
    const { task } = await this.router.open(identity.subject, this.profile);
    let response;
    try {
      response = await this.router.call({ task }, `${service}.${tool}`, args);
    } catch (error) {
      // The router may already have ended the task on a bound: the call's refusal is the one that propagates.
      await this.router.complete(task).catch(() => undefined);
      throw error;
    }
    await this.router.complete(task);
    return response;
  }
}
