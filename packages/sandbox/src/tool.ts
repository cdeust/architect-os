import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute } from 'node:path';
import { z } from 'zod';
import type { AuthProxyOptions, CredentialSource } from './auth-proxy.js';

/** Description d'un outil lancé sous srt : `code.json` pour l'outil de code de 1a.0. */
export const ToolSchema = z.strictObject({
  description: z.string().min(1),
  /** Gabarit de `profiles/`. */
  profile: z.string().min(1),
  /** argv de base ; les arguments de l'appelant suivent. */
  command: z.array(z.string().min(1)).min(1),
  /**
   * Fichier du worktree visé, relatif à sa racine, passé par `--append-system-prompt-file` s'il existe : sous `--bare`,
   * Claude Code ne lit plus le CLAUDE.md du projet de lui-même.
   */
  systemPromptFile: z
    .string()
    .min(1)
    .refine((file) => !isAbsolute(file) && !file.split('/').includes('..'), {
      message: 'chemin relatif à la racine du worktree, sans ..',
    })
    .optional(),
  /**
   * Fichier du lanceur, relatif à `packages/sandbox`, passé lui aussi par `--append-system-prompt-file` : il ne vient
   * pas du worktree visé, qu'une session précédente a pu écrire. Absent du disque, la session ne démarre pas.
   */
  launcherPromptFile: z
    .string()
    .min(1)
    .refine((file) => !isAbsolute(file) && !file.split('/').includes('..'), {
      message: 'chemin relatif à packages/sandbox, sans ..',
    })
    .optional(),
  /** Proxy d'authentification de l'hôte (`auth-proxy.ts`). */
  authProxy: z.strictObject({
    upstream: z.url({ protocol: /^https$/ }),
    routes: z.array(z.string().min(2).startsWith('^')).min(1),
    betas: z.array(z.string().min(1)),
    /** Politique du corps des requêtes (`request-policy.ts`). */
    policy: z.strictObject({
      bodyFields: z.array(z.string().min(1)).min(1),
      maxBodyBytes: z.number().int().positive(),
    }),
    credentialCommand: z.array(z.string().min(1)).min(1),
    /** `${home}` seul est résolu. */
    usageLog: z.string().min(1),
  }),
});
export type Tool = z.infer<typeof ToolSchema>;

export const parseTool = (raw: unknown): Tool => ToolSchema.parse(raw);
export const loadTool = (file: string): Tool =>
  // Stryker disable next-line StringLiteral: équivalent: sans encodage, JSON.parse lit le Buffer comme sa chaîne UTF-8.
  parseTool(JSON.parse(readFileSync(file, 'utf8')));

/**
 * Les options du proxy d'authentification : celles de `code.json`, le jeton de la session, la source de l'identifiant
 * de l'hôte ; `${home}` du journal d'usage est le répertoire personnel.
 */
export function authProxyOptions(
  tool: Tool,
  sessionToken: string,
  credential: CredentialSource,
): AuthProxyOptions {
  const { upstream, routes, betas, policy, usageLog } = tool.authProxy;
  return {
    upstream,
    routes,
    betas,
    policy,
    sessionToken,
    credential,
    usageLog: usageLog.replaceAll('${home}', homedir()),
  };
}
