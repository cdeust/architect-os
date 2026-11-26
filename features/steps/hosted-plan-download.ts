import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { providerFixture } from './hosted-download.js';
import { ROOT, Then } from './helpers.js';
import type { ArchitectWorld } from '../support/world.js';

type Row = { name: string };
const lanesUpTo = (count: number) => JSON.stringify(Array.from({ length: count }, (_, i) => i + 1));
const ofLane = (lane: number) => (name: string) =>
  name === `gate-linux-lane-${lane} / mutation` ||
  name === `gate-linux-lane-${lane} / replay` ||
  new RegExp(`^gate-(mutation|replay)-linux-[0-9]+-${lane}$`).test(name);

function runJudge(
  world: ArchitectWorld,
  dir: string,
  provider: ReturnType<typeof providerFixture>,
  plan: string | null,
) {
  const root = join(dir, 'runtime');
  mkdirSync(root);
  writeFileSync(
    join(root, '.architect-os-runtime-root'),
    'architect-os-runtime-root/v2\nenvironment=hosted-runner\n',
  );
  const admitted = world.admitFixture(root);
  const reports = join(admitted.ARCHITECT_OS_RUN_DIR!, 'reports');
  mkdirSync(reports, { recursive: true });
  if (plan !== null) writeFileSync(join(reports, 'mutation-lanes.json'), plan + '\n');
  const result = spawnSync('/bin/sh', [join(ROOT, 'tools/test-gate/fetch-ci-artifacts.sh')], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...admitted, ...provider },
  });
  return { result, reports };
}

/**
 * The run of the fixture holds the jobs and the artifacts of sixteen lanes (features/steps/hosted-download.ts). The
 * judge downloads with the plan it derived, written where `hosted-gate lanes` leaves it.
 */
Then(
  'the Gate downloads the producers of the plan of the judge alone, for {string}',
  function (situation: string) {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'gate-plan-download-')));
    try {
      const provider = providerFixture(dir);
      const edit = (file: string, change: (rows: Row[]) => Row[]) =>
        writeFileSync(file, JSON.stringify(change(JSON.parse(readFileSync(file, 'utf8')) as Row[])));
      let plan: string | null = lanesUpTo(16);
      let accepted = false;
      let downloaded = 16;
      switch (situation) {
        case 'the plan the run followed':
          accepted = true;
          break;
        case 'a plan of fewer lanes than the run started':
          plan = lanesUpTo(15);
          break;
        case 'a plan of more lanes than the run started':
          plan = lanesUpTo(17);
          break;
        case 'a run that started fewer lanes, the plan being its lanes':
          edit(provider.JOBS, (rows) => rows.filter(({ name }) => !ofLane(16)(name)));
          edit(provider.ARTIFACTS, (rows) => rows.filter(({ name }) => !ofLane(16)(name)));
          plan = lanesUpTo(15);
          accepted = true;
          downloaded = 15;
          break;
        case 'an artifact of a lane outside the plan, without its job':
          edit(provider.JOBS, (rows) => rows.filter(({ name }) => !ofLane(16)(name)));
          plan = lanesUpTo(15);
          break;
        case 'a job of a lane outside the plan, without its artifact':
          edit(provider.ARTIFACTS, (rows) => rows.filter(({ name }) => !ofLane(16)(name)));
          plan = lanesUpTo(15);
          break;
        case 'a lane job under a name no plan gives':
          edit(provider.JOBS, (rows) => [
            ...rows,
            { ...rows[5]!, id: 30000, name: 'gate-linux-lane-01 / mutation' },
          ]);
          break;
        case 'a lane artifact under a name no plan gives':
          edit(provider.ARTIFACTS, (rows) => [
            ...rows,
            { ...rows[5]!, id: 30000, name: 'gate-replay-linux-2-x' },
          ]);
          break;
        case 'no plan':
          plan = null;
          break;
        case 'an empty plan':
          plan = '[]';
          break;
        case 'a plan that skips a lane':
          plan = '[1,3]';
          break;
        case 'a plan that does not start at the first lane':
          plan = '[2,3]';
          break;
        case 'a plan that is no list':
          plan = '16';
          break;
        case 'a plan longer than a matrix':
          plan = lanesUpTo(257);
          break;
        default:
          throw new Error(situation);
      }
      const { result, reports } = runJudge(this, dir, provider, plan);
      const lane = (kind: string, number: number) => join(reports, kind + '-shards', String(number));
      if (accepted) {
        assert.equal(result.status, 0, result.stderr);
        for (let number = 1; number <= downloaded; number++) {
          assert.ok(existsSync(join(lane('mutation', number), 'mutation-inventory.json')));
          assert.ok(existsSync(join(lane('replay', number), 'replay.json')));
        }
        assert.ok(!existsSync(lane('mutation', downloaded + 1)));
        assert.ok(!existsSync(lane('replay', downloaded + 1)));
      } else {
        assert.notEqual(result.status, 0);
        // Refused before any download: no archive was asked for, and no lot was written.
        assert.ok(!readFileSync(provider.CALLS, 'utf8').includes('/zip'));
        assert.ok(!existsSync(join(reports, 'mutation-shards')));
        assert.ok(!existsSync(join(reports, 'replay-shards')));
        assert.ok(!existsSync(join(reports, 'cucumber-shards')));
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

Then(
  'the judge sees {string} for {string} and {string} its evidence',
  function (situation: string, source: string, outcome: string) {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'gate-rest-pages-')));
    try {
      const provider = providerFixture(dir);
      type Evidence = { id: number; name: string; run_attempt?: number };
      const read = (file: string): Evidence[] => JSON.parse(readFileSync(file, 'utf8'));
      const jobs = read(provider.JOBS);
      const artifacts = read(provider.ARTIFACTS);
      const planned = (row: Evidence) => row.name.includes('cucumber') || ofLane(1)(row.name);
      writeFileSync(provider.JOBS, JSON.stringify(jobs.filter(planned)));
      writeFileSync(provider.ARTIFACTS, JSON.stringify(artifacts.filter(planned)));
      const key = source === 'run artifacts' ? 'artifacts' : 'jobs';
      const attempt = source === 'historical jobs' ? 1 : 2;
      const rows =
        key === 'artifacts'
          ? read(provider.ARTIFACTS)
          : read(provider.JOBS).filter((row) => row.run_attempt === attempt);
      // The REST endpoint returns up to 100 entries per page and the full collection count on each.
      const sample = key === 'jobs' ? jobs[0]! : artifacts[0]!;
      while (rows.length <= 100) {
        const i = rows.length;
        rows.push({
          ...sample,
          id: 40000 + i,
          name: 'other-' + i,
          ...(key === 'jobs' ? { run_attempt: attempt } : {}),
        });
      }
      // On a complete list, place the first producer on the last page so the judge must read both.
      if (situation === 'complete pages') rows.push(rows.shift()!);
      const pages = [
        { total_count: rows.length, [key]: rows.slice(0, 100) },
        { total_count: rows.length, [key]: rows.slice(100) },
      ];
      switch (situation) {
        case 'complete pages':
          break;
        case 'an omitted outside-plan entry':
          rows[100]!.name = key === 'jobs' ? 'gate-linux-lane-2 / mutation' : 'gate-mutation-linux-1-2';
          pages.pop(); // The outside-plan entry occupied the missing last page.
          break;
        case 'a missing total':
          Reflect.deleteProperty(pages[0]!, 'total_count');
          break;
        case 'a different total on the second page':
          pages[1]!.total_count--;
          break;
        case 'a repeated ID across pages':
          rows[100]!.id = rows[0]!.id;
          break;
        case 'a fractional ID on an unrelated entry':
          rows[100]!.id = 99.5;
          break;
        case 'a zero ID on an unrelated entry':
          rows[100]!.id = 0;
          break;
        case 'no pages':
          pages.length = 0;
          break;
        default:
          throw new Error(situation);
      }
      writeFileSync(provider.PAGES, JSON.stringify({ [key === 'jobs' ? 'attempt-' + attempt : key]: pages }));
      const { result, reports } = runJudge(this, dir, provider, '[1]');
      if (outcome === 'downloads') {
        assert.equal(result.status, 0, result.stderr);
        assert.ok(existsSync(join(reports, 'mutation-shards/1/mutation-inventory.json')));
        assert.ok(existsSync(join(reports, 'replay-shards/1/replay.json')));
      } else {
        assert.notEqual(result.status, 0, source + ': ' + situation);
        assert.match(result.stderr, new RegExp('(invalid pages for |incomplete or invalid )' + key));
        assert.ok(!readFileSync(provider.CALLS, 'utf8').includes('/zip'));
        for (const kind of ['cucumber', 'mutation', 'replay'])
          assert.ok(!existsSync(join(reports, kind + '-shards')));
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

Then(
  'the plan job announces the lanes {string} to its matrix and refuses {string}',
  function (lanes: string, refused: string) {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'gate-plan-announce-')));
    try {
      const root = join(dir, 'runtime');
      mkdirSync(root);
      writeFileSync(
        join(root, '.architect-os-runtime-root'),
        'architect-os-runtime-root/v2\nenvironment=hosted-runner\n',
      );
      const admitted = this.admitFixture(root);
      const reports = join(admitted.ARCHITECT_OS_RUN_DIR!, 'reports');
      mkdirSync(reports, { recursive: true });
      const output = join(dir, 'output');
      const announce = (text: string | null) => {
        rmSync(output, { force: true });
        rmSync(join(reports, 'mutation-lanes.json'), { force: true });
        if (text !== null) writeFileSync(join(reports, 'mutation-lanes.json'), text);
        return spawnSync(process.execPath, [join(ROOT, 'tools/test-gate/report-files.mjs'), 'announce'], {
          cwd: dir,
          encoding: 'utf8',
          env: { ...admitted, PATH: process.env['PATH'], GITHUB_OUTPUT: output },
        });
      };
      const accepted = announce(lanes + '\n');
      assert.equal(accepted.status, 0, accepted.stderr);
      assert.equal(readFileSync(output, 'utf8'), 'lanes=' + lanes + '\n');
      for (const text of [
        ...refused.split(' | ').map((value) => value + '\n'),
        lanes,
        lanes + '\nx=1\n',
        null,
      ]) {
        const broken = announce(text);
        assert.notEqual(broken.status, 0, String(text));
        assert.ok(!existsSync(output), String(text));
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
