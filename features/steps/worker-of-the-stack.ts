import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { WorkerOutput } from '@architect-os/contracts';
import { loadPrompts, PROMPTS_DIR } from '../../services/memory/worker/prompts.js';
import { runWorker } from '../../services/memory/worker/run-worker.js';
import { ClaudeSdkAgent } from '../../services/memory/worker/sdk-agent.js';
import { startFakeModel, type FakeModel } from '../support/fake-model.js';
import type { ArchitectWorld } from '../support/world.js';
import { Given, Then, When, stored } from './helpers.js';

// features/integration/worker-of-the-stack.feature: the worker of the first realisation as its container runs it,
// less its file of entry: `runWorker` on a WorkerInput, the committed prompts, and ClaudeSdkAgent with the real Claude
// Code binary, against a fake model on the loopback. No real call, no real key.

/** The token of the run at the broker: here a fake, of the length the contract asks. */
const RUN_TOKEN = 'tok-run-not-a-key-0123456789abcdef';
/** A key the environment of the worker holds, which the token of the run must replace. */
const OTHER_KEY = 'sk-other-not-a-key-0123456789abcdef';

interface Scene {
  model: FakeModel;
  relays: [string, unknown][];
  exitCode?: number;
  output?: WorkerOutput;
}
const sceneOf = (world: ArchitectWorld) => stored<Scene>(world, 'worker-of-the-stack');

Given(
  'a fake model that asks the memory tools of the stack to search for {string}, then answers {string}',
  async function (query: string, output: string) {
    // The worker of the first realisation serves its tools under the server `memory` (sdk-agent.ts).
    const model = await startFakeModel([
      { tool: 'mcp__memory__memory_search', input: { query, limit: 5 } },
      { tool: 'StructuredOutput', input: JSON.parse(output) },
    ]);
    this.cleanups.push(() => model.close());
    this.state['worker-of-the-stack'] = { model, relays: [] } satisfies Scene;
  },
);

When(
  'the worker of the stack runs {string} with {string} under the token of its run, its environment holding another key, its internal tool answering {string}',
  { timeout: 120_000 },
  async function (tool: string, input: string, answer: string) {
    const scene = sceneOf(this);
    const config = mkdtempSync(join(tmpdir(), 'aos-worker-of-the-stack-'));
    this.cleanups.push(() => rmSync(config, { recursive: true, force: true }));
    const stdin = JSON.stringify({
      run_id: 'run-1',
      tool,
      input: JSON.parse(input),
      limits: { max_turns: 4, max_budget_usd: 0.5 },
      token: RUN_TOKEN,
    });
    const result = await runWorker(stdin, {
      agent: new ClaudeSdkAgent({
        PATH: process.env['PATH'],
        HOME: config,
        ANTHROPIC_BASE_URL: scene.model.url,
        ANTHROPIC_API_KEY: OTHER_KEY,
        CLAUDE_CONFIG_DIR: config,
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
        DISABLE_AUTOUPDATER: '1',
        DISABLE_TELEMETRY: '1',
      }),
      tools: {
        call: async (name, args) => {
          scene.relays.push([name, args]);
          return JSON.parse(answer) as unknown;
        },
      },
      prompts: await loadPrompts(PROMPTS_DIR),
    });
    scene.exitCode = result.exitCode;
    scene.output = JSON.parse(result.stdout) as WorkerOutput;
  },
);

Then(
  'the worker of the stack ended with the code {int} and the output {string}',
  function (code: number, expected: string) {
    const { exitCode, output } = sceneOf(this);
    assert.equal(exitCode, code, JSON.stringify(output));
    const { cost: _cost, ...rest } = output as WorkerOutput;
    assert.deepEqual(rest, JSON.parse(expected));
  },
);

Then(
  'the output of the worker of the stack carries a cost: input tokens, output tokens, a dollar amount',
  function () {
    const { cost } = sceneOf(this).output as WorkerOutput;
    assert.ok(cost.input_tokens > 0, 'no input tokens');
    assert.ok(cost.output_tokens > 0, 'no output tokens');
    assert.ok(Number.isFinite(cost.usd) && cost.usd >= 0, 'no dollar amount');
  },
);

Then('the worker of the stack relayed {string} with {string}, once', function (name: string, args: string) {
  assert.deepEqual(sceneOf(this).relays, [[name, JSON.parse(args)]]);
});

Then(
  'the fake model was asked for messages at least once, and every request it received, whatever its path, carried the token of the run as its key',
  function () {
    const { requests } = sceneOf(this).model;
    assert.ok(
      requests.some((request) => request.path === '/v1/messages'),
      'the model was never asked for messages',
    );
    assert.deepEqual([...new Set(requests.map((request) => request.apiKey))], [RUN_TOKEN]);
  },
);
