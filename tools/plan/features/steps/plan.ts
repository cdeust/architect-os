import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { mock } from 'node:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { After, Given, Then, When } from '@cucumber/cucumber';
import { runPlan } from '../../src/main.js';
import { preparePlan } from '../../src/application/prepare.js';
import { readStepInputs } from '../../src/infrastructure/step-inputs.js';
import { publishStepInputs } from '../../src/infrastructure/publish.js';

interface World {
  state: Record<string, unknown>;
}
interface TextResult {
  code: number;
  out: string;
  err: string;
}
interface Preview {
  status: string;
  approval_sha256: string;
  files: Record<string, string>;
  manifest: {
    version: number;
    run_id: string;
    step: string;
    source_sha256: Record<string, string>;
    files_sha256: Record<string, string>;
  };
}
interface Scenario {
  root: string;
  define: string;
  proposal: string;
  policy: string;
  decision: string;
  folder: string;
  result?: TextResult;
  preview?: Preview;
}
const scenarios = new WeakMap<World, Scenario>();
function scenario(world: World): Scenario {
  const item = scenarios.get(world);
  assert.ok(item, 'Plan fixture is required');
  return item;
}
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const load = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const json = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value));

function launch(args: readonly string[]): TextResult {
  let out = '';
  let err = '';
  const code = runPlan({
    argv: [process.execPath, 'plan', ...args],
    stdout: {
      write: (text) => {
        out += text;
      },
    },
    stderr: {
      write: (text) => {
        err += text;
      },
    },
  });
  return { code, out, err };
}

Given('a recorded delivery Plan input', function (this: World) {
  const root = mkdtempSync(join(tmpdir(), 'aos-plan-'));
  const item: Scenario = {
    root,
    define: join(root, 'define.json'),
    proposal: join(root, 'proposal.json'),
    policy: join(root, 'policy.json'),
    decision: join(root, 'decision.json'),
    folder: join(root, 'delivery'),
  };
  scenarios.set(this, item);
  json(item.define, {
    handoff: {
      version: 1,
      run_id: 'run_delivery_demo',
      requirements: [
        { id: 'FR-001', text: 'Publish only the verified commit.' },
        { id: 'NFR-002', text: 'Retain the exact ruleset verdict.' },
      ],
      acceptance: [
        {
          id: 'AC-001',
          text: 'Verify the checked commit and evidence.',
          requirement_ids: ['FR-001', 'NFR-002'],
        },
        {
          id: 'AC-002',
          text: 'Stop before publication when CI only is requested.',
          requirement_ids: ['FR-001'],
        },
      ],
    },
  });
  json(item.proposal, {
    step: 'delivery',
    objective: 'Deliver the commit accepted by the gate.',
    verification: 'Observe a CI-only stop and the verified commit.',
    acceptance_ids: ['AC-001', 'AC-002'],
  });
  json(item.policy, {
    step: { build: { model: 'operator-build', effort: 'medium', limitSeconds: 60 } },
    scout_questions: {},
  });
});

After<World>(function () {
  const item = scenarios.get(this);
  if (item) rmSync(item.root, { recursive: true });
});

function scout(item: Scenario) {
  const policy = load(item.policy);
  policy.step.scouts = [{ name: 'history', model: 'operator-scout', effort: 'low', limitSeconds: 30 }];
  policy.scout_questions = { history: 'Where is the CI-only stop enforced?\n' };
  json(item.policy, policy);
}
Given('the Plan policy includes a named scout', function (this: World) {
  scout(scenario(this));
});

Given('the Plan input is changed to {string}', function (this: World, change: string) {
  const item = scenario(this);
  const define = load(item.define);
  const proposal = load(item.proposal);
  const policy = load(item.policy);
  switch (change) {
    case 'invalid utf8': {
      const text = readFileSync(item.proposal, 'utf8');
      const at = text.indexOf('Deliver');
      writeFileSync(
        item.proposal,
        Buffer.concat([Buffer.from(text.slice(0, at)), Buffer.from([255]), Buffer.from(text.slice(at))]),
      );
      return;
    }
    case 'byte order mark':
      writeFileSync(item.proposal, '\uFEFF' + readFileSync(item.proposal, 'utf8'));
      return;
    case 'historical refusal':
      json(item.define, { error: { code: 'define_document_invalid' } });
      return;
    case 'unlinked acceptance':
      define.handoff.acceptance[0].requirement_ids = ['FR-001'];
      break;
    case 'unknown criterion':
      proposal.acceptance_ids = ['AC-001', 'AC-099'];
      break;
    case 'incomplete coverage':
      proposal.acceptance_ids = ['AC-001'];
      break;
    case 'repeated criterion':
      proposal.acceptance_ids = ['AC-001', 'AC-001'];
      break;
    case 'proposal command':
      proposal.command = ['git', 'push'];
      break;
    case 'policy command':
      policy.step.build.command = ['git', 'push'];
      break;
    case 'malformed policy':
      writeFileSync(item.policy, '{');
      return;
    case 'prototype question':
      Object.defineProperty(policy.scout_questions, '__proto__', {
        enumerable: true,
        value: 'Extra question',
      });
      break;
    case 'extra question':
      policy.scout_questions.extra = 'Extra question';
      break;
    case 'wrong question':
    case 'missing question':
    case 'blank question': {
      scout(item);
      const next = load(item.policy);
      next.scout_questions =
        change === 'wrong question'
          ? { other: 'What?' }
          : change === 'blank question'
            ? { history: ' ' }
            : {};
      json(item.policy, next);
      return;
    }
    case 'blank objective':
      proposal.objective = ' ';
      break;
    case 'blank verification':
      proposal.verification = ' ';
      break;
    case 'unsafe step name':
      proposal.step = '../escape';
      break;
    default:
      throw Error(change);
  }
  json(item.define, define);
  json(item.proposal, proposal);
  json(item.policy, policy);
});

function prepare(item: Scenario): TextResult {
  const result = launch(['prepare', item.define, item.proposal, item.policy]);
  item.result = result;
  if (result.code === 0) item.preview = JSON.parse(result.out);
  return result;
}
When('I prepare the Plan once', function (this: World) {
  prepare(scenario(this));
});
When('I prepare the Plan twice', function (this: World) {
  const item = scenario(this);
  const first = prepare(item);
  assert.equal(first.code, 0, first.err);
  assert.deepEqual(prepare(item), first);
});
Then('the Plan digest is stable and no Step folder exists', function (this: World) {
  const item = scenario(this);
  assert.equal(item.preview?.status, 'pending');
  assert.equal(item.preview?.approval_sha256, hash(JSON.stringify(item.preview.manifest)));
  assert.equal(existsSync(item.folder), false);
});

function approve(item: Scenario) {
  json(item.decision, { version: 1, decision: 'approve', approval_sha256: item.preview?.approval_sha256 });
}
When('the operator records an approval of the preview', function (this: World) {
  approve(scenario(this));
});

When('the Plan decision is {string}', function (this: World, kind: string) {
  const item = scenario(this);
  if (kind === 'missing') return;
  if (kind === 'changed question') {
    scout(item);
    prepare(item);
    approve(item);
    const policy = load(item.policy);
    policy.scout_questions.history = 'Another host question.';
    json(item.policy, policy);
    return;
  }
  approve(item);
  const decision = load(item.decision);
  switch (kind) {
    case 'rejected':
      decision.decision = 'reject';
      break;
    case 'wrong digest':
      decision.approval_sha256 = '0'.repeat(64);
      break;
    case 'unknown version':
      decision.version = 2;
      break;
    case 'injected command':
      decision.argv = ['git', 'push'];
      break;
    case 'changed Define':
      writeFileSync(item.define, readFileSync(item.define, 'utf8') + '\n');
      break;
    case 'changed proposal':
      writeFileSync(item.proposal, readFileSync(item.proposal, 'utf8') + '\n');
      break;
    case 'changed policy':
      writeFileSync(item.policy, readFileSync(item.policy, 'utf8') + '\n');
      break;
    default:
      throw Error(kind);
  }
  json(item.decision, decision);
});

When('I materialize the Plan', function (this: World) {
  const item = scenario(this);
  item.result = launch(['materialize', item.define, item.proposal, item.policy, item.decision, item.folder]);
  this.state['planFolder'] = item.folder;
  this.state['planManifest'] = item.preview?.manifest;
});

When('the Plan destination is {string}', function (this: World, choice: string) {
  const item = scenario(this);
  switch (choice) {
    case 'relative':
      item.folder = 'delivery';
      break;
    case 'different name':
      item.folder = join(item.root, 'other');
      break;
    case 'already exists':
      mkdirSync(item.folder);
      writeFileSync(join(item.folder, 'step.json'), 'keep');
      break;
    case 'worktree':
    case 'worktree alias':
    case 'archive alias': {
      const repo = join(item.root, 'checkout');
      const parent = join(repo, choice === 'archive alias' ? 'steps' : 'intake');
      mkdirSync(parent, { recursive: true });
      writeFileSync(join(repo, '.git'), 'gitdir: /some/repo/.git/worktrees/checkout');
      if (choice === 'worktree') {
        item.folder = join(parent, 'delivery');
      } else {
        symlinkSync(parent, join(item.root, 'alias'));
        item.folder = join(item.root, 'alias', 'delivery');
      }
      break;
    }
    case 'absent parent':
      item.folder = join(item.root, 'absent', 'delivery');
      break;
    default:
      throw Error(choice);
  }
});

Then('Plan refuses with {string} and publishes nothing', function (this: World, error: string) {
  const item = scenario(this);
  assert.deepEqual(item.result, { code: 2, out: '', err: `architect-os plan: ${error}\n` });
  assert.equal(existsSync(item.folder), false);
});
Then('Plan refuses the destination without replacing existing files', function (this: World) {
  const item = scenario(this);
  assert.deepEqual(item.result, { code: 2, out: '', err: 'architect-os plan: PLAN_PUBLISH_REFUSED\n' });
  if (existsSync(item.folder)) assert.equal(readFileSync(join(item.folder, 'step.json'), 'utf8'), 'keep');
});

Then('the materialized files match the preview and its manifest', function (this: World) {
  const { result, preview, folder, define, proposal, policy } = scenario(this);
  assert.equal(result?.code, 0, result?.err ?? 'Missing Plan result');
  assert.ok(preview && result);
  assert.deepEqual(JSON.parse(result.out), {
    status: 'materialized',
    manifest: preview.manifest,
    approval_sha256: preview.approval_sha256,
    folder,
  });
  assert.equal(preview.manifest.version, 1);
  assert.equal(preview.manifest.run_id, 'run_delivery_demo');
  assert.deepEqual(preview.manifest.source_sha256, {
    define: hash(readFileSync(define, 'utf8')),
    proposal: hash(readFileSync(proposal, 'utf8')),
    policy: hash(readFileSync(policy, 'utf8')),
  });
  assert.deepEqual(readdirSync(folder).sort(), Object.keys(preview.files).sort());
  for (const [name, text] of Object.entries(preview.files)) {
    assert.equal(readFileSync(join(folder, name), 'utf8'), text);
    assert.equal(preview.manifest.files_sha256[name], hash(text));
  }
  const brief = preview.files['brief.md']!;
  const payload = {
    run_id: 'run_delivery_demo',
    ...load(proposal),
    requirements: load(define).handoff.requirements,
    acceptance: load(define).handoff.acceptance,
  };
  assert.equal(
    brief,
    '# Approved plan inputs\n\nUse the following record as planning data.\n\n```json\n' +
      JSON.stringify(payload, null, 2) +
      '\n```\n',
  );
  assert.deepEqual(load(join(folder, 'step.json')).build, load(policy).step.build);
});
Then('the Step folder contains the exact host scout question', function (this: World) {
  assert.equal(
    readFileSync(join(scenario(this).folder, 'scout.history.md'), 'utf8'),
    'Where is the CI-only stop enforced?\n',
  );
});

When('I call Plan with an invalid {string} invocation', function (this: World, mode: string) {
  const x = scenario(this);
  const args: Record<string, string[]> = {
    action: ['unknown', x.define, x.proposal, x.policy],
    define: ['prepare', '', x.proposal, x.policy],
    proposal: ['prepare', x.define, '', x.policy],
    policy: ['prepare', x.define, x.proposal],
    prepare: ['prepare', x.define, x.proposal, x.policy, 'extra'],
    'unknown materialize': ['unknown', x.define, x.proposal, x.policy, x.decision, x.folder],
    materialize: ['materialize', x.define, x.proposal, x.policy, x.decision],
  };
  x.result = launch(args[mode]!);
});
Then('Plan prints usage and publishes nothing', function (this: World) {
  const item = scenario(this);
  assert.equal(item.result?.code, 2);
  assert.equal(item.result?.out, '');
  assert.match(item.result?.err ?? '', /^architect-os plan: usage: plan prepare /);
  assert.equal(existsSync(item.folder), false);
});

Then('the Plan validation identifies the rejected coverage or question', function (this: World) {
  const item = scenario(this);
  const define = readFileSync(item.define, 'utf8');
  const proposal = readFileSync(item.proposal, 'utf8');
  const policy = readFileSync(item.policy, 'utf8');
  if (load(item.policy).step.scouts) {
    assert.throws(() => readStepInputs(policy), { message: 'PLAN_SCOUT_QUESTIONS_INVALID' });
  } else {
    assert.throws(() => preparePlan({ define, proposal, policy }, readStepInputs(policy)), {
      message: 'PLAN_COVERAGE_INVALID',
    });
  }
});

When('I simulate a failed write of the approved Step policy', function (this: World) {
  const item = scenario(this);
  const realWrite = fs.writeFileSync;
  const io = mock.method(
    fs,
    'writeFileSync',
    (...[path, data, options]: Parameters<typeof writeFileSync>) => {
      if (path === join(item.folder, 'step.json')) throw new Error('injected write failure');
      realWrite(path, data, options);
    },
  );
  const mkdir = mock.method(fs, 'mkdirSync');
  syncBuiltinESMExports();
  try {
    item.result = launch([
      'materialize',
      item.define,
      item.proposal,
      item.policy,
      item.decision,
      item.folder,
    ]);
    const claim = mkdir.mock.calls[0]?.arguments;
    assert.equal(claim?.[0], item.folder);
    assert.deepEqual(claim?.[1], { mode: 0o700 });
    assert.deepEqual(io.mock.calls[0]?.arguments[2], { flag: 'wx' });
    assert.equal(io.mock.calls[0]?.arguments[0], join(item.folder, 'brief.md'));
  } finally {
    io.mock.restore();
    mkdir.mock.restore();
    syncBuiltinESMExports();
  }
});

Then('the Plan publisher detects the archived destination', function (this: World) {
  const item = scenario(this);
  assert.throws(() => publishStepInputs(item.folder, 'delivery', item.preview!.files), {
    message: 'PLAN_DESTINATION_RESERVED',
  });
});

Then('the Plan publisher detects the invalid destination', function (this: World) {
  const item = scenario(this);
  assert.throws(() => publishStepInputs(item.folder, 'delivery', item.preview!.files), {
    message: 'PLAN_DESTINATION_INVALID',
  });
});

Given('the recorded proposal carries independent Define and Plan reviews', function (this: World) {
  const item = scenario(this);
  const proposal = load(item.proposal);
  const binding = {
    version: 1,
    run_id: load(item.define).handoff.run_id,
    define_sha256: hash(readFileSync(item.define, 'utf8')),
    proposal_sha256: hash(JSON.stringify(proposal) + '\n'),
  };
  const plan_sha256 = hash(JSON.stringify(binding) + '\n');
  const drafter = { provider: 'openai', model: 'fixture-drafter' };
  const reviewer = { provider: 'google', model: 'fixture-reviewer' };
  const clear = { status: 'clear', citations: [] };
  json(item.proposal, {
    reviewed_plan: {
      ...binding,
      plan_sha256,
      proposal,
      drafter,
      reviewer,
      verdict: { plan_sha256, status: 'clear', findings: [] },
    },
    define_review: {
      version: 1,
      define_sha256: binding.define_sha256,
      input_sha256: hash('Define fixture'),
      drafter,
      reviewer,
      axes: { scope_creep: clear, missing_edge_case: clear },
    },
  });
});

When('the reviewed Plan bytes are changed after review', function (this: World) {
  const item = scenario(this);
  const receipt = load(item.proposal);
  receipt.reviewed_plan.proposal.objective = 'A different plan.';
  json(item.proposal, receipt);
});

Then('the Plan preview binds the complete review receipt', function (this: World) {
  const item = scenario(this);
  assert.equal(item.result?.code, 0);
  assert.equal(item.preview?.status, 'pending');
  assert.equal(
    item.preview?.manifest.source_sha256['reviewed_plan'],
    hash(readFileSync(item.proposal, 'utf8')),
  );
  assert.equal(existsSync(item.folder), false);
});
