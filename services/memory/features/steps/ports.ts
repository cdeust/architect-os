import type { DataOpName } from '@architect-os/contracts';
import assert from 'node:assert/strict';
import { ServiceError, timeoutError, type RunTokens } from '../../src/domain/ports.js';
import {
  InMemoryDataPort,
  InMemoryRunRegistry,
  InMemoryRunTokens,
} from '../../src/infrastructure/in-memory.js';
import { Given, Then, When, assertMatches, required, slot, type MemoryWorld } from './helpers.js';

Then('a worker timeout error of {int} ms matches {string}', function (ms: number, expected: string) {
  assertMatches(timeoutError(ms), JSON.parse(expected));
});

Then(
  'a ServiceError with code {string} and message {string} matches {string}',
  function (code: string, message: string, expected: string) {
    assertMatches(new ServiceError(code as ServiceError['code'], message), JSON.parse(expected));
  },
);

/** One adapter of RunTokens, and how to read what it recorded as retired. */
interface TokensUnderTest {
  tokens: RunTokens;
  retired(): readonly string[];
}

const TOKEN_ADAPTERS: Record<string, () => TokensUnderTest> = {
  'in-memory': () => {
    const tokens = new InMemoryRunTokens();
    return { tokens, retired: () => tokens.retired };
  },
};

class TokensScenario {
  adapter: TokensUnderTest | undefined;
  granted: string[] = [];
}

const tokensOf = (world: MemoryWorld) => slot(world, 'run-tokens', () => new TokensScenario());

Given('the {string} run tokens', function (name: string) {
  tokensOf(this).adapter = required(TOKEN_ADAPTERS[name], `the run tokens adapter ${name}`)();
});

When(
  'the run tokens grant a token for the run {string} and another for the run {string}',
  async function (first: string, second: string) {
    const s = tokensOf(this);
    const { tokens } = required(s.adapter, 'run tokens');
    s.granted = [await tokens.grant(first), await tokens.grant(second)];
  },
);

Then('each granted token has at least 32 characters', function () {
  const { granted } = tokensOf(this);
  assert.equal(granted.length, 2);
  for (const token of granted) assert.ok(token.length >= 32, 'token shorter than 32 characters');
});

Then('the two granted tokens differ', function () {
  const [first, second] = tokensOf(this).granted;
  assert.notEqual(first, second);
});

When('the run tokens retire the first granted token', async function () {
  const s = tokensOf(this);
  await required(s.adapter, 'run tokens').tokens.retire(required(s.granted[0], 'a granted token'));
});

Then('the run tokens recorded the first granted token as retired once', function () {
  const s = tokensOf(this);
  assert.deepEqual(required(s.adapter, 'run tokens').retired(), [s.granted[0]]);
});

class InMemoryScenario {
  registry = new InMemoryRunRegistry();
  data = new InMemoryDataPort();
  ids: string[] = [];
}

const inMemoryOf = (world: MemoryWorld) => slot(world, 'in-memory-adapters', () => new InMemoryScenario());

When('the in-memory run registry creates {int} runs', async function (count: number) {
  const s = inMemoryOf(this);
  for (let n = 0; n < count; n += 1) s.ids.push((await s.registry.create('recall', {})).id);
});

Then('the in-memory run registry named them {string}', function (ids: string) {
  assert.deepEqual(inMemoryOf(this).ids, ids.split(', '));
});

Then(
  'the in-memory run registry refuses an event for the run {string} with {string}',
  async function (runId: string, message: string) {
    await assert.rejects(inMemoryOf(this).registry.appendEvent(runId, 'worker.started', {}), { message });
  },
);

Given('an in-memory data port holding the memories {string}', async function (contents: string) {
  const s = inMemoryOf(this);
  for (const content of contents.split('; ')) {
    s.ids.push(((await s.data.call('memory.insert', { content, tags: [] })) as { id: string }).id);
  }
});

Then('the in-memory data port named them {string}', function (ids: string) {
  assert.deepEqual(inMemoryOf(this).ids, ids.split(', '));
});

Then(
  'the in-memory data port finds {string} for {string} with a limit of {int}',
  async function (ids: string, query: string, limit: number) {
    const found = (await inMemoryOf(this).data.call('memory.search', { query, limit })) as { id: string }[];
    assert.deepEqual(
      found.map((item) => item.id),
      ids.split(', '),
    );
  },
);

Then(
  'the in-memory data port refuses the operation {string} with {string}',
  async function (op: string, message: string) {
    await assert.rejects(inMemoryOf(this).data.call(op as DataOpName, {}), { message });
  },
);
