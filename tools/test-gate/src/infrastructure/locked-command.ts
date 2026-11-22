import { publishGateReceipt } from '@architect-os/sandbox/gate-receipt';
import type { GateConfig } from './config.js';
import { parseArguments } from '../domain/arguments.js';
import { parseGateConfig } from './config.js';
import { runGate } from './gate.js';
import { runHostedGate } from './hosted-gate.js';
import { gateReportPath } from './report-paths.js';
import { Workspace } from './workspace.js';
import { changeReplayFile, restoreReplayFile, clearGateReceipt, requireCheckedCommit } from './tree-lease.js';

/** A complete Linux run has the mutation control and its independent replay. Partial jobs emit no delivery receipt. */
export function publishCheckedGate(config: GateConfig, workspace: Workspace): void {
  if (!config.jobs.linux?.mutation || !config.canary || !config.replay)
    throw new Error('GATE_RECEIPT_POLICY_INVALID');
  const plan = JSON.parse(workspace.read(config.reports.plan) ?? 'null');
  if (plan?.job !== 'linux' || typeof plan.head !== 'string') throw new Error('GATE_RECEIPT_PLAN_REQUIRED');
  requireCheckedCommit(plan.head);
  publishGateReceipt(
    process.env.ARCHITECT_OS_RUNTIME_ROOT!,
    process.cwd(),
    process.env.ARCHITECT_OS_RUN_DIR!,
    plan.head,
    workspace.read(config.reports.baseOut) ?? '',
    workspace.read(config.reports.report) ?? '',
  );
}

export async function runLocked(mode: 'local' | 'hosted', args: string[]): Promise<number> {
  const root = process.cwd();
  const workspace = new Workspace(root, (path) => gateReportPath(process.env, path), {
    begin: changeReplayFile,
    restore: restoreReplayFile,
  });
  if (mode === 'hosted') return runHostedGate(args, root, process.stdout, undefined, workspace);
  const command = parseArguments(args);
  const full = 'job' in command && command.name === 'check' && command.job === 'linux';
  if (full) clearGateReceipt();
  const code = await runGate(['node', 'test-gate', ...args], root, process.env, process.stdout, workspace);
  if (full && code === 0) {
    const config = parseGateConfig(workspace.read('tools/test-gate/gate.json') ?? '');
    if ('failure' in config) throw new Error('GATE_RECEIPT_POLICY_INVALID');
    publishCheckedGate(config, workspace);
  }
  return code;
}
