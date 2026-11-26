import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ModelRequest } from './fake-model.js';

/**
 * What the trials of a real Claude Code before a scripted model share (features/integration/review-restriction.feature,
 * session-denials.feature): the binary, the process, and the answer Claude Code gave the model for each call.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** AOS_TRIAL_CLAUDE runs the trial with another Claude Code, such as the one the action pins. */
export function binary(): string {
  const other = process.env['AOS_TRIAL_CLAUDE'];
  if (other !== undefined && other !== '') return other;
  const require = createRequire(join(ROOT, 'services/memory/package.json'));
  const manifest = require.resolve(
    `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/package.json`,
  );
  return join(dirname(manifest), 'claude');
}

export function run(
  executable: string,
  args: string[],
  env: Record<string, string>,
  cwd: string,
): Promise<{ exit: number | null; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
    child.stderr.resume();
    // source: operational bound; the trial is a dozen local turns.
    const timer = setTimeout(() => child.kill('SIGKILL'), 120_000);
    child.on('error', reject);
    child.on('close', (exit) => {
      clearTimeout(timer);
      resolve({ exit, stdout });
    });
  });
}

/** The tool result Claude Code sent back for the call of turn `index`: it arrives in the next request. */
export function resultOf(requests: ModelRequest[], toolCalls: number): { text: string; isError: boolean }[] {
  const asked = requests.filter((request) => request.path === '/v1/messages');
  return Array.from({ length: toolCalls }, (_, index) => {
    const next = asked[index + 1];
    assert.ok(next !== undefined, `Claude Code stopped before answering call ${index + 1}`);
    const blocks = (next.body.messages ?? []).flatMap((message) => {
      const content = (message as { content?: unknown }).content;
      return Array.isArray(content) ? (content as Record<string, unknown>[]) : [];
    });
    const result = blocks.filter((block) => block['type'] === 'tool_result').at(-1);
    assert.ok(result !== undefined, `no tool result after call ${index + 1}`);
    const content = result['content'];
    const text =
      typeof content === 'string'
        ? content
        : Array.isArray(content)
          ? content.map((part) => String((part as { text?: unknown }).text ?? '')).join('')
          : '';
    return { text, isError: result['is_error'] === true };
  });
}
