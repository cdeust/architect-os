// L'outil de code isolé de la brique 1a.0 : Claude Code sous srt dans le worktree courant. `code.ts` lui passe le
// processus ; tout ce que l'outil fait est ici, testé. Aucun secret ne franchit la frontière : le proxy
// d'authentification, hors sandbox, détient l'identifiant ; la sandbox reçoit un jeton de session aléatoire, révoqué
// à la fin.
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { Readable, Writable } from 'node:stream';
import { isatty } from 'node:tty';
import { fileURLToPath } from 'node:url';
import {
  commandCredential,
  startAuthProxy,
  type AuthProxy,
  type AuthProxyOptions,
  type CredentialSource,
} from './auth-proxy.js';
import { SandboxError, type SandboxExit, type SandboxRequest, type SandboxRunner } from './port.js';
import { SrtSandboxRunner, standardStreamsAreTerminals, type SrtRunnerOptions } from './srt-runner.js';
import { authProxyOptions, loadTool, type Tool } from './tool.js';
import { resolveWorktree } from './worktree.js';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = resolve(PKG, '..', '..');

/** Ce que l'outil demande au lanceur : le port, plus le lancement dans le terminal de l'hôte. */
export interface CodeToolRunner extends SandboxRunner {
  runInTerminal(request: SandboxRequest): Promise<SandboxExit>;
}

export interface CodeToolDependencies {
  readonly tool: Tool;
  /** Le fichier de prompt système de `code.json` dans le worktree visé, absolu, ou null s'il n'existe pas. */
  readonly systemPrompt: () => string | null;
  readonly credential: CredentialSource;
  readonly startProxy: (options: AuthProxyOptions) => Promise<AuthProxy>;
  /** Le lanceur, pour les variables du proxy (port, jeton de session). */
  readonly runner: (variables: Readonly<Record<string, string>>) => CodeToolRunner;
  readonly sessionToken: () => string;
  /** Le worktree visé. */
  readonly cwd: string;
  /** Les arguments de claude donnés par l'appelant. */
  readonly argv: readonly string[];
  /** 0, 1 et 2 sont des terminaux : la session prend le terminal. */
  readonly terminal: boolean;
  readonly stdin: Readable;
  readonly stdout: Writable;
  readonly stderr: Writable;
}

/** Une session de l'outil : identifiant lisible, proxy, sandbox, puis jeton révoqué et proxy fermé ; son code de sortie. */
export async function runCodeTool(deps: CodeToolDependencies): Promise<number> {
  await deps.credential().catch(() => {
    throw new SandboxError(
      'ISOLATION_UNAVAILABLE',
      "identifiant de l'hôte illisible : se connecter avec claude sur l'hôte",
    );
  });
  const sessionToken = deps.sessionToken();
  const proxy = await deps.startProxy(authProxyOptions(deps.tool, sessionToken, deps.credential));
  try {
    const runner = deps.runner({ authProxyPort: String(proxy.port), sessionToken });
    const prompt = deps.systemPrompt();
    const request: SandboxRequest = {
      profile: deps.tool.profile,
      cwd: deps.cwd,
      command: [
        ...deps.tool.command,
        ...(prompt === null ? [] : ['--append-system-prompt-file', prompt]),
        ...deps.argv,
      ],
    };
    const exit = deps.terminal ? await runner.runInTerminal(request) : await piped(runner, request, deps);
    return exit.code ?? 1;
  } finally {
    proxy.revoke();
    await proxy.close();
  }
}

/** La sandbox sur les flux du processus ; stdin est libéré à la fin. */
async function piped(runner: SandboxRunner, request: SandboxRequest, deps: CodeToolDependencies) {
  const sandbox = await runner.start(request);
  deps.stdin.pipe(sandbox.stdin);
  sandbox.stdout.pipe(deps.stdout);
  sandbox.stderr.pipe(deps.stderr);
  const exit = await sandbox.exited;
  deps.stdin.unpipe(sandbox.stdin);
  deps.stdin.destroy();
  return exit;
}

/** Ce que l'outil lit du processus ; `process` en est un. */
export interface CodeProcess {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly argv: readonly string[];
  readonly execPath: string;
  cwd(): string;
  readonly stdin: Readable;
  readonly stdout: Writable;
  readonly stderr: Writable;
}

/** Les options de l'adaptateur srt : profils, srt épinglé et canari du paquet ; code du lanceur de confiance. */
export function srtOptions(proc: CodeProcess, variables: Readonly<Record<string, string>>): SrtRunnerOptions {
  return {
    profilesDir: join(PKG, 'profiles'),
    srtCli: createRequire(import.meta.url).resolve('@anthropic-ai/sandbox-runtime/dist/cli.js'),
    node: proc.execPath,
    canaryProbe: join(PKG, 'src', 'canary-probe.mjs'),
    tmpRoot: tmpdir(),
    home: homedir(),
    hostEnv: proc.env,
    trusted: [PKG, join(ROOT, 'package.json')],
    variables,
  };
}

/**
 * Les dépendances réelles : `code.json`, l'identifiant du trousseau, le proxy d'`auth-proxy.ts`, l'adaptateur srt.
 * Le worktree visé est INIT_CWD, fixé par npm, sinon le répertoire courant ; son prompt système est lu à la racine.
 */
export function processDependencies(
  proc: CodeProcess,
  isTerminalFd: (fd: number) => boolean = isatty,
): CodeToolDependencies {
  const tool = loadTool(join(PKG, 'code.json'));
  const cwd = proc.env['INIT_CWD'] ?? proc.cwd();
  return {
    tool,
    systemPrompt: () => {
      const file = join(resolveWorktree(cwd).worktree, tool.systemPromptFile);
      return existsSync(file) ? file : null;
    },
    credential: commandCredential(tool.authProxy.credentialCommand),
    startProxy: startAuthProxy,
    runner: (variables) => new SrtSandboxRunner(srtOptions(proc, variables)),
    sessionToken: () => randomBytes(32).toString('hex'),
    cwd,
    argv: proc.argv.slice(2),
    terminal: standardStreamsAreTerminals(isTerminalFd),
    stdin: proc.stdin,
    stdout: proc.stdout,
    stderr: proc.stderr,
  };
}

/** Écrit l'échec sur stderr, sans pile ; le code de sortie est 2. */
export const failureReporter =
  (stderr: Writable) =>
  (error: unknown): number => {
    stderr.write(`architect-os code: ${error instanceof SandboxError ? error.message : String(error)}\n`);
    return 2;
  };
