import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  accessSync,
  constants,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { basename, delimiter, dirname, isAbsolute, join, resolve } from 'node:path';
import { isatty } from 'node:tty';
import {
  SandboxError,
  type Sandbox,
  type SandboxExit,
  type SandboxRequest,
  type SandboxRunner,
} from './port.js';
import {
  closedEnv,
  isWritable,
  loadTemplate,
  resolveProfile,
  substitute,
  type SrtSettings,
} from './profile.js';
import { killGroup } from './process-group.js';
import { resolveWorktree, type Worktree } from './worktree.js';

/**
 * Adaptateur srt du port SandboxRunner (platform-v3-srt.md, §6). Règles tenues ici :
 * - profil résolu écrit dans un dossier temporaire propre à la sandbox, hors de tout chemin inscriptible ; seul
 *   son sous-dossier `tmp` (`CLAUDE_CODE_TMPDIR`) est inscriptible, et le tout est retiré à l'arrêt ;
 * - srt, node, l'exécutable lancé, le profil et les chemins de confiance du lanceur doivent être hors de tout
 *   chemin inscriptible par la sandbox (§4.1 T), sinon `ISOLATION_UNAVAILABLE` ;
 * - canari avant chaque lancement : lecture refusée et connexion refusée, sinon `ISOLATION_UNAVAILABLE`, sans repli ;
 * - `spawn` sans shell, environnement en liste fermée, `detached` et `kill(-pgid)` [T-06] ;
 * - stdio constant `['pipe', 'pipe', 'pipe']` pour le port ; le terminal seulement par `runInTerminal`, après
 *   vérification que 0, 1 et 2 sont des terminaux (jamais un socket [T-07-fd0]).
 */
export interface SrtRunnerOptions {
  readonly profilesDir: string;
  /** `dist/cli.js` du paquet `@anthropic-ai/sandbox-runtime` épinglé. */
  readonly srtCli: string;
  /** Binaire node qui exécute srt et le canari (`process.execPath`). */
  readonly node: string;
  readonly canaryProbe: string;
  /** Parent des dossiers temporaires par sandbox. */
  readonly tmpRoot: string;
  readonly home: string;
  readonly hostEnv: Readonly<Record<string, string | undefined>>;
  /** Chemins de confiance en plus (code du lanceur, plugins chargés) : refus s'ils sont inscriptibles. */
  readonly trusted: readonly string[];
  /** Variables du lanceur en plus de celles de l'adaptateur (port du proxy, jeton de session). */
  readonly variables?: Readonly<Record<string, string>>;
  readonly canaryTimeoutMs?: number;
  /** Vérifie que 0, 1 et 2 sont des terminaux ; défaut : `isatty` réel. Injectable pour `runInTerminal`. */
  readonly isTerminal?: () => boolean;
  /** `isatty` de la vérification par défaut (défaut : `node:tty`). Injectable pour la tester sans le stdio réel. */
  readonly isatty?: (fd: number) => boolean;
}

interface Prepared {
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly env: Record<string, string>;
  readonly dir: string;
}

const CANARY_OUTPUT_LIMIT = 64 * 1024;
const STOP_GRACE_MS = 2000;

/** Vrai si les descripteurs 0, 1 et 2 sont tous trois des terminaux selon `isTerminalFd` (défaut : `isatty` réel). */
export const standardStreamsAreTerminals = (isTerminalFd: (fd: number) => boolean = isatty): boolean =>
  [0, 1, 2].every((fd) => isTerminalFd(fd));

const unavailable = (message: string): SandboxError => new SandboxError('ISOLATION_UNAVAILABLE', message);

/** Ancêtre le plus proche nommé `node_modules` : srt et ses dépendances y vivent ensemble. */
function nodeModulesOf(path: string): string {
  let dir = dirname(path);
  while (basename(dir) !== 'node_modules') {
    const parent = dirname(dir);
    if (parent === dir) return dirname(path);
    dir = parent;
  }
  return dir;
}

export function resolveExecutable(name: string, path: string | undefined): string {
  const candidates = isAbsolute(name)
    ? [name]
    : name.includes('/')
      ? []
      : (path ?? '')
          .split(delimiter)
          .filter((dir) => isAbsolute(dir))
          .map((dir) => join(dir, name));
  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
      if (statSync(candidate).isFile()) return realpathSync(candidate);
    } catch {
      /* suivant */
    }
  }
  throw new SandboxError('COMMAND_NOT_FOUND', `exécutable introuvable : ${name}`);
}

/** Refuse tout chemin de confiance que la sandbox pourrait écrire, ou qui contient un chemin qu'elle peut écrire. */
export function assertTrusted(settings: SrtSettings, paths: readonly string[]): void {
  for (const path of paths) {
    let real: string;
    try {
      real = realpathSync(path);
    } catch {
      throw unavailable(`chemin de confiance absent : ${path}`);
    }
    const inside = settings.filesystem.allowWrite.some((root) => root.startsWith(`${real}/`));
    if (isWritable(settings, real) || inside)
      throw unavailable(`chemin de confiance inscriptible par la sandbox : ${real}`);
  }
}

export class SrtSandboxRunner implements SandboxRunner {
  constructor(private readonly options: SrtRunnerOptions) {}

  async start(request: SandboxRequest): Promise<Sandbox> {
    const prepared = await this.prepare(request);
    const child = spawn(this.options.node, prepared.argv, {
      cwd: prepared.cwd,
      env: prepared.env,
      detached: true,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.stdin.on('error', () => {
      /* EPIPE : l'enfant est parti [E-02] */
    });
    const exited = settle(child, prepared.dir);
    return {
      stdin: child.stdin,
      stdout: child.stdout,
      stderr: child.stderr,
      exited,
      stop: () => stopGroup(child, exited),
    };
  }

  /**
   * Outil interactif de 1a.0 : la TUI exige un terminal. Hors du port, que la plateforme n'appelle jamais.
   * Les descripteurs 0 à 2 sont ceux de l'appelant, acceptés seulement s'ils sont tous trois des terminaux.
   * `TIOCSTI` depuis la sandbox est refusé par srt sous macOS (journal, §14, X-TTY).
   */
  async runInTerminal(request: SandboxRequest): Promise<SandboxExit> {
    const isTerminal = this.options.isTerminal ?? (() => standardStreamsAreTerminals(this.options.isatty));
    if (!isTerminal())
      throw new SandboxError('TERMINAL_REQUIRED', 'stdin, stdout et stderr doivent être des terminaux');
    const prepared = await this.prepare(request);
    const child = spawn(this.options.node, prepared.argv, {
      cwd: prepared.cwd,
      env: prepared.env,
      detached: true,
      shell: false,
      stdio: 'inherit',
    });
    const exited = settle(child, prepared.dir);
    const forward = (signal: NodeJS.Signals) => () => killGroup(child.pid, signal);
    const handlers: [NodeJS.Signals, () => void][] = [
      ['SIGWINCH', forward('SIGWINCH')],
      ['SIGINT', forward('SIGINT')],
      ['SIGTERM', () => void stopGroup(child, exited)],
      ['SIGHUP', () => void stopGroup(child, exited)],
    ];
    for (const [signal, handler] of handlers) process.on(signal, handler);
    try {
      return await exited;
    } finally {
      for (const [signal, handler] of handlers) process.off(signal, handler);
    }
  }

  private async prepare(request: SandboxRequest): Promise<Prepared> {
    const o = this.options;
    const [name, ...args] = request.command;
    if (name === undefined) throw new SandboxError('COMMAND_NOT_FOUND', 'argv vide');
    const template = loadTemplate(o.profilesDir, request.profile);
    const dir = sandboxFolder(o.tmpRoot);
    try {
      const wt = workspaceOf(o, request.cwd, dir);
      const tmp = join(dir, 'tmp');
      const config = join(dir, 'config');
      mkdirSync(tmp, { mode: 0o700 });
      mkdirSync(config, { mode: 0o700 });
      const vars = {
        ...withSandboxes(o.variables, dir),
        home: realpathSync(o.home),
        repo: wt.repo,
        worktree: wt.worktree,
        worktreeName: wt.worktreeName,
        tmp,
        config,
      };
      const profile = resolveProfile(template, vars);
      for (const [file, content] of Object.entries(profile.files)) {
        mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
        writeFileSync(file, `${JSON.stringify(content, null, 2)}\n`, { mode: 0o600 });
      }
      const env = closedEnv(profile, o.hostEnv);
      const executable = resolveExecutable(name, env['PATH']);
      const unset =
        profile.env.unset.length === 0
          ? []
          : [resolveExecutable('env', env['PATH']), ...profile.env.unset.flatMap((n) => ['-u', n])];
      const settingsFile = join(dir, 'profile.json');
      writeFileSync(settingsFile, `${JSON.stringify(profile.settings, null, 2)}\n`, { mode: 0o400 });
      assertTrusted(profile.settings, [
        settingsFile,
        o.srtCli,
        o.node,
        o.canaryProbe,
        executable,
        ...o.trusted,
      ]);
      const srtCli = realpathSync(o.srtCli);
      assertTrusted(profile.settings, [nodeModulesOf(srtCli)]);
      const cwd = realpathSync(resolve(wt.cwd ?? request.cwd));
      await this.canary(profile.settings, srtCli, dir, cwd, env).finally(() => dropCanary(dir));
      return {
        // Les arguments portent les variables du profil : `--settings ${config}/settings.json` pour Claude Code.
        argv: [
          srtCli,
          '--settings',
          settingsFile,
          '--',
          ...unset,
          executable,
          ...args.map((a) => substitute(a, vars)),
        ],
        cwd,
        env,
        dir,
      };
    } catch (error) {
      rmSync(dir, { recursive: true, force: true });
      throw error;
    }
  }

  /** Le profil réel ; un secret dans un dossier frère, qu'il doit cacher ; un port écouté par l'hôte, hors allowlist. */
  private async canary(
    settings: SrtSettings,
    srtCli: string,
    dir: string,
    cwd: string,
    env: Record<string, string>,
  ) {
    const o = this.options;
    const secret = join(canaryFolder(dir), 'canary-secret');
    writeFileSync(secret, randomUUID(), { mode: 0o600 });
    const canarySettings: SrtSettings = {
      ...settings,
      filesystem: settings.filesystem, // sans ajout : le parent des sandboxes, que le profil refuse, cache le secret
    };
    const file = join(dir, 'canary.json');
    writeFileSync(file, JSON.stringify(canarySettings), { mode: 0o400 });
    const server = createServer((socket) => socket.destroy());
    await new Promise<void>((done, fail) => {
      server.once('error', fail);
      server.listen(0, '127.0.0.1', done);
    });
    const port = (server.address() as AddressInfo).port;
    try {
      const output = await runBounded(
        o.node,
        [srtCli, '--settings', file, '--', o.node, o.canaryProbe, secret, String(port)],
        cwd,
        env,
        o.canaryTimeoutMs ?? 30_000,
      );
      const line = output.trim().split('\n').at(-1) ?? '';
      let verdict: { read?: unknown; connect?: unknown } = {};
      try {
        verdict = JSON.parse(line) as typeof verdict;
      } catch {
        throw unavailable('canari sans verdict : srt absent ou en échec');
      }
      if (verdict.read !== 'denied' || verdict.connect !== 'denied')
        throw unavailable(`canari : lecture ${String(verdict.read)}, connexion ${String(verdict.connect)}`);
    } finally {
      server.close();
    }
  }
}

/** Fin du processus : groupe tué, dossier temporaire retiré. */
function settle(child: ChildProcess, dir: string): Promise<SandboxExit> {
  return new Promise((done) => {
    const finish = (exit: SandboxExit) => {
      killGroup(child.pid, 'SIGKILL');
      rmSync(dir, { recursive: true, force: true });
      done(exit);
    };
    child.once('error', () => finish({ code: null, signal: null }));
    child.once('exit', (code, signal) => finish({ code, signal }));
  });
}

async function stopGroup(child: ChildProcess, exited: Promise<SandboxExit>): Promise<SandboxExit> {
  killGroup(child.pid, 'SIGTERM');
  const timer = setTimeout(() => killGroup(child.pid, 'SIGKILL'), STOP_GRACE_MS);
  try {
    return await exited;
  } finally {
    clearTimeout(timer);
  }
}

/** Lance un processus borné en temps et en octets de sortie ; groupe tué à la fin. */
function runBounded(
  command: string,
  argv: readonly string[],
  cwd: string,
  env: Record<string, string>,
  timeoutMs: number,
): Promise<string> {
  return new Promise((done) => {
    const child = spawn(command, argv, {
      cwd,
      env,
      detached: true,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.stdin.on('error', () => {});
    child.stdin.end();
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      if (output.length < CANARY_OUTPUT_LIMIT) output += chunk.toString('utf8');
    });
    child.stderr.resume();
    const timer = setTimeout(() => killGroup(child.pid, 'SIGKILL'), timeoutMs);
    const finish = () => {
      clearTimeout(timer);
      killGroup(child.pid, 'SIGKILL');
      done(output);
    };
    child.once('error', finish);
    child.once('close', finish);
  });
}

/**
 * The runner of a platform process, module or worker (platform-v3-srt.md, §5, Un gabarit) : its cwd is not a worktree but
 * a disposable folder, `${worktree}`, made in the folder of its sandbox and removed with it; `${repo}` is the root of the
 * platform, `request.cwd`, which the sandbox reads and never writes.
 */
export interface ProcessRunnerOptions extends SrtRunnerOptions {
  readonly workspace: 'disposable';
}

/** The worktree that holds `cwd`; for a platform process, its disposable cwd under `dir` and the root it reads. */
function workspaceOf(
  options: SrtRunnerOptions,
  cwd: string,
  dir: string,
): Worktree & { readonly cwd?: string } {
  if ((options as Partial<ProcessRunnerOptions>).workspace !== 'disposable') return resolveWorktree(cwd);
  const work = join(dir, 'work');
  mkdirSync(work, { mode: 0o700 });
  return { repo: realpathSync(cwd), worktree: work, worktreeName: basename(work), cwd: work };
}

/** Parent de tous les dossiers par sandbox : le profil le refuse en lecture et ne rouvre que ses dossiers inscriptibles. */
const SANDBOXES = 'aos-sb';
/** Longueur de `/srt-mux-` + un pid de 7 chiffres + `-99.sock`, ajoutée au dossier temporaire de la sandbox. */
const SOCKET_SUFFIX = 24;
/** Longueur maximale d'un chemin de socket Unix (macOS jusqu'à 26). */
const SOCKET_PATH_MAX = 103;

/**
 * Le parent de tous les dossiers par sandbox, créé sans `recursive` (un dossier existant n'est pas une erreur), puis
 * pris pour sûr seulement s'il est un vrai dossier (pas un lien symbolique), de l'uid donné, de mode exactement 0700 :
 * sous Linux `/tmp` est partagé, un autre utilisateur peut l'avoir créé avant. Retourne son chemin réel.
 */
export function sandboxesParent(tmpRoot: string, uid: number = process.getuid!()): string {
  const parent = join(tmpRoot, SANDBOXES);
  try {
    mkdirSync(parent, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  // `statSync` suit les liens : un lien est reconnu à son chemin réel, qui n'est plus `<tmpRoot réel>/aos-sb`.
  const real = realpathSync(parent);
  const found = statSync(parent);
  if (
    real !== join(realpathSync(tmpRoot), SANDBOXES) ||
    !found.isDirectory() ||
    found.uid !== uid ||
    (found.mode & 0o777) !== 0o700
  )
    throw unavailable(
      `dossier parent des sandboxes non sûr : ${parent} doit être un dossier (pas un lien), de l'utilisateur courant, de mode 0700`,
    );
  return real;
}

/** Le dossier d'une sandbox, `s-XXXXXX` sous le parent ; refusé si le socket de srt dans son `tmp` ne tiendrait pas. */
function sandboxFolder(tmpRoot: string): string {
  const folder = realpathSync(mkdtempSync(join(sandboxesParent(tmpRoot), 's-')));
  const tmp = join(folder, 'tmp');
  if (tmp.length + SOCKET_SUFFIX > SOCKET_PATH_MAX) {
    rmSync(folder, { recursive: true });
    throw unavailable(
      `dossier temporaire trop long pour un socket Unix : ${tmp}, ${tmp.length} caractères, ${SOCKET_PATH_MAX - SOCKET_SUFFIX} au plus`,
    );
  }
  return folder;
}

/** Les variables données, plus `sandboxes` : le parent du dossier de la sandbox. */
function withSandboxes(variables: Readonly<Record<string, string>> | undefined, dir: string) {
  return { ...variables, sandboxes: dirname(dir) };
}

/** Le dossier du canari d'une sandbox `s-XXXXXX` : son frère `c-XXXXXX`, sous le même parent. */
const canaryPath = (dir: string): string => join(dirname(dir), `c-${basename(dir).slice(2)}`);

/** Crée le dossier frère où le canari pose son secret : hors du dossier de la sandbox, donc caché par le profil. */
function canaryFolder(dir: string): string {
  mkdirSync(canaryPath(dir));
  return canaryPath(dir);
}

/** Fin du canari, qu'il ait passé ou non : le dossier de son secret est retiré. */
function dropCanary(dir: string): void {
  rmSync(canaryPath(dir), { recursive: true });
}
