// `npm run watch -- check|read ...` (docs/design/anthropic-watch.md §3). Entry point only: the command is `main.ts`.
import '@architect-os/sandbox/require-run';
const { runWatch, watchDependencies } = await import('./main.js');

process.exitCode = await runWatch(watchDependencies(process));
