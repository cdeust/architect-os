import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { parse } from 'yaml';
import { ROOT, Then } from './helpers.js';

type Step = { name: string; env?: Record<string, string>; run?: string };
type Gate = {
  env?: Record<string, string>;
  jobs: Record<string, { env?: Record<string, string>; steps?: Step[] }>;
};
const base = 'Base of the count (artifact of the last green main run)';
const fetch = 'Fetch reports from the effective producer jobs';
const mutation = 'Fetch the mutation report';
const token = '${{ github.token }}';
function downloads(file: string, doc: Gate) {
  assert.ok(!doc.env?.['GH_TOKEN']);
  const expected: Record<string, string[]> =
    file === 'gate.yml' ? { 'gate-linux': [fetch, base], 'gate-macos': [base] } : { replay: [mutation] };
  for (const [job, { env, steps = [] }] of Object.entries(doc.jobs)) {
    assert.ok(!env?.['GH_TOKEN']);
    const allowed = expected[job] ?? [];
    const authenticated = steps.filter((step) => step.env?.['GH_TOKEN'] !== undefined);
    assert.deepEqual(
      authenticated.map((step) => step.name),
      allowed,
    );
    for (const step of authenticated) {
      assert.equal(step.env?.['GH_TOKEN'], token);
      if (step.name === base) {
        const lines = step.run?.trimEnd().split('\n') ?? [];
        assert.equal(lines[0], "./aos -- sh -e <<'BASE'");
        assert.equal(lines.indexOf('BASE'), lines.length - 1);
      } else {
        const args = step.name === mutation ? ' mutation "$AOS_LANE"' : '';
        assert.equal(step.run, './aos -- sh tools/test-gate/fetch-ci-artifacts.sh' + args);
      }
    }
  }
}
function actual(file: string): Gate {
  return parse(readFileSync(join(ROOT, '.github/workflows', file), 'utf8'));
}
Then('every Gate download keeps its token scoped to an admitted retrieval step', function () {
  for (const file of ['gate.yml', 'gate-lane.yml']) {
    const doc = actual(file);
    downloads(file, doc);
    for (const job of Object.values(doc.jobs))
      for (const step of job.steps ?? []) {
        if (step.env?.['GH_TOKEN'] !== token) continue;
        const command = step.run!;
        step.run = command.replace('./aos -- ', '');
        assert.notEqual(step.run, command);
        assert.throws(() => downloads(file, doc));
        step.run = command;
        job.env = { GH_TOKEN: token };
        assert.throws(() => downloads(file, doc));
        delete job.env;
      }
  }
});

const head = 'a'.repeat(40);
function providerFixture(dir: string) {
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'git'), '#!/bin/sh\nprintf "%s\\n" "$FIXTURE_HEAD"\n', { mode: 0o700 });
  const provider = [
    "import fs from 'node:fs';",
    'const [cmd,...args]=process.argv.slice(2),env=process.env;',
    "if(env.GH_TOKEN!=='fixture-read-token') process.exit(42);",
    "fs.appendFileSync(env.CALLS,JSON.stringify([cmd,...args])+'\\n');",
    "if(cmd==='run'){fs.writeFileSync('reports/base/downloaded',args[args.indexOf('-n')+1]);process.exit(0);}",
    "if(cmd!=='api')process.exit(43);",
    "const endpoint=args.find(value=>value.startsWith('repos/'));",
    'const reply=value=>process.stdout.write(JSON.stringify(value));',
    "if(endpoint.endsWith('/runs/51'))process.stdout.write(env.FIXTURE_HEAD);",
    "else if(endpoint.includes('workflows/gate.yml/runs?')&&endpoint.includes('head_sha='+env.FIXTURE_HEAD))process.stdout.write('33');",
    "else if(endpoint.includes('/runs/51/jobs?'))reply([{jobs:JSON.parse(fs.readFileSync(env.JOBS,'utf8'))}]);",
    "else if(endpoint.includes('/runs/51/artifacts?'))reply([{artifacts:JSON.parse(fs.readFileSync(env.ARTIFACTS,'utf8'))}]);",
    "else if(endpoint.endsWith('/zip'))process.stdout.write(fs.readFileSync(env.ARCHIVE));",
    'else process.exit(44);',
  ].join('\n');
  writeFileSync(join(bin, 'gh'), '#!' + process.execPath + '\n' + provider, { mode: 0o700 });
  const names = [
    ...Array.from({ length: 2 }, (_, i) => [
      'gate-linux-cucumber-' + (i + 1),
      'gate-cucumber-linux-2-' + (i + 1),
    ]),
    ...Array.from({ length: 16 }, (_, i) =>
      ['mutation', 'replay'].map((kind) => [
        'gate-linux-lane-' + (i + 1) + ' / ' + kind,
        'gate-' + kind + '-linux-2-' + (i + 1),
      ]),
    ).flat(),
  ];
  const jobs = names.map(([name], i) => ({
    name,
    id: 100 + i,
    run_id: 51,
    run_attempt: 2,
    head_sha: head,
    status: 'completed',
    conclusion: 'success',
  }));
  const artifacts = names.map(([, name], i) => ({ name, id: 200 + i, expired: false }));
  const jobsFile = join(dir, 'jobs.json'),
    artifactsFile = join(dir, 'artifacts.json'),
    archive = join(dir, 'proof.zip');
  writeFileSync(jobsFile, JSON.stringify(jobs));
  writeFileSync(artifactsFile, JSON.stringify(artifacts));
  mkdirSync(join(dir, 'mutation'));
  for (const path of ['head', 'cucumber-head', 'mutation/head']) writeFileSync(join(dir, path), head + '\n');
  const zip = spawnSync('/usr/bin/zip', ['-q', archive, 'head', 'cucumber-head', 'mutation/head'], {
    cwd: dir,
  });
  assert.equal(zip.status, 0, zip.stderr.toString());
  return {
    PATH: bin + ':' + dirname(process.execPath) + ':/usr/bin:/bin',
    CALLS: join(dir, 'calls'),
    JOBS: jobsFile,
    ARTIFACTS: artifactsFile,
    ARCHIVE: archive,
    FIXTURE_HEAD: head,
    GH_TOKEN: 'fixture-read-token',
    GITHUB_REPOSITORY: 'fixture/repo',
    GITHUB_RUN_ID: '51',
    GITHUB_RUN_ATTEMPT: '2',
    AOS_LANE: '3',
  };
}

Then(
  'the {string} Gate download refuses before touching reports and restores its own evidence when admitted',
  function (kind: string) {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'aos-download-')));
    try {
      const env = providerFixture(dir);
      const job = kind === 'lane' ? 'replay' : kind === 'macos base' ? 'gate-macos' : 'gate-linux';
      const file = kind === 'lane' ? 'gate-lane.yml' : 'gate.yml';
      const name = kind.endsWith(' base') ? base : kind === 'lane' ? mutation : fetch;
      const step = actual(file).jobs[job]?.steps?.find((s) => s.name === name);
      assert.equal(step?.env?.['GH_TOKEN'], token);
      assert.ok(step?.run);
      // Keep the checkout executable and script fixed while reports belong to the disposable cwd.
      const command = step.run
        .replace('./aos', '"$LAUNCHER"')
        .replace('tools/test-gate/fetch-ci-artifacts.sh', '"$FETCH_SCRIPT"');
      const runner = {
        ...env,
        LAUNCHER: join(ROOT, 'aos'),
        FETCH_SCRIPT: join(ROOT, 'tools/test-gate/fetch-ci-artifacts.sh'),
      };
      const shell = (cmd: string, extra: Record<string, string> = {}) =>
        spawnSync('/bin/sh', ['-e', '-c', cmd], { env: { ...runner, ...extra }, cwd: dir, encoding: 'utf8' });
      mkdirSync(join(dir, 'reports'));
      writeFileSync(join(dir, 'reports/existing'), 'kept');
      const denied = shell(command);
      assert.equal(denied.status, 2, denied.stderr);
      if (kind === 'lane') {
        const bare = shell('sh "$FETCH_SCRIPT" mutation "$AOS_LANE"');
        assert.equal(bare.status, 2, bare.stderr);
        assert.match(bare.stderr, /RUNTIME_ENTRY_REQUIRED/);
      }
      assert.deepEqual(readdirSync(join(dir, 'reports')), ['existing']);
      assert.ok(!existsSync(env.CALLS));
      const root = join(dir, 'a');
      mkdirSync(root);
      writeFileSync(
        join(root, '.architect-os-runtime-root'),
        'architect-os-runtime-root/v2\nenvironment=hosted-runner\n',
      );
      const accepted = shell(command, { ARCHITECT_OS_RUNTIME_ROOT: root });
      assert.equal(accepted.status, 0, accepted.stderr);
      if (kind.endsWith(' base')) {
        assert.equal(
          readFileSync(join(dir, 'reports/base/downloaded'), 'utf8'),
          'gate-base-' + kind.split(' ')[0],
        );
      } else {
        const lane = kind === 'lane' ? 3 : 16;
        assert.equal(
          readFileSync(join(dir, 'reports/mutation-shards', String(lane), 'mutation/head'), 'utf8').trim(),
          head,
        );
        assert.match(
          readFileSync(join(dir, 'reports/mutation-shards', String(lane), 'producer'), 'utf8'),
          new RegExp('^51\\t' + head + '\\t2\\t\\d+\\t\\d+\\n$'),
        );
        if (kind === 'aggregate')
          assert.equal(readFileSync(join(dir, 'reports/replay-shards/16/head'), 'utf8').trim(), head);
      }
      const runs = readdirSync(join(root, 'run'));
      assert.equal(runs.length, 1);
      const receipt = readFileSync(join(root, 'run', runs[0]!, 'admission.json'), 'utf8');
      assert.ok(!receipt.includes(env.GH_TOKEN));
      assert.equal(readFileSync(join(dir, 'reports/existing'), 'utf8'), 'kept');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
