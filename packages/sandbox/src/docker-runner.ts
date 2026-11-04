import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  SandboxError,
  type Sandbox,
  type SandboxExit,
  type SandboxRequest,
  type SandboxRunner,
} from './port.js';
import { killGroup } from './process-group.js';

/**
 * Adaptateur Docker du port (docs/design/platform-v3-srt.md, §6) : seulement là où srt n'est pas supporté, choisi
 * par configuration, jamais par détection ni bascule. Les options durcies sont celles de l'ancien
 * `services/memory/src/infrastructure/docker-runner.ts`, reprises sans extension : système de fichiers en lecture
 * seule, aucune capacité, pas d'élévation, utilisateur non root, réseau d'exécution seul, mémoire et PID bornés.
 */
export interface DockerRunnerOptions {
  /** Le seul profil que l'adaptateur sert ; tout autre nom est refusé. */
  readonly profile: string;
  readonly image: string;
  /** Le réseau isolé d'exécution, jamais celui de l'application ni des données. */
  readonly network: string;
  readonly memory: string;
  readonly pidsLimit: number;
  /** Environnement du conteneur, liste fermée ; jamais de secret (docs/infrastructure.md). */
  readonly env: Readonly<Record<string, string>>;
  /** Le client Docker : `docker`, résolu dans le PATH. */
  readonly docker?: string;
}

/** Variables du client Docker lui-même, en liste fermée : de quoi trouver le démon, rien d'autre. */
const CLIENT_ENV = ['PATH', 'HOME', 'DOCKER_HOST', 'DOCKER_CONFIG', 'DOCKER_CONTEXT'];

/** L'argv de `docker run` pour un conteneur nommé, suivi de l'argv de la demande après l'image. */
export function dockerArgs(options: DockerRunnerOptions, name: string, command: readonly string[]): string[] {
  const { image, network, memory, pidsLimit, env } = options;
  return [
    'run',
    '--rm',
    '-i',
    '--name',
    name,
    '--read-only',
    '--tmpfs',
    '/tmp:rw,noexec,nosuid,size=64m',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--user',
    '10001:10001',
    '--network',
    network,
    '--memory',
    memory,
    '--pids-limit',
    String(pidsLimit),
    ...Object.entries(env).flatMap(([key, value]) => ['--env', `${key}=${value}`]),
    image,
    ...command,
  ];
}

export class DockerSandboxRunner implements SandboxRunner {
  constructor(
    private readonly options: DockerRunnerOptions,
    private readonly hostEnv: Readonly<Record<string, string | undefined>> = process.env,
  ) {}

  async start(request: SandboxRequest): Promise<Sandbox> {
    if (request.profile !== this.options.profile) {
      throw new SandboxError('PROFILE_INVALID', `profil inconnu de l'adaptateur Docker : ${request.profile}`);
    }
    const docker = this.options.docker ?? 'docker';
    const name = `aos-sandbox-${randomUUID()}`;
    // Une variable absente de l'hôte reste indéfinie : spawn n'en transmet aucune (normalizeSpawnArguments).
    const env = Object.fromEntries(CLIENT_ENV.map((key) => [key, this.hostEnv[key]]));
    // stdio : les trois tubes par défaut, sans paramètre (§6) ; detached, pour tuer le groupe entier.
    const child = spawn(docker, dockerArgs(this.options, name, request.command), {
      env,
      detached: true,
      shell: false,
    });
    await new Promise<void>((started, failed) => {
      child.once('spawn', started);
      child.once('error', (error) =>
        failed(new SandboxError('COMMAND_NOT_FOUND', `client Docker introuvable : ${error.message}`)),
      );
    });
    // Un conteneur qui ferme stdin tôt ne fait pas tomber l'hôte qui écrit encore (EPIPE) [E-02].
    child.stdin.on('error', () => undefined);
    const exited = new Promise<SandboxExit>((done) =>
      child.once('exit', (code, signal) => {
        killGroup(child.pid, 'SIGKILL');
        done({ code, signal });
      }),
    );
    return {
      stdin: child.stdin,
      stdout: child.stdout,
      stderr: child.stderr,
      exited,
      stop: async () => {
        // Tuer le client ne tue pas le conteneur : il est retiré par son nom.
        killGroup(child.pid, 'SIGKILL');
        const rm = spawn(docker, ['rm', '-f', name], {
          env,
          shell: false,
          // Stryker disable next-line StringLiteral: équivalent: sans `ignore`, spawn ouvre des tubes que Node vide à la sortie du client, close arrive de même (un enfant en pipe jamais lu émet close).
          stdio: 'ignore',
        });
        await new Promise((removed) => rm.once('close', removed));
        return exited;
      },
    };
  }
}
