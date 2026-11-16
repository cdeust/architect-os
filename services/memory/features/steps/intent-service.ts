import assert from 'node:assert/strict';
import { IntentService } from '../../src/application/intent-service.js';
import {
  ServiceError,
  timeoutError,
  type ContainerRunner,
  type RunRegistry,
  type RunTokens,
} from '../../src/domain/ports.js';
import { InMemoryRunRegistry, InMemoryRunTokens } from '../../src/infrastructure/in-memory.js';
import { Given, Then, When, assertMatches, required, slot, type MemoryWorld } from './helpers.js';

const LIMITS = { timeoutMs: 1000, maxTurns: 4, maxBudgetUsd: 0.1 };
const COST = { input_tokens: 10, output_tokens: 5, usd: 0.001 };

const okWorker = JSON.stringify({
  status: 'ok',
  data: { summary: 'found', memories: [{ id: 'm1', content: 'c', tags: [], score: 1 }] },
  evidence: [{ source: 'memory', ref: 'm1' }],
  cost: COST,
});

function runner(stdout: string | Error, exitCode = 0): ContainerRunner {
  return {
    async run() {
      if (stdout instanceof Error) throw stdout;
      return { exitCode, stdout };
    },
  };
}

type Result = Awaited<ReturnType<IntentService['handle']>>;

/** Records which events the run held when its token was granted. */
class SpyTokens extends InMemoryRunTokens {
  readonly eventsAtGrant: string[][] = [];
  constructor(private readonly registry: InMemoryRunRegistry) {
    super();
  }
  override async grant(runId: string): Promise<string> {
    this.eventsAtGrant.push(this.registry.get(runId).events.map((e) => e.type));
    return super.grant(runId);
  }
}

class IntentScenario {
  registry = new InMemoryRunRegistry();
  tokens = new SpyTokens(this.registry);
  /** How many tokens had been retired when the worker ran. */
  retiredAtWorker: number | undefined;
  service: IntentService | undefined;
  result: Result | undefined;
  seenRequest: unknown;

  over(r: ContainerRunner, tokens?: (spy: SpyTokens) => RunTokens): void {
    this.registry = new InMemoryRunRegistry();
    this.tokens = new SpyTokens(this.registry);
    this.service = new IntentService(this.registry, r, tokens?.(this.tokens) ?? this.tokens, LIMITS);
  }
  recordingWorker(): ContainerRunner {
    return {
      run: async (request) => {
        this.seenRequest = request;
        this.retiredAtWorker = this.tokens.retired.length;
        return { exitCode: 0, stdout: okWorker };
      },
    };
  }
  get lastResult(): Result {
    return required(this.result, 'an intent result');
  }
  runEvents(): string[] {
    return this.registry.get(this.lastResult.run_id ?? '').events.map((e) => e.type);
  }
}

const scenario = (world: MemoryWorld) => slot(world, 'intent-service', () => new IntentScenario());

Given('an intent service over a worker that prints the ok recall output', function () {
  scenario(this).over(runner(okWorker));
});

Given(
  'an intent service over a worker that exits with code {int} and prints {string}',
  function (exitCode: number, stdout: string) {
    scenario(this).over(runner(stdout, exitCode));
  },
);

Given('an intent service over a worker that exceeds its timeout', function () {
  scenario(this).over(runner(timeoutError(5)));
});

Given('an intent service over a worker that cannot start because {string}', function (reason: string) {
  scenario(this).over(runner(new ServiceError('WORKER_UNAVAILABLE', reason)));
});

Given('an intent service over a run registry that is down', function () {
  const s = scenario(this);
  const down: RunRegistry = {
    async create() {
      throw new ServiceError('DATA_UNAVAILABLE', 'data down');
    },
    async appendEvent() {},
    async complete() {},
  };
  s.service = new IntentService(down, runner(okWorker), s.tokens, LIMITS);
});

Given('an intent service over a worker that records its request', function () {
  const s = scenario(this);
  s.over(s.recordingWorker());
});

Given('an intent service whose broker cannot grant a token because {string}', function (reason: string) {
  const s = scenario(this);
  s.over(s.recordingWorker(), (spy) => ({
    grant: async () => {
      throw new Error(reason);
    },
    retire: (token) => spy.retire(token),
  }));
});

Given('an intent service whose broker cannot retire a token', function () {
  const s = scenario(this);
  s.over(runner(okWorker), (spy) => ({
    grant: (runId) => spy.grant(runId),
    retire: async (token) => {
      await spy.retire(token);
      throw new Error('broker unreachable');
    },
  }));
});

When('the intent service handles {string} with input {string}', async function (tool: string, input: string) {
  const s = scenario(this);
  s.result = await required(s.service, 'an intent service').handle(
    tool as Parameters<IntentService['handle']>[0],
    JSON.parse(input),
  );
});

Then('the intent result matches {string}', function (expected: string) {
  assertMatches(scenario(this).lastResult, JSON.parse(expected));
});

Then('the intent result error code is {string}', function (code: string) {
  assert.equal(scenario(this).lastResult.error?.code, code);
});

Then('the intent result error message contains {string}', function (part: string) {
  const message = scenario(this).lastResult.error?.message;
  assert.ok(message?.includes(part), `message ${message} does not contain ${part}`);
});

Then('the recorded run events are {string}', function (types: string) {
  assert.deepEqual(scenario(this).runEvents(), types.split(', '));
});

Then('the recorded run events include {string}', function (type: string) {
  assert.ok(scenario(this).runEvents().includes(type), `no ${type} event`);
});

Then('the recorded run status is {string}', function (status: string) {
  const s = scenario(this);
  assert.equal(s.registry.get(s.lastResult.run_id ?? '').status, status);
});

Then('the run registry holds {int} runs', function (count: number) {
  assert.equal(scenario(this).registry.runs.size, count);
});

Then('the worker request matches {string}', function (expected: string) {
  assertMatches(scenario(this).seenRequest, JSON.parse(expected));
});

const grantedTokens = (s: IntentScenario) => s.tokens.granted;

Then('the token of the run was granted before its event {string}', function (type: string) {
  const s = scenario(this);
  assert.equal(s.tokens.eventsAtGrant.length, 1);
  assert.ok(!s.tokens.eventsAtGrant[0]?.includes(type), `${type} was recorded before the grant`);
});

Then('the worker input carries exactly the token granted for its run', function () {
  const s = scenario(this);
  const granted = grantedTokens(s);
  assert.equal(granted.length, 1);
  assert.equal(granted[0]?.runId, s.lastResult.run_id);
  assert.equal((s.seenRequest as { input: { token: string } }).input.token, granted[0]?.token);
});

Then('the token of the run was retired once, after the worker ran', function () {
  const s = scenario(this);
  assert.deepEqual(s.tokens.retired, [grantedTokens(s)[0]?.token]);
  assert.equal(s.retiredAtWorker, 0);
});

Then('the token of the run was retired once', function () {
  const s = scenario(this);
  assert.equal(grantedTokens(s).length, 1);
  assert.deepEqual(s.tokens.retired, [grantedTokens(s)[0]?.token]);
});

Then('no worker was started and no token retired', function () {
  const s = scenario(this);
  assert.equal(s.seenRequest, undefined);
  assert.deepEqual(s.tokens.retired, []);
});

Then('the two runs were granted two different tokens, each for its run', function () {
  const s = scenario(this);
  const [first, second] = grantedTokens(s);
  assert.equal(grantedTokens(s).length, 2);
  assert.notEqual(first?.token, second?.token);
  assert.notEqual(first?.runId, second?.runId);
});

Then('no event of the run and no result holds its token', function () {
  const s = scenario(this);
  const token = required(grantedTokens(s)[0], 'a granted token').token;
  const run = JSON.stringify(s.registry.get(s.lastResult.run_id ?? ''));
  assert.ok(!run.includes(token), 'the recorded run holds the token');
  assert.ok(!JSON.stringify(s.lastResult).includes(token), 'the result holds the token');
});
