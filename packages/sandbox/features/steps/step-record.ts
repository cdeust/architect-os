import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { PassThrough } from 'node:stream';
import type { CodeProcess } from '../../src/code-tool.js';
import { stepRecordSchema } from '../../src/step-record.js';
import { stepDependencies, type StepDependencies } from '../../src/step-tool.js';
import { stepsFolder, type StepsFolder } from '../../src/steps-folder.js';
import type { TreeFingerprint } from '../../src/tree-fingerprint.js';
import { git } from './tree-fingerprint.js';
import { Given, PKG, Then, When, stored, type SandboxWorld } from './helpers.js';
import { repoOf } from './runner.js';

/** The part of the state of a step (steps/step-tool.ts) that these steps read and set. */
interface RecordStep {
  folder: string;
  published: Map<string, Record<string, string>>;
  taken: Set<string>;
  prepared: number[];
  fingerprint: TreeFingerprint | Error;
  fingerprints: number;
  rootRefusal?: Error;
  acceptedAdmission?: string;
  stdout: string;
  publication?: Error;
  rewrites: { file: string; content: string }[];
  missing: Set<string>;
}
const step = (world: SandboxWorld) => stored<RecordStep>(world, 'step');

const unescape = (text: string): string => text.replaceAll('\\n', '\n');

Given('the steps folder already holds the step {string}', function (name: string) {
  step(this).taken.add(name);
});

Given('the fingerprint of the worktree is a tree that is not clean', function () {
  step(this).fingerprint = { commit: '1'.repeat(40), tree: '2'.repeat(40), clean: false };
});

Given('the step is not launched from the root of its worktree: {string}', function (message: string) {
  step(this).rootRefusal = new Error(message);
});

Given('the fingerprint of the worktree fails with {string}', function (message: string) {
  step(this).fingerprint = new Error(message);
});

Given('the publication fails with {string}', function (message: string) {
  step(this).publication = new Error(message);
});

Given('the launcher file {string} is missing', function (file: string) {
  step(this).missing.add(file);
});

Given(
  'the build session rewrites the file {string} of the step folder with {string}',
  function (file: string, content: string) {
    step(this).rewrites.push({ file, content: unescape(content) });
  },
);

// --- what the step published ---------------------------------------------------------------------------------

const only = (world: SandboxWorld): Record<string, string> => {
  const { published } = step(world);
  assert.equal(published.size, 1, `published: ${[...published.keys()].join(' ')}`);
  return [...published.values()][0] as Record<string, string>;
};

const record = (world: SandboxWorld): Record<string, any> =>
  JSON.parse(only(world)['record.json'] as string) as Record<string, any>;

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

Then('the step published the folder {string} and nothing else', function (name: string) {
  assert.deepEqual([...step(this).published.keys()], [name]);
});

Then('the folder steps\\/ was prepared once, before any session', function () {
  assert.deepEqual(step(this).prepared, [0]);
});

Then('the folder steps\\/ was not prepared', function () {
  assert.deepEqual(step(this).prepared, []);
});

Then('the step published nothing', function () {
  assert.equal(step(this).published.size, 0);
});

Then('the fingerprint was taken {int} times', function (count: number) {
  assert.equal(step(this).fingerprints, count);
});

Then('the published files are exactly {string}', function (names: string) {
  assert.equal(Object.keys(only(this)).sort().join(' '), names);
});

Then('the published file {string} is exactly {string}', function (file: string, text: string) {
  assert.equal(only(this)[file], unescape(text));
});

Then('the published file {string} contains {string}', function (file: string, text: string) {
  assert.ok((only(this)[file] as string).includes(text));
});

Then('the published input files are those of the step folder, byte for byte', function () {
  const files = only(this);
  const inputs = Object.keys(files).filter((file) => file !== 'record.json');
  assert.ok(inputs.length >= 2);
  for (const file of inputs) {
    assert.ok(readFileSync(join(step(this).folder, file)).equals(Buffer.from(files[file] as string)), file);
  }
});

Then('the published record is accepted by the schema', function () {
  stepRecordSchema().parse(record(this));
});

Then('every input hash of the published record is the sha256 of the published file beside it', function () {
  const files = only(this);
  const { inputs } = record(this);
  assert.deepEqual(
    Object.keys(inputs).sort(),
    Object.keys(files)
      .filter((file) => file !== 'record.json')
      .sort(),
  );
  for (const [file, hash] of Object.entries(inputs)) assert.equal(hash, sha256(files[file] as string), file);
});

Then('the published record input {string} is the sha256 of {string}', function (file: string, text: string) {
  assert.equal(record(this)['inputs'][file], sha256(unescape(text)));
});

Then('the published record is JSON on two-space indentation with a final line break', function () {
  const text = only(this)['record.json'] as string;
  assert.equal(text, `${JSON.stringify(JSON.parse(text), null, 2)}\n`);
  assert.ok(text.startsWith('{\n  "step": "demo",\n'));
});

Then('the published record, without its launcher, is:', function (expected: string) {
  const { launcher, inputs, admission_sha256, ...rest } = record(this);
  const { acceptedAdmission } = step(this);
  assert.match(admission_sha256, /^[a-f0-9]{64}$/);
  assert.equal(admission_sha256, acceptedAdmission);
  assert.equal(typeof launcher, 'object');
  assert.deepEqual(Object.keys(inputs), ['brief.md', 'step.json', 'scout.files.md']);
  assert.deepEqual({ ...rest, inputs: 'the hashes' }, JSON.parse(expected));
});

Then('the published record launcher lists exactly {string}', function (files: string) {
  assert.deepEqual(Object.keys(record(this)['launcher']).sort(), files.split(' ').sort());
});

Then('the published record launcher holds the hash of each launcher file as the step read it', function () {
  const { launcher } = record(this);
  for (const [file, hash] of Object.entries(launcher)) {
    const read = /^(code|review|scout)\.json$/.test(file)
      ? readFileSync(join(PKG, file), 'utf8')
      : `fixed:${file}`;
    assert.equal(hash, sha256(read), file);
  }
});

const at = (value: unknown, path: string): unknown =>
  path.split('.').reduce<any>((inner, key) => inner?.[key], value);

Then('the published record field {string} is {}', function (path: string, json: string) {
  assert.deepEqual(at(record(this), path), JSON.parse(json));
});

Then(
  'the published record field {string} has its keys in the order {string}',
  function (path: string, keys: string) {
    assert.deepEqual(Object.keys(at(record(this), path) as object), keys.split(' '));
  },
);

Then('the published record lists the sessions {string}', function (names: string) {
  const sessions = record(this)['sessions'] as { role: string; name?: string }[];
  assert.equal(
    sessions.map(({ role, name }) => (name === undefined ? role : `${role}.${name}`)).join(' '),
    names,
  );
});

Then('the published record lists the checks {string}', function (names: string) {
  const checks = record(this)['checks'] as { name: string; passed: boolean }[];
  assert.equal(checks.map(({ name, passed }) => `${name}=${passed ? 'passed' : 'failed'}`).join(' '), names);
});

Then('the published record lists the reviews {string}', function (names: string) {
  const reviews = record(this)['reviews'] as { name: string; verdict: string; findings: number }[];
  assert.equal(
    reviews.map(({ name, verdict, findings }) => `${name}=${verdict}:${findings}`).join(' '),
    names,
  );
});

Then('no published file contains {string}', function (text: string) {
  for (const [file, content] of Object.entries(only(this))) assert.ok(!content.includes(text), file);
});

Then('the step stdout does not contain {string}', function (text: string) {
  assert.ok(!step(this).stdout.includes(text));
});

// --- the real dependencies ------------------------------------------------------------------------------------

Given('a throwaway git worktree', function () {
  // The linked worktree of a throwaway repository, at `<repo>/.claude/worktrees/w`: what `resolveWorktree` accepts.
  this.state['recordRoot'] = repoOf(this).worktree;
});

Given('a throwaway git repository that is not a linked worktree', function () {
  const root = mkdtempSync(join(tmpdir(), 'aos-rec-'));
  this.cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  git(root, 'init', '-q');
  this.state['recordRoot'] = root;
});

const dependenciesIn = (world: SandboxWorld, directory: string): void => {
  const proc = {
    argv: ['node', 'step.ts', '/a/b'],
    env: { INIT_CWD: directory },
    cwd: () => '/elsewhere',
    stdout: new PassThrough(),
    stderr: new PassThrough(),
  } as unknown as CodeProcess;
  world.state['recordDeps'] = stepDependencies(proc);
};

When('I build the step dependencies of a process whose INIT_CWD is that worktree', function () {
  dependenciesIn(this, stored<string>(this, 'recordRoot'));
});

When('I build the step dependencies of a process whose INIT_CWD is that repository', function () {
  dependenciesIn(this, stored<string>(this, 'recordRoot'));
});

When(
  'I build the step dependencies of a process whose INIT_CWD is the directory {string} of that worktree',
  function (directory: string) {
    const path = join(stored<string>(this, 'recordRoot'), directory);
    mkdirSync(path, { recursive: true });
    dependenciesIn(this, path);
  },
);

/** What a dependency throws, as the step tool would report it. */
const thrown = (act: () => unknown): string => {
  try {
    act();
  } catch (error) {
    return error instanceof Error ? `${error.constructor.name}: ${error.message}` : String(error);
  }
  return 'nothing thrown';
};

Then(
  'the step dependencies refuse the root, the fingerprint and the folder steps\\/ with {string}',
  function (message: string) {
    assert.equal(
      thrown(() => deps(this).root()),
      message,
    );
    assert.equal(
      thrown(() => deps(this).fingerprint()),
      message,
    );
    assert.equal(
      thrown(() => deps(this).steps.exists('demo')),
      message,
    );
    assert.equal(
      thrown(() => deps(this).steps.prepare()),
      message,
    );
    assert.equal(
      thrown(() => deps(this).steps.publish('demo', { 'a.md': 'A' })),
      message,
    );
  },
);

Then(
  'the step dependencies refuse the directory {string} of that worktree, naming both paths, and create nothing',
  function (directory: string) {
    const root = stored<string>(this, 'recordRoot');
    const below = join(root, directory);
    const listing = () => [
      readdirSync(root, { recursive: true, encoding: 'utf8' }).sort(),
      readdirSync(below),
    ];
    const before = listing();
    const message = `Refusal: une étape se lance depuis la racine de son worktree : ${below} n'est pas ${root}`;
    for (const act of [
      () => deps(this).root(),
      () => deps(this).fingerprint(),
      () => deps(this).steps.exists('demo'),
      () => deps(this).steps.prepare(),
      () => deps(this).steps.publish('demo', { 'a.md': 'A' }),
    ]) {
      assert.equal(thrown(act), message);
    }
    assert.deepEqual(listing(), before);
    assert.ok(!before[0]?.includes('steps'));
  },
);

Given('the file {string} beside the worktree holds the bytes {string}', function (name: string, hex: string) {
  const folder = mkdtempSync(join(tmpdir(), 'aos-rec-in-'));
  this.cleanups.push(() => rmSync(folder, { recursive: true, force: true }));
  writeFileSync(join(folder, name), Buffer.from(hex.replaceAll(' ', ''), 'hex'));
  this.state['recordInput'] = join(folder, name);
});

Then('the step dependencies read that file as the text {string}', function (text: string) {
  assert.equal(deps(this).readFile(stored<string>(this, 'recordInput')), JSON.parse(`"${text}"`));
});

Then('the step dependencies refuse to read that file with {string}', function (message: string) {
  assert.equal(
    thrown(() => deps(this).readFile(stored<string>(this, 'recordInput'))),
    message,
  );
});

Then('the step dependencies read no file at a path that does not exist', function () {
  assert.equal(deps(this).readFile(join(stored<string>(this, 'recordRoot'), 'absent.md')), undefined);
});

const deps = (world: SandboxWorld) => stored<StepDependencies>(world, 'recordDeps');

Then('the step dependencies read the launcher file {string} as the committed file', function (file: string) {
  assert.equal(deps(this).readLauncher(file), readFileSync(join(PKG, file), 'utf8'));
});

Then('the step dependencies give a date that is now', function () {
  const date = deps(this).date();
  assert.ok(date instanceof Date);
  assert.ok(Math.abs(date.getTime() - Date.now()) < 5000);
});

Then('the step dependencies fingerprint the worktree', function () {
  const root = stored<string>(this, 'recordRoot');
  assert.deepEqual(deps(this).fingerprint(), {
    commit: git(root, 'rev-parse', 'HEAD'),
    tree: git(root, 'rev-parse', 'HEAD^{tree}'),
    clean: true,
  });
});

Then(
  'the step dependencies publish {string} with the files {string} and {string} under steps\\/ of the worktree',
  function (name: string, first: string, second: string) {
    const root = stored<string>(this, 'recordRoot');
    deps(this).steps.prepare();
    deps(this).steps.publish(name, { [first]: 'A', [second]: 'B' });
    assert.equal(readFileSync(join(root, 'steps', name, first), 'utf8'), 'A');
    assert.equal(readFileSync(join(root, 'steps', name, second), 'utf8'), 'B');
    assert.equal(deps(this).steps.exists(name), true);
  },
);

// --- the real folder steps/ -----------------------------------------------------------------------------------

interface Worktree {
  root: string;
  worktree: string;
  outside: string;
  folder: StepsFolder;
  error?: unknown;
}
const tree = (world: SandboxWorld) => stored<Worktree>(world, 'recordWorktree');

Given('a temporary worktree', function () {
  const root = mkdtempSync(join(tmpdir(), 'aos-steps-'));
  // The mode of a file is asked of the process, not of the umask of the machine.
  const umask = process.umask(0);
  this.cleanups.push(() => {
    process.umask(umask);
    rmSync(root, { recursive: true, force: true });
  });
  const worktree = join(root, 'worktree');
  const outside = join(root, 'outside');
  mkdirSync(worktree);
  mkdirSync(outside);
  this.state['recordWorktree'] = {
    root,
    worktree,
    outside,
    folder: stepsFolder(() => worktree),
  } satisfies Worktree;
});

// --- the schema of the record, alone ---------------------------------------------------------------------------

const DIGEST = 'a'.repeat(64);
const validRecord = (): Record<string, unknown> => ({
  step: 'demo',
  startedAt: '2026-11-18T09:00:00.000Z',
  tree: { commit: 'b'.repeat(40), tree: 'c'.repeat(40), clean: true },
  inputs: { 'brief.md': DIGEST, 'step.json': DIGEST, 'scout.files.md': DIGEST },
  launcher: { 'code.json': DIGEST, 'prompts/build.md': DIGEST, 'profiles/builder.json': DIGEST },
  sessions: [
    {
      role: 'build',
      model: 'claude-sonnet-5-5',
      effort: 'medium',
      completed: true,
      stopped: false,
      durationSeconds: 12,
      costUsd: 0.5,
      costByModel: { 'claude-sonnet-5-5': 0.5 },
    },
    {
      role: 'review',
      name: 'correctness',
      model: 'claude-opus-5-5',
      effort: 'high',
      completed: true,
      stopped: false,
      durationSeconds: 0,
      costUsd: 0,
      costByModel: {},
    },
  ],
  checks: [{ name: 'types', passed: true, stopped: false, durationSeconds: 3 }],
  reviews: [{ name: 'correctness', verdict: 'accept', findings: 0 }],
  outcome: 'passed',
});

/** Sets, in `target`, the value at a dotted path; a key holding a dot is written between brackets: `inputs.[a.md]`. */
const setAt = (target: Record<string, unknown>, path: string, value: unknown): void => {
  const keys = [...path.matchAll(/\[([^\]]*)\]|([^.[\]]+)/g)].map(
    (match) => match[1] ?? (match[2] as string),
  );
  const last = keys.pop() as string;
  let node = target as Record<string, unknown>;
  for (const key of keys) node = node[key] as Record<string, unknown>;
  node[last] = value;
};

Given('a record of a step that the schema accepts', function () {
  const valid = validRecord();
  stepRecordSchema().parse(valid);
  this.state['schemaRecord'] = valid;
});

When('its field {string} becomes {}', function (path: string, json: string) {
  setAt(stored<Record<string, unknown>>(this, 'schemaRecord'), path, JSON.parse(json));
});

Then('the schema of the record refuses it', function () {
  assert.equal(stepRecordSchema().safeParse(stored(this, 'schemaRecord')).success, false);
});

Then('the schema of the record accepts it', function () {
  assert.equal(stepRecordSchema().safeParse(stored(this, 'schemaRecord')).success, true);
});

Then('the decoded historical session still has no exit code', function () {
  const [session] = stepRecordSchema().parse(stored(this, 'schemaRecord')).sessions;
  assert.ok(session);
  assert.equal(Object.hasOwn(session, 'exitCode'), false);
});

Given('a directory outside the worktree', function () {
  assert.deepEqual(readdirSync(tree(this).outside), []);
});

Given('the worktree has {string} as {}', function (path: string, kind: string) {
  const { worktree, outside } = tree(this);
  const target = join(worktree, path);
  mkdirSync(dirname(target), { recursive: true });
  if (kind === 'a file') writeFileSync(target, 'occupied\n');
  else if (kind === 'a directory') mkdirSync(target);
  else if (kind === 'a dangling link') symlinkSync('nowhere', target);
  else if (kind === 'a link to a directory outside') symlinkSync(outside, target);
  else assert.fail(`unknown kind: ${kind}`);
});

Then('the entry {string} of the worktree is still {}', function (path: string, kind: string) {
  const { worktree, outside } = tree(this);
  const target = join(worktree, path);
  const entry = lstatSync(target);
  if (kind === 'a file') {
    assert.ok(entry.isFile());
    assert.equal(readFileSync(target, 'utf8'), 'occupied\n');
  } else if (kind === 'a directory') {
    assert.ok(entry.isDirectory());
    assert.deepEqual(readdirSync(target), []);
  } else if (kind === 'a dangling link') {
    assert.equal(readlinkSync(target), 'nowhere');
  } else {
    assert.equal(readlinkSync(target), outside);
  }
});

Then('the real steps folder says that {string} does not exist', function (name: string) {
  assert.equal(tree(this).folder.exists(name), false);
});

Then('the real steps folder says that {string} exists', function (name: string) {
  assert.equal(tree(this).folder.exists(name), true);
});

Then(
  'the real steps folder refuses {string} with {string} when asked if it exists',
  function (name: string, message: string) {
    assert.throws(() => tree(this).folder.exists(name), { message });
  },
);

const files = (list: string[]): Record<string, string> =>
  Object.fromEntries(
    list.map((pair) => [pair.slice(0, pair.indexOf('=')), unescape(pair.slice(pair.indexOf('=') + 1))]),
  );

When(
  'the real steps folder publishes {string} with the files {string} and {string}',
  function (name: string, first: string, second: string) {
    tree(this).folder.publish(name, files([first, second]));
  },
);

When(
  'the real steps folder publishes {string} with the files {string}',
  function (name: string, first: string) {
    tree(this).folder.publish(name, files([first]));
  },
);

When('the real steps folder is prepared', function () {
  tree(this).folder.prepare();
});

When('I try to prepare the real steps folder', function () {
  const own = tree(this);
  try {
    own.folder.prepare();
  } catch (error) {
    own.error = error;
  }
});

When('I try to publish {string} with the real steps folder', function (name: string) {
  const own = tree(this);
  try {
    own.folder.publish(name, { 'a.md': 'A' });
  } catch (error) {
    own.error = error;
  }
});

Then('the publication is refused with {string}', function (message: string) {
  const { error } = tree(this);
  assert.ok(error instanceof Error);
  assert.equal(error.message, message);
});

Then('the worktree holds the file {string} with the text {string}', function (path: string, text: string) {
  assert.equal(readFileSync(join(tree(this).worktree, path), 'utf8'), unescape(text));
});

Then('the file {string} of the worktree has the mode {int}', function (path: string, mode: number) {
  // The mode is written in octal in the scenario: 0644 is read as the decimal 644.
  assert.equal(statSync(join(tree(this).worktree, path)).mode & 0o777, parseInt(String(mode), 8));
});

Then('the directory {string} of the worktree holds exactly {string}', function (path: string, names: string) {
  assert.equal(
    readdirSync(join(tree(this).worktree, path))
      .sort()
      .join(' '),
    names,
  );
});

Then('the directory outside the worktree is empty', function () {
  assert.deepEqual(readdirSync(tree(this).outside), []);
});

Then('the recorded subscription fixture {string} is {string}', function (kind: string, result: string) {
  const record = validRecord(),
    session = (record['sessions'] as Record<string, unknown>[])[0]!;
  const model = 'gpt-6.2-sol',
    response = {
      model,
      request: 1,
      terminal: 'completed',
      inputTokens: 2 as number | null,
      outputTokens: 3 as number | null,
    },
    usage = { inputTokens: 2 as number | null, outputTokens: 3 as number | null };
  Object.assign(session, {
    provider: 'openai',
    model,
    effort: 'medium',
    client: { version: 'codex-cli 0.170.0', sha256: DIGEST },
    usage,
    responses: [response],
    costUsd: null,
  });
  switch (kind) {
    case 'completed':
      break;
    case 'interrupted without usage':
      session['completed'] = false;
      response.terminal = 'interrupted';
      response.inputTokens = usage.inputTokens = null;
      response.outputTokens = usage.outputTokens = null;
      break;
    case 'mixed provider':
      session['provider'] = 'anthropic';
      break;
    case 'incomplete observed':
    case 'failed observed':
      session['completed'] = false;
      response.terminal = kind.split(' ')[0]!;
      break;
    case 'legacy unknown cost':
    case 'legacy client':
    case 'legacy responses':
    case 'legacy usage':
      session['provider'] = 'anthropic';
      session['costUsd'] = kind === 'legacy unknown cost' ? null : 0;
      if (kind !== 'legacy client') delete session['client'];
      if (kind !== 'legacy usage') delete session['usage'];
      if (kind !== 'legacy responses') delete session['responses'];
      break;
    case 'mixed terminals':
    case 'mixed models':
      session['responses'] = [
        response,
        {
          ...response,
          request: 2,
          terminal: kind === 'mixed terminals' ? 'failed' : 'completed',
          model: kind === 'mixed models' ? 'gpt-6.2-astra' : model,
        },
      ];
      usage.inputTokens = 4;
      usage.outputTokens = 6;
      break;
    case 'review role':
      session['role'] = 'review';
      break;
    case 'missing client':
      delete session['client'];
      break;
    case 'missing responses':
      delete session['responses'];
      break;
    case 'missing usage':
      delete session['usage'];
      break;
    case 'known price':
      session['costUsd'] = 0;
      break;
    case 'foreign model':
      session['model'] = response.model = 'other';
      break;
    case 'substituted response model':
      response.model = 'gpt-6.2-astra';
      break;
    case 'skipped request':
      response.request = 2;
      break;
    case 'input total':
      usage.inputTokens = 0;
      break;
    case 'output total':
      usage.outputTokens = 0;
      break;
    case 'empty completion':
      session['responses'] = [];
      usage.inputTokens = usage.outputTokens = 0;
      break;
    case 'failed completion':
      response.terminal = 'failed';
      break;
    default:
      assert.fail();
  }
  assert.equal(stepRecordSchema().safeParse(record).success, result === 'accepted');
});

import { buildRecord, type RecordedSession } from '../../src/step-record.js';
import type { ResponseReceipt } from '../../src/responses-proxy.js';
Then('building the Step record snapshots the response list and preserves missing evidence', function () {
  const model = 'gpt-6.2-sol';
  const receipt: ResponseReceipt = {
    model,
    request: 1,
    terminal: 'completed',
    inputTokens: 2,
    outputTokens: 3,
  };
  const collected = [receipt];
  const builder: RecordedSession = {
    role: 'build',
    provider: 'openai',
    client: { sha256: DIGEST, version: 'fixture' },
    config: { model, effort: 'high' },
    responses: collected,
    usage: { inputTokens: 2, outputTokens: 3 },
    exitCode: 0,
    completed: true,
    stopped: false,
    durationSeconds: 1,
    costUsd: 0,
    costByModel: {},
  };
  const parts = {
    step: 'fixture',
    startedAt: new Date(0),
    tree: { commit: '1'.repeat(40), tree: '2'.repeat(40), clean: true },
    inputs: {},
    launcher: {},
    sessions: [builder],
    checks: [],
    reviews: [],
    outcome: 'passed' as const,
  };
  const record = buildRecord(parts);
  collected.pop();
  assert.deepEqual(record.sessions[0]!.responses, [receipt]);
  delete builder.responses;
  assert.equal(buildRecord(parts).sessions[0]!.responses, undefined);
});
