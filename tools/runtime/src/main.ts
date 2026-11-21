// The composition root of the admission (docs/design/orchestration-fable-5-2.md §14, « Un seul lieu d'écriture »): the
// one place that builds objects. The entries `cli.ts` and `npm-names.ts` only hand it the process. The shell entry `aos` runs `cli.ts`
// with plain Node, from source, in a clean environment, before npm, tsx or any installed package: nothing on this path
// imports more than Node's built-ins and the modules of this tool (`#runtime/*`, package.json `imports`).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { admit } from '#runtime/application/admit.js';
import { controlledNpmNames } from '#runtime/domain/npm-settings.js';
import { commandKindOf } from '#runtime/domain/receipt.js';
import type { RuntimeFilesystem } from '#runtime/domain/ports.js';
import { NodeRuntimeFilesystem } from '#runtime/infrastructure/node-runtime-filesystem.js';
import { decodePolicy } from '#runtime/infrastructure/policy-file.js';

/** The policy of the launcher checkout: the file next to this tool, never one named by the caller or the marker. */
export const POLICY_FILE = fileURLToPath(new URL('../admission.json', import.meta.url));

export interface AdmissionDependencies {
  /** The operands after the script: exactly two, the root the shell entry was given and the kind of its command. */
  readonly argv: readonly string[];
  readonly stdout: { write(text: string): unknown };
  readonly stderr: { write(text: string): unknown };
  readonly filesystem: RuntimeFilesystem;
  /** The text of the policy file, or none when it cannot be read. */
  readonly emitBinding?: boolean;
  readonly policyText: () => string | undefined;
  readonly clock: () => Date;
}

/**
 * The admission; its exit code is 0 (admitted: the identifier of the run, alone on stdout), 2 (refused: `aos: <CODE>`
 * on stderr) or 3 (an error nobody foresaw). It never reads stdin.
 */
export function runAdmission(deps: AdmissionDependencies): number {
  try {
    const command = commandKindOf(deps.argv[1]);
    if (deps.argv.length !== 2 || command === undefined) {
      deps.stderr.write('aos: USAGE\n');
      return 2;
    }
    // No text, or a text the decoder refuses: no policy, and the admission refuses.
    const { policy } = decodePolicy(deps.policyText());
    const admission = admit(
      { filesystem: deps.filesystem, policy, clock: deps.clock },
      deps.argv[0],
      command,
    );
    if (!admission.admitted) {
      deps.stderr.write(`aos: ${admission.code}\n`);
      return 2;
    }
    deps.stdout.write((deps.emitBinding ? admission.run + ':' + admission.binding : admission.run) + '\n');
    return 0;
  } catch {
    deps.stderr.write('aos: RUNTIME_UNEXPECTED\n');
    return 3;
  }
}

/** The process, as far as the admission reads it: its arguments and two streams, and its internal bootstrap flag. */
export interface AdmissionProcess {
  readonly env: Readonly<NodeJS.ProcessEnv>;
  readonly argv: readonly string[];
  readonly stdout: { write(text: string): unknown };
  readonly stderr: { write(text: string): unknown };
}

export function admissionDependencies(proc: AdmissionProcess): AdmissionDependencies {
  return {
    argv: proc.argv.slice(2),
    emitBinding: proc.env.ARCHITECT_OS_EMIT_BINDING === '1',
    stdout: proc.stdout,
    stderr: proc.stderr,
    filesystem: new NodeRuntimeFilesystem(),
    policyText: () => {
      try {
        return readFileSync(POLICY_FILE, 'utf8');
      } catch {
        // An unreadable policy file gives no text, and the admission refuses.
      }
    },
    clock: () => new Date(),
  };
}

/** What the entry `npm-names.ts` reads of its process: the names of its environment, and where to print. */
export interface NpmNamesDependencies {
  readonly names: readonly string[];
  readonly stdout: { write(text: string): unknown };
}

/**
 * The names of the environment that npm reads as one of the settings the shell entry `aos` controls, each on its line
 * (src/domain/npm-settings.ts): `aos` removes each of them by name before it gives its command one value of each. Such
 * a name holds only letters, `_` and `-`, so a line end cannot be part of it. Exit code 0; nothing is read but the names.
 */
export function runNpmNames(deps: NpmNamesDependencies): number {
  for (const name of controlledNpmNames(deps.names)) deps.stdout.write(`${name}\n`);
  return 0;
}

export function npmNamesDependencies(proc: {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly stdout: { write(text: string): unknown };
}): NpmNamesDependencies {
  return { names: Object.keys(proc.env), stdout: proc.stdout };
}
