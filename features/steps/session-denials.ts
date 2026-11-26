import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DataTable } from '@cucumber/cucumber';
import { startFakeModel, type ModelTurn } from '../support/fake-model.js';
import { ROOT, Then, When, stored } from './helpers.js';
import { binary, resultOf, run } from './review-restriction.js';

/**
 * The denials of `.claude/settings.json`, tried on a real Claude Code before a scripted model
 * (docs/infrastructure.md, "What a session is spared"). The model asks for each call of the table; `gh` and `git` are
 * stand-ins that record their arguments and reach no host, and the GitHub MCP server is the stand-in of
 * features/support/fake-comment-mcp.mjs. Only the `permissions` of the committed file are given, with `--settings`:
 * its plugins would be fetched from a marketplace. Every tool is allowed, so a call that does not run was denied by a
 * rule. The binary, the process and the reading of the answers are those of the trial of the reviews
 * (features/steps/review-restriction.ts).
 */
interface Asked {
  readonly call: string;
  readonly outcome: 'refused' | 'ran';
}
interface DenialTrial {
  readonly exit: number | null;
  readonly asked: Asked[];
  readonly results: { text: string; isError: boolean }[];
  readonly commands: string[];
  readonly tools: string[];
}

const MCP_PREFIX = 'mcp__github__';
const MCP_TOOLS = ['merge_pull_request', 'update_pull_request_branch', 'get_me'];

const lines = (file: string): string[] =>
  existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean) : [];

When(
  'a real Claude Code under the denials of .claude\\/settings.json, in a folder named {string}, is asked by a scripted model for these calls',
  { timeout: 180_000 },
  async function (folder: string, table: DataTable) {
    const asked = table.hashes().map((row) => {
      const outcome = row['outcome'];
      assert.ok(outcome === 'refused' || outcome === 'ran', `no outcome named "${outcome}"`);
      return { call: row['call'] ?? '', outcome } satisfies Asked;
    });
    const parent = realpathSync(mkdtempSync(join(tmpdir(), 'aos-sd-')));
    this.cleanups.push(() => rmSync(parent, { recursive: true, force: true }));
    // A runtime root may hold a space or an apostrophe (tools/runtime/src/domain/root.ts): so may every path below.
    const dir = join(parent, folder);
    mkdirSync(dir);
    const checkout = join(dir, 'checkout');
    const bin = join(dir, 'bin');
    const home = join(dir, 'home');
    const config = join(dir, 'config');
    for (const made of [checkout, bin, home, config]) mkdirSync(made);
    const commands = join(dir, 'commands.txt');
    const calls = join(dir, 'calls.jsonl');
    // Fixed texts: the paths reach them as values of the environment, never as text of a script.
    for (const program of ['gh', 'git']) {
      writeFileSync(join(bin, program), `#!/bin/sh\nprintf '%s\\n' "${program} $*" >> "$TRIAL_COMMANDS"\n`);
      chmodSync(join(bin, program), 0o755);
    }
    // Run before each Bash command (code.claude.com/docs/en/env-vars, CLAUDE_ENV_FILE): the stand-ins come first for
    // the commands of the model, whatever the profile of the shell does to PATH.
    writeFileSync(join(dir, 'env.sh'), 'export PATH="$TRIAL_BIN:$PATH"\n');
    const { permissions } = JSON.parse(readFileSync(join(ROOT, '.claude/settings.json'), 'utf8')) as {
      permissions: { deny: string[] };
    };
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ permissions: { deny: permissions.deny } }));
    writeFileSync(
      join(dir, 'mcp.json'),
      JSON.stringify({
        mcpServers: {
          github: {
            command: process.execPath,
            args: [join(ROOT, 'features/support/fake-comment-mcp.mjs')],
            env: { FAKE_TOOL: MCP_TOOLS.join(','), FAKE_CALLS: calls },
          },
        },
      }),
    );
    const turns = asked.map(({ call }): ModelTurn =>
      call.startsWith(MCP_PREFIX)
        ? { tool: call, input: { body: 'x' } }
        : { tool: 'Bash', input: { command: call } },
    );
    const model = await startFakeModel([...turns, { text: 'done' }]);
    this.cleanups.push(() => model.close());
    const { exit } = await run(
      binary(),
      [
        '-p',
        'Deliver the change.',
        '--output-format',
        'stream-json',
        '--verbose',
        '--settings',
        join(dir, 'settings.json'),
        '--strict-mcp-config',
        '--mcp-config',
        join(dir, 'mcp.json'),
        '--allowedTools',
        ['Bash', ...MCP_TOOLS.map((tool) => MCP_PREFIX + tool)].join(','),
        '--permission-mode',
        'default',
        '--model',
        'claude-opus-5-5',
      ],
      {
        // Without the stand-ins: the git that Claude Code starts for itself is not a call of the model.
        PATH: process.env['PATH'] ?? '/usr/bin:/bin',
        HOME: home,
        CLAUDE_CONFIG_DIR: config,
        CLAUDE_ENV_FILE: join(dir, 'env.sh'),
        TRIAL_BIN: bin,
        TRIAL_COMMANDS: commands,
        // Were a real gh ever started, it would find no account and no host.
        GH_CONFIG_DIR: config,
        GH_HOST: 'github.invalid',
        ANTHROPIC_BASE_URL: model.url,
        ANTHROPIC_API_KEY: 'fake-key-of-the-trial',
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
        DISABLE_AUTOUPDATER: '1',
        DISABLE_TELEMETRY: '1',
      },
      checkout,
    );
    this.state['denial-trial'] = {
      exit,
      asked,
      results: exit === 0 ? resultOf(model.requests, asked.length) : [],
      commands: lines(commands),
      tools: lines(calls).map((line) => MCP_PREFIX + (JSON.parse(line) as { tool: string }).tool),
    } satisfies DenialTrial;
  },
);

Then('Claude Code refused each call marked refused and ran each call marked ran', function () {
  const trial = stored<DenialTrial>(this, 'denial-trial');
  assert.equal(trial.exit, 0, `Claude Code exited ${trial.exit}`);
  trial.asked.forEach(({ call, outcome }, index) => {
    const result = trial.results[index]!;
    assert.equal(result.isError, outcome === 'refused', `${call}: ${result.text}`);
    // A denied command is answered as denied; a denied tool is withdrawn from the session, and `get_me`, served by
    // the same stand-in, shows that the server was there. Another error is not a refusal of the settings.
    if (outcome === 'refused')
      assert.match(
        result.text,
        call.startsWith(MCP_PREFIX)
          ? /No such tool available/
          : /^Permission to use Bash .* has been denied/s,
        call,
      );
  });
});

Then('the stand-ins of gh, git and the GitHub server received the calls marked ran alone', function () {
  const trial = stored<DenialTrial>(this, 'denial-trial');
  const ran = trial.asked.filter(({ outcome }) => outcome === 'ran').map(({ call }) => call);
  assert.deepEqual(
    trial.tools,
    ran.filter((call) => call.startsWith(MCP_PREFIX)),
  );
  assert.deepEqual(
    trial.commands,
    ran
      .filter((call) => !call.startsWith(MCP_PREFIX))
      .map((call) => /^sh -c '(.*)'$/.exec(call)?.[1] ?? call),
  );
});
