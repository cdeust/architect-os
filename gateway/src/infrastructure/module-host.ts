import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { ModulesMcpJson } from '@architect-os/contracts';
import type { Sandbox, SandboxRunner } from '@architect-os/sandbox';
import { GatewayError } from '../domain/errors.js';
import type { ServiceResponse } from '../domain/ports.js';
import type { ModuleCall, ModuleClient } from '../domain/routing.js';
import { toResponse } from './mcp-routing.js';
import { StreamClientTransport } from './stream-transport.js';

/** Where the modules run: the sandbox profile and the working directory of every module of topology/modules.mcp.json. */
export interface ModuleLaunch {
  profile: string;
  cwd: string;
}

/** A module launched: its client, until its sandbox ends. */
interface Link {
  client: Client;
  sandbox: Sandbox;
  alive: boolean;
}

/**
 * The modules of topology/modules.mcp.json, each a child of the gateway in its sandbox, its MCP server on stdio
 * (docs/design/platform-v3-srt.md, §2, Un seul transport, brick 1b.4). A module is launched at its first call; a module
 * whose sandbox ended is launched again at its next call. A module shared between tasks is relaunched: what is never
 * relaunched is the sandbox of a task. After `relaunches` launches in a row without an answer, the module is
 * unavailable for the life of the gateway: SERVICE_UNAVAILABLE.
 *
 * A call carries its call identifier in `_meta.call`, and its deadline as the `signal` and the `timeout` of the request
 * (node_modules/@modelcontextprotocol/sdk/dist/esm/shared/protocol.d.ts, `RequestOptions`): an aborted call sends
 * `notifications/cancelled` to the module.
 */
export class ModuleHost implements ModuleClient {
  private readonly links = new Map<string, Link>();
  /** Launches since the last answer, per module. */
  private readonly failures = new Map<string, number>();
  /** The launch under way, per module: calls that arrive meanwhile wait for it instead of launching again. */
  private readonly launching = new Map<string, Promise<Link>>();
  /** Once closed, no module is launched any more. */
  private closed = false;

  constructor(
    private readonly servers: ModulesMcpJson,
    private readonly runner: SandboxRunner,
    private readonly launch: ModuleLaunch,
    private readonly relaunches = 3,
  ) {}

  async call(call: ModuleCall): Promise<ServiceResponse> {
    const link = await this.linked(call.module);
    let response;
    try {
      response = await link.client.callTool(
        { name: call.tool, arguments: call.args, _meta: { call: call.call } },
        undefined,
        { signal: call.signal, timeout: call.timeoutMs },
      );
    } catch (error) {
      // A call cancelled by its deadline or its task gets its refusal from the router (TaskRouter, `cancelled`).
      throw new GatewayError('SERVICE_UNAVAILABLE', `module ${call.module} did not answer: ${String(error)}`);
    }
    this.failures.set(call.module, 0);
    return toResponse(response);
  }

  /**
   * Stops every module, the ones being launched included: their groups are killed (`kill(-pgid)`). No module is
   * launched afterwards.
   */
  async close(): Promise<void> {
    this.closed = true;
    await Promise.allSettled([...this.launching.values()]);
    // Every stop is awaited whatever another did; the first that failed then rejects.
    const failures: unknown[] = [];
    await Promise.all(
      [...this.links.values()].map((link) =>
        link.sandbox.stop().catch((error: unknown) => failures.push(error)),
      ),
    );
    if (failures.length > 0) throw failures[0];
  }

  /** The link of a module, launched again when its sandbox ended. */
  private async linked(module: string): Promise<Link> {
    const link = this.links.get(module);
    if (link?.alive === true) return link;
    const pending = this.launching.get(module) ?? this.relaunch(module);
    this.launching.set(module, pending);
    try {
      return await pending;
    } finally {
      this.launching.delete(module);
    }
  }

  private async relaunch(module: string): Promise<Link> {
    const server = this.servers.mcpServers[module];
    if (server === undefined) throw new GatewayError('SERVICE_UNAVAILABLE', `no server for ${module}`);
    for (;;) {
      if (this.closed) throw shuttingDown();
      const failures = this.failures.get(module) ?? 0;
      if (failures >= this.relaunches)
        throw new GatewayError(
          'SERVICE_UNAVAILABLE',
          `module ${module} failed ${failures} launches in a row`,
        );
      this.failures.set(module, failures + 1);
      const launched = await this.start(module, [server.command, ...server.args]).catch(() => undefined);
      if (launched !== undefined) return launched;
    }
  }

  private async start(module: string, command: string[]): Promise<Link> {
    const sandbox = await this.runner.start({ profile: this.launch.profile, cwd: this.launch.cwd, command });
    const client = new Client({ name: 'architect-os-gateway', version: '0.1.0' });
    const link: Link = { client, sandbox, alive: true };
    void sandbox.exited.then(() => (link.alive = false));
    try {
      await client.connect(new StreamClientTransport(sandbox.stdout, sandbox.stdin));
    } catch (error) {
      await sandbox.stop();
      throw error;
    }
    this.links.set(module, link);
    return link;
  }
}

const shuttingDown = () => new GatewayError('SERVICE_UNAVAILABLE', 'the gateway is shutting down');
