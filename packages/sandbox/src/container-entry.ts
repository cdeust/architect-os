import { runContainerEntry } from './container-relay.js';

process.exitCode = await runContainerEntry(process);
