import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WORKFLOW = readFileSync(join(ROOT, '.github', 'workflows', 'claude-review.yml'), 'utf8');

const VERDICT = 'End with exactly one line: "Verdict: approve" or "Verdict: block".';
const LINK =
  '"[View job run](${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }})"';

/**
 * The resolver reads a verdict only from a comment that links a successful review run of the head
 * (Cortex ADR-1130). A review posted with `gh pr comment` carried the verdict and no link, so an
 * approved pull request stayed unmerged. The prompt must give the link after the verdict instruction.
 */
function verdictLinksItsRun(workflow: string): boolean {
  const verdict = workflow.indexOf(VERDICT);
  const link = workflow.indexOf(LINK);
  return (
    verdict !== -1 && link > verdict && workflow.includes('in every comment that carries the verdict line')
  );
}

describe('claude-review.yml prompt', () => {
  it('puts the run link in every comment that carries the verdict', () => {
    expect(verdictLinksItsRun(WORKFLOW)).toBe(true);
  });

  it('rejects a copy without the run link', () => {
    expect(verdictLinksItsRun(WORKFLOW.replace(LINK, ''))).toBe(false);
  });
});
