import assert from 'node:assert/strict';
import { lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, symlinkSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { CodeProcess } from '../../src/code-tool.js';
import { measureSession } from '../../src/measure.js';
import { FileStepStore } from '../../src/step-store-file.js';
import {
  InMemoryStepStore,
  StepStoreError,
  type StepArtifactKind,
  type StepRecorder,
  type StepStore,
} from '../../src/step-store.js';
import { stepDependencies } from '../../src/step-tool.js';
import { Given, Then, When, stored, type SandboxWorld } from './helpers.js';

interface StoreFixture {
  adapter: 'file' | 'in-memory';
  store: StepStore;
  /** The stream directory of a reserved Step, as the composition of `npm run step` gives it (file adapter only). */
  streams?: (step: string) => string;
  recorder?: StepRecorder;
  root: string;
  run: string;
}

const fixture = (world: SandboxWorld) => stored<StoreFixture>(world, 'step store');
const recorder = (world: SandboxWorld) => {
  const { recorder } = fixture(world);
  assert.ok(recorder, 'a Step must be reserved first');
  return recorder;
};
/** The place of a Step in the runtime fixture: the trees its state may not overlap. */
const place = (root: string) => ({ intake: join(root, 'stat'), worktree: join(root, 'worktree') });
/** The retained directory of a Step of the run, as the file adapter writes it. */
const retained = (f: StoreFixture, step: string) => join(f.root, 'state', 'steps', basename(f.run), step);

Given('the {word} step store', function (adapter: string) {
  const { root, run, env } = stored<{ root: string; run: string; env: NodeJS.ProcessEnv }>(
    this,
    'runtime fixture',
  );
  // The file adapter is the one `npm run step` composes over the admitted run of its process.
  const proc = { env, argv: [], cwd: () => join(root, 'worktree') } as unknown as CodeProcess;
  const deps = adapter === 'file' ? stepDependencies(proc) : undefined;
  const store = deps?.store ?? new InMemoryStepStore();
  if (adapter === 'file') assert.ok(store instanceof FileStepStore);
  this.state['step store'] = {
    adapter: adapter as StoreFixture['adapter'],
    store,
    ...(deps === undefined ? {} : { streams: deps.streams }),
    root,
    run,
  } satisfies StoreFixture;
});

When('the Step {string} is reserved in the step store', function (step: string) {
  const f = fixture(this);
  f.recorder = f.store.reserve(step, place(f.root));
});

/** The refusal of `act`: for the file adapter a refusal of the system keeps its own code (`EEXIST`). */
function refusedWith(act: () => unknown, code: string): void {
  assert.throws(act, (error: unknown) => {
    assert.equal((error as { code?: unknown }).code, code, String(error));
    if (code.startsWith('STEP_')) assert.ok(error instanceof StepStoreError);
    return true;
  });
}

Then('reserving the Step {string} again is refused with {string}', function (step: string, code: string) {
  const f = fixture(this);
  f.recorder!.record('build.report', undefined, 'kept');
  refusedWith(() => f.store.reserve(step, place(f.root)), code);
  assert.equal(f.recorder!.read('build.report', undefined), 'kept');
});

Then('reserving the Step {string} is accepted', function (step: string) {
  const f = fixture(this);
  const other = f.store.reserve(step, place(f.root));
  assert.equal(other.read('build.report', undefined), undefined);
  other.record('build.report', undefined, 'other');
  assert.equal(f.recorder!.read('build.report', undefined), 'kept');
});

Then('reserving the Step {string} is refused with {string}', function (step: string, code: string) {
  const f = fixture(this);
  refusedWith(() => f.store.reserve(step, place(f.root)), code);
  if (f.adapter === 'file') assert.deepEqual(readdirSync(retained(f, '')).sort(), ['other', 'store']);
});

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const measure = (extra: Record<string, unknown> = {}) => {
  const { report: _report, structuredOutput: _output, ...fields } = measureSession('');
  return { ...fields, exitCode: 0, stopped: false, ...extra };
};
const fact = { file: 'src/a.ts', line: 1, quote: 'export', note: 'n' };
const check = (exitCode: unknown, output = 'ok') => ({
  command: ['npm', 'test'],
  exitCode,
  stopped: false,
  durationSeconds: 3,
  cut: false,
  output,
});
const verdict = {
  verdict: 'request_changes',
  findings: [{ level: 'correctness', file: 'a.ts', line: 1, quote: 'q', reason: 'r' }],
  not_checked: ['x'],
  criteria: [{ id: 'AC-1', status: 'met', evidence: [{ file: 'a.ts', line: 1, quote: 'q' }], reason: 'r' }],
  claims: [],
};
/** Credential shapes, made at run time: the source of the suite holds none. */
const anthropicKey = () => `${['sk', 'ant', 'api03'].join('-')}-${'K'.repeat(24)}`;
const oauthToken = () => `${['sk', 'ant', 'oat01'].join('-')}-${'T'.repeat(24)}`;
const githubToken = () => `${['gh', 'p'].join('')}_${'g'.repeat(36)}`;
const fineGrained = () => `${['github', 'pat'].join('_')}_${'f'.repeat(22)}`;

/** The text of an artifact described in a scenario. */
function content(description: string): string {
  const named: Record<string, () => string> = {
    'a measure without "completed"': () => {
      const { completed: _completed, ...rest } = measure();
      return json(rest);
    },
    'facts rejected for "autre"': () =>
      json({ verified: [], rejected: [{ fact, reason: 'autre' }], open: [] }),
    'a check exiting with "x"': () => json(check('x')),
    'a check that passes': () => json(check(0)),
    'an Anthropic API key': () => `The report quotes ${anthropicKey()} by mistake.\n`,
    'an Anthropic OAuth token': () => `token: ${oauthToken()}\n`,
    'a GitHub token': () => `push with ${githubToken()}\n`,
    'a fine-grained GitHub token': () => `push with ${fineGrained()}\n`,
    // The key is escaped in the JSON text: the raw text holds no `sk-ant-`, the value it reads as does.
    'a check whose output escapes a key': () =>
      json(check(1, anthropicKey())).replace(anthropicKey(), `\\u0073${anthropicKey().slice(1)}`),
  };
  if (named[description]) return named[description]();
  const text = /^the text "(.*)"$/.exec(description);
  if (text) return text[1] as string;
  const raw = /^the JSON (.*)$/.exec(description);
  if (raw) return raw[1] as string;
  const bytes = /^(\d+) bytes of "(.)"$/.exec(description);
  if (bytes) return (bytes[2] as string).repeat(Number(bytes[1]));
  const characters = /^(\d+) characters "(.)"$/.exec(description);
  if (characters) return (characters[2] as string).repeat(Number(characters[1]));
  return assert.fail(`unknown content: ${description}`);
}

/** Every kind, with a text that holds to its schema, and, for the second Step, the other form each JSON kind accepts. */
const artifacts = (): [StepArtifactKind, string | undefined, string, string][] => [
  ['scout.measure', 'files', json(measure()), json(measure({ completed: true, costByModel: { m: 0.5 } }))],
  [
    'scout.facts',
    'files',
    json({
      verified: [fact],
      rejected: [
        { fact, reason: 'chemin refusé' },
        { fact, reason: 'fichier absent' },
        { fact, reason: 'ligne absente' },
        { fact, reason: 'citation absente de la ligne' },
      ],
      open: ['what'],
    }),
    json({ invalid: 'la session n’a pas abouti' }),
  ],
  ['build.brief', undefined, 'Build the thing.\n', ''],
  ['build.measure', undefined, json(measure()), json(measure({ costUsd: null, exitCode: null }))],
  ['build.report', undefined, '# Report\n\nDone.\n', 'other report'],
  [
    'build.claims',
    undefined,
    json({
      claims: [
        {
          id: 'CL-1',
          brief_item: 'the brief',
          instead: 'what was done',
          evidence: [{ file: 'src/a.ts', line: 1 }, { command: 'npm test' }],
        },
      ],
    }),
    json({ invalid: 'bloc de revendications non fermé' }),
  ],
  ['check', 'types', json(check(0)), json(check(null))],
  ['review.brief', undefined, 'Review it.\n', 'again'],
  ['review.measure', 'general', json(measure()), json(measure({ stopped: true }))],
  ['review.verdict', 'general', json(verdict), json({ invalid: 'la session n’a pas abouti' })],
];

Then('every kind of artifact is recorded and read back byte for byte', function () {
  const f = fixture(this);
  const second = f.store.reserve('second', place(f.root));
  for (const [kind, name, first, other] of artifacts()) {
    f.recorder!.record(kind, name, first);
    second.record(kind, name, other);
  }
  for (const [kind, name, first, other] of artifacts()) {
    assert.equal(f.recorder!.read(kind, name), first, kind);
    assert.equal(second.read(kind, name), other, kind);
  }
});

Then('an artifact not recorded reads back as nothing', function () {
  const r = recorder(this);
  assert.equal(r.read('check', 'other'), undefined);
  assert.equal(r.read('scout.facts', 'types'), undefined);
  assert.equal(r.read('review.verdict', 'files'), undefined);
});

Then(
  'recording the artifact {string} named {string} with {} is refused with {string}',
  function (kind: string, name: string, description: string, code: string) {
    const f = fixture(this);
    const r = recorder(this);
    const named = name === '' ? undefined : name;
    refusedWith(() => r.record(kind as StepArtifactKind, named, content(description)), code);
    if (f.adapter === 'file') assert.deepEqual(readdirSync(retained(f, 'store')), []);
    // Nothing is written: no kind of the port, under either form of the name, reads back.
    for (const [known] of artifacts()) {
      assert.equal(r.read(known, named), undefined);
      assert.equal(r.read(known, undefined), undefined);
    }
  },
);

Then(
  'recording {} names the shape {string} without quoting it',
  function (description: string, shape: string) {
    const r = recorder(this);
    const text = content(description);
    assert.throws(
      () => r.record('build.report', undefined, text),
      (error: unknown) => {
        assert.ok(error instanceof StepStoreError);
        assert.equal(error.message, `STEP_ARTIFACT_CREDENTIAL: build.report.md contient la forme ${shape}`);
        return true;
      },
    );
  },
);

Then('the artifacts at the bounds of the port are recorded and read back', function () {
  const f = fixture(this);
  const r = recorder(this);
  const accepted: [StepArtifactKind, string | undefined, string][] = [
    ['build.report', undefined, 'a'.repeat(1_048_576)],
    ['build.brief', undefined, 'é'.repeat(524_288)],
    // Below each shape: a prefix without enough characters after it, or a letter GitHub does not use.
    [
      'review.brief',
      undefined,
      `sk-ant-oat1 sk-ant-${'x'.repeat(7)} ghp_${'a'.repeat(19)} github_pat_${'b'.repeat(19)} ghx_${'c'.repeat(30)}`,
    ],
    ['check', 'types', json(check(0, `sk-ant-${'y'.repeat(7)}`))],
  ];
  for (const [kind, name, text] of accepted) r.record(kind, name, text);
  for (const [kind, name, text] of accepted) assert.equal(r.read(kind, name), text, kind);
  // Each shape alone, at its least length, is refused, in a Step of its own so that nothing else is written there.
  for (const [step, text] of [
    ['key', `sk-ant-${'x'.repeat(8)}`],
    ['github', `gho_${'a'.repeat(20)}`],
    ['github-s', `ghs_${'a'.repeat(20)}`],
    ['github-u', `ghu_${'a'.repeat(20)}`],
    ['github-r', `ghr_${'a'.repeat(20)}`],
    ['pat', `github_pat_${'b'.repeat(20)}`],
    ['dash', `sk-ant-${'-_'.repeat(4)}`],
  ] as const) {
    const own = f.store.reserve(step, place(f.root));
    refusedWith(() => own.record('build.report', undefined, text), 'STEP_ARTIFACT_CREDENTIAL');
    assert.equal(own.read('build.report', undefined), undefined, step);
  }
});

Then('an OAuth token at its least length is named as one', function () {
  assert.throws(() => recorder(this).record('build.report', undefined, `sk-ant-oat${'o'.repeat(8)}`), {
    message: 'STEP_ARTIFACT_CREDENTIAL: build.report.md contient la forme anthropic-oauth-token',
  });
});

Then(
  'recording the build report twice is refused with {string} and the first report is kept',
  function (code: string) {
    const r = recorder(this);
    r.record('build.report', undefined, 'first');
    refusedWith(() => r.record('build.report', undefined, 'second'), code);
    assert.equal(r.read('build.report', undefined), 'first');
    r.record('check', 'a', json(check(0)));
    refusedWith(() => r.record('check', 'a', json(check(1))), code);
    assert.equal(r.read('check', 'a'), json(check(0)));
  },
);

Then('a Step without events reads back none', function () {
  assert.deepEqual(recorder(this).events(), []);
});

Then('the events appended read back in their order, numbered from 0', function () {
  const r = recorder(this);
  r.appendEvent({ type: 'phase.started', phase: 'scouts' });
  r.appendEvent({ type: 'phase.ended', phase: 'scouts' });
  r.appendEvent({ type: 'phase.started', phase: 'build' });
  const expected = [
    { seq: 0, type: 'phase.started', phase: 'scouts' },
    { seq: 1, type: 'phase.ended', phase: 'scouts' },
    { seq: 2, type: 'phase.started', phase: 'build' },
  ];
  assert.deepEqual(r.events(), expected);
  // What is read back is a copy: changing it changes nothing of the Step.
  r.events()[0]!.phase = 'reviews';
  assert.deepEqual(r.events(), expected);
});

Then(
  'an event of an unknown phase is refused with {string} and the events are unchanged',
  function (code: string) {
    const r = recorder(this);
    const before = r.events();
    refusedWith(() => r.appendEvent({ type: 'phase.started', phase: 'commit' } as never), code);
    refusedWith(() => r.appendEvent({ type: 'phase.started', phase: 'build', text: 'x' } as never), code);
    assert.deepEqual(r.events(), before);
    r.appendEvent({ type: 'phase.ended', phase: 'build' });
    assert.deepEqual(r.events().at(-1), { seq: before.length, type: 'phase.ended', phase: 'build' });
  },
);

Then('every artifact of the Step is a file of mode 0600 named as npm run step names it', function () {
  const f = fixture(this);
  const r = recorder(this);
  for (const [kind, name, text] of artifacts()) r.record(kind, name, text);
  const directory = retained(f, 'store');
  assert.equal(lstatSync(directory).mode & 0o777, 0o700);
  assert.deepEqual(readdirSync(directory).sort(), [
    'build.brief.md',
    'build.claims.json',
    'build.measure.json',
    'build.report.md',
    'check.types.json',
    'review.brief.md',
    'review.general.measure.json',
    'review.general.verdict.json',
    'scout.files.facts.json',
    'scout.files.measure.json',
  ]);
  for (const [kind, name, text] of artifacts()) {
    const file = readdirSync(directory).find(
      (entry) => readFileSync(join(directory, entry), 'utf8') === text,
    );
    assert.ok(file, `${kind} ${name}`);
    assert.equal(lstatSync(join(directory, file)).mode & 0o777, 0o600, file);
  }
});

Then('the events are lines appended to a private file that a link cannot redirect', function () {
  const f = fixture(this);
  const r = recorder(this);
  const file = join(retained(f, 'store'), 'events.jsonl');
  const descriptors = readdirSync('/dev/fd');
  r.appendEvent({ type: 'phase.started', phase: 'checks' });
  r.appendEvent({ type: 'phase.ended', phase: 'checks' });
  assert.deepEqual(readdirSync('/dev/fd'), descriptors);
  assert.equal(
    readFileSync(file, 'utf8'),
    '{"seq":0,"type":"phase.started","phase":"checks"}\n{"seq":1,"type":"phase.ended","phase":"checks"}\n',
  );
  assert.equal(lstatSync(file).mode & 0o777, 0o600);
  const target = join(f.root, 'stat', 'target');
  renameSync(file, `${file}.kept`);
  symlinkSync(target, file);
  assert.throws(() => r.appendEvent({ type: 'phase.started', phase: 'reviews' }), { code: 'ELOOP' });
  assert.deepEqual(readdirSync(join(f.root, 'stat')), []);
});

Then('the stream directory of the Step {string} is the one of the run', function (step: string) {
  const f = fixture(this);
  const expected = join(f.run, 'tmp', 'steps', step);
  assert.equal((f.store as FileStepStore).streams(step), expected);
  assert.equal(f.streams!(step), expected);
  assert.equal(lstatSync(expected).isDirectory(), true);
});

Then(
  'the stream directory of the Step {string} is refused with {string}',
  function (step: string, code: string) {
    refusedWith(() => (fixture(this).store as FileStepStore).streams(step), code);
  },
);

Then('a read that is not of a missing file is refused as the system refuses it', function () {
  const f = fixture(this);
  const r = recorder(this);
  mkdirSync(join(retained(f, 'store'), 'check.folder.json'));
  assert.throws(() => r.read('check', 'folder'), { code: 'EISDIR' });
  mkdirSync(join(retained(f, 'store'), 'events.jsonl'));
  assert.throws(() => r.events(), { code: 'EISDIR' });
});

/** What each refusal of the port says: the code, then what is refused, never the content. */
Then('each refusal of the port names what it refuses', function () {
  const f = fixture(this);
  const r = recorder(this);
  const says = (act: () => unknown, message: string) =>
    assert.throws(act, (error: unknown) => {
      assert.ok(error instanceof StepStoreError);
      assert.equal(error.name, 'StepStoreError');
      assert.equal(error.message, message);
      return true;
    });
  says(() => f.store.reserve('Bad', place(f.root)), 'STEP_NAME_INVALID: nom d’étape');
  says(() => r.record('check', undefined, '{}'), 'STEP_ARTIFACT_INVALID: genre ou nom refusé : check');
  says(
    () => r.record('build.report', undefined, 'a'.repeat(1_048_577)),
    'STEP_ARTIFACT_TOO_LARGE: build.report.md : 1048577 octets, au plus 1048576',
  );
  says(
    () => r.record('build.measure', undefined, '{'),
    "STEP_ARTIFACT_INVALID: build.measure.json n'est pas du JSON",
  );
  says(
    () => r.record('check', 'types', '{}'),
    'STEP_ARTIFACT_INVALID: check.types.json ne suit pas le schéma de check',
  );
  says(() => r.appendEvent({ type: 'phase.started' } as never), 'STEP_EVENT_INVALID: événement refusé');
  if (f.adapter === 'in-memory') {
    says(() => f.store.reserve('store', place(f.root)), 'EEXIST: étape déjà réservée : store');
    r.record('build.report', undefined, 'once');
    says(() => r.record('build.report', undefined, 'twice'), 'EEXIST: artefact déjà écrit : build.report.md');
  } else {
    says(() => (f.store as FileStepStore).streams('other'), 'STEP_NOT_RESERVED: étape non réservée : other');
  }
});
