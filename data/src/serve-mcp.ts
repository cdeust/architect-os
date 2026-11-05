import { serveStdio } from './main.js';

process.exitCode = await serveStdio(process.env, process.stdin, process.stdout, process.stderr);
