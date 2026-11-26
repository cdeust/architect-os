// The two entries of the CI gate and their concurrency groups (features/descriptive/gate-concurrency.feature).
//
// GitHub keeps at most one running and one pending run per concurrency group, and group names are shared by every
// workflow of a repository (docs.github.com, "Control the concurrency of workflows and jobs"). `cancel-in-progress:
// false` says what the run that declares it does to the others; it does not protect that run from a later one that
// names its group. A run that must never be cancelled through a group is therefore a run in no group: `concurrency`
// has no conditional form and its `group` cannot be empty, so the pull-request runs and the push runs of the gate are
// two workflow files, and only the first declares a group.
//
// Nothing here evaluates a GitHub expression. The steps compare the parsed YAML with literal values and check that
// keys are absent. What that cannot see: a group that another workflow computes at run time (`group: ${{ ... }}`,
// whose text does not begin with `gate-` but whose value does). Such a group could only cancel a pull-request run,
// since the push entry is in no group; a cancelled pull-request run gives no green check, which fails closed.
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { parse } from 'yaml';
import { pushEntry, writePushEntry } from '../support/gate-push-entry.js';
import { Given, ROOT, Then, stored } from './helpers.js';
import { GATE_ENTRIES } from './workflows.js';

const WORKFLOWS = '.github/workflows';
const DELIVER = 'tools/deliver/deliver.json';
const PULL_REQUEST_ENTRY = 'gate.yml';
const PUSH_ENTRY = 'gate-push.yml';
const LANE = 'gate-lane.yml';
const RESOLVER = 'pipeline-after-merge.yml';

/** The one group of the gate: the runs of one pull request, the newest cancelling the one in progress. */
const GROUP = 'gate-pr-${{ github.event.pull_request.number }}';
const PULL_REQUEST_GROUP = { group: GROUP, 'cancel-in-progress': true };

/** Where both verdict jobs ask for the base of the count: the green run of the push entry on main for one commit. */
const BASE_STEP = 'Base of the count (artifact of the last green main run)';
const baseCommand = (job: string) =>
  'sh tools/runtime/gate-job.sh -- sh tools/test-gate/fetch-gate-base.sh ' + job.slice('gate-'.length);

type Mapping = Record<string, unknown>;

const isMapping = (value: unknown): value is Mapping =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** What a tree gives the rule: every workflow file GitHub would read, and the workflow the delivery waits for. */
interface Gate {
  /** The text of each file of `.github/workflows` that ends in `.yml` or `.yaml`, by file name. */
  workflows: Record<string, string>;
  /** The key `workflow` of `tools/deliver/deliver.json`. */
  delivered: unknown;
}

function load(root: string): Gate {
  const dir = join(root, WORKFLOWS);
  const workflows: Record<string, string> = {};
  for (const file of readdirSync(dir).sort()) {
    if (/\.ya?ml$/.test(file)) workflows[file] = readFileSync(join(dir, file), 'utf8');
  }
  const deliver = JSON.parse(readFileSync(join(root, DELIVER), 'utf8')) as { workflow?: unknown };
  return { workflows, delivered: deliver.workflow };
}

function document(gate: Gate, file: string): Mapping {
  const text = gate.workflows[file];
  assert.ok(text !== undefined, `${file} is missing`);
  const doc: unknown = parse(text);
  assert.ok(isMapping(doc), `${file} is not a mapping`);
  return doc;
}

const jobsOf = (doc: Mapping): [string, Mapping][] =>
  Object.entries(isMapping(doc['jobs']) ? doc['jobs'] : {}).map(([id, job]) => [
    id,
    isMapping(job) ? job : {},
  ]);

/** The text of a declared group: `concurrency: name`, or `concurrency: { group: name }`. */
function groupText(concurrency: unknown): string | undefined {
  if (typeof concurrency === 'string') return concurrency;
  if (isMapping(concurrency) && typeof concurrency['group'] === 'string') return concurrency['group'];
  return undefined;
}

function assertNoConcurrencyKey(gate: Gate, file: string): void {
  const doc = document(gate, file);
  assert.ok(!('concurrency' in doc), `${file} declares a concurrency key`);
  for (const [id, job] of jobsOf(doc)) {
    assert.ok(!('concurrency' in job), `the job ${id} of ${file} declares a concurrency key`);
  }
}

/** The rule of the two entries; each refusal has its own words. */
function assertGateEntries(gate: Gate): void {
  // The pull-request entry: one literal group per pull request, the YAML boolean true, at workflow level only.
  const entry = document(gate, PULL_REQUEST_ENTRY);
  assert.ok(
    isDeepStrictEqual(entry['concurrency'], PULL_REQUEST_GROUP),
    `${PULL_REQUEST_ENTRY} does not declare exactly the group of its pull request, cancelling in progress`,
  );
  for (const [id, job] of jobsOf(entry)) {
    assert.ok(!('concurrency' in job), `the job ${id} of ${PULL_REQUEST_ENTRY} declares a concurrency key`);
  }
  // The number the group reads exists for every run only if pull_request is the one trigger: without it the group
  // would be `gate-pr-`, shared by every such run.
  assert.ok(isMapping(entry['on']), `the triggers of ${PULL_REQUEST_ENTRY} are not a mapping`);
  GATE_ENTRIES[PULL_REQUEST_ENTRY]!(entry['on'], PULL_REQUEST_ENTRY);

  // The push entry and the lane workflow: no key at all. GitHub warns that a called workflow whose group has the
  // value of its caller's cancels the caller.
  assertNoConcurrencyKey(gate, PUSH_ENTRY);
  assertNoConcurrencyKey(gate, LANE);

  // The push entry is written from the pull-request entry from its line `jobs:` on; what comes before is written by
  // the generator. A key of the source above its jobs (env, defaults, run-name) would change one entry and not the
  // other: the two hold exactly these keys, and the same permissions.
  const pushDoc = document(gate, PUSH_ENTRY);
  assert.ok(
    isDeepStrictEqual(Object.keys(entry), ['name', 'on', 'concurrency', 'permissions', 'jobs']),
    `${PULL_REQUEST_ENTRY} holds other keys than name, on, concurrency, permissions and jobs`,
  );
  assert.ok(
    isDeepStrictEqual(Object.keys(pushDoc), ['name', 'on', 'permissions', 'jobs']),
    `${PUSH_ENTRY} holds other keys than name, on, permissions and jobs`,
  );
  assert.ok(
    isDeepStrictEqual(pushDoc['permissions'], entry['permissions']),
    `the permissions of ${PUSH_ENTRY} are not those of ${PULL_REQUEST_ENTRY}`,
  );

  // No other workflow file names a group of the gate, at workflow level or on a job. Group names are case insensitive.
  for (const file of Object.keys(gate.workflows)) {
    if (file === PULL_REQUEST_ENTRY) continue;
    const doc = document(gate, file);
    const places: [string, unknown][] = [
      [file, doc['concurrency']],
      ...jobsOf(doc).map(([id, job]): [string, unknown] => [`the job ${id} of ${file}`, job['concurrency']]),
    ];
    for (const [place, concurrency] of places) {
      const group = groupText(concurrency);
      assert.ok(
        group === undefined || !group.trim().toLowerCase().startsWith('gate-'),
        `${place} declares a concurrency group whose name begins with gate-`,
      );
    }
  }

  // The readers that name the gate by file or by display name.
  const push = document(gate, PUSH_ENTRY);
  assert.ok(entry['name'] === 'gate', `${PULL_REQUEST_ENTRY} is not named gate`);
  assert.ok(push['name'] === 'gate-push', `${PUSH_ENTRY} is not named gate-push`);
  for (const [id, job] of jobsOf(push)) {
    if (id !== 'gate-linux' && id !== 'gate-macos') continue;
    const steps = Array.isArray(job['steps']) ? (job['steps'] as Mapping[]) : [];
    const run = steps.find((step) => step['name'] === BASE_STEP)?.['run'];
    assert.ok(
      run === baseCommand(id),
      `the job ${id} does not read the base of the count from the push entry`,
    );
  }
  assert.ok(gate.delivered === push['name'], 'the delivery does not wait for the push entry');
  const resolver = document(gate, RESOLVER);
  const waking = isMapping(resolver['on']) ? resolver['on']['workflow_run'] : undefined;
  const names = isMapping(waking) && Array.isArray(waking['workflows']) ? waking['workflows'] : [];
  assert.ok(
    names.includes(entry['name']) && !names.includes(push['name']),
    `${RESOLVER} is not woken by the pull-request entry alone`,
  );
  assert.ok(
    (gate.workflows[RESOLVER] ?? '').includes(`run.get("path") == "${WORKFLOWS}/${PULL_REQUEST_ENTRY}"`),
    `${RESOLVER} does not read the pull-request entry`,
  );

  // Both entries report gate-linux and gate-macos as jobs of their own run: the push entry is written whole from
  // the pull-request entry (features/support/gate-push-entry.ts), and the committed file is what that writes.
  let produced: string | undefined;
  try {
    produced = pushEntry(gate.workflows[PULL_REQUEST_ENTRY] ?? '');
  } catch {
    // A source with no line `jobs:`, or with two, produces nothing: the committed file equals nothing.
  }
  assert.ok(
    produced !== undefined && gate.workflows[PUSH_ENTRY] === produced,
    `${PUSH_ENTRY} is not what npm run workflow:gate-push writes from ${PULL_REQUEST_ENTRY}`,
  );
}

/** Rewrites one file of a copy; a fault that changes nothing is a fault of the scenario. */
function rewrite(root: string, path: string, edit: (text: string) => string): void {
  const before = readFileSync(join(root, path), 'utf8');
  const after = edit(before);
  assert.notEqual(after, before, `the fault changes nothing in ${path}`);
  writeFileSync(join(root, path), after);
}

const workflowFile = (file: string): string => join(WORKFLOWS, file);

/** Replaces one exact text, once; the replacement is taken as it is (`$` has no meaning in it). */
const swap =
  (from: string, to: string) =>
  (text: string): string => {
    assert.equal(text.split(from).length, 2, `expected one occurrence of ${JSON.stringify(from)}`);
    return text.replace(from, () => to);
  };

const BLOCK = `concurrency:\n  group: ${GROUP}\n  cancel-in-progress: true\n`;
const group = (value: string) => swap(`  group: ${GROUP}\n`, `  group: ${value}\n`);
const cancel = (value: string) => swap('  cancel-in-progress: true\n', `  cancel-in-progress: ${value}\n`);
const before = (line: string, added: string) => swap(line, added + line);
const after = (line: string, added: string) => swap(line, line + added);

/** A workflow file of its own, as another author would add one. */
const other = (concurrency: string, job: string): string =>
  [
    'name: fixture',
    'on: pull_request',
    ...(concurrency === '' ? [] : [concurrency]),
    'jobs:',
    '  one:',
    '    runs-on: ubuntu-24.04',
    ...(job === '' ? [] : [job]),
    '    steps:',
    "      - run: 'true'",
    '',
  ].join('\n');

const adds =
  (file: string, text: string) =>
  (root: string): void =>
    writeFileSync(join(root, WORKFLOWS, file), text);

const edits =
  (file: string, edit: (text: string) => string) =>
  (root: string): void =>
    rewrite(root, workflowFile(file), edit);

const trigger = (lines: string) =>
  edits(PULL_REQUEST_ENTRY, swap('on:\n  pull_request:\n', `on:\n  pull_request:\n${lines}`));

/** Each fault, as an edit of a copy of the committed tree on disk. */
const FAULTS: Record<string, (root: string) => void> = {
  // What the generator does not copy: the keys above the jobs.
  'gate.yml gains an environment above its jobs': edits(
    PULL_REQUEST_ENTRY,
    swap('\njobs:\n', '\nenv:\n  X: "1"\n\njobs:\n'),
  ),
  'gate-push.yml gains an environment above its jobs': edits(
    PUSH_ENTRY,
    swap('\njobs:\n', '\nenv:\n  X: "1"\n\njobs:\n'),
  ),
  'gate.yml widens its permissions': edits(
    PULL_REQUEST_ENTRY,
    swap('  actions: read\n', '  actions: write\n'),
  ),
  // The group of the pull-request entry.
  'gate.yml has one group for all pull requests': edits(PULL_REQUEST_ENTRY, group('gate-pr')),
  'gate.yml is grouped by the head branch': edits(
    PULL_REQUEST_ENTRY,
    group('gate-pr-${{ github.head_ref }}'),
  ),
  'gate.yml is grouped by the ref': edits(PULL_REQUEST_ENTRY, group('gate-pr-${{ github.ref }}')),
  'gate.yml is grouped by the run': edits(PULL_REQUEST_ENTRY, group('gate-pr-${{ github.run_id }}')),
  'gate.yml falls back to the run when the number is absent': edits(
    PULL_REQUEST_ENTRY,
    group('gate-pr-${{ github.event.pull_request.number || github.run_id }}'),
  ),
  'gate.yml computes cancel-in-progress by an expression': edits(
    PULL_REQUEST_ENTRY,
    cancel("${{ github.event_name == 'pull_request' }}"),
  ),
  'gate.yml never cancels in progress': edits(PULL_REQUEST_ENTRY, cancel('false')),
  'gate.yml writes cancel-in-progress as a string': edits(PULL_REQUEST_ENTRY, cancel("'true'")),
  'gate.yml has no cancel-in-progress': edits(PULL_REQUEST_ENTRY, swap('  cancel-in-progress: true\n', '')),
  'gate.yml has one more key in its concurrency block': edits(
    PULL_REQUEST_ENTRY,
    after('  cancel-in-progress: true\n', '  extra: true\n'),
  ),
  'gate.yml has no concurrency block': edits(PULL_REQUEST_ENTRY, swap(BLOCK, '')),
  'gate.yml writes its group in the string form': edits(
    PULL_REQUEST_ENTRY,
    swap(BLOCK, `concurrency: ${GROUP}\n`),
  ),
  'gate.yml declares its group on a job instead': edits(PULL_REQUEST_ENTRY, (text) =>
    after(
      '  gate-macos:\n',
      `    concurrency:\n      group: ${GROUP}\n      cancel-in-progress: true\n`,
    )(swap(BLOCK, '')(text)),
  ),
  'a job of gate.yml declares a group too': edits(
    PULL_REQUEST_ENTRY,
    after('  gate-macos:\n', '    concurrency: macos-${{ github.ref }}\n'),
  ),
  // The triggers of the pull-request entry.
  'gate.yml is also triggered by push': trigger('  push:\n    branches: [main]\n'),
  'gate.yml is also triggered by workflow_dispatch': trigger('  workflow_dispatch:\n'),
  'gate.yml is also triggered by pull_request_target': trigger('  pull_request_target:\n'),
  'gate.yml is also triggered by merge_group': trigger('  merge_group:\n'),
  'gate.yml is also triggered by schedule': trigger("  schedule:\n    - cron: '0 3 * * 1'\n"),
  'gate.yml is also triggered by workflow_call': trigger('  workflow_call:\n'),
  'gate.yml filters its pull_request trigger': trigger('    types: [opened]\n'),
  // The push entry and the lane workflow.
  'gate-push.yml declares a group': edits(
    PUSH_ENTRY,
    before(
      'permissions:\n',
      'concurrency:\n  group: push-${{ github.run_id }}\n  cancel-in-progress: false\n\n',
    ),
  ),
  'gate-push.yml declares a group in the string form': edits(
    PUSH_ENTRY,
    before('permissions:\n', 'concurrency: push-${{ github.run_id }}\n\n'),
  ),
  'gate-push.yml declares an empty concurrency key': edits(
    PUSH_ENTRY,
    before('permissions:\n', 'concurrency:\n\n'),
  ),
  'a job of the two entries declares a group': (root) => {
    // In both files, so that the jobs stay the same bytes and the refusal is the one of the key.
    for (const file of [PULL_REQUEST_ENTRY, PUSH_ENTRY]) {
      rewrite(
        root,
        workflowFile(file),
        after('  gate-linux:\n', '    concurrency:\n      group: linux-${{ github.run_id }}\n'),
      );
    }
  },
  'a job of gate-push.yml declares a group': edits(
    PUSH_ENTRY,
    after('  gate-linux:\n', '    concurrency:\n      group: linux-${{ github.run_id }}\n'),
  ),
  'gate-lane.yml declares a group': edits(
    LANE,
    before('permissions:\n', 'concurrency:\n  group: lane-${{ inputs.lane }}\n'),
  ),
  'the replay job of gate-lane.yml declares a group': edits(
    LANE,
    after('  replay:\n', '    concurrency: replay-${{ inputs.lane }}\n'),
  ),
  // The other workflow files.
  'another workflow names a group of the gate': adds(
    'other.yml',
    other('concurrency:\n  group: gate-pr-${{ github.event.pull_request.number }}', ''),
  ),
  'a workflow file ending in .yaml names a group of the gate': adds(
    'other.yaml',
    other('concurrency:\n  group: gate-pr-${{ github.event.pull_request.number }}', ''),
  ),
  'another workflow names a group of the gate in the string form': adds(
    'other.yml',
    other('concurrency: gate-pr-7', ''),
  ),
  'another workflow names a group of the gate in another case': adds(
    'other.yml',
    other('concurrency:\n  group: Gate-PR-7\n  cancel-in-progress: true', ''),
  ),
  'a job of another workflow names a group of the gate': adds(
    'other.yml',
    other('', '    concurrency:\n      group: gate-pr-7\n      cancel-in-progress: true'),
  ),
  'a job of a workflow file ending in .yaml names a group of the gate in the string form': adds(
    'other.yaml',
    other('', '    concurrency: gate-pr-${{ github.event.number }}'),
  ),
  'a committed workflow takes a group of the gate': edits(
    'claude-review.yml',
    swap('  group: claude-review-${{', '  group: gate-pr-${{'),
  ),
  // The jobs of the two entries.
  'one byte of the jobs of gate.yml changes': edits(PULL_REQUEST_ENTRY, (text) =>
    text.replace(/fetch-depth: 2\n(?![^]*fetch-depth: 2\n)/, () => 'fetch-depth: 3\n'),
  ),
  'one byte of the jobs of gate-push.yml changes': edits(PUSH_ENTRY, (text) =>
    text.replace(/fetch-depth: 2\n(?![^]*fetch-depth: 2\n)/, () => 'fetch-depth: 3\n'),
  ),
  'gate-push.yml ends with one more line': edits(PUSH_ENTRY, (text) => text + '\n'),
  'one character of a comment of the head of gate-push.yml changes': edits(
    PUSH_ENTRY,
    swap('# GENERATED', '# Generated'),
  ),
  'gate-push.yml loses the comment that says it is generated': edits(PUSH_ENTRY, (text) =>
    text.slice(text.indexOf('# The CI gate')),
  ),
  'gate.yml has one more job': edits(PULL_REQUEST_ENTRY, (text) =>
    [text, '  extra:', '    runs-on: ubuntu-24.04', '    steps:', "      - run: 'true'", ''].join('\n'),
  ),
  // The readers.
  'both entries fetch the base outside the gate retrieval script': (root) => {
    for (const file of [PULL_REQUEST_ENTRY, PUSH_ENTRY]) {
      rewrite(root, workflowFile(file), (text) => text.replaceAll('fetch-gate-base.sh', 'other.sh'));
    }
  },
  'only gate-macos requests the Linux base': (root) => {
    for (const file of [PULL_REQUEST_ENTRY, PUSH_ENTRY]) {
      rewrite(root, workflowFile(file), swap(baseCommand('gate-macos'), baseCommand('gate-linux')));
    }
  },
  'the delivery waits for the pull-request entry': (root) =>
    rewrite(root, DELIVER, swap('"workflow": "gate-push"', '"workflow": "gate"')),
  'the push entry takes the name of the pull-request entry': edits(
    PUSH_ENTRY,
    swap('name: gate-push\n', 'name: gate\n'),
  ),
  'the pull-request entry takes another name': edits(
    PULL_REQUEST_ENTRY,
    swap('name: gate\n', 'name: gate-pull-request\n'),
  ),
  'the resolver is woken by the push entry too': edits(
    RESOLVER,
    swap('workflows: [gate, PR Review]', 'workflows: [gate, gate-push, PR Review]'),
  ),
  'the resolver reads the runs of the push entry': edits(
    RESOLVER,
    swap(
      'run.get("path") == ".github/workflows/gate.yml"',
      'run.get("path") == ".github/workflows/gate-push.yml"',
    ),
  ),
};

/** What a copy may add without being refused: groups of other names, in both forms, at both levels, in both extensions. */
const ADDITIONS: Record<string, (root: string) => void> = {
  'another workflow declares a group of its own name': adds(
    'other.yml',
    other(
      'concurrency:\n  group: review-${{ github.event.pull_request.number }}\n  cancel-in-progress: true',
      '',
    ),
  ),
  'a workflow file ending in .yaml declares a group of its own name on a job, in the string form': adds(
    'other.yaml',
    other('', '    concurrency: review-${{ github.event.pull_request.number }}'),
  ),
  'another workflow declares a group that holds gate- after its first characters': adds(
    'other.yml',
    other('concurrency: review-gate-${{ github.ref }}', ''),
  ),
  'another workflow declares no group': adds('other.yml', other('', '')),
};

Given('the committed workflows of the gate and the readers of its runs', function () {
  this.state['gateEntries'] = load(ROOT);
});

function copyWith(change: (root: string) => void): Gate {
  const root = mkdtempSync(join(tmpdir(), 'aos-gate-entries-'));
  try {
    cpSync(join(ROOT, WORKFLOWS), join(root, WORKFLOWS), { recursive: true });
    mkdirSync(join(root, 'tools/deliver'), { recursive: true });
    cpSync(join(ROOT, DELIVER), join(root, DELIVER));
    // The copy is the committed tree: the rule accepts it before the change.
    assertGateEntries(load(root));
    change(root);
    return load(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

Given('a copy of the committed workflows of the gate where {}', function (fault: string) {
  const change = FAULTS[fault] ?? ADDITIONS[fault];
  assert.ok(change !== undefined, `no copy of the workflows of the gate named "${fault}"`);
  this.state['gateEntries'] = copyWith(change);
});

Then(
  'the pull-request entry cancels the superseded run of its pull request, and no other run of the gate is in a group',
  function () {
    assertGateEntries(stored<Gate>(this, 'gateEntries'));
  },
);

Then('that copy of the workflows of the gate is refused: {string}', function (refusal: string) {
  const gate = stored<Gate>(this, 'gateEntries');
  assert.throws(
    () => assertGateEntries(gate),
    (error: unknown) => {
      assert.ok(error instanceof assert.AssertionError);
      assert.equal(error.message, refusal);
      return true;
    },
  );
});

Then('that copy of the workflows of the gate is accepted', function () {
  assertGateEntries(stored<Gate>(this, 'gateEntries'));
});

Then(
  'the command that writes the push entry writes it once from the pull-request entry, then changes nothing',
  function () {
    const root = mkdtempSync(join(tmpdir(), 'aos-gate-push-entry-'));
    try {
      const directory = join(root, '.github/workflows');
      mkdirSync(directory, { recursive: true });
      const source = readFileSync(join(ROOT, '.github/workflows', PULL_REQUEST_ENTRY), 'utf8');
      const committed = readFileSync(join(ROOT, '.github/workflows', PUSH_ENTRY), 'utf8');
      writeFileSync(join(directory, PULL_REQUEST_ENTRY), source);
      const produced = () => readFileSync(join(directory, PUSH_ENTRY), 'utf8');
      // No file yet, a stale file, then the file it wrote.
      assert.equal(writePushEntry(root), true);
      assert.equal(produced(), committed);
      writeFileSync(join(directory, PUSH_ENTRY), committed.replace('fetch-depth: 2', 'fetch-depth: 3'));
      assert.equal(writePushEntry(root), true);
      assert.equal(produced(), committed);
      assert.equal(writePushEntry(root), false);
      assert.deepEqual(readdirSync(directory).sort(), [PUSH_ENTRY, PULL_REQUEST_ENTRY].sort());
      assert.equal(readFileSync(join(directory, PULL_REQUEST_ENTRY), 'utf8'), source);
      // What it writes: its own head, no concurrency key, then the jobs of the source, byte for byte.
      const jobs = source.slice(source.search(/^jobs:\n/m));
      assert.ok(committed.endsWith(jobs));
      const head = committed.slice(0, committed.length - jobs.length);
      assert.match(head, /^# GENERATED from \.github\/workflows\/gate\.yml by `npm run workflow:gate-push`/);
      assert.ok(!head.includes('concurrency:'));
      assert.deepEqual(parse(head), {
        name: 'gate-push',
        on: { push: { branches: ['main', 'sentinel/gate-1a-*'] } },
        permissions: { contents: 'read', actions: 'read' },
      });
      for (const text of [source.replace(/^jobs:\n/m, ''), source + 'jobs:\n'])
        assert.throws(() => pushEntry(text), /must hold exactly one line "jobs:"/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
