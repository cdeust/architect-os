// Process entry of the memory service (compose.yaml ENTRY): everything it does is serve() in main.ts, tested; this
// file holds no branch, literal or call statement Stryker could mutate.
import { serve } from './main.js';

process.exitCode = await serve(process.env, process.stderr);
