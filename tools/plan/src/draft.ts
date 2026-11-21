import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { runPlan } from './main.js';
import { runAgyExchange } from './agy.js';
import { parseDefinePlanningReply } from '@architect-os/contracts';
import { coveredProposal } from './application/prepare.js';
import { isStepName } from './infrastructure/step-inputs.js';
import { isProvider, requestDraft } from './infrastructure/plan-cli.js';

interface DraftProcess {
  argv: readonly string[];
  env: NodeJS.ProcessEnv;
  stdout: { write(s: string): unknown };
  stderr: { write(s: string): unknown };
}
function sha(s: string) {
  return createHash('sha256').update(s).digest('hex');
}

export async function runPlanCommand(proc: DraftProcess, run = requestDraft): Promise<number> {
  if (proc.argv[2] === 'agy-request' || proc.argv[2] === 'agy-result') return runAgyExchange(proc);
  if (proc.argv[2] !== 'draft') return runPlan(proc);
  const fail = (message: string, exitCode = 2) => {
    proc.stderr.write('architect-os plan draft: ' + message + '\n');
    return exitCode;
  };
  const args = proc.argv.slice(3);
  const synopsis = 'usage: plan draft <claude|gpt|gemini> <model> <step> <define> <new-receipt> <timeout-ms>';
  if (args.length !== 6) return fail(synopsis);
  const [provider, model, step, path, receipt, timeout] = args as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  const timeoutMs = Number(timeout);
  if (
    !isProvider(provider) ||
    (provider === 'gemini' && !model.startsWith('gemini-')) ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(model) ||
    !isStepName(step) ||
    !path ||
    !receipt ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    // Node timer delays above the signed 32-bit maximum are reset to one millisecond.
    timeoutMs > 2 ** 31 - 1
  )
    return fail(synopsis);
  let handle;
  try {
    handle = await open(receipt, 'wx', 0o600);
  } catch {
    return fail('PLAN_RECEIPT_UNAVAILABLE');
  }
  await using journal = handle;
  const attempt_id = randomUUID(),
    started = performance.now();
  const write = (event: Record<string, unknown>) =>
    writeFileSync(
      journal.fd,
      JSON.stringify({ version: 2, attempt_id, stage: 'draft', provider, model_requested: model, ...event }) +
        '\n',
    );
  let run_id: string | null = null,
    define_sha256: string | null = null,
    usage: Awaited<ReturnType<typeof requestDraft>>['usage'] = null,
    native_exit_code: number | null = null,
    signal: string | null = null;
  let native_failure: string | null = null;
  let outcome = 'PLAN_DEFINE_INVALID';
  try {
    write({
      event: 'started',
      at: new Date().toISOString(),
      transport: 'native-cli',
      billing_verified: false,
      timeout_ms: timeoutMs,
    });
    const define = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(readFileSync(path));
    const { handoff } = parseDefinePlanningReply([{ type: 'text', text: define }]);
    run_id = handoff.run_id;
    define_sha256 = sha(define);
    outcome = 'PLAN_PROVIDER_FAILED';
    native_failure = 'launch_failed';
    const response = await run({ provider, model, step, handoff, timeoutMs }, proc.env);
    native_failure = response.failure ?? null;
    native_exit_code = response.exit_code;
    signal = response.signal;
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
      exit_code: 0,
      native_exit_code,
      signal,
      usage,
    });
    proc.stdout.write(bytes);
    return 0;
  } catch {
    const exit_code = outcome === 'PLAN_DEFINE_INVALID' ? 2 : 1;
    write({
      event: 'finished',
      outcome,
      native_failure,
      duration_ms: performance.now() - started,
      run_id,
      define_sha256,
      exit_code,
      native_exit_code,
      signal,
      usage,
    });
    return fail(outcome, exit_code);
  }
}
