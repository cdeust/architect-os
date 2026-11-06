import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TOOLS, type Evidence, type WorkerOutput } from '@architect-os/contracts';
import { z } from 'zod';
import { parseAgentFile, type AgentProfile } from '../../worker/agent-file.js';
import { McpPlatformChannel, type PlatformCaller } from '../../worker/infrastructure/platform-channel.js';
import { evidenceOf } from '../../worker/infrastructure/sdk-task-agent.js';
import {
  serveTask,
  type AgentEnd,
  type AgentRun,
  type PlatformChannel,
  type TaskAgent,
} from '../../worker/task-worker.js';
import { Given, Then, When, required, slot, type MemoryWorld } from './helpers.js';

const ROOT = new URL('../../../../', import.meta.url);
const COST = { input_tokens: 3, output_tokens: 2, usd: 0.0002 };

/** A task agent that answers as it is told, and keeps the runs it got. */
class ScriptedTaskAgent implements TaskAgent {
  readonly runs: AgentRun[] = [];
  constructor(private readonly behaviour: () => AgentEnd) {}

  async run(run: AgentRun): Promise<AgentEnd> {
    this.runs.push(run);
    return this.behaviour();
  }
}

/** The gateway in memory: the input of the call, the relays it got, the outputs it was given. */
class ChannelInMemory implements PlatformChannel {
  readonly relays: [string, Record<string, unknown>][] = [];
  readonly outputs: WorkerOutput[] = [];
  constructor(private readonly given: unknown) {}

  async input(): Promise<unknown> {
    return this.given;
  }

  async relay(address: string, args: Record<string, unknown>) {
    this.relays.push([address, args]);
    return { text: '[]', isError: false };
  }

  async complete(output: WorkerOutput): Promise<void> {
    this.outputs.push(output);
  }
}

const profileOf = (world: MemoryWorld) =>
  required(world.state['profile'] as AgentProfile | undefined, 'a profile');
const agentOf = (world: MemoryWorld) =>
  required(world.state['agent'] as ScriptedTaskAgent | undefined, 'an agent');
const channelOf = (world: MemoryWorld) =>
  required(world.state['channel'] as ChannelInMemory | undefined, 'a served call');
const outputOf = (world: MemoryWorld) => {
  const outputs = channelOf(world).outputs;
  assert.equal(outputs.length, 1, 'the worker gives its output once');
  return outputs[0]!;
};
const committed = (path: string) => readFileSync(new URL(path, ROOT), 'utf8');

When('I read the committed task profile {string}', function (path: string) {
  this.state['profile'] = parseAgentFile(committed(path));
});

Then('the task profile is named {string} with the model {string}', function (name: string, model: string) {
  assert.equal(profileOf(this).name, name);
  assert.equal(profileOf(this).model, model);
});

Then('the task profile has exactly the tools:', function (table: { raw(): string[][] }) {
  assert.deepEqual(
    profileOf(this).tools,
    table.raw().map(([tool]) => tool),
  );
});

Then('the task profile prompt starts with {string}', function (start: string) {
  assert.ok(profileOf(this).prompt.startsWith(start), profileOf(this).prompt);
});

const DEFECTS: Record<string, (text: string) => string> = {
  'no frontmatter': (text) => text.slice(text.indexOf('\n---\n') + 5),
  'the misspelt field allowed_tools': (text) => text.replace('tools:', 'allowed_tools:'),
  'an empty prompt': (text) => text.slice(0, text.indexOf('\n---\n') + 5),
  'a tool of no platform server': (text) => text.replace('mcp__platform__memory_insert', 'Bash'),
  'the model gpt': (text) => text.replace('model: haiku', 'model: gpt'),
  'an uppercase name': (text) => text.replace('name: memory', 'name: Memory'),
  'a name with a space': (text) => text.replace('name: memory', 'name: memory agent'),
  'text before its frontmatter': (text) => `x\n${text}`,
  'a tool behind a prefix': (text) =>
    text.replace('- mcp__platform__memory_insert', '- xmcp__platform__memory_insert'),
  'a tool followed by more': (text) =>
    text.replace('mcp__platform__memory_insert', 'mcp__platform__memory_insert!'),
};

Then(
  'a copy of {string} with {} is refused saying {string}',
  function (path: string, defect: string, message: string) {
    const broken = required(DEFECTS[defect], `the defect ${defect}`)(committed(path));
    assert.throws(
      () => parseAgentFile(broken),
      (error: Error) => error.message.includes(message),
    );
  },
);

Given(
  'a scripted task agent that answers {string} with the evidence {string}',
  function (data: string, evidence: string) {
    const end: AgentEnd = {
      structured: JSON.parse(data),
      evidence: JSON.parse(evidence),
      cost: COST,
    };
    this.state['agent'] = new ScriptedTaskAgent(() => end);
  },
);

Given(
  'a scripted task agent that answers {string} with {int} evidences of a source of {int}, a ref of {int} and an excerpt of {int} characters',
  function (data: string, count: number, source: number, ref: number, excerpt: number) {
    const evidence: Evidence[] = Array.from({ length: count }, () => ({
      source: 's'.repeat(source),
      ref: 'r'.repeat(ref),
      excerpt: 'e'.repeat(excerpt),
    }));
    this.state['agent'] = new ScriptedTaskAgent(() => ({
      structured: JSON.parse(data),
      evidence,
      cost: COST,
    }));
  },
);

Given('a scripted task agent stopped at its max_turns', function () {
  this.state['agent'] = new ScriptedTaskAgent(() => ({ maxTurnsReached: true, cost: COST }));
});

Given('a scripted task agent that throws the error {string}', function (message: string) {
  this.state['agent'] = new ScriptedTaskAgent(() => {
    throw new Error(message);
  });
});

Given('a scripted task agent that throws the value {string}', function (value: string) {
  this.state['agent'] = new ScriptedTaskAgent(() => {
    throw value;
  });
});

Given('a scripted task agent that answers nothing', function () {
  this.state['agent'] = new ScriptedTaskAgent(() => assert.fail('the agent is not run'));
});

When('the worker serves {string}', async function (input: string) {
  const channel = new ChannelInMemory(JSON.parse(input));
  this.state['channel'] = channel;
  await serveTask(channel, agentOf(this), parseAgentFile(committed('agents/memory.md')));
});

Then('the worker gave the output {string}', function (expected: string) {
  assert.deepEqual(outputOf(this), JSON.parse(expected));
});

Then('the worker gave a failed output {string} saying {string}', function (code: string, message: string) {
  const output = outputOf(this);
  assert.equal(output.status, 'failed');
  assert.deepEqual(
    [output.data, output.evidence, output.cost],
    [null, [], { input_tokens: 0, output_tokens: 0, usd: 0 }],
  );
  assert.equal(output.error?.code, code);
  assert.ok(output.error.message.includes(message), output.error.message);
});

Then(
  'the task agent ran the tool {string} with the input {string}, {int} turns and the profile {string}',
  function (tool: string, input: string, turns: number, profile: string) {
    const [run] = agentOf(this).runs;
    assert.equal(agentOf(this).runs.length, 1);
    assert.deepEqual(
      [run!.tool, run!.input, run!.maxTurns, run!.agent.name],
      [tool, JSON.parse(input), turns, profile],
    );
  },
);

Then('the task agent got the JSON schema, draft-07, of the data of {string}', function (tool: string) {
  assert.deepEqual(
    agentOf(this).runs[0]!.outputSchema,
    z.toJSONSchema(TOOLS[tool as keyof typeof TOOLS].data, { target: 'draft-07' }),
  );
});

Then('a relay of the task agent to {string} reaches the channel', async function (address: string) {
  const answer = await agentOf(this).runs[0]!.relay(address, { query: 'x' });
  assert.deepEqual(answer, { text: '[]', isError: false });
  assert.deepEqual(channelOf(this).relays, [[address, { query: 'x' }]]);
});

Then(
  'the worker output is {string} with {int} evidences of a source of {int}, a ref of {int} and an excerpt of {int} characters',
  function (status: string, count: number, source: number, ref: number, excerpt: number) {
    const output = outputOf(this);
    assert.equal(output.status, status);
    assert.equal(output.evidence.length, count);
    for (const item of output.evidence)
      assert.deepEqual([item.source.length, item.ref.length, item.excerpt?.length], [source, ref, excerpt]);
  },
);

/** A fake MCP client of the gateway: what each tool answers, and the calls it got. */
interface FakeGateway {
  answers: Record<string, Record<string, unknown>>;
  calls: { name: string; arguments?: Record<string, unknown> }[];
}

const gatewayOf = (world: MemoryWorld) =>
  slot<FakeGateway>(world, 'gateway', () => ({ answers: {}, calls: [] }));
const channelOver = (world: MemoryWorld) => {
  const gateway = gatewayOf(world);
  const caller: PlatformCaller = {
    callTool: (async (params: { name: string; arguments?: Record<string, unknown> }) => {
      gateway.calls.push(params);
      return gateway.answers[params.name] ?? { content: [] };
    }) as PlatformCaller['callTool'],
  };
  return new McpPlatformChannel(caller);
};
const textAnswer = (text: string, isError?: boolean) => ({
  content: [{ type: 'text', text }],
  ...(isError === undefined ? {} : { isError }),
});

Given('an MCP gateway that answers task_input with {string}', function (input: string) {
  gatewayOf(this).answers['task_input'] = textAnswer(input);
});

Then('the channel input is {string}', async function (expected: string) {
  assert.deepEqual(await channelOver(this).input(), JSON.parse(expected));
  assert.deepEqual(gatewayOf(this).calls.at(-1), { name: 'task_input', arguments: {} });
});

Then(
  'the channel relays {string} with {string} as the call {string}, its answer {string} and no error',
  async function (address: string, args: string, call: string, answer: string) {
    gatewayOf(this).answers['call'] = textAnswer(answer, false);
    assert.deepEqual(await channelOver(this).relay(address, JSON.parse(args)), {
      text: answer,
      isError: false,
    });
    assert.deepEqual(gatewayOf(this).calls.at(-1), { name: 'call', arguments: JSON.parse(call) });
  },
);

Then(
  'the channel relays {string} with {string} to a refusal {string} flagged as an error',
  async function (address: string, args: string, refusal: string) {
    gatewayOf(this).answers['call'] = textAnswer(refusal, true);
    assert.deepEqual(await channelOver(this).relay(address, JSON.parse(args)), {
      text: refusal,
      isError: true,
    });
  },
);

Then(
  'the channel relays {string} with {string} to an answer without text, read as {string}',
  async function (address: string, args: string, text: string) {
    gatewayOf(this).answers['call'] = { content: [{ type: 'image', data: 'x', mimeType: 'image/png' }] };
    assert.deepEqual(await channelOver(this).relay(address, JSON.parse(args)), { text, isError: false });
  },
);

Then(
  'the channel gives the output {string} as the arguments of task_complete',
  async function (output: string) {
    gatewayOf(this).answers['task_complete'] = textAnswer('ok');
    await channelOver(this).complete(JSON.parse(output) as WorkerOutput);
    assert.deepEqual(gatewayOf(this).calls.at(-1), {
      name: 'task_complete',
      arguments: { output: JSON.parse(output) },
    });
  },
);

Then('the channel fails when the gateway refuses the output with {string}', async function (message: string) {
  gatewayOf(this).answers['task_complete'] = textAnswer(message, true);
  await assert.rejects(
    channelOver(this).complete({ status: 'ok', data: {}, evidence: [], cost: COST }),
    (error: Error) => error.message === `the gateway refused the output: ${message}`,
  );
});

Then(
  'the evidence of the answer {string} from {string} is {string}',
  function (answer: string, source: string, evidence: string) {
    assert.deepEqual(evidenceOf(source, answer), JSON.parse(evidence));
  },
);

Then(
  'a copy of {string} with the model {word} loads with the model {string}',
  function (path: string, model: string, expected: string) {
    assert.equal(parseAgentFile(committed(path).replace('model: haiku', `model: ${model}`)).model, expected);
  },
);

Then(
  'the channel relays {string} with {string} to an answer with no content, read as {string}',
  async function (address: string, args: string, text: string) {
    gatewayOf(this).answers['call'] = {};
    assert.deepEqual(await channelOver(this).relay(address, JSON.parse(args)), { text, isError: false });
  },
);

Then(
  'the channel relays {string} with {string} to an answer with an empty content, read as {string}',
  async function (address: string, args: string, text: string) {
    gatewayOf(this).answers['call'] = { content: [] };
    assert.deepEqual(await channelOver(this).relay(address, JSON.parse(args)), { text, isError: false });
  },
);
