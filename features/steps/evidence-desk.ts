import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { constants, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openFsStore, type FsStore } from '../../tools/evidence/src/infrastructure/fs-store.js';
import { Given, Then, stored } from './helpers.js';

// A FIFO cannot be made from `node:fs`: the root steps run `mkfifo`, as repository.ts runs its commands.

interface Desk {
  desk: string;
  store: FsStore;
}
const desk = (world: Parameters<typeof stored>[0]) => stored<Desk>(world, 'evidenceDesk');

Given('an evidence desk store over a throwaway root', function () {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'evidence-fifo-')));
  this.cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const opened = openFsStore(
    join(root, 'ledger'),
    join(root, 'desk'),
    process.getuid?.() as number,
    constants,
  );
  assert.ok(opened.ok);
  this.state['evidenceDesk'] = { desk: join(root, 'desk'), store: opened.store } satisfies Desk;
});

Given('Science has made the FIFO {string} in the desk store', function (name: string) {
  execFileSync('mkfifo', [join(desk(this).desk, name)]);
});

Then('the desk store reads no source text {string}', function (name: string) {
  assert.equal(desk(this).store.sourceText(name), undefined);
});

Then('the desk store reads no answer {string}', function (id: string) {
  assert.equal(desk(this).store.answer(id), undefined);
});

Then('the desk store lists the answer identifiers {string}', function (ids: string) {
  assert.deepEqual(desk(this).store.answerIds(), ids.split(','));
});
