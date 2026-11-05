import { serve } from './main.js';

process.exitCode = await serve(process.env, process.stdin, process.stdout, process.stderr);
