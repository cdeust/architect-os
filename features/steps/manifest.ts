import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { INTERNAL_TOOLS, TOOLS, TopologySchema } from '@architect-os/contracts';
import { z } from 'zod';
import { Given, ROOT, Then, When, stored } from './helpers.js';

/** The topology as JSON, before its schema: a scenario breaks one rule of it. */
interface Raw {
  catalog: { modules: Module[] };
  servers: { mcpServers: Record<string, Record<string, unknown>> };
  clients: { profiles: Record<string, unknown>[] };
}
type Module = Record<string, unknown> & {
  name: string;
  tools: Record<string, unknown>[];
  calls_allowed: string[];
  writes_tables: string[];
};

const read = (path: string): unknown => JSON.parse(readFileSync(join(ROOT, path), 'utf8'));

Given('the committed topology', function () {
  this.state['topology'] = {
    catalog: read('topology/catalog.json'),
    servers: read('topology/modules.mcp.json'),
    clients: read('topology/clients.json'),
  };
});

Given('the fixture topology', function () {
  this.state['topology'] = read('features/descriptive/fixtures/topology.json');
});

const module = (raw: Raw, name: string): Module => {
  const found = raw.catalog.modules.find((m) => m.name === name);
  assert.ok(found, `no module ${name} in the fixture`);
  return found;
};

/** Named breaks of the fixture, one per row of the Examples of manifest.feature. */
const BREAKS: Record<string, (raw: Raw) => void> = {
  'a tool of kind agent is marked stable': (raw) => void (module(raw, 'scout').tools[0]!['stable'] = true),
  'a tool of kind agent has no agent block': (raw) => void (module(raw, 'scout')['agent'] = null),
  'a module without a tool of kind agent has one': (raw) =>
    void (module(raw, 'judge')['agent'] = module(raw, 'scout')['agent']),
  'a module calls itself': (raw) => void module(raw, 'judge').calls_allowed.push('judge'),
  'calls_allowed makes a cycle': (raw) => void module(raw, 'judge').calls_allowed.push('memory-recall'),
  'calls_allowed makes a cycle below the first module': (raw) => {
    module(raw, 'judge').calls_allowed.push('memory-write');
    module(raw, 'memory-write').calls_allowed.push('judge');
  },
  'a module may call what is not a module': (raw) =>
    void module(raw, 'judge').calls_allowed.push('web-scout'),
  'two modules write one table': (raw) => void module(raw, 'judge').writes_tables.push('memory.memories'),
  'two modules have one name': (raw) => void raw.catalog.modules.push({ ...module(raw, 'judge') }),
  'two tools of a module have one name': (raw) =>
    void module(raw, 'judge').tools.push({ ...module(raw, 'judge').tools[0]! }),
  'two tools of two modules have one address': (raw) =>
    void (module(raw, 'memory-write').tools[0]!['name'] = 'recall'),
  'a deadline is zero': (raw) => void (module(raw, 'judge')['timeout_ms'] = 0),
  'a result has no token': (raw) => void (module(raw, 'judge').tools[0]!['max_result_tokens'] = 0),
  'the egress is an empty list': (raw) => void (module(raw, 'scout')['egress'] = []),
  'a manifest has a field the schema does not know': (raw) => void (module(raw, 'judge')['cache'] = true),
  'a server is reached over http': (raw) => void (raw.servers.mcpServers['judge']!['type'] = 'http'),
  'a module has no server': (raw) => void delete raw.servers.mcpServers['scout'],
  'a server has no module': (raw) =>
    void (raw.servers.mcpServers['spare'] = { command: 'node', args: ['modules/spare/dist/src/serve.js'] }),
  'a profile sees what is not a module': (raw) =>
    void (raw.clients.profiles[0]!['modules'] as string[]).push('web-scout'),
  'two profiles have one name': (raw) => void raw.clients.profiles.push({ ...raw.clients.profiles[0]! }),
  'a profile allows no call': (raw) => void (raw.clients.profiles[0]!['max_calls'] = 0),
};

When('the fixture topology is changed so that {}', function (defect: string) {
  const change = BREAKS[defect];
  assert.ok(change, `no break named "${defect}"`);
  change(stored<Raw>(this, 'topology'));
});

/** Sets the value at a dotted path of the raw topology, a number naming an index of an array. */
When('the fixture topology has {word} set to {}', function (path: string, value: string) {
  const keys = path.split('.');
  const last = keys.pop()!;
  let node = stored<Record<string, unknown>>(this, 'topology');
  for (const key of keys) {
    const next = node[key];
    assert.ok(typeof next === 'object' && next !== null, `no object at ${key} of ${path}`);
    node = next as Record<string, unknown>;
  }
  node[last] = JSON.parse(value);
});

Then('the topology is refused at {word}', function (path: string) {
  const parsed = TopologySchema.safeParse(stored<unknown>(this, 'topology'));
  assert.equal(parsed.success, false, 'the topology was accepted');
  const paths = parsed.error?.issues.map((issue) => issue.path.join('.')) ?? [];
  assert.ok(paths.includes(path), `no issue at ${path}:\n${parsed.error?.message}`);
});

Then('the parsed topology has {word} equal to {}', function (path: string, value: string) {
  const parsed = TopologySchema.parse(stored<unknown>(this, 'topology'));
  const got = path.split('.').reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], parsed);
  assert.deepEqual(got, JSON.parse(value));
});

Then('the topology is valid', function () {
  const parsed = TopologySchema.safeParse(stored<unknown>(this, 'topology'));
  assert.ok(parsed.success, parsed.success ? '' : parsed.error.message);
});

Then('the topology is refused saying {string}', function (message: string) {
  const parsed = TopologySchema.safeParse(stored<unknown>(this, 'topology'));
  assert.equal(parsed.success, false, 'the topology was accepted');
  const issues = parsed.error?.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`) ?? [];
  assert.ok(
    issues.some((issue) => issue.includes(message)),
    `no issue says "${message}":\n${issues.join('\n')}`,
  );
});

Then('the committed catalogue has the modules {string}', function (names: string) {
  const parsed = TopologySchema.parse(stored<unknown>(this, 'topology'));
  assert.deepEqual(
    parsed.catalog.modules.map((module) => module.name),
    names.split(', '),
  );
});

/** The contracts the committed schema files describe, by the words of manifest.feature. */
const CONTRACTS: Record<string, z.ZodType> = {
  'the input of the internal tool memory_search': INTERNAL_TOOLS.memory_search.input,
  'the input of the internal tool memory_insert': INTERNAL_TOOLS.memory_insert.input,
  'the input of the intent tool recall': TOOLS.recall.input,
  'the data of the intent tool recall': TOOLS.recall.data,
  'the input of the intent tool remember': TOOLS.remember.input,
  'the data of the intent tool remember': TOOLS.remember.data,
};

Then('the committed schema {string} is the JSON schema of {}', function (file: string, contract: string) {
  const schema = CONTRACTS[contract];
  assert.ok(schema, `no contract named "${contract}"`);
  const io = contract.startsWith('the input') ? 'input' : 'output';
  assert.deepEqual(read(file), JSON.parse(JSON.stringify(z.toJSONSchema(schema, { io }))));
});

Then('every schema a tool names is a file under modules\\/<module>\\/', function () {
  const parsed = TopologySchema.parse(stored<unknown>(this, 'topology'));
  for (const module of parsed.catalog.modules) {
    for (const tool of module.tools) {
      for (const schema of [tool.input_schema, tool.output_schema].filter((s) => s !== undefined)) {
        const file = join('modules', module.name, schema);
        assert.ok(existsSync(join(ROOT, file)), `${module.name}.${tool.name}: ${file} is missing`);
      }
    }
  }
});
