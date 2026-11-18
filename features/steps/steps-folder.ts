import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildRecord,
  isStepName,
  parseStepFile,
  stepRecordSchema,
  type StepFile,
} from '@architect-os/sandbox';
import type { ArchitectWorld } from '../support/world.js';
import { Given, ROOT, Then, When, stored } from './helpers.js';

// The gate reads steps/ (docs/design/orchestration-fable-5-2.md, §14): the rule of one folder is a function, which the
// scenarios on broken copies reuse.

const sha256 = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');

/** What is wrong with the folder `steps/<name>`, or null. `reason` strings are the ones the scenarios expect. */
function folderDefect(steps: string, name: string): string | null {
  const folder = join(steps, name);
  if (!lstatSync(folder).isDirectory()) return `${name}: is not a directory`;
  if (!isStepName(name)) return `${name}: its name is refused by the expression of the step names`;
  const entries = readdirSync(folder, { withFileTypes: true });
  const present = new Set(entries.map((entry) => entry.name));
  if (!present.has('step.json')) return `${name}: step.json is missing`;
  let scouts: string[];
  try {
    scouts = parseStepFile(JSON.parse(readFileSync(join(folder, 'step.json'), 'utf8'))).scouts.map(
      (scout) => `scout.${scout.name}.md`,
    );
  } catch {
    return `${name}: step.json is refused`;
  }
  const inputs = ['brief.md', 'step.json', ...scouts];
  const expected = [...inputs, 'record.json'];
  const missing = expected.find((file) => !present.has(file));
  if (missing !== undefined) return `${name}: ${missing} is missing`;
  const excess = [...present].sort().find((file) => !expected.includes(file));
  if (excess !== undefined) return `${name}: ${excess} is in excess`;
  const odd = entries.find((entry) => !entry.isFile());
  if (odd !== undefined) return `${name}: ${odd.name} is not a regular file`;
  const parsed = (() => {
    try {
      return stepRecordSchema().safeParse(JSON.parse(readFileSync(join(folder, 'record.json'), 'utf8')));
    } catch {
      return undefined;
    }
  })();
  if (parsed?.success !== true) return `${name}: record.json is refused`;
  const record = parsed.data;
  if (record.step !== name) return `${name}: record.step is ${record.step}, not ${name}`;
  const hashed = new Map(Object.entries(record.inputs));
  for (const file of inputs) if (!hashed.has(file)) return `${name}: record.inputs has no hash of ${file}`;
  for (const file of hashed.keys()) {
    if (!inputs.includes(file))
      return `${name}: record.inputs holds the hash of ${file}, which is not an input`;
  }
  for (const file of inputs) {
    if (hashed.get(file) !== sha256(readFileSync(join(folder, file)))) {
      return `${name}: ${file} is not the file the record hashed`;
    }
  }
  return null;
}

/** The first defect among the entries of `steps/`, or null; an absent `steps/` has none. */
function stepsDefect(steps: string): string | null {
  const own = lstatSync(steps, { throwIfNoEntry: false });
  if (own === undefined) return null;
  if (!own.isDirectory()) return 'steps: is not a directory';
  for (const name of readdirSync(steps).sort()) {
    const defect = folderDefect(steps, name);
    if (defect !== null) return defect;
  }
  return null;
}

interface Steps {
  steps: string;
  defect?: string | null;
}
const own = (world: ArchitectWorld) => stored<Steps>(world, 'stepsFolder');

const STEP_FILE: Pick<StepFile, 'build' | 'scouts'> = {
  build: { model: 'claude-sonnet-5-5', effort: 'medium', limitSeconds: 2400 },
  scouts: [{ name: 'files', model: 'claude-haiku-5-5', effort: 'low', limitSeconds: 300 }],
};
const INPUTS = {
  'brief.md': 'Build the thing.\n',
  'step.json': `${JSON.stringify(STEP_FILE, null, 2)}\n`,
  'scout.files.md': 'Where is the thing?\n',
};

/** A folder `steps/<name>` as the host writes it. */
function writeValid(steps: string, name: string): void {
  const folder = join(steps, name);
  mkdirSync(folder, { recursive: true });
  const record = buildRecord({
    step: name,
    startedAt: new Date('2026-11-18T09:30:00.000Z'),
    tree: { commit: 'a'.repeat(40), tree: 'b'.repeat(40), clean: true },
    inputs: INPUTS,
    launcher: { 'code.json': '{}' },
    sessions: [
      {
        role: 'build',
        config: STEP_FILE.build,
        completed: true,
        stopped: false,
        durationSeconds: 1,
        costUsd: 0.5,
        costByModel: { 'claude-sonnet-5-5': 0.5 },
      },
    ],
    checks: [],
    reviews: [],
    outcome: 'passed',
  });
  for (const [file, text] of Object.entries({
    ...INPUTS,
    'record.json': `${JSON.stringify(record, null, 2)}\n`,
  })) {
    writeFileSync(join(folder, file), text);
  }
}

Given('the committed folder steps\\/ of the repository', function () {
  this.state['stepsFolder'] = { steps: join(ROOT, 'steps') } satisfies Steps;
});

const copy = (world: ArchitectWorld): string => {
  const root = mkdtempSync(join(tmpdir(), 'aos-steps-gate-'));
  world.cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const steps = join(root, 'steps');
  mkdirSync(steps);
  world.state['stepsFolder'] = { steps } satisfies Steps;
  return steps;
};

Given('a copy of steps\\/ holding the valid step folder {string}', function (name: string) {
  writeValid(copy(this), name);
});

Given('a copy of steps\\/ holding no step folder', function () {
  copy(this);
});

Then('every entry of it follows the rule of the folders of steps', function () {
  assert.equal(stepsDefect(own(this).steps), null);
});

const record = (steps: string) => join(steps, 'demo', 'record.json');
const edit = (path: string, change: (text: string) => string) =>
  writeFileSync(path, change(readFileSync(path, 'utf8')));
const withRecord = (steps: string, change: (record: Record<string, any>) => void) =>
  edit(record(steps), (text) => {
    const parsed = JSON.parse(text) as Record<string, any>;
    change(parsed);
    return JSON.stringify(parsed, null, 2);
  });

const BROKEN: Record<string, (steps: string) => void> = {
  'a brief edited after the run': (steps) =>
    edit(join(steps, 'demo', 'brief.md'), (text) => `${text}One more line.\n`),
  'a step file edited after the run': (steps) =>
    edit(join(steps, 'demo', 'step.json'), (text) => text.replace('2400', '2401')),
  'a question edited after the run': (steps) =>
    edit(join(steps, 'demo', 'scout.files.md'), (text) => text.replace('thing', 'other thing')),
  'a file in excess': (steps) => writeFileSync(join(steps, 'demo', 'notes.md'), 'notes\n'),
  'a directory in place of the brief': (steps) => {
    rmSync(join(steps, 'demo', 'brief.md'));
    mkdirSync(join(steps, 'demo', 'brief.md'));
  },
  'a missing scout question': (steps) => rmSync(join(steps, 'demo', 'scout.files.md')),
  'a missing brief': (steps) => rmSync(join(steps, 'demo', 'brief.md')),
  'a missing record': (steps) => rmSync(record(steps)),
  'a missing step file': (steps) => rmSync(join(steps, 'demo', 'step.json')),
  'a step file the schema refuses': (steps) =>
    writeFileSync(join(steps, 'demo', 'step.json'), '{"build":1}\n'),
  'a record whose step is another name': (steps) => withRecord(steps, (parsed) => (parsed['step'] = 'other')),
  'a record with an unknown field': (steps) => withRecord(steps, (parsed) => (parsed['extra'] = 1)),
  'a record that is not JSON': (steps) => writeFileSync(record(steps), '{nope'),
  'a record without the hash of the brief': (steps) =>
    withRecord(steps, (parsed) => delete parsed['inputs']['brief.md']),
  'a record with the hash of another file': (steps) =>
    withRecord(steps, (parsed) => (parsed['inputs']['scout.other.md'] = 'f'.repeat(64))),
  'a steps/x that is a file': (steps) => writeFileSync(join(steps, 'x'), 'not a folder\n'),
  'a folder named with an upper-case letter': (steps) => renameSync(join(steps, 'demo'), join(steps, 'Demo')),
};

When('the copy is broken with {}', function (defect: string) {
  const broken = BROKEN[defect];
  assert.ok(broken, `unknown defect: ${defect}`);
  broken(own(this).steps);
});

Then('that copy of steps\\/ is refused, because {string}', function (reason: string) {
  assert.equal(stepsDefect(own(this).steps), reason);
});
