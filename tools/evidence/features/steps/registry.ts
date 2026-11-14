import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Lookup, Registry } from '../../src/domain/ports.js';
import { DoiOrgRegistry } from '../../src/infrastructure/doi-org.js';
import { InMemoryRegistry } from '../../src/infrastructure/in-memory-registry.js';
import { FIXTURES, Given, Then, When, unescape } from './support.js';

const ARTICLE = '10.1145/3597503.3639187';
const RETRACTED = '10.1016/S0140-6736(97)11096-0';
const ARXIV = '10.48550/arXiv.1706.03762';

const fixture = (name: string): string => readFileSync(join(FIXTURES, 'doi-org', name), 'utf8');

interface Call {
  url: string;
  init: RequestInit | undefined;
}

/** A fetch that serves the recorded answers of doi.org, a 404 for one DOI, a 503 for another; it keeps its calls. */
class FakeFetch {
  readonly calls: Call[] = [];
  readonly timeouts: number[] = [];
  readonly signal = new AbortController().signal;
  private readonly routes = new Map<string, () => Response | Promise<Response>>([
    [`https://doi.org/${ARTICLE}`, () => new Response(fixture('crossref-article.json'))],
    [
      'https://doi.org/10.1016/S0140-6736%2897%2911096-0',
      () => new Response(fixture('crossref-retracted.json')),
    ],
    [`https://doi.org/${ARXIV}`, () => new Response(fixture('datacite-arxiv.json'))],
    ['https://doi.org/10.1234/does-not-exist-xyz', () => new Response('Not found', { status: 404 })],
    ['https://doi.org/10.1234/down', () => new Response('Unavailable', { status: 503 })],
  ]);

  /** The injected `AbortSignal.timeout`: it keeps the delay it was asked for and hands out one known signal. */
  readonly timeout = (ms: number): AbortSignal => {
    this.timeouts.push(ms);
    return this.signal;
  };

  readonly fetch: typeof fetch = (input, init) => {
    const url = String(input);
    this.calls.push({ url, init });
    const route = this.routes.get(url);
    return Promise.resolve(route === undefined ? new Response('', { status: 599 }) : route());
  };

  answer(url: string, respond: () => Response): void {
    this.routes.set(url, respond);
  }
}

const KNOWN: ReadonlyMap<string, Lookup> = new Map<string, Lookup>([
  [
    ARTICLE,
    { kind: 'found', title: 'Using an LLM to Help With Code Understanding', year: 2024, retracted: false },
  ],
  [
    RETRACTED,
    {
      kind: 'found',
      title:
        'RETRACTED: Ileal-lymphoid-nodular hyperplasia, non-specific colitis, and pervasive developmental disorder in children',
      year: 1998,
      retracted: true,
    },
  ],
  [ARXIV, { kind: 'found', title: 'Attention Is All You Need', year: 2017, retracted: false }],
  ['10.1234/down', { kind: 'unavailable', detail: 'down' }],
]);

interface Scene {
  fake: FakeFetch;
  registry: Registry;
  lookup?: Lookup;
}

const scene = (state: Record<string, unknown>): Scene => state['registry'] as Scene;

Given('the evidence registry adapter {string}', function (adapter: string) {
  const fake = new FakeFetch();
  const registry =
    adapter === 'doi-org' ? new DoiOrgRegistry(fake.fetch, fake.timeout) : new InMemoryRegistry(KNOWN);
  this.state['registry'] = { fake, registry } satisfies Scene;
});

Given('the evidence doi.org adapter over the recorded fetch', function () {
  const fake = new FakeFetch();
  this.state['registry'] = { fake, registry: new DoiOrgRegistry(fake.fetch, fake.timeout) } satisfies Scene;
});

Given(
  'the evidence fetch answers {string} with status {int} and body {string}',
  function (doi: string, status: number, body: string) {
    scene(this.state).fake.answer(`https://doi.org/${doi}`, () => new Response(body, { status }));
  },
);

Given('the evidence fetch answers {string} with status 200 and no body', function (doi: string) {
  scene(this.state).fake.answer(`https://doi.org/${doi}`, () => new Response(null, { status: 200 }));
});

/** A JSON record of exactly `size` bytes (padded inside a string), sent as a stream of chunks of `chunk` bytes. */
Given(
  'the evidence fetch answers {string} with a JSON body of {int} bytes sent in chunks of {int} bytes',
  function (doi: string, size: number, chunk: number) {
    const head = '{"title":"A title","pad":"';
    const bytes = Buffer.from(`${head}${'x'.repeat(size - head.length - 2)}"}`);
    assert.equal(bytes.length, size);
    scene(this.state).fake.answer(
      `https://doi.org/${doi}`,
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              for (let at = 0; at < size; at += chunk) controller.enqueue(bytes.subarray(at, at + chunk));
              controller.close();
            },
          }),
          { status: 200 },
        ),
    );
  },
);

Given('the evidence fetch fails for {string} with {string}', function (doi: string, message: string) {
  scene(this.state).fake.answer(`https://doi.org/${doi}`, () => {
    throw new Error(message);
  });
});

When('the evidence registry looks up {string}', async function (doi: string) {
  const current = scene(this.state);
  current.lookup = await current.registry.lookup(unescape(doi));
});

Then(
  'the evidence lookup is {string} titled {string} of year {string}, retracted {string}',
  function (kind: string, title: string, year: string, retracted: string) {
    const lookup = scene(this.state).lookup as Lookup;
    assert.equal(lookup.kind, kind);
    if (lookup.kind === 'found') {
      assert.deepEqual(lookup, {
        kind: 'found',
        title,
        year: year === 'none' ? null : Number(year),
        retracted: retracted === 'true',
      });
    }
  },
);

Then('the evidence lookup is unavailable with the detail {string}', function (detail: string) {
  assert.deepEqual(scene(this.state).lookup, { kind: 'unavailable', detail });
});

Then('the evidence lookup year is {string}', function (year: string) {
  const lookup = scene(this.state).lookup as Extract<Lookup, { kind: 'found' }>;
  assert.equal(lookup.kind, 'found');
  assert.equal(lookup.year, year === 'none' ? null : Number(year));
});

Then('the evidence lookup retracted flag is {string}', function (retracted: string) {
  const lookup = scene(this.state).lookup as Extract<Lookup, { kind: 'found' }>;
  assert.equal(lookup.kind, 'found');
  assert.equal(lookup.retracted, retracted === 'true');
});

Then('the evidence fetch received one request to {string}', function (url: string) {
  const { calls } = scene(this.state).fake;
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, unescape(url));
});

Then('the evidence fetch request is a GET with exactly the two headers of the design note', function () {
  const init = scene(this.state).fake.calls[0]?.init as RequestInit;
  assert.equal(init.method, 'GET');
  assert.deepEqual(init.headers, {
    Accept: 'application/vnd.citationstyles.csl+json',
    'User-Agent': 'architect-os-evidence/0.1',
  });
  assert.deepEqual(Object.keys(init).sort(), ['headers', 'method', 'signal']);
});

Then('the evidence fetch request carries the signal made for a limit of 20000 ms', function () {
  const { calls, timeouts, signal } = scene(this.state).fake;
  assert.deepEqual(timeouts, [20000]);
  assert.equal((calls[0]?.init as RequestInit).signal, signal);
});

Then('the evidence lookup is found with the title {string}', function (title: string) {
  const lookup = scene(this.state).lookup as Lookup;
  assert.equal(lookup.kind, 'found');
  assert.equal(lookup.kind === 'found' ? lookup.title : undefined, title);
});
