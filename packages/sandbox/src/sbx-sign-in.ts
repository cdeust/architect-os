/** Explicit installation command. Step never imports this entry point. */
import '@architect-os/sandbox/require-run';
import { signInCommand } from './sbx-step.js';
process.exitCode = await signInCommand(process);
