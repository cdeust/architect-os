import { runContainerProbe } from './container-probe.js';

process.exitCode = await runContainerProbe(process);
