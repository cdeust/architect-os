// The end-to-end path of the Step admission receipt (journal, §123): `npm run admit` issues it for the folder Plan
// materialized, into the authority directory of a scenario home, and the production Step host reads and checks it
// with its own subject. The sessions never start: the scenario stops the Step right after its admission.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import os, { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mock } from 'node:test';
import { PassThrough } from 'node:stream';
import { Then, When } from '@cucumber/cucumber';
import { runAdmit } from '../../tools/plan/src/main.js';
import { parseStepFile } from '../../packages/sandbox/src/step-file.js';
import { launcherFiles, runStep, stepDependencies } from '../../packages/sandbox/src/step-tool.js';
import { measuredSpecimens } from '../../packages/sandbox/features/steps/admission-fixture.js';
import { repoOf } from '../../packages/sandbox/features/steps/runner.js';
import type { ArchitectWorld } from '../support/world.js';

const SANDBOX = join(import.meta.dirname, '..', '..', 'packages', 'sandbox');

interface Issued {
  worktree: string;
  folder: string;
  path: string;
  approved_sha256: string;
}

When(
  'the host runs npm run admit for the materialized Plan on a clean linked worktree with measured specimens',
  function (this: ArchitectWorld) {
    const sources = this.state['planSources'] as {
      root: string;
      define: string;
      proposal: string;
      policy: string;
      decision: string;
    };
    const folder = this.state['planFolder'] as string;
    const { worktree } = repoOf(this);
    const home = realpathSync(mkdtempSync(join(tmpdir(), 'aos-admit-home-')));
    const user = os.userInfo();
    const info = mock.method(os, 'userInfo', () => ({ ...user, homedir: home }));
    syncBuiltinESMExports();
    this.cleanups.push(() => {
      info.mock.restore();
      syncBuiltinESMExports();
      rmSync(home, { recursive: true, force: true });
    });
    const step = parseStepFile(JSON.parse(readFileSync(join(folder, 'step.json'), 'utf8')));
    const launcher = launcherFiles((file) => readFileSync(join(SANDBOX, file), 'utf8'), step);
    const specimens = join(sources.root, 'specimens.json');
    writeFileSync(specimens, JSON.stringify(measuredSpecimens(step, launcher)));
    let out = '';
    let err = '';
    const code = runAdmit({
      argv: [
        process.execPath,
        'admit',
        sources.define,
        sources.proposal,
        sources.policy,
        sources.decision,
        specimens,
        folder,
        worktree,
      ],
      stdout: { write: (text) => (out += text) },
      stderr: { write: (text) => (err += text) },
    });
    assert.equal(code, 0, err);
    const issued = JSON.parse(out) as { status: string; step: string; path: string; approved_sha256: string };
    assert.equal(issued.status, 'issued');
    assert.equal(
      issued.path,
      join(home, '.config', 'architect-os', 'step-admission', `delivery-${issued.approved_sha256}.json`),
    );
    this.state['issuedAdmission'] = { worktree, folder, ...issued } satisfies Issued;
  },
);

/** The production Step host on the folder, stopped right after its admission: what the admission returned or threw. */
async function admitWithProductionHost(issued: Issued): Promise<{ admitted?: string; refused?: string }> {
  const proc = {
    ...process,
    env: { ...process.env, INIT_CWD: issued.worktree, ARCHITECT_OS_STEP_EVIDENCE: issued.path },
    cwd: () => issued.worktree,
    argv: [process.execPath, 'step', issued.folder],
    stderr: new PassThrough(),
    stdout: new PassThrough(),
    stdin: new PassThrough(),
  };
  const deps = stepDependencies(proc);
  const seen: { admitted?: string; refused?: string } = {};
  let started = 0;
  try {
    const code = await runStep({
      ...deps,
      session: async () => {
        started++;
        return { exitCode: 1, stopped: true };
      },
      admit: (subject) => {
        try {
          seen.admitted = deps.admit(subject);
        } catch (error) {
          seen.refused = (error as Error).message;
        }
        throw new Error('the scenario stops the Step after its admission');
      },
    });
    assert.equal(code, 2);
    assert.equal(started, 0);
  } finally {
    deps.dispose?.();
  }
  return seen;
}

Then(
  'the production Step host admits the materialized folder with the issued receipt',
  async function (this: ArchitectWorld) {
    const issued = this.state['issuedAdmission'] as Issued;
    assert.deepEqual(await admitWithProductionHost(issued), { admitted: issued.approved_sha256 });
  },
);

When('the approved brief is changed after issuance', function (this: ArchitectWorld) {
  const { folder } = this.state['issuedAdmission'] as Issued;
  writeFileSync(
    join(folder, 'brief.md'),
    readFileSync(join(folder, 'brief.md'), 'utf8') + 'One more task.\n',
  );
});

Then(
  'the production Step host refuses the materialized folder with {string}',
  async function (this: ArchitectWorld, code: string) {
    const issued = this.state['issuedAdmission'] as Issued;
    assert.deepEqual(await admitWithProductionHost(issued), { refused: code });
  },
);

Then(
  'the production Step host on a clean linked worktree refuses the materialized folder without a receipt and starts no session',
  async function (this: ArchitectWorld) {
    const folder = this.state['planFolder'] as string;
    const { worktree } = repoOf(this);
    const stderr = new PassThrough();
    let diagnostic = '';
    stderr.on('data', (chunk: Buffer) => (diagnostic += chunk.toString()));
    const env: NodeJS.ProcessEnv = { ...process.env, INIT_CWD: worktree };
    delete env['ARCHITECT_OS_STEP_EVIDENCE'];
    const proc = {
      ...process,
      env,
      cwd: () => worktree,
      argv: [process.execPath, 'step', folder],
      stderr,
      stdout: new PassThrough(),
      stdin: new PassThrough(),
    };
    const deps = stepDependencies(proc);
    let started = 0;
    let built = 0;
    let checked = 0;
    let prepared = 0;
    const code = await runStep({
      ...deps,
      session: async () => {
        started++;
        return { exitCode: 1, stopped: true };
      },
      builder: {
        build: async () => {
          built++;
          throw new Error('no build may start');
        },
      },
      check: async () => {
        checked++;
        throw new Error('no check may start');
      },
      steps: { ...deps.steps, prepare: () => void prepared++ },
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(
      { code, diagnostic, started, built, checked, prepared },
      {
        code: 2,
        diagnostic: 'architect-os step: STEP_ADMISSION_REQUIRED\n',
        started: 0,
        built: 0,
        checked: 0,
        prepared: 0,
      },
    );
  },
);
