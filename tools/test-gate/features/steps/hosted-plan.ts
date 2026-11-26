import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lanesWorth, type LanePolicy } from '../../src/domain/hosted-lanes.js';
import { runHostedGate } from '../../src/infrastructure/hosted-gate.js';
import {
  HOSTED_COSTS,
  HOSTED_LANES,
  parseLanePolicy,
  parseMutationCosts,
  planHostedSlices,
  type HostedSlice,
  type MutationCosts,
} from '../../src/infrastructure/hosted-lots.js';
import type { Lot } from '../../src/infrastructure/mutation-lot-proof.js';
import { Workspace } from '../../src/infrastructure/workspace.js';
import {
  Given,
  Then,
  When,
  fixtureGit,
  repository,
  type GateRepository,
  type GateWorld,
} from './repository.js';

type Mutant = Lot['mutants'][number];
/** What a hosted command needs of a checkout: where it is, and its report tree. */
export interface Checkout {
  readonly dir: string;
  workspace(): Workspace;
}

const COMMITTED = (name: string) => fileURLToPath(new URL('../../' + name, import.meta.url));
const ANNOUNCED = 'reports/mutation-lanes.json';
const MANIFEST = 'reports/mutation-inventory.json';
const CANARY = 'zz/canary.mjs';

/** One hosted command in a checkout, as `tools/test-gate/src/hosted.ts` would run it under its lease. */
export async function hosted(checkout: Checkout, ...args: string[]) {
  let output = '';
  const status = await runHostedGate(
    args,
    checkout.dir,
    { write: (text) => (output += text) },
    checkout.workspace(),
  );
  return { status, output };
}

/** A lane policy of a fixture: every plain mutant costs 1 and is worth a lane, up to `maxLanes`. */
export function fixturePolicy(maxLanes: number, laneTargetMs = 1, loadTimeMutantMs = 1) {
  return {
    description: 'fixture',
    unit: 'milliseconds',
    loadTimeMutantMs,
    laneTargetMs,
    maxLanes,
    provenance: {
      runs: ['https://github.com/fixture/repository/actions/runs/1'],
      dryRun: 'fixture',
      loadTime: 'fixture',
      rule: 'fixture',
      bound: 'fixture',
    },
  };
}

export function writeHostedPolicy(repo: GateRepository, maxLanes: number): void {
  repo.write(HOSTED_COSTS, JSON.stringify({ files: {}, fallback: 1 }));
  repo.write(HOSTED_LANES, JSON.stringify(fixturePolicy(maxLanes)));
}

/** The lanes the checkout plans, as its `lanes` command announces them. */
export async function plannedLanes(checkout: Checkout): Promise<number[]> {
  const planned = await hosted(checkout, 'lanes');
  assert.equal(planned.status, 0, planned.output);
  const text = readFileSync(checkout.workspace().path(ANNOUNCED), 'utf8');
  const lanes = JSON.parse(text) as number[];
  assert.equal(text, '[' + lanes.join(',') + ']\n');
  assert.equal(planned.output, `plan hébergé : ${lanes.length} lot(s) -> ${ANNOUNCED}\n`);
  assert.deepEqual(
    lanes,
    lanes.map((_, index) => index + 1),
  );
  return lanes;
}

const point = (line: number, column: number) => ({ line, column });
function mutant(
  mutatorName: string,
  start: Mutant['start'],
  end: Mutant['end'],
  replacement = mutatorName,
): Mutant {
  return { start, end, mutatorName, replacement, ignored: null };
}
function lot(file: string, mutants: Mutant[], whole = true): Lot {
  return { file, mutants, sourceSha256: file, whole, lines: [], nativeMutants: mutants.length };
}
const canaryLot = () => lot(CANARY, [mutant('BlockStatement', point(1, 1), point(3, 2))]);
const identity = (file: string, m: Mutant) =>
  JSON.stringify([file, m.start, m.end, m.mutatorName, m.replacement, m.ignored]);

/**
 * `plain` mutants in functions of four (a body, a span inside it, a span inside that one, a second span inside the
 * body), then `loaded` mutants each on a line of its own, outside every body.
 */
function syntheticFile(file: string, plain: number, loaded: number): Lot {
  const mutants: Mutant[] = [];
  let line = 1;
  for (let index = 0; index < plain; index++) {
    const place = index % 4;
    if (place === 0) mutants.push(mutant('BlockStatement', point(line, 1), point(line + 3, 2)));
    else if (place === 1)
      mutants.push(mutant('ConditionalExpression', point(line + 1, 3), point(line + 2, 9)));
    else if (place === 2) mutants.push(mutant('BooleanLiteral', point(line + 1, 5), point(line + 1, 9)));
    else {
      mutants.push(mutant('StringLiteral', point(line + 2, 10), point(line + 2, 14)));
      line += 4;
    }
  }
  line += 4;
  for (let index = 0; index < loaded; index++, line++)
    mutants.push(mutant('StringLiteral', point(line, 1), point(line, 5)));
  return lot(file, mutants, false);
}

const share = (total: number, parts: number, index: number) =>
  Math.floor(total / parts) + (index < total % parts ? 1 : 0);

interface Planned {
  lots: Lot[];
  costs: MutationCosts;
  policy: LanePolicy;
  slices: HostedSlice[];
}
const planned = (world: GateWorld) => world.state['hosted plan'] as Planned;
const sourceOf = () => '\n'.repeat(2000);
function slice(world: GateWorld, lots: Lot[], costs: MutationCosts, policy: LanePolicy): void {
  world.state['hosted plan'] = {
    lots,
    costs,
    policy,
    slices: planHostedSlices(lots, CANARY, sourceOf, costs, policy),
  };
}

Given(
  'a synthetic hosted inventory of {int} mutants in {int} files, {int} of them outside every function body',
  function (total: number, files: number, loaded: number) {
    const lots = Array.from({ length: files }, (_, index) =>
      syntheticFile(
        `src/file-${String(index).padStart(2, '0')}.mjs`,
        share(total - loaded, files, index),
        share(loaded, files, index),
      ),
    );
    assert.equal(
      lots.reduce((sum, { mutants }) => sum + mutants.length, 0),
      total,
    );
    this.state['synthetic inventory'] = [...lots, canaryLot()];
  },
);

When(
  'the hosted planner slices it for a lane worth {int} plain mutants, at most {int} lanes',
  function (worth: number, maxLanes: number) {
    slice(
      this,
      this.state['synthetic inventory'] as Lot[],
      { fallback: 1, files: {} },
      { loadTimeMutantMs: 2 * worth, laneTargetMs: worth, maxLanes },
    );
  },
);

Then('every mutant of the synthetic inventory is in exactly one hosted slice', function () {
  const { lots, slices } = planned(this);
  const expected = lots
    .filter(({ file }) => file !== CANARY)
    .flatMap(({ file, mutants }) => mutants.map((m) => identity(file, m)));
  const found = slices.flatMap(({ lots: sliced }) =>
    sliced
      .filter(({ file }) => file !== CANARY)
      .flatMap(({ file, mutants }) => mutants.map((m) => identity(file, m))),
  );
  assert.equal(new Set(expected).size, expected.length, 'the synthetic identities are distinct');
  assert.equal(new Set(found).size, found.length, 'a mutant is in two slices');
  assert.deepEqual([...found].sort(), [...expected].sort());
  // A file of the inventory without a mutant still belongs to one slice: its source is part of the proof.
  for (const { file } of lots.filter((entry) => entry.file !== CANARY && entry.mutants.length === 0))
    assert.equal(slices.filter(({ lots: sliced }) => sliced.some((entry) => entry.file === file)).length, 1);
});

Then('every hosted slice mutates the canary, whole', function () {
  const { lots, slices } = planned(this);
  const canary = lots.find(({ file }) => file === CANARY);
  assert.ok(slices.length >= 1);
  for (const { lots: sliced, patterns } of slices) {
    assert.deepEqual(
      sliced.filter(({ file }) => file === CANARY),
      [canary],
    );
    assert.equal(patterns.filter((pattern) => pattern === CANARY).length, 1);
  }
});

Then('no hosted slice is without a production mutant unless it is the only one', function () {
  const { slices } = planned(this);
  if (slices.length === 1) return;
  for (const { lots: sliced } of slices) assert.ok(sliced.some(({ file }) => file !== CANARY));
});

Then('the hosted planner opens {int} lanes', function (lanes: number) {
  assert.equal(planned(this).slices.length, lanes);
});

Then('slicing the same synthetic inventory again gives the same slices, byte for byte', function () {
  const { lots, costs, policy, slices } = planned(this);
  const again = planHostedSlices(structuredClone(lots), CANARY, sourceOf, structuredClone(costs), {
    ...policy,
  });
  assert.equal(JSON.stringify(again), JSON.stringify(slices));
});

Then(
  'an estimated cost of {int} is worth {int} lanes for a lane worth {int}, at most {int} lanes',
  function (cost: number, lanes: number, laneTargetMs: number, maxLanes: number) {
    assert.equal(lanesWorth(cost, { loadTimeMutantMs: 1, laneTargetMs, maxLanes }), lanes);
  },
);

/** `count` files, each with one mutant that is its own body: none is taken to run at module load. */
const separate = (count: number) =>
  Array.from({ length: count }, (_, index) =>
    lot(`src/separate-${String(index).padStart(2, '0')}.mjs`, [
      mutant('ArrowFunction', point(1, 1), point(1, 9)),
    ]),
  );

Then(
  '{int} to {int} separate mutants worth {int} each, for a lane worth {int} and at most {int} lanes, open {string} lanes',
  function (from: number, to: number, cost: number, laneTargetMs: number, maxLanes: number, list: string) {
    const opened: number[] = [];
    for (let count = from; count <= to; count++) {
      const slices = planHostedSlices(
        [...separate(count), canaryLot()],
        CANARY,
        sourceOf,
        { fallback: cost, files: {} },
        { loadTimeMutantMs: 1, laneTargetMs, maxLanes },
      );
      opened.push(slices.length);
      assert.ok(slices.every(({ lots }) => lots.some(({ file }) => file !== CANARY)));
    }
    assert.deepEqual(opened, list.split(', ').map(Number));
  },
);

const SOURCE =
  'const loaded = "text";\nfunction body() {\n  return "inner";\n}\nconst arrow = () => "arrow";\n';
const fingerprint = (fragment: string, { mutatorName, replacement }: Mutant) =>
  createHash('sha256')
    .update(JSON.stringify([fragment, mutatorName, replacement]))
    .digest('hex')
    .slice(0, 16);
const loadedMutant = mutant('StringLiteral', point(1, 16), point(1, 22));
const bodyMutant = mutant('BlockStatement', point(2, 17), point(4, 2));
const innerMutant = mutant('StringLiteral', point(3, 10), point(3, 17));
const arrowMutant = mutant('ArrowFunction', point(5, 15), point(5, 28));
const arrowInner = mutant('StringLiteral', point(5, 21), point(5, 28));

/**
 * The estimated cost of the lots is exactly `expected` (an even number): two lanes open when a lane is worth half of
 * it, and one when a lane is worth one more than that.
 */
function assertEstimate(lots: Lot[], costs: MutationCosts, loadTimeMutantMs: number, expected: number): void {
  const lanes = (laneTargetMs: number) =>
    planHostedSlices([...lots, canaryLot()], CANARY, () => SOURCE, costs, {
      loadTimeMutantMs,
      laneTargetMs,
      maxLanes: 2,
    }).length;
  assert.equal(expected % 2, 0);
  assert.equal(lanes(expected / 2), 2, 'the estimate is below ' + expected);
  assert.equal(lanes(expected / 2 + 1), 1, 'the estimate is above ' + expected);
}

Then(
  'one mutant measured at {int}, for a lane worth {int} and at most {int} lanes, opens a single lane that holds it',
  function (cost: number, laneTargetMs: number, maxLanes: number) {
    const file = 'src/heavy.mjs';
    const costs = {
      fallback: 1,
      files: { [file]: { fallback: 1, samples: { [fingerprint('"text"', loadedMutant)]: cost } } },
    };
    const policy = { loadTimeMutantMs: 1, laneTargetMs, maxLanes };
    assert.equal(lanesWorth(cost, policy), maxLanes);
    const slices = planHostedSlices(
      [lot(file, [loadedMutant]), canaryLot()],
      CANARY,
      () => SOURCE,
      costs,
      policy,
    );
    assert.equal(slices.length, 1);
    assert.deepEqual(slices[0]?.lots.find((entry) => entry.file === file)?.mutants, [loadedMutant]);
  },
);

Then('a mutant no function body encloses is estimated at the cost of a load-time mutant', function () {
  const lots = [lot('src/a.mjs', [loadedMutant]), lot('src/b.mjs', [loadedMutant])];
  assertEstimate(lots, { fallback: 1, files: { 'src/a.mjs': { fallback: 5, samples: {} } } }, 300, 600);
});

Then('a mutant inside a block body or an arrow body keeps the fallback of its file', function () {
  const lots = [lot('src/a.mjs', [bodyMutant, innerMutant]), lot('src/b.mjs', [arrowMutant, arrowInner])];
  // Two mutants at the fallback of their file, 50, and two at the global one, 7.
  assertEstimate(lots, { fallback: 7, files: { 'src/a.mjs': { fallback: 50, samples: {} } } }, 1000, 114);
});

Then('a measured sample is taken before either estimate', function () {
  const file = 'src/a.mjs';
  const samples = {
    [fingerprint('"text"', loadedMutant)]: 40,
    [fingerprint('"inner"', innerMutant)]: 60,
  };
  // The body itself has no sample: the fallback of its file, 10.
  assertEstimate(
    [lot(file, [loadedMutant, bodyMutant, innerMutant])],
    { fallback: 1, files: { [file]: { fallback: 10, samples } } },
    1000,
    110,
  );
});

Then('an ignored mutant costs nothing wherever it is', function () {
  const ignored = (m: Mutant, replacement: string): Mutant => ({
    ...m,
    replacement,
    ignored: 'a native reason',
  });
  const samples = { [fingerprint('"inner"', ignored(innerMutant, 'ignored'))]: 999 };
  assertEstimate(
    [
      lot('src/a.mjs', [loadedMutant, ignored(loadedMutant, 'ignored')]),
      lot('src/b.mjs', [bodyMutant, ignored(innerMutant, 'ignored')]),
    ],
    { fallback: 10, files: { 'src/b.mjs': { fallback: 10, samples } } },
    300,
    310,
  );
});

function setField(target: Record<string, unknown>, path: string, value: unknown): void {
  const names = path.split('.');
  const leaf = names.pop() as string;
  let holder = target;
  for (const name of names) holder = holder[name] as Record<string, unknown>;
  holder[leaf] = value;
}

Given('the committed hosted lane policy', function () {
  this.state['descriptive'] = JSON.parse(readFileSync(COMMITTED('hosted-lanes.json'), 'utf8'));
});

Given('the committed hosted mutation costs', function () {
  this.state['descriptive'] = JSON.parse(readFileSync(COMMITTED('hosted-mutation-cost.json'), 'utf8'));
});

Given('the smallest hosted mutation costs', function () {
  this.state['descriptive'] = { fallback: 1, files: { a: { fallback: 1, samples: { k: 1 } } } };
});

When(/^(?:its|their) field "([^"]+)" is set to '(.*)'$/, function (field: string, value: string) {
  setField(this.state['descriptive'] as Record<string, unknown>, field, JSON.parse(value));
});

Then('the hosted lane policy is accepted', function () {
  const policy = parseLanePolicy(JSON.stringify(this.state['descriptive']));
  assert.ok(!('failure' in policy), JSON.stringify(policy));
  assert.ok(policy.maxLanes >= 1 && policy.laneTargetMs >= 1 && policy.loadTimeMutantMs >= 1);
});

Then('it names the runs its measurements come from', function () {
  const { provenance } = this.state['descriptive'] as { provenance: { runs: string[] } };
  assert.deepEqual(
    provenance.runs.map((run) => run.replace('https://github.com/cdeust/architect-os/actions/runs/', '')),
    ['45739094567', '45744632805', '45743125948', '45767197864', '45770810106', '45771449037'],
  );
});

function refused(result: object, field: string): void {
  assert.ok('failure' in result, 'accepted');
  const reason = (result as { failure: string }).failure;
  assert.match(reason, /hors schéma/);
  for (const name of field.split('.')) assert.ok(reason.includes(name), reason);
}

Then('the hosted lane policy is refused with a reason holding {string}', function (field: string) {
  refused(parseLanePolicy(JSON.stringify(this.state['descriptive'])), field);
});

Then('the hosted mutation costs are accepted', function () {
  const costs = parseMutationCosts(JSON.stringify(this.state['descriptive']));
  assert.ok(!('failure' in costs), JSON.stringify(costs).slice(0, 400));
  assert.ok(Object.keys(costs.files).length > 0);
});

Then('the hosted mutation costs are refused with a reason holding {string}', function (field: string) {
  refused(parseMutationCosts(JSON.stringify(this.state['descriptive'])), field);
});

Given(
  'the hosted lane policy of the gate repository opens a lane per mutant, at most {int}',
  function (maxLanes: number) {
    writeHostedPolicy(repository(this), maxLanes);
  },
);

const second = (world: GateWorld) => world.state['second checkout'] as Checkout;

When(
  'the hosted plan is derived in the gate repository and in a second checkout of the same commit',
  async function () {
    const repo = repository(this);
    const dir = mkdtempSync(join(tmpdir(), 'aos-gate-second-'));
    this.cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    // The object store and the references of the first, then the tree of its head checked out from them.
    cpSync(repo.path('.git'), join(dir, '.git'), { recursive: true });
    fixtureGit(dir, ['checkout', '-q', '-f', 'HEAD']);
    assert.equal(fixtureGit(dir, ['rev-parse', 'HEAD']), fixtureGit(repo.dir, ['rev-parse', 'HEAD']));
    assert.notEqual(dir, repo.dir);
    const other: Checkout = { dir, workspace: () => new Workspace(dir) };
    this.state['second checkout'] = other;
    this.state['lanes'] = [await plannedLanes(repo), await plannedLanes(other)];
  },
);

Then('both checkouts announce the same lanes, more than one', function () {
  const [first, other] = this.state['lanes'] as [number[], number[]];
  assert.deepEqual(first, other);
  assert.ok(first.length > 1, JSON.stringify(first));
  assert.equal(
    readFileSync(second(this).workspace().path(ANNOUNCED), 'utf8'),
    repository(this).read(ANNOUNCED),
  );
});

Then('both checkouts write the same manifest for every lane, byte for byte', async function () {
  const repo = repository(this);
  const [lanes] = this.state['lanes'] as [number[], number[]];
  const seen = new Set<string>();
  for (const lane of lanes) {
    for (const checkout of [repo, second(this)])
      assert.equal((await hosted(checkout, 'inventory', String(lane))).status, 0);
    const manifest = repo.read(MANIFEST);
    assert.equal(readFileSync(join(second(this).dir, MANIFEST), 'utf8'), manifest);
    assert.equal(JSON.parse(manifest).lane, lane);
    assert.equal(JSON.parse(manifest).head, repo.rev('HEAD'));
    seen.add(manifest);
  }
  assert.equal(seen.size, lanes.length);
});

async function refusesLane(checkout: Checkout, lane: number, planned: number): Promise<void> {
  for (const name of ['inventory', 'verify', 'replay']) {
    const outside = await hosted(checkout, name, String(lane));
    assert.equal(outside.status, 1, outside.output);
    assert.equal(
      outside.output,
      `porte de test hébergée : lot ${lane} hors du plan re-dérivé (${planned} lot(s))\n`,
    );
  }
}

Then('a lane outside the plan is refused by name in either checkout', async function () {
  const repo = repository(this);
  const [lanes] = this.state['lanes'] as [number[], number[]];
  for (const checkout of [repo, second(this)]) {
    await refusesLane(checkout, lanes.length + 1, lanes.length);
    assert.equal(checkout.workspace().exists(MANIFEST), false);
  }
});

When('the hosted plan is derived in the gate repository', async function () {
  this.state['lanes'] = [await plannedLanes(repository(this))];
});

Then('the hosted plan announces the lanes {string}', function (text: string) {
  assert.equal(repository(this).read(ANNOUNCED), text + '\n');
});

Then('the manifest of hosted lane {int} mutates the canary alone', async function (lane: number) {
  const repo = repository(this);
  const inventory = await hosted(repo, 'inventory', String(lane));
  assert.equal(inventory.status, 0, inventory.output);
  const manifest = JSON.parse(repo.read(MANIFEST)) as { lots: Lot[]; patterns: string[] };
  assert.deepEqual(manifest.patterns, ['zz/probe.mjs']);
  assert.deepEqual(
    manifest.lots.map(({ file, whole }) => ({ file, whole })),
    [{ file: 'zz/probe.mjs', whole: true }],
  );
  assert.ok((manifest.lots[0]?.mutants.length ?? 0) > 0);
});

Then('hosted lane {int} is refused as outside the plan', async function (lane: number) {
  await refusesLane(repository(this), lane, lane - 1);
});

async function refusesPlan(repo: GateRepository, path: string, text: string | null, reason: RegExp) {
  const original = repo.read(path);
  assert.ok(repo.exists(ANNOUNCED), 'an earlier plan was announced');
  if (text === null) repo.remove(path);
  else repo.write(path, text);
  try {
    const broken = await hosted(repo, 'lanes');
    assert.equal(broken.status, 1, broken.output);
    assert.match(broken.output, reason);
    assert.equal(repo.exists(ANNOUNCED), false);
  } finally {
    repo.write(path, original);
  }
  await plannedLanes(repo);
}

Then(
  'a later plan with a lane policy outside its schema is refused and leaves no announced plan',
  async function () {
    const repo = repository(this);
    const policy = JSON.stringify({ ...fixturePolicy(3), maxLanes: 0 });
    await refusesPlan(repo, HOSTED_LANES, policy, /hosted-lanes\.json : hors schéma.*maxLanes/);
  },
);

Then(
  'a later plan with costs outside their schema is refused and leaves no announced plan',
  async function () {
    const costs = JSON.stringify({ files: {}, fallback: -1 });
    await refusesPlan(
      repository(this),
      HOSTED_COSTS,
      costs,
      /hosted-mutation-cost\.json : hors schéma.*fallback/,
    );
  },
);

Then('a later plan without a lane policy is refused and leaves no announced plan', async function () {
  await refusesPlan(repository(this), HOSTED_LANES, null, /hosted-lanes\.json absent/);
});
