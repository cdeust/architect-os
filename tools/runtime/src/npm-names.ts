// The entry the shell entry `aos` runs, with the trusted Node, to learn which inherited variables npm would read as a
// setting `aos` controls. Entry point only: the command is `main.ts`.
import { npmNamesDependencies, runNpmNames } from '#runtime/main.js';

process.exitCode = runNpmNames(npmNamesDependencies(process));
