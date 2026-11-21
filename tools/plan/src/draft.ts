import { createHash, randomUUID } from 'node:crypto';
import { openSync, closeSync, readFileSync, writeFileSync } from 'node:fs';
import { parseDefinePlanningReply } from '@architect-os/contracts';
import { coveredProposal } from './application/prepare.js';
import { isStepName } from './infrastructure/step-inputs.js';
import { isProvider, requestDraft } from './infrastructure/planner-api.js';

interface DraftProcess {
  argv: readonly string[];
  env: NodeJS.ProcessEnv;
  stdout: { write(s: string): unknown };
  stderr: { write(s: string): unknown };
}
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export async function runDraft(proc: DraftProcess, send: typeof fetch = fetch): Promise<number> {
  const [provider, model, step, path, receipt, limit, timeout, ...extra] = proc.argv.slice(3);
  const fail = (message: string) => {
    proc.stderr.write('architect-os plan draft: ' + message + '\n');
    return 2;
  };
  const maxTokens = Number(limit),
    timeoutMs = Number(timeout);
  if (
    !provider ||
    !isProvider(provider) ||
    !model ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(model) ||
    !step ||
    !isStepName(step) ||
    !path ||
    !receipt ||
    !Number.isSafeInteger(maxTokens) ||
    maxTokens <= 0 ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    // Node timer delays above the signed 32-bit maximum are reset to one millisecond.
    timeoutMs > 2 ** 31 - 1 ||
    extra.length
  )
    return fail(
      'usage: plan draft <claude|gpt|gemini> <model> <step> <define> <new-receipt> <max-output-tokens> <timeout-ms>',
    );
  let fd: number;
  try {
    fd = openSync(receipt, 'wx', 0o600);
  } catch {
    return fail('PLAN_RECEIPT_UNAVAILABLE');
  }
  const attempt_id = randomUUID(),
    started = performance.now();
  const write = (event: Record<string, unknown>) =>
    writeFileSync(
      fd,
      JSON.stringify({ version: 1, attempt_id, stage: 'draft', provider, model_requested: model, ...event }) +
        '\n',
    );
  let run_id: string | null = null,
    define_sha256: string | null = null,
    usage: Awaited<ReturnType<typeof requestDraft>>['usage'] = null,
    http_status: number | null = null;
  let outcome = 'PLAN_DEFINE_INVALID';
  try {
    write({
      event: 'started',
      at: new Date().toISOString(),
      max_output_tokens: maxTokens,
      timeout_ms: timeoutMs,
    });
    const define = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(readFileSync(path));
    const { handoff } = parseDefinePlanningReply([{ type: 'text', text: define }]);
    run_id = handoff.run_id;
    define_sha256 = sha(define);
    outcome = 'PLAN_PROVIDER_FAILED';
    const response = await requestDraft(
      { provider, model, step, handoff, maxTokens, timeoutMs },
      proc.env,
      send,
    );
    http_status = response.http_status;
    usage = response.usage;
    if (!response.text) throw new Error();
    outcome = 'PLAN_PROPOSAL_INVALID';
    const proposal = coveredProposal(handoff, JSON.parse(response.text));
    if (proposal.step !== step) throw new Error();
    const bytes = JSON.stringify(proposal) + '\n';
    write({
      event: 'finished',
      outcome: 'proposed',
      duration_ms: performance.now() - started,
      run_id,
      define_sha256,
      proposal_sha256: sha(bytes),
      http_status,
      usage,
    });
    proc.stdout.write(bytes);
    return 0;
  } catch (error) {
    if (error instanceof Error && error.message === 'PLAN_KEY_MISSING') outcome = error.message;
    write({
      event: 'finished',
      outcome,
      duration_ms: performance.now() - started,
      run_id,
      define_sha256,
      http_status,
      usage,
    });
    return fail(outcome);
  } finally {
    closeSync(fd);
  }
}
