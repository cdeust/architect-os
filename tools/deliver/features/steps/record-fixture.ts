import type { StepRecordView } from '../../src/domain/pull-request.js';

// A Step record that the schema of packages/sandbox/src/step-record.ts accepts, for the scenarios of the delivery.

const digest = (digit: string): string => digit.repeat(64);

/** The record of the step `step`: one check, one review that accepted its one criterion. */
export function stepRecord(step = 'step'): StepRecordView & Record<string, unknown> {
  return {
    step,
    startedAt: '2026-11-26T10:00:00.000Z',
    tree: { commit: 'c'.repeat(40), tree: 'd'.repeat(40), clean: true },
    inputs: { 'brief.md': digest('1'), 'step.json': digest('2') },
    launcher: { 'prompts/build.md': digest('3') },
    sessions: [],
    checks: [{ name: 'types-deliver', passed: true, stopped: false, durationSeconds: 3 }],
    reviews: [
      { name: 'correctness', verdict: 'accept', findings: 0, criteria: [{ id: 'AC-1', status: 'met' }] },
    ],
    outcome: 'passed',
  };
}

/** The text a commit records for the record of `step`. */
export function stepRecordText(step = 'step'): string {
  return `${JSON.stringify(stepRecord(step), null, 2)}\n`;
}
