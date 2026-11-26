import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { After, Given, Then, When } from '@cucumber/cucumber';
import { parseDefinePlanningReply } from '@architect-os/contracts';
import type { DefineSource } from '../../src/domain/source.js';
import { runDefine } from '../../src/main.js';
import { runProposal } from '../../src/proposal.js';
import { prdGenSource } from '../../src/infrastructure/prd-gen.js';
import { readDefine } from '../../src/application/read-define.js';

interface DefineWorld {
  state: Record<string, unknown>;
}

const runId = 'run_fixture_1';
const delivery = {
  version: 1,
  run_id: runId,
  requirements: [
    { id: 'FR-001', text: 'Publish only the verified commit.' },
    { id: 'FR-002', text: 'Stop before publication with --until ci.' },
    { id: 'NFR-003', text: 'Retain the ruleset result.' },
  ],
  acceptance: [
    { id: 'AC-001', text: 'Stop when a check fails (FR-001).', requirement_ids: ['FR-001'] },
    { id: 'AC-002', text: 'Stop before publication (FR-002).', requirement_ids: ['FR-002'] },
    { id: 'AC-003', text: 'Retain the ruleset result (NFR-003).', requirement_ids: ['NFR-003'] },
  ],
};

const tickets = () => [
  { id: 'TICKET-002', story_points: 13, depends_on: ['TICKET-001'], acceptance_ids: ['AC-002'] },
  { id: 'TICKET-001', story_points: 1, depends_on: [], acceptance_ids: ['AC-001'] },
  { id: 'TICKET-003', story_points: 2, depends_on: ['TICKET-001', 'TICKET-002'], acceptance_ids: ['AC-003'] },
];
const ticketed = () => ({ handoff: { ...delivery, tickets: tickets() } });

type Reply = Awaited<ReturnType<DefineSource['getHandoff']>>;
const asText = (data: unknown): Reply => ({
  isError: false,
  content: [{ type: 'text', text: JSON.stringify(data) }],
});

function changed(which: string): Reply {
  const handoff = structuredClone(delivery);
  const { requirements: fr, acceptance: ac } = handoff;
  const wrap = (data: unknown): Reply => asText({ handoff: data });
  switch (which) {
    case 'producer refusal':
      return { ...wrap(handoff), isError: true };
    case 'empty content':
      return { content: [] };
    case 'extra content':
      return { content: [...wrap(handoff).content, ...wrap(handoff).content] };
    case 'nontext content':
      return { content: [{ type: 'image', text: JSON.stringify({ handoff }) }] };
    case 'scalar content':
      return { content: [1] };
    case 'null content':
      return { content: [null] };
    case 'missing content type':
      return { content: [{ text: JSON.stringify({ handoff }) }] };
    case 'missing text field':
      return { content: [{ type: 'text' }] };
    case 'nonstring text':
      return { content: [{ type: 'text', text: [JSON.stringify({ handoff })] }] };
    case 'malformed JSON':
      return { content: [{ type: 'text', text: '{' }] };
    case 'null payload':
      return asText(null);
    case 'scalar payload':
      return asText(1);
    case 'wrong envelope':
      return asText({ data: handoff });
    case 'extra envelope':
      return asText({ handoff, command: 'deliver' });
    case 'newer version':
      return wrap({ ...handoff, version: 2 });
    case 'different run':
      handoff.run_id = 'run_elsewhere_1';
      break;
    case 'empty run':
      handoff.run_id = '';
      break;
    case 'input command':
      return wrap({ ...handoff, command: ['deliver'] });
    case 'inline executor':
      return wrap({ ...handoff, requirements: [{ ...fr[0], executor: 'ship' }, ...fr.slice(1)] });
    case 'inline arguments':
      return wrap({ ...handoff, acceptance: [{ ...ac[0], argv: ['--until', 'end'] }, ...ac.slice(1)] });
    case 'invalid requirement':
      fr[0]!.id = 'FR-1234567890';
      break;
    case 'FR prefix':
      fr[0]!.id = 'xFR-001';
      ac[0]!.requirement_ids = ['xFR-001'];
      break;
    case 'FR suffix':
      fr[0]!.id = 'FR-001x';
      ac[0]!.requirement_ids = ['FR-001x'];
      break;
    case 'AC prefix':
      ac[0]!.id = 'xAC-001';
      break;
    case 'AC suffix':
      ac[0]!.id = 'AC-001x';
      break;
    case 'multiple links':
      ac[0]!.requirement_ids.push('FR-002');
      break;
    case 'invalid criterion':
      ac[0]!.id = 'FR-001';
      break;
    case 'no requirements':
      handoff.requirements = [];
      break;
    case 'no criteria':
      handoff.acceptance = [];
      break;
    case 'no criterion links':
      ac[0]!.requirement_ids = [];
      break;
    case 'duplicate FR':
      fr.push(fr[0]!);
      break;
    case 'duplicate AC':
      ac.push(ac[0]!);
      break;
    case 'repeated link':
      ac[0]!.requirement_ids.push('FR-001');
      break;
    case 'unknown link':
      ac[0]!.requirement_ids = ['FR-999'];
      break;
    case 'uncovered FR':
      handoff.acceptance = ac.slice(1);
      break;
    case 'reference-only text':
      ac[0]!.text = '(FR-001)';
      break;
    case 'punctuation only':
      fr[0]!.text = '…';
      break;
    default:
      throw new Error(which);
  }
  return wrap(handoff);
}

function prepare(world: DefineWorld): string {
  const root = mkdtempSync(join(tmpdir(), 'define-host-'));
  world.state['defineHostRoot'] = root;
  return root;
}

After<DefineWorld>(function () {
  const root = this.state['defineHostRoot'];
  if (typeof root === 'string') rmSync(root, { recursive: true });
});

/**
 * A fixture producer at `<root>/mcp-server/index.js`, the path the host pins. The digest the operator would give is
 * kept in the world; the request log lives at the plugin root, outside the hashed bundle.
 */
function plugin(world: DefineWorld, reply: Reply, plan?: Reply): string {
  const root = prepare(world);
  mkdirSync(join(root, 'mcp-server'));
  writeFileSync(join(root, 'mcp-server', 'package.json'), '{"type":"module"}\n');
  const bundle = join(root, 'mcp-server', 'index.js');
  writeFileSync(
    bundle,
    `
import { appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const record = join(root, 'requests.ndjson');
appendFileSync(record, JSON.stringify({ argv: process.argv.slice(1), skill: process.env.PRD_GEN_SKILL_CONFIG }) + '\\n');
for await (const line of createInterface({ input: process.stdin })) {
  const request = JSON.parse(line);
  if (request.id === undefined) continue;
  appendFileSync(record, JSON.stringify({ method: request.method, params: request.params }) + '\\n');
  const result = request.method === 'initialize'
    ? { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'prd-gen', version: '0.9.0' } }
    : request.params?.arguments?.format === 'verified_plan_v1'
      ? ${JSON.stringify(plan ?? { isError: true, content: [] })}
      : ${JSON.stringify(reply)};
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\\n');
}
appendFileSync(record, JSON.stringify({ closed: true }) + '\\n');
`,
  );
  world.state['defineBundleDigest'] = createHash('sha256').update(readFileSync(bundle)).digest('hex');
  return root;
}

const pinned = (world: DefineWorld) => world.state['defineBundleDigest'] as string;

Given('an isolated Define plugin that returns the delivery planning data', function (this: DefineWorld) {
  plugin(this, asText({ handoff: delivery }));
});

Given('an isolated Define plugin that returns delivery tickets', function (this: DefineWorld) {
  const file = (value: unknown) => JSON.stringify(value) + '\n';
  const digest = (input: string) => createHash('sha256').update(input).digest('hex');
  const proposal = {
    step: 'delivery',
    objective: 'Deliver the commit accepted by the gate.',
    verification: 'Observe a CI-only stop and the verified commit.',
    acceptance_ids: ['AC-001', 'AC-002', 'AC-003'],
  };
  const binding = {
    version: 1,
    run_id: runId,
    define_sha256: digest(file(ticketed())),
    proposal_sha256: digest(file(proposal)),
  };
  plugin(
    this,
    asText(ticketed()),
    asText({
      verified_plan: { ...binding, plan_sha256: digest(file(binding)), proposal },
    }),
  );
});

When('the host reads the matching verified proposal over stdio', async function (this: DefineWorld) {
  const root = this.state['defineHostRoot'] as string;
  const define = this.state['defineResult'] as { code: number; stdout: string };
  assert.equal(define.code, 0);
  const path = join(root, 'define.json');
  writeFileSync(path, define.stdout);
  const output: string[] = [];
  const diagnostics: string[] = [];
  const code = await runProposal({
    argv: [process.execPath, 'plan:proposal', runId, root, pinned(this), 'delivery', path],
    execPath: process.execPath,
    stdout: { write: (text) => output.push(text) },
    stderr: { write: (text) => diagnostics.push(text) },
  });
  assert.deepEqual({ code, diagnostics }, { code: 0, diagnostics: [] });
  this.state['verifiedProposalOutput'] = output.join('');
});

Given('a Define reply with valid delivery tickets', function (this: DefineWorld) {
  this.state['defineReply'] = asText(ticketed());
});

Given('a Define ticket reply changed to {string}', function (this: DefineWorld, change: string) {
  const baseline = tickets();
  const [first, second, third] = baseline;
  const amend = (fields: Record<string, unknown>) => [{ ...first, ...fields }, second, third];
  const withId = (id: string) => [{ ...first, id, depends_on: [] }];
  const variants = {
    'empty tickets': [],
    'null tickets': null,
    'empty acceptance': amend({ acceptance_ids: [] }),
    'unknown acceptance': amend({ acceptance_ids: ['AC-002', 'AC-999'] }),
    'repeated acceptance': amend({ acceptance_ids: ['AC-002', 'AC-002'] }),
    'unknown dependency': amend({ depends_on: ['TICKET-999'] }),
    'repeated dependency': amend({ depends_on: ['TICKET-001', 'TICKET-001'] }),
    'duplicate ticket': [...baseline, first],
    'self dependency': amend({ depends_on: ['TICKET-002'] }),
    'indirect cycle': [first, { ...second, depends_on: ['TICKET-003'] }, third],
    'disconnected cycle': [second, { ...third, depends_on: ['TICKET-003'] }],
    'non-Fibonacci points': amend({ story_points: 4 }),
    'zero points': amend({ story_points: 0 }),
    'negative points': amend({ story_points: -1 }),
    'fractional points': amend({ story_points: 2.5 }),
    'unsafe points': amend({ story_points: 14472334024676221 }),
    'string points': amend({ story_points: '13' }),
    'unsafe ticket id': withId('../TICKET-002'),
    'zero ticket id': withId('TICKET-000'),
    'short ticket id': withId('TICKET-02'),
    'long ticket id': withId('TICKET-0002'),
    'suffixed ticket id': withId('TICKET-002-a'),
    'extra ticket command': amend({ command: ['deliver'] }),
    'missing dependencies': amend({ depends_on: undefined }),
  };
  assert.ok(Object.hasOwn(variants, change));
  this.state['defineReply'] = asText({
    handoff: { ...delivery, tickets: variants[change as keyof typeof variants] },
  });
});

Then('the ticket schema names the refusal for {string}', function (this: DefineWorld, change: string) {
  const reply = this.state['defineReply'] as Reply;
  const reasons: Record<string, [string, (string | number)[]]> = {
    'unknown acceptance': ['TICKET_ACCEPTANCE_UNKNOWN', ['tickets']],
    'repeated acceptance': ['TICKET_ACCEPTANCE_DUPLICATE', ['tickets', 0, 'acceptance_ids']],
    'unknown dependency': ['TICKET_DEPENDENCY_UNKNOWN', ['tickets']],
    'repeated dependency': ['TICKET_DEPENDENCY_DUPLICATE', ['tickets', 0, 'depends_on']],
    'duplicate ticket': ['TICKET_ID_DUPLICATE', ['tickets']],
    'self dependency': ['TICKET_DEPENDENCY_CYCLE', ['tickets']],
    'indirect cycle': ['TICKET_DEPENDENCY_CYCLE', ['tickets']],
    'disconnected cycle': ['TICKET_DEPENDENCY_CYCLE', ['tickets']],
    'non-Fibonacci points': ['TICKET_POINTS_INVALID', ['tickets', 0, 'story_points']],
    'zero points': ['TICKET_POINTS_INVALID', ['tickets', 0, 'story_points']],
    'negative points': ['TICKET_POINTS_INVALID', ['tickets', 0, 'story_points']],
  };
  assert.throws(
    () => parseDefinePlanningReply(reply.content),
    (error: unknown) => {
      assert.ok(error instanceof Error && error.name === 'ZodError' && 'issues' in error);
      const expected = reasons[change];
      if (expected) {
        assert.deepEqual(error.issues, [
          { code: 'custom', message: expected[0], path: ['handoff', ...expected[1]] },
        ]);
      }
      return true;
    },
  );
});

Given('an isolated Define plugin whose pinned bundle exits at once', function (this: DefineWorld) {
  const root = prepare(this);
  mkdirSync(join(root, 'mcp-server'));
  const bundle = join(root, 'mcp-server', 'index.js');
  writeFileSync(
    bundle,
    `require('node:fs').writeFileSync(${JSON.stringify(join(root, 'started'))}, 'started\\n');\nprocess.exit(1);\n`,
  );
  this.state['defineBundleDigest'] = createHash('sha256').update(readFileSync(bundle)).digest('hex');
});

Given('an isolated directory without a Define launcher', function (this: DefineWorld) {
  prepare(this);
});

Given('a Define reply changed to {string}', function (this: DefineWorld, which: string) {
  this.state['defineReply'] = changed(which);
});

Given('the Define invocation has {string}', function (this: DefineWorld, form: string) {
  this.state['defineArgs'] = {
    'no run or root': [],
    'no plugin root': [runId],
    'an empty run': ['', 'plugin', 'a'.repeat(64)],
    'an empty plugin root': [runId, '', 'a'.repeat(64)],
    'no bundle digest': [runId, 'plugin'],
    'an uppercase bundle digest': [runId, 'plugin', 'A'.repeat(64)],
    'a short bundle digest': [runId, 'plugin', 'a'.repeat(63)],
    'a long bundle digest': [runId, 'plugin', 'a'.repeat(65)],
    'an extra operand': [runId, 'plugin', 'a'.repeat(64), 'ignored'],
  }[form];
});

async function invoke(
  world: DefineWorld,
  args: readonly string[],
  source?: (node: string, root: string, sha256: string) => DefineSource,
): Promise<void> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await runDefine(
    {
      argv: [process.execPath, 'cli.ts', ...args],
      execPath: process.execPath,
      stdout: { write: (text) => stdout.push(text) },
      stderr: { write: (text) => stderr.push(text) },
    },
    source,
  );
  world.state['defineResult'] = { code, stdout: stdout.join(''), stderr: stderr.join('') };
}

When('the host invokes the Define reader over stdio', async function (this: DefineWorld) {
  await invoke(this, [runId, this.state['defineHostRoot'] as string, pinned(this) ?? 'b'.repeat(64)]);
});

When('the host reads the Define reply', async function (this: DefineWorld) {
  await invoke(
    this,
    (this.state['defineArgs'] as string[] | undefined) ?? [runId, 'plugin', 'a'.repeat(64)],
    (node?: string, root?: string, sha256?: string) => {
      this.state['defineOpened'] = true;
      assert.equal(node, process.execPath);
      assert.equal(root, resolve('plugin'));
      assert.equal(sha256, 'a'.repeat(64));
      return {
        getHandoff: async (requested) => {
          assert.equal(requested, runId);
          return this.state['defineReply'] as Reply;
        },
      };
    },
  );
});

Then('the Define reader writes the three linked requirements and criteria', function (this: DefineWorld) {
  assert.deepEqual(this.state['defineResult'], {
    code: 0,
    stdout: `${JSON.stringify({ handoff: delivery })}\n`,
    stderr: '',
  });
});

Then('the Define reader writes the exact delivery tickets', function (this: DefineWorld) {
  assert.deepEqual(this.state['defineResult'], {
    code: 0,
    stdout: `${JSON.stringify(ticketed())}\n`,
    stderr: '',
  });
});

Then('the plugin received only the versioned read for the requested run', function (this: DefineWorld) {
  const root = this.state['defineHostRoot'] as string;
  const rows = readFileSync(join(root, 'requests.ndjson'), 'utf8')
    .trim()
    .split('\n')
    .map((row) => JSON.parse(row) as unknown);
  const real = realpathSync(root);
  assert.deepEqual(rows[0], {
    argv: [join(real, 'mcp-server', 'index.js')],
    skill: join(real, 'packages', 'skill', 'skill-config.json'),
  });
  const init = rows[1] as { method: string; params: { clientInfo: unknown } };
  assert.equal(init.method, 'initialize');
  assert.deepEqual(init.params.clientInfo, { name: 'architect-os-define', version: '0.1.0' });
  assert.deepEqual(rows.slice(2, -1), [
    {
      method: 'tools/call',
      params: {
        name: 'get_pipeline_state',
        arguments: { run_id: runId, format: 'define_handoff_v1' },
      },
    },
  ]);
  assert.deepEqual(rows.at(-1), { closed: true });
});

Then('the Define reader refuses with {string}', function (this: DefineWorld, message: string) {
  assert.deepEqual(this.state['defineResult'], {
    code: 2,
    stdout: '',
    stderr: `architect-os define: ${message}\n`,
  });
});

Then('it never opens a Define source', function (this: DefineWorld) {
  assert.equal(this.state['defineOpened'], undefined);
});

Then('the Define reader reports a transport failure', function (this: DefineWorld) {
  assert.deepEqual(this.state['defineResult'], {
    code: 3,
    stdout: '',
    stderr: 'architect-os define: DEFINE_TRANSPORT_FAILED\n',
  });
});

class InMemoryDefineSource implements DefineSource {
  readonly requested: string[] = [];

  constructor(private readonly reply: Reply) {}

  async getHandoff(id: string): Promise<Reply> {
    this.requested.push(id);
    return this.reply;
  }
}

Given(
  'the {string} Define source has a {string} reply',
  function (this: DefineWorld, adapter: string, reply: string) {
    const answer =
      reply === 'tickets'
        ? asText(ticketed())
        : reply === 'valid'
          ? asText({ handoff: delivery })
          : changed('producer refusal');
    this.state['defineAdapter'] = adapter;
    this.state['defineSource'] =
      adapter === 'memory'
        ? new InMemoryDefineSource(answer)
        : prdGenSource(process.execPath, plugin(this, answer), pinned(this));
  },
);

When('the host uses that Define source', async function (this: DefineWorld) {
  this.state['defineSourceResult'] = await readDefine(runId, this.state['defineSource'] as DefineSource);
});

Then(
  'the source contract reports {string} for the requested run',
  function (this: DefineWorld, reply: string) {
    const source = this.state['defineSource'] as InMemoryDefineSource;
    if (this.state['defineAdapter'] === 'memory') {
      assert.deepEqual(source.requested, [runId]);
    } else {
      const root = this.state['defineHostRoot'] as string;
      const rows = readFileSync(join(root, 'requests.ndjson'), 'utf8')
        .trim()
        .split('\n')
        .map((row) => JSON.parse(row) as unknown);
      assert.deepEqual(rows[2], {
        method: 'tools/call',
        params: {
          name: 'get_pipeline_state',
          arguments: { run_id: runId, format: 'define_handoff_v1' },
        },
      });
    }
    assert.deepEqual(
      this.state['defineSourceResult'],
      reply === 'tickets'
        ? ticketed()
        : reply === 'valid'
          ? { handoff: delivery }
          : { error: 'DEFINE_REFUSED' },
    );
  },
);

Then('the Define reader preserves the two links to the criterion', function (this: DefineWorld) {
  const { code, stdout, stderr } = this.state['defineResult'] as {
    code: number;
    stdout: string;
    stderr: string;
  };
  assert.equal(code, 0);
  assert.equal(stderr, '');
  const planning = JSON.parse(stdout) as { handoff: typeof delivery };
  assert.deepEqual(planning.handoff.acceptance[0]?.requirement_ids, ['FR-001', 'FR-002']);
});

Given('the operator pins {string} for that Define plugin', function (this: DefineWorld, change: string) {
  const root = this.state['defineHostRoot'] as string;
  const bundle = join(root, 'mcp-server', 'index.js');
  if (change === 'another digest') this.state['defineBundleDigest'] = '0'.repeat(64);
  else if (change === 'a symlinked bundle') {
    renameSync(bundle, join(root, 'mcp-server', 'other.js'));
    symlinkSync(join(root, 'mcp-server', 'other.js'), bundle);
  } else if (change === 'a changed bundle') writeFileSync(bundle, readFileSync(bundle, 'utf8') + '\n');
  else throw new Error(change);
});

Then('the Define plugin was never started', function (this: DefineWorld) {
  assert.equal(existsSync(join(this.state['defineHostRoot'] as string, 'requests.ndjson')), false);
});

When(
  'the host reads the verified proposal over stdio expecting a refusal',
  async function (this: DefineWorld) {
    const root = this.state['defineHostRoot'] as string;
    const path = join(root, 'define.json');
    writeFileSync(path, `${JSON.stringify(ticketed())}\n`);
    const output: string[] = [];
    const diagnostics: string[] = [];
    const code = await runProposal({
      argv: [process.execPath, 'plan:proposal', runId, root, pinned(this), 'delivery', path],
      execPath: process.execPath,
      stdout: { write: (text) => output.push(text) },
      stderr: { write: (text) => diagnostics.push(text) },
    });
    this.state['proposalRefusal'] = { code, stdout: output.join(''), stderr: diagnostics.join('') };
  },
);

Then('the proposal reader refuses with {string}', function (this: DefineWorld, message: string) {
  assert.deepEqual(this.state['proposalRefusal'], {
    code: 2,
    stdout: '',
    stderr: `architect-os proposal: ${message}\n`,
  });
});

Then('the pinned bundle was started before it exited', function (this: DefineWorld) {
  assert.equal(readFileSync(join(this.state['defineHostRoot'] as string, 'started'), 'utf8'), 'started\n');
});
