import { publishGateReceipt } from '@architect-os/sandbox/gate-receipt';
import type { GateConfig } from './config.js';
import { runGate } from './gate.js';
import { runHostedGate } from './hosted-gate.js';
import { gateReportPath } from './report-paths.js';
import { Workspace } from './workspace.js';
import { nativeReplacement, clearGateReceipt, requireCheckedCommit } from './tree-lease.js';

/** A complete Linux run has the mutation control and its independent replay. Partial jobs emit no delivery receipt. */
export function publishCheckedGate(config: GateConfig, workspace: Workspace): void {
  if (!config.jobs.linux?.mutation || !config.canary || !config.replay)
    throw new Error('GATE_RECEIPT_POLICY_INVALID');
  const plan = JSON.parse(workspace.read(config.reports.plan) ?? 'null');
  if (plan?.job !== 'linux' || typeof plan.head !== 'string') throw new Error('GATE_RECEIPT_PLAN_REQUIRED');
  requireCheckedCommit(plan.head);
  const base = workspace.read(config.reports.baseOut);
  const report = workspace.read(config.reports.report);
  if (base === null || report === null) throw new Error('GATE_RECEIPT_ARTIFACTS_REQUIRED');
  publishGateReceipt(
    process.env.ARCHITECT_OS_RUNTIME_ROOT!,
    process.cwd(),
    process.env.ARCHITECT_OS_RUN_DIR!,
    plan.head,
    base,
    report,
  );
}

export async function runLocked(mode: 'local' | 'hosted', args: string[]): Promise<number> {
  const root = process.cwd();
  const workspace = new Workspace(root, (path) => gateReportPath(process.env, path), nativeReplacement);
  if (mode === 'hosted') return runHostedGate(args, root, process.stdout, workspace);
  return runGate([...process.argv.slice(0, 2), ...args], root, process.env, process.stdout, workspace, {
    discard: clearGateReceipt,
    publish: publishCheckedGate,
  });
}
