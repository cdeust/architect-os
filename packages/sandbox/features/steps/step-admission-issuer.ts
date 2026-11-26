import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs, {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import os, { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { dirname, isAbsolute, join } from 'node:path';
import { mock } from 'node:test';
import {
  issueStepAdmission,
  productionAdmissionHost,
  type AdmissionHost,
  type AdmissionRequest,
  type ApprovedPlan,
  type IssuedAdmission,
} from '../../src/step-admission-issuer.js';
import {
  readStepAdmission,
  requireStepAdmission,
  stepAdmissionAuthority,
  type StepAdmissionSubject,
} from '../../src/step-admission.js';
import { parseStepFile } from '../../src/step-file.js';
import { launcherFiles } from '../../src/step-tool.js';
import { fingerprintTree } from '../../src/tree-fingerprint.js';
import { measuredSpecimens } from './admission-fixture.js';
import { Given, PKG, Then, When, stored, type SandboxWorld } from './helpers.js';
import { repoOf } from './runner.js';

const hash = (text: string) => createHash('sha256').update(text).digest('hex');

interface Issuance {
  root: string;
  repo: string;
  worktree: string;
  authority: string;
  request: AdmissionRequest & { plan: ApprovedPlan; specimens: unknown };
  host: AdmissionHost;
  issued?: IssuedAdmission;
  refusal?: string;
  restore: (() => void)[];
}
const issuance = (world: SandboxWorld) => stored<Issuance>(world, 'issuance');

const mutable = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

Given('an approved Step folder for a clean linked worktree with measured specimens', function () {
  const { root: repoRoot, worktree } = repoOf(this);
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'aos-admit-')));
  this.cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const folder = join(root, 'intake', 'delivery');
  mkdirSync(folder, { recursive: true });
  const step = {
    build: { model: 'claude-sonnet-5-5', effort: 'medium', limitSeconds: 600 },
    scouts: [{ name: 'history', model: 'claude-haiku-5', effort: 'low', limitSeconds: 300 }],
    reviews: [{ name: 'quality', model: 'claude-opus-5-5', effort: 'high', limitSeconds: 900 }],
    acceptance: ['AC-001'],
  };
  const files: Record<string, string> = {
    'brief.md': '# Approved plan inputs\n\nDeliver the verified commit.\n',
    'scout.history.md': 'Where is the CI-only stop enforced?\n',
    'step.json': JSON.stringify(step, null, 2) + '\n',
  };
  for (const [name, text] of Object.entries(files)) writeFileSync(join(folder, name), text);
  const define = hash('reviewed Define');
  const manifest = {
    version: 1 as const,
    run_id: 'run_delivery_demo',
    step: 'delivery',
    source_sha256: {
      define,
      proposal: hash('reviewed proposal'),
      reviewed_plan: hash('reviewed Plan receipt'),
      policy: hash('policy'),
    },
    files_sha256: Object.fromEntries(Object.entries(files).map(([name, text]) => [name, hash(text)])),
  };
  const review = (drafter: string, reviewer: string) => ({
    drafter: { provider: 'openai' as const, model: drafter },
    reviewer: { provider: 'google' as const, model: reviewer },
    status: 'clear' as const,
  });
  const plan: ApprovedPlan = {
    manifest,
    approval_sha256: hash(JSON.stringify(manifest)),
    define: { sha256: define, review: review('define-author', 'define-reviewer') },
    plan: {
      sha256: manifest.source_sha256.proposal,
      define_sha256: define,
      raw_receipt_sha256: manifest.source_sha256.reviewed_plan,
      review: review('plan-author', 'plan-reviewer'),
    },
  };
  const readLauncher = (file: string) => readFileSync(join(PKG, file), 'utf8');
  const launcher = launcherFiles(readLauncher, parseStepFile(step));
  const authority = join(root, 'home', '.config', 'architect-os', 'step-admission');
  this.state['issuance'] = {
    root,
    repo: join(repoRoot, 'repo'),
    worktree,
    authority,
    request: { plan, specimens: measuredSpecimens(parseStepFile(step), launcher), folder, worktree },
    host: {
      readLauncher,
      fingerprint: (path) => fingerprintTree(path),
      authority: () => authority,
      uid: () => process.getuid!(),
    },
    restore: [],
  } satisfies Issuance;
});

type Specimen = ReturnType<typeof measuredSpecimens>[number];

const changes: Record<string, (item: Issuance) => void> = {
  'no specimens': (item) => (item.request.specimens = undefined),
  'an empty specimen list': (item) => (item.request.specimens = []),
  'a missing build specimen': (item) =>
    (item.request.specimens = (item.request.specimens as Specimen[]).filter(({ role }) => role !== 'build')),
  'an extra specimen': (item) => {
    const specimens = item.request.specimens as Specimen[];
    specimens.push({ ...mutable(specimens[0]!), role: 'scout:other' });
  },
  'a specimen for another prompt': (item) =>
    ((item.request.specimens as Specimen[])[0]!.prompt_sha256 = hash('another prompt')),
  'a specimen for another model': (item) =>
    ((item.request.specimens as Specimen[])[0]!.model.model = 'claude-haiku-5'),
  'a specimen for another provider': (item) =>
    ((item.request.specimens as Specimen[])[0]!.model.provider = 'openai'),
  'a failed replay': (item) =>
    ((item.request.specimens as Specimen[])[0]!.results[0]!.observed = { verdict: 'refuse', findings: [] }),
  'a review specimen without criteria': (item) => {
    const review = (item.request.specimens as Specimen[]).find(({ role }) => role === 'review:quality')!;
    const plain = { id: 'plain', input_sha256: hash('plain'), expected: { verdict: 'pass', findings: [] } };
    review.cases_sha256 = hash(JSON.stringify([plain]));
    review.results = [{ ...plain, observed: plain.expected }] as unknown as typeof review.results;
  },
  'a folder of another name': (item) => {
    const other = join(dirname(item.request.folder), 'other');
    fs.renameSync(item.request.folder, other);
    Object.assign(item.request, { folder: other });
  },
  'a Step name Step refuses': (item) => {
    const named = join(dirname(item.request.folder), 'Delivery-');
    fs.renameSync(item.request.folder, named);
    Object.assign(item.request, { folder: named });
    Object.assign(item.request.plan.manifest, { step: 'Delivery-' });
  },
  'a relative folder': (item) => Object.assign(item.request, { folder: 'intake/delivery' }),
  'a changed brief': (item) => writeFileSync(join(item.request.folder, 'brief.md'), 'Another task.\n'),
  'a missing brief': (item) => rmSync(join(item.request.folder, 'brief.md')),
  'a brief that is a directory': (item) => {
    rmSync(join(item.request.folder, 'brief.md'));
    mkdirSync(join(item.request.folder, 'brief.md'));
  },
  'a brief that is a named pipe': (item) => {
    rmSync(join(item.request.folder, 'brief.md'));
    execFileSync('mkfifo', [join(item.request.folder, 'brief.md')]);
  },
  'a brief that is not UTF-8': (item) =>
    writeFileSync(join(item.request.folder, 'brief.md'), Buffer.from([0x23, 0xff, 0x0a])),
  'a missing step file': (item) => rmSync(join(item.request.folder, 'step.json')),
  'a step file refused by its schema': (item) =>
    writeFileSync(join(item.request.folder, 'step.json'), JSON.stringify({ build: {} })),
  'a missing scout question': (item) => rmSync(join(item.request.folder, 'scout.history.md')),
  'an approved file the folder lacks': (item) => {
    const manifest = item.request.plan.manifest as { files_sha256: Record<string, string> };
    manifest.files_sha256 = { ...manifest.files_sha256, 'scout.other.md': hash('other') };
  },
  'a folder file the manifest omits': (item) => {
    const manifest = item.request.plan.manifest as { files_sha256: Record<string, string> };
    const { 'scout.history.md': _omitted, ...others } = manifest.files_sha256;
    manifest.files_sha256 = others;
  },
  'the main checkout': (item) => Object.assign(item.request, { worktree: item.repo }),
  'a directory inside the worktree': (item) => {
    const inside = join(item.worktree, 'sub');
    mkdirSync(inside);
    Object.assign(item.request, { worktree: inside });
  },
  'a relative worktree': (item) => Object.assign(item.request, { worktree: '.claude/worktrees/w' }),
  'a failing fingerprint': (item) =>
    Object.assign(item.host, {
      fingerprint: () => {
        throw new Error('git failed');
      },
    }),
  'a dirty worktree': (item) => writeFileSync(join(item.worktree, 'untracked.txt'), 'dirty\n'),
  'a missing launcher file': (item) => {
    const read = item.host.readLauncher;
    Object.assign(item.host, {
      readLauncher: (file: string) => {
        if (file === 'prompts/review.md') throw new Error('missing launcher file');
        return read(file);
      },
    });
  },
  'a Plan digest other than the manifest': (item) =>
    Object.assign(item.request.plan.plan, { sha256: hash('another proposal') }),
  'an approval of another manifest': (item) =>
    Object.assign(item.request.plan, { approval_sha256: hash('another manifest') }),
  'a Define review by one provider': (item) =>
    Object.assign(item.request.plan.define.review.reviewer, { provider: 'openai' }),
  'a Plan review by one model': (item) =>
    Object.assign(item.request.plan.plan.review.reviewer, { model: 'plan-author' }),
  'a Plan bound to another Define': (item) =>
    Object.assign(item.request.plan.plan, { define_sha256: hash('another Define') }),
  'a shared authority directory': (item) => {
    mkdirSync(item.authority, { recursive: true });
    // Whatever the umask: the group and others can read and enter it.
    chmodSync(item.authority, 0o755);
  },
  'an authority inside the worktree': (item) => {
    const inside = join(item.worktree, '.authority');
    Object.assign(item.host, { authority: () => inside });
  },
  'a relative authority': (item) => Object.assign(item.host, { authority: () => 'step-admission' }),
  'an authority that is a file': (item) => {
    mkdirSync(dirname(item.authority), { recursive: true });
    writeFileSync(item.authority, '');
  },
  'an authority that is a link': (item) => {
    const real = join(item.root, 'elsewhere');
    mkdirSync(real, { mode: 0o700 });
    mkdirSync(dirname(item.authority), { recursive: true });
    symlinkSync(real, item.authority);
  },
  'an authority under a linked parent': (item) => {
    const real = join(item.root, 'elsewhere');
    mkdirSync(real, { mode: 0o700 });
    mkdirSync(dirname(dirname(item.authority)), { recursive: true });
    symlinkSync(real, dirname(item.authority));
  },
  'an authority of another owner': (item) =>
    Object.assign(item.host, { uid: () => (process.getuid!() + 1) % 65536 }),
  'no user identity': (item) => Object.assign(item.host, { uid: () => undefined }),
  'an authority closed to writing': (item) => {
    mkdirSync(item.authority, { recursive: true, mode: 0o700 });
    chmodSync(item.authority, 0o500);
    item.restore.push(() => chmodSync(item.authority, 0o700));
  },
  'a failed write': (item) => {
    const write = mock.method(fs, 'writeSync', () => {
      throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
    });
    syncBuiltinESMExports();
    item.restore.push(() => {
      write.mock.restore();
      syncBuiltinESMExports();
    });
  },
};

Given('the issuance is changed by {string}', function (change: string) {
  const item = issuance(this);
  item.request = mutable(item.request);
  const apply = changes[change];
  assert.ok(apply, `unknown issuance change: ${change}`);
  apply(item);
  this.cleanups.push(() => item.restore.forEach((restore) => restore()));
});

Given('the authority file system accepts at most {int} bytes per write', function (most: number) {
  const item = issuance(this);
  const real = fs.writeSync;
  let calls = 0;
  const write = mock.method(fs, 'writeSync', (fd: number, buffer: Buffer, offset: number, length: number) => {
    calls++;
    return real(fd, buffer, offset, Math.min(length, most));
  });
  syncBuiltinESMExports();
  item.restore.push(() => {
    write.mock.restore();
    syncBuiltinESMExports();
    assert.ok(calls > 1, 'the receipt was written in more than one call');
  });
  this.cleanups.push(() => item.restore.forEach((restore) => restore()));
});

/** The descriptors this process holds: an issuance that returns or refuses leaves none open. */
const descriptors = () => readdirSync('/dev/fd').length;

function issue(item: Issuance): void {
  const open = descriptors();
  try {
    item.issued = issueStepAdmission(item.request, item.host);
    item.refusal = undefined;
  } catch (error) {
    item.refusal = (error as Error).message;
  } finally {
    // A short write mock must not outlive the issuance it measures.
    while (item.restore.length > 0) item.restore.pop()!();
  }
  assert.equal(descriptors(), open, 'the issuance closed every descriptor it opened');
}

When('the host issues the Step admission receipt', function () {
  issue(issuance(this));
});

When('the host issues the Step admission receipt again', function () {
  const item = issuance(this);
  this.state['firstIssued'] = item.issued;
  this.state['firstBytes'] = readFileSync(item.issued!.path);
  issue(item);
});

Then(
  'the receipt is a private file named for its Step and approved digest in a private authority directory',
  function () {
    const item = issuance(this);
    assert.equal(item.refusal, undefined);
    const { path, approved_sha256 } = item.issued!;
    assert.equal(path, join(item.authority, `delivery-${approved_sha256}.json`));
    assert.match(approved_sha256, /^[a-f0-9]{64}$/);
    const file = lstatSync(path);
    assert.ok(file.isFile());
    assert.equal(file.mode & 0o777, 0o600);
    assert.equal(file.nlink, 1);
    assert.equal(lstatSync(item.authority).mode & 0o777, 0o700);
    assert.deepEqual(readdirSync(item.authority), [`delivery-${approved_sha256}.json`]);
    assert.ok(readFileSync(path, 'utf8').endsWith('}\n'));
  },
);

/** The subject Step builds for this folder, worktree and launcher. */
function subjectOf(item: Issuance): StepAdmissionSubject {
  const read = (name: string) => readFileSync(join(item.request.folder, name), 'utf8');
  const step = parseStepFile(JSON.parse(read('step.json')));
  return {
    name: 'delivery',
    worktree: item.worktree,
    tree: fingerprintTree(item.worktree),
    inputs: {
      'brief.md': read('brief.md'),
      'step.json': read('step.json'),
      'scout.history.md': read('scout.history.md'),
    },
    step,
    launcher: launcherFiles((file) => readFileSync(join(PKG, file), 'utf8'), step),
  };
}

Then('the Step authority reads the issued receipt and admits the exact subject', function () {
  const item = issuance(this);
  assert.equal(item.refusal, undefined);
  const receipt = readStepAdmission(item.issued!.path, item.worktree, item.authority);
  assert.equal(requireStepAdmission(receipt, subjectOf(item)), item.issued!.approved_sha256);
  // With every optional binding the issuer verified, too.
  const { plan } = item.request;
  assert.equal(
    requireStepAdmission(receipt, {
      ...subjectOf(item),
      approval_sha256: plan.approval_sha256,
      define_sha256: plan.define.sha256,
      proposal_sha256: plan.plan.sha256,
      reviewed_plan_sha256: plan.plan.raw_receipt_sha256,
      define_review: plan.define.review,
      plan_review: plan.plan.review,
    }),
    item.issued!.approved_sha256,
  );
});

Then('Step refuses the issued receipt for a subject with {string}', function (change: string) {
  const item = issuance(this);
  const receipt = readStepAdmission(item.issued!.path, item.worktree, item.authority);
  const subject = subjectOf(item);
  const changed: Record<string, () => StepAdmissionSubject> = {
    'another brief': () => ({ ...subject, inputs: { ...subject.inputs, 'brief.md': 'Another task.\n' } }),
    'another tree': () => ({ ...subject, tree: { ...subject.tree, tree: 'f'.repeat(40) } }),
    'another launcher': () => ({
      ...subject,
      launcher: { ...subject.launcher, 'prompts/build.md': 'Another prompt.\n' },
    }),
    'another worktree': () => ({ ...subject, worktree: join(item.root, 'other') }),
    'another question': () => ({
      ...subject,
      inputs: { ...subject.inputs, 'scout.history.md': 'Another question?\n' },
    }),
  };
  assert.throws(() => requireStepAdmission(receipt, changed[change]!()), /^Error: STEP_ADMISSION_/);
});

Then(
  'the second issuance is refused with {string} and the first receipt is unchanged',
  function (code: string) {
    const item = issuance(this);
    assert.equal(item.refusal, code);
    const first = stored<IssuedAdmission>(this, 'firstIssued');
    assert.deepEqual(readFileSync(first.path), stored<Buffer>(this, 'firstBytes'));
    assert.deepEqual(readdirSync(item.authority), [`delivery-${first.approved_sha256}.json`]);
  },
);

Then('the issuer refuses with {string} and writes no receipt', function (code: string) {
  const item = issuance(this);
  assert.equal(item.refusal, code);
  const authority = item.host.authority();
  // A relative authority is not resolved against the working directory, not even created there.
  if (!isAbsolute(authority)) assert.equal(existsSync(authority), false);
  else if (existsSync(authority) && lstatSync(authority).isDirectory())
    assert.deepEqual(readdirSync(authority), []);
});

Then(
  'the production admission host reads the launcher of this package and the Step authority directory',
  function () {
    const home = realpathSync(mkdtempSync(join(tmpdir(), 'aos-admit-home-')));
    this.cleanups.push(() => rmSync(home, { recursive: true, force: true }));
    const user = os.userInfo();
    const info = mock.method(os, 'userInfo', () => ({ ...user, homedir: home }));
    syncBuiltinESMExports();
    try {
      const host = productionAdmissionHost();
      assert.equal(host.authority(), stepAdmissionAuthority());
      assert.equal(host.authority(), join(home, '.config', 'architect-os', 'step-admission'));
      assert.equal(host.readLauncher('code.json'), readFileSync(join(PKG, 'code.json'), 'utf8'));
      assert.equal(host.uid(), process.getuid!());
      // A host without an effective user identity has none to give.
      const getuid = process.getuid;
      Object.assign(process, { getuid: undefined });
      try {
        assert.equal(host.uid(), undefined);
      } finally {
        Object.assign(process, { getuid });
      }
      const { worktree } = repoOf(this);
      assert.deepEqual(host.fingerprint(worktree), fingerprintTree(worktree));
    } finally {
      info.mock.restore();
      syncBuiltinESMExports();
    }
  },
);
