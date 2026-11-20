import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { After, Given, Then, When } from '@cucumber/cucumber';
import type { DefineSource } from '../../src/domain/source.js';
import { runDefine } from '../../src/main.js';
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

function plugin(world: DefineWorld, reply: Reply): string {
  const root = prepare(world);
  mkdirSync(join(root, 'bin'));
  writeFileSync(
    join(root, 'bin', 'ensure-deps.mjs'),
    `
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
const root = process.argv[2];
const record = join(root, 'requests.ndjson');
appendFileSync(record, JSON.stringify({ skill: process.env.PRD_GEN_SKILL_CONFIG }) + '\\n');
for await (const line of createInterface({ input: process.stdin })) {
  const request = JSON.parse(line);
  if (request.id === undefined) continue;
  appendFileSync(record, JSON.stringify({ method: request.method, params: request.params }) + '\\n');
  const result = request.method === 'initialize'
    ? { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'prd-gen', version: '0.9.0' } }
    : ${JSON.stringify(reply)};
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\\n');
}
appendFileSync(record, JSON.stringify({ closed: true }) + '\\n');
`,
  );
  return root;
}

Given('an isolated Define plugin that returns the delivery planning data', function (this: DefineWorld) {
  plugin(this, asText({ handoff: delivery }));
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
    'an extra operand': [runId, 'plugin', 'ignored'],
  }[form];
});

async function invoke(
  world: DefineWorld,
  args: readonly string[],
  source?: (node: string, root: string) => DefineSource,
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
  await invoke(this, [runId, this.state['defineHostRoot'] as string]);
});

When('the host reads the Define reply', async function (this: DefineWorld) {
  await invoke(
    this,
    (this.state['defineArgs'] as string[] | undefined) ?? [runId, 'plugin'],
    (node?: string, root?: string) => {
      this.state['defineOpened'] = true;
      assert.equal(node, process.execPath);
      assert.equal(root, resolve('plugin'));
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

Then('the plugin received only the versioned read for the requested run', function (this: DefineWorld) {
  const root = this.state['defineHostRoot'] as string;
  const rows = readFileSync(join(root, 'requests.ndjson'), 'utf8')
    .trim()
    .split('\n')
    .map((row) => JSON.parse(row) as unknown);
  assert.deepEqual(rows[0], { skill: join(root, 'packages', 'skill', 'skill-config.json') });
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
    const answer = reply === 'valid' ? asText({ handoff: delivery }) : changed('producer refusal');
    this.state['defineAdapter'] = adapter;
    this.state['defineSource'] =
      adapter === 'memory'
        ? new InMemoryDefineSource(answer)
        : prdGenSource(process.execPath, plugin(this, answer));
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
      reply === 'valid' ? { handoff: delivery } : { error: 'DEFINE_REFUSED' },
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
