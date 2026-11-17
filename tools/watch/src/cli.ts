// `npm run watch -- check|read ...` (docs/design/anthropic-watch.md §3). Entry point only: the command is `main.ts`.
import { runWatch, watchDependencies } from './main.js';

process.exitCode = await runWatch(watchDependencies(process));
