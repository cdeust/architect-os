import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { ask, type Asked } from '../../src/application/ask.js';
import { verify, type VerifyReport } from '../../src/application/verify.js';
import type { Lookup, Registry } from '../../src/domain/ports.js';
import { InMemoryStore } from '../../src/infrastructure/in-memory-store.js';
import { Given, Then, When, type EvidenceWorld } from './support.js';
import { questionOf } from './store.js';

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

const QUOTE = 'participants answered more comprehension questions correctly';

/** The desk of Science as the in-memory store has it, plus answers that cannot be read as plain files. */
class DeskStore extends InMemoryStore {
  readonly unreadable = new Set<string>();
  override answer(id: string): string | undefined {
    return this.unreadable.has(id) ? undefined : super.answer(id);
  }
}

/** Counts the calls, in order, and the most that were in flight at once. */
class SpyRegistry implements Registry {
  readonly known = new Map<string, Lookup>();
  readonly calls: string[] = [];
  inFlight = 0;
  maxInFlight = 0;

  async lookup(doi: string): Promise<Lookup> {
    this.calls.push(doi);
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    await new Promise((resolve) => setImmediate(resolve));
    this.inFlight -= 1;
    return this.known.get(doi) ?? { kind: 'unknown' };
  }
}

interface Scene {
  store: DeskStore;
  registry: SpyRegistry;
  now: string;
  skill: Record<string, string>;
  asked?: Asked;
  report?: VerifyReport;
}
const scene = (world: EvidenceWorld): Scene => world.state['useCases'] as Scene;
const ids = (list: string): string[] => (list === '' ? [] : list.split(','));

Given('the evidence use cases over an empty desk, the clock reading {string}', function (now: string) {
  this.state['useCases'] = {
    store: new DeskStore(),
    registry: new SpyRegistry(),
    now,
    skill: { 'SKILL.md': 'the skill', 'answer.schema.json': '{}' },
  } satisfies Scene;
});

Given('the evidence clock now reads {string}', function (now: string) {
  scene(this).now = now;
});

Given('the evidence skill is replaced by the file {string} holding {string}', function (name, text: string) {
  scene(this).skill = { [name as string]: text };
});

Given(
  'the registry knows {string} as {string} of {int}',
  function (doi: string, title: string, year: number) {
    scene(this).registry.known.set(doi, { kind: 'found', title, year, retracted: false });
  },
);

Given('the registry knows {string} as {string} of an unknown year', function (doi: string, title: string) {
  scene(this).registry.known.set(doi, { kind: 'found', title, year: null, retracted: false });
});

Given(
  'the registry knows {string} as {string} of {int}, retracted',
  function (doi, title: string, year: number) {
    scene(this).registry.known.set(doi as string, { kind: 'found', title, year, retracted: true });
  },
);

Given('the registry is unreachable for {string}', function (doi: string) {
  scene(this).registry.known.set(doi, { kind: 'unavailable', detail: 'status 503' });
});

Given('the question {string} is in the ledger', function (id: string) {
  scene(this).store.saveQuestion(questionOf(id));
});

Given('the desk holds the text {string} as {string}', function (name: string, text: string) {
  scene(this).store.putSource(name, text);
});

Given('the desk holds the answer {string}:', function (id: string, raw: string) {
  scene(this).store.putAnswer(id, raw);
});

Given('the desk holds the answer {string} as the text {string}', function (id: string, raw: string) {
  scene(this).store.putAnswer(id, raw);
});

Given('the answer file of {string} is not a plain file', function (id: string) {
  scene(this).store.putAnswer(id, 'ignored');
  scene(this).store.unreadable.add(id);
});

/** One claim, one source, the passage QUOTE. */
const plainAnswer = (id: string, doi: string, title: string, text: string): string =>
  JSON.stringify({
    id,
    claims: [{ statement: 'A statement.', sources: [{ doi, title, quote: QUOTE, text }] }],
    not_found: [],
  });

Given(
  'the desk holds the answer {string} citing {string} titled {string} in the text {string}',
  function (id: string, doi: string, title: string, text: string) {
    scene(this).store.putAnswer(id, plainAnswer(id, doi, title, text));
  },
);

Given('the desk holds the answer {string} that finds nothing', function (id: string) {
  scene(this).store.putAnswer(id, JSON.stringify({ id, claims: [], not_found: ['no trial found'] }));
});

Given(
  'the desk holds a text {string} that names {string} and quotes the passage',
  function (name, title: string) {
    scene(this).store.putSource(name as string, `${title}. Results: ${QUOTE}. End.`);
  },
);

const deps = (world: EvidenceWorld) => {
  const current = scene(world);
  return {
    store: current.store,
    registry: current.registry,
    clock: () => new Date(current.now),
    sha256,
  };
};

When('the evidence question {string} is asked with the text {string}', function (id: string, text: string) {
  const current = scene(this);
  current.asked = ask(
    { store: current.store, clock: () => new Date(current.now), skill: current.skill },
    id,
    text.replaceAll('\\n', '\n'),
  );
});

When('the evidence question {string} is asked with a text of {int} characters', function (id, size: number) {
  const current = scene(this);
  current.asked = ask(
    { store: current.store, clock: () => new Date(current.now), skill: current.skill },
    id as string,
    'q'.repeat(size),
  );
});

Then('the evidence question is asked', function () {
  assert.equal(scene(this).asked?.ok, true);
});

Then('the evidence question is refused as {string} saying:', function (code: string, detail: string) {
  const asked = scene(this).asked;
  assert.ok(asked !== undefined && !asked.ok);
  assert.deepEqual({ code: asked.code, detail: asked.detail }, { code, detail });
});

Then('the ledger holds the question {string} as {string} asked at {string}', function (id, text, at: string) {
  assert.deepEqual(scene(this).store.question(id as string), {
    id,
    question: text,
    asked_at: at,
  });
});

Then('the evidence asked identifiers of the desk are {string}', function (list: string) {
  assert.deepEqual(scene(this).store.askedIds(), ids(list));
});

Then('the evidence desk published {string} as {string}', function (name: string, content: string) {
  assert.equal(scene(this).store.publishedFile(name), content);
});

Then('the evidence desk published nothing named {string}', function (name: string) {
  assert.equal(scene(this).store.publishedFile(name), undefined);
});

When('the evidence verification runs', async function () {
  scene(this).report = await verify(deps(this));
});

Then(
  'the verification reports verified {string}, rejected {string}, deferred {string} and pending {string}',
  function (verified: string, rejected: string, deferred: string, pending: string) {
    assert.deepEqual(scene(this).report, {
      verified: ids(verified),
      rejected: ids(rejected),
      deferred: ids(deferred),
      pending: ids(pending),
    });
  },
);

Then('the registry was asked for {string}', function (list: string) {
  assert.deepEqual(scene(this).registry.calls, ids(list));
});

Then('the registry never had two lookups in flight', function () {
  assert.equal(scene(this).registry.maxInFlight, 1);
});

Then(
  'the evidence rejection of {string} is rejected_at {string} for the answer {string}',
  function (id, at, raw) {
    const rejection = scene(this).store.rejection(id as string);
    assert.equal(rejection?.rejected_at, at);
    assert.equal(rejection?.answer_sha256, sha256(raw as string));
  },
);

Then(
  'the evidence rejection of {string} has the reasons:',
  function (id: string, table: { raw(): string[][] }) {
    const expected = table.raw().map(([code, claim, source, detail]) => ({
      code,
      claim: claim === 'null' ? null : Number(claim),
      source: source === 'null' ? null : Number(source),
      detail,
    }));
    assert.deepEqual(scene(this).store.rejection(id)?.reasons, expected);
  },
);

Then('the evidence desk holds no rejection of {string}', function (id: string) {
  assert.equal(scene(this).store.rejection(id), undefined);
});

Then('the evidence ledger holds no verified record of {string}', function (id: string) {
  assert.equal(scene(this).store.verified(id), undefined);
});

Then('the evidence ledger holds the verified record of {string}:', function (id: string, json: string) {
  assert.deepEqual(scene(this).store.verified(id), JSON.parse(json));
});

Then('the evidence ledger keeps the text {string} of the source of {string}', function (text, id: string) {
  const record = scene(this).store.verified(id);
  const sha = record?.claims[0]?.sources[0]?.text_sha256 as string;
  assert.equal(sha, sha256(text as string));
  assert.equal(scene(this).store.ledgerSource(sha), text);
});

Then(
  'the evidence rejection of {string} carries the fingerprint of its answer, of the text {string} and of an absent text',
  function (id: string, text: string) {
    const current = scene(this);
    const raw = current.store.answer(id) as string;
    assert.equal(
      current.store.rejection(id)?.answer_sha256,
      sha256([raw, sha256(text), sha256('')].join('\n')),
    );
  },
);

Then(
  'the evidence rejection of {string} is rejected_at {string}, with the fingerprint of its answer and of an absent text',
  function (id: string, at: string) {
    const current = scene(this);
    const rejection = current.store.rejection(id);
    assert.equal(rejection?.rejected_at, at);
    assert.equal(
      rejection?.answer_sha256,
      sha256([current.store.answer(id) as string, sha256('')].join('\n')),
    );
  },
);
