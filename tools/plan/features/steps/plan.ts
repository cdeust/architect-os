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
  independent_reviews?: unknown;
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
  /** The routing table Plan reads; the launcher's own when absent. */
  routingTable?: string;
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

/** The routing table of a policy that is not routed: reading it is a defect. */
const unreadTable = (): string => {
  throw new Error('a policy without routing read the routing table');
};

function launch(args: readonly string[], routingTable?: string): TextResult {
  let out = '';
  let err = '';
  const code = runPlan({
    argv: [process.execPath, 'plan', ...args],
    ...(routingTable === undefined ? {} : { routingTable: () => routingTable }),
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

Given('the saved Define handoff contains ticket estimates', function (this: World) {
  const item = scenario(this);
  const define = load(item.define);
  define.handoff.tickets = [
    { id: 'TICKET-001', story_points: 5, depends_on: [], acceptance_ids: ['AC-001'] },
    { id: 'TICKET-002', story_points: 13, depends_on: ['TICKET-001'], acceptance_ids: ['AC-002'] },
  ];
  json(item.define, define);
});

Given('the Plan reads the saved Define and verified proposal CLI output', function (this: World) {
  const item = scenario(this);
  const result = this.state['defineResult'] as TextResult & { stdout: string };
  assert.equal(result.code, 0);
  writeFileSync(item.define, result.stdout);
  writeFileSync(item.proposal, this.state['verifiedProposalOutput'] as string);
});

Then(
  'the approved Step inputs contain the tickets and the operator build configuration',
  function (this: World) {
    const item = scenario(this);
    assert.equal(item.result?.code, 0);
    const files = item.preview!.files;
    const expected = load(item.define).handoff.tickets;
    assert.ok(files['step.json']!.endsWith('\n'));
    assert.deepEqual(JSON.parse(files['step.json']!), {
      build: { model: 'operator-build', effort: 'medium', limitSeconds: 60 },
      scouts: [],
      checks: [],
      reviews: [],
      parallel: 2,
      tickets: expected,
    });
    assert.deepEqual(JSON.parse(files['brief.md']!.split('```')[1]!.slice(4)).tickets, expected);
  },
);

When('the ticket estimate changes after approval', function (this: World) {
  const item = scenario(this);
  const define = load(item.define);
  define.handoff.tickets[0].story_points = 8;
  json(item.define, define);
});
Given('the Plan policy includes a named scout', function (this: World) {
  scout(scenario(this));
});

Given('the Plan input is changed to {string}', function (this: World, change: string) {
  const item = scenario(this);
  const define = load(item.define);
  const proposal = load(item.proposal);
  const policy = load(item.policy);
  switch (change) {
    case 'invalid handoff tickets':
      define.handoff.tickets = [
        { id: 'TICKET-001', story_points: 5, depends_on: ['TICKET-001'], acceptance_ids: ['AC-001'] },
      ];
      break;
    case 'proposal tickets':
      proposal.tickets = [];
      break;
    case 'policy tickets':
      policy.step.tickets = [
        { id: 'TICKET-001', story_points: 5, depends_on: [], acceptance_ids: ['AC-001'] },
      ];
      break;
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
  const result = launch(['prepare', item.define, item.proposal, item.policy], item.routingTable);
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
  item.result = launch(
    ['materialize', item.define, item.proposal, item.policy, item.decision, item.folder],
    item.routingTable,
  );
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
  const handoff = load(define).handoff;
  assert.equal(preview.manifest.run_id, handoff.run_id);
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
    run_id: handoff.run_id,
    ...load(proposal),
    requirements: handoff.requirements,
    acceptance: handoff.acceptance,
    tickets: handoff.tickets,
  };
  assert.equal(
    brief,
    '# Approved plan inputs\n\nUse the following record as planning data.\n\n```json\n' +
      JSON.stringify(payload, null, 2) +
      '\n```\n',
  );
  const published = load(join(folder, 'step.json'));
  // A routed policy names no build: the Step builds with the first pass of its route.
  assert.deepEqual(
    published.build,
    load(policy).step.routing ? published.routing.ladder[0].build : load(policy).step.build,
  );
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
    assert.throws(() => readStepInputs(policy, unreadTable), { message: 'PLAN_SCOUT_QUESTIONS_INVALID' });
  } else {
    assert.throws(() => preparePlan({ define, proposal, policy }, readStepInputs(policy, unreadTable)), {
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
      drafter: { provider: 'anthropic', model: 'define-author' },
      reviewer: { provider: 'openai', model: 'define-reviewer' },
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
  const receipt = load(item.proposal);
  assert.equal(
    item.preview?.manifest.source_sha256['proposal'],
    hash(JSON.stringify(receipt.reviewed_plan.proposal) + '\n'),
  );
  assert.deepEqual(item.preview?.independent_reviews, {
    define: {
      drafter: receipt.define_review.drafter,
      reviewer: receipt.define_review.reviewer,
      status: 'clear',
    },
    plan: {
      drafter: receipt.reviewed_plan.drafter,
      reviewer: receipt.reviewed_plan.reviewer,
      status: 'clear',
    },
  });
  assert.equal(existsSync(item.folder), false);
});

Then(
  'preparing the independently reviewed receipt with a changed {string} rejects the binding',
  function (this: World, field: string) {
    const item = scenario(this);
    const define = readFileSync(item.define, 'utf8');
    const policy = readFileSync(item.policy, 'utf8');
    const receipt = load(item.proposal);
    const plan = receipt.reviewed_plan;
    switch (field) {
      case 'run':
        plan.run_id += '-other';
        break;
      case 'Define digest':
        plan.define_sha256 = receipt.define_review.define_sha256 = hash('different Define');
        break;
      case 'proposal digest':
        plan.proposal_sha256 = hash('different proposal');
        break;
      case 'binding digest':
        plan.plan_sha256 = plan.verdict.plan_sha256 = hash('different binding');
        break;
      default:
        assert.fail(field);
    }
    assert.throws(
      () =>
        preparePlan(
          { define, proposal: JSON.stringify(receipt), policy },
          readStepInputs(policy, unreadTable),
        ),
      { message: 'PLAN_REVIEW_EVIDENCE_MISMATCH' },
    );
  },
);

Then('Plan reports a schema error for the JSON primitive {string}', function (this: World, proposal: string) {
  const item = scenario(this);
  const define = readFileSync(item.define, 'utf8');
  const policy = readFileSync(item.policy, 'utf8');
  assert.throws(() => preparePlan({ define, proposal, policy }, readStepInputs(policy, unreadTable)), {
    name: 'ZodError',
  });
});

Given('the proposal uses {string} criterion IDs', function (this: World, change: string) {
  const item = scenario(this),
    proposal = load(item.proposal);
  switch (change) {
    case 'padded':
      proposal.acceptance_ids[0] = ' ' + proposal.acceptance_ids[0] + ' ';
      break;
    case 'reordered':
      proposal.acceptance_ids.reverse();
      break;
    case 'extra trailing':
      proposal.acceptance_ids.push('AC-099');
      break;
    default:
      assert.fail(change);
  }
  json(item.proposal, proposal);
});

Then('preparing the reviewed proposal refuses its coverage', function (this: World) {
  const item = scenario(this),
    define = readFileSync(item.define, 'utf8'),
    proposal = readFileSync(item.proposal, 'utf8'),
    policy = readFileSync(item.policy, 'utf8');
  assert.throws(() => preparePlan({ define, proposal, policy }, readStepInputs(policy, unreadTable)), {
    message: 'PLAN_COVERAGE_INVALID',
  });
});

Then('the prepared Plan contains the normalized criteria in the supplied order', function (this: World) {
  const item = scenario(this);
  assert.equal(item.result?.code, 0);
  const brief = item.preview!.files['brief.md']!;
  const data = JSON.parse(brief.split('```json\n')[1]!.split('\n```')[0]!);
  assert.deepEqual(
    data.acceptance_ids,
    load(item.proposal).acceptance_ids.map((id: string) => id.trim()),
  );
});

// Routed policies (docs/design/orchestration-fable-5-2.md, §13): the operator names the ticket and the providers it
// admits, and Plan derives every model from the launcher's routing table.
const launcherTable = () =>
  readFileSync(new URL('../../../../packages/sandbox/routing.json', import.meta.url), 'utf8');

function routedPolicy(item: Scenario, routing: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  json(item.policy, { step: { routing, ...extra }, scout_questions: {} });
}

Given(
  'the Plan policy routes the Step with the providers {string}',
  function (this: World, providers: string) {
    routedPolicy(scenario(this), { providers: providers.split(' ') });
  },
);

Given(
  'the Plan policy routes the Step to {string} with the providers {string}',
  function (this: World, ticket: string, providers: string) {
    routedPolicy(scenario(this), { ticket, providers: providers.split(' ') });
  },
);

Given(
  'the Plan policy routes the Step with one check and the providers {string}',
  function (this: World, providers: string) {
    routedPolicy(
      scenario(this),
      { providers: providers.split(' ') },
      { checks: [{ name: 'types', command: ['npx', 'tsc', '-b'], limitSeconds: 600 }] },
    );
  },
);

Given('the Plan policy routes the Step with a scout named {string}', function (this: World, name: string) {
  const item = scenario(this);
  json(item.policy, {
    step: { routing: { providers: ['anthropic'] }, scouts: [{ name }] },
    scout_questions: { [name]: 'Where is the CI-only stop enforced?\n' },
  });
});

Given('the first Define ticket is estimated at {int} points', function (this: World, points: number) {
  const item = scenario(this);
  const define = load(item.define);
  define.handoff.tickets[0].story_points = points;
  json(item.define, define);
});

Given('the routed Plan input is changed to {string}', function (this: World, change: string) {
  const item = scenario(this);
  const define = load(item.define);
  const policy = load(item.policy);
  switch (change) {
    case 'a model named by the operator':
      policy.step.build = { model: 'claude-opus-5-5', effort: 'high', limitSeconds: 60 };
      break;
    case 'two independent tickets':
      define.handoff.tickets[1].depends_on = [];
      break;
    case 'no tickets':
      delete define.handoff.tickets;
      break;
    case 'an unknown designated ticket':
      policy.step.routing.ticket = 'TICKET-009';
      break;
    case 'a designated ticket no producer numbers':
      policy.step.routing.ticket = 'TICKET-000';
      break;
    case 'only OpenAI admitted':
      policy.step.routing.providers = ['openai'];
      break;
    case 'the same provider admitted twice':
      policy.step.routing.providers = ['anthropic', 'anthropic'];
      break;
    case 'Google admitted':
      policy.step.routing.providers = ['anthropic', 'google'];
      break;
    case 'a scout without its question':
      policy.step.scouts = [{ name: 'history' }];
      break;
    case 'a broken routing table':
      item.routingTable = launcherTable().replace('"status": "provisional"', '"status": "measured"');
      break;
    default:
      throw new Error(`unknown change ${change}`);
  }
  json(item.define, define);
  json(item.policy, policy);
});

When('the launcher routing table changes after approval', function (this: World) {
  const table = JSON.parse(launcherTable());
  table.roles.build.bands[1].candidates[0].limitSeconds = 4801;
  scenario(this).routingTable = JSON.stringify(table);
});

function routedStepFile(item: Scenario) {
  assert.equal(item.result?.code, 0, item.result?.err ?? '');
  return JSON.parse(item.preview!.files['step.json']!);
}

Then(
  'the previewed Step builds {string} with {string} on {string} at {int} points, starting on {string}',
  function (this: World, model: string, effort: string, ticket: string, points: number, start: string) {
    const step = routedStepFile(scenario(this));
    assert.deepEqual({ model: step.build.model, effort: step.build.effort }, { model, effort });
    assert.deepEqual(
      { ticket: step.routing.ticket, points: step.routing.points, start: step.routing.start },
      { ticket, points, start },
    );
  },
);

Then('the previewed Step escalates through the bands {string}', function (this: World, bands: string) {
  const step = routedStepFile(scenario(this));
  assert.equal(step.routing.ladder.map(({ band }: { band: number }) => band).join(' '), bands);
});

Then('the previewed Step reviews by a Google wait and names no other review', function (this: World) {
  const step = routedStepFile(scenario(this));
  assert.deepEqual(step.reviews, []);
  for (const rung of step.routing.ladder)
    assert.deepEqual(rung.review, { provider: 'google', limitSeconds: 1500, waiting: true });
});

Then('the previewed Step binds the launcher routing table', function (this: World) {
  const item = scenario(this);
  const step = routedStepFile(item);
  assert.equal(step.routing.table_sha256, hash(launcherTable()));
  assert.equal(item.preview!.manifest.files_sha256['step.json'], hash(item.preview!.files['step.json']!));
});

Then('the previewed scout {string} runs on {string}', function (this: World, name: string, model: string) {
  const item = scenario(this);
  const step = routedStepFile(item);
  assert.deepEqual(step.scouts, [{ name, model, effort: 'low', limitSeconds: 300 }]);
  assert.equal(item.preview!.files[`scout.${name}.md`], 'Where is the CI-only stop enforced?\n');
});
