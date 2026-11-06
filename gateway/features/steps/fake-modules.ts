import { PassThrough } from 'node:stream';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { Sandbox, SandboxExit, SandboxRequest, SandboxRunner } from '@architect-os/sandbox';

/** A call a fake module received: its tool, its arguments and the call identifier of its `_meta`. */
export interface Received {
  module: string;
  tool: string;
  args: unknown;
  call: unknown;
  /** The client of the gateway, as the module sees it at initialization. */
  client: unknown;
}

/**
 * A SandboxRunner whose sandboxes are fake modules: a real MCP server of the SDK on the stdio of the sandbox, in this
 * process. A module answers its name, its tool and its arguments; a hanging module waits until its call is cancelled.
 * The module is named by the path of its server in topology/modules.mcp.json, `modules/<name>/…`.
 */
export class FakeModuleRunner implements SandboxRunner {
  readonly started: string[] = [];
  readonly received: Received[] = [];
  /** The calls whose `notifications/cancelled` reached the module. */
  readonly cancelled: unknown[] = [];
  readonly hanging = new Set<string>();
  /** What a module answers instead of its name, its tool and its arguments. */
  readonly answers = new Map<string, Record<string, unknown>>();
  /** Launches still to fail, per module: the sandbox ends before its server answers. */
  readonly failing = new Map<string, number>();
  /** Launches still to write what is not MCP on stdout, per module: the sandbox stays up until it is stopped. */
  readonly garbling = new Map<string, number>();
  /** The modules whose sandbox ended, in order. */
  readonly ended: string[] = [];
  private readonly live = new Map<string, () => void>();

  async start(request: SandboxRequest): Promise<Sandbox> {
    const module = /modules\/([^/]+)\//.exec(request.command.join(' '))?.[1] ?? '?';
    this.started.push(module);
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    let finish: (exit: SandboxExit) => void = () => {};
    const exited = new Promise<SandboxExit>((done) => {
      let over = false;
      finish = (exit) => {
        if (over) return;
        over = true;
        this.ended.push(module);
        stdout.end();
        done(exit);
      };
    });
    const sandbox: Sandbox = {
      stdin,
      stdout,
      stderr: new PassThrough(),
      exited,
      stop: async () => {
        finish({ code: null, signal: 'SIGTERM' });
        return exited;
      },
    };
    const failures = this.failing.get(module) ?? 0;
    if (failures > 0) {
      this.failing.set(module, failures - 1);
      finish({ code: 1, signal: null });
      return sandbox;
    }
    const garbles = this.garbling.get(module) ?? 0;
    if (garbles > 0) {
      this.garbling.set(module, garbles - 1);
      stdin.once('data', () => stdout.write('this is not MCP\n'));
      return sandbox;
    }
    const server = new Server({ name: module, version: '0.0.0' }, { capabilities: { tools: {} } });
    server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      const { name, arguments: args, _meta } = request.params;
      this.received.push({
        module,
        tool: name,
        args,
        call: _meta?.['call'],
        client: server.getClientVersion(),
      });
      if (this.hanging.has(module))
        await new Promise<void>((resolve) =>
          extra.signal.addEventListener('abort', () => {
            this.cancelled.push(_meta?.['call']);
            resolve();
          }),
        );
      return (
        this.answers.get(module) ?? {
          content: [{ type: 'text', text: `${module}/${name} ${JSON.stringify(args)}` }],
        }
      );
    });
    await server.connect(new StdioServerTransport(stdin, stdout));
    this.live.set(module, () => finish({ code: null, signal: 'SIGKILL' }));
    return sandbox;
  }

  /** Kills the sandbox of a module, as a crash would. */
  kill(module: string): void {
    this.live.get(module)?.();
  }
}
