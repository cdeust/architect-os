// Les formes des secrets que l'hôte reconnaît dans un texte qu'il garde : la seule liste du dépôt côté TypeScript. Les
// mêmes que la garde des commentaires de la revue de CI (`.github/claude-review/comment-guard.py`, `KEY`), qu'un module
// TypeScript ne peut pas importer : les préfixes des clés d'API et des jetons OAuth d'abonnement de la console Claude
// (`sk-ant-`, `sk-ant-oat`) et des jetons de GitHub
// (https://github.blog/engineering/platform-security/behind-githubs-new-authentication-token-formats/).

/** Le nom d'une forme : il dit ce qui a été reconnu, jamais la valeur. */
export type CredentialShape = 'anthropic-oauth-token' | 'anthropic-key' | 'github-token';

/**
 * Les formes, dans l'ordre où elles sont cherchées : la première qui reconnaît le texte le nomme, le jeton OAuth avant
 * la clé, dont il partage le préfixe.
 */
export const CREDENTIAL_SHAPES: readonly { readonly name: CredentialShape; readonly pattern: RegExp }[] = [
  { name: 'anthropic-oauth-token', pattern: /sk-ant-oat[A-Za-z0-9_-]{8,}/ },
  { name: 'anthropic-key', pattern: /sk-ant-[A-Za-z0-9_-]{8,}/ },
  { name: 'github-token', pattern: /gh[opsur]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}/ },
];

/** Le nom de la première forme de secret que `text` contient, ou `undefined`. */
export function findCredential(text: string): CredentialShape | undefined {
  return CREDENTIAL_SHAPES.find(({ pattern }) => pattern.test(text))?.name;
}
