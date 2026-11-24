import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir, userInfo } from 'node:os';
import { basename, join } from 'node:path';
import { mock } from 'node:test';
import { Then } from '@cucumber/cucumber';
import {
  freezeStepLauncher,
  readStepAdmission,
  requireStepAdmission,
  stepAdmissionAuthority,
  type StepAdmissionSubject,
} from '../../src/step-admission.js';
import { admittedFixture } from './admission-fixture.js';

const sha = (text: string) => createHash('sha256').update(text).digest('hex');

function subject(): StepAdmissionSubject {
  const launcher = Object.fromEntries(
    ['code', 'scout', 'review'].flatMap((tool) => {
      const prompt = 'prompts/' + (tool === 'code' ? 'build' : tool) + '.md';
      const definition = fs.readFileSync(new URL('../../' + tool + '.json', import.meta.url), 'utf8');
      return [
        [tool + '.json', definition],
        [prompt, 'Evaluate ' + tool],
      ];
    }),
  );
  const session = { model: 'build-model', effort: 'medium' as const, limitSeconds: 30 };
  return {
    name: 'step-a',
    worktree: '/fixture/project',
    inputs: { 'proposal.md': 'Approved proposal', 'define.md': 'Approved scope' },
    tree: { commit: 'a'.repeat(40), tree: 'b'.repeat(40), clean: true },
    step: {
      build: session,
      scouts: [{ ...session, name: 'scope', model: 'scout-model' }],
      reviews: [{ ...session, name: 'design', model: 'review-model' }],
      parallel: 1,
      checks: [],
    },
    launcher,
    define_sha256: sha('Define'),
    proposal_sha256: sha('proposal'),
    reviewed_plan_sha256: sha('reviewed Plan'),
  };
}

function approval() {
  const original = subject();
  const receipt = admittedFixture(original);
  const review = {
    drafter: { provider: 'openai' as const, model: 'fixture-author' },
    reviewer: { provider: 'google' as const, model: 'fixture-reviewer' },
    status: 'clear' as const,
  };
  return {
    original: {
      ...original,
      approval_sha256: receipt.payload.approval.approval_sha256,
      define_review: review,
      plan_review: review,
    },
    receipt,
  };
}

Then('the Step admission matches the approved tree, digests and role models', function () {
  const { original, receipt } = approval();
  let approved: string | undefined;
  assert.doesNotThrow(() => {
    approved = requireStepAdmission(receipt, original);
  }, 'The approved Step receipt must be admitted');
  assert.equal(approved, receipt.approved_sha256);
});

Then('Step admission refuses a changed {string}', function (field: string) {
  const { original, receipt } = approval();
  const changedReview = {
    ...original.define_review,
    reviewer: { provider: 'google' as const, model: 'revised-reviewer' },
  };
  const stale: Record<string, Partial<StepAdmissionSubject>> = {
    'step name': { name: 'step-b' },
    worktree: { worktree: '/fixture/other' },
    commit: { tree: { ...original.tree, commit: 'c'.repeat(40) } },
    tree: { tree: { ...original.tree, tree: 'd'.repeat(40) } },
    'clean flag': { tree: { ...original.tree, clean: false } },
    'input bytes': { inputs: { ...original.inputs, 'define.md': 'Revised scope' } },
    'launcher bytes': { launcher: { ...original.launcher, 'profiles/build.json': '{}' } },
    'approved manifest': { approval_sha256: sha('other approval') },
    'Define digest': { define_sha256: sha('other Define') },
    'proposal digest': { proposal_sha256: sha('other proposal') },
    'reviewed Plan': { reviewed_plan_sha256: sha('other review') },
    'Define review': { define_review: changedReview },
    'Plan review': { plan_review: changedReview },
    'missing review': { step: { ...original.step, reviews: [] } },
    'renamed scout': {
      step: { ...original.step, scouts: [{ ...original.step.scouts[0]!, name: 'references' }] },
    },
    'build model': {
      step: {
        ...original.step,
        build: { ...original.step.build, provider: 'anthropic', model: 'other-model' },
      },
    },
  };
  assert.ok(Object.hasOwn(stale, field));
  const specimenMismatch = field === 'renamed scout' || field === 'build model';
  assert.throws(() => requireStepAdmission(receipt, { ...original, ...stale[field] }), {
    message: specimenMismatch ? 'STEP_ADMISSION_SPECIMENS_REQUIRED' : 'STEP_ADMISSION_EVIDENCE_MISMATCH',
  });
});

Then(
  'Step admission refuses approved manifest field {string} for a different input',
  function (field: string) {
    const original = subject();
    const { manifest } = admittedFixture(original).payload;
    if (field === 'step') manifest.step = 'step-b';
    else if (field === 'files')
      manifest.files_sha256 = { ...manifest.files_sha256, 'define.md': sha('other scope') };
    else {
      assert.ok(Object.hasOwn(manifest.source_sha256, field));
      manifest.source_sha256[field] = sha('other source');
    }
    const receipt = admittedFixture(original, manifest);
    assert.throws(() => requireStepAdmission(receipt, original), {
      message: 'STEP_ADMISSION_EVIDENCE_MISMATCH',
    });
  },
);

Then('Step admission accepts reverse-ordered file digest keys', function () {
  const original = subject();
  const { manifest } = admittedFixture(original).payload;
  manifest.files_sha256 = Object.fromEntries(Object.entries(manifest.files_sha256).reverse());
  const receipt = admittedFixture(original, manifest);
  assert.equal(requireStepAdmission(receipt, original), receipt.approved_sha256);
});

Then("the Step authority is located in the operating-system user's configuration directory", function () {
  assert.equal(
    stepAdmissionAuthority(),
    join(fs.realpathSync(userInfo().homedir), '.config', 'architect-os', 'step-admission'),
  );
});

function withReceipt(check: (file: string, directory: string, worktree: string) => void) {
  const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'aos-admission-fixture-')));
  try {
    const directory = join(root, 'authority');
    const worktree = join(root, 'worktree');
    fs.mkdirSync(directory, { mode: 0o700 });
    fs.mkdirSync(worktree, { mode: 0o700 });
    const file = join(directory, 'receipt.json');
    fs.writeFileSync(file, JSON.stringify({ subject: 'é', reviewed: true }), { mode: 0o600 });
    check(file, directory, worktree);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

Then('the Step host reads private UTF-8 authority bytes through a single protected descriptor', function () {
  withReceipt((file, directory, worktree) => {
    const opened = mock.method(fs, 'openSync');
    const closed = mock.method(fs, 'closeSync');
    syncBuiltinESMExports();
    try {
      assert.deepEqual(readStepAdmission(file, worktree, directory), { subject: 'é', reviewed: true });
      assert.equal(opened.mock.calls.length, 1);
      const call = opened.mock.calls[0]!;
      assert.deepEqual(call.arguments, [
        file,
        fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
      ]);
      assert.deepEqual(
        closed.mock.calls.map(({ arguments: args }) => args),
        [[call.result]],
      );
    } finally {
      opened.mock.restore();
      closed.mock.restore();
      syncBuiltinESMExports();
    }
  });
});

Then('the Step authority reader refuses {string}', function (condition: string) {
  withReceipt((file, directory, worktree) => {
    let path: string | undefined = file;
    let candidate = worktree;
    switch (condition) {
      case 'missing path':
        path = undefined;
        break;
      case 'relative path':
        path = 'receipt.json';
        break;
      case 'different parent':
        path = join(worktree, 'receipt.json');
        break;
      case 'worktree authority':
        candidate = directory;
        break;
      case 'shared directory':
        fs.chmodSync(directory, 0o750);
        break;
      case 'shared receipt':
        fs.chmodSync(file, 0o640);
        break;
      case 'extra hard link':
        fs.linkSync(file, join(directory, 'copy'));
        break;
      case 'directory receipt':
        fs.unlinkSync(file);
        fs.mkdirSync(file, { mode: 0o700 });
        break;
      case 'oversized receipt':
        fs.truncateSync(file, 1024 * 1024 + 1);
        break;
      case 'invalid UTF-8':
        fs.writeFileSync(file, Buffer.from([34, 255, 34]));
        break;
      case 'invalid JSON':
        fs.writeFileSync(file, '{');
        break;
      default:
        assert.fail(condition);
    }
    assert.throws(
      () => readStepAdmission(path, candidate, directory),
      condition === 'invalid UTF-8'
        ? TypeError
        : condition === 'invalid JSON'
          ? SyntaxError
          : { message: 'STEP_ADMISSION_REQUIRED' },
    );
  });
});

Then('an authority receipt of {int} bytes is {string}', function (size: number, decision: string) {
  withReceipt((file, directory, worktree) => {
    const encoded = '[]'.padEnd(size, ' ');
    fs.writeFileSync(file, encoded);
    if (decision === 'accepted') assert.deepEqual(readStepAdmission(file, worktree, directory), []);
    else {
      assert.equal(decision, 'refused');
      assert.throws(() => readStepAdmission(file, worktree, directory), {
        message: 'STEP_ADMISSION_REQUIRED',
      });
    }
  });
});

Then('the frozen Step launcher is a private read-only snapshot with its original file layout', function () {
  withReceipt((_file, _directory, worktree) => {
    const files = { 'prompts/build.md': 'Préparer', 'profiles/builder.json': '{}' };
    const write = mock.method(fs, 'writeFileSync');
    syncBuiltinESMExports();
    let copy: ReturnType<typeof freezeStepLauncher> | undefined;
    try {
      copy = freezeStepLauncher(files, worktree);
      assert.ok(copy, 'a frozen launcher must be returned');
      assert.equal(typeof copy.dispose, 'function', 'the frozen launcher must be disposable');
      assert.match(basename(copy.dir), /^aos-launcher-[a-zA-Z0-9]{6}$/);
      for (const call of write.mock.calls) assert.deepEqual(call.arguments[2], { mode: 0o400, flag: 'wx' });
      assert.deepEqual(fs.readdirSync(copy.dir).sort(), ['profiles', 'prompts']);
      assert.equal(fs.statSync(copy.dir).mode & 0o777, 0o700);
      for (const [name, text] of Object.entries(files)) {
        const file = join(copy.dir, name);
        assert.equal(fs.readFileSync(file, 'utf8'), text);
        assert.equal(fs.statSync(file).mode & 0o777, 0o400);
      }
    } finally {
      write.mock.restore();
      syncBuiltinESMExports();
      if (typeof copy?.dispose === 'function') copy.dispose();
    }
    assert.ok(copy);
    assert.equal(fs.existsSync(copy.dir), false);
    copy.dispose();
  });
});

Then('the Step authority rejects a descriptor with {string} and closes it', function (observation: string) {
  withReceipt((file, directory, worktree) => {
    const stat = fs.fstatSync;
    const reported = mock.method(fs, 'fstatSync', (fd: number) => {
      const metadata = stat(fd);
      if (observation === 'other file owner') metadata.uid += 1;
      else if (observation === 'grew during read') metadata.size -= 1;
      else if (observation === 'shrank during read') metadata.size += 1;
      else assert.fail(observation);
      return metadata;
    });
    const closed = mock.method(fs, 'closeSync');
    const read = mock.method(fs, 'readSync');
    syncBuiltinESMExports();
    try {
      assert.throws(() => readStepAdmission(file, worktree, directory), {
        message: 'STEP_ADMISSION_REQUIRED',
      });
      assert.ok(read.mock.calls.every(({ arguments: args }) => Number(Array.from(args).at(3)) > 0));
      assert.equal(reported.mock.calls.length, 1);
      assert.deepEqual(
        closed.mock.calls.map((call) => call.arguments[0]),
        [reported.mock.calls[0]!.arguments[0]],
      );
    } finally {
      reported.mock.restore();
      read.mock.restore();
      closed.mock.restore();
      syncBuiltinESMExports();
    }
  });
});

Then(
  'Step authority refuses parent observation {string} before opening the receipt',
  function (observation: string) {
    withReceipt((file, directory, worktree) => {
      const stat = fs.statSync;
      const reported = mock.method(fs, 'statSync', (path: fs.PathLike) => {
        const metadata = stat(path);
        if (path === directory) {
          if (observation === 'wrong owner') metadata.uid += 1;
          else if (observation === 'not directory') metadata.isDirectory = () => false;
          else assert.fail(observation);
        }
        return metadata;
      });
      const opened = mock.method(fs, 'openSync');
      syncBuiltinESMExports();
      try {
        assert.throws(() => readStepAdmission(file, worktree, directory), {
          message: 'STEP_ADMISSION_REQUIRED',
        });
        assert.equal(opened.mock.callCount(), 0);
      } finally {
        reported.mock.restore();
        opened.mock.restore();
        syncBuiltinESMExports();
      }
    });
  },
);

Then('the frozen launcher cleans its temporary directory after {string}', function (condition: string) {
  withReceipt((_file, _directory, worktree) => {
    const created = mock.method(fs, 'mkdtempSync');
    const full = new Error('fixture storage full');
    const failed =
      condition === 'storage failure'
        ? mock.method(fs, 'writeFileSync', () => {
            throw full;
          })
        : undefined;
    syncBuiltinESMExports();
    try {
      const parent = condition === 'copy inside worktree' ? fs.realpathSync(tmpdir()) : worktree;
      const name = condition === 'noncanonical file name' ? 'prompts//build.md' : 'prompts/build.md';
      const files = { 'code.json': '{}', [name]: 'Build.' };
      assert.throws(
        () => freezeStepLauncher(files, parent),
        condition === 'storage failure' ? (error) => error === full : { message: 'STEP_ADMISSION_REQUIRED' },
      );
      const dir = created.mock.calls[0]?.result;
      assert.equal(typeof dir, 'string');
      assert.equal(fs.existsSync(dir as string), false);
    } finally {
      created.mock.restore();
      failed?.mock.restore();
      syncBuiltinESMExports();
      for (const { result } of created.mock.calls) {
        if (typeof result === 'string') fs.rmSync(result, { recursive: true, force: true });
      }
    }
  });
});

Then('a build-only Step admission verifies using only the build launcher files', function () {
  const original = subject();
  const minimal = {
    ...original,
    step: { ...original.step, scouts: [], reviews: [] },
    launcher: {
      'code.json': original.launcher['code.json']!,
      'prompts/build.md': original.launcher['prompts/build.md']!,
    },
  };
  const receipt = admittedFixture(minimal);
  assert.equal(requireStepAdmission(receipt, minimal), receipt.approved_sha256);
});

Then('Step admission rejects a missing input value when an empty file was approved', function () {
  const baseline = { ...subject(), inputs: { 'brief.md': '' } };
  const receipt = admittedFixture(baseline);
  assert.equal(requireStepAdmission(receipt, baseline), receipt.approved_sha256);
  const incomplete = { 'brief.md': undefined } as unknown as Readonly<Record<string, string>>;
  assert.throws(() => requireStepAdmission(receipt, { ...baseline, inputs: incomplete }));
});

function replayEvidence(discrepancy?: string) {
  const original = subject();
  const receipt = admittedFixture(original);
  const cases = [
    {
      id: 'complete',
      input_sha256: sha('complete submission'),
      expected: { verdict: 'pass', findings: [] as string[] },
    },
    {
      id: discrepancy === 'duplicate case ID' ? 'complete' : 'missing',
      input_sha256: sha('missing field'),
      expected: { verdict: 'refuse', findings: ['field required'] },
    },
  ];
  const proof = {
    ...receipt.payload.specimens[0]!,
    results: cases.map((item) => ({ ...item, observed: structuredClone(item.expected) })),
    cases_sha256: sha(JSON.stringify(cases)),
  };
  switch (discrepancy) {
    case undefined:
    case 'duplicate case ID':
      break;
    case 'changed case digest':
      proof.cases_sha256 = sha('other replay suite');
      break;
    case 'different verdict':
      proof.results[1]!.observed.verdict = 'pass';
      break;
    case 'different findings':
      proof.results[1]!.observed.findings = [];
      break;
    case 'different model route':
      proof.model.provider = 'google';
      break;
    case 'different prompt':
      proof.prompt_sha256 = sha('other prompt');
      break;
    default:
      assert.fail(discrepancy);
  }
  const payload = { ...receipt.payload, specimens: [proof, ...receipt.payload.specimens.slice(1)] };
  return { receipt: { ...receipt, payload, approved_sha256: sha(JSON.stringify(payload)) }, original };
}

Then('Step admission accepts a specimen with successful pass and refuse replays', function () {
  const { receipt, original } = replayEvidence();
  assert.equal(requireStepAdmission(receipt, original), receipt.approved_sha256);
});

Then('Step admission refuses a specimen with {string}', function (discrepancy: string) {
  const { receipt, original } = replayEvidence(discrepancy);
  assert.throws(() => requireStepAdmission(receipt, original), {
    message: 'STEP_ADMISSION_SPECIMENS_REQUIRED',
  });
});

Then('Step admission rejects receipt discrepancy {string}', function (discrepancy: string) {
  const original = subject();
  const receipt = admittedFixture(original);
  const proof = receipt.payload;
  const review = proof.define.review;
  let schemaError = false;
  switch (discrepancy) {
    case 'changed approval digest':
      break;
    case 'changed Step name':
      proof.step = 'different-step';
      break;
    case 'changed manifest approval':
      proof.approval.approval_sha256 = sha('other manifest');
      break;
    case 'changed input hashes':
      proof.inputs_sha256['define.md'] = sha('updated Define');
      break;
    case 'different Define for Plan':
      proof.plan.define_sha256 = sha('other Define');
      break;
    case 'shared review provider':
      review.reviewer.provider = review.drafter.provider;
      schemaError = true;
      break;
    case 'shared review model':
      review.reviewer.model = review.drafter.model;
      schemaError = true;
      break;
    case 'prefixed oracle digest':
      proof.specimens[0]!.oracle_sha256 = '!' + proof.specimens[0]!.oracle_sha256;
      schemaError = true;
      break;
    case 'suffixed oracle digest':
      proof.specimens[0]!.oracle_sha256 += '!';
      schemaError = true;
      break;
    default:
      assert.fail(discrepancy);
  }
  receipt.approved_sha256 =
    discrepancy === 'changed approval digest'
      ? sha('different approved payload')
      : sha(JSON.stringify(proof));
  assert.throws(
    () => requireStepAdmission(receipt, original),
    schemaError ? { name: 'ZodError' } : { message: 'STEP_ADMISSION_EVIDENCE_MISMATCH' },
  );
});

Then(
  'Step authority rejects a changed canonical {string} before opening the receipt',
  function (location: string) {
    withReceipt((file, directory, worktree) => {
      const realpath = fs.realpathSync;
      const expected = location === 'directory' ? directory : file;
      const observed = mock.method(fs, 'realpathSync', (path: fs.PathLike) =>
        path === expected ? expected + '-renamed' : realpath(path),
      );
      const opened = mock.method(fs, 'openSync');
      syncBuiltinESMExports();
      try {
        assert.throws(() => readStepAdmission(file, worktree, directory), {
          message: 'STEP_ADMISSION_REQUIRED',
        });
        assert.equal(opened.mock.callCount(), 0);
      } finally {
        observed.mock.restore();
        opened.mock.restore();
        syncBuiltinESMExports();
      }
    });
  },
);

Then('Step authority refuses a platform without a user identity', function () {
  withReceipt((file, directory, worktree) => {
    const descriptor = Object.getOwnPropertyDescriptor(process, 'getuid');
    const stat = mock.method(fs, 'statSync');
    syncBuiltinESMExports();
    try {
      Object.defineProperty(process, 'getuid', { value: undefined, configurable: true });
      assert.throws(() => readStepAdmission(file, worktree, directory), {
        message: 'STEP_ADMISSION_REQUIRED',
      });
      assert.equal(stat.mock.callCount(), 0);
    } finally {
      stat.mock.restore();
      syncBuiltinESMExports();
      if (descriptor) Object.defineProperty(process, 'getuid', descriptor);
      else Reflect.deleteProperty(process, 'getuid');
    }
  });
});
