import assert from 'node:assert/strict';
import type { Reading, Reason } from '../../src/domain/ports.js';
import { FetchSources, type Limits } from '../../src/infrastructure/fetch-sources.js';
import { InMemorySources } from '../../src/infrastructure/in-memory-sources.js';
import {
  fakeFetch,
  Given,
  Then,
  unescape,
  When,
  type Answer,
  type Request,
  type WatchWorld,
} from './support.js';

interface Scene {
  answers: Map<string, Answer>;
  requests: Request[];
  adapter: string;
  limits: Limits;
  reading?: Reading;
}

/** The answers a scenario gives its sources, shared by the adapter scenarios and the command scenarios. */
export const sceneOf = (world: WatchWorld): Scene => {
  world.state['sources'] ??= {
    answers: new Map<string, Answer>(),
    requests: [],
    adapter: 'fetch',
    limits: { timeoutMs: 5_000, maxBytes: 1024 },
  } satisfies Scene;
  return world.state['sources'] as Scene;
};

const answerOf = (world: WatchWorld, url: string): Answer => {
  const answers = sceneOf(world).answers;
  const answer = answers.get(url) ?? {};
  answers.set(url, answer);
  return answer;
};

Given('the watch source {string} answers {string}', function (url: string, body: string) {
  answerOf(this, url).body = unescape(body);
});

Given('the watch source {string} answers with the version {string}', function (url: string, version: string) {
  answerOf(this, url).body = JSON.stringify({ version });
});

Given('the watch source {string} answers with the status {int}', function (url: string, status: number) {
  answerOf(this, url).status = status;
});

Given('the watch source {string} redirects to {string}', function (url: string, location: string) {
  Object.assign(answerOf(this, url), { status: 302, location });
});

Given('the watch source {string} never answers', function (url: string) {
  answerOf(this, url).hang = true;
});

Given('the watch source {string} has no body', function (url: string) {
  answerOf(this, url).noBody = true;
});

Given('the watch source {string} fails with the error {string}', function (url: string, error: string) {
  answerOf(this, url).fails = error;
});

Given('the watch source {string} answers with {int} bytes', function (url: string, bytes: number) {
  answerOf(this, url).bytes = bytes;
});

Given('the watch source {string} answers with bytes that are not UTF-8', function (url: string) {
  answerOf(this, url).invalid = true;
});

Given('the watch sources are the {word} adapter', function (adapter: string) {
  sceneOf(this).adapter = adapter;
});

Given(
  'the watch fetch adapter is limited to {int} milliseconds and {int} bytes',
  function (timeoutMs: number, maxBytes: number) {
    sceneOf(this).limits = { timeoutMs, maxBytes };
  },
);

/** The adapter under test, built when the scenario reads, from the answers it gave. */
export function adapterOf(world: WatchWorld): { fetch(url: string): Promise<Reading> } {
  const scene = sceneOf(world);
  if (scene.adapter === 'fetch') {
    return new FetchSources(fakeFetch(scene.answers, scene.requests), scene.limits);
  }
  const table = new Map<string, Reading>();
  for (const [url, answer] of scene.answers) {
    const status = answer.status ?? 200;
    table.set(
      url,
      status === 200
        ? { kind: 'text', text: answer.body ?? '' }
        : { kind: 'unreadable', reason: `statut ${status}` },
    );
  }
  return new InMemorySources(table);
}

When('I read {string} through the watch sources', async function (url: string) {
  sceneOf(this).reading = await adapterOf(this).fetch(url);
});

Then('the watch reading is the text {string}', function (text: string) {
  assert.deepEqual(sceneOf(this).reading, { kind: 'text', text: unescape(text) });
});

Then('the watch reading is unreadable because {string}', function (reason: string) {
  assert.deepEqual(sceneOf(this).reading, { kind: 'unreadable', reason: reason as Reason });
});

Then('the watch sources made {int} requests', function (count: number) {
  assert.equal(sceneOf(this).requests.length, count);
});

Then('the watch request {int} was for {string}', function (position: number, url: string) {
  assert.equal(sceneOf(this).requests[position - 1]?.url, url);
});

Then(
  'every watch request carried only the header accept, with its value, and did not follow redirects',
  function () {
    const { requests } = sceneOf(this);
    assert.ok(requests.length > 0);
    for (const { init } of requests) {
      assert.deepEqual(init.headers, { accept: 'text/plain, text/markdown, application/json' });
      assert.equal(init.redirect, 'manual');
      assert.ok(init.signal instanceof AbortSignal);
      assert.equal(init.method, undefined);
      assert.equal(init.body, undefined);
      assert.equal(init.credentials, undefined);
    }
  },
);
