import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { PassThrough } from 'node:stream';
import { ClaudeBuilder } from '../../src/builder.js';
import { closedGitOptions } from '../../src/git-closed.js';
import { checkoutIsClean } from '../../src/git-worktree.js';
import { InMemoryPassRepository } from '../../src/in-memory-pass-repository.js';
import {
  admitPass,
  commitPass,
  isWorkBranch,
  passMessage,
  PassRefusal,
  PASS_IDENTITY,
  type PassToCommit,
} from '../../src/pass-commit.js';
import { gitPassRepository } from '../../src/pass-repository.js';
import { requireStepAdmission } from '../../src/step-admission.js';
import { runStep, type StepDependencies } from '../../src/step-tool.js';
import { stepsFolder } from '../../src/steps-folder.js';
import { fingerprintTree, type TreeFingerprint } from '../../src/tree-fingerprint.js';
import { gitInFixture } from '../git-fixture.js';
import { admittedFixture } from './admission-fixture.js';
import { Given, PKG, Then, When, stored, type SandboxWorld } from './helpers.js';
import { fixtureGit } from './pass-repository.js';

const text = (value: string) => value.replaceAll('\\n', '\n');
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
/** The date of every pass commit of the scenarios below: 18 November 2026, 09:30 UTC, in seconds. */
const SECONDS = 1_794_994_200;

// --- the rules of the use case, on the in-memory adapter -------------------------------------------------------

interface Rules {
  repository: InMemoryPassRepository;
  start?: TreeFingerprint;
  branch?: string;
  end?: TreeFingerprint;
  published: string[];
  record: string;
  commit?: string;
  error?: unknown;
}
const rules = (world: SandboxWorld) => stored<Rules>(world, 'passRules');

Then('the work branch name {string} is {word}', function (name: string, verdict: string) {
  assert.ok(verdict === 'admitted' || verdict === 'refused');
  assert.equal(isWorkBranch(text(name)), verdict === 'admitted');
});

Given('a pass repository in memory on the branch {string}', function (branch: string) {
  const repository = new InMemoryPassRepository({ branch, files: { 'a.txt': 'first\n' } });
  this.state['passRules'] = { repository, published: [], record: '' } satisfies Rules;
});

Given('the head of the in-memory pass repository is detached', function () {
  rules(this).repository.detach();
});

Given(
  /^the (?:in-memory pass repository has the branch|head of the in-memory pass repository names the branch) "([^"]*)"(?: in its head)?$/,
  function (branch: string) {
    rules(this).repository.switchTo(branch);
  },
);

Given('the in-memory pass repository has {string} changed', function (path: string) {
  rules(this).repository.files.set(path, 'changed\n');
});

Given('the in-memory pass repository has lost {string}', function (path: string) {
  rules(this).repository.files.delete(path);
});

Given('the snapshot of the pass names another commit', function () {
  const r = rules(this);
  r.start = { ...r.repository.snapshot(), commit: 'f'.repeat(40) };
});

When('I admit the pass', function () {
  const r = rules(this);
  try {
    r.branch = admitPass(r.repository, r.start ?? r.repository.snapshot());
  } catch (error) {
    r.error = error;
  }
});

Then('the pass is refused with {string}', function (code: string) {
  const { error } = rules(this);
  assert.ok(error instanceof PassRefusal, `expected a refusal, got ${String(error)}`);
  assert.equal(error.code, code);
  assert.equal(error.message, code);
});

Then('the pass is admitted on the branch {string}', function (branch: string) {
  const r = rules(this);
  assert.equal(r.error, undefined);
  assert.equal(r.branch, branch);
});

Given('the pass {string} is admitted', function (name: string) {
  const r = rules(this);
  r.start = r.repository.snapshot();
  r.branch = admitPass(r.repository, r.start);
  assert.ok(name !== '');
});

Given(
  'the in-memory pass repository holds the published folder of the pass {string}',
  function (name: string) {
    const r = rules(this);
    r.record = `{"step":"${name}"}\n`;
    const files: Record<string, string> = {
      'brief.md': 'Build.\n',
      'step.json': '{}\n',
      'record.json': r.record,
    };
    for (const [file, content] of Object.entries(files))
      r.repository.files.set(`steps/${name}/${file}`, content);
    r.published = Object.keys(files);
  },
);

Given(
  'a pass repository in memory whose first commit is {string} with the tree {string}',
  function (commit: string, tree: string) {
    const repository = new InMemoryPassRepository({
      branch: 'work/demo',
      commit,
      tree,
      files: { 'a.txt': 'first\n' },
    });
    this.state['passRules'] = { repository, published: [], record: '' } satisfies Rules;
  },
);

Then(
  'its snapshot is the commit {string}, the tree {string} and clean, twice',
  function (commit: string, tree: string) {
    const { repository } = rules(this);
    assert.deepEqual(repository.snapshot(), { commit, tree, clean: true });
    assert.deepEqual(repository.snapshot(), { commit, tree, clean: true });
  },
);

Then('its snapshot is the commit {string}, another tree and not clean', function (commit: string) {
  const snapshot = rules(this).repository.snapshot();
  assert.equal(snapshot.commit, commit);
  assert.match(snapshot.tree, /^[0-9a-f]{40}$/);
  assert.notEqual(snapshot.tree, 'b'.repeat(40));
  assert.equal(snapshot.clean, false);
});

Given(
  'the end snapshot is taken, then the branch {string} of the in-memory pass repository moves',
  function (branch: string) {
    const r = rules(this);
    r.end = r.repository.snapshot();
    moveBranch(r, branch);
  },
);

const moveBranch = (r: Rules, branch: string) => {
  const { repository, start } = r;
  const other = repository.writeCommit({
    tree: (start as TreeFingerprint).tree,
    parent: (start as TreeFingerprint).commit,
    subject: 'Another commit',
    body: 'made during the pass',
    seconds: 0,
  });
  repository.branches.set(branch, other);
};

Given('the branch {string} of the in-memory pass repository has moved', function (branch: string) {
  moveBranch(rules(this), branch);
});

Given('the end snapshot of the pass names another commit', function () {
  const r = rules(this);
  r.end = { ...r.repository.snapshot(), commit: 'f'.repeat(40) };
});

Given('the in-memory pass repository refuses to advance the branch', function () {
  rules(this).repository.advance = () => false;
});

When('I commit the pass {string}', function (name: string) {
  const r = rules(this);
  try {
    r.commit = commitPass(r.repository, {
      name,
      branch: r.branch as string,
      start: r.start as TreeFingerprint,
      end: r.end ?? r.repository.snapshot(),
      published: r.published,
      record: r.record,
      seconds: SECONDS,
    });
  } catch (error) {
    r.error = error;
  }
});

Then('the pass is committed', function () {
  const r = rules(this);
  assert.equal(r.error, undefined);
  assert.match(r.commit ?? '', /^[0-9a-f]{40}$/);
});

Then(
  /^the branch "([^"]*)" of the in-memory pass repository is at (the commit of the pass|the start)$/,
  function (branch: string, where: string) {
    const r = rules(this);
    const expected = where === 'the start' ? r.start?.commit : r.commit;
    assert.equal(r.repository.branches.get(branch), expected);
  },
);

Then('the commit of the pass has the start for its parent and the end snapshot for its tree', function () {
  const r = rules(this);
  const commit = r.repository.commits.get(r.commit as string);
  assert.equal(commit?.parent, r.start?.commit);
  assert.equal(commit?.tree, r.repository.snapshot().tree);
});

Then(
  'the commit of the pass has the message of the pass {string} with the hash of its record, and the date of its start',
  function (name: string) {
    const r = rules(this);
    const commit = r.repository.commits.get(r.commit as string);
    assert.equal(
      commit?.message,
      `Record the pass ${name} of the loop\n\nrecord.json sha256 ${sha256(r.record)}\n`,
    );
    assert.equal(commit?.seconds, SECONDS);
  },
);

Then('the index of the in-memory pass repository is the tree of the commit of the pass', function () {
  const r = rules(this);
  assert.equal(r.repository.index, r.repository.commits.get(r.commit as string)?.tree);
});

Then('the next pass starts clean from the commit of the pass', function () {
  const r = rules(this);
  const next = r.repository.snapshot();
  assert.deepEqual([next.commit, next.clean], [r.commit, true]);
  assert.equal(admitPass(r.repository, next), r.branch);
});

Then(
  'the message of the pass {string} with the record {string} is {string} and {string}',
  function (name: string, record: string, subject: string, body: string) {
    assert.deepEqual(passMessage(name, text(record)), { subject, body });
  },
);

Then('no branch of the in-memory pass repository holds a commit of the pass', function () {
  const r = rules(this);
  for (const commit of r.repository.branches.values())
    assert.doesNotMatch(r.repository.commits.get(commit)?.message ?? '', /^Record the pass/);
});

// --- passes of npm run step on a throwaway linked worktree -----------------------------------------------------

interface Passes {
  repo: string;
  worktree: string;
  branch: string;
  first: string;
  parent: string;
  witness?: string;
  builds: number;
  played: Map<string, { code: number; stdout: string; stderr: string; brief: string; step: string }>;
}
const passes = (world: SandboxWorld) => stored<Passes>(world, 'passes');

const STEP_JSON = '{"build":{"model":"claude-sonnet-5-5","effort":"medium","limitSeconds":60}}\n';

Given('a throwaway linked worktree on the branch {string} for the passes', function (branch: string) {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'aos-passes-')));
  this.cleanups.push(() => rmSync(parent, { recursive: true, force: true }));
  const repo = join(parent, 'repo');
  const worktree = join(parent, 'worktree');
  mkdirSync(repo);
  fixtureGit(repo, 'init', '-q');
  fixtureGit(repo, 'checkout', '-q', '-b', 'main');
  writeFileSync(join(repo, 'README.md'), 'fixture\n');
  fixtureGit(repo, 'add', '-A');
  fixtureGit(repo, 'commit', '-q', '-m', 'first');
  fixtureGit(repo, 'worktree', 'add', '-q', '-b', branch, worktree);
  const first = fixtureGit(worktree, 'rev-parse', 'HEAD');
  this.state['passes'] = {
    repo,
    worktree,
    branch,
    first,
    parent,
    builds: 0,
    played: new Map(),
  } satisfies Passes;
});

Given('the worktree of the passes holds the uncommitted file {string}', function (path: string) {
  writeFileSync(join(passes(this).worktree, path), 'left\n');
});

/** Play one pass of `npm run step`, its build session doing `build` in the worktree and answering a stream. */
async function play(world: SandboxWorld, name: string, build: (worktree: string) => void): Promise<void> {
  const p = passes(world);
  const folder = join(p.parent, 'folders', name);
  mkdirSync(folder, { recursive: true });
  const brief = `Build the pass ${name}.\n`;
  writeFileSync(join(folder, 'step.json'), STEP_JSON);
  writeFileSync(join(folder, 'brief.md'), brief);
  const outputs = {
    retained: join(p.parent, 'out', name, 'retained'),
    streams: join(p.parent, 'out', name, 'streams'),
  };
  let stdout = '';
  let stderr = '';
  const out = new PassThrough().on('data', (chunk: Buffer) => (stdout += chunk.toString()));
  const err = new PassThrough().on('data', (chunk: Buffer) => (stderr += chunk.toString()));
  const session: StepDependencies['session'] = async (tool, _argv, _brief, _limit, onOutput) => {
    assert.equal(tool, 'code.json');
    p.builds++;
    build(p.worktree);
    onOutput(readFileSync(join(PKG, 'fixtures', 'build-exact.jsonl')));
    return { exitCode: 0, stopped: false };
  };
  const deps: StepDependencies = {
    folderArguments: [folder],
    readFile: (path) => (existsSync(path) ? readFileSync(path, 'utf8') : undefined),
    readSource: () => undefined,
    writeFile: (path, content) => writeFileSync(path, content),
    reserveOutputs: () => {
      mkdirSync(outputs.retained, { recursive: true });
      mkdirSync(outputs.streams, { recursive: true });
      return outputs;
    },
    appendFile: (path, content) => writeFileSync(path, content, { flag: 'a' }),
    session,
    builder: new ClaudeBuilder(session),
    check: async () => assert.fail('no check in these passes'),
    now: () => 0,
    date: () => new Date(SECONDS * 1000),
    root: () => p.worktree,
    fingerprint: () => fingerprintTree(p.worktree),
    readLauncher: (file) => readFileSync(join(PKG, file), 'utf8'),
    admit: (subject) => requireStepAdmission(admittedFixture(subject), subject),
    steps: stepsFolder(() => p.worktree),
    repository: gitPassRepository(() => p.worktree),
    stdout: out,
    stderr: err,
  };
  const code = await runStep(deps);
  p.played.set(name, { code, stdout, stderr, brief, step: STEP_JSON });
}

const write = (worktree: string, path: string, content = `${path}\n`) => {
  mkdirSync(dirname(join(worktree, path)), { recursive: true });
  writeFileSync(join(worktree, path), content);
};

When('the pass {string} is played, its build writing {string}', async function (name: string, path: string) {
  await play(this, name, (worktree) => write(worktree, path));
});

When(
  'the pass {string} is played, its build writing {string} with {string} and {string}',
  async function (name: string, path: string, content: string, other: string) {
    await play(this, name, (worktree) => {
      write(worktree, path, text(content));
      write(worktree, other);
    });
  },
);

When(
  'the pass {string} is played, its build committing on the branch and writing {string}',
  async function (name: string, path: string) {
    await play(this, name, (worktree) => {
      write(worktree, 'side.txt');
      fixtureGit(worktree, 'add', 'side.txt');
      fixtureGit(worktree, 'commit', '-q', '-m', 'side');
      this.state['sideCommit'] = fixtureGit(worktree, 'rev-parse', 'HEAD');
      write(worktree, path);
    });
  },
);

const played = (world: SandboxWorld, name: string) => {
  const found = passes(world).played.get(name);
  assert.ok(found, `the pass ${name} was not played`);
  return found;
};

Then('both passes exit with 0', function () {
  for (const name of ['p1', 'p2']) {
    const { code, stderr } = played(this, name);
    assert.equal(stderr, '');
    assert.equal(code, 0);
  }
});

Then('the pass {string} exits with 0', function (name: string) {
  const { code, stderr } = played(this, name);
  assert.equal(stderr, '');
  assert.equal(code, 0);
});

Then('the pass {string} exits with 2 and the stderr {string}', function (name: string, line: string) {
  const { code, stderr, stdout } = played(this, name);
  assert.deepEqual([code, stderr, stdout], [2, `${line}\n`, '']);
});

/** The pass commits of the work branch, oldest first. */
const passCommits = (p: Passes): string[] =>
  fixtureGit(p.worktree, 'rev-list', '--reverse', `${p.first}..refs/heads/${p.branch}`)
    .split('\n')
    .filter((line) => line !== '');

const nameOf = (p: Passes, commit: string): string =>
  /^Record the pass ([a-z0-9-]+) of the loop$/.exec(
    fixtureGit(p.worktree, 'log', '-1', '--format=%s', commit),
  )?.[1] ?? assert.fail(`not a pass commit: ${commit}`);

Then(
  'the work branch {string} holds two pass commits over its first commit, {string} then {string}',
  function (branch: string, one: string, two: string) {
    const p = passes(this);
    assert.equal(branch, p.branch);
    const commits = passCommits(p);
    assert.deepEqual(
      commits.map((commit) => nameOf(p, commit)),
      [one, two],
    );
    assert.equal(fixtureGit(p.worktree, 'rev-parse', `${commits[0]}^`), p.first);
    assert.equal(fixtureGit(p.worktree, 'rev-parse', `${commits[1]}^`), commits[0]);
    // One parent each: nothing merged.
    for (const commit of commits)
      assert.equal(fixtureGit(p.worktree, 'log', '-1', '--format=%P', commit).split(' ').length, 1);
  },
);

Then(
  'each pass commit is the fixed identity of the host, unsigned, with the hash of the record it holds',
  function () {
    const p = passes(this);
    const commits = passCommits(p);
    assert.ok(commits.length > 0);
    for (const commit of commits) {
      const name = nameOf(p, commit);
      const raw = fixtureGit(p.worktree, 'cat-file', 'commit', commit);
      const identity = `${PASS_IDENTITY.name} <${PASS_IDENTITY.email}> ${SECONDS} +0000`;
      const lines = raw.split('\n');
      assert.ok(lines.includes(`author ${identity}`), raw);
      assert.ok(lines.includes(`committer ${identity}`), raw);
      assert.doesNotMatch(raw, /^gpgsig/m);
      const record = gitInFixture(p.worktree, ['show', `${commit}:steps/${name}/record.json`]);
      assert.equal(
        fixtureGit(p.worktree, 'log', '-1', '--format=%B', commit),
        `Record the pass ${name} of the loop\n\nrecord.json sha256 ${sha256(record)}`,
      );
    }
  },
);

const recordOf = (p: Passes, commit: string, name: string) =>
  JSON.parse(gitInFixture(p.worktree, ['show', `${commit}:steps/${name}/record.json`])) as {
    tree: TreeFingerprint;
  };

Then(
  'the record of {string} starts clean from the first commit, and the record of {string} from the commit of {string}',
  function (one: string, two: string, again: string) {
    const p = passes(this);
    assert.equal(again, one);
    const [c1, c2] = passCommits(p) as [string, string];
    const tree = (commit: string) => fixtureGit(p.worktree, 'rev-parse', `${commit}^{tree}`);
    assert.deepEqual(recordOf(p, c1, one).tree, { commit: p.first, tree: tree(p.first), clean: true });
    assert.deepEqual(recordOf(p, c2, two).tree, { commit: c1, tree: tree(c1), clean: true });
  },
);

Then('the summary of each pass names its commit', function () {
  const p = passes(this);
  for (const commit of passCommits(p)) {
    const summary = JSON.parse(played(this, nameOf(p, commit)).stdout) as { commit: string; outcome: string };
    assert.equal(summary.commit, commit);
    assert.equal(summary.outcome, 'passed');
  }
});

Then('the worktree is clean for the fingerprint and for the guard of the checkout', function () {
  const p = passes(this);
  const fingerprint = fingerprintTree(p.worktree);
  assert.deepEqual(fingerprint, {
    commit: fixtureGit(p.worktree, 'rev-parse', `refs/heads/${p.branch}`),
    tree: fixtureGit(p.worktree, 'rev-parse', `refs/heads/${p.branch}^{tree}`),
    clean: true,
  });
  assert.equal(checkoutIsClean(p.worktree), true);
});

Then('a clone of the repository alone gives the start tree and the inputs of each pass', function () {
  const p = passes(this);
  const clone = join(p.parent, 'clone');
  gitInFixture(p.parent, ['clone', '-q', '--no-local', '--no-checkout', p.repo, clone]);
  for (const commit of passCommits(p)) {
    const name = nameOf(p, commit);
    const { tree } = recordOf(p, commit, name);
    assert.equal(fixtureGit(clone, 'rev-parse', `${tree.commit}^{tree}`), tree.tree);
    const { brief, step } = played(this, name);
    assert.equal(gitInFixture(clone, ['show', `${commit}:steps/${name}/brief.md`]), brief);
    assert.equal(gitInFixture(clone, ['show', `${commit}:steps/${name}/step.json`]), step);
    const record = gitInFixture(clone, ['show', `${commit}:steps/${name}/record.json`]);
    assert.equal(JSON.parse(record).inputs['brief.md'], sha256(brief));
  }
});

Then('the work branch {string} is still at its first commit', function (branch: string) {
  const p = passes(this);
  assert.equal(fixtureGit(p.worktree, 'rev-parse', `refs/heads/${branch}`), p.first);
});

Then('the work branch {string} is at the commit made during the pass', function (branch: string) {
  const p = passes(this);
  assert.equal(
    fixtureGit(p.worktree, 'rev-parse', `refs/heads/${branch}`),
    stored<string>(this, 'sideCommit'),
  );
});

Then('no build session of the passes was started', function () {
  assert.equal(passes(this).builds, 0);
});

Then(
  'the pass commit of {string} holds {string} with the bytes it has on disk',
  function (name: string, path: string) {
    const p = passes(this);
    const commit = passCommits(p).find((c) => nameOf(p, c) === name) as string;
    assert.equal(
      gitInFixture(p.worktree, ['show', `${commit}:${path}`]),
      readFileSync(join(p.worktree, path), 'utf8'),
    );
  },
);

// --- the attacks: programs that a configuration names, and their controls ---------------------------------------

/** The witness program: it leaves a mark, and as a filter (its first argument) turns what it reads to upper case. */
function witness(world: SandboxWorld): string {
  const p = passes(world);
  if (p.witness === undefined) {
    const folder = mkdtempSync(join(tmpdir(), 'aos-pass-witness-'));
    world.cleanups.push(() => rmSync(folder, { recursive: true, force: true }));
    p.witness = join(folder, 'witness');
    writeFileSync(
      p.witness,
      `#!/bin/sh\n: > '${p.witness}.ran'\nif [ "$1" = filter ]; then exec tr a-z A-Z; fi\nexit 0\n`,
    );
    chmodSync(p.witness, 0o755);
  }
  return p.witness;
}

const configure = (p: Passes, lines: string) => {
  const configuration = join(p.repo, '.git', 'config');
  writeFileSync(configuration, `${readFileSync(configuration, 'utf8')}${lines}`);
};

Given(
  'the configuration of the repository of the passes names a witness program as the clean filter {string}',
  function (filter: string) {
    configure(passes(this), `[filter "${filter}"]\n\tclean = ${witness(this)} filter\n`);
  },
);

Given(
  'the repository of the passes has the witness program as its hooks {string}, {string} and {string}',
  function (one: string, two: string, three: string) {
    const hooks = [one, two, three];
    const p = passes(this);
    const program = readFileSync(witness(this), 'utf8');
    for (const hook of hooks) {
      writeFileSync(join(p.repo, '.git', 'hooks', hook), program);
      chmodSync(join(p.repo, '.git', 'hooks', hook), 0o755);
    }
  },
);

Given(
  'the configuration of the repository of the passes names the directory {string} of the worktree as its hooks, with the witness program as its {string} and {string}',
  function (directory: string, one: string, two: string) {
    const hooks = [one, two];
    const p = passes(this);
    const program = readFileSync(witness(this), 'utf8');
    mkdirSync(join(p.worktree, directory));
    for (const hook of hooks) {
      writeFileSync(join(p.worktree, directory, hook), program);
      chmodSync(join(p.worktree, directory, hook), 0o755);
    }
    // Committed before the hooks are named, so that the pass starts from a clean tree and the setup runs none of them.
    fixtureGit(p.worktree, 'add', '-A');
    fixtureGit(p.worktree, 'commit', '-q', '-m', 'hooks');
    p.first = fixtureGit(p.worktree, 'rev-parse', 'HEAD');
    configure(p, `[core]\n\thooksPath = ${join(p.worktree, directory)}\n`);
  },
);

Given(
  'the configuration of the repository of the passes names the witness program as its file monitor',
  function () {
    configure(passes(this), `[core]\n\tfsmonitor = ${witness(this)}\n`);
  },
);

Given(
  'the configuration of the repository of the passes asks for signed commits with the witness program',
  function () {
    configure(passes(this), `[commit]\n\tgpgSign = true\n[gpg]\n\tprogram = ${witness(this)}\n`);
  },
);

const witnessRan = (world: SandboxWorld): boolean => existsSync(`${witness(world)}.ran`);

Then('the witness program of the passes has not run', function () {
  assert.equal(witnessRan(this), false);
});

Then('the witness program of the passes has run', function () {
  assert.equal(witnessRan(this), true);
});

When('a git without the options of the host adds the tree of the worktree of the passes', function () {
  gitInFixture(passes(this).worktree, ['add', '-A']);
});

When('a git without the options of the host moves a reference of the repository of the passes', function () {
  gitInFixture(passes(this).worktree, ['update-ref', 'refs/heads/control', 'HEAD']);
});

When(
  'a git without the options of the host is asked for the status of the worktree of the passes',
  function () {
    gitInFixture(passes(this).worktree, ['status', '--porcelain']);
  },
);

When('a git asked to sign writes a commit of the worktree of the passes', function () {
  // The witness signs nothing: git then refuses the commit, after it started the program.
  assert.throws(() =>
    gitInFixture(passes(this).worktree, [
      '-c',
      'user.name=t',
      '-c',
      'user.email=t@t',
      'commit-tree',
      '-S',
      '-m',
      'x',
      'HEAD^{tree}',
    ]),
  );
});

// --- a fake git that records what the pass commit gives it ------------------------------------------------------

interface FakeGit {
  bin: string;
  log: string;
  error?: unknown;
}
const fake = (world: SandboxWorld) => stored<FakeGit>(world, 'passFakeGit');

// A script of node, found through the PATH it is given. It reads what it must answer from files next to itself, never
// from the environment, which the adapter closes. For each call it writes its arguments, the names of its environment
// and the values of the variables of identity and date.
const FAKE_GIT = `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const answers = JSON.parse(fs.readFileSync(path.join(__dirname, 'answers.json'), 'utf8'));
const args = process.argv.slice(2);
const names = Object.keys(process.env).filter((name) => name !== '__CF_USER_TEXT_ENCODING').sort();
const own = Object.fromEntries(names.filter((name) => /^GIT_(AUTHOR|COMMITTER)_/.test(name)).map((name) => [name, process.env[name]]));
fs.appendFileSync(path.join(__dirname, 'calls.log'), JSON.stringify([args, names, own]) + '\\n');
const call = args.slice(10).join(' ');
const answer = answers[call];
if (answer && answer.fail) {
  process.stdout.write('MARKER\\n');
  process.stderr.write('MARKER\\n');
  process.exitCode = 3;
} else if (answer) process.stdout.write(answer.text);
else if (call.startsWith('rev-parse --symbolic-full-name')) process.stdout.write('refs/heads/work/demo\\n');
else if (call.startsWith('diff-tree')) process.stdout.write('steps/demo/record.json\\0');
else process.stdout.write('cccccccccccccccccccccccccccccccccccccccc\\n');
`;

const answers = (world: SandboxWorld, call: string, answer: { fail: true } | { text: string }) => {
  const file = join(fake(world).bin, 'answers.json');
  const known = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  writeFileSync(file, JSON.stringify({ ...known, [call]: answer }));
};

Given('a fake git for the pass commit that records its calls', function () {
  const bin = mkdtempSync(join(tmpdir(), 'aos-pass-bin-'));
  this.cleanups.push(() => rmSync(bin, { recursive: true, force: true }));
  writeFileSync(join(bin, 'git'), FAKE_GIT);
  chmodSync(join(bin, 'git'), 0o755);
  writeFileSync(join(bin, 'calls.log'), '');
  writeFileSync(join(bin, 'answers.json'), '{}');
  const before = process.env['PATH'];
  process.env['PATH'] = `${bin}:${before}`;
  this.cleanups.push(() => {
    process.env['PATH'] = before;
  });
  this.state['passFakeGit'] = { bin, log: join(bin, 'calls.log') } satisfies FakeGit;
});

Given('the fake git of the pass commit fails the call {string} with a marker', function (call: string) {
  answers(this, call, { fail: true });
});

Given(
  'the fake git of the pass commit answers the call {string} with {string}',
  function (call: string, answer: string) {
    answers(this, call, { text: `${answer}\n` });
  },
);

const C = 'c'.repeat(40);
const fakePass = (): PassToCommit => ({
  name: 'demo',
  branch: 'work/demo',
  start: { commit: C, tree: C, clean: true },
  end: { commit: C, tree: C, clean: false },
  published: ['record.json'],
  record: '{}\n',
  seconds: 1_763_458_200,
});

const commitThroughFake = (world: SandboxWorld) => {
  const f = fake(world);
  try {
    return commitPass(
      gitPassRepository(() => f.bin),
      fakePass(),
    );
  } catch (error) {
    f.error = error;
    return undefined;
  }
};

When('the host commits the pass {string} through the fake git', function (name: string) {
  assert.equal(name, 'demo');
  assert.equal(commitThroughFake(this), C);
  assert.equal(fake(this).error, undefined);
});

When('the host tries to commit the pass {string} through the fake git', function (name: string) {
  assert.equal(name, 'demo');
  commitThroughFake(this);
});

const fakeCalls = (world: SandboxWorld) =>
  readFileSync(fake(world).log, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as [string[], string[], Record<string, string>]);

Then(
  'the fake git of the pass commit was called, in this order, with:',
  function (table: { raw: () => string[][] }) {
    assert.deepEqual(
      fakeCalls(this).map(([args]) => args.slice(10).join(' ')),
      table.raw().map(([call]) => (call as string).trim()),
    );
  },
);

Then('each call of the fake git of the pass commit came after the closed options of the host', function () {
  for (const [args] of fakeCalls(this)) assert.deepEqual(args.slice(0, 10), closedGitOptions());
});

const CONFIGURATION = [
  'GIT_ATTR_NOSYSTEM',
  'GIT_CONFIG_GLOBAL',
  'GIT_CONFIG_NOSYSTEM',
  'GIT_CONFIG_SYSTEM',
  'GIT_NO_REPLACE_OBJECTS',
];

Then(
  'each call of the fake git of the pass commit received the closed environment, and commit-tree alone the identity of the host at the date {int}',
  function (seconds: number) {
    const host = ['PATH', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TMPDIR'].filter(
      (name) => process.env[name] !== undefined,
    );
    const identity = {
      GIT_AUTHOR_DATE: `${seconds} +0000`,
      GIT_AUTHOR_EMAIL: PASS_IDENTITY.email,
      GIT_AUTHOR_NAME: PASS_IDENTITY.name,
      GIT_COMMITTER_DATE: `${seconds} +0000`,
      GIT_COMMITTER_EMAIL: PASS_IDENTITY.email,
      GIT_COMMITTER_NAME: PASS_IDENTITY.name,
    };
    for (const [args, names, own] of fakeCalls(this)) {
      const committing = args[10] === 'commit-tree';
      assert.deepEqual(
        names,
        [...host, ...CONFIGURATION, ...(committing ? Object.keys(identity) : [])].sort(),
      );
      assert.deepEqual(own, committing ? identity : {});
    }
  },
);

Then('the pass commit throws {string}', function (message: string) {
  const { error } = fake(this);
  assert.ok(
    error instanceof Error && !(error instanceof PassRefusal),
    `expected a failure, got ${String(error)}`,
  );
  assert.equal(error.message, message);
});

Then('the pass commit error does not contain {string}', function (marker: string) {
  assert.doesNotMatch(String(fake(this).error), new RegExp(marker));
});

Then('the pass commit is refused with {string}', function (code: string) {
  const { error } = fake(this);
  assert.ok(error instanceof PassRefusal);
  assert.equal(error.code, code);
});
