// The entry of the admission, run by the shell entry `aos` with plain Node before any install. Entry point only: the
// admission is `main.ts`.
import { admissionDependencies, runAdmission } from '#runtime/main.js';

process.exitCode = runAdmission(admissionDependencies(process));
