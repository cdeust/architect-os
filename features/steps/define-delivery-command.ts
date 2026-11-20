import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { After } from '@cucumber/cucumber';
import type { ArchitectWorld } from '../support/world.js';
import { Given, ROOT, Then, When, assertMatches, stored } from './helpers.js';

const source = join(ROOT, 'features', 'fixtures', 'define-delivery-command');
const prdFile = '01-prd.md';
const reportFile = '10-verification-report.md';
const observationFile = 'observation.json';

function readArtifact(directory: string, filename: string): string {
  try {
    return readFileSync(join(directory, filename), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    throw new Error(`Missing Define artifact: ${filename}`, { cause: error });
  }
}

function inspectSpecimen(directory: string): void {
  const prd = readArtifact(directory, prdFile);
  const report = readArtifact(directory, reportFile);
  const observation: unknown = JSON.parse(readFileSync(join(directory, observationFile), 'utf8'));
  assert.ok(typeof observation === 'object' && observation !== null && 'pendingDecision' in observation);
  const decision = observation.pendingDecision;
  assert.ok(
    typeof decision === 'object' &&
      decision !== null &&
      'kind' in decision &&
      decision.kind === 'ask_user' &&
      'question_id' in decision &&
      decision.question_id === 'implementation_gate',
    'Expected the pending implementation_gate question',
  );
  assertMatches(observation, {
    artifacts: [prdFile, '05-testing.md', '07-jira-tickets.md', '00-run-notes.md', reportFile],
    pendingDecision: {
      header: 'Proceed to implementation?',
      multi_select: false,
      options: [{ label: 'PRD only' }, { label: 'Implement' }],
    },
    verificationStatus: 'needs_attention',
  });
  assert.match(prd, /^- FR-001:/m);
  assert.match(report, /^# Verification Report:/m);
  assert.match(report, /^Human decision: pending \(gate not yet answered\)\.$/m);
  const runId = /^Run ID: (\S+)$/m.exec(prd)?.[1];
  assert.ok(runId, 'Expected the PRD run ID');
  assert.equal(/^Run ID: (\S+)$/m.exec(report)?.[1], runId, 'The PRD and report must describe the same run');
}

Given('a local copy of the recorded Define handoff', function () {
  const directory = mkdtempSync(join(tmpdir(), 'architect-os-define-'));
  this.state['defineCopy'] = directory;
  for (const filename of [prdFile, reportFile, observationFile]) {
    copyFileSync(join(source, filename), join(directory, filename));
  }
});

After<ArchitectWorld>(function () {
  const directory = this.state['defineCopy'];
  if (typeof directory === 'string') rmSync(directory, { recursive: true });
});

Given('the recorded specification file is missing', function () {
  rmSync(join(stored<string>(this, 'defineCopy'), prdFile));
});

Given('the recorded decision is replaced by an incompatible action', function () {
  const path = join(stored<string>(this, 'defineCopy'), observationFile);
  const observation: unknown = JSON.parse(readFileSync(path, 'utf8'));
  assert.ok(typeof observation === 'object' && observation !== null);
  writeFileSync(path, JSON.stringify({ ...observation, pendingDecision: { kind: 'done' } }));
});

When('I inspect the recorded Define handoff', function () {
  try {
    inspectSpecimen(stored<string>(this, 'defineCopy'));
    this.state['defineRefusal'] = null;
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    this.state['defineRefusal'] = error.message;
  }
});

Then('the handoff specimen is intact', function () {
  assert.equal(stored<string | null>(this, 'defineRefusal'), null);
});

Then('the handoff specimen is refused with {string}', function (message: string) {
  assert.equal(stored<string | null>(this, 'defineRefusal'), message);
});
