import assert from 'node:assert/strict';
import {
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
  chmodSync,
} from 'node:fs';
import { join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { evidenceDependencies, runEvidence, type EvidenceDependencies } from '../../src/main.js';
import { FIXTURES, Given, Then, When, type EvidenceWorld } from './support.js';
import { throwawayRoot } from './store.js';

const SKILL = fileURLToPath(new URL('../../skill/', import.meta.url));
const ARTICLE = 'https://doi.org/10.1145/3597503.3639187';
const TITLE = 'Using an LLM to Help With Code Understanding';
const PASSAGE = 'participants who used the assistant answered more comprehension questions correctly';
const NOW = '2026-11-14T12:00:00.000Z';
const USAGE =
  'architect-os evidence: usage: evidence ask <ledger> <desk> <id> < question.txt | evidence verify <ledger> <desk>';

interface Scene {
  root: string;
  stdin: string;
  skillFolder: string;
  status: number;
  urls: string[];
  signals: unknown[];
  stdout: string;
  stderr: string;
  code?: number;
}
const scene = (world: EvidenceWorld): Scene => world.state['command'] as Scene;
const here = (current: Scene, text: string): string =>
  text
    .replaceAll('<ledger>', join(current.root, 'ledger'))
    .replaceAll('<desk>', join(current.root, 'desk'))
    .replaceAll('<root>', current.root);

Given('an evidence command over a throwaway root', function () {
  this.state['command'] = {
    root: throwawayRoot(this),
    stdin: '',
    skillFolder: SKILL,
    status: 200,
    urls: [],
    signals: [],
    stdout: '',
    stderr: '',
  } satisfies Scene;
});

Given('the evidence command reads {string} on standard input', function (text: string) {
  scene(this).stdin = text.replaceAll('\\n', '\n');
});

Given(
  'the evidence command root holds a link {string} to a folder {string}',
  function (link, folder: string) {
    const { root } = scene(this);
    mkdirSync(join(root, folder as string), { mode: 0o700 });
    symlinkSync(join(root, folder as string), join(root, link as string));
  },
);

Given('the evidence command root holds a folder {string} of mode 755', function (name: string) {
  const folder = join(scene(this).root, name);
  mkdirSync(folder);
  chmodSync(folder, 0o755);
});

Given('the evidence skill folder holds only {string}', function (name: string) {
  const current = scene(this);
  current.skillFolder = join(current.root, 'skill');
  mkdirSync(current.skillFolder);
  writeFileSync(join(current.skillFolder, name), 'x');
});

Given('the registry answers 503', function () {
  scene(this).status = 503;
});

/** The document of the registry for the recorded article, or the status asked for. */
const fakeFetch =
  (current: Scene): typeof fetch =>
  (input, init) => {
    current.urls.push(String(input));
    current.signals.push(init?.signal);
    return Promise.resolve(
      current.status === 200
        ? new Response(readFileSync(join(FIXTURES, 'doi-org', 'crossref-article.json'), 'utf8'))
        : new Response('Unavailable', { status: current.status }),
    );
  };

When('I run the evidence command with the arguments {string}', async function (args: string) {
  const current = scene(this);
  const deps: EvidenceDependencies = {
    argv: args === '' ? [] : here(current, args).split(' '),
    cwd: current.root,
    readStdin: () => Promise.resolve(current.stdin),
    stdout: { write: (text) => void (current.stdout += text) },
    stderr: { write: (text) => void (current.stderr += text) },
    uid: process.getuid?.() as number,
    fetch: fakeFetch(current),
    clock: () => new Date(NOW),
    constants,
    skillFolder: current.skillFolder,
  };
  current.stdout = '';
  current.stderr = '';
  current.code = await runEvidence(deps);
});

Then('the evidence command exits with {int}', function (code: number) {
  assert.equal(scene(this).code, code);
});

Then('the evidence command stderr is {string}', function (text: string) {
  const current = scene(this);
  assert.equal(current.stderr, `${here(current, text)}\n`);
});

Then('the evidence command stderr is the usage line', function () {
  assert.equal(scene(this).stderr, `${USAGE}\n`);
});

Then('the evidence command stderr is empty', function () {
  assert.equal(scene(this).stderr, '');
});

Then('the evidence command stdout is empty', function () {
  assert.equal(scene(this).stdout, '');
});

Then('the evidence command stdout is the line:', function (text: string) {
  const current = scene(this);
  assert.equal(current.stdout, `${here(current, text)}\n`);
});

Then('the evidence command made no network call', function () {
  assert.deepEqual(scene(this).urls, []);
});

Then('the evidence command asked the registry for {string}', function (url: string) {
  assert.deepEqual(scene(this).urls, [url]);
});

Then('the evidence command root holds no folder {string}', function (name: string) {
  assert.equal(existsSync(join(scene(this).root, name)), false);
});

Then('the evidence command file {string} exists', function (name: string) {
  assert.equal(existsSync(join(scene(this).root, name)), true);
});

Then(
  'the evidence command file {string} is the question {string} as {string} asked at {string}',
  function (name: string, id: string, question: string, at: string) {
    assert.equal(
      readFileSync(join(scene(this).root, name), 'utf8'),
      `${JSON.stringify({ id, question, asked_at: at }, null, 2)}\n`,
    );
  },
);

Then(
  'the evidence command file {string} is the committed skill file {string}',
  function (name, file: string) {
    assert.equal(
      readFileSync(join(scene(this).root, name as string), 'utf8'),
      readFileSync(join(SKILL, file), 'utf8'),
    );
  },
);

Given('Science drops the text {string} holding the title and the passage', function (name: string) {
  const inFolder = join(scene(this).root, 'desk', 'in');
  writeFileSync(join(inFolder, name), `${TITLE}\n\nResults. ${PASSAGE}, in the study.\n`);
});

Given('Science drops the text {string} holding only the title', function (name: string) {
  writeFileSync(join(scene(this).root, 'desk', 'in', name), `${TITLE}\n\nNothing else.\n`);
});

Given(
  'Science drops the answer {string} citing the recorded article in {string}',
  function (id, text: string) {
    const answer = {
      id,
      claims: [
        {
          statement: 'Assistants help with understanding code.',
          sources: [{ doi: '10.1145/3597503.3639187', title: TITLE, quote: PASSAGE, text }],
        },
      ],
      not_found: [],
    };
    writeFileSync(
      join(scene(this).root, 'desk', 'in', `${id as string}.answer.json`),
      JSON.stringify(answer),
    );
  },
);

Then(
  'the evidence command ledger holds the verified record {string} of the recorded article asked as {string}',
  function (id: string, question: string) {
    const record = JSON.parse(
      readFileSync(join(scene(this).root, 'ledger', 'verified', `${id}.json`), 'utf8'),
    );
    assert.deepEqual(record.question, question);
    assert.deepEqual(record.verified_at, NOW);
    assert.deepEqual(
      record.claims[0].sources.map((source: { title: string; year: number }) => [source.title, source.year]),
      [[TITLE, 2024]],
    );
  },
);

When(
  'I build the evidence dependencies of a fake process with the arguments {string}',
  function (args: string) {
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const proc = {
      argv: args.split(' '),
      stdin: Readable.from(['the question']),
      stdout,
      stderr,
      cwd: () => '/work',
      getuid: () => 4242,
    };
    this.state['dependencies'] = { proc, deps: evidenceDependencies(proc), before: Date.now() };
  },
);

interface Built {
  proc: { argv: string[]; stdout: PassThrough; stderr: PassThrough; cwd(): string };
  deps: EvidenceDependencies;
  before: number;
}
const built = (world: EvidenceWorld): Built => world.state['dependencies'] as Built;

Then(
  'the evidence dependencies hold the arguments {string}, the working directory and the user of that process',
  function (args: string) {
    const { deps } = built(this);
    assert.deepEqual(deps.argv, args.split(' '));
    assert.equal(deps.cwd, '/work');
    assert.equal(deps.uid, 4242);
  },
);

Then(
  'the evidence dependencies read standard input, write to the streams of that process and use the clock, fetch and fs constants of node',
  async function () {
    const { deps, proc, before } = built(this);
    assert.equal(await deps.readStdin(), 'the question');
    assert.equal(deps.stdout, proc.stdout);
    assert.equal(deps.stderr, proc.stderr);
    assert.equal(deps.fetch, fetch);
    assert.equal(deps.constants, constants);
    const now = deps.clock().getTime();
    assert.ok(now >= before && now <= Date.now());
  },
);

Then(
  'the evidence dependencies hold the skill folder {string} of this repository',
  function (folder: string) {
    assert.equal(
      built(this).deps.skillFolder,
      join(fileURLToPath(new URL('../../../../', import.meta.url)), folder),
    );
  },
);

Given('the evidence command desk holds a folder {string}', function (name: string) {
  mkdirSync(join(scene(this).root, 'desk', name));
});

Then('the evidence command gave the registry a signal that is not aborted', function () {
  const [signal] = scene(this).signals;
  assert.ok(signal instanceof AbortSignal);
  assert.equal(signal.aborted, false);
});

Then(
  'the evidence command stderr is one line starting with {string} and naming {string}',
  function (start: string, named: string) {
    const current = scene(this);
    const lines = current.stderr.split('\n');
    assert.equal(lines.length, 2);
    assert.equal(lines[1], '');
    assert.ok((lines[0] as string).startsWith(start), current.stderr);
    assert.ok((lines[0] as string).includes(here(current, named)), current.stderr);
  },
);
