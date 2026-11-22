import { rm } from 'node:fs/promises';

// The caller owns the VM identity. A failed shutdown keeps its mount recoverable.
export async function runOfflineProbe({ name, workspace, run, stop, verify }) {
  const failures = [];
  let result;
  try {
    result = await run();
  } catch (error) {
    failures.push(error);
  }
  try {
    await stop();
  } catch (error) {
    throw new AggregateError(
      [...failures, error],
      `SBX_STOP_UNCONFIRMED: ${name}; workspace retained at ${workspace}`,
    );
  }
  try {
    if (!failures.length && verify) result = await verify(workspace, result);
  } catch (error) {
    failures.push(error);
  }
  try {
    await rm(workspace, { recursive: true, force: true });
  } catch (error) {
    failures.push(new Error('SBX_WORKSPACE_CLEANUP_FAILED: ' + workspace, { cause: error }));
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length) throw new AggregateError(failures, 'SBX_PROBE_AND_CLEANUP_FAILED');
  return result;
}
