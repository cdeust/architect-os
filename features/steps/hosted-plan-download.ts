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

type Row = { name: string };
const lanesUpTo = (count: number) => JSON.stringify(Array.from({ length: count }, (_, i) => i + 1));
const ofLane = (lane: number) => (name: string) =>
  name === `gate-linux-lane-${lane} / mutation` ||
  name === `gate-linux-lane-${lane} / replay` ||
  new RegExp(`^gate-(mutation|replay)-linux-[0-9]+-${lane}$`).test(name);

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
          edit(provider.JOBS, (rows) => [...rows, { ...rows[5]!, name: 'gate-linux-lane-01 / mutation' }]);
          break;
        case 'a lane artifact under a name no plan gives':
          edit(provider.ARTIFACTS, (rows) => [...rows, { ...rows[5]!, name: 'gate-replay-linux-2-x' }]);
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
      const root = join(dir, 'runtime');
      mkdirSync(root);
      writeFileSync(
        join(root, '.architect-os-runtime-root'),
        'architect-os-runtime-root/v2\nenvironment=hosted-runner\n',
      );
      const admitted = this.admitFixture(root);
      const reports = join(admitted.ARCHITECT_OS_RUN_DIR!, 'reports');
      mkdirSync(reports, { recursive: true });
      if (plan !== null) writeFileSync(join(reports, 'mutation-lanes.json'), plan + '\n');
      const result = spawnSync('/bin/sh', [join(ROOT, 'tools/test-gate/fetch-ci-artifacts.sh')], {
        cwd: dir,
        encoding: 'utf8',
        env: { ...admitted, ...provider },
      });
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
