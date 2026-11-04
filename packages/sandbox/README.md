# packages/sandbox

Ce paquet contient le port `SandboxRunner`, l'adaptateur srt (`@anthropic-ai/sandbox-runtime` 0.0.81), le proxy d'authentification de l'hôte et l'outil de code isolé de la brique 1a.0 ([`docs/design/platform-v3-srt.md`](../../docs/design/platform-v3-srt.md), §6 et §8). Les preuves sont dans [`docs/design/journal.md`](../../docs/design/journal.md), §14 et §15.

Les scénarios Gherkin du paquet sont dans `features/` (étapes dans `features/steps`) : proxy d'authentification, profil, `code.json`, worktree, contrat `SandboxRunner` sur l'adaptateur en mémoire. Ceux qui lancent de vraies sandboxes srt sont dans `features/sandbox/` à la racine du dépôt, sous macOS comme sous Linux ; ils échouent, sans jamais être sautés, quand srt ne peut pas tourner. Le faux srt sans isolation est `fixtures/no-isolation-srt.mjs`.

## La commande

Depuis un worktree du dépôt, `<repo>/.claude/worktrees/<w>` :

```bash
npm --prefix <checkout du lanceur> run code -- <arguments de claude>
```

À chaque lancement, l'outil fait ceci, dans l'ordre (`code.json`, `profiles/builder.json`) :

1. Il lit l'identifiant Claude de l'hôte dans le trousseau, comme Claude Code sur l'hôte, et le garde en mémoire dans le proxy d'authentification (`src/auth-proxy.ts`). Le proxy est natif, sur `127.0.0.1:<port aléatoire>`.
2. Il crée un dossier temporaire propre à la sandbox, qui contient :
   - le profil srt résolu (en lecture seule) ;
   - `tmp` (`CLAUDE_CODE_TMPDIR`) ;
   - `config` (`CLAUDE_CONFIG_DIR`), avec `settings.json` (`sandbox.enabled: false` et les règles `permissions.deny`, en lecture seule pour la sandbox) et `.claude.json` (onboarding fait, dossier approuvé).
3. Il lance le canari, puis `srt --settings <profil> -- env -u NO_PROXY -u no_proxy claude --bare --settings <config>/settings.json --strict-mcp-config --append-system-prompt-file <worktree>/CLAUDE.md <arguments>`. Sous `--bare`, Claude Code ne charge ni hooks, ni plugins, ni skills, ni serveur MCP, ni mémoire automatique, ni CLAUDE.md : chaque entrée est déclarée dans `code.json` ou le profil, le fichier de prompt système seulement s'il existe à la racine du worktree. La sandbox reçoit seulement `ANTHROPIC_BASE_URL=http://127.0.0.1:<port>`, `ANTHROPIC_API_KEY=<jeton de session aléatoire>` (sous `--bare`, la seule authentification lue avec `apiKeyHelper`) et `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1`, qui retire ce jeton de l'environnement des commandes que Claude Code lance.
4. À la fin, il révoque le jeton de session, ferme le proxy et retire le dossier temporaire.

Aucun secret ne franchit la frontière. Le proxy ne relaie que `POST /v1/messages` et `POST /v1/messages/count_tokens` vers `api.anthropic.com`, avec l'identifiant de l'hôte en `Authorization` ; le jeton de session, lu dans `x-api-key`, ne part jamais vers l'amont. Il répond 403 à toute autre route ou méthode, et 401 sans le jeton de session. Il répond aussi 403 à un corps hors de la politique de `code.json` (`authProxy.policy`, lue par `src/request-policy.ts`) : champ racine non listé, outil typé côté serveur (`web_fetch`…), image ou document dont la source n'est pas dans le corps (URL, fichier), corps au-delà de 64 Mio. Une liste de domaines accorde des capacités : par `api.anthropic.com`, ces champs feraient lire au modèle des données hors de portée de la sandbox. Il écrit une ligne d'`usage` par réponse (modèle, tokens, horodatage, route, type d'erreur, jamais le contenu) dans `~/.local/state/architect-os/usage.jsonl`, créé au démarrage en mode 600 dans un dossier 700 ; un journal qui ne s'écrit plus arrête le proxy, qui répond alors 503 en nommant la cause.

Le proxy ne renouvelle pas l'identifiant OAuth. Le jeton de rafraîchissement change à chaque usage : le renouveler ici déconnecterait l'hôte. Quand l'identifiant expire, le proxy relit le trousseau ; s'il a expiré, il répond 503, et il suffit de lancer une session `claude` sur l'hôte.

Le checkout du lanceur (son code, son `node_modules` avec srt) doit être hors du worktree visé, sinon une session pourrait réécrire srt ou le lanceur pour le lancement suivant. Lancé depuis le worktree qui l'héberge, l'outil refuse de démarrer (`ISOLATION_UNAVAILABLE`). Après fusion, le checkout principal `<repo>` sert de lanceur.

Avec un terminal, la TUI démarre sur les descripteurs du terminal, acceptés seulement si 0, 1 et 2 sont des terminaux. Sans terminal (`-p` dans un script), les flux sont des tubes créés par l'adaptateur.

Le dossier de configuration est recréé à chaque lancement : aucun historique de session ne passe d'un lancement à l'autre (pas de `--resume`).

## Autorisé, refusé

| Domaine          | Profil `builder`                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Écriture         | Le worktree ; `<repo>/.git/worktrees/<w>`, `.git/objects`, `.git/refs`, `.git/logs` ; `~/.cache` ; le dossier de configuration et le `tmp` de la sandbox                                                                                                                                                                                                                                    |
| Écriture refusée | `<repo>/.git/hooks`, `<repo>/.git/config` ; `worktrees/<w>/commondir`, `gitdir` et `config.worktree` ; `refs/heads/main` ; `<worktree>/.claude/settings.json` et `settings.local.json` ; `settings.json` du dossier de configuration ; tout le reste, dont `~/.claude`, `~/.claude.json` et le profil résolu                                                                                |
| Lecture refusée  | `~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.config/gh`, `~/.npmrc`, `~/.netrc` ; `~/.claude` ; `~/.claude.json` ; `~/Library/Keychains` (le trousseau devient introuvable depuis la sandbox)                                                                                                                                                                                                        |
| Réseau           | Le port du proxy d'authentification et `registry.npmjs.org`. Tout le reste reçoit `403` du proxy srt, `api.anthropic.com`, claude.ai et GitHub compris : `git fetch` et `git push` se font depuis l'hôte                                                                                                                                                                                    |
| Terminal         | `allowPty` (macOS) : sans lui, la TUI ne peut pas passer le terminal en mode brut ; `TIOCSTI` reste refusé                                                                                                                                                                                                                                                                                  |
| Règles de refus  | `permissions.deny` du `settings.json` de la session, passé par `--settings` et non inscriptible par la sandbox : `git push`, `git config`, `security`, lecture et écriture des fichiers de secrets, écriture de `.git/hooks` et `.git/config`. Sous `--bare`, aucun hook ne tourne, d'où l'abandon du plugin `builder-guard`. C'est une couche de réduction derrière srt, pas une frontière |

Refus sans repli : srt absent, canari qui lit son fichier secret ou joint le port de l'hôte, chemin de confiance inscriptible, répertoire hors d'un worktree lié, identifiant de l'hôte illisible (`ISOLATION_UNAVAILABLE`, `NOT_A_WORKTREE`).

L'adaptateur Docker (`src/docker-runner.ts`) sert seulement là où srt n'est pas supporté, choisi par configuration, jamais par détection ni bascule : il reprend sans extension les options durcies de l'ancien runner de memory (lecture seule, aucune capacité, pas d'élévation, utilisateur non root, réseau d'exécution seul, mémoire et PID bornés), lance le client Docker dans son propre groupe de processus avec un environnement fermé, et à l'arrêt tue ce groupe et retire le conteneur par son nom. Sa preuve d'équivalence sur un vrai démon s'écrit au premier hôte réel qui en a besoin (§6). Toute sortie lue d'une sandbox passe par `readCapped` (`src/capped.ts`) : au-delà du plafond, `OUTPUT_TOO_LARGE`, et l'appelant arrête la sandbox.

## Risques acceptés (document, §4.2)

| #   | Risque                                                                                                                                                                                                                                                                                                                                                                  | Pourquoi on vit avec                                                                        | Ce qui le borne                                                                                                            | On le rouvre si         |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| R-1 | Outil 1a.0 : le trousseau est lisible depuis la sandbox, donc le jeton Claude et possiblement GitHub ; exfiltration et push possibles par les domaines autorisés (README srt, « Security Limitations »)                                                                                                                                                                 | Outil personnel, poste du propriétaire, simplicité d'usage réel                             | Révocation ; réseau limité à trois fournisseurs ; `denyRead` ciblés ; hooks `PreToolUse` ; ruleset sur `main` comme limite | Tout usage par un tiers |
| R-2 | Tout ce que l'hôte lance dans le worktree exécute du code écrit par la sandbox : `git`, scripts npm, `.claude/settings.json`, `.envrc`. Sous Linux, un hook écrit dans un dépôt imbriqué non nommé persiste [T-34h, T-34i, T-02e, T-02e2]. Les dossiers de session de `~/.claude` restent inscriptibles et partagés avec les sessions hôte hors sandbox (à prouver, §8) | Même risque qu'aujourd'hui avec tout code d'agent ; la lecture du diff précède le lancement | `denyWrite` du dépôt principal ; revue                                                                                     | Un incident réel        |

Ces deux risques sont copiés tels quels du document. Depuis le schéma du journal (§15), ils sont réduits :

- **R-1** : le trousseau est introuvable depuis la sandbox, aucun identifiant n'y entre, et le réseau se limite au proxy et à npm. Il reste deux voies. Une sortie de données par le contenu envoyé au modèle ou par les URL de npm. Et un jeton de session, valable seulement pendant la session et seulement vers `/v1/messages`.
- **R-2** : les dossiers de session ne sont plus partagés avec l'hôte. Le reste de R-2 (code lancé par l'hôte dans le worktree, refs locales autres que `main`) demeure.
