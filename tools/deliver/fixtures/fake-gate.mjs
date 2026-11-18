// A stand-in for the gate, for the contract of `Gate` (features/steps/ports.ts). Run in the delivery worktree:
//   node fake-gate.mjs <mode> <verdict path> <verdict text, or "none"> <exit code>
// mode `quiet`: writes the verdict (unless "none") and exits with the code.
// mode `noisy`: also writes one line on each output.
// mode `signal`: ends on a signal, without a code.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const [mode, path, text, code] = process.argv.slice(2);
if (mode === 'noisy') {
  process.stdout.write('on the standard output\n');
  process.stderr.write('on the error output\n');
}
if (text !== 'none') {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}
if (mode === 'signal') process.kill(process.pid, 'SIGKILL');
process.exitCode = Number(code);
