import assert from 'node:assert/strict';
import {
  chmodSync,
  constants,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';
import {
  openFsStore,
  type FsStore,
  type OpenConstants,
  type Opened,
} from '../../src/infrastructure/fs-store.js';
import { Given, Then, When, type EvidenceWorld } from './support.js';
import { questionOf, rejectionOf, throwawayRoot } from './store.js';

const MEBIBYTE = 1024 * 1024;

interface Scene {
  root: string;
  ledger: string;
  desk: string;
  opened?: Opened;
  uid: number;
}

const scene = (world: EvidenceWorld): Scene => world.state['fs'] as Scene;
const storeOf = (world: EvidenceWorld): FsStore => {
  const opened = scene(world).opened as Opened;
  assert.ok(opened.ok);
  return opened.store;
};
const mode = (path: string): string => (statSync(path).mode & 0o777).toString(8);
const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
const inDesk = (world: EvidenceWorld, name: string): string => join(scene(world).desk, name);
const outside = (world: EvidenceWorld): string => join(scene(world).root, 'outside.txt');
const open = (world: EvidenceWorld, uid: number, flags: OpenConstants): void => {
  const current = scene(world);
  current.opened = openFsStore(current.ledger, current.desk, uid, flags);
};

Given('a throwaway evidence root', function () {
  const root = throwawayRoot(this);
  this.state['fs'] = {
    root,
    ledger: join(root, 'ledger'),
    desk: join(root, 'desk'),
    uid: process.getuid?.() as number,
  } satisfies Scene;
});

/** Prepares the ledger or the desk so that opening the store must refuse it, or accept it. */
Given('the evidence {word} folder is {string}', function (which: string, kind: string) {
  const current = scene(this);
  const folder = which === 'ledger' ? current.ledger : current.desk;
  if (kind === 'a regular file') writeFileSync(folder, 'x', { mode: 0o700 });
  else if (kind === 'a link to a directory') {
    const target = join(current.root, `${which}-target`);
    mkdirSync(target, { mode: 0o700 });
    symlinkSync(target, folder);
  } else if (kind === 'a directory of mode 755') {
    mkdirSync(folder);
    chmodSync(folder, 0o755);
  } else if (kind === 'under a missing parent') {
    Object.assign(current, { [which]: join(current.root, 'missing', which) });
  } else if (kind === 'under a regular file') {
    writeFileSync(join(current.root, 'file'), 'x');
    Object.assign(current, { [which]: join(current.root, 'file', which) });
  } else if (kind === 'under a linked parent') {
    const target = join(current.root, `${which}-parent-target`);
    mkdirSync(target, { mode: 0o700 });
    symlinkSync(target, join(current.root, `${which}-parent`));
    Object.assign(current, { [which]: join(current.root, `${which}-parent`, which) });
  } else if (kind === 'a directory of mode 700 holding a file') {
    mkdirSync(folder, { mode: 0o700 });
    writeFileSync(join(folder, 'kept.txt'), 'kept');
  } else {
    assert.fail(`unknown kind ${kind}`);
  }
});

/** A folder of the ledger or of the desk that is wrong, in a ledger or a desk that is right. */
Given(
  'in the evidence {word} folder, {string} is {string}',
  function (which: string, inside: string, kind: string) {
    const current = scene(this);
    const parent = which === 'ledger' ? current.ledger : current.desk;
    mkdirSync(parent, { mode: 0o700 });
    const folder = join(parent, inside);
    if (kind === 'a regular file') writeFileSync(folder, 'x');
    else {
      assert.equal(kind, 'a directory of mode 755');
      mkdirSync(folder);
      chmodSync(folder, 0o755);
    }
  },
);

When('the evidence file store is opened', function () {
  open(this, scene(this).uid, constants);
});

When('the evidence file store is opened again', function () {
  open(this, scene(this).uid, constants);
});

When('the evidence file store is opened as another user', function () {
  open(this, scene(this).uid + 1, constants);
});

When('the evidence file store is opened on a platform without O_NOFOLLOW', function () {
  open(this, scene(this).uid, { ...constants, O_NOFOLLOW: undefined });
});

When('the evidence file store is opened on a platform without O_NONBLOCK', function () {
  open(this, scene(this).uid, { ...constants, O_NONBLOCK: undefined });
});

Then('the evidence file store is open', function () {
  assert.equal((scene(this).opened as Opened).ok, true);
});

Then(
  'the evidence file store is refused with {string} on {string} saying {string}',
  function (code: string, folder: string, detail: string) {
    const current = scene(this);
    const opened = current.opened as Opened;
    assert.ok(!opened.ok);
    assert.deepEqual(opened.refusal, {
      code,
      folder: join(current.root, folder),
      detail,
    });
  },
);

Then('the evidence file store is refused as not owned on the ledger folder', function () {
  const current = scene(this);
  const opened = current.opened as Opened;
  assert.ok(!opened.ok);
  assert.deepEqual(opened.refusal, {
    code: 'FOLDER_NOT_OWNED',
    folder: current.ledger,
    detail: `owner is ${current.uid}, expected ${current.uid + 1}`,
  });
});

Then('the evidence ledger folder does not exist', function () {
  assert.equal(existsSync(scene(this).ledger), false);
});

Then('the evidence folders created are all of mode 700', function () {
  const { ledger, desk } = scene(this);
  const folders = [ledger, desk];
  for (const sub of ['asked', 'verified', 'sources']) folders.push(join(ledger, sub));
  for (const sub of ['out', 'in']) folders.push(join(desk, sub));
  assert.deepEqual(
    folders.map(mode),
    folders.map(() => '700'),
  );
});

Then('the evidence file {string} of the ledger still reads {string}', function (name: string, text: string) {
  assert.equal(readFileSync(join(scene(this).ledger, name), 'utf8'), text);
});

/** Files written by Science straight into the desk, as it would. */
Given('Science has written {string} in the desk as {string}', function (name: string, text: string) {
  mkdirSync(dirname(inDesk(this, name)), { recursive: true });
  writeFileSync(inDesk(this, name), text);
});

Given(
  'Science has written {string} in the desk as a text of {int} MiB and {int} bytes',
  function (name: string, mib: number, extra: number) {
    writeFileSync(inDesk(this, name), 'x'.repeat(mib * MEBIBYTE + extra));
  },
);

Given('a file outside the desk reads {string}', function (text: string) {
  writeFileSync(outside(this), text);
});

Given('a file outside the desk holds the rejection {string}', function (id: string) {
  writeFileSync(outside(this), json(rejectionOf(id)));
});

Given('Science has made {string} in the desk a link to the file outside the desk', function (name: string) {
  symlinkSync(outside(this), inDesk(this, name));
});

Given(
  'Science has made {string} in the desk a hard link to the file outside the desk',
  function (name: string) {
    linkSync(outside(this), inDesk(this, name));
  },
);

Given('Science has made {string} in the desk a link to a missing file', function (name: string) {
  symlinkSync(join(scene(this).root, 'missing.txt'), inDesk(this, name));
});

Given('Science has made {string} in the desk a folder', function (name: string) {
  mkdirSync(inDesk(this, name));
});

Given(
  'Science has written the rejection {string} as {string} in the desk',
  function (id: string, name: string) {
    writeFileSync(inDesk(this, name), JSON.stringify(rejectionOf(id)));
  },
);

Given('Science has written the rejection {string} with an unknown key', function (id: string) {
  writeFileSync(inDesk(this, `out/${id}.rejected.json`), JSON.stringify({ ...rejectionOf(id), extra: true }));
});

Given(
  'Science has written the rejection {string} padded to {int} bytes',
  function (id: string, size: number) {
    const text = JSON.stringify(rejectionOf(id));
    writeFileSync(inDesk(this, `out/${id}.rejected.json`), text + ' '.repeat(size - text.length));
  },
);

Given('Science has replaced the desk question {string} by another text', function (id: string) {
  writeFileSync(
    inDesk(this, `out/${id}.question.json`),
    JSON.stringify({ ...questionOf(id), question: 'forged' }),
  );
});

When('the evidence file store saves the question {string}', function (id: string) {
  storeOf(this).saveQuestion(questionOf(id));
});

When('the evidence file store saves the rejection {string}', function (id: string) {
  storeOf(this).saveRejection(rejectionOf(id));
});

When('the evidence file store publishes {string} with {string}', function (name: string, content: string) {
  storeOf(this).publish(name, content);
});

const verify = (store: FsStore, id: string, text: string): void =>
  store.saveVerified(
    {
      id,
      question: 'q',
      verified_at: '2026-11-14T12:00:00Z',
      level: 'quote_in_supplied_text',
      claims: [],
      not_found: ['x'],
    },
    new Map([['c'.repeat(64), text]]),
  );

When('the evidence file store verifies {string} with the text {string}', function (id: string, text: string) {
  verify(storeOf(this), id, text);
});

Then(
  'verifying {string} with the text {string} in the evidence file store fails',
  function (id: string, text: string) {
    assert.throws(
      () => verify(storeOf(this), id, text),
      (error: NodeJS.ErrnoException) => ['EISDIR', 'EPERM'].includes(error.code as string),
    );
  },
);

Then('the evidence root has the file {string}', function (name: string) {
  assert.ok(statSync(join(scene(this).root, name)).isFile());
});

Then('the evidence file store source text {string} is absent', function (name: string) {
  assert.equal(storeOf(this).sourceText(name), undefined);
});

Then(
  'the evidence file store source text {string} has {int} characters',
  function (name: string, size: number) {
    assert.equal(storeOf(this).sourceText(name)?.length, size);
  },
);

Then('the evidence file store source text {string} has {int} MiB', function (name: string, mib: number) {
  assert.equal(storeOf(this).sourceText(name)?.length, mib * MEBIBYTE);
});

Then('the evidence file store answer identifiers are {string}', function (ids: string) {
  assert.deepEqual(storeOf(this).answerIds(), ids.split(','));
});

Then('the evidence file store reads no answer {string}', function (id: string) {
  assert.equal(storeOf(this).answer(id), undefined);
});

Then('the evidence file store reads an answer {string} of {int} MiB', function (id: string, mib: number) {
  assert.equal(storeOf(this).answer(id)?.length, mib * MEBIBYTE);
});

Then('the evidence file store reads no rejection {string}', function (id: string) {
  assert.equal(storeOf(this).rejection(id), undefined);
});

Then('the evidence file store reads the rejection {string}', function (id: string) {
  assert.deepEqual(storeOf(this).rejection(id), rejectionOf(id));
});

Then('the evidence file store reads no question {string}', function (id: string) {
  assert.equal(storeOf(this).question(id), undefined);
});

Then('the evidence file store reads no verified record {string}', function (id: string) {
  assert.equal(storeOf(this).verified(id), undefined);
});

Then('the evidence file store reads the question {string} of the ledger', function (id: string) {
  assert.deepEqual(storeOf(this).question(id), questionOf(id));
});

const filesOf = (world: EvidenceWorld): string[] => {
  const files: string[] = [];
  const walk = (folder: string): void => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) walk(path);
      else files.push(relative(scene(world).root, path));
    }
  };
  walk(scene(world).root);
  return files.sort();
};

Then('the evidence root holds exactly these files:', function (table: { raw(): string[][] }) {
  assert.deepEqual(
    filesOf(this),
    table.raw().map((row) => row[0]),
  );
});

Then('every file of the evidence root is of mode 600', function () {
  const files = filesOf(this);
  assert.ok(files.length > 0);
  assert.deepEqual(
    files.map((file) => mode(join(scene(this).root, file))),
    files.map(() => '600'),
  );
});

Then('the evidence root file {string} reads {string}', function (name: string, text: string) {
  assert.equal(readFileSync(join(scene(this).root, name), 'utf8'), text);
});

Then(
  'the evidence root file {string} is the JSON of the question {string}',
  function (name: string, id: string) {
    assert.equal(readFileSync(join(scene(this).root, name), 'utf8'), json(questionOf(id)));
  },
);

Then(
  'the evidence root file {string} is the JSON of the rejection {string}',
  function (name: string, id: string) {
    assert.equal(readFileSync(join(scene(this).root, name), 'utf8'), json(rejectionOf(id)));
  },
);

Then('the evidence desk has no file {string}', function (name: string) {
  assert.equal(lstatSync(inDesk(this, name), { throwIfNoEntry: false }), undefined);
});

Then('the file outside the desk still reads {string}', function (text: string) {
  assert.equal(readFileSync(outside(this), 'utf8'), text);
});

Given(
  'Science has written a source whose name has {int} characters before {string}',
  function (length: number, suffix: string) {
    writeFileSync(inDesk(this, `in/${'n'.repeat(length)}${suffix}`), 'named');
  },
);

Then(
  'the evidence file store source text of a name of {int} characters is {string}',
  function (length: number, text: string) {
    assert.equal(storeOf(this).sourceText(`${'n'.repeat(length)}.txt`), text === 'absent' ? undefined : text);
  },
);

/** The descriptors this process holds open; `readdir` opens one itself, the same before and after. */
const openDescriptors = (): number => readdirSync('/dev/fd').length;

When(
  'the evidence file store reads the source {string} {int} times and publishes {string} {int} times',
  function (source: string, reads: number, published: string, writes: number) {
    const store = storeOf(this);
    this.state['descriptors'] = openDescriptors();
    for (let i = 0; i < reads; i += 1) assert.equal(store.sourceText(source), 'The text.');
    for (let i = 0; i < writes; i += 1) store.publish(published, 'x');
  },
);

Then('the evidence process holds as many open descriptors as before', function () {
  assert.equal(openDescriptors(), this.state['descriptors']);
});
