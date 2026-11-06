import { readFile } from 'node:fs/promises';
import type { Readable, Writable } from 'node:stream';
import { parseAgentFile } from './agent-file.js';
import { connectPlatform } from './infrastructure/platform-channel.js';
import { SdkTaskAgent } from './infrastructure/sdk-task-agent.js';
import { serveTask, type TaskAgent } from './task-worker.js';

/**
 * The worker of an agent tool under srt (docs/design/platform-v3-srt.md, §2, brick 1b.5), as topology/modules.mcp.json
 * launches it: `node task-serve.js <agents/<name>.md>`. It serves one call on its stdin and stdout, then returns its
 * exit code. Its stdout is the MCP channel: nothing else is written there. No API key lives here: the profile `worker`
 * sets ANTHROPIC_BASE_URL to the broker and the token of the task as the key.
 */
export async function serveWorker(
  file: string | undefined,
  stdin: Readable,
  stdout: Writable,
  stderr: Writable,
  agent: TaskAgent = new SdkTaskAgent(),
): Promise<number> {
  if (file === undefined) {
    stderr.write('usage: task-serve.js <agent file>\n');
    return 2;
  }
  const profile = parseAgentFile(String(await readFile(file)));
  const { channel, close } = await connectPlatform(stdin, stdout);
  try {
    await serveTask(channel, agent, profile);
  } finally {
    await close();
  }
  return 0;
}
