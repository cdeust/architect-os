import { rm } from 'node:fs/promises';

// Keep the owner's normal signal disposition outside the probe. Repeated signals during
// shutdown leave the same cancellation in effect until the named VM has been accounted for.
export async function withProbeSignals(operation) {
  const controller = new AbortController();
  const handlers = ['SIGINT', 'SIGTERM', 'SIGHUP'].map((name) => {
    const handler = () => controller.abort(Error('SBX_HOST_INTERRUPTED_' + name));
    process.on(name, handler);
    return [name, handler];
  });
  try {
    const result = await operation(controller.signal);
    controller.signal.throwIfAborted();
    return result;
  } finally {
    for (const [name, handler] of handlers) process.off(name, handler);
  }
}

// A consumer may wait indefinitely between commands. Revoke its capability on return
// or cancellation, and reap outstanding CLI operations before removing the VM.
export async function useUntilInterrupted(hostSignal, limitMs, use) {
  hostSignal.throwIfAborted();
  const timeout = new AbortController();
  const signal = AbortSignal.any([hostSignal, timeout.signal]);
  // Process signal watchers alone do not keep Node alive during an idle top-level
  // await. The same bounded consumer deadline owns both liveness and cancellation.
  const deadline = setTimeout(() => timeout.abort(Error('SBX_USE_TIMEOUT')), limitMs);
  let open = true;
  const running = new Set();
  function start(operation) {
    signal.throwIfAborted();
    if (!open) throw Error('SBX_CAPABILITY_CLOSED');
    const pending = operation();
    running.add(pending);
    const settled = () => running.delete(pending);
    pending.then(settled, settled);
    return pending;
  }
  const { promise, reject } = Promise.withResolvers();
  const interrupt = () => reject(signal.reason);
  signal.addEventListener('abort', interrupt, { once: true });
  let result;
  try {
    const work = Promise.resolve().then(() => {
      signal.throwIfAborted();
      return use(start, signal);
    });
    result = await Promise.race([promise, work]);
  } finally {
    open = false;
    signal.removeEventListener('abort', interrupt);
    await Promise.allSettled(running);
    clearTimeout(deadline);
  }
  signal.throwIfAborted();
  return result;
}

// An unsuccessful create RPC may outlive its client. Absence in a single list
// proves shutdown only after creation was acknowledged or the named VM was removed.
export async function stopOwnedVm(name, creation, list, remove) {
  if (creation === 'unused') return;
  if (!(await list()).includes(name)) {
    if (creation !== 'acknowledged') throw Error('SBX_CREATE_UNCONFIRMED');
    return;
  }
  await remove(name);
  if ((await list()).includes(name)) throw Error('SBX_CLEANUP_INCOMPLETE: ' + name);
}

// The caller owns the VM identity. A failed shutdown keeps its mount recoverable.
export async function runOfflineProbe({ name, workspace, run, stop, verify, signal }) {
  const failures = [];
  function recordInterruption() {
    if (signal?.aborted && !failures.includes(signal.reason)) failures.push(signal.reason);
  }
  let result;
  try {
    signal?.throwIfAborted();
    result = await run();
  } catch (error) {
    failures.push(error);
  }
  try {
    await stop();
  } catch (error) {
    recordInterruption();
    throw new AggregateError(
      [...failures, error],
      `SBX_STOP_UNCONFIRMED: ${name}; workspace retained at ${workspace}`,
    );
  }
  try {
    if (!failures.length && !signal?.aborted && verify) result = await verify(workspace, result);
  } catch (error) {
    failures.push(error);
  }
  try {
    await rm(workspace, { recursive: true, force: true });
  } catch (error) {
    failures.push(new Error('SBX_WORKSPACE_CLEANUP_FAILED: ' + workspace, { cause: error }));
  }
  recordInterruption();
  if (failures.length === 1) throw failures[0];
  if (failures.length) throw new AggregateError(failures, 'SBX_PROBE_AND_CLEANUP_FAILED');
  return result;
}
