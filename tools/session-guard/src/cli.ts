// The PreToolUse hook entry: it hands the process to `main.ts` and sets the exit code. Entry point only.
import { guardDependencies, runGuard } from '#guard/main.js';

process.exitCode = runGuard(guardDependencies(process));
