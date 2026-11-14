import assert from 'node:assert/strict';
import {
  constants,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Question, Rejection, Verified } from '../../src/domain/contract.js';
import type { Store } from '../../src/domain/ports.js';
import { openFsStore } from '../../src/infrastructure/fs-store.js';
import { InMemoryStore } from '../../src/infrastructure/in-memory-store.js';
import { Given, Then, When, type EvidenceWorld } from './support.js';

const SHA = 'a'.repeat(64);
const OTHER_SHA = 'b'.repeat(64);

export const questionOf = (id: string): Question => ({
  id,
  question: `What is ${id}?`,
  asked_at: '2026-11-14T10:00:00Z',
});
export const rejectionOf = (id: string): Rejection => ({
  id,
  rejected_at: '2026-11-14T11:00:00Z',
  answer_sha256: SHA,
  reasons: [{ code: 'QUOTE_ABSENT', claim: 0, source: 1, detail: 'the quote is not in sources/a.txt' }],
});
const verifiedOf = (id: string): Verified => ({
  id,
  question: `What is ${id}?`,
  verified_at: '2026-11-14T12:00:00Z',
  level: 'quote_in_supplied_text',
  claims: [
    {
      statement: 'A statement.',
      sources: [
        { doi: '10.1234/abc', title: 'A title', year: null, quote: 'q'.repeat(40), text_sha256: SHA },
      ],
    },
  ],
  not_found: ['something'],
});

/** What a store contract needs from an adapter besides the port: the hands of Science and a look in the ledger. */
interface Harness {
  store: Store;
  putAnswer(id: string, raw: string): void;
  putSource(name: string, text: string): void;
  ledgerSource(sha256: string): string | undefined;
  publishedFile(name: string): string | undefined;
  /** Every file the adapter holds under its root, as paths; the in-memory adapter has no temporary file to leave. */
  filesHeld(): string[];
}

/** A throwaway root under the system temporary directory (its real path), removed at the end of the scenario. */
export function throwawayRoot(world: EvidenceWorld): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'evidence-')));
  world.cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function harnessOf(adapter: string, world: EvidenceWorld): Harness {
  if (adapter === 'in-memory') {
    const store = new InMemoryStore();
    return {
      store,
      putAnswer: (id, raw) => store.putAnswer(id, raw),
      putSource: (name, text) => store.putSource(name, text),
      ledgerSource: (sha256) => store.ledgerSource(sha256),
      publishedFile: (name) => store.publishedFile(name),
      filesHeld: () => [],
    };
  }
  const root = throwawayRoot(world);
  const opened = openFsStore(
    join(root, 'ledger'),
    join(root, 'desk'),
    process.getuid?.() as number,
    constants,
  );
  assert.ok(opened.ok);
  return {
    store: opened.store,
    putAnswer: (id, raw) => writeFileSync(join(root, 'desk', 'in', `${id}.answer.json`), raw),
    putSource: (name, text) => writeFileSync(join(root, 'desk', 'in', name), text),
    filesHeld: () =>
      readdirSync(root, { recursive: true, withFileTypes: true })
        .filter((entry) => !entry.isDirectory())
        .map((entry) => join(entry.parentPath, entry.name)),
    publishedFile: (name) => {
      const file = join(root, 'desk', 'out', name);
      return existsSync(file) && statSync(file).isFile() ? readFileSync(file, 'utf8') : undefined;
    },
    ledgerSource: (sha256) => {
      const file = join(root, 'ledger', 'sources', `${sha256}.txt`);
      return existsSync(file) ? readFileSync(file, 'utf8') : undefined;
    },
  };
}

const harness = (world: EvidenceWorld): Harness => world.state['harness'] as Harness;

Given('the evidence store adapter {string}', function (adapter: string) {
  this.state['harness'] = harnessOf(adapter, this);
});

When('the evidence questions {string} are saved in that order', function (ids: string) {
  for (const id of ids.split(',')) harness(this).store.saveQuestion(questionOf(id));
});

Then('the evidence asked identifiers are {string}', function (ids: string) {
  assert.deepEqual(harness(this).store.askedIds(), ids.split(','));
});

Then('the evidence question {string} is read back', function (id: string) {
  assert.deepEqual(harness(this).store.question(id), questionOf(id));
});

Then('the evidence question {string} is absent', function (id: string) {
  assert.equal(harness(this).store.question(id), undefined);
});

Given('Science has answered {string} with {string}', function (id: string, raw: string) {
  harness(this).putAnswer(id, raw);
});

Then('the evidence answer identifiers are {string}', function (ids: string) {
  assert.deepEqual(harness(this).store.answerIds(), ids.split(','));
});

Then('the evidence raw answer {string} is {string}', function (id: string, raw: string) {
  assert.equal(harness(this).store.answer(id), raw);
});

Then('the evidence raw answer {string} is absent', function (id: string) {
  assert.equal(harness(this).store.answer(id), undefined);
});

Given('Science has supplied the text {string} as {string}', function (name: string, text: string) {
  harness(this).putSource(name, text);
});

Then('the evidence source text {string} reads {string}', function (name: string, text: string) {
  assert.equal(harness(this).store.sourceText(name), text);
});

Then('the evidence source text {string} is absent', function (name: string) {
  assert.equal(harness(this).store.sourceText(name), undefined);
});

When('the evidence rejection {string} is saved', function (id: string) {
  harness(this).store.saveRejection(rejectionOf(id));
});

Then('the evidence rejection {string} is read back', function (id: string) {
  assert.deepEqual(harness(this).store.rejection(id), rejectionOf(id));
});

Then('the evidence rejection {string} is absent', function (id: string) {
  assert.equal(harness(this).store.rejection(id), undefined);
});

When('the evidence record {string} is verified with its text', function (id: string) {
  harness(this).store.saveVerified(
    verifiedOf(id),
    new Map([
      [SHA, 'the full text'],
      [OTHER_SHA, 'another text'],
    ]),
  );
});

Then('the evidence verified record {string} is read back', function (id: string) {
  assert.deepEqual(harness(this).store.verified(id), verifiedOf(id));
});

Then('the evidence verified record {string} is absent', function (id: string) {
  assert.equal(harness(this).store.verified(id), undefined);
});

Then('the evidence verified identifiers are {string}', function (ids: string) {
  assert.deepEqual(harness(this).store.verifiedIds(), ids.split(','));
});

Then('the evidence ledger keeps the texts under their hashes', function () {
  assert.equal(harness(this).ledgerSource(SHA), 'the full text');
  assert.equal(harness(this).ledgerSource(OTHER_SHA), 'another text');
});

When('the evidence file {string} is published with {string}', function (name: string, content: string) {
  harness(this).store.publish(name, content);
});

Then('the evidence published file {string} reads {string}', function (name: string, content: string) {
  assert.equal(harness(this).publishedFile(name), content);
});

Then('publishing the evidence file {string} is refused', function (name: string) {
  assert.throws(() => harness(this).store.publish(name, 'x'), /not a name of a published file/);
});

Then('the refused evidence file {string} left nothing behind', function (name: string) {
  assert.equal(harness(this).publishedFile(name), undefined);
  assert.deepEqual(harness(this).filesHeld(), []);
});

When('the evidence file of 120 characters is published', function () {
  harness(this).store.publish('p'.repeat(120), 'long');
});

Then('the evidence file of 120 characters is read back', function () {
  assert.equal(harness(this).publishedFile('p'.repeat(120)), 'long');
});

Then('publishing the evidence file of 121 characters is refused', function () {
  assert.throws(() => harness(this).store.publish('p'.repeat(121), 'x'), /not a name of a published file/);
});
