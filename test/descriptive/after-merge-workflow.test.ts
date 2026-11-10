import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WORKFLOW = readFileSync(join(ROOT, '.github', 'workflows', 'pipeline-after-merge.yml'), 'utf8');

const WAITS = [
  'merge held: Pipeline has not succeeded on this head',
  'merge held: no Claude review ran on this head',
  'merge held: Claude has not posted a verdict on this head',
  'merge held: Claude review verdict is block',
  'PR head advanced after testing',
];
const REFUSALS = [
  'PR label holds merge',
  'GitHub did not confirm a completed merge',
  'PR is closed or draft',
];

/** The resolver exactly as the workflow embeds it: the body of its first Python heredoc, dedented. */
function resolverSource(workflow: string): string {
  const body = workflow.split("          python3 - <<'PY'\n")[1]?.split('\n          PY')[0];
  if (body === undefined) throw new Error('no resolver heredoc in pipeline-after-merge.yml');
  return body
    .split('\n')
    .map((line) => line.replace(/^ {10}/, ''))
    .join('\n');
}

/**
 * Runs main() of the resolver with resolve() replaced by one that raises the given refusal, so no
 * network call is made. Returns the exit code, stdout, stderr and what was written to GITHUB_OUTPUT.
 */
function runMain(workflow: string, refusal: string) {
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
        PATH: process.env.PATH ?? '',
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
 * A merge that waits is not a failure of the default branch (Cortex ADR-1128). Each head wakes the
 * resolver twice, at the end of the Pipeline and at the end of the review; the first wake-up is held.
 */
describe('pipeline-after-merge.yml resolver', () => {
  it.each(WAITS)('ends green with a notice and no output when "%s"', (reason) => {
    expect(runMain(WORKFLOW, reason)).toEqual({
      code: 0,
      out: `::notice title=Merge not made::${reason}\n`,
      err: '',
      outputs: '',
    });
  });

  it.each(REFUSALS)('still fails when "%s"', (reason) => {
    expect(runMain(WORKFLOW, reason)).toEqual({
      code: 1,
      out: '',
      err: `post-merge: ${reason}\n`,
      outputs: '',
    });
  });

  it('names every held reason the resolver can raise', () => {
    const held = new Set([...WORKFLOW.matchAll(/"(merge held: [^"]+)"/g)].map((match) => match[1]));
    expect(held).toEqual(new Set(WAITS.filter((reason) => reason.startsWith('merge held:'))));
  });

  it('runs no job after a waiting resolver', () => {
    const closer = WORKFLOW.split('\n  close-issues:\n')[1]?.split('\n    runs-on:')[0];
    expect(closer).toContain("needs.resolve.outputs.pr_number != ''");
    expect(WORKFLOW.match(/^ {4}needs:/gm)).toHaveLength(1);
  });

  it('rejects a copy where a held merge is a failure', () => {
    const broken = WORKFLOW.replace(
      'WAITING = ("merge held:", "PR head advanced after testing")',
      'WAITING = ()',
    );
    expect(broken).not.toBe(WORKFLOW);
    expect(runMain(broken, WAITS[0]!).code).toBe(1);
  });
});
