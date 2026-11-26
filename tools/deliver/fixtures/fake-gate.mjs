// A stand-in for the gate, for the contract of `Gate` (features/steps/ports.ts). Run in the delivery worktree:
//   node fake-gate.mjs <mode> <commit, malformed receipt, or "none"> <exit code> [<destination commit, or "none">]
// The report of the receipt names the destination commit given, `aucune` for "none"; without one, `0` × 40.
// mode `quiet`: writes the verdict (unless "none") and exits with the code.
// mode `noisy`: also writes one line on each output.
// mode `signal`: ends on a signal, without a code.
import { statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { publishGateReceipt } from '../../../packages/sandbox/dist/src/gate-receipt.js';

const [mode, text, code, destination = '0'.repeat(40)] = process.argv.slice(2);
if (mode === 'noisy') {
  process.stdout.write('on the standard output\n');
  process.stderr.write('on the error output\n');
}
if (text !== 'none') {
  const root = process.env.ARCHITECT_OS_RUNTIME_ROOT,
    run = process.env.ARCHITECT_OS_RUN_DIR,
    checkout = process.cwd();
  const sha = mode === 'publish' ? text : '0'.repeat(40);
  publishGateReceipt(
    root,
    checkout,
    run,
    sha,
    JSON.stringify({ job: 'linux', sha, count: 1, pickles: ['a'] }),
    '# Porte de test, job linux : VERTE\n- tête : ' +
      sha +
      '\n- destination : refs/remotes/origin/main à ' +
      (destination === 'none' ? 'aucune' : destination) +
      ', 1 commit(s) jugé(s)\n',
  );
  if (mode !== 'publish') {
    const stat = statSync(checkout, { bigint: true });
    writeFileSync(join(root, 'state', 'gate', stat.dev + '-' + stat.ino, 'latest.json'), text);
  }
}
if (mode === 'signal') process.kill(process.pid, 'SIGKILL');
process.exitCode = Number(code);
