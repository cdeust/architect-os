import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { mock } from 'node:test';
import { Given, Then, When } from '@cucumber/cucumber';
import type { AdmissionRequest, IssuedAdmission } from '@architect-os/sandbox/step-admission-issuer';
import { runAdmit } from '../../src/main.js';

interface World {
  state: Record<string, unknown>;
}
interface Sources {
  root: string;
  define: string;
  proposal: string;
  policy: string;
  decision: string;
  preview: {
    approval_sha256: string;
    files: Record<string, string>;
    manifest: { step: string; source_sha256: Record<string, string>; files_sha256: Record<string, string> };
    independent_reviews: { define: unknown; plan: unknown };
  };
}
interface Admission {
  requests: AdmissionRequest[];
  failure?: () => never;
  code?: number;
  out: string;
  err: string;
}

const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const sources = (world: World) => {
  const value = world.state['planSources'] as Sources | undefined;
  assert.ok(value, 'a materialized Plan is required');
  return value;
};
const admission = (world: World): Admission => {
  world.state['admission'] ??= { requests: [], out: '', err: '' };
  return world.state['admission'] as Admission;
};
const ISSUED: IssuedAdmission = {
  path: '/authority/delivery-' + 'c'.repeat(64) + '.json',
  approved_sha256: 'c'.repeat(64),
};

Then('the reviewed Plan folder holds exactly the approved files of the preview', function (this: World) {
  const { preview } = sources(this);
  const folder = this.state['planFolder'] as string;
  assert.deepEqual(readdirSync(folder).sort(), Object.keys(preview.files).sort());
  for (const [name, text] of Object.entries(preview.files)) {
    assert.equal(readFileSync(join(folder, name), 'utf8'), text);
    assert.equal(preview.manifest.files_sha256[name], hash(text));
  }
  assert.ok(preview.manifest.source_sha256['reviewed_plan']);
});

Given('the issuer refuses with {string}', function (this: World, code: string) {
  admission(this).failure = () => {
    throw new Error(code);
  };
});

Given('the issuer fails with {string}', function (this: World, failure: string) {
  const thrown: Record<string, unknown> = {
    'an unnamed error': new Error('boom'),
    'a code with a tail': new Error('ADMIT_TREE_DIRTY at the host'),
    'a code with a head': new Error('not ADMIT_TREE_DIRTY'),
    'a code without a name': new Error('ADMIT_'),
    'a thrown string': 'ADMIT_TREE_DIRTY',
    'a plain object with a code message': { message: 'ADMIT_TREE_DIRTY' },
  };
  admission(this).failure = () => {
    throw thrown[failure];
  };
});

When('the host runs admit with {string}', function (this: World, change: string) {
  const item = sources(this);
  const state = admission(this);
  const folder = this.state['planFolder'] as string;
  const specimens = join(item.root, 'specimens.json');
  writeFileSync(specimens, JSON.stringify([{ role: 'build' }]));
  let args = [item.define, item.proposal, item.policy, item.decision, specimens, folder, '/the/worktree'];
  const set = (index: number, value: string) => (args[index] = value);
  const checkout = () => {
    const repo = join(item.root, 'checkout');
    mkdirSync(join(repo, 'intake'), { recursive: true });
    writeFileSync(join(repo, '.git'), 'gitdir: /some/repo/.git/worktrees/checkout');
    return repo;
  };
  switch (change) {
    case 'measured specimens':
      break;
    case 'an invalid Define':
      writeFileSync(item.define, '{');
      break;
    case 'a missing policy':
      set(2, join(item.root, 'absent.json'));
      break;
    case 'an unreviewed proposal': {
      const reviewed = JSON.parse(readFileSync(item.proposal, 'utf8'));
      writeFileSync(item.proposal, JSON.stringify(reviewed.reviewed_plan.proposal));
      break;
    }
    case 'no decision':
      set(3, join(item.root, 'absent-decision.json'));
      break;
    case 'a decision that is not JSON':
      writeFileSync(item.decision, 'approve');
      break;
    case 'a decision for another preview':
      writeFileSync(
        item.decision,
        JSON.stringify({ version: 1, decision: 'approve', approval_sha256: 'a'.repeat(64) }),
      );
      break;
    case 'a rejected decision':
      writeFileSync(
        item.decision,
        JSON.stringify({ version: 1, decision: 'reject', approval_sha256: item.preview.approval_sha256 }),
      );
      break;
    case 'no specimens':
      set(4, join(item.root, 'absent-specimens.json'));
      break;
    case 'specimens that are not JSON':
      writeFileSync(specimens, '[');
      break;
    case 'a relative folder':
      // A relative path that would resolve, from this process, to the very folder Plan materialized.
      set(5, relative(process.cwd(), folder));
      break;
    case 'a folder of another name': {
      const other = join(dirname(folder), 'other');
      renameSync(folder, other);
      set(5, other);
      break;
    }
    case 'a non-normalized folder':
      set(5, dirname(folder) + '/./delivery');
      break;
    case 'an absent folder':
      set(5, join(item.root, 'absent', 'delivery'));
      break;
    case 'a folder inside a checkout': {
      const inside = join(checkout(), 'intake', 'delivery');
      renameSync(folder, inside);
      set(5, inside);
      break;
    }
    case 'a folder linked into a checkout': {
      const inside = join(checkout(), 'intake', 'delivery');
      renameSync(folder, inside);
      mkdirSync(join(item.root, 'alias'));
      symlinkSync(inside, join(item.root, 'alias', 'delivery'));
      set(5, join(item.root, 'alias', 'delivery'));
      break;
    }
    case 'six arguments':
      args = args.slice(0, 6);
      break;
    case 'eight arguments':
      args = [...args, 'extra'];
      break;
    case 'an empty argument':
      set(6, '');
      break;
    default:
      throw new Error(change);
  }
  state.code = runAdmit(
    {
      argv: [process.execPath, 'admit', ...args],
      stdout: { write: (text) => (state.out += text) },
      stderr: { write: (text) => (state.err += text) },
    },
    (request) => {
      state.requests.push(request);
      if (state.failure) state.failure();
      return ISSUED;
    },
  );
});

Then('admit refuses with {string} before the issuer', function (this: World, code: string) {
  const state = admission(this);
  assert.deepEqual(
    { code: state.code, out: state.out, err: state.err, calls: state.requests.length },
    { code: 2, out: '', err: `architect-os admit: ${code}\n`, calls: 0 },
  );
});

Then('admit prints its usage before the issuer', function (this: World) {
  const state = admission(this);
  assert.deepEqual(
    { code: state.code, out: state.out, err: state.err, calls: state.requests.length },
    {
      code: 2,
      out: '',
      err: 'architect-os admit: usage: admit <define> <reviewed-plan> <policy> <decision> <specimens> <step-folder> <worktree>\n',
      calls: 0,
    },
  );
});

Then(
  'admit exits with {int} and the diagnostic {string}',
  function (this: World, code: number, diagnostic: string) {
    const state = admission(this);
    assert.deepEqual(
      { code: state.code, out: state.out, err: state.err, calls: state.requests.length },
      { code, out: '', err: `architect-os admit: ${diagnostic}\n`, calls: 1 },
    );
  },
);

Then(
  'the issuer received the approved manifest, its approval and both independent reviews',
  function (this: World) {
    const { preview, root } = sources(this);
    const [request, ...others] = admission(this).requests;
    assert.equal(others.length, 0);
    const { manifest, approval_sha256, independent_reviews: reviews } = preview;
    const { define, proposal, reviewed_plan } = manifest.source_sha256;
    assert.deepEqual(request, {
      plan: {
        manifest,
        approval_sha256,
        define: { sha256: define, review: reviews.define },
        plan: {
          sha256: proposal,
          define_sha256: define,
          raw_receipt_sha256: reviewed_plan,
          review: reviews.plan,
        },
      },
      specimens: [{ role: 'build' }],
      folder: this.state['planFolder'],
      worktree: '/the/worktree',
    });
    // The digest the issuer will check is the one the operator approved.
    assert.equal(request!.plan.approval_sha256, hash(JSON.stringify(manifest)));
    assert.equal(
      JSON.stringify(Object.keys(request!.plan.manifest.source_sha256)),
      JSON.stringify(Object.keys(manifest.source_sha256)),
    );
    assert.ok(root);
  },
);

Then('admit prints the issued receipt', function (this: World) {
  const state = admission(this);
  assert.equal(state.code, 0, state.err);
  assert.equal(state.err, '');
  assert.equal(state.out, JSON.stringify({ status: 'issued', step: 'delivery', ...ISSUED }) + '\n');
});

When('the admit entry runs without arguments', async function (this: World) {
  const argv = process.argv;
  const exitCode = process.exitCode;
  let err = '';
  const write = mock.method(process.stderr, 'write', (chunk: string) => {
    err += chunk;
    return true;
  });
  process.argv = [process.execPath, 'admit-cli.ts'];
  try {
    await import('../../src/admit-cli.js');
    this.state['admitEntry'] = { code: process.exitCode, err };
  } finally {
    write.mock.restore();
    process.argv = argv;
    process.exitCode = exitCode;
  }
});

Then('the admit entry printed its usage and set the exit code 2', function (this: World) {
  assert.deepEqual(this.state['admitEntry'], {
    code: 2,
    err: 'architect-os admit: usage: admit <define> <reviewed-plan> <policy> <decision> <specimens> <step-folder> <worktree>\n',
  });
});
