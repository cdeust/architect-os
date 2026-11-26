import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  linkSync,
  symlinkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  readdirSync,
  renameSync,
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
// The two entries of the gate (pull requests, pushes) carry the same jobs; the lane workflow is called by both.
const ENTRIES = ['gate.yml', 'gate-push.yml'];
function downloads(file: string, doc: Gate) {
  assert.ok(!doc.env?.['GH_TOKEN']);
  const expected: Record<string, string[]> = ENTRIES.includes(file)
    ? { 'gate-linux': [fetch, base], 'gate-macos': [base] }
    : { replay: [mutation] };
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
        assert.equal(
          step.run,
          'sh tools/runtime/gate-job.sh -- sh tools/test-gate/fetch-gate-base.sh ' +
            job.slice('gate-'.length),
        );
      } else {
        const args = step.name === mutation ? ' mutation "$AOS_LANE"' : '';
        assert.equal(
          step.run,
          'sh tools/runtime/gate-job.sh -- sh tools/test-gate/fetch-ci-artifacts.sh' + args,
        );
      }
    }
  }
}
function actual(file: string): Gate {
  return parse(readFileSync(join(ROOT, '.github/workflows', file), 'utf8'));
}
Then('every Gate download keeps its token scoped to an admitted retrieval step', function () {
  for (const file of [...ENTRIES, 'gate-lane.yml']) {
    const doc = actual(file);
    downloads(file, doc);
    for (const job of Object.values(doc.jobs))
      for (const step of job.steps ?? []) {
        if (step.env?.['GH_TOKEN'] !== token) continue;
        const command = step.run!;
        step.run = command.replace('sh tools/runtime/gate-job.sh -- ', '');
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
export function providerFixture(dir: string) {
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  const git = [
    '#!/bin/sh',
    'case "$1" in',
    '  show) if [ "$BASE_CASE" != root ]; then echo "$FIXTURE_HEAD"; fi ;;',
    '  ls-tree) [ "$#" = 5 ] && [ "$2" = --name-only ] && [ "$3" = "$FIXTURE_HEAD" ] &&',
    '    [ "$4" = -- ] && [ "$5" = .github/workflows/gate-push.yml ] || exit 1',
    '    if [ "$BASE_CASE" != legacy ]; then echo ".github/workflows/gate-push.yml"; fi ;;',
    '  *) echo "$FIXTURE_HEAD" ;;',
    'esac',
  ];
  writeFileSync(join(bin, 'git'), git.join('\n') + '\n', { mode: 0o700 });
  const provider = [
    "import fs from 'node:fs';",
    'const [cmd,...args]=process.argv.slice(2),env=process.env;',
    "if(env.GH_TOKEN!=='fixture-read-token') process.exit(42);",
    "fs.appendFileSync(env.CALLS,JSON.stringify([cmd,...args])+'\\n');",
    "if(cmd==='run'){",
    "  if(args[0]!=='download'||args[1]!=='33')process.exit(41);",
    "  fs.writeFileSync(args[args.indexOf('-D')+1]+'/gate-base.json',args[args.indexOf('-n')+1]);",
    "  process.exit(env.BASE_CASE==='download error'?1:0);",
    '}',
    "if(cmd!=='api')process.exit(43);",
    "const endpoint=args.find(value=>value.startsWith('repos/'));",
    'const reply=value=>process.stdout.write(JSON.stringify(value));',
    "if(endpoint.endsWith('/runs/51'))process.stdout.write(env.FIXTURE_HEAD);",
    "else if(endpoint==='repos/fixture/repo/actions/runs?branch=main&event=push&status=success&head_sha='+env.FIXTURE_HEAD+'&per_page=100'){",
    "  if(!args.includes('--paginate')||!args.includes('--slurp'))process.exit(45);",
    "  if(env.BASE_CASE==='API error'){reply({message:'API failed'});process.exit(1);}",
    "  if(env.BASE_CASE==='malformed'){reply([{message:'no collection'}]);process.exit(0);}",
    "  const legacy=env.BASE_CASE==='legacy',row={event:'push',status:'completed',conclusion:'success',head_sha:env.FIXTURE_HEAD,head_branch:'main',head_repository:{full_name:'fixture/repo'}};",
    "  const runs=['gate.yml','gate-push.yml'].map((file,i)=>({...row,path:'.github/workflows/'+file,id:(legacy?i===0:i===1)?33:77}));",
    "  if(env.BASE_CASE==='invalid id')runs[1].id='invalid';",
    "  if(env.BASE_CASE==='unrelated invalid id')runs[0].id=0;",
    "  if(env.BASE_CASE==='missing path')delete runs[1].path;",
    "  if(env.BASE_CASE==='empty path')runs[1].path='';",
    "  if(env.BASE_CASE==='duplicate page')runs[1]=runs[0];",
    "  if(env.BASE_CASE==='wrong event')runs[1].event='pull_request';",
    "  if(env.BASE_CASE==='wrong branch')runs[1].head_branch='trial';",
    "  if(env.BASE_CASE==='wrong sha')runs[1].head_sha='b'.repeat(40);",
    "  if(env.BASE_CASE==='no run')runs.pop();",
    "  reply([{total_count:runs.length,workflow_runs:[runs[0]]},{total_count:env.BASE_CASE==='inconsistent total'?runs.length+1:runs.length,workflow_runs:env.BASE_CASE==='truncated'?[]:runs.slice(1)}]);",
    '}',
    "else if(endpoint.startsWith('repos/fixture/repo/actions/runs/33/artifacts?name=gate-base-')){",
    "  if(env.BASE_CASE==='artifact API error')process.exit(1);",
    "  const name=new URLSearchParams(endpoint.split('?')[1]).get('name');",
    "  const artifacts=env.BASE_CASE==='missing'?[]:[{name,expired:env.BASE_CASE==='expired'}];",
    '  reply({total_count:artifacts.length,artifacts});',
    '}',
    "else if(endpoint.includes('/runs/51/attempts/')){",
    "  const n=Number(endpoint.split('/attempts/')[1].split('/')[0]);",
    "  if(endpoint.includes('/jobs?')){",
    "    const jobs=JSON.parse(fs.readFileSync(env.JOBS,'utf8')).filter(j=>j.run_attempt===n);",
    "    if(env.OMIT_ATTEMPT==='yes')for(const job of jobs)delete job.run_attempt;",
    '    reply([{jobs}]);',
    "  }else reply({id:51,run_attempt:n,head_sha:env.FIXTURE_HEAD,run_started_at:new Date(Date.UTC(2026,10,22,n)).toISOString().replace('.000','')});",
    '}',
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
  // A failed-jobs rerun retains the successful third mutation producer from attempt one.
  const prior = 'gate-linux-lane-3 / mutation';
  const jobs = names.map(([name], i) => ({
    name,
    id: 100 + i,
    run_id: 51,
    run_attempt: name === prior ? 1 : 2,
    head_sha: head,
    status: 'completed',
    conclusion: 'success',
    runner_id: i + 1,
    started_at: name === prior ? '2026-11-22T01:01:00Z' : '2026-11-22T02:01:00Z',
    completed_at: name === prior ? '2026-11-22T01:02:00Z' : '2026-11-22T02:02:00Z',
    steps: [{ number: 1, name: 'Upload report', status: 'completed', conclusion: 'success' }],
  }));
  const original = jobs.find((row) => row.name === prior)!;
  jobs.push({ ...original, id: 9001, run_attempt: 2 });
  const artifacts = names.map(([job, name], i) => ({
    name: job === prior ? name!.replace('linux-2', 'linux-1') : name,
    id: 200 + i,
    expired: false,
  }));
  const jobsFile = join(dir, 'jobs.json'),
    artifactsFile = join(dir, 'artifacts.json'),
    archive = join(dir, 'proof.zip');
  writeFileSync(jobsFile, JSON.stringify(jobs));
  writeFileSync(artifactsFile, JSON.stringify(artifacts));
  mkdirSync(join(dir, 'mutation'));
  for (const path of ['head', 'cucumber-head', 'mutation/head']) writeFileSync(join(dir, path), head + '\n');
  const members = [
    'head',
    'cucumber-head',
    'mutation/head',
    'cucumber.ndjson',
    'mutation/native.json',
    'mutation-inventory.json',
    'replay.json',
    'timings.json',
  ];
  for (const member of members.slice(3)) writeFileSync(join(dir, member), 'fixture evidence');
  const zip = spawnSync('/usr/bin/zip', ['-q', archive, ...members], {
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
        .replace('tools/runtime/gate-job.sh', '"$JOB_WRAPPER"')
        .replace('tools/test-gate/fetch-ci-artifacts.sh', '"$FETCH_SCRIPT"')
        .replace(
          'tools/test-gate/fetch-gate-base.sh',
          '"$GITHUB_WORKSPACE/tools/test-gate/fetch-gate-base.sh"',
        );
      const runner = {
        ...env,
        LAUNCHER: join(ROOT, 'aos'),
        GATE_JOB: join(ROOT, 'tools/runtime/gate-job.mjs'),
        JOB_WRAPPER: join(ROOT, 'tools/runtime/gate-job.sh'),
        RUNNER_TEMP: dir,
        GITHUB_WORKSPACE: ROOT,
        GITHUB_JOB: job,
        GITHUB_SHA: head,
        AOS_GATE_JOB: job,
        GITHUB_OUTPUT: join(dir, 'outputs'),
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
      const allocation = { ARCHITECT_OS_RUNTIME_ROOT: root };
      const captured = shell('"$LAUNCHER" -- node "$GATE_JOB" capture', allocation);
      assert.equal(captured.status, 0, captured.stderr);
      const output = readFileSync(runner.GITHUB_OUTPUT, 'utf8');
      assert.match(output, /^context_sha=[a-f0-9]{64}\n$/);
      const scoped = { ...allocation, AOS_GATE_CONTEXT_SHA: output.trim().slice('context_sha='.length) };
      const reports = join(root, 'run', readdirSync(join(root, 'run'))[0]!, 'reports');
      assert.equal(shell(command, { ...scoped, AOS_GATE_CONTEXT_SHA: '0'.repeat(64) }).status, 2);
      if (kind === 'lane') {
        const certificate = join(root, 'state/gate-job.json');
        const original = join(dir, 'first-job-certificate');
        const otherOutput = join(dir, 'second-job-output');
        renameSync(certificate, original);
        try {
          const second = shell('"$LAUNCHER" -- node "$GATE_JOB" capture', {
            ...allocation,
            GITHUB_OUTPUT: otherOutput,
          });
          assert.equal(second.status, 0, second.stderr);
          const replacement = readFileSync(otherOutput, 'utf8').trim().slice('context_sha='.length);
          assert.notEqual(replacement, scoped.AOS_GATE_CONTEXT_SHA);
          const ping = 'sh "$JOB_WRAPPER" -- node -p "process.env.ARCHITECT_OS_RUN_DIR"';
          const secondRun = shell(ping, { ...scoped, AOS_GATE_CONTEXT_SHA: replacement });
          assert.equal(secondRun.status, 0, secondRun.stderr);
          assert.notEqual(secondRun.stdout.trim(), dirname(reports));
          assert.equal(shell(ping, scoped).status, 2);
        } finally {
          renameSync(original, certificate);
        }
      }
      if (kind === 'lane') {
        const npmConfig = join(dirname(reports), 'config/npm/user.npmrc');
        writeFileSync(npmConfig, 'unexpected contents');
        try {
          assert.equal(shell('sh "$JOB_WRAPPER" -- /usr/bin/true', scoped).status, 2);
        } finally {
          writeFileSync(npmConfig, '');
        }
      }
      const duplicate = shell('sh "$JOB_WRAPPER" -- node "$GATE_JOB" capture', scoped);
      assert.equal(duplicate.status, 2, duplicate.stderr);
      for (const key of [
        'GITHUB_RUN_ID',
        'GITHUB_RUN_ATTEMPT',
        'AOS_GATE_JOB',
        'GITHUB_JOB',
        'GITHUB_SHA',
        'GITHUB_REPOSITORY',
      ]) {
        const other = shell(command, { ...scoped, [key]: 'different' });
        assert.equal(other.status, 2, other.stderr);
      }
      if (kind === 'lane') {
        const executable =
          'sh "$JOB_WRAPPER" -- node -p \'JSON.stringify([process.env.npm_config_cache,process.env.NODE_OPTIONS,process.env.NODE_V8_COVERAGE,process.env.NODE_REDIRECT_WARNINGS,process.env.NPM_CONFIG_NODE_OPTIONS,process.env.AOS_GATE_CONTEXT_SHA,process.env.GH_TOKEN])\'';
        const closed = shell(executable, {
          ...scoped,
          GH_TOKEN: 'current-step-only',
          NODE_OPTIONS: '--require does-not-exist',
          NODE_V8_COVERAGE: join(dir, 'unwanted-coverage'),
          NODE_REDIRECT_WARNINGS: join(dir, 'unwanted-warnings'),
          NPM_CONFIG_NODE_OPTIONS: '--require does-not-exist',
          npm_config_cache: join(dir, 'wrong-cache'),
        });
        assert.equal(closed.status, 0, closed.stderr);
        assert.deepEqual(JSON.parse(closed.stdout), [
          join(root, 'cache/npm'),
          null,
          null,
          null,
          null,
          null,
          'current-step-only',
        ]);
        assert.ok(!existsSync(join(dir, 'unwanted-coverage')));
        assert.ok(!existsSync(join(dir, 'unwanted-warnings')));
      }
      assert.ok(!existsSync(env.CALLS));
      assert.ok(!readFileSync(join(root, 'state/gate-job.json'), 'utf8').includes(env.GH_TOKEN));
      if (kind === 'lane') {
        const incomplete = join(dir, 'incomplete.zip');
        const archive = spawnSync('/usr/bin/zip', ['-q', incomplete, 'mutation/head'], { cwd: dir });
        assert.equal(archive.status, 0);
        assert.notEqual(shell(command, { ...scoped, ARCHIVE: incomplete }).status, 0);
        assert.ok(!existsSync(join(reports, 'mutation-shards/3')));
      }
      if (kind === 'aggregate') {
        // The judge derived its plan in the step before: the sixteen lanes this fixture run holds.
        const plan = JSON.stringify(Array.from({ length: 16 }, (_, i) => i + 1));
        const refusedWithoutPlan = shell(command, scoped);
        assert.notEqual(refusedWithoutPlan.status, 0);
        assert.ok(!readFileSync(env.CALLS, 'utf8').includes('/zip'));
        rmSync(env.CALLS);
        writeFileSync(join(reports, 'mutation-lanes.json'), plan + '\n');
      }
      const accepted = shell(command, scoped);
      if (kind === 'aggregate') {
        const calls = readFileSync(env.CALLS, 'utf8')
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line) as string[]);
        for (const n of [1, 2]) {
          const attempt = 'repos/fixture/repo/actions/runs/51/attempts/' + n;
          for (const endpoint of [attempt, attempt + '/jobs?per_page=100'])
            assert.equal(calls.filter((args) => args.includes(endpoint)).length, 1, endpoint);
        }
      }
      assert.equal(accepted.status, 0, accepted.stderr);
      if (kind.endsWith(' base')) {
        assert.equal(
          readFileSync(join(reports, 'base/gate-base.json'), 'utf8'),
          'gate-base-' + kind.split(' ')[0],
        );
      } else {
        const lane = kind === 'lane' ? 3 : 16;
        assert.equal(
          readFileSync(join(reports, 'mutation-shards', String(lane), 'mutation/head'), 'utf8').trim(),
          head,
        );
        assert.match(
          readFileSync(join(reports, 'mutation-shards', String(lane), 'producer'), 'utf8'),
          new RegExp('^51\\t' + head + '\\t' + (lane === 3 ? 1 : 2) + '\\t\\d+\\t\\d+\\n$'),
        );
        const repeated = shell(command, scoped);
        assert.notEqual(repeated.status, 0);
        assert.equal(
          readFileSync(join(reports, 'mutation-shards', String(lane), 'mutation/native.json'), 'utf8'),
          'fixture evidence',
        );
        if (kind === 'aggregate')
          assert.equal(readFileSync(join(reports, 'replay-shards/16/head'), 'utf8').trim(), head);
      }
      const uploadStep = actual(file).jobs[job]!.steps!.find(
        (step) => step.name === 'Verify the report tree for upload',
      );
      assert.equal(
        uploadStep?.run,
        'sh tools/runtime/gate-job.sh -- node tools/test-gate/report-files.mjs publish',
      );
      const upload = 'sh "$JOB_WRAPPER" -- node "$GITHUB_WORKSPACE/tools/test-gate/report-files.mjs" publish';
      const published = join(dir, 'publish-output');
      if (kind === 'lane') {
        const alias = join(reports, 'mutation-shards/3/alias');
        for (const create of [symlinkSync, linkSync]) {
          create(join(dir, 'reports/existing'), alias);
          assert.notEqual(shell(upload, { ...scoped, GITHUB_OUTPUT: published }).status, 0);
          assert.ok(!existsSync(published));
          rmSync(alias);
        }
      }
      if (kind === 'lane') {
        const clean = 'sh "$JOB_WRAPPER" -- node "$GITHUB_WORKSPACE/tools/test-gate/report-files.mjs" clean';
        const witness = join(reports, 'cucumber.ndjson');
        writeFileSync(witness, 'unconsumed');
        symlinkSync(join(dir, 'reports/existing'), join(reports, 'gate-plan.json'));
        assert.notEqual(shell(clean, scoped).status, 0);
        assert.equal(readFileSync(witness, 'utf8'), 'unconsumed');
        rmSync(join(reports, 'gate-plan.json'));
        assert.equal(shell(clean, scoped).status, 0);
        assert.ok(!existsSync(witness));
      }
      const checked = shell(upload, { ...scoped, GITHUB_OUTPUT: published });
      assert.equal(checked.status, 0, checked.stderr);
      assert.equal(readFileSync(published, 'utf8'), 'reports=' + reports + '\n');
      const runs = readdirSync(join(root, 'run'));
      assert.equal(runs.length, kind === 'lane' ? 2 : 1);
      const receipt = readFileSync(join(dirname(reports), 'admission.json'), 'utf8');
      assert.ok(!receipt.includes(env.GH_TOKEN));
      assert.equal(readFileSync(join(dir, 'reports/existing'), 'utf8'), 'kept');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

Then('the Gate resolves the producer history for {string}', function (history: string) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'gate-producer-history-')));
  try {
    const provider = providerFixture(dir);
    const rows = JSON.parse(readFileSync(provider.JOBS, 'utf8'));
    const original = rows.find(
      (j: { name: string; run_attempt: number }) =>
        j.name === 'gate-linux-lane-3 / mutation' && j.run_attempt === 1,
    );
    const copy = { ...original, run_attempt: 2, id: 2100 };
    const latest = { ...original, run_attempt: 3, id: 3100 };
    const jobs = [original, copy, latest];
    const producer = JSON.parse(readFileSync(provider.ARTIFACTS, 'utf8')).find(
      (a: { name: string }) => a.name === 'gate-mutation-linux-1-3',
    );
    const artifacts = [producer];
    const fresh = (n: number) => ({
      started_at: '2026-11-22T0' + n + ':01:00Z',
      completed_at: '2026-11-22T0' + n + ':02:00Z',
      runner_id: 99,
    });
    let accepted = false;
    let expected = original,
      artifact = producer;
    let attempt = '3';
    switch (history) {
      case 'first attempt':
        attempt = '1';
        accepted = true;
        break;
      case 'missing attempt field':
      case 'repeated reuse':
        accepted = true;
        break;
      case 'reuse after a genuine rerun':
        Object.assign(copy, fresh(2));
        Object.assign(latest, fresh(2));
        expected = copy;
        artifact = { ...producer, name: 'gate-mutation-linux-2-3', id: 2200 };
        artifacts.push(artifact);
        accepted = true;
        break;
      case 'genuine rerun':
        Object.assign(latest, fresh(3));
        expected = latest;
        artifact = { ...producer, name: 'gate-mutation-linux-3-3', id: 3200 };
        artifacts.push(artifact);
        accepted = true;
        break;
      case 'genuine rerun without artifact':
        Object.assign(latest, fresh(3));
        break;
      case 'conflicting alias artifact':
        artifacts.push({ ...producer, name: 'gate-mutation-linux-3-3', id: 3200 });
        break;
      case 'changed runner':
        latest.runner_id++;
        break;
      case 'changed steps':
        latest.steps = [{ ...original.steps[0], name: 'unrelated' }];
        break;
      case 'missing completion':
        latest.completed_at = null;
        break;
      case 'missed newer execution':
        Object.assign(copy, fresh(2));
        break;
      case 'copied failed producer':
        original.conclusion = 'failure';
        break;
      case 'missing reused row':
        jobs.pop();
        accepted = true;
        break;
      case 'artifact without a job':
        jobs.pop();
        artifacts.push({ ...producer, name: 'gate-mutation-linux-3-3', id: 3200 });
        break;
      case 'missing origin':
        jobs.shift();
        break;
      case 'duplicate attempt row':
        jobs.push({ ...latest, id: 3111 });
        break;
      default:
        throw Error(history);
    }
    writeFileSync(provider.JOBS, JSON.stringify(jobs));
    writeFileSync(provider.ARTIFACTS, JSON.stringify(artifacts));
    const root = join(dir, 'runtime');
    mkdirSync(root);
    writeFileSync(
      join(root, '.architect-os-runtime-root'),
      'architect-os-runtime-root/v2\nenvironment=hosted-runner\n',
    );
    const admitted = this.admitFixture(root);
    const result = spawnSync(
      '/bin/sh',
      [join(ROOT, 'tools/test-gate/fetch-ci-artifacts.sh'), 'mutation', '3'],
      {
        cwd: dir,
        encoding: 'utf8',
        env: {
          ...admitted,
          ...provider,
          GITHUB_RUN_ATTEMPT: attempt,
          OMIT_ATTEMPT: history === 'missing attempt field' ? 'yes' : 'no',
        },
      },
    );
    const target = join(admitted.ARCHITECT_OS_RUN_DIR!, 'reports/mutation-shards/3');
    if (accepted) {
      assert.equal(result.status, 0, result.stderr);
      assert.equal(
        readFileSync(join(target, 'producer'), 'utf8'),
        ['51', head, expected.run_attempt, expected.id, artifact.id].join('\t') + '\n',
      );
    } else {
      assert.notEqual(result.status, 0);
      assert.ok(!existsSync(target));
      assert.ok(!readFileSync(provider.CALLS, 'utf8').includes('/zip'));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

Then(
  'the Gate fetches its Linux base for {string} with outcome {string}',
  function (situation: string, outcome: string) {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'aos-base-')));
    try {
      const env = providerFixture(dir);
      const root = join(dir, 'runtime');
      mkdirSync(root);
      writeFileSync(
        join(root, '.architect-os-runtime-root'),
        'architect-os-runtime-root/v2\nenvironment=hosted-runner\n',
      );
      const admitted = this.admitFixture(root);
      const result = spawnSync('/bin/sh', [join(ROOT, 'tools/test-gate/fetch-gate-base.sh'), 'linux'], {
        cwd: dir,
        encoding: 'utf8',
        env: { ...admitted, ...env, BASE_CASE: situation },
      });
      const path = join(admitted.ARCHITECT_OS_RUN_DIR!, 'reports/base/gate-base.json');
      if (outcome === 'error') assert.notEqual(result.status, 0);
      else assert.equal(result.status, 0, result.stderr);
      assert.equal(existsSync(path), outcome === 'restored');
      if (outcome === 'restored') assert.equal(readFileSync(path, 'utf8'), 'gate-base-linux');
      if (outcome === 'fallback')
        assert.match(result.stdout, /base: (no first parent|no green main push|.*absent or expired)/);
      const calls = existsSync(env.CALLS) ? readFileSync(env.CALLS, 'utf8') : '';
      assert.equal(calls.includes('"download"'), outcome === 'restored' || situation === 'download error');
      if (situation === 'root') assert.equal(calls, '');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
