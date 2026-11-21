import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, openSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const planCli = 'tools/plan/src/cli.ts';
const commands = new Map([
  ['define', 'tools/define/src/cli.ts'],
  ['proposal', 'tools/define/src/proposal-cli.ts'],
  ['draft', planCli],
  ['prepare', planCli],
  ['materialize', planCli],
]);

function launch(proc, command, args, onData) {
  const script = fileURLToPath(new URL('../' + command, import.meta.url));
  const child = spawn(proc.execPath, ['--import', 'tsx', script, ...args], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve([code, signal]));
    if (onData) child.stdout.on('data', onData);
    child.stdout.pipe(proc.stdout, { end: false });
  });
}

/** One private, exclusively created JSONL journal per invocation, including refused attempts. */
export async function measure([receipt, stage, ...args], proc = process) {
  const command = commands.get(stage);
  if (!receipt || !command)
    throw new Error(
      'usage: baseline:planning <new-receipt> <define|proposal|draft|prepare|materialize> <command arguments...>',
    );
  if (stage === 'draft') {
    // The drafter owns the receipt and records provider usage on the same attempt.
    const [code] = await launch(proc, command, [stage, ...args.toSpliced(4, 0, receipt)]);
    return code ?? 1;
  }
  const fd = openSync(receipt, 'wx', 0o600);
  const started = performance.now();
  const attempt_id = randomUUID();
  const write = (event) =>
    writeFileSync(fd, JSON.stringify({ version: 1, attempt_id, stage, ...event }) + '\n');
  try {
    write({ event: 'started', at: new Date().toISOString() });
    const plan = command === planCli;
    const output = [];
    const [code, signal] = await launch(proc, command, plan ? [stage, ...args] : args, (bytes) =>
      output.push(bytes),
    );
    const bytes = Buffer.concat(output);
    const result = code === 0 ? JSON.parse(bytes.toString('utf8')) : null;
    write({
      event: 'finished',
      duration_ms: performance.now() - started,
      exit_code: code,
      signal,
      run_id: plan ? (result?.manifest?.run_id ?? null) : (args[0] ?? null),
      approval_sha256: result?.approval_sha256 ?? null,
      stdout_sha256: createHash('sha256').update(bytes).digest('hex'),
      producer_usage: null,
    });
    return code ?? 1;
  } catch (error) {
    write({ event: 'measurement_failed', duration_ms: performance.now() - started, producer_usage: null });
    throw error;
  } finally {
    closeSync(fd);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await measure(process.argv.slice(2));
  } catch (err) {
    process.stderr.write('architect-os planning measurement: ' + err.message + '\n');
    process.exitCode = 1;
  }
}
