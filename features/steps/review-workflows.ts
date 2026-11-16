import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DataTable } from '@cucumber/cucumber';
import { Then, When, stored } from './helpers.js';

/**
 * The two workflows copied from cdeust/Cortex, as far as this repository proves them: the resolver of
 * pipeline-after-merge.yml (a merge that waits is not a failure of the default branch, Cortex ADR-1128) and the
 * prompt of claude-review.yml (a verdict is read only from a comment that links the review run, Cortex ADR-1130).
 */
interface Loaded {
  path: string;
  text: string;
}

interface Ended {
  code: number | null;
  out: string;
  err: string;
  outputs: string;
}

const text = (world: Parameters<typeof stored>[0]): string => stored<Loaded>(world, 'workflow').text;

/** The resolver exactly as the workflow embeds it: the body of its first Python heredoc, without its indentation. */
function resolverSource(workflow: string): string {
  const body = workflow.split("          python3 - <<'PY'\n")[1]?.split('\n          PY')[0];
  assert.notEqual(body, undefined, 'no resolver heredoc in the workflow');
  return (body as string)
    .split('\n')
    .map((line) => line.replace(/^ {10}/, ''))
    .join('\n');
}

/** Runs main() of the resolver with resolve() replaced by one that raises the refusal: no call leaves the host. */
const DRIVER = [
  'import os, sys',
  'ns = {"__name__": "resolver_scenario"}',
  'exec(compile(open(sys.argv[1]).read(), "resolver", "exec"), ns)',
  'def refuse(*_):',
  '    raise ns["PostMergeError"](os.environ["REFUSAL"])',
  'ns["resolve"] = refuse',
  'sys.exit(ns["main"]())',
].join('\n');

function runResolver(workflow: string, refusal: string): Ended {
  const dir = mkdtempSync(join(tmpdir(), 'after-merge-'));
  try {
    const event = join(dir, 'event.json');
    const output = join(dir, 'output');
    const source = join(dir, 'resolver.py');
    writeFileSync(event, '{}');
    writeFileSync(output, '');
    writeFileSync(source, resolverSource(workflow));
    const run = spawnSync('python3', ['-c', DRIVER, source], {
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

When('its resolver is refused {string}', function (refusal: string) {
  this.state['resolver'] = { refusal, ended: runResolver(text(this), refusal) };
});

const ended = (world: Parameters<typeof stored>[0]): { refusal: string; ended: Ended } =>
  stored<{ refusal: string; ended: Ended }>(world, 'resolver');

Then('the resolver ends green with the notice of the refusal, and writes no output', function () {
  const { refusal, ended: result } = ended(this);
  assert.deepEqual(result, {
    code: 0,
    out: `::notice title=Merge not made::${refusal}\n`,
    err: '',
    outputs: '',
  });
});

Then('the resolver fails with the refusal on its error stream, and writes no output', function () {
  const { refusal, ended: result } = ended(this);
  assert.deepEqual(result, { code: 1, out: '', err: `post-merge: ${refusal}\n`, outputs: '' });
});

Then('the held merges its resolver can raise are:', function (table: DataTable) {
  const raised = [...text(this).matchAll(/"(merge held: [^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(
    [...new Set(raised)].sort(),
    table
      .raw()
      .map((row) => row[0])
      .sort(),
  );
});

Then('its only job after the resolver runs for a pull request number alone', function () {
  const closer = text(this).split('\n  close-issues:\n')[1]?.split('\n    runs-on:')[0];
  assert.ok(closer?.includes("needs.resolve.outputs.pr_number != ''"), 'close-issues runs without a number');
  assert.equal(text(this).match(/^ {4}needs:/gm)?.length, 1);
});

const WAITS = 'WAITING = ("merge held:", "PR head advanced after testing")';

Then('a copy whose resolver waits for nothing fails when refused {string}', function (refusal: string) {
  const broken = text(this).replace(WAITS, 'WAITING = ()');
  assert.notEqual(broken, text(this));
  assert.equal(runResolver(broken, refusal).code, 1);
});

const VERDICT = 'End with exactly one line: "Verdict: approve" or "Verdict: block".';
const RUN_LINK =
  '"[View job run](${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }})"';

/** The prompt gives the link of the run after the instruction of the verdict, for every comment that carries it. */
function assertVerdictLinksItsRun(workflow: string): void {
  const verdict = workflow.indexOf(VERDICT);
  assert.notEqual(verdict, -1, 'no verdict instruction in the prompt');
  assert.ok(workflow.indexOf(RUN_LINK) > verdict, 'no run link after the verdict instruction');
  assert.ok(
    workflow.includes('in every comment that carries the verdict line'),
    'the link is not for every comment',
  );
}

Then('its prompt puts the link of the run in every comment that carries the verdict', function () {
  assertVerdictLinksItsRun(text(this));
});

Then('a review workflow without the link of the run is rejected', function () {
  const broken = text(this).replace(RUN_LINK, '');
  assert.notEqual(broken, text(this));
  assert.throws(() => assertVerdictLinksItsRun(broken));
});
