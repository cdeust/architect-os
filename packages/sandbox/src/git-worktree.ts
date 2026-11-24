import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Resolve from the launcher package, never from the checkout under inspection.
const guard = fileURLToPath(
  new URL(
    '../../../tools/test-gate/with-tree-lock.py',
    import.meta.resolve('@architect-os/sandbox/runtime-context'),
  ),
);

function inspect(root: string, mode: 'inspect-clean' | 'inspect-markers', input?: string, timeout = 60_000) {
  const result = spawnSync('/usr/bin/python3', ['-I', guard, mode], {
    cwd: root,
    env: { PATH: '/usr/bin:/bin' },
    input,
    encoding: 'utf8',
    timeout,
    maxBuffer: 1 << 30,
  });
  if (result.status !== 0 && result.status !== 1) throw new Error('GATE_CHECKOUT_UNREADABLE');
  return result;
}

/** The first visible nested .git marker, without opening it or asking Git to classify it. */
export function visibleNestedMarker(root: string, committed: string, timeout?: number): string | undefined {
  const { status, stdout } = inspect(root, 'inspect-markers', committed, timeout);
  if (status !== 0) throw new Error('GATE_CHECKOUT_UNREADABLE');
  return stdout || undefined;
}

/** Verify the real index and checkout bytes with the same comparison as the native lease. */
export function checkoutIsClean(root: string): boolean {
  return inspect(root, 'inspect-clean').status === 0;
}
