import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArguments } from '../../src/domain/arguments.js';
import { changedFiles } from '../../src/infrastructure/gate.js';
import { jobOf, parseGateConfig } from '../../src/infrastructure/config.js';
import { GitRepository } from '../../src/infrastructure/git.js';
import { gateReportPath } from '../../src/infrastructure/report-paths.js';
import { Workspace } from '../../src/infrastructure/workspace.js';
import { FIXTURES, Then, repository } from './repository.js';

const COMMITTED = fileURLToPath(new URL('../../gate.json', import.meta.url));

function committed(): Record<string, unknown> {
  return JSON.parse(readFileSync(COMMITTED, 'utf8')) as Record<string, unknown>;
}

/** Sets (or, for the value `absent`, deletes) the dotted `path` of a JSON object. */
function edit(json: Record<string, unknown>, path: string, value: string): Record<string, unknown> {
  const keys = path.split('.');
  const last = keys.pop() as string;
  let target = json;
  for (const key of keys) target = target[key] as Record<string, unknown>;
  if (value === 'absent') delete target[last];
  else target[last] = JSON.parse(value) as unknown;
  return json;
}

Then('the committed gate configuration loads against its schema', function () {
  const config = parseGateConfig(readFileSync(COMMITTED, 'utf8'));
  assert.ok(!('failure' in config), JSON.stringify(config));
});

Then('the fixture gate configuration loads against its schema', function () {
  const config = parseGateConfig(readFileSync(`${FIXTURES}gate.json`, 'utf8'));
  assert.ok(!('failure' in config), JSON.stringify(config));
});

Then(
  'the committed gate job {string} counts {string} with mutation {string}',
  function (name, globs, mutation) {
    const config = parseGateConfig(readFileSync(COMMITTED, 'utf8'));
    assert.ok(!('failure' in config));
    assert.deepEqual(jobOf(config, name), { name, features: globs.split(', '), mutation: mutation === 'on' });
  },
);

Then(
  'a copy of the committed gate configuration with {string} set to {string} is rejected with:',
  function (path: string, value: string, message: string) {
    assert.deepEqual(parseGateConfig(JSON.stringify(edit(committed(), path, value))), { failure: message });
  },
);

Then(
  'a copy of the committed gate configuration with {string} set to {string} loads',
  function (path: string, value: string) {
    const config = parseGateConfig(JSON.stringify(edit(committed(), path, value)));
    assert.ok(!('failure' in config), JSON.stringify(config));
  },
);

Then('the gate changes against the first parent are:', function (text: string) {
  const repo = repository(this);
  const git = new GitRepository(repo.dir);
  const changes = changedFiles(git, new Workspace(repo.dir), git.commits().firstParent);
  const lines = changes.map((change) =>
    `${change.path}${change.deleted ? ' (supprimé)' : ''}: ${change.lines.join(',')}`.trimEnd(),
  );
  assert.deepEqual(lines, text.split('\n'));
});

Then('the committed gate configuration declares the rule 7 controls:', function (text: string) {
  const config = parseGateConfig(readFileSync(COMMITTED, 'utf8'));
  assert.ok(!('failure' in config));
  assert.deepEqual({ canary: config.canary, replay: config.replay }, JSON.parse(text));
});

Then('the Gate path selector filters tracked, changed and untracked files', function () {
  const repo = repository(this);
  const git = new GitRepository(repo.dir);
  const workspace = new Workspace(repo.dir);
  const selected = (file: string) => file.endsWith('.mjs');
  const paths = (parent: string | null) =>
    changedFiles(git, workspace, parent, selected).map(({ path }) => path);

  repo.write('src/kept.mjs', 'export const kept = 1;\n');
  repo.write('note.txt', 'a tracked file outside the requested scope\n');
  repo.commit('tracked paths');
  const parent = git.commits().head;
  repo.write('src/kept.mjs', 'export const kept = 2;\n');
  repo.write('note.txt', 'a changed file outside the requested scope\n');
  repo.write('src/new.mjs', 'export const fresh = 3;\n');
  repo.write('fresh.txt', 'an untracked file outside the requested scope\n');

  assert.deepEqual(paths(parent), ['src/kept.mjs', 'src/new.mjs']);
  assert.deepEqual(paths(null), ['src/gone.mjs', 'src/kept.mjs', 'src/long.mjs', 'src/new.mjs']);
});

Then('the replay commands keep their explicit argument contracts', function () {
  assert.deepEqual(parseArguments(['replay-collect']), { name: 'replay-collect' });
  assert.ok('failure' in parseArguments(['replay-collect', '--all']));
  assert.ok('failure' in parseArguments(['replay', '--unknown']));
  assert.deepEqual(parseArguments(['replay', '--shard', '1']), { name: 'replay', all: false, shard: 1 });
  assert.deepEqual(parseArguments(['replay', '--all']), { name: 'replay', all: true });
});

Then('Gate file operations preserve the checkout report decoy in an admitted run', function () {
  const repo = repository(this);
  const env = repo.admittedEnvironment();
  const workspace = new Workspace(repo.dir, (path) => gateReportPath(env, path));
  const path = 'reports/nested/file';
  repo.write(path, 'checkout decoy');
  repo.write('source', 'source contents');
  assert.equal(workspace.read('source'), 'source contents');
  assert.equal(workspace.read(path), null);
  assert.equal(workspace.exists(path), false);
  workspace.write(path, 'run');
  workspace.append(path, ' contents');
  assert.equal(workspace.read(path), 'run contents');
  assert.equal(workspace.readBytes(path)?.toString(), 'run contents');
  assert.equal(workspace.exists(path), true);
  workspace.remove(path);
  assert.equal(workspace.readBytes(path), null);
  assert.equal(repo.read(path), 'checkout decoy');
  assert.throws(() => workspace.path('reports/../escape'), /GATE_REPORT_PATH_INVALID/);
});
