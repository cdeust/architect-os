import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DataTable } from '@cucumber/cucumber';
import { Then, When, stored } from './helpers.js';

/**
 * The two workflows copied from cdeust/Cortex: the review prompt of claude-review.yml and the resolver embedded in
 * pipeline-after-merge.yml. `Given the committed workflow {string}` (workflows.ts) stores the file under "workflow".
 */
const text = (world: Parameters<typeof stored>[0]): string =>
  stored<{ text: string }>(world, 'workflow').text;

const VERDICT = 'End with exactly one line: "Verdict: approve" or "Verdict: block".';
const LINK =
  '"[View job run](${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }})"';

/**
 * The resolver reads a verdict only from a comment that links a successful review run of the head (Cortex ADR-1130).
 * A review posted with `gh pr comment` carried the verdict and no link, so an approved pull request stayed unmerged.
 * The prompt must give the link after the verdict instruction.
 */
function verdictLinksItsRun(workflow: string): boolean {
  const verdict = workflow.indexOf(VERDICT);
  const link = workflow.indexOf(LINK);
  return (
    verdict !== -1 && link > verdict && workflow.includes('in every comment that carries the verdict line')
  );
}

Then('its prompt gives the run link after the verdict instruction', function () {
  assert.equal(verdictLinksItsRun(text(this)), true);
});

Then('a review prompt without the run link is rejected', function () {
  const broken = text(this).replace(LINK, '');
  assert.notEqual(broken, text(this));
  assert.equal(verdictLinksItsRun(broken), false);
});

/** The resolver exactly as the workflow embeds it: the body of its first Python heredoc, dedented. */
function resolverSource(workflow: string): string {
  const body = workflow.split("          python3 - <<'PY'\n")[1]?.split('\n          PY')[0];
  assert.notEqual(body, undefined, 'no resolver heredoc in pipeline-after-merge.yml');
  return (body as string)
    .split('\n')
    .map((line) => line.replace(/^ {10}/, ''))
    .join('\n');
}

interface ResolverRun {
  code: number | null;
  out: string;
  err: string;
  outputs: string;
}

/**
 * Runs main() of the resolver with resolve() replaced by one that raises the given refusal, so no network call is
 * made. Returns the exit code, stdout, stderr and what was written to GITHUB_OUTPUT.
 */
function runMain(workflow: string, refusal: string): ResolverRun {
  const dir = mkdtempSync(join(tmpdir(), 'after-merge-'));
  try {
    const event = join(dir, 'event.json');
    const output = join(dir, 'output');
    writeFileSync(event, '{}');
    writeFileSync(output, '');
    const driver = [
      'import os, sys',
      'ns = {"__name__": "resolver_test"}',
      'exec(compile(open(sys.argv[1]).read(), "resolver", "exec"), ns)',
      'def refuse(*_):',
      '    raise ns["PostMergeError"](os.environ["REFUSAL"])',
      'ns["resolve"] = refuse',
      'sys.exit(ns["main"]())',
    ].join('\n');
    const source = join(dir, 'resolver.py');
    writeFileSync(source, resolverSource(workflow));
    const run = spawnSync('python3', ['-c', driver, source], {
      encoding: 'utf8',
      env: {
        PATH: process.env['PATH'] ?? '',
        GITHUB_EVENT_NAME: 'workflow_run',
        GITHUB_EVENT_PATH: event,
        GITHUB_REPOSITORY: 'o/r',
        GH_TOKEN: 't',
        GITHUB_OUTPUT: output,
        REFUSAL: refusal,
      },
    });
    return { code: run.status, out: run.stdout, err: run.stderr, outputs: readFileSync(output, 'utf8') };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * A merge that waits is not a failure of the default branch (Cortex ADR-1128). Each head wakes the resolver twice,
 * at the end of the Pipeline and at the end of the review; the first wake-up is held.
 */
When('its resolver refuses with {string}', function (reason: string) {
  this.state['resolver'] = runMain(text(this), reason);
});

Then('the resolver exits 0 with the notice {string} and no output', function (reason: string) {
  assert.deepEqual(stored<ResolverRun>(this, 'resolver'), {
    code: 0,
    out: `::notice title=Merge not made::${reason}\n`,
    err: '',
    outputs: '',
  });
});

Then('the resolver exits 1 with the error {string} and no output', function (reason: string) {
  assert.deepEqual(stored<ResolverRun>(this, 'resolver'), {
    code: 1,
    out: '',
    err: `post-merge: ${reason}\n`,
    outputs: '',
  });
});

Then('the held reasons its resolver can raise are', function (table: DataTable) {
  const held = [...text(this).matchAll(/"(merge held: [^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(held)].sort(), table.raw().flat().sort());
});

Then('its only dependent job requires a pull request number', function () {
  const closer = text(this).split('\n  close-issues:\n')[1]?.split('\n    runs-on:')[0];
  assert.ok(closer?.includes("needs.resolve.outputs.pr_number != ''"), 'close-issues runs without a number');
  assert.equal(text(this).match(/^ {4}needs:/gm)?.length, 1);
});

Then('a resolver for which a held merge is a failure exits 1', function () {
  const broken = text(this).replace(
    'WAITING = ("merge held:", "PR head advanced after testing")',
    'WAITING = ()',
  );
  assert.notEqual(broken, text(this));
  assert.equal(runMain(broken, 'merge held: Pipeline has not succeeded on this head').code, 1);
});
