import assert from 'node:assert/strict';
import { loadRegister, registerPath, type Loaded } from '../../src/application/load.js';
import { canonical } from '../../src/domain/register.js';
import { parseRegister } from '../../src/infrastructure/register-schema.js';
import { FsFiles } from '../../src/infrastructure/fs-files.js';
import { InMemoryFiles } from '../../src/infrastructure/in-memory-files.js';
import { Given, REPOSITORY, Then, When, type WatchWorld } from './support.js';

/** An in-memory repository from which a scenario can take a file away. */
class Repository extends InMemoryFiles {
  readonly removed = new Set<string>();

  override read(path: string): string | undefined {
    return this.removed.has(path) ? undefined : super.read(path);
  }

  override exists(path: string): boolean {
    return !this.removed.has(path) && super.exists(path);
  }
}

interface Scene {
  register: Record<string, unknown>;
  repository: Repository;
  text?: string;
  absent: boolean;
  loaded?: Loaded;
}
const scene = (world: WatchWorld): Scene => world.state['register'] as Scene;

Given('a watch register of one source of each kind over an in-memory repository', function () {
  const repository = new Repository();
  repository.write('m/package.json', JSON.stringify({ dependencies: { '@x/sdk': '1.0.0' } }));
  repository.write('src/a.ts', '');
  repository.write('idx.txt', 'https://code.claude.com/docs/en/a.md\n');
  this.state['register'] = {
    register: {
      sources: [
        { id: 'pin-a', kind: 'pin', package: '@x/sdk', manifests: ['m/package.json'] },
        {
          id: 'log',
          kind: 'changelog',
          url: 'https://raw.githubusercontent.com/x/y/main/CHANGELOG.md',
          read: { version: '1.2.3', on: '2026-11-16' },
        },
        {
          id: 'doc',
          kind: 'page',
          url: 'https://code.claude.com/docs/en/a.md',
          mechanisms: ['src/a.ts'],
          relies: 'the flags',
          read: { sha256: '0'.repeat(64), on: '2026-11-16' },
        },
        {
          id: 'idx',
          kind: 'index',
          url: 'https://code.claude.com/docs/llms.txt',
          pages: 'idx.txt',
        },
      ],
    },
    repository,
    absent: false,
  } satisfies Scene;
});

/** The container and the key of a dotted path; a numeric segment is an array index. */
function locate(root: unknown, path: string): [Record<string, unknown>, string] {
  const keys = path.split('.');
  const last = keys.pop() as string;
  let node = root as Record<string, unknown>;
  for (const key of keys) node = node[key] as Record<string, unknown>;
  return [node, last];
}

Given('the watch register field {string} is set to {string}', function (path: string, value: string) {
  const [node, key] = locate(scene(this).register, path);
  node[key] = JSON.parse(value);
});

Given('the watch register field {string} is removed', function (path: string) {
  const [node, key] = locate(scene(this).register, path);
  delete node[key];
});

Given('the watch register text is {string}', function (text: string) {
  scene(this).text = text;
});

Given('the watch register is absent', function () {
  scene(this).absent = true;
});

Given('the watch repository file {string} is removed', function (path: string) {
  scene(this).repository.removed.add(path);
});

Given('the watch repository holds the file {string} with {string}', function (path: string, text: string) {
  scene(this).repository.write(path, text);
});

When('the watch register is loaded', function () {
  const current = scene(this);
  if (!current.absent) {
    current.repository.write(registerPath(), current.text ?? JSON.stringify(current.register));
  }
  current.loaded = loadRegister(current.repository, parseRegister);
});

When('the register committed in this repository is loaded', function () {
  this.state['register'] = { loaded: loadRegister(new FsFiles(REPOSITORY), parseRegister) };
});

Then('the watch register is accepted', function () {
  const { loaded } = scene(this);
  assert.ok(loaded?.ok, loaded?.ok === false ? loaded.reason : 'not loaded');
});

// `read` rewrites the whole register: kept in the form the tool writes, a reading changes only what was read.
Then('the committed watch register is byte for byte what the tool would write of it', function () {
  const { loaded } = scene(this);
  assert.ok(loaded?.ok, loaded?.ok === false ? loaded.reason : 'not loaded');
  assert.equal(canonical(loaded.register), new FsFiles(REPOSITORY).read(registerPath()));
});

Then('the watch register is accepted with {int} sources', function (count: number) {
  const { loaded } = scene(this);
  assert.ok(loaded?.ok, loaded?.ok === false ? loaded.reason : 'not loaded');
  assert.equal(loaded.register.sources.length, count);
});

Then('the watch register is refused with a reason holding {string}', function (part: string) {
  const { loaded } = scene(this);
  assert.ok(loaded !== undefined && !loaded.ok, 'the register was accepted');
  assert.ok(loaded.reason.includes(part), loaded.reason);
  assert.ok(!loaded.reason.includes('\n'));
});
