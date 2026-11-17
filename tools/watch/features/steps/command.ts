import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { PassThrough } from 'node:stream';
import { runWatch, watchDependencies, type WatchDependencies } from '../../src/main.js';
import { sceneOf } from './sources.js';
import { fakeFetch, Given, Then, throwawayRoot, unescape, When, type WatchWorld } from './support.js';

interface Scene {
  /** The folder that holds the repository and the folder of --keep: the working directory of the command. */
  root: string;
  before: Map<string, string>;
  stdout: string;
  stderr: string;
  code?: number;
}
const scene = (world: WatchWorld): Scene => world.state['command'] as Scene;
const repository = (current: Scene): string => join(current.root, 'repo');

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');
const HOST = 'https://code.claude.com';
const PAGE = `${HOST}/docs/en`;

/** Midnight has already passed in UTC, not yet where the clock was set: `on` is the UTC date. */
const NOW = new Date('2026-11-17T23:30:00-05:00');

const STANDARD = {
  sources: [
    { id: 'sdk', kind: 'pin', package: '@x/sdk', manifests: ['m/a/package.json', 'm/b/package.json'] },
    { id: 'rt', kind: 'pin', package: '@x/rt', manifests: ['m/rt.json'] },
    {
      id: 'cc-log',
      kind: 'changelog',
      url: 'https://raw.githubusercontent.com/x/cc/main/CHANGELOG.md',
      read: { version: '2.1.325', on: '2026-11-16' },
    },
    { id: 'sdk-log', kind: 'changelog', url: 'https://raw.githubusercontent.com/x/sdk/main/CHANGELOG.md' },
    {
      id: 'headless',
      kind: 'page',
      url: `${PAGE}/headless.md`,
      mechanisms: ['a.ts', 'b.ts'],
      relies: 'The flags.',
      read: { sha256: sha256('hello'), on: '2026-11-16' },
    },
    {
      id: 'settings',
      kind: 'page',
      url: `${PAGE}/settings.md`,
      mechanisms: ['a.ts'],
      relies: 'The keys.',
      read: { sha256: sha256('hello'), on: '2026-11-16' },
    },
    {
      id: 'docs',
      kind: 'index',
      url: `${HOST}/docs/llms.txt`,
      pages: 'tools/watch/indexes/docs.txt',
    },
    {
      id: 'plat',
      kind: 'index',
      url: 'https://platform.claude.com/llms.txt',
      pages: 'tools/watch/indexes/plat.txt',
    },
    {
      id: 'gone',
      kind: 'page',
      url: 'https://platform.claude.com/docs/en/gone.md',
      mechanisms: ['b.ts'],
      relies: 'Gone.',
      read: { sha256: sha256('gone'), on: '2026-11-16' },
    },
  ],
};

function put(current: Scene, path: string, text: string): void {
  const file = join(repository(current), path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}

const manifest = (name: string, version: string): string =>
  JSON.stringify({ dependencies: { [name]: version } });

Given('a watch repository on disk holding the register:', function (register: string) {
  this.state['command'] = {
    root: throwawayRoot(this),
    before: new Map(),
    stdout: '',
    stderr: '',
  } satisfies Scene;
  put(scene(this), 'tools/watch/watch.json', `${register}\n`);
});

Given('the standard watch repository on disk', function () {
  const current: Scene = { root: throwawayRoot(this), before: new Map(), stdout: '', stderr: '' };
  this.state['command'] = current;
  put(current, 'tools/watch/watch.json', `${JSON.stringify(STANDARD, null, 2)}\n`);
  put(current, 'm/a/package.json', manifest('@x/sdk', '0.3.325'));
  put(current, 'm/b/package.json', manifest('@x/sdk', '0.3.325'));
  put(current, 'm/rt.json', manifest('@x/rt', '1.0.0'));
  put(current, 'a.ts', '');
  put(current, 'b.ts', '');
  put(current, 'tools/watch/indexes/docs.txt', `${PAGE}/a.md\n${PAGE}/b.md\n`);
  put(current, 'tools/watch/indexes/plat.txt', 'https://platform.claude.com/docs/en/p.md\n');
});

Given('the standard watch answers', function () {
  const { answers } = sceneOf(this);
  const body = (url: string, text: string): void => void answers.set(url, { body: text });
  body('https://registry.npmjs.org/@x/sdk/latest', '{"version":"0.3.326"}');
  body('https://registry.npmjs.org/@x/rt/latest', '{"version":"1.0.0"}');
  body(
    'https://raw.githubusercontent.com/x/cc/main/CHANGELOG.md',
    '# Changelog\n\n## 2.1.326\n- a\n\n## 2.1.325\n- b\n',
  );
  body('https://raw.githubusercontent.com/x/sdk/main/CHANGELOG.md', '## 0.3.4\n## 0.3.3\n');
  body(`${PAGE}/headless.md`, 'hello!');
  body(`${PAGE}/settings.md`, 'hello');
  body(`${HOST}/docs/llms.txt`, `- [A](${PAGE}/a.md)\n- [C](${PAGE}/c.md)\n`);
  body('https://platform.claude.com/llms.txt', 'https://platform.claude.com/docs/en/p.md\n');
});

Given(
  'the watch repository on disk holds the file {string} with {string}',
  function (path: string, text: string) {
    put(scene(this), path, unescape(text));
  },
);

Given('the watch repository on disk holds the file {string}:', function (path: string, text: string) {
  put(scene(this), path, text);
});

Given('the watch command folder holds a file {string}', function (name: string) {
  writeFileSync(join(scene(this).root, name), 'a file');
});

/** Every file under a folder, by relative path. */
function snapshot(folder: string): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (relative: string): void => {
    for (const name of readdirSync(join(folder, relative))) {
      const path = join(relative, name);
      if (statSync(join(folder, path)).isDirectory()) walk(path);
      else files.set(path, readFileSync(join(folder, path), 'utf8'));
    }
  };
  walk('');
  return files;
}

function dependencies(
  world: WatchWorld,
  argv: readonly string[],
  out: { stdout: string; stderr: string },
): WatchDependencies {
  const current = scene(world);
  const answers = sceneOf(world);
  return {
    argv,
    cwd: current.root,
    root: repository(current),
    stdout: { write: (text: string) => void (out.stdout += text) },
    stderr: { write: (text: string) => void (out.stderr += text) },
    fetch: fakeFetch(answers.answers, answers.requests),
    clock: () => NOW,
    limits: answers.limits,
  };
}

When('I run watch with the arguments {string}', async function (args: string) {
  const current = scene(this);
  current.before = snapshot(repository(current));
  const words = args.length === 0 ? [] : args.split(' ');
  const out = { stdout: '', stderr: '' };
  current.code = await runWatch(dependencies(this, words, out));
  current.stdout = out.stdout;
  current.stderr = out.stderr;
});

Then('the watch exit code is {int}', function (code: number) {
  const current = scene(this);
  assert.equal(current.code, code, `${current.stdout}${current.stderr}`);
});

Then('the watch stdout is:', function (expected: string) {
  assert.equal(scene(this).stdout, `${expected}\n`);
});

Then('the watch stderr is empty', function () {
  assert.equal(scene(this).stderr, '');
});

Then('the watch stdout is empty', function () {
  assert.equal(scene(this).stdout, '');
});

Then('the watch stderr is the line:', function (expected: string) {
  assert.equal(scene(this).stderr, `${expected}\n`);
});

Then('the watch stderr is one line starting with {string}', function (start: string) {
  const { stderr } = scene(this);
  assert.ok(stderr.startsWith(start), stderr);
  assert.equal(stderr.indexOf('\n'), stderr.length - 1, stderr);
});

Then('the watch command made no request', function () {
  assert.equal(sceneOf(this).requests.length, 0);
});

/** The paths that are new, or whose text changed, since the command started. */
function changed(current: Scene): string[] {
  const after = snapshot(repository(current));
  return [...after]
    .filter(([path, text]) => current.before.get(path) !== text)
    .map(([path]) => path)
    .sort();
}

Then('the watch repository on disk is unchanged', function () {
  assert.deepEqual(changed(scene(this)), []);
  assert.equal(snapshot(repository(scene(this))).size, scene(this).before.size);
});

Then('the watch repository on disk changed only {string}', function (paths: string) {
  assert.deepEqual(changed(scene(this)), paths.split(', ').sort());
});

Then(
  'the watch file {string} of the repository on disk reads {string}',
  function (path: string, text: string) {
    assert.equal(readFileSync(join(repository(scene(this)), path), 'utf8'), unescape(text));
  },
);

Then(
  'the watch register on disk differs from before only in the read of the sources {string}',
  function (ids: string) {
    const current = scene(this);
    const path = join('tools', 'watch', 'watch.json');
    const after = readFileSync(join(repository(current), path), 'utf8');
    const before = JSON.parse(current.before.get(path) as string) as { sources: Record<string, unknown>[] };
    const now = JSON.parse(after) as { sources: Record<string, unknown>[] };
    assert.equal(after, `${JSON.stringify(now, null, 2)}\n`);
    const read = ids.split(', ');
    assert.equal(now.sources.length, before.sources.length);
    now.sources.forEach((source, index) => {
      const old = before.sources[index] as Record<string, unknown>;
      if (read.includes(source['id'] as string)) {
        assert.deepEqual({ ...source, read: undefined }, { ...old, read: undefined });
        const keys = (value: Record<string, unknown>): string[] =>
          Object.keys(value).filter((key) => key !== 'read');
        assert.deepEqual(keys(source), keys(old));
      } else {
        assert.deepEqual(source, old);
      }
    });
  },
);

Then('the watch register on disk is byte for byte what it was', function () {
  const current = scene(this);
  const path = join('tools', 'watch', 'watch.json');
  assert.equal(readFileSync(join(repository(current), path), 'utf8'), current.before.get(path));
});

Then(
  'the watch source {string} of the register on disk is read on {string} as:',
  function (id: string, on: string, expected: string) {
    const current = scene(this);
    const register = JSON.parse(
      readFileSync(join(repository(current), 'tools/watch/watch.json'), 'utf8'),
    ) as { sources: { id: string; read: unknown }[] };
    const source = register.sources.find((candidate) => candidate.id === id);
    assert.deepEqual(source?.read, { ...(JSON.parse(expected) as object), on });
  },
);

const kept = (current: Scene): string => join(current.root, 'keep');

Then('the watch keep folder holds only {string}', function (names: string) {
  assert.deepEqual([...snapshot(kept(scene(this))).keys()].sort(), names.split(', ').sort());
});

Then('the watch keep file {string} reads {string}', function (name: string, text: string) {
  assert.equal(readFileSync(join(kept(scene(this)), name), 'utf8'), unescape(text));
});

Then('the watch command folder holds the file {string}', function (name: string) {
  assert.ok(statSync(join(scene(this).root, name)).isFile());
});

Then('the watch keep folder does not exist', function () {
  assert.throws(() => statSync(kept(scene(this))));
});

Then('the watch output and the files written in the repository hold none of:', function (table) {
  const current = scene(this);
  const texts = (table.raw() as string[][]).map(([cell]) => unescape(cell as string));
  const after = snapshot(repository(current));
  const held = [current.stdout, current.stderr];
  for (const [path, text] of after) if (current.before.get(path) !== text) held.push(text);
  for (const text of texts) {
    for (const where of held) assert.ok(!where.includes(text), `${JSON.stringify(text)} found in ${where}`);
  }
});

Then('the watch output holds {string}', function (text: string) {
  assert.ok(scene(this).stdout.includes(unescape(text)), scene(this).stdout);
});

When('I build the watch dependencies of a fake process with the arguments {string}', function (args: string) {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const proc = { argv: args.split(' '), stdout, stderr, cwd: () => '/work' };
  this.state['dependencies'] = { proc, deps: watchDependencies(proc), before: Date.now() };
});

interface Built {
  proc: { stdout: PassThrough; stderr: PassThrough };
  deps: WatchDependencies;
  before: number;
}
const built = (world: WatchWorld): Built => world.state['dependencies'] as Built;

Then(
  'the watch dependencies hold the arguments {string} and the working directory of that process',
  function (args: string) {
    const { deps } = built(this);
    assert.deepEqual(deps.argv, args.split(' '));
    assert.equal(deps.cwd, '/work');
  },
);

Then(
  'the watch dependencies write to the streams of that process and use the clock and the fetch of node, with the limits of the design',
  function () {
    const { deps, proc, before } = built(this);
    assert.equal(deps.stdout, proc.stdout);
    assert.equal(deps.stderr, proc.stderr);
    assert.equal(deps.fetch, fetch);
    const now = deps.clock().getTime();
    assert.ok(now >= before && now <= Date.now());
    assert.deepEqual(deps.limits, { timeoutMs: 30_000, maxBytes: 8 * 1024 * 1024 });
  },
);

Then('the watch dependencies hold the root of this repository', function () {
  assert.equal(built(this).deps.root, new URL('../../../../', import.meta.url).pathname);
});
