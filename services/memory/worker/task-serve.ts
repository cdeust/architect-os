import { serveWorker } from './task-main.js';

process.exitCode = await serveWorker(process.argv[2], process.stdin, process.stdout, process.stderr);
