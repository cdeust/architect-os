# Journal de conception, plateforme v3 sous srt

Historique de [`platform-v3-srt.md`](platform-v3-srt.md) : ce qui a été prouvé, décidé, raté, et pourquoi un mécanisme a disparu. Ajout seulement : on ajoute une entrée datée, on ne réécrit pas. Détail par run et par variable : [`bench/JOURNAL.md`](../../bench/JOURNAL.md). Texte complet d'avant la simplification, commandes et sorties brutes comprises : `git show 0dd97c5:docs/design/platform-v3-srt.md`.

Les commentaires de `bench/` et `bench-sandbox.yml` citent les sections de `0dd97c5` : §4.5 budgets, §9.2 profils, §11.2 broker, §15 briques. Elles se lisent dans ce commit.

Environnement des expériences locales : macOS 27 arm64, Node 26.11.1, srt 0.0.81, MCP SDK 1.32.2, Agent SDK 0.3.312, Claude Code 2.1.312. Aucun appel réel à l'API Anthropic au banc : faux amont local. Le seul appel réel est celui de la vérification de 1a.0, avec le compte du propriétaire.

## 1. Résultats du banc

Commande : `cd bench && npm run bench:sandbox`. CI : `.github/workflows/bench-sandbox.yml`.

| Run | Commit | OS | Tests | pass | fail | residual | finding |
|---|---|---|---|---|---|---|---|
| 41038015293 | `b6fc924` | macOS | 53 | 48 | 0 | 2 | 3 |
| 41038015293 | `b6fc924` | Linux | 53 | 47 | 3 | 0 | 3 |
| 41044838678 | `70a146f` | macOS | 106 | 94 | 1 | 5 | 6 |
| 41044838678 | `70a146f` | Linux | 106 | 92 | 5 | 3 | 6 |

Tout ce qui n'est pas `pass` au run 41044838678 :

| OS | fail | residual | finding |
|---|---|---|---|
| macOS | E-03-huge | T-03f, T-06b, T-42h-base64, T-42h-hex, T-42h-sse-split | T-06-s-TERM, T-06-s-KILL, T-35-pre-fds, T-43d, T-45i, T-45k-ancien |
| Linux | T-02e, T-02e2, T-07-fd0, T-34h, T-34i | T-42h-base64, T-42h-hex, T-42h-sse-split | les mêmes six |

Linux : `ubuntu-24.04`, x64, bubblewrap 0.9.0, ripgrep 14.1.0, sysctl AppArmor à 0. macOS : `macos-latest`, arm64, `sandbox-exec`, sans ripgrep. Postgres 17.11 pour T-45.

| Test | Résultat, une ligne |
|---|---|
| T-41 | Worker entier sous srt (`query()`, handlers, binaire), une couche, faux amont : passe sur les deux OS. Aucune clé dans l'environnement, les sorties ni les fichiers |
| T-38 | Module sous srt, stdio, rappel de la gateway par le proxy, lecture et réseau limités : passe sur les deux OS |
| T-39 | `listen` sous srt : macOS `EPERM` ; Linux accepté, mais l'hôte reçoit `ECONNREFUSED` |
| T-02e, T-02e2 | Linux : un hook et `.git/config` absents au lancement, écrits par la sandbox, persistent sur l'hôte |
| T-02e4, e5, e6 | `denyWrite` nommés : plus rien ne persiste, deux OS |
| T-34h, T-34i | Linux : hook écrit dans un dépôt imbriqué non nommé ou créé après le lancement : persiste. macOS : `EPERM` |
| T-07-fd0 | Linux : un socket d'écoute passé en fd 0 sert depuis la sandbox. macOS `EPERM` ; fd 3 refusé partout |
| T-06 | Groupe tué : 0 descendant. `srt` seul tué par SIGKILL : 10 sur 11 restent (Linux), 2 sur 3 (macOS). T-06b : un enfant `setsid` survit sous macOS |
| T-23 | Broker : corps sans clé à l'amont, hors `/v1/messages` et `GET` : 403, amont direct refusé, deux OS |
| T-42a à g | Autorisation par `mask` et `tlsTerminate` : passe, deux OS. Mécanisme retiré le 30 octobre, résultat conservé pour un éventuel besoin multi-utilisateur |
| T-42h | Clé réfléchie par un amont, réencodée (base64, hex, SSE fragmenté) : atteint le worker. Un retrait en réponse se contourne |
| T-43a, b | Natif étranger sans autorisation : 401, huit formes. Témoin sans autorisation : 200 et clé à l'amont |
| T-43d | Un natif du même uid lit l'autorisation (`/proc/<pid>/environ`, `ps -Eww`) et la rejoue : 200 |
| T-45 | SQL à états, Postgres réel : passe sur le `settle` d'avant DC-3. Témoins de l'ancien SQL : sur-rétention (5 manches sur 6 macOS, 6 sur 6 Linux), `spent 350, reserved -490`, `reserved -969`. Mécanisme retiré, voir §7 |
| T-45-sync | Attend 1 instruction de `settle` ; le texte de `0dd97c5` en a 2 : rouge à `0dd97c5`, avant cette passe |

**Limites du banc.** Broker bufferisé. Répertoires temporaires non nettoyés. Aucun banc Docker. E-03-huge sous macOS est un défaut du banc : `hostile.mjs:5` appelle `process.exit` après un `write` asynchrone de 11 Mio. Le statut attendu est propre à chaque OS ; un changement se signale dans les deux sens.

## 2. Expériences locales, 30 octobre 2026

| ID | Question | Résultat |
|---|---|---|
| E-01 | MCP stdio standard sous srt | 1 000 allers-retours en 41 ms ; 8 Mio passés ; `readHome` `EPERM` |
| E-02 | Rôles inversés, enfant client | 45 ms sous srt, 38 ms sans ; deux tasks sans mélange ; tool hors profil refusé |
| E-03 | Enfant hostile | Faux JSON, ligne de 11 Mio, mort, `_meta.task` forgé : hôte vivant, valeur ignorée |
| E-04, E-05 | Agent SDK et binaire par un broker | `success`, outils et sortie structurée ; l'enfant n'a pas la clé |
| E-06 | Une task tuée | L'autre finit, `success` |
| E-07 | srt dans un conteneur Linux, `--privileged` | Échec : `apparmor_restrict_unprivileged_userns=1`. Sysctl non modifié, porté par le banc CI |
| E-08 | Profils par `plugins` | `model` et `tools` appliqués, corps du prompt non transmis ; `agents` et `systemPrompt` marchent |
| E-09 | Postgres `peer`, socket Unix | 119/119 ; depuis srt `EPERM`, `allowUnixSockets` n'ouvre que sur macOS |
| T-01 | Clés de config | `strictAllowlistt` tolérée, exit 0 ; fichier absent : refus |
| T-02 | `denyRead`, chemins | Voir §1 ; `tmpfs` sous Linux, `EPERM` sous macOS |
| T-03 | Loopback | Direct refusé, port non listé refusé, port listé accepté ; `allowLocalBinding` ouvre tout sous macOS, ignoré sous Linux |
| T-04 | `mask` adversarial | **Échec** : sentinelle dans le corps ou un autre en-tête remplacée par la vraie clé ; amont réfléchissant : fuite. `mask` écarté pour la clé |
| T-09 | Limites | `ulimit` par utilisateur, inapplicable par task sous macOS |
| T-10 | Latence | Surcoût médian 211 ms au lancement |
| T-11 | `claude plugin validate --strict` | Passe avec `description` et `author` |
| T-12, T-13 | Pickles, chargement | Parser confirmé ; `tsx` nécessaire ; un step `SKIPPED` donne `success: true`, exit 0 |
| T-14 | Stryker + cucumber | 12.9.0 seul ; 13.x tronque `stryker-formatter.cjs` à 0 octet. Code en processus enfant : `Survived` |
| T-15, T-16 | `npm ci`, paquets | Lockfile désynchronisé refusé ; `postgresql-17` absent d'`ubuntu-24.04` |
| T-17 | Tests existants | 119 cas, 113 passés, 6 skipped (Postgres) |
| T-19 | Dépôt | Public, 0 ruleset, `main` non protégée |
| T-20 | UPDATE conditionnel | 300 réservations de 10, plafond 1 000 : 100 acceptées ; après règlement à 7, 30 de plus |
| T-21 | Jeton Ed25519 | Rejeu, audience, capacité, expiration refusés. Mécanisme retiré |
| T-22 | Assertion retirée | Scénario vert, 4 mutants survivent |
| T-24 | Environnement même uid | Lisible sous Linux ; autre uid refusé ; voir T-43d pour macOS |
| T-37 | `node --permission` | Refuse `child_process` et les écritures ; pas une frontière selon la doc Node. Retiré |
| T-44 | PR hostile | Steps sans assertion, mutants forcés à `Killed` : **porte verte**, sans forgerie |
| M-01 | Coût de mutation | 1 115 mutants en 51 s ; 474 non tués sur tout le dépôt |

## 3. Échecs de méthode, à ne pas refaire

- E-02 : `write EPIPE` non géré faisait tomber l'hôte ; d'où `stdin.on('error')`.
- T-02 : une première version créait un dossier dans le vrai home, bloquée avant exécution ; refaite avec un `HOME` factice.
- T-06 : sans borne de temps, 120 s bloquées, puis un `pkill -f` a tué le shell du banc, le motif figurant dans sa ligne de commande.
- T-14 : le second message d'erreur pris pour la cause ; la cause était un fichier tronqué à 0 octet dans `node_modules`.
- T-44 : un premier échec pour une autre raison (`tsx` absent) a failli être lu comme un résultat.
- E-09 : un `EPERM` obtenu sur le mauvais nom de socket ne prouvait rien.
- Run 41037109539 : le poste donnait un **faux vert**, `/tmp/claude-501` y existait déjà.
- T-03f : attendu inversé sous Linux. T-41d : la sous-chaîne `srt` trouvée dans le chemin `marketplace-srt`. T-45k et T-45j : ne jouaient pas `reserve(X)` rejoué × `settle(X)`, d'où un « aucun 40P01 » réfuté par la contre-expertise.

## 4. Décisions

| # | Décision | Statut au 30 octobre 2026 |
|---|---|---|
| D-1 | Un conteneur devient un processus srt | Gardée |
| D-2 | Marketplace à la racine | Gardée |
| D-3 | Gateway séparée | Gardée ; jetons signés retirés |
| D-4 | `workflow` si stable, sinon `agent` | Gardée |
| D-5 | Postgres 17 natif | Gardée |
| D-6, a, b, c | Porte = tests, Gherkin, mutation 0 survivant, aucun hash | Gardées |
| D-7 | Baseline reportée, seuils non bloquants | Gardée |
| D-8 | Aucune exécution hors srt, quatre exceptions | Gardée |
| D-9 | `platformd` retiré | Gardée |
| D-10 | Broker seul détenteur de la clé | Gardée |
| D-11 | Un port | Gardée, amendée par DC-1 |
| DC-1 | srt d'abord, Docker là où srt n'est pas supporté, configuration explicite | Gardée ; preuve Docker au premier hôte réel |
| DC-2 | Clone `--no-hardlinks`, bundle, `git fetch`, copie non ouverte, dépôt de réception | **Retirée par le propriétaire** |
| DC-3 | `settle` verrouille `budgets` d'abord | Sans objet : états retirés |
| DC-4 | Workflows épinglés, `main` protégée | Gardée, inscrite en 1a |
| DC-5 | Poste un seul uid, uid dédié sur serveur | Gardée, R-3 |
| DC-6 | `/v1/oauth/*` jamais relayé | Gardée de fait : seul `POST /v1/messages*` passe |
| DC-7 | Résultat attendu par OS, changement signalé | Gardée |
| DC-8 | `bench/` hors production | Gardée dans `CLAUDE.md` ; garde dependency-cruiser retirée |
| DC-9 | Broker OAuth et mode Bearer | **Retirée par le propriétaire.** Clé API obligatoire dès qu'un tiers est servi |
| DC-10 | Outil de code = stage 0 simplifié | Gardée, réduite à `srt --settings builder.json claude` |
| DC-11 | O-31 reportée à D | Gardée, R-13 |
| O-1 | `pull_request_target` | Retrait proposé, à confirmer |
| O-2 | Diff des `.feature` contre le premier parent | Gardée, amendement `CLAUDE.md` en 1a |
| O-3 | « Aucun hash » vise les sorties de build | Gardée |
| O-23 | `CODEOWNERS` | Retrait proposé, à confirmer |
| O-24 | T-04R avec une vraie clé | Gardée, 1b.2 |
| O-26 | Purge des 474 mutants | Retrait proposé, à confirmer |
| O-27, O-28, O-29 | web-scout, db-migrator, `remember` | Gardées |
| O-32 | `node_modules` en lecture seule | **Retirée par le propriétaire** |
| O-33 | `zod` imbriqué de srt | Close : R-12 |
| O-5, O-6, O-13, O-14, O-16, O-19 | CLI srt, `data` natif, macOS en porte, cucumber partout, registre par `data`, clé en fichier 0600 | Closes, reprises dans le document |
| O-4, O-15, O-25, O-30 | Hébergement stage 0, source de `N_base`, sysctl local, repli de T-41 | Sans objet |
| O-7, O-9, O-10, O-11, O-12, O-17, O-21, O-22, O-31 | TLS Caddy, approbations, `plugins/` et `modules/`, BM25, réseau du builder, AppArmor, fusion `describe`, multi-utilisateur, sysctl | Reprises dans les briques ou le modèle de confiance |

## 5. Revues

**Première revue externe.** Frontière srt et multi-utilisateur : intégré. T-04 adversarial : joué, échec. `platformd` concentre les risques : supprimé. Jetons et budgets : mécanismes ajoutés, retirés depuis. Digests entre builds et seuils de mutation par composant : refusés par le propriétaire.

**Deuxième revue externe.** Port du broker non identifiant : accepté. PR à rapport vert sans assertion : jouée, T-44, elle passe. « Agent SDK hors sandbox » : rejeté, D-8.

**Troisième revue externe.** SQL de réservation non atomique : exact, réécrit, retiré depuis. `egress` et accès interne confondus : `internal_access` ajouté, retiré depuis, dérivé de `kind`. Garantie par retrait de la clé : reformulée ; le retrait est retiré. Broker sous srt : refusé, T-07, T-39b.

**Contre-expertise du 30 octobre.** Copie en worktree : hook écrit depuis la copie, exécuté par un `git commit` de l'hôte. Le propriétaire a retiré la réponse DC-2 : risque accepté, R-2, avec `denyWrite`. `git fetch <chemin>` lance `upload-pack` dans la copie. Interblocage `reserve(X)` rejoué × `settle(X)` reproduit. `main` non protégée, 0 ruleset. E-03-huge : défaut du banc. Latence : `docker run` 87 ms, `srt + node` 316 ms, `node` 107 ms. Niche de Docker : hôte Linux à démon rootful et sysctl non modifiable.

**Contradictions C-1 à C-32.** Closes. Celles qui vivent encore dans le document : clé dans une task (C-1) résolue par le broker ; `CLAUDE.md` à amender en 1a pour le diff (C-2), vitest (C-12) et le gateway (C-7) ; `.nvmrc` exact (C-10) ; la porte juge la forme, la revue l'équivalence (C-11) ; `stdio: 'pipe'` donne des sockets `AF_UNIX`, donc « descripteurs créés par l'adaptateur » (C-23). Le détail : `0dd97c5`, §18.

## 6. Test de pérennité, 30 octobre 2026

À rejouer au déclenchement (`gh api repos/<dépôt>`, releases, domaines des auteurs sur 90 jours). Critères : licence open source, gouvernance plurielle, activité, adoption, pas d'éditeur unique.

| Candidat | Verdict | Motif |
|---|---|---|
| Docker, Podman | Retenus pour le port | Podman : CNCF Sandbox, rootless, `podman machine` sur macOS |
| Kata Containers | Retenu si contenu hostile | OpenInfra, VM légères, virtualisation matérielle requise |
| bubblewrap, Landlock | Primitives | Pas de filtre réseau par domaine |
| gVisor, Firecracker, `apple/container` | Écartés | Un seul éditeur. gVisor reste conseillé par Anthropic pour le multi-tenant |
| srt | Échouerait au critère éditeur | Anthropic à 96 % des commits, 14 versions en 90 jours ; d'où le port |

Si srt est abandonné : (a) fork, 23 160 lignes de JS, binaires seccomp, environ une version par semaine à trier ; (b) adaptateur fin sur Seatbelt et bubblewrap, code critique, `sandbox-exec` déprécié. Une évasion ne se voit pas à la relecture : le banc et `escape.feature` restent la preuve dans tous les cas.

## 7. Passe de simplification, 30 octobre 2026

Position du propriétaire : voir l'en-tête du document. Base `0dd97c5`. Méthode : pour chaque mécanisme, risque réel sur le poste puis pour des utilisateurs fiables, coût, valeur.

| Mécanisme | Décision | Risque résiduel accepté |
|---|---|---|
| Gateway, méta-tools, résultat borné, manifeste, `kind`, MCP stdio, un conteneur = un processus srt, quatre natifs, broker, Postgres 17, marketplace racine, nom isolé, compte de la porte | Gardés, intangibles | R-5, R-8 |
| Jetons Ed25519 par appel | Retiré. Stdio avec un seul parent ; rappel par jeton opaque de module | R-10 |
| États de budget, `unknown`, `overdrawn`, `reservation_id`, `budget_transitions` | Retirés. Deux UPDATE, T-20. Interruption = montant retenu | R-9 |
| `capacity.*` | Simplifié : compteur en mémoire de la gateway | Compteur perdu au redémarrage, sandboxes mortes avec lui |
| Autorité de lancement, cinq points | Simplifié : signature fermée, `stdio` constante, une règle d'architecture | R-8 |
| Autorisation de task : `mask`, `tlsTerminate`, `broker.localhost`, `LEASE_OUT_OF_PLACE`, un listener par task | Retirée : un listener, un jeton opaque en clair | R-3, R-4 |
| Retrait de la clé en réponse | Retiré, contournable (T-42h) | R-11 |
| Profils srt multiples | Simplifié : un gabarit et une variable réseau | Moins de finesse par profil |
| `repo-prepare`, `gate-tests` | Retirés | R-2, R-6 |
| Hooks Claude Code `PreToolUse` (1a.0) | Ajoutés à la demande du propriétaire, couche de réduction, jeu minimal à confirmer | Bash obfusqué, code lancé par un script |
| `calls_allowed` | Simplifié : liste à chaque appel, cycle refusé au chargement, sans `parent` | Profondeur non suivie, bornée par timeout |
| Profils de task | Gardés, format Claude Code | |
| Registre | Gardé, table append-only existante | |
| Catalogue de repli | Gardé, boucle existante | |
| `internal_access` | Retiré, dérivé de `kind` | |
| Trois utilisateurs OS sur serveur | Simplifié : un uid | R-3, R-8 |
| `CODEOWNERS` | Retiré, à confirmer | R-6 |
| Mutation étendue et purge des 474 | Retirées, à confirmer ; 0 survivant sur le diff reste | R-6 (T-22) |
| PR sentinelles | Remplacées par des rapports fixtures | R-6 |
| `pull_request_target`, double checkout, T-35, T-50 | Retirés, à confirmer : `pull_request`, comme v3 | R-6 |
| `gate-count.json`, `N_base`, « base déplacée » | Retirés : base comptée au premier parent | La somme devient une identité, la protection est `exécutés = statique` |
| CI multi-OS | Simplifié : tout sur Linux, `features/sandbox/` sur macOS | Un défaut hors sandbox propre à macOS passe la porte |
| Stage 0 : paquet publié, build-1, build-2, promotion, T-18 | Retiré, à confirmer | Pas de garantie de reconstruction au-delà de la porte |
| Pool chaud | Retiré | 211 ms par session |
| `--permission`, tableaux d'audit, §16, §18, O-xx closes | Retirés du document ou journalisés | |
| Briques 2 à 8 | Gardées, le produit reste, une ligne et une preuve | |

Sort des tests :

| Devenir | Tests |
|---|---|
| Vrais scénarios à écrire | `canary`, `spawn` (T-40, T-47, T-52), `broker` (T-23b, T-04R), `budget` (T-20), `gateway` (T-25, T-29, T-30), `arguments` (T-51), `code-front` (T-48), `escape` (T-28, T-03L), `manifest`, `name`, T-49 |
| Serveur, brique D | T-26, T-31, T-09L, profil AppArmor |
| Recherche close, ici seulement | T-01 à T-24, E-01 à E-09, T-37 à T-44, M-01 |
| Retirés avec leur mécanisme | T-14c, T-14d, T-18, T-21, T-27, T-32, T-35, T-35-pre, T-37b, T-42 Bearer, T-43e, T-45, T-45l, T-46, T-50, T-34h-variante |
| Attendent le premier hôte réel | T-41D, T-38D, T-06D, T-34D, T-43D |

**Contrainte relevée.** `bench/src/tests/t45.ts:22-28` lit son SQL dans `platform-v3-srt.md`, entre `### 4.5 Budgets` et `### 4.6`, et un push sur cette branche lance le banc. Le code du banc étant hors de cette passe, le bloc reste en annexe, extraction contrôlée identique à `0dd97c5`. (Annexe retirée le 30 octobre, §12.)

## 8. Vérifications sur le poste, 30 octobre 2026

Faites par un agent en parallèle, reçues du coordinateur, non rejouées ici.

- **Builder.** `srt --settings builder.json claude` fonctionne sur macOS en `-p` avec le compte Claude, un appel réel minimal. Le profil demandé casse `git commit` et permet une évasion prouvée en réécrivant `.git/worktrees/<w>/commondir` ; profil retenu au §8 du document, sous réserve de décision du propriétaire. Le trousseau est lisible depuis la sandbox. TUI à valider au premier lancement.
- **`zod` sous srt.** Non exploitable depuis la sandbox, seul `safeParse` observé, sur la configuration de démarrage ; un override ne corrige rien. Le vrai risque est dans notre code : `WorkerOutputSchema.evidence` sans borne (`tools.ts:82`) et stdout sans plafond (`docker-runner.ts:93-99`), 2 Mo donnant 545 Mo de tas. Inscrit en 1b.1 et 1b.5.
- **Workflows.** Un externe ne lance pas Claude ; la revue n'a jamais produit de revue. Correction minimale inscrite en 1a.
- **Hooks de protection, précision du propriétaire.** « Les hooks de protection sont là pour protéger aussi. » Lu, sans expérience : le profil retenu n'a dans `allowWrite` ni `~/.claude/settings.json`, ni `settings.local.json`, ni `plugins`, ni `hooks` de `~/.claude`. `DANGEROUS_DIRECTORIES` de srt (`sandbox-utils.js`) ne couvre que `.claude/commands` et `.claude/agents`, pas `.claude/settings.json`. Doc Claude Code : le projet a priorité sur l'utilisateur, les hooks se rechargent par surveillance des fichiers, `disableAllHooks` suit cette priorité. **Déduit, à prouver :** un `disableAllHooks: true` écrit dans le worktree couperait les hooks utilisateur ; d'où deux `denyWrite`. **Déduit, à prouver :** `shell-snapshots` et `session-env`, inscriptibles et partagés, pourraient faire exécuter du code par une session hôte hors sandbox.

## 9. Sources Anthropic lues

[Building effective agents](https://www.anthropic.com/engineering/building-effective-agents), [Code execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp), [Writing effective tools](https://www.anthropic.com/engineering/writing-tools-for-agents), [Context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents), [Long-running harnesses](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents), [Best practices](https://code.claude.com/docs/en/best-practices), [Plugins](https://code.claude.com/docs/en/plugins-reference), [Secure deployment](https://code.claude.com/docs/en/agent-sdk/secure-deployment), [Hosting](https://code.claude.com/docs/en/agent-sdk/hosting), [SDK overview](https://code.claude.com/docs/en/agent-sdk/overview) (connexion claude.ai non offerte à des tiers, d'où la clé API), [Cost tracking](https://code.claude.com/docs/en/agent-sdk/cost-tracking), [Sandboxing](https://code.claude.com/docs/en/sandboxing), [Sandbox environments](https://code.claude.com/docs/en/sandbox-environments), [GitHub Actions](https://code.claude.com/docs/en/github-actions), README de srt 0.0.81.

Écart assumé : ces articles conseillent de partir du plus simple ; la plateforme part de l'Agent SDK, par directive de suivre l'amont. Évaluation des tools reportée avec la baseline.

## 10. Audit et décisions du propriétaire, 30 octobre 2026

**Audit en lecture seule de la passe du §7.** La séparation des processus est conservée, mais la gateway a été amputée (DAG d'appels avec profondeur et délai, `trace` et `parent` au registre, `writes_tables` à l'opération) et `manifest-registry` effacé, ses fonctions données à la gateway. Aucun composant de la figure 1 de v3 n'avait de décision écrite du propriétaire pour cela. D'où un intangible : chaque composant de cette figure est un processus séparé, aucune passe ne fusionne ni ne retire un composant sans décision écrite du propriétaire (document, §9, A).

**Correctif validé par le propriétaire, inscrit au document.**

| Point | Avant | Après |
|---|---|---|
| `manifest-registry` | Absent, la gateway lisait les manifestes | Module sous srt, réseau nul ; la gateway ne lit que sa sortie validée. Structurer, Judge, Embedder nommés modules workflow sous srt |
| Rappel d'un module | Jeton opaque de module, `task` déclarée par le module (R-10) | Identifiant d'appel opaque, sans cryptographie, par `tools/call`, relié à {task, parent, profondeur, échéance}, invalidé au retour. R-10 fermé |
| DAG | Profondeur non suivie, bornée par timeout | Profondeur maximale et échéance portées par l'identifiant ; un appel sans modèle est borné par échéance, profondeur, `max_result_tokens`, plafond d'octets |
| Registre | Verdict et tokens | `trace`, `parent`, verdict, tokens par couche |
| `writes_tables` | Au chargement seulement | Aussi à chaque opération, par la gateway, d'après le module appelant |
| Serveur | Un uid pour toute la plateforme | Un uid propre au broker ; gateway et `data` peuvent partager un uid ; R-8 dit ce qu'une gateway compromise lit ou non |
| Concurrence | Compteur en mémoire, non qualifié | Écart au « stateless » de v3 accepté : il ne compte que des enfants qui meurent avec la gateway ; dans `data`, une écriture par appel et une fuite à chaque arrêt brutal. Mort des enfants avec la gateway à prouver (`spawn.feature`) |
| Profils | « La seule variable est le réseau » | Réseau et lectures en plus ; cwd jetable par session, par task, par processus de module |
| Budget | Gateway et broker cités tous deux comme décideurs | La gateway fixe le plafond, le broker exécute. **Remplacé le 30 octobre** : aucun plafond (§12) |

**Décisions du propriétaire.** Remplacent les statuts « à confirmer » du §4, qui restent tels qu'écrits à leur date.

| # | Décision | Statut |
|---|---|---|
| 1 | Profil builder de 1a.0, avec R-1, R-2 et les `denyWrite` sur `.claude/settings.json` et `settings.local.json` du worktree | Adoptée |
| 2 | Jeu minimal de hooks `PreToolUse`, dans un plugin de la marketplace, jamais dans `~/.claude/settings.json`. Tests à la sortie de 1a.0 : chargement, application à la TUI sous srt, impossibilité de couper depuis le worktree, `main` et config git commune intouchables ; sinon risque accepté écrit | Adoptée ; les deux risques du §8 (hook de worktree, dossiers de session partagés) restent à prouver à la même sortie |
| 3 | O-33 `zod` sans override, profil hors chemin inscriptible ; `.max()` sur `evidence`, plafond d'octets sur stdout | Adoptée |
| 4 | Workflows épinglés par SHA, garde sur l'acteur, ruleset sur `main` avec contournement du propriétaire, en 1a | Adoptée |
| 5 | O-1, O-23, O-26 | Retirées ; détection d'assertions affaiblies refusée, reste dans R-6 |
| 6 | Stage 0 publié et `fixpoint.sh` | Retirés ; aucune affirmation de reproductibilité |
| 7 | Base de la porte lue dans le dernier run vert de `main` | Adoptée ; remplace « base comptée au premier parent » du §7 ; `exécutés = statique` conservé |
| 8 | Budgets : table de réservations, `settle` par `DELETE … RETURNING` | Adoptée, à prouver (T-45 rejoué : concurrence, rejeu, interblocage `reserve` × `settle`). **Remplacée le 30 octobre** par les décisions 11 et 12 (§12) |
| 9 | Nettoyage du banc | Tâche inscrite ; ces résultats restent ici |
| 10 | Marque `ai-architect.tools` | Rétablie au titre ; `architect-os` provisoire |

**Règle d'arrêt des revues**, inscrite en tête des décisions ouvertes : consensus quand une revue ne trouve plus ni défaut de correction fonctionnelle ni contradiction avec les décisions du propriétaire ; un risque nommé et accepté ne bloque pas ; un mécanisme supplémentaire proposé n'est pas un défaut.

**Choix de rédaction à relire.** La base de la porte exige que le run vert de `main` porte le SHA du premier parent du commit de merge, faute de quoi l'identité échoue à tort ; la porte est alors rouge et se relance. R-10 garde un résidu nommé : un module compromis qui sert deux appels à la fois peut présenter l'un pour l'autre. L'Orchestrateur de conteneurs de v3 n'est pas un processus séparé : il est le port `SandboxRunner` de la gateway, couvert par D-9 et D-10. L'annexe de `platform-v3-srt.md` reste octet pour octet l'entrée de T-45 jusqu'à la tâche 9.

## 11. Relecture de consensus, e8389ec, 30 octobre 2026

Expériences X-1 à X-7 (`budget-sql.out`), `atomicity.out` et `ddl-check.out`, Postgres 17.9 jetable, SQL extrait du document, rejouables en une commande (`node budget-sql.mjs`). Chaque correction cite la ligne corrigée de `e8389ec`.

| Défaut | Ligne corrigée | Correction | Preuve |
|---|---|---|---|
| D1 (sans objet depuis le 30 octobre, §12) | md 71 « id déjà vu = 23505 » | Contrat sur 0 ligne : `id` présent dans `budget_reservations` = rejeu, absent = refus ; `UNIQUE` sur `id` et colonnes au DDL du §2 | X-1 : rejeu de 60 sur plafond 100 retenu à 60 = 0 ligne sans erreur ; `ddl-check.out` : 0 ligne puis 23505 |
| D2 | md 61, 66, R-8, html 33, 52 | Émetteur du jeton = gateway ; ordre en une règle, association sur le stdin du broker, flèches gateway → broker et broker → data | rapport, D2 |
| D3 | md 174, 190, 199, 203 | Variables = réseau, lectures et écritures en plus ; sortie persistante de `manifest-registry` hors du cwd jetable | rapport, D3 |
| D4 | html 156, 163, aria-label 33 | Étape 7 module → gateway → executor ; « étapes 4 à 10 » ; rappel module → gateway dessiné | rapport, D4 |
| D5 | md 33 | `tasks` MCP et `task.wait` retirés : ouverts dans la v3 (§9, brique 2), non repris ici | rapport, D5 |
| D6 | md 266 | Repli écrit : base = compte statique du premier parent, signalé au rapport, sans porte rouge | rapport, D6 |
| D7 | md 143, 324, 353 | `trace`, `parent` : migration à écrire, brique 2 ; 0003 n'interdit que l'UPDATE d'un run terminé | `data/migrations/0003_runs_immutable.sql` |
| D8 (sans objet depuis le 30 octobre, §12) | §2, 1b.3 | `CHECK` non négatif sur `cap`, `reserved`, `spent`, `amount` ; coût de `settle` négatif refusé par `data` ; scénario en 1b.3 | `atomicity.out` C : `spent` −500, 1 400 acceptés sur 1 000 ; `ddl-check.out` : `CHECK` refuse un coût qui rend `spent` négatif |
| D9 | md 22, 139, 353 | « R-10 fermé » remplacé par usurpation hors des appels actifs refusée, confusion entre appels concurrents acceptée | R-10 |

Objection « CTE non atomique » (revue externe 1), réfutée par expérience : `atomicity.out`, 23505 annule toute l'instruction en autocommit, en transaction explicite et avec SAVEPOINT.

Confirmé sans défaut : X-2 (`settle` rejoué, 50 concurrents ×6 : 1 ligne), X-3 (300×10 sur 1 000 : 100, puis 30), X-4 (facture 150 sur plafond 100 : réservation suivante refusée), X-5 cas I (40P01 sur `reserve` rejoué, rien d'écrit ; cas II non observé), X-7 (1 780 opérations ×6 : 0 interblocage, invariant tenu).

Hors correction, notés : montant par requête non fixé ; X-6, `reserve(X)` rejoué après `settle(X)` recrée la ligne ; précédence `timeout` / `timeout_ms` d'un tool `agent`. Annexe du banc : inchangée, `t45.ts` lit son SQL entre les titres 4.5 et 4.6 et ne lit rien du §2, donc aucun effet sur `t45.ts`.

## 12. Décisions du propriétaire et relecture de 0ef74e6, 30 octobre 2026

Remplacent le §10 décision 8 et la ligne « Budget » du correctif du §10, qui restent tels qu'écrits à leur date ; D1 et D8 du §11 deviennent sans objet.

| # | Décision | Statut |
|---|---|---|
| 11 | Aucun plafond financier. Le coût est mesuré pour la traçabilité et la prévision, rien d'autre : aucune réservation, aucune coupure de task, aucun refus pour raison financière | Adoptée |
| 12 | Bornes opérationnelles : une task peut toujours être interrompue, aucune boucle ne tourne indéfiniment. Délai maximal et nombre maximal d'appels par task (profil client), `maxTurns` pour un agent ; borne atteinte ou annulation par le propriétaire = identifiants et jeton invalidés, groupe srt de la task tué | Adoptée |

**Inscription au document.** Retirés : bloc « Budgets » du §2 (DDL `budgets` et `budget_reservations`, `budget.reserve`, `budget.settle`, contrat sur 0 ligne), `budget_tokens`, `maxBudgetUsd`, `budget.feature`, l'ancien R-9, et « budgets » dans STRIDE D, R-4, R-7, R-8, B, C.8 et 1b.3. R-9 devient l'acceptation écrite de l'absence de plafond. Écrits : mesure du coût par réponse au broker (`usage` avec cache lu et écrit, modèle, task, parent, horodatage), persistée en append-only par `data`, à prouver en 1b.2 et 1b.3 ; bornes opérationnelles, à prouver en 1b.4 ; `max_turns` remplace `budget_tokens` au manifeste ; précédence des `timeout` : le plus court gagne ; « Budget le long du DAG » renommé « Bornes le long du DAG ».

**Transport broker → `data` (C.3).** Le broker est serveur MCP pour la gateway sur son stdio : {jeton, task} lui arrive par un `tools/call` (C.1, md 52 et 66, html 31, 33, 135), le retrait du jeton par un second. Il remonte chaque enregistrement par une notification MCP standard (`notifications/message`, logger `usage`) ; la gateway l'écrit par `data`. Aucun lien broker → `data` : la flèche est retirée de la figure 1. `data` injoignable : la gateway retire les jetons, le broker répond `401`. Hors règle : le dossier persistant de `manifest-registry` est nommé en figure 1 ; la sortie de la brique D nomme le broker lancé sous son uid, stdio conservé (C.2), à prouver.

**Annexe du banc retirée**, ce qui remplace la « Contrainte relevée » du §7. `bench/src/tests/t45.ts` lit le document à l'exécution seulement (`readFileSync`) : les titres absents donnent un SQL vide, et T-45 sort en échec au banc à chaque push sur cette branche jusqu'à la tâche 9, qui le retire comme sans objet. `npm run check` ne lit ni `bench/` ni `docs/design` (inclusions de vitest, références de `tsconfig.json`, `.prettierignore`). Le SQL de l'annexe reste lisible à `0ef74e6`. Sort des tests du §7 : `budget` (T-20) sans objet ; T-20 reste une recherche close.

**Relevé historique de la relecture de `0ef74e6`.** SQL extrait de `0ef74e6`, Postgres 17.9 jetable, 13/13 PASS, une commande (`node budget-sql-v2.mjs`, dossier de relecture hors dépôt). Le mécanisme testé étant retiré, ce relevé ne prouve rien de la conception.

| X | Résultat |
|---|---|
| X-1 | Rejeu de 60 sur plafond 100 retenu à 60 : 0 ligne sans erreur, `id` présent, donc rejeu ; rejeu de 5 : 23505, budget inchangé |
| X-2 | `settle` rejoué, 50 concurrents ×6 : 1 ligne |
| X-3 | 300 réservations de 10 sur 1 000 : 100, puis 30 après règlement |
| X-4 | Facture 150 sur plafond 100 : réservation suivante refusée |
| X-5 | Interblocage `reserve` rejoué × `settle` : cas I (`reserve` victime de 40P01) à `e8389ec`, cas II (`settle` victime de 40P01, `reserve` rejoué 23505) ici ; rien d'écrit dans les deux |
| X-6 | `reserve(X)` rejoué après `settle(X)` recrée la ligne (§11) |
| X-7 | 1 780 opérations ×6 : aucun interblocage, invariant tenu |
| X-8 | `settle(−500)` sur `spent` 0 et `reserve(−10)` : 23514 ; `settle(−50)` sur `spent` 100 passe le DDL (`spent` 50) : seul le refus de `data` à sa frontière fermait |
| X-9 | 50 rejeux concurrents sur plafond atteint : 0 ligne ×50, aucune erreur |
| X-10 | `reserve(B, X, 30)` après `reserve(A, X, 60)`, plafond de B refusant : 0 ligne, `id` présent, « rejeu, succès » sans rien réserver pour B |

## 13. Clôture de la relecture de consensus, 62e5131, 30 octobre 2026

- Clôture de la relecture de 62e5131 (`rapport-62e5131.md`, dossier de relecture hors dépôt) : le document reste à 366 lignes (borne 372), sans code, test ni workflow.
- Défauts bloquants 1 et 2 : M1 et la couche client viennent du hook M1 de la brique 1c, `usage` couvre le broker, M2 agrège les deux ; la gateway passe {jeton, task, parent} au broker (md 66, html 33 et 135).
- Contrats 3 à 5, décidés par le propriétaire : réponse interrompue sans enregistrement (la facture fait foi), indisponibilité de `data` détectée à l'échec du `tools/call` puis jetons réémis, fin par borne ou annulation sans `verify` ni verdict et portée au registre ; hors règle : `timeout_ms`, T-42h et T-43d conservés, `maxTurns` en scénario, tool d'annulation.

## 14. Brique 1a.0, outil de code isolé, 30 octobre 2026

Branche `feat/tool-1a0`, base `b097071`. Poste : macOS 27 arm64, Node 26.11.1, npm 11.20.0, srt 0.0.81 (dépendance de `packages/sandbox`, lockfile), Claude Code **2.1.314**, binaire `~/.local/share/claude/versions/2.1.314` par le lien `~/.local/bin/claude` (le §2 citait 2.1.312). Aucun identifiant lu ni recopié ; un seul appel réel à l'API (C-1), modèle `haiku`, 0,0065 USD selon `total_cost_usd`.

**Montage.** Lanceur : le worktree `tool-1a0`. Worktree visé : `<repo>/.claude/worktrees/probe-1a0`, branche jetable `probe/1a0`, retirés après les preuves avec la branche `probe/other-ref`. Les commandes de preuve passent par l'adaptateur du dépôt, `SrtSandboxRunner.start({ profile: 'builder', cwd: <probe-1a0>, command: ['bash', '-c', <commande>] })`, depuis un pilote hors dépôt ; la commande livrée est `npm --prefix <tool-1a0> run code -- <args>` lancée depuis `probe-1a0`. Chemins abrégés ici : `<repo>`, `~`.

### X-TTY : terminal hérité sous srt

Question : la TUI exige un terminal ; le §6 veut des descripteurs créés par l'adaptateur. Risque nommé : `TIOCSTI`, injection de frappes dans le terminal de l'hôte, lues par le shell natif après la sortie de la sandbox. Pilote pty (hors dépôt) : un `sh` de l'hôte lance la sandbox sur le même terminal, puis lit une ligne.

| Essai | Résultat |
|---|---|
| Témoin sans srt : `ioctl(0, TIOCSTI, "echo INJECTED\n")` puis `read` de l'hôte | `HOST-READ:[echo INJECTED]` : l'injection marche |
| Sous srt, profil sans `allowPty` | `PermissionError: [Errno 1] Operation not permitted`, `HOST-READ:[]` |
| Sous srt, `allowPty: true` | Idem, `EPERM`, `HOST-READ:[]` |
| Mode brut (`tty.setraw(0)`) sans `allowPty` | `setraw-err (1, 'Operation not permitted')` : la TUI ne peut pas démarrer |
| Mode brut avec `allowPty: true` | `setraw-ok` |

Décision d'implémentation, à confirmer par le propriétaire : `allowPty: true` au profil builder (seul ajout au profil C) ; le port garde `stdio` constant en tubes ; l'outil interactif, hors du port, hérite des descripteurs 0 à 2 seulement si tous trois sont des terminaux (`isatty`), sinon tubes. srt hérite lui-même ses descripteurs (`dist/cli.js`, `sandboxedStdio`).

### Preuves du profil builder

`main` avant et après : `fbf100a`, inchangée. Sommes de `<repo>/.git/config`, `commondir`, `gitdir`, `<worktree>/.claude/settings.json`, `~/.claude/settings.json` et liste de `.git/hooks` : inchangées.

| Preuve | Commande sous srt | Résultat | Sortie |
|---|---|---|---|
| Canari, lecture | `canary-probe.mjs` sur un fichier secret ajouté en `denyRead` | refusée | test `srt adapter on this host` vert ; un faux srt sans isolation est refusé : `ISOLATION_UNAVAILABLE: canari : lecture allowed, connexion allowed` |
| Canari, réseau | connexion au port que l'hôte écoute sur `127.0.0.1` | refusée | idem |
| Commit | `git add probe.txt && git commit -qm "probe: commit under srt"` | réussi, exit 0 | `probe: commit under srt` ; sur stderr `Unable to create '<repo>/.git/packed-refs.lock'` (maintenance après commit, sans effet sur le commit) |
| Évasion par `commondir` | `printf '/tmp/elsewhere\n' > <repo>/.git/worktrees/probe-1a0/commondir` | refusée | `Operation not permitted` |
| `gitdir`, `config.worktree` | écriture directe | refusées | `Operation not permitted` |
| `.git/hooks` | `printf '#!/bin/sh\n' > <repo>/.git/hooks/pre-commit` | refusée | `Operation not permitted` |
| `.git/config` | `>> <repo>/.git/config` ; `git config q.q 1` | refusées | `Operation not permitted` ; `could not lock config file` |
| `main` | `git update-ref refs/heads/main HEAD` | refusé | `couldn't set 'refs/heads/main'` |
| `main` | écriture directe de `refs/heads/main` | refusée | `Operation not permitted` |
| `main` | `git pack-refs --all` | refusé | `Unable to create '<repo>/.git/packed-refs.lock'` |
| `main` | `git branch -f main HEAD` | refusé **par git**, pas par srt | `cannot force update the branch 'main' used by worktree at '<repo>'` ; tient parce que `main` est extraite au checkout principal |
| Autre branche | `git branch probe/other-ref HEAD` | **réussi** | `.git/refs` est inscriptible : toute ref locale autre que `main` peut être déplacée (résidu, ci-dessous) |
| Réglages utilisateur | `: >> ~/.claude/settings.json` ; `: >> ~/.claude.json` ; `~/.claude/plugins/.aos-probe` | refusés | `Operation not permitted` |
| Réglages du worktree | `printf '{"disableAllHooks":true}' > <worktree>/.claude/settings.json`, idem `settings.local.json` | refusés | `Operation not permitted` |
| Renommer `.claude` | `mv <worktree>/.claude <worktree>/.claude-moved` | refusé | `Operation not permitted` |
| Hors worktree | `: > <repo>/.aos-probe…` ; `: > ~/.aos-probe-home` | refusés | `Operation not permitted` |
| Profil résolu | `: > $CLAUDE_CODE_TMPDIR/../profile.json` ; `$CLAUDE_CODE_TMPDIR/x` | refusé ; tmp inscriptible | `Operation not permitted` ; `tmp-ok` |
| Secrets | `ls ~/.ssh` | refusé | `Operation not permitted` |
| Réseau | `curl https://example.com` ; `registry.npmjs.org` ; `api.anthropic.com` | 403 ; 200 ; joint (404 sur `/`) | `CONNECT tunnel failed, response 403` |
| `npm ci` | `npm ci --ignore-scripts` dans le worktree | réussi, 70 s | `npm-exit=0`, cache dans `~/.cache/npm` (`npm_config_cache` du gabarit) |
| Environnement | `env` | liste fermée | aucune variable `ANTHROPIC_*`, `CLAUDE_CONFIG_DIR` ni `CLAUDE_CODE_*` hormis `CLAUDE_CODE_TMPDIR` ; variables de proxy posées par srt |
| Dossiers de session | `: > ~/.claude/shell-snapshots/.aos-probe` ; idem `session-env` | **écrits** | voir R-2 ci-dessous |
| Lanceur dans le worktree visé | `npm run code -- --version` depuis `tool-1a0` lui-même | refusé | `ISOLATION_UNAVAILABLE: chemin de confiance inscriptible par la sandbox : <repo>/.claude/worktrees/tool-1a0/node_modules/@anthropic-ai/sandbox-runtime/dist/cli.js` |
| Checkout principal | `npm --prefix <tool-1a0> run code -- --version` depuis `<repo>` | refusé | `NOT_A_WORKTREE: dépôt principal : lancer depuis un worktree lié` |
| Lancement | `npm --prefix <tool-1a0> run code -- --version` depuis `probe-1a0` | réussi | `2.1.314 (Claude Code)` |

### TUI au premier lancement

`npm --prefix <tool-1a0> run code` depuis `probe-1a0`, dans un pty 120×40, observation seule pendant 20 s, rien écrit sur le pty, puis `SIGTERM` au groupe. Le premier lancement a perdu sa sortie : le pilote a levé `PermissionError` sur un second `killpg` avant d'imprimer ; relancé une fois. Sortie du second : la TUI est vivante après 20 s et affiche le dialogue de confiance du dossier, « Quick safety check: Is this a project you created or one you trust? », qui signale les trois permissions pré-approuvées de `.claude/settings.json`, choix par défaut « No, exit ». **Dialogue non accepté**, à la main du propriétaire. L'invite n'est donc pas atteinte. Attendu à observer par le propriétaire : l'acceptation s'écrit dans `~/.claude.json`, que le profil refuse ; le dialogue peut revenir à chaque lancement. Après arrêt : aucun processus `sandbox-exec` restant, aucun dossier `aos-sandbox-*` restant.

### C-1 : l'appel réel, hooks et `disableAllHooks`

Préparation sur l'hôte : `{"disableAllHooks": true}` écrit dans `<worktree>/.claude/settings.local.json` (fichier ignoré par git), pour simuler une écriture que le `denyWrite` aurait laissé passer. Commande, depuis `probe-1a0` :

```
npm --prefix <tool-1a0> run --silent code -- -p --model haiku --max-turns 4 --output-format stream-json --verbose \
  --allowedTools "Bash(git push:*)" "Bash(security:*)" -- "Use the Bash tool to run exactly these two commands, ... \
  1) git push --dry-run aos-nowhere main 2) security find-generic-password -s aos-probe-nonexistent"
```

Commandes choisies sans effet si un hook échoue : remote inexistant, élément de trousseau inexistant.

| Fait | Sortie |
|---|---|
| Lancement en `-p` sous srt, compte du propriétaire | `success`, 3 tours, `apiKeySource: none` |
| Plugin chargé | `init.plugins` contient `builder-guard@inline` (`--plugin-dir`) |
| Hook `git push … main` | **non appliqué** : la commande a tourné, `fatal: 'aos-nowhere' does not appear to be a git repository` |
| Hook `security find-generic-password` | **non appliqué** : `SecKeychainSearchCopyNext: The specified item could not be found in the keychain.` Le trousseau est joint depuis la sandbox : R-1 confirmé |

### X-HOOK : cause racine, sans appel à l'API

Même lancement, profil `builder` sans réseau (copie hors dépôt, `allowedDomains: []`), donc aucune requête ne sort ; plugin témoin hors dépôt dont le hook `SessionStart` crée un fichier dans le worktree ; `--debug-file` dans le worktree.

| Essai | Fichier témoin | Journal de debug |
|---|---|---|
| B : sans `disableAllHooks` | absent | `Hook failed to run (SessionStart:startup): EPERM: operation not permitted, mkdir '~/.claude/plugins/data/aos-marker-inline'` |
| C : dossier `~/.claude/plugins/data/aos-marker-inline` créé sur l'hôte avant, retiré après | **créé** | `(plugin aos-marker@inline) finished with status 0` |
| A' : comme C, plus `disableAllHooks: true` dans `settings.local.json` du worktree | absent | hooks enregistrés, non lancés |

**Cause racine.** Claude Code 2.1.314 crée `~/.claude/plugins/data/<plugin>-<source>` avant chaque hook de plugin ; le profil C refuse toute écriture sous `~/.claude/plugins` ; le hook échoue, en erreur non bloquante, et l'appel d'outil passe. Un hook qui ne peut pas tourner laisse passer (fail-open). Les hooks et serveurs MCP des plugins utilisateur du propriétaire échouent de même sous la sandbox (`hypermnesia-mcp-viz-synced`).

**Prouvé par A'.** Un `disableAllHooks` écrit dans les réglages du worktree coupe les hooks du plugin. Le `denyWrite` de `<worktree>/.claude/settings.json` et `settings.local.json` est donc nécessaire, et il tient (tableau ci-dessus, renommage de `.claude` compris).

Arrêt sur ce point, comme prévu par la consigne : aucun chemin ouvert, aucun contournement livré. Options au propriétaire : (a) le lanceur crée sur l'hôte le dossier de données vide du plugin avant le lancement, aucun chemin ouvert, mais nom interne `<plugin>-inline` de Claude Code (prouvé par C) ; (b) `allowWrite` limité à `~/.claude/plugins/data/builder-guard-inline`, rien n'y est exécuté ; (c) plugin installé depuis la marketplace et dossier créé par une première session hôte.

### Résidus constatés

- **R-2, dossiers de session.** La sandbox crée et modifie des fichiers dans `~/.claude/shell-snapshots` et `session-env`, où vivent les instantanés de shell des sessions hôte. Qu'une session hôte exécute un instantané modifié n'est pas prouvé : il faudrait une session hôte avec un appel réel, hors du budget d'un appel. Le §8 du document dit que ces dossiers sortent alors de `allowWrite` : décision au propriétaire, à éprouver avec la TUI.
- **Refs locales.** Toute branche locale autre que `main` est déplaçable depuis la sandbox (`.git/refs` inscriptible), dont `feat/*` d'autres worktrees ; le ruleset ne protège que `main` sur GitHub.
- **Réglages utilisateur.** Les hooks, plugins et serveurs MCP de `~/.claude/settings.json` du propriétaire se chargent dans la sandbox (lecture permise) ; leurs écritures dans `~/.claude/plugins/data` échouent.

### Tests et garde

`npm run check` : 204 tests, 198 passés, 6 ignorés (Postgres) ; base 119 (113 passés, 6 ignorés), 85 ajoutés. Le contrat du port tourne contre l'adaptateur en mémoire partout, contre srt sous macOS seulement (`describe.runIf`) ; les refus sans isolation (srt absent, faux srt, checkout principal, pas de terminal) tournent partout. Garde dependency-cruiser : `child_process` et `@anthropic-ai/sandbox-runtime` seulement dans `packages/sandbox`, exception nommée `docker-runner.ts` jusqu'à 1b.1, trois fixtures. `claude plugin validate --strict` : marketplace et plugin, `Validation passed`.

### Échecs de méthode

- Le temporaire de la sandbox était compté comme chemin de confiance alors qu'il contient le `tmp` inscriptible : refus à tort, corrigé (seul `profile.json` est contrôlé).
- srt absent levait `ENOENT` au lieu de `ISOLATION_UNAVAILABLE` : corrigé, test ajouté.
- Pilote de preuve en `.ts` sous `tsx` : `await` de premier niveau refusé en sortie CJS ; renommé `.mts`.
- Premier lancement de la TUI : sortie perdue (voir plus haut).
- C-1 seul ne départageait pas `disableAllHooks` et l'échec du hook : X-HOOK, sans réseau, a départagé.

## 15. Brique 1a.0, aucun secret dans la sandbox, 30 octobre 2026

**Décision du propriétaire.** Elle remplace les options (a), (b) et (c) du §14 et l'usage du compte par le trousseau. Claude Code tourne sous srt avec un dossier de configuration propre et un jeton de session. Il ne joint le modèle que par un proxy d'authentification natif, seul détenteur de l'identifiant de l'hôte.

**Sources lues.** Pages code.claude.com `env-vars`, `claude-directory`, `authentication`, `hooks` (`onFailure`), `plugins/org` (dossier de semences), `sandbox-environments`, et `vinta/blackwall` (`src/adapters/claude.js`). `CLAUDE_CONFIG_DIR` déplace aussi `.claude.json` et les données des plugins. `CLAUDE_CODE_OAUTH_TOKEN` passe avant le trousseau. `onFailure: "block"` se pose par hook (2.1.295 et plus).

### Mise en œuvre

| Élément | Choix |
|---|---|
| `CLAUDE_CONFIG_DIR` | Recréé **à chaque lancement** dans le dossier temporaire de la sandbox (le plus simple : aucun état d'un lancement à l'autre, rien à empoisonner). Le lanceur écrit `settings.json` (`sandbox.enabled: false`, protégé par `denyWrite`) et `.claude.json` (`hasCompletedOnboarding`, `hasTrustDialogAccepted` pour `<repo>` et le worktree), à partir du gabarit (`files`). Pas d'historique entre lancements |
| `denyRead` | Ajoutés : `~/.claude`, `~/.claude.json`, `~/Library/Keychains` |
| `allowWrite` | Retirés : les dossiers de session de `~/.claude`. Ajouté : le dossier de configuration |
| Réseau | `127.0.0.1:<port du proxy>` et `registry.npmjs.org`. Retirés : `api.anthropic.com`, claude.ai, statsig, GitHub. GitHub n'est pas nécessaire : le lockfile ne résout que sur `registry.npmjs.org` (491 entrées), et `fetch` et `push` se font depuis l'hôte |
| Environnement | `ANTHROPIC_BASE_URL=http://127.0.0.1:<port>`, `CLAUDE_CODE_OAUTH_TOKEN=<jeton de session>` et `CLAUDE_CONFIG_DIR`, posés depuis des variables du lanceur. Le schéma refuse toute valeur littérale pour ces noms. `NO_PROXY` est retiré dans la sandbox (`env -u`, après srt) |
| Proxy | `src/auth-proxy.ts`. Lecture par `/usr/bin/security find-generic-password -s "Claude Code-credentials" -w` (`code.json`), en mémoire seulement, relue à l'approche de l'expiration. Seuls `POST /v1/messages` et `POST /v1/messages/count_tokens` passent ; le proxy ajoute `anthropic-beta: oauth-2025-04-20`. Une ligne d'`usage` par réponse dans `~/.local/state/architect-os/usage.jsonl` |
| builder-guard | `--plugin-dir` depuis le checkout du lanceur (hors écriture, contrôlé), `onFailure: block`. **Écart** : pas de `CLAUDE_CODE_PLUGIN_SEED_DIR=~/.claude/plugins`. Semer builder-guard exige de l'installer sur l'hôte, ce qui modifie `~/.claude/settings.json` et l'applique à toutes les sessions hôte. Et rouvrir `~/.claude/plugins` en lecture exposerait les caches et les données des plugins du propriétaire |
| CLAUDE.md, skills, agents, commands | Ceux du dépôt sont dans le worktree, donc lus comme réglages de projet : aucune copie. Ceux de `~/.claude` du propriétaire ne sont plus lus |
| Renouvellement OAuth | **Non fait dans le proxy.** Le jeton de rafraîchissement change à chaque usage, et un renouvellement ici déconnecterait l'hôte (preuve f). Le proxy relit le trousseau ; une session `claude` de l'hôte renouvelle l'identifiant. Un identifiant expiré donne 503 |

Montage des preuves : lanceur `tool-1a0`, worktree visé `<repo>/.claude/worktrees/probe-1a0b` (branche jetable `probe/1a0b`, retirés après). Chemins abrégés : `<repo>`, `~`.

### Preuves

| # | Preuve | Résultat | Sortie |
|---|---|---|---|
| a | `srt --settings <profil résolu> -- node -e "process.stdin.setRawMode(true)"` dans un pty | `allowPty: true` : accepté ; sans `allowPty` : refusé | `setRawMode-ok 120` ; `setRawMode-err EPERM` |
| b | Éléments jetables sur l'hôte (`security add-generic-password -s srt-probe`, `git credential-osxkeychain store` pour `srt-probe.invalid`), lus par trois chemins | voir détail | voir détail |
| b, hôte | lecture des deux éléments | les deux rendent le secret | `exit=0 secret-returned=True` |
| b, srt sans `denyRead` du trousseau (témoin) | lecture des deux éléments | les deux rendent le secret | `exit=0 secret-returned=True` |
| b, profil builder | lecture des deux éléments | **refusée** | `find-generic-password` : `exit=44 SecKeychainSearchCopyNext: The specified item could not be found in the keychain.` ; `credential-osxkeychain get` : `exit=0 secret-returned=False` |
| b, nettoyage | suppression des deux éléments | supprimés | `find-*-password` : `exit=44` |
| c | Appel réel C-2 : `git push origin main` | refusé par builder-guard | `builder-guard [push-main]: git push to main is refused` |
| c | C-2 : `security find-generic-password -s aos-probe-nonexistent` | refusé par builder-guard | `builder-guard [keychain]: Keychain access is refused` |
| c | Dossier de données du plugin | créé sous notre `CLAUDE_CONFIG_DIR`, jamais sous `~/.claude` | `ls $CLAUDE_CONFIG_DIR/plugins/data` donne `builder-guard-inline` ; liste de `~/.claude/plugins/data` identique avant et après |
| d | `ls ~/.claude/shell-snapshots`, `ls ~/.claude/plugins/data` avant et après trois lancements (TUI, `-p`, TUI) | identiques | sommes égales, 4 instantanés |
| d | `shasum ~/.claude.json` | **différente, sans lien avec la sandbox** : une veille de 180 s sans aucune sandbox l'a vu changer à +35 s | des sessions Claude Code de l'hôte l'écrivent. La sandbox ne peut ni le lire ni l'écrire : `cat ~/.claude.json` et `ls ~/.claude` donnent `Operation not permitted` |
| d | Dialogue de confiance | absent aux deux lancements de la TUI | invite `❯` affichée directement |
| e | Réponse de Claude Code sous srt via le proxy (C-2, `-p --model haiku`) | réussie | `success`, 8 tours, 0,0077 USD ; `apiKeySource: none` ; 8 lignes d'`usage` `status 200, route /v1/messages, model claude-haiku-5-5` |
| e | Environnement : pilote sous le profil | seulement le jeton de session, l'URL du proxy et le dossier de configuration | `base=http://127.0.0.1:<port> token=<jeton de session>` ; aucune autre variable `ANTHROPIC_*` ni `CLAUDE_CODE_*`. Dans C-2, le Bash de Claude Code ne voit même pas `CLAUDE_CODE_OAUTH_TOKEN`, que Claude Code retire de l'environnement de ses commandes |
| e | `curl -X POST https://api.anthropic.com/v1/messages` sous le profil | refusé par srt | `CONNECT tunnel failed, response 403` ; idem claude.ai, github.com ; `registry.npmjs.org` donne 200 |
| e | Proxy réel (`startAuthProxy`, configuration de `code.json`), jeton valide | `GET /v1/messages`, `POST /v1/models`, `POST /api/oauth/token`, `POST /v1/messages/batches` refusés | `403` ×4, identifiant jamais lu (`credential reads: 0`) |
| e | Proxy réel, sans jeton ; jeton révoqué ; proxy fermé | refusés | `401` ; `401` ; `ECONNRESET` |
| e | Jeton de C-2 rejoué après la session, sur son port | refusé | `Failed to connect to 127.0.0.1 port 53584` |
| f | `claude auth status` de l'hôte (somme), `~/.claude/.credentials.json` | identiques avant et après | somme égale ; fichier absent avant et après (#104359 non reproduit) |
| g | Bash dans la sandbox (C-2) | fonctionne du premier coup | 5 commandes exécutées, aucun `dangerouslyDisableSandbox` dans les entrées d'outil |
| h | TUI en pty, deux lancements, observation seule | invite affichée sans dialogue de confiance ni d'onboarding | `Claude Code v2.1.314 · Sonnet 5.5 · Claude API … ❯ ⏵⏵ auto mode on` ; aucun dialogue accepté ; après arrêt : aucun `sandbox-exec`, aucun dossier `aos-sandbox-*` |
| | Profil, sous srt | inchangé par rapport au §14 | commit réussi ; `commondir` : `Operation not permitted` ; `update-ref refs/heads/main` : refusé ; `settings.json` de la configuration : `Operation not permitted` ; `.claude.json` et `plugins/data` de la configuration inscriptibles |

### Observations

- **Appel au démarrage de la TUI.** Chaque lancement de la TUI envoie une requête `POST /v1/messages` par le proxy avant toute saisie. Elle a reçu `429 rate_limit_error` deux fois (`usage.jsonl`), l'appel `-p` passant ensuite en `haiku`. Cause probable : une vérification de quota sur le modèle par défaut. Hors de l'outil ; le propriétaire verra si la session interactive s'en ressent.
- **Bandeau de la TUI.** « Claude API » (base URL et jeton), « Auto-update failed » (réseau fermé), « gh auth login for PR status » (pas de GitHub) : informatifs.
- **Témoin du trousseau, premier essai.** L'élément Internet créé par `security` puis lu par `git credential-osxkeychain` sur l'hôte a bloqué : le trousseau demandait une autorisation d'accès pour cette application. Le processus a été tué au bout de 90 s, **sans accepter le dialogue**. L'essai a été refait avec un élément créé par `git credential-osxkeychain store` lui-même et un délai de 20 s par commande (tableau b).
- **`onFailure: block`.** Il est posé et validé (`claude plugin validate --strict`, schéma du test), et les hooks tournent et refusent (c). Le refus quand un hook ne peut pas tourner n'a pas été observé en réel. Il se prouvera au premier appel réel de 1a, dans un scénario de la porte.

### Résidus

- Le jeton de session vit dans l'environnement du processus `claude`. Un processus de la sandbox qui le lit (même uid) peut dépenser par le proxy, pendant la session et vers `/v1/messages` seulement. C'est R-4 appliqué à 1a.0.
- Sorties possibles : le contenu envoyé au modèle (R-5), et les URL vers `registry.npmjs.org` (sans jeton npm, aucune publication).
- Le reste de R-2 tient : code lancé par l'hôte dans le worktree, refs locales autres que `main` déplaçables.
- L'outil lit l'identifiant de l'hôte à chaque lancement. Hors session, rien ne le détient en dehors du trousseau.

### Tests

`npm run check` est vert : 224 tests, 218 passés, 6 ignorés (Postgres). Le §14 en comptait 204. Ajouts :
- `test/auth-proxy.test.ts` : faux amont, faux identifiant ; relais, remplacement de l'`Authorization`, `usage` sans contenu, 401, 403 ×6, révocation, 503 sans détail, identifiant expiré ou illisible.
- Gabarit : réseau limité au proxy, jeton littéral refusé, base URL vers un autre hôte refusée, fichiers hors `allowWrite` refusés.
- `code.json` : amont non HTTPS et route non ancrée refusés.
- Hooks : `onFailure: block` exigé par le schéma.

## 16. Brique 1a construite dans l'outil, 30 octobre 2026

Branche `feat/gate-1a`, créée depuis `origin/feat/marketplace-srt` (`e525b50`), worktree `<repo>/.claude/worktrees/gate-1a`. Méthode imposée par le propriétaire : le code de 1a s'écrit **dans l'outil de code isolé de 1a.0**, preuve d'usage. Chaque étape est un appel `-p` depuis le worktree : `npm --prefix <repo>/.claude/worktrees/marketplace-srt run code -- -p --output-format json --permission-mode bypassPermissions -- "<tâche>"` (lanceur hors du worktree visé). L'orchestrateur écrit le prompt, relit `git diff`, rejoue sur l'hôte ce que la sandbox interdit, et commite depuis l'hôte. Usage lu dans `~/.local/state/architect-os/usage.jsonl` (lignes ajoutées pendant l'appel) et coût dans le `total_cost_usd` du résultat JSON. Les prompts et sorties brutes restent hors dépôt (dossier de travail de l'orchestrateur).

### Constats de départ

- **Compte de base : 224, pas 119.** Le document (§8, E-09, T-17) dit 119 cas : c'est le compte d'avant 1a.0. `vitest run` à `e525b50` : 26 fichiers, 224 tests, 218 passés, 6 ignorés (`describe.skipIf(TEST_DATABASE_URL)`), plus `describe.runIf(darwin)` sur l'adaptateur srt réel. 1a.0 a ajouté 105 cas (`packages/sandbox` 54, `builder-guard` 51). Les 224 sont migrés ; le tableau par fichier est plus bas.
- **Actions épinglées, SHA vérifiés par l'API GitHub** : `actions/checkout` `d23441a…` = `v6.1.0` ; `actions/setup-node` `949feb2…` = `v7.1.0` ; `anthropics/claude-code-action` `6d5ae52…` = `v1` (commit du 30 octobre 2026, « bump Claude Code to 2.1.314 ») ; `actions/upload-artifact` `ea165f8…` = `v4.6.2` (déjà au banc).
- **Postgres de la suite** : Postgres 17.9 Homebrew, pgvector présent (`$(pg_config --sharedir)/extension/vector.control`).

### Appels à l'outil

| # | Étape | Prompt, résumé | Durée | Réponses | Tokens (entrée, sortie, cache lu, cache écrit) | Coût | Obstacle |
|---|---|---|---|---|---|---|---|
| 0 | essai | `node --version`, `git status` | 9 s | 2 × 200, sonnet-5-5 | 4 ; 121 ; 20 748 ; 20 845 | 0,087 USD | Premier essai perdu côté orchestrateur : chemin du prompt relatif après `cd` (échec de méthode, aucun appel parti) |
| 1 | 1a.2 A | `cucumber.mjs`, World, hook `@postgres` (initdb, socket Unix, aucun TCP), migration de `packages/contracts` (7) et `data` (32) | 598 s | 36 × 200, sonnet-5-5, 45 tours | 72 ; 44 578 ; 2 355 475 ; 87 541 | 1,03 USD | Dans la sandbox : `listen` EPERM (T-39b, 3 scénarios HTTP), Postgres ne démarre pas (`shmget … Operation not permitted`, 6 lignes `@postgres`). Rejoués sur l'hôte. L'agent a fait `git rm` (index de l'hôte) malgré la consigne « ne pas toucher à .git » : consigne précisée ensuite |
| 2 | 1a.3 | `tools/test-gate` : règles du §7 (identité de pickle, steps tous `PASSED`, une tentative, exécutés = statique, exécutés = base + ajoutés − supprimés avec repli écrit, mutation sur le périmètre du diff étendu par `coveredBy`), `gate.json` descriptif, fixtures réelles, `npm run gate`, `stryker.config.mjs` ; correctif de la locale du hook Postgres | 4 465 s | 150 × 200, **opus-5-5**, 10 tours | 308 ; 210 055 ; 32 434 543 ; 364 195 | 13,60 USD | Stryker ne démarre pas dans la sandbox : son serveur de journalisation fait `net.listen`, EPERM ; l'agent l'a fait tourner avec une cale locale non commitée pour mesurer `coveredBy` (rempli par le runner cucumber : identifiants remappés, `testFiles` par `.feature`). Deux runs Stryker sur `tools/test-gate/src` de 15 min et 13 min dans la sandbox |
| 3 | 1a.2 B | Migration de `gateway` (25) et `services/memory` (38) ; contrats de port en `Scenario Outline`, une ligne par adaptateur | 519 s | 35 × 200, sonnet-5-5, 56 tours | 72 ; 53 338 ; 2 916 061 ; 120 709 | 1,31 USD | `listen` EPERM (2 scénarios `internal-http`) ; `npm test` (vitest) bloqué dans la sandbox sur `test/integration`, arrêté par l'agent. Hôte : 201/201 |
| 4 | 1a.2 C | Migration de `packages/sandbox` (54) ; scénarios srt réels dans `features/sandbox/` (5), `runIf(darwin)` retiré ; correctif `.gitignore` (`/reports/` ancré : les rapports fixtures de la porte n'avaient jamais été commités) | 1 008 s | 41 × 200, sonnet-5-5, 49 tours | 82 ; 49 134 ; 3 369 781 ; 113 019 | 1,28 USD | srt imbriqué impossible et `listen` EPERM : 15 scénarios rejoués sur l'hôte. Hôte : 255/255 après arrêt de 14 Postgres orphelins (voir « Rejeu sur l'hôte ») |
| 5 | 1a.2 D | Migration de `test/` (68) vers `features/` ; veilleur des Postgres jetables (durée de vie liée au processus de test) et son scénario SIGKILL ; contrôle du terminal injectable dans l'adaptateur srt ; `concurrency: 4` pour Stryker | 1 657 s | 53 × 200, sonnet-5-5, 74 tours | 108 ; 44 392 ; 3 976 415 ; 99 917 | 1,24 USD | `.claude/agents/*.md` refusés en écriture dans la sandbox (EPERM, `DANGEROUS_DIRECTORIES` de srt), et `.claude/settings.json` est en `denyWrite` (profil builder) : **fait à la main depuis l'hôte**, deux agents de revue et la règle `npx vitest *` → `npx cucumber-js *`. `initdb` bloque dans la sandbox ; run complet abandonné par l'agent après 10 min. Hôte : 324/324 |
| 6 | 1a.6 | vitest retiré (dépendance, `vitest.config.ts`) ; typecheck et format en scénarios (`features/repository/`) ; `CLAUDE.md` amendé (O-2, `bench/` hors production, garde d'import, briques en Gherkin, refus de revue) ; `docs/testing.md` réécrit | 1 352 s | 28 × 200, sonnet-5-5 | 58 ; 17 368 ; 1 435 580 ; 62 672 | 0,57 USD | Le `npm run check` de l'agent a dépassé le délai de son outil Bash (Postgres ne démarre pas dans la sandbox) ; il l'a dit sans conclure. Validation du plugin (`claude plugin validate`) non mise en scénario : binaire Claude Code absent des runners, reportée à 1c. Hôte : `npm run check` 326/326, 54 s |
| 7 | 1a.4, 1a.7 | `gate.yml` (deux jobs, base lue par l'API, repli écrit, artefacts), `ci.yml` réduit aux contrôles statiques, `claude.yml` et `claude-code-review.yml` épinglés avec garde sur l'acteur, scénarios des workflows (13), corps du ruleset | 1 619 s | 20 × 200, sonnet-5-5 | 44 ; 17 556 ; 879 441 ; 45 604 | 0,45 USD | Le `npm run check` de l'agent a encore dépassé le délai de son outil (Postgres) ; le résultat JSON ne garde que son dernier message (le rapport complet est perdu côté orchestrateur : `--output-format json` ne rend que le message final ; échec de méthode, relu au `git diff`). Hôte : 339/339 |
| 8 | 1a.3 bis | Tuer les 27 mutants survivants des lignes changées par la brique (21 dans `tools/test-gate`, 6 dans `srt-runner.ts`), liste tirée de la porte rejouée sur l'hôte sur un merge simulé ; deux équivalents marqués avec justification (`diff.ts:23`) | 880 s | 25 × 200, sonnet-5-5 (`--model sonnet`), 36 tours | 50 ; 30 444 ; 1 510 288 ; 74 597 | 0,75 USD | Stryker ne démarre pas dans la sandbox : l'agent raisonne du mutant à l'assertion, l'hôte rejoue Stryker. Run complet de cucumber abandonné par l'agent (600 s, Postgres). Hôte : 363/363 |
| 9 | 1a.4 bis | Profil `mutation` de `cucumber.mjs` (par chemin, sans `features/repository/`) pour Stryker seul ; scénarios des profils (6) ; `.prettierignore` ancré | 709 s | 16 × 200, sonnet-5-5, 21 tours | 32 ; 9 545 ; 548 666 ; 31 132 | 0,27 USD | Run complet de cucumber abandonné par l'agent (Postgres) ; Stryker non lancé (consigne). Hôte : voir ligne suivante du rejeu |
| 10 | 1a.3 ter | Dernier survivant des lignes changées (`diff.ts:10`, quantificateur du compte de lignes d'un hunk) : un scénario de hunk à 12 lignes | 36 s | 7 × 200, sonnet-5-5, 9 tours | 14 ; 1 863 ; 173 473 ; 19 414 | 0,11 USD | Aucun |
| 11 | 1a.5 | Le changement sain : refactorisation sans effet de `count.ts` (différence d'ensembles extraite), aucune `.feature` ni step touchés | 67 s | 8 × 200, sonnet-5-5, 9 tours | 16 ; 2 196 ; 200 521 ; 18 871 | 0,12 USD | Aucun |

**Total de l'outil, 12 appels partis (l'essai perdu n'a rien envoyé)** : 12 919 s (3 h 35), 421 réponses, toutes `200` ; aucun `429`, `401` ni `503` pendant la brique (les deux `429` du fichier datent de 1a.0, 16 h 51 et 16 h 53 UTC) : l'identifiant de l'hôte n'a pas changé en cours de brique. Tokens : entrée 860, sortie 480 590, cache lu 49 820 992, cache écrit 1 058 516. Coût selon `total_cost_usd` : 20,83 USD, dont 13,60 USD pour la seule étape 2 en opus (150 réponses). Les étapes 3 à 11 sont en sonnet ; à partir de l'étape 8, `--model sonnet` est passé explicitement (quota hebdomadaire du propriétaire).

### Rejeu sur l'hôte

Méthode : chaque étape est rejouée sur l'hôte dans le worktree de travail, et la porte complète dans un second worktree détaché, `<repo>/.claude/worktrees/gate-1a-verify`, au commit exact (`npm ci --ignore-scripts` puis `npm run gate`). Le checkout propre a trouvé un défaut que ni la sandbox ni le worktree de travail ne montraient.

| Constat | Où | Cause racine | Correction |
|---|---|---|---|
| `pg_ctl start` : « le postmaster est devenu multithreadé lors du démarrage », 6 lignes `@postgres` rouges sur l'hôte après l'étape 1 | hook `@postgres` | macOS, `LANG` et `LC_ALL` vides dans l'environnement de l'hôte | `initdb --no-locale`, `LC_ALL=C` passé à `initdb`, `pg_ctl`, `createdb` (étape 2) |
| 74 scénarios de la porte rouges dans un checkout propre de `565f139` (`ENOENT … fixtures/reports/green.ndjson`), verts dans le worktree de travail | `.gitignore` | `reports/` non ancré ignorait aussi `tools/test-gate/fixtures/reports/` : les rapports fixtures n'avaient jamais été commités | `/reports/`, `/.stryker-tmp/` (étape 4) |
| `initdb` : `shmget … No space left on device` ; 14 Postgres jetables encore vivants | hook `@postgres` sous Stryker | Stryker tue ses workers (délais, redémarrages) : `AfterAll` ne tourne pas, chaque orphelin garde un segment SysV, `kern.sysv.shmmni=32` | Orphelins arrêtés à la main sur l'hôte (artefacts de la porte, `pg_ctl stop -m immediate`). Durée de vie liée au processus de test par un veilleur détaché, `concurrency: 4` (étape 5) |
| Le scénario `runInTerminal` refuse sans terminal : bloquerait depuis un vrai terminal (fds 0 à 2 en TTY, `cat` lancé) | `packages/sandbox` | Le scénario dépend des descripteurs de celui qui lance cucumber | Contrôle du terminal injectable dans l'adaptateur, comme `srtCli` et `trusted` (étape 5) |
| L'agent de l'étape 1 a lancé `git rm` (index de l'hôte) | outil | Consigne « ne pas toucher à .git » comprise comme `.git/` seulement | Consigne précisée (« ni `git rm` ni `git add` ») ; plus observé ensuite |
| CI, run 41126794516 (`3a30961`) : gate-linux rouge, gate-macos verte (5/5). Sur Linux, 339/339 scénarios verts, dont les 5 srt réels sous bwrap ; puis le run initial de Stryker échoue sur « the repository is formatted » | `features/repository/` sous Stryker | Stryker exécute les scénarios dans sa copie instrumentée (`.stryker-tmp/sandbox-*`), que `prettier` ne peut pas trouver formatée ; ces scénarios tournent en processus enfant et ne tuent aucun mutant (T-14b) | Profil `mutation` de `cucumber.mjs`, par chemin, utilisé par Stryker seul ; le run compté garde tout (étape 9) |
| Fin de session : 0 Postgres jetable vivant, 0 veilleur, mais 27 segments SysV orphelins (`NATTCH` 0, créateur mort), créés pendant les runs Stryker, dont 15 après l'arrivée du veilleur ; 30 segments sur 32 (`shmmni`) | hôte, runs Stryker | **Non établie.** Mesuré : un run complet de cucumber n'en laisse aucun ; `pg_ctl stop -m immediate` ou `fast`, au repos ou avec un backend actif, n'en laisse aucun ; un `SIGKILL` du postmaster en laisse un ; le postmaster a pour parent `launchd` (ppid 1), donc le `tree-kill` `SIGKILL` de Stryker ne l'atteint pas directement | Les 27 segments orphelins retirés à la main (`ipcrm`, seulement `NATTCH` 0 et créateur mort ; les 3 du Postgres de Cortex intacts). Reste ouvert : au rythme observé, une trentaine de runs Stryker sur macOS épuisent `shmmni` |

### Migration : compte tracé

Base : 224 cas vitest à `e525b50` (dont 6 ignorés). Chaque `it` est un `Scenario`, chaque ligne d'`it.each` une ligne d'`Examples`, un contrat sur N adaptateurs un `Scenario Outline` à N lignes. Pickles par fichier égaux au compte vitest, ignorés compris (ils tournent maintenant) : `packages/contracts` 7, `data` 32 (dont les 6 lignes `@postgres` du contrat `DataStore`, autrefois `skipIf`), `gateway` 25, `services/memory` 38, `packages/sandbox` 54 (dont 5 srt réels dans `features/sandbox/`, autrefois `runIf(darwin)`), `test/` racine 68. Total migré : 224 pickles. Ajoutés par 1a : `tools/test-gate` 118, veilleur Postgres 1, dépôt (typecheck, format) 2, workflows 13, profils cucumber 6, adaptateur srt (terminal) 6 : **370 pickles** à `122296b`. Plus aucun `*.test.ts`, vitest retiré.

### Exécutions de la porte

| Run | Commit | Contexte | gate-linux | gate-macos | Constat |
|---|---|---|---|---|---|
| local | `565f139` | worktree propre | rouge | | 74 scénarios en `ENOENT` (rapports fixtures non commités) |
| local | `3977dc2` | worktree propre | rouge, 12 min 46 | | Règles 1 à 4 vertes (201) ; 2 918 mutants, 111 survivants dans le périmètre étendu |
| [41126794516](https://github.com/cdeust/architect-os/actions/runs/41126794516) | `3a30961` | push | rouge | **verte** (5/5) | Linux : 339/339, srt réel sous bwrap compris ; Stryker : `prettier --check` dans sa copie instrumentée |
| [41128986373](https://github.com/cdeust/architect-os/actions/runs/41128986373) | `71152fc` | push | rouge | verte | Même cause (corrigée à l'étape 9) |
| local | merge simulé `e525b50` + `6b0dd76` | `refs/pull/N/merge` reproduit, jamais poussé | rouge, 30 min 19 | | 324 = 0 + 324 − 0 = statique ; 27 survivants sur les lignes changées, 309 dans le périmètre étendu |
| [41130695038](https://github.com/cdeust/architect-os/actions/runs/41130695038) | `e44d992` | push | rouge | verte | Stryker complet sous Linux, 1 039 s ; 369/369 ; 258 survivants anciens, périmètre étendu par les steps racine |
| local | merge simulé `e525b50` + `e44d992` | idem | rouge, 17 min 50 | | 1 survivant sur les lignes changées (`diff.ts:10`) |
| [41133552688](https://github.com/cdeust/architect-os/actions/runs/41133552688) | `0600c1d` | push | rouge | verte | Une `.feature` de la porte changée : périmètre étendu par `coveredBy` et par les mutants statiques, 477 mutants, survivants statiques anciens (`data`, `services/memory`) |
| local | `122296b` | worktree propre | **verte**, 1 min 20 | | 370 = 370 + 0 − 0 = statique ; périmètre 1 fichier, 7 mutants, 5 tués, 2 invalides |
| [41136001960](https://github.com/cdeust/architect-os/actions/runs/41136001960) | `122296b` | push, **le changement sain** | **verte** | **verte** | Idem en CI |
| local | merge simulé `e525b50` + `122296b` | idem | rouge, 17 min 16 | | Règles 1 à 4 vertes : 370 = 0 + 370 − 0 = statique ; **0 survivant sur les lignes changées** (2 équivalents justifiés) ; périmètre étendu : 2 435 mutants, 251 survivants, tous sur du code antérieur à la brique |

### Sentinelles

Fixtures (dans `tools/test-gate/fixtures/`, rejouées à chaque run, local et CI) : step non défini, `pending`, `skipped`, ambigu, en échec, deux tentatives, scénario sans step, pickle absent (filtre), pickle inattendu, identité en double, base d'un autre SHA, d'un autre job, compte faux, repli signalé, survivant dans et hors du périmètre, `NoCoverage`, `Stryker disable all`, `disable next-line` sans justification, équivalent justifié, fichier du périmètre absent du rapport, périmètre étendu par `coveredBy`. Branches réelles, poussées depuis `0600c1d`, chacune d'une ligne, **faites à la main** (casses délibérées, pas du code livré) :

| Branche | Casse | CI | Local | Règle nommée |
|---|---|---|---|---|
| `sentinel/gate-1a-tags` (`248d263`) | `tags: 'not @postgres'` dans `cucumber.mjs` (test externe du §8) | [41135804131](https://github.com/cdeust/architect-os/actions/runs/41135804131) rouge (macOS verte : aucun `@postgres` dans `features/sandbox`) | rouge | 2 (scénario des profils), 3 (les 6 lignes `@postgres` attendues, non exécutées), 4 (364 ≠ 370) |
| `sentinel/gate-1a-skipped` (`d94f916`) | un step qui rend `'skipped'` | [41135806704](https://github.com/cdeust/architect-os/actions/runs/41135806704) rouge | rouge | 2 (step `SKIPPED`, puis le suivant) ; 5 en plus, step changé = périmètre de `packages/contracts` étendu |
| `sentinel/gate-1a-survivor` (`4158f83`) | une ligne de production sans scénario qui tue ses mutants | [41135812342](https://github.com/cdeust/architect-os/actions/runs/41135812342) rouge | rouge | 5 seule : `count.ts:44`, `Survived` et `NoCoverage` |

### Porte de sortie de 1a

| Critère (§8, consigne) | Résultat | Preuve |
|---|---|---|
| 0 `*.test.ts`, vitest retiré | Fait | `git ls-files '*.test.ts'` vide à `122296b` ; `vitest` absent de `package.json` |
| `exécutés_verts = attendu = statique` | Fait, local et CI | 370 = 370 + 0 − 0 = 370 (run 41136001960 et local `122296b`) ; sur le merge simulé de toute la brique : 370 = 0 + 370 − 0 = 370 |
| `exécutés = base + ajoutés − supprimés` sur `main`, base lue dans le dernier run vert de `main` | **Prévu** au premier push sur `main` après fusion | Aucun run de `gate.yml` sur `main` n'existe : chaque run de la branche a pris le repli écrit, signalé au rapport. Le chemin de l'artefact (`gate-base-<job>`, `gh api … head_sha=<premier parent>`) est écrit et non exercé |
| Rapports fixtures refusés (§7) | Fait | 118 scénarios de `tools/test-gate`, verts en local et en CI |
| PR sentinelles rouges | Fait, local et CI | `tags`, `skipped`, `survivor` : tableau ci-dessus |
| PR saine verte | Fait, local et CI | `122296b` : run 41136001960, deux jobs verts, mutation exercée (7 mutants) |
| 0 survivant sur le diff d'une PR réelle | Fait au sens du §7 (lignes modifiées) ; **rouge** au sens étendu de la consigne | Merge simulé `e525b50` + `122296b` : 0 survivant sur les lignes changées ; périmètre étendu (code couvert par les `.feature` et steps changés, mutants statiques compris) : 251 survivants, tous antérieurs à la brique (décision au propriétaire) |
| Workflows épinglés, garde sur l'acteur, `--ignore-scripts` | Fait | `gate.yml`, `ci.yml`, `claude.yml`, `claude-code-review.yml` ; `features/descriptive/workflows.feature` (13 scénarios, copies cassées refusées). `bench-sandbox.yml` déjà épinglé (v4.2.2, v4.4.0), laissé tel quel |
| Ruleset sur `main` | **Au propriétaire** (décision) | Corps : `docs/design/ruleset-main.json` ; commande ci-dessous |
| `npm run gate` localement vert | Fait | `122296b`, worktree propre, 1 min 20, exit 0 |

**Piliers.** Recherche : fait, porte prouvée par exécution réelle (runs ci-dessus, merges simulés, sentinelles), usage de l'outil mesuré par appel. SSDLC : fait, versions exactes et lockfile, actions épinglées par SHA vérifiés à l'API, `persist-credentials: false`, `npm ci --ignore-scripts`, aucun cache, garde sur l'acteur, aucun hash ni digest dans la porte (identités textuelles) ; SAST = la porte ; SBOM prévu en 1c. Opérationnel : fait, aucun secret dans `gate.yml` (seul le jeton automatique, `contents: read`, `actions: read`), aucun secret lu ; ruleset au propriétaire.

**Écarts à la consigne, dits.** Pas de profil srt `gate-tests` : le §7 n'exige pas que la suite tourne sous srt ; seuls les scénarios de `features/sandbox/` lancent de vrais srt. Pas de Postgres sur macOS : `gate-macos` ne lance que `features/sandbox/`, sans `@postgres` ; un scénario `@postgres` qui y entrerait échouerait, visiblement. Validation du plugin (`claude plugin validate --strict`) non mise en scénario : binaire absent des runners, sortie de 1c. Déclencheurs `push` temporaires `feat/gate-1a` et `sentinel/gate-1a-*` dans `gate.yml`, à retirer à la fusion (aucune PR ouverte par le constructeur, `workflow_dispatch` exige le fichier sur la branche par défaut).

**Décisions au propriétaire.**

1. Périmètre de mutation. La consigne l'étend au code couvert quand une `.feature` ou une step change ; le §7 dit « lignes modifiées du diff ». Mesuré : avec l'extension, toute PR qui touche une `.feature` ou une step de `data`, `gateway`, `services/memory`, `packages/sandbox`, `packages/contracts` ou de `features/` racine est rouge tant que les survivants anciens de ce code ne sont pas tués (251 sur toute la brique ; les mutants statiques, couverts par tous les scénarios, entrent dès qu'une `.feature` change : 7 survivants statiques anciens dans `data` et `services/memory`). Options : (a) périmètre du §7 tel qu'écrit ; (b) tuer les survivants anciens dans une brique dédiée ; (c) fusionner 1a avec le contournement du ruleset, l'extension restant en vigueur. Non tranché ici.
2. Ruleset sur `main`, à créer par le propriétaire : `gh api -X POST repos/cdeust/architect-os/rulesets --input docs/design/ruleset-main.json`. `actor_id: 5` (rôle admin) n'est pas confirmé par la documentation lue : vérifier après création avec `gh api repos/cdeust/architect-os/rulesets --jq '.[] | {id, name}'` puis `gh api repos/cdeust/architect-os/rulesets/<id> --jq '.bypass_actors'`.
3. `ci.yml` réduit aux contrôles statiques : à retirer, `gate.yml` les porte en scénarios.
4. Retirer les déclencheurs temporaires de `gate.yml` à la fusion ; supprimer les branches `sentinel/gate-1a-*`.
5. `anthropics/claude-code-action` `6d5ae52…` est un commit du 30 octobre 2026 (le jour même) : épinglé comme demandé, ancienneté nulle.
6. `CLAUDE.md` amendé dit `node:child_process` seulement dans `packages/sandbox` et deux exceptions : exact pour ce que `npm run arch` scanne (sources de production) ; le code de support de `features/` racine l'utilise (Postgres, veilleur, typecheck, format) et n'est pas scanné. Préciser le texte ou étendre la garde.
7. Fuite de segments SysV sous Stryker sur macOS (rejeu sur l'hôte, dernière ligne) : cause à établir.

**Restes nommés.** Base lue dans l'artefact d'un run vert de `main` : au premier push sur `main` après fusion. `platform-v3-srt.md` dit encore « 119 cas » (§8, 1a) et ne mentionne pas l'extension du périmètre de mutation : à amender selon la décision 1. Head de la branche après le journal : `9a40e32`, run [41140470950](https://github.com/cdeust/architect-os/actions/runs/41140470950), vert (diff de documentation, périmètre vide).

## 17. Gate Linux rouge à chaque run, 2 novembre 2026

**Symptôme.** `gate-linux` rouge sur `feat/gate-1a` : règle 6, entrées ajoutées au registre, à chaque régénération (739, puis 788, puis 799 entrées). Runs complets de 20 à 40 minutes.

**Mesure (12 runs complets déjà archivés, un seul commit par échantillon).** 95 mutants passent de `Survived` à un autre statut d'un run à l'autre. 77 mutants n'ont jamais été tués que par la garde d'architecture, qui n'exécute aucune ligne de production : faux tués, donc vrais survivants cachés.

**Causes.**
1. Quatre workers Stryker dans un seul répertoire : les fixtures `zz-fixture-*` de `features/arch` et les ports fixes des `main.ts` (`EADDRINUSE` sur 8082) entrent en collision. Le statut d'un mutant dépend du voisin.
2. Le registre était fait de l'union des survivants vus : méthode qui suit le bruit, refusée à juste titre par la règle 6.
3. Tout commit touchant un `.feature` ou un step faisait muter toute la production (17 des 30 derniers commits).

**Décisions.** Un seul worker (`stryker.config.mjs`). `features/arch` hors du profil de mutation. Périmètre de la porte réduit aux lignes de production modifiées, décision du propriétaire ; `scopes`, `fallbackFiles`, `coverageFallback`, `componentOf`, `stepDefinitions` et `components` retirés. Run complet hors PR : `mutation-full.yml`, rouge si les survivants diffèrent du registre.

**Preuve de reproductibilité.** Deux runs complets à un worker, 78 et 80 minutes : [41535542626](https://github.com/cdeust/architect-os/actions/runs/41535542626) (`96b7cb7`) et [41546674390](https://github.com/cdeust/architect-os/actions/runs/41546674390) (`43a582c`, vert). Sur 3 136 mutants, mêmes identités et un seul statut différent : le `.sort()` de `perimeterOf`, passé de `Survived` à `Killed` par le scénario ajouté entre les deux commits. Registre : 852 entrées, identiques à celles calculées par le second run. Stryker n'était pas en cause.

**Durées de la porte.** 1 min 10 sans code de production ; 15 min sur 3 fichiers (270 mutants mutés, 19 jugés), car Stryker mute le fichier entier.

**Risque accepté.** Un test affaibli sans toucher au code n'est plus vu à la PR, seulement au run complet suivant.

**Erreurs à garder.** J'ai multiplié les branches sentinelles (28 sur le dépôt) et enchaîné des correctifs sur une prémisse fausse, que les survivants étaient stables, avant que le propriétaire signale que le parallélisme lui-même était le problème. Désormais : une branche, un écrivain.

**Trois piliers.** Recherche : mesure ci-dessus, reproductibilité à prouver par deux runs complets du même commit à un worker. SSDLC : pas de nouvelle surface, le workflow n'a ni secret ni entrée externe. Opérationnel : sans objet, aucune donnée sensible.

## 18. Clé API dans un log de CI, incident, vers le 19 octobre 2026

**Fait.** Le CI a affiché en clair, dans son log, la clé API décodée depuis les secrets GitHub : elle a été visible pendant 5 minutes, ce qui la compromet de fait. Cause : une étape du CI décodait le secret ; au lieu de l'écrire dans un fichier temporaire supprimé après l'opération, elle l'a décodé dans le log. C'était avant l'architecture d'architect-os, pendant des essais de GitHub Actions avec un conteneur Docker. Date approximative : environ 15 jours avant le 3 novembre 2026. Déclaré par le propriétaire. Ni la valeur de la clé ni le lien du run ne figurent ici.

**Traitement.** Le propriétaire a révoqué la clé et supprimé le log du CI.

**Pourquoi cette entrée.** La raison d'une décision doit être écrite. Le journal décrivait les défenses contre ce risque (aucun secret dans une sandbox ni dans un log, D13, §15), sans l'incident lui-même. D13 et la règle « aucun secret dans une sandbox ni dans un log » découlent de cet incident.

## 19. Proxy d'authentification : politique du corps, mutants tués, outil de code sorti de son point d'entrée, 3 novembre 2026

**Fait.** Le proxy lit le corps entier et répond 403 (`refused_by_policy` au journal d'usage) à un champ racine hors de `authProxy.policy` de `code.json`, à un outil typé côté serveur, à une image ou un document dont la source n'est pas dans le corps, à un corps au-delà de 64 Mio. Une liste de domaines accorde des capacités : par `api.anthropic.com`, ces champs feraient lire au modèle des données hors de portée de la sandbox. Commit `978bb20`, porte verte en local puis en CI : [41616405663](https://github.com/cdeust/architect-os/actions/runs/41616405663), Linux 8 min 52, macOS 32 s.

**Mutation, fichiers entiers.**

| Fichier | Tués | Délai | Ignorés justifiés | RuntimeError | Survivants, sans couverture |
|---|---|---|---|---|---|
| `auth-proxy.ts` | 233 | 31 | 5 | 6 | 0 |
| `request-policy.ts` | 80 | 0 | 0 | 0 | 0 |
| `tool.ts` | 26 | 0 | 1 | 0 | 0 |
| `code-tool.ts` | 39 | 2 | 0 | 3 | 0 |
| `code.ts` | aucun mutant | | | | |

Chaque mutant ignoré porte sa raison d'équivalence sur la ligne précédente. Les RuntimeError sont détectés par un plantage, pas par une assertion : signalés, pas rouges.

**Défauts trouvés en tuant les mutants.**
1. Un journal d'usage impossible à écrire faisait planter le proxy après la réponse. Il est désormais créé au démarrage (dossier 700, fichier 600) ; une ligne qui ne s'écrit plus arrête le proxy. Correction demandée par le propriétaire ensuite : la sandbox recevait « 401 session token required », qui cachait la cause ; elle reçoit 503 avec la cause, le jeton faux restant 401.
2. Un `message_start` sans message laissait une clé `model` vide dans l'usage.
3. Des branches mortes : la vérification `typeof` des sources, le `else res.destroy()` d'une erreur de requête après la réponse (Node la signale sur la réponse), des `?? ''` sur des valeurs toujours définies.

**`code.ts`.** Son `main()` n'était exécuté par aucun test (47 mutants sans couverture). Toute retouche de son corps rendait la porte rouge : le mutant qui vide le bloc couvre la ligne changée. La logique est passée dans `code-tool.ts`, testée avec un lanceur et un proxy factices ; `code.ts` est une affectation à `process.exitCode`, sans mutant. Lancé pour de vrai sur le chemin d'échec de l'identifiant (trousseau introuvable), il écrit l'erreur typée et sort avec 2 sans attendre. Le lancement complet reste le premier lancement réel du propriétaire.

**Registre.** 852 → 713 entrées, aucune ajoutée : `auth-proxy.ts` 86, `code.ts` 49, `tool.ts` 4. L'identité d'une entrée porte sa position : modifier un fichier endetté oblige à tuer ses survivants décalés, comme le prévoit le §17.

**Décisions du propriétaire, même jour.**
- Outils : ceux d'Anthropic et de la communauté craftsmanship TypeScript et npm, en versions exactes. crapper, dryer et jscpd ne sont pas retenus. À intégrer : ESLint avec typescript-eslint (`complexity`), c8, fast-check.
- `tools/test-gate` sera remplacé par les fonctions natives de Stryker (`mutate` par lignes, `thresholds.break`, directives `// Stryker disable`) et de Cucumber (`strict`, `retry: 0`). Seul le compte des scénarios exécutés contre la base (règles 1 à 4) est gardé, en formatter Cucumber.
- Mutualiser n'est pas importer entre composants : le code commun (hôte HTTP, aides des steps, erreurs) ira dans des paquets partagés.
- Les plugins `security-guidance` et `claude-security` sont activés pour le dépôt (`002a7a8`).

**`--bare`.** La documentation de Claude Code annonce que `--bare` deviendra le mode par défaut de `-p`. Mesure sur Claude Code 2.1.314, faux amont local, aucune clé réelle : sous `--bare`, un hook n'est exécuté ni s'il vient d'un plugin chargé par `--plugin-dir`, ni s'il est déclaré dans `--settings` ; `permissions.deny` passé par `--settings` est appliqué. Le garde du builder, un hook, disparaîtrait sans bruit. Prévu : lancement explicite en `--bare` avec toutes les entrées déclarées dans `code.json`, règles du garde en `permissions.deny`, jeton de session en `x-api-key` par `apiKeyHelper`, et la sonde rejouable au banc.

**Trois piliers.** Recherche : mesures ci-dessus, porte rejouée en local puis en CI. SSDLC : surface réduite (politique du corps, journal qui échoue fermé), aucune directive sans justification. Opérationnel : sans objet, aucune donnée sensible.

## 20. Règle 7 : la porte vérifie l'outil de mutation, 3 et 4 novembre 2026

**Question du propriétaire.** « Comment on peut avoir une gate de mutation testing si on peut pas faire confiance à l'outil pour identifier et tuer les mutants ? » Le score d'un outil sur lui-même (Stryker 79,8 %, mutator 100 %) mesure ses tests, pas la justesse de ses verdicts sur notre code : le 3 novembre, mutator a déclaré 18 mutants sur 18 tués avec une commande de test cassée. Décision : la porte ne croit plus l'outil, elle vérifie chacun de ses verdicts. Stryker reste le générateur (80 mutants sur `request-policy.ts` contre 18 pour mutator). Pas de second générateur : le seul indépendant disponible est en Python, refusé pour le dépôt. La CI rejoue les fichiers modifiés ; le run hebdomadaire rejoue tous les mutants (décision du propriétaire). Le propriétaire juge qu'Anthropic serait plus stricte encore : chaque relâchement de la première proposition a été retiré (périmètre seul en CI, Timeout accepté, mutants sans verdict tolérés, équivalence sur simple commentaire).

**Fait.**
- Canari (`gate.json` `canary`, `tools/test-gate/canary/canary.ts`, `features/canary.feature`), muté à chaque run avec mutation. Statuts relevés sur un vrai run de Stryker 10.1.1 avant de les figer : `sum` et `greet` 4 Killed, `twice` 2 Survived, `thrice` 2 NoCoverage. La portée d'une fonction est le mutant BlockStatement de son corps. Exclu de la production : ni la règle 5 ni le registre de la règle 6 ne le lisent.
- `test-gate replay [--all]`, entre Stryker et `check` : chaque mutant écrit dans l'arbre, `cucumber-js --profile replay <feature>:<ligne>` lancé directement, fichier réécrit. Le profil `replay` n'a ni chemins ni formats : Cucumber ajoute ceux de la ligne de commande à ceux du profil (`merge_configurations.js`, `ADDITIVE_ARRAYS`), et un premier essai avec le profil `mutation` relançait toute la suite et écrasait `reports/cucumber.ndjson`. Un run ciblé prend 0,7 s.
- Règle de jugement (§7 de `platform-v3-srt.md`) : détection = témoin propre sur l'original et run du mutant qui n'est pas un passage propre ; survie = passage propre sur le mutant. Une détection qui ne repose pas sur un step `FAILED` exige un nouveau témoin juste après. Si les tueurs nommés d'un `Killed` passent, ses scénarios couvrants décident. Tout run avec témoin est borné à trois fois le témoin plus dix secondes.
- Règle 7 dans `check` : canari, puis enregistrement du rejeu lié au rapport par SHA-256. `CompileError` est rouge par la règle 5.

**Témoins négatifs, sur le canari réel.** Un survivant déclaré tué : divergence. Un tué déclaré survivant : divergence, et canari rouge. Profil Cucumber inexistant (commande cassée, le cas de mutator) : les 6 verdicts divergent, aucun kill confirmé.

**Quatre runs complets en local, chacun corrigeant ce que le précédent a trouvé.**

| Run | Mutants | Stryker | Survivants hors canari | Rejeu | Divergences |
|---|---|---|---|---|---|
| 1 | 1 023 | 110 min | 35 | 511 verdicts, 77 min | 1 |
| 2 | 1 075 | 126 min | 6 | arrêté | |
| 3 | 1 072 | 122 min | 3 | arrêté | |
| 4 | 1 067 | 119 min | 2 | 599 verdicts, 71 min | 9 |

Trouvé en chemin :
1. Run 1, `replay.ts` #986 : `performance.now() - started` muté en `+ started`, classé Timeout par Stryker. Dans son worker, qui tourne depuis longtemps, la somme dépasse le délai ; dans un processus neuf, `performance.now()` part de zéro et le mutant passe. Le rejeu le déclare survivant, à raison ; un scénario le tue désormais.
2. Runs 1 et 2 : les scénarios d'un run tué au délai lui survivaient (processus orphelins à 100 % CPU, de parent 1). Chaque run est désormais chef de son groupe de processus, tué en entier à sa fin, et le délai est celui de `spawn` (`timeout`, `killSignal`) au lieu d'une minuterie à annuler. Un scénario le prouve : l'enfant laissé derrière est mort après le run, et aucun descripteur de fichier ne reste ouvert.
3. Run 2 : des runs plafonnés à 600 s faisaient durer le rejeu des heures ; tout run avec témoin est désormais borné par celui-ci.
4. Run 3 : 107 mutants statiques rejoués contre toute la suite, 2 minutes chacun ; un kill se prouve par ses tueurs nommés.
5. Run 4 : 9 divergences sur 599 ont montré une règle trop étroite, pas des mutants vivants : 7 kills par délai, 1 mutant qui empêche Cucumber de charger la suite, 1 tueur nommé qui passe dans un processus neuf. D'où la règle de détection ci-dessus, avec le nouveau témoin pour qu'elle ne soit jamais plus laxiste que la précédente.
6. Registre de dette : 713 → 712 entrées, l'entrée `mutation.ts` `changed !== undefined` est payée (le mutant est tué dans `inPerimeter`).

**Coût.** `gate-linux` passe à 360 min, limite d'un runner hébergé, pour un changement qui réécrit un module entier : en local, Stryker et le rejeu prennent ensemble environ 3 h 10. Le premier run de ce commit en CI est la vraie mesure ; au-delà de 360 min il n'y aurait plus de marge, et la branche ne se réécrit pas pour scinder le changement. `mutation-full.yml` passe aussi à 360 min ; sa durée sera mesurée à son premier passage hebdomadaire.

**Limites.** Un mutant `NoCoverage` n'est pas rejoué, aucun scénario n'étant nommé ; son statut est déjà rouge ou au registre, et le canari prouve que l'outil sait le reconnaître. Dans le rejeu du rejeu lui-même, un mutant qui désactive le kill du groupe laisse son run imbriqué tourner jusqu'à la fin de sa fixture (60 s au plus). L'équivalence par propriété (fast-check) est prévue à l'étape qui ajoute fast-check.

**Trois piliers.** Recherche : chaque verdict est rejoué et consigné, la porte se relance en une commande (`npm run gate`), les quatre runs sont dans ce journal. SSDLC : aucun composant tiers n'est cru sur parole ; le canari, le témoin et le nouveau témoin sont les contrôles négatifs. Opérationnel : sans objet, aucune donnée sensible.

## 21. L'outil de code passe à `claude --bare`, 4 novembre 2026

**Décision du propriétaire.** `--bare` devient la norme : la plateforme s'y adapte, chaque entrée de Claude Code est passée explicitement. Priorité donnée à `--bare` et à la CI.

**Fait.**
- `code.json` : `claude --bare --settings ${config}/settings.json --strict-mcp-config`, et `systemPromptFile: "CLAUDE.md"`, passé par `--append-system-prompt-file` s'il existe à la racine du worktree visé (sous `--bare`, Claude Code ne lit plus le CLAUDE.md du projet). L'adaptateur srt résout les variables du profil dans les arguments de la commande ; une variable inconnue est refusée (`PROFILE_INVALID`).
- Profil `builder` : `ANTHROPIC_API_KEY=${sessionToken}` remplace `CLAUDE_CODE_OAUTH_TOKEN` (sous `--bare`, seuls `ANTHROPIC_API_KEY` et `apiKeyHelper` authentifient) ; `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1` retire le jeton de l'environnement des commandes lancées par Claude Code. Le `settings.json` de la session, que la sandbox ne peut pas écrire, porte les règles `permissions.deny` : `git push`, `git config`, `security`, lecture et écriture des fichiers de secrets et de `~/.claude`, écriture de `.git/hooks` et `.git/config`.
- Proxy d'authentification : le jeton de session est lu dans `x-api-key` ; un `Authorization: Bearer` de la sandbox est refusé (401). L'identifiant de l'hôte reste en `Authorization` vers l'amont, et le jeton de session n'y part jamais.
- Plugin `builder-guard` retiré, avec ses 51 scénarios : sous `--bare`, ses hooks ne tournent pas (mesuré le 3 novembre, §19). Ses refus sont les règles ci-dessus. La marketplace reste, sans plugin (`claude plugin validate` : valide, avec un avertissement).

**Mesuré.** `npm --prefix bench run bench:bare` lance le Claude Code de l'hôte avec la commande de `code.json` et le `settings.json` du profil, contre un faux amont local, sans srt ni clé réelle. Sur Claude Code 2.1.314 :

| Fait | Résultat |
|---|---|
| Jeton de session en `x-api-key`, aucun `Authorization` | oui, 2 requêtes sur 2 |
| CLAUDE.md du worktree dans le prompt système | oui |
| `git push origin probe` refusé par `Bash(git push *)` | oui (« Permission to use Bash with command git push origin probe has been denied. ») |
| Outils déclarés au modèle | Bash, Edit, Read |

Témoin négatif : sans la règle `Bash(git push *)`, la sonde voit le push accepté et sort en 1. Sous `--bare`, `--tools Bash,Read,Edit,Write,Glob,Grep` ne change pas la liste (toujours Bash, Edit, Read) : l'outil crée ses fichiers par Bash ou Edit, et aucun `--tools` n'est déclaré, faute d'effet. Claude Code appelle aussi `GET /api/hello` au démarrage : le proxy le refuse (403), sans effet sur la session.

**Mutation des lignes changées.** Le run de CI de `000a540` s'est arrêté avant Stryker : sous Linux, l'enfant tué du scénario de l'orphelin reste zombie jusqu'à ce que son nouveau parent le récolte, et `kill(pid, 0)` le voyait encore. Le scénario lit désormais l'état du processus (`/proc/<pid>/stat` sous Linux, `Z` compte comme disparu ; ailleurs, `kill(pid, 0)` jusqu'à ESRCH), sans lancer de commande, ce que la garde d'architecture interdit à un step. Le commit suivant ne touchant que des steps, sa CI ne mute que le canari : les lignes de production de `000a540` ont donc été mutées en local, exactement les 23 plages du plan de sa CI. Résultat : 41 mutants en 5 min 35, 35 tués, 4 du canari, 2 survivants dans `tool.ts` (le message du refus d'un `systemPromptFile` hors du worktree n'était pas vérifié), puis 39 verdicts rejoués sans divergence. Un scénario vérifie maintenant ce message ; `tool.ts:21-22` muté de nouveau : 9 mutants tués, 9 verdicts confirmés. CI verte sur `96debc0` (Linux et macOS, canari et 6 verdicts rejoués).

**Reste.** Le premier lancement réel, avec l'identifiant de l'hôte et srt, est celui du propriétaire. La sonde ne passe pas par srt : la frontière reste prouvée par le canari de srt et le banc 1b.0.

**Trois piliers.** Recherche : la sonde se rejoue en une commande, avec son témoin négatif. SSDLC : jeton de session seul dans la sandbox, retiré des sous-processus ; règles de refus dans un fichier que la sandbox ne peut pas écrire ; srt reste la frontière. Opérationnel : aucune donnée sensible, aucune clé réelle dans la sonde.

## 22. Baseline de coût, pilote, 4 novembre 2026

**Décisions du propriétaire.** Une publication publique compare les coûts avec et sans srt, sur un vrai jeu de tâches ; trois configurations (`host`, `host-bare`, `srt`, `baseline/README.md`) pour séparer l'effet de `--bare` de celui de srt ; cibles : les dépôts publics actifs du compte, laissés intacts ; pilote d'abord, volume fixé ensuite ; publication dans ce dépôt, après accord sur le texte final.

**Fait.** `baseline/tasks.json` : trois tâches de correction de défaut, une par dépôt et deux langages (`session-optimizer` et `zetetic-team-subagents` en Python, `ai-architect-mcp-spec` en TypeScript), chacune avec un défaut injecté dont le contrôle passe au commit épinglé et échoue avec le défaut, vérifié avant chaque session (essai à blanc : 9 préparations sur 9). `baseline/run.ts` : une session par tâche et par configuration, ordre des configurations tourné d'une tâche à l'autre, modèle `claude-sonnet-5-5` pour toutes, Claude Code 2.1.314.

**Trouvé en chemin.**
1. Lancement `srt` du banc : `node --import tsx` cherchait `tsx` depuis la cible ; le banc passe par `npm --prefix <lanceur> run code`, le lancement documenté.
2. `host-bare` échouait sur les trois tâches : l'agent trouvait la cause, puis Claude Code refusait l'écriture. Le worktree visé vit sous `<repo>/.claude/worktrees/<w>`, et Claude Code protège les chemins qui contiennent `.claude/`, même en `acceptEdits` ; la configuration habituelle du propriétaire l'autorise, les réglages de la session n'avaient que des refus. Défaut réel de l'outil de code, pas du banc : il n'aurait pu éditer aucun fichier. Le profil `builder` autorise désormais `Edit(/${worktree}/**)` et refuse `Edit(/${worktree}/.claude/**)`, le refus l'emportant.

**Résultats du pilote** (`baseline/results/pilot-2026-11-04T07-53-28-654Z.jsonl`, une session par cellule, n = 1 : aucune conclusion statistique).

| Configuration | Résolues | Coût des 3 tâches | Coût moyen | Tokens d'entrée (cache compris) | Écriture de cache par session |
|---|---|---|---|---|---|
| `host` | 3 / 3 | 0,584 $ | 0,195 $ | 540 414 | 42 155 à 43 064 |
| `host-bare` | 3 / 3 | 0,101 $ | 0,034 $ | 122 158 | 6 267 à 7 538 |
| `srt` | 3 / 3 | 0,128 $ | 0,043 $ | 184 872 | 4 529 à 12 065 |

Lecture prudente : l'écart `host` / `host-bare` vient du contexte chargé à chaque session (environ 42 000 tokens écrits en cache contre 7 000), donc de `--bare` et des entrées explicites, pas de srt. L'écart `host-bare` / `srt` (0,034 $ contre 0,043 $) tient surtout à une session (`session-optimizer`, 16 tours contre 11) : avec une session par cellule, il est dans le bruit. Les sessions `host` portent aussi les hooks et serveurs MCP du propriétaire, qui écrivent hors du banc.

**Coût du pilote.** 9 sessions retenues pour 0,81 $ au tarif public. Avant elles, 11 sessions d'essai pour 0,75 $ : 3 `host` résolues avec l'ancien banc, 4 `host-bare` refusées en écriture puis 1 de vérification, et 3 `srt` arrêtées avant tout appel au modèle ; elles restent dans `baseline/results/` comme journal. Projection pour la campagne de la conception (20 tâches, 3 configurations, 3 répétitions, 180 sessions) : environ 16 $ au tarif public et 2 h 30 de sessions, au coût moyen mesuré.

**Reste.** Le volume de la campagne, au propriétaire ; 17 tâches de plus, construites de la même façon ; les intervalles de confiance ; le texte de la publication, soumis au propriétaire avant toute publication.

**Trois piliers.** Recherche : tâches épinglées par commit, préconditions vérifiées avant chaque session, une commande (`npm run baseline:pilot`), échecs conservés. SSDLC : cibles jamais poussées, références distantes comparées avant et après (intactes) ; `host` et `host-bare` tournent sur l'hôte avec la seule commande de test autorisée, `srt` dans la sandbox. Opérationnel : aucune donnée privée, cibles publiques seulement ; aucune clé réelle hors du trousseau du propriétaire.

## 23. Baseline de coût, campagne, 4 novembre 2026

**Décision du propriétaire.** Campagne complète : 20 tâches, 3 configurations, 3 répétitions, 180 sessions.

**Fait.** 17 tâches ajoutées aux 3 du pilote, sur six dépôts publics du propriétaire (`Cortex` 4, `zetetic-team-subagents` 4, `cortex-viz` 3, `claude-mods` 3, `session-optimizer` 3, `ai-architect-mcp-spec` 3 ; Python et TypeScript). Les défauts viennent de `baseline/find-defects.ts`, qui essaie des mutations d'une ligne (comparaison, opérateur booléen, constante) et ne garde que celles qui cassent de un à cinq tests ; le choix parmi les candidats est fait à la main, de préférence des bornes et des décalages d'un. Deux candidats écartés à l'essai à blanc : leur ligne existait deux fois dans le fichier. Dépendances des dépôts Python avec lockfile installées à la préparation par `uv sync --frozen --python-preference only-system` (l'interpréteur géré x86_64 de uv ne s'exécute pas sur cet hôte) ; les sessions lancent `.venv/bin/python -m pytest`, sans réseau. Le cache ne récupère que les commits épinglés, à profondeur 1 : le miroir complet de `Cortex` coûtait plus de dix minutes par run. Le contrôle des dépôts distants ne lit plus que les branches et les tags : `refs/pull/*` change à chaque revue de pull request.

**Résultats** (`baseline/results/campaign-2026-11-04T12-34-42-853Z.jsonl`, analyse `baseline/results/campaign-2026-11-04T12-34-42-853Z.md` par `baseline/analyze.ts`). Claude Code 2.1.318, `claude-sonnet-5-5`.

| Configuration | Résolues | Coût moyen par session | Tokens d'entrée moyens | Écriture de cache moyenne |
|---|---|---|---|---|
| `host` | 60 / 60 | 0,1917 $ | 169 300 | 42 138 |
| `host-bare` | 60 / 60 | 0,0280 $ | 31 929 | 5 591 |
| `srt` | 60 / 60 | 0,0321 $ | 41 628 | 6 117 |

Rapports appariés par tâche, moyenne et intervalle à 95 % par bootstrap sur les 20 tâches (10 000 tirages, graine fixe) : `host-bare` / `host` 0,146 (0,123 à 0,173) ; `srt` / `host` 0,166 (0,131 à 0,212) ; `srt` / `host-bare` 1,108 (1,021 à 1,213). Aucun fichier de test modifié, aucune session non résolue. Coût total de la campagne : 15,11 $ au tarif public.

**Lecture.** L'économie vient du contexte chargé à chaque session par la configuration habituelle (plugins, serveurs MCP, hooks, mémoire : environ 42 000 tokens écrits en cache par session, contre 6 000), donc de `--bare` et des entrées explicites, que tout utilisateur peut obtenir sans srt. srt coûte environ 11 % de plus que l'hôte en `--bare`. Une partie vient de l'environnement isolé : sous srt, un test de `session-optimizer` (`test_readme_test_the_guard_snippet_fires_block_on_first_and_second_run`) échoue, faute du `/tmp` et du `HOME` de l'hôte, et l'agent passe des tours à l'investiguer (jusqu'à 29 tours, contre 8 à 12 ailleurs) ; le contrôle, lui, tourne sur l'hôte.

**Dépôts distants.** Quatre branches de `Cortex` ont changé pendant la campagne (`main`, `ci/claude-mentions-review-fixes`, `fix/343-outcome-task-verifier`, `fix/683-groomer-degrade-paths`) : trois commits de sessions `claude` et un merge du propriétaire sur GitHub, sans rapport avec les tâches. Les copies du banc n'ont jamais eu GitHub pour `origin`, et les sessions n'avaient le droit de lancer que la commande de test.

**Limites.** Un seul modèle et une seule version de Claude Code ; des défauts d'une ligne, injectés, avec leurs tests nommés, plus faciles qu'une vraie issue ; la configuration `host` est celle du propriétaire, et l'économie dépend de ce qu'une configuration charge ; coût au tarif public, alors que les sessions passent par le forfait du propriétaire.

**Reste.** Le texte de la publication, soumis au propriétaire ; rien n'est publié avant son accord.

**Trois piliers.** Recherche : 180 sessions, intervalles de confiance, données et analyse versionnées, une commande par étape (`npm run baseline:campaign`, puis `npm run baseline:analyze -- <fichier>`). SSDLC : cibles jamais poussées, changements distants nommés et attribués. Opérationnel : dépôts publics seulement, aucune clé réelle hors du trousseau.

## 24. Brique 1b.1 : le lancement passe tout entier par le port, sorties bornées, 4 novembre 2026

**Décision du propriétaire.** Revenir à l'architecture : une seule brique livrée pour le quota employé, c'est insuffisant. `gate-macos` reste dans la porte : les autres PR y sont passées.

**Fait.**
- `packages/sandbox/src/docker-runner.ts` : adaptateur Docker du port `SandboxRunner`, options durcies de l'ancien runner de memory reprises sans extension ; un seul profil servi (`PROFILE_INVALID` sinon) ; client Docker en liste fermée d'environnement, `detached`, trois tubes ; client absent = `COMMAND_NOT_FOUND` ; conteneur `aos-sandbox-<uuid>`, et à l'arrêt groupe du client tué puis `docker rm -f` sur ce nom.
- `packages/sandbox/src/capped.ts` : `readCapped`, toute sortie lue d'une sandbox, au plus N octets, au-delà `OUTPUT_TOO_LARGE` et flux détruit ; décodage UTF-8 une fois le texte entier.
- `killGroup` sorti dans `process-group.ts`, partagé par les adaptateurs srt et Docker.
- `services/memory` : `SandboxContainerRunner` remplace `docker-runner.ts`. Il ne lance plus aucun processus : il demande au port, écrit l'entrée sur stdin, lit stdout et stderr bornés à 1 Mio (au-delà, `WORKER_OUTPUT_INVALID`, code de contrat existant), arrête la sandbox au délai ou au dépassement ; un port qui refuse de démarrer donne `WORKER_UNAVAILABLE`.
- Garde : l'exception `docker-runner.ts` de `child-process-only-in-sandbox` est retirée ; l'infrastructure d'un composant peut importer `packages/sandbox`, son domaine et son application non (deux fixtures ajoutées). `@architect-os/sandbox` est résolu vers ses sources comme `contracts` : sans quoi les scénarios dépendaient d'un `dist/` non versionné.

**Prouvé** (vrais processus, Linux et macOS en CI pour `features/sandbox`) : `canary.feature`, le vrai canari laisse démarrer, un canari qui dit la lecture permise, la connexion permise, ou rien, refuse le démarrage ; `spawn.feature`, un descendant qui ignore SIGTERM meurt avec sa sandbox, une sortie de 5 Mio est refusée au-delà de 1 Mio et la sandbox arrêtée, un enfant qui ferme stdin aussitôt ne fait pas tomber l'hôte qui y écrit 2 Mio. Témoin négatif du descendant, à la main : avec `kill(pid)` au lieu de `kill(-pid)`, le scénario échoue (« still running: S ») ; le descendant de la fixture est borné à 60 s pour qu'un tel mutant ne laisse pas de processus éternel. Adaptateur Docker sur un faux client exécutable : arguments durcis, refus de profil, client absent, entrée et sortie, code de sortie, environnement fermé, nom et retrait à l'arrêt. Le démon Docker réel reste à l'hôte qui en aura besoin (§6).

**CI de `8399053` rouge sur Linux, puis corrigée.** Règle 6 : entrées de dette d'un fichier supprimé (`services/memory/src/infrastructure/docker-runner.ts`) et de l'ancien `main()` de memory, retirées. Règle 5 : survivants dans les trois fichiers nouveaux et dans `main.ts`, sans scénario de la racine de composition. Correction à la cause, pas au registre (qui ne peut que rétrécir) :
- `main.ts` découpé en `runtimeOf` (variables requises, défauts), `start` (deux hôtes ; un port pris rejette, et l'hôte qui écoutait est refermé, au lieu d'attendre sans fin) et `serve` (code de sortie 0 ou 1, message sur stderr) ; `src/serve.ts` ne fait que lui passer le processus, `compose.yaml` le lance ; `CLAUDE.md` le dit. `main.feature` : 17 scénarios, dont le câblage réel vers un faux composant `data` et vers le faux client Docker (image, réseau, mémoire, PID, environnement, borne de 1 Mio).
- Docker : un descendant du client qui ignore SIGTERM meurt à l'arrêt et à la sortie du client, ce qui prouve `kill(-pid)` aussi sous Linux, où bwrap tuait l'arbre lui-même et masquait le mutant ; stdin fermé tôt sans chute de l'hôte ; environnement fermé du `rm` ; client dans un chemin avec espace (un shell le couperait). Écueil consigné : le faux client imprimait le pid avant que le descendant ait posé son gestionnaire SIGTERM, et `process.kill(pid, '')` envoie SIGTERM, si bien que le mutant tuait le descendant par course ; le pid n'est imprimé qu'une fois le descendant prêt.
- Simplifications d'équivalents plutôt que directives : environnement du client sans conditionnelle (spawn ne transmet pas une valeur indéfinie), trois tubes par défaut, `killGroup` sans garde (`kill(NaN)` lève, rattrapée). Une seule directive, sur `stdio: 'ignore'` du `rm` : un enfant en tube jamais lu émet `close` de même, vérifié à la main.
- `SandboxContainerRunner` : messages exacts, toute autre erreur de sortie repasse telle quelle (code `ISOLATION_UNAVAILABLE`, ou `OUTPUT_TOO_LARGE` d'une erreur qui n'est pas une `SandboxError`), et aucun timer laissé après un run.

**Prouvé.** Gate Linux local sur `31ad4eb` : règles 1 à 4, 6 et 7 vertes, un survivant (`main.ts`, `closeAll([])`), tué ensuite par un scénario où le port interne est pris. Mutation ciblée sur `docker-runner.ts`, `process-group.ts`, `sandbox-container-runner.ts`, `main.ts`, `serve.ts` et le canari, puis `replay --all` : 162 mutants rejoués, 0 divergence ; deux survivants restants, `compose({})` tué par le scénario du câblage `data` (témoin à la main : 1 échec), et le `stdio` du `rm`, équivalent, justifié. Chaque mutant visé a aussi son témoin négatif à la main : `+pid` (2 échecs), `SIGKILL` vide à la sortie (1), chaîne `error` de stdin (1), options du `rm` (1), `shell: true` (1), `clearTimeout` retiré (5), condition `OUTPUT_TOO_LARGE` (1), `instanceof` retiré (1).

**CI de `86d3dd1` : rouge sur Linux, test faux depuis l'origine.** Le scénario srt du descendant échoue au dry run de Stryker : « descendant 9 still running: I ». Sous Linux, srt (bwrap) donne au script son propre espace de pid : le pid qu'il imprime ne désigne rien sur l'hôte, ici un thread noyau (état `I`). Le scénario passait jusque-là parce que ce pid n'existait pas sur l'hôte : il ne prouvait rien sous Linux. Corrigé à la cause : le descendant porte un jeton unique dans son argv, et l'hôte le cherche dans chaque `/proc/<pid>/cmdline`, quel que soit l'espace de pid ; sous macOS, sans espace de pid, le pid reste vrai et `kill(pid, 0)` est gardé. Le script srt n'imprime lui aussi son pid qu'une fois le descendant prêt. Prouvé dans un conteneur Linux (node 26, bookworm) : scénarios Docker du descendant verts, et rouges sous le mutant `+pid` (2 échecs) ; le srt sous Linux ne démarre pas dans un conteneur imbriqué (canari sans verdict), sa preuve Linux est la CI.

**Reste de 1b.** 1b.2 broker (jetons par task, usage au registre), 1b.3 `data` en MCP, 1b.4 gateway, 1b.5 memory sous srt, 1b.6 retrait de compose ; la sortie de 1b est `escape.feature` sur Linux et macOS.

**Trois piliers.** Recherche : chaque propriété a son scénario sur de vrais processus, et son témoin négatif pour la plus critique. SSDLC (STRIDE de la brique) : déni de service par une sortie sans borne, fermé par `readCapped` ; élévation par un descendant qui survit, fermée par le groupe tué ; fuite par un canari faussement vert, fermée par le refus sans repli ; aucune dépendance ajoutée. Opérationnel : sans objet, aucune donnée sensible.

## 25. Brique 1b.2 : le broker, jetons par task, clé dans son seul fichier, usage par réponse, 5 novembre 2026

**Fait.**
- `modules/broker` : un nouveau composant aux mêmes couches. Domaine : `TokenTable` (un jeton accordé une seule fois, retiré, résolu). Application : `BrokerService`. Infrastructure : `readKeyFile` (fichier régulier, mode 0600 ou plus strict, une seule clé, relu à chaque requête, erreur qui nomme le fichier et jamais son contenu), `broker.json` validé par schéma (amont https, routes ancrées, port 1024 à 65535), relais. Présentation : serveur MCP stdio, outils `token_grant` et `token_revoke`, et usage remonté par `notifications/message`, logger `usage`. Racine : `start` et `serve`, qui finit quand son stdin finit.
- `packages/sandbox/src/auth-proxy.ts` : le relais de 1a.0 devient `startRelay`, partagé. Il prend une autorisation par clé présentée (`Grant {task, parent}`) et un schéma de transmission (`bearer` pour 1a.0, `x-api-key` pour le broker), et l'enregistrement porte task et parent. L'API de 1a.0 est inchangée et ses 90 scénarios restent verts.
- `packages/contracts/src/broker.ts` : schémas des outils, jeton `^[A-Za-z0-9_-]{32,128}$`, `UsageRecordSchema` strict.
- Garde : `modules/<nom>` est un composant ; le SDK MCP n'y est permis qu'en présentation et en infrastructure ; cinq fixtures.
- T-04R : profil cucumber `live` (`npm run broker:live`), hors de tout chemin compté, avec la clé lue dans le fichier que nomme `ANTHROPIC_TEST_KEY_FILE`.

**Gate Linux local sur `ee66cf0` : règle 5 rouge, 14 survivants.** Corrigés à la cause :
- Le relais transmettait `x-api-key` par un `else` : un schéma vide valait `x-api-key`. Il passe par une table, une entrée par schéma, et un schéma inconnu échoue.
- La course `'error'` contre `'listening'` était redondante, puisque `events.once` rejette déjà sur `'error'`. Elle est retirée, et le port pris donne toujours `EADDRINUSE`.
- Le code `TOKEN_TAKEN` n'était lu par personne : la classe devient `TokenTaken`, et son message est vérifié.
- Scénarios ajoutés :
  - le nom et la version du serveur vus par la gateway ;
  - un jeton précédé ou suivi d'un signe, refusé ;
  - un schéma `xhttps` ou `httpsx`, refusé ;
  - une bêta vide refusée, une bêta nommée acceptée ;
  - un fichier de clé terminé par un saut de ligne, accepté ;
  - un stdin qui finit pendant le démarrage : `serve` rend 0 et libère le port.
- Une directive : l'encodage de `readFileSync` dans `loadBrokerConfig` est équivalent, car sans encodage `readFileSync` rend un Buffer que `JSON.parse` lit en UTF-8 (vérifié à la main).

**Prouvé.**
- Les 691 scénarios de la suite sont verts, ainsi que typecheck, arch et prettier.
- Chaque survivant a été appliqué à la main, et chacun fait échouer au moins un scénario (11 sur 11) : `trim` (1 échec), `readableEnded` (1), nom (2) et version (2) du serveur, ancres du jeton (1 et 1), ancres du schéma d'amont (1 et 1), bêta `max(1)` (2), schéma vide (8), message du refus (2).
- Gate local complet après correction : Linux vert, règles 1 à 7 sans violation, 178 mutants dans le périmètre (165 tués, 5 en délai dépassé, 7 en erreur d’exécution, aucun survivant) ; macOS vert. La CI suit au push.
- T-04R :
  - sans fichier de clé, le scénario échoue avec un message explicite ;
  - avec une clé factice, il atteint `api.anthropic.com` et reçoit 401, ce qui prouve le chemin réseau ;
  - l'appel réel avec une clé d'essai est la commande du propriétaire, et son résultat sera consigné ici.

**Trois piliers.**
- Recherche : chaque propriété du broker a son scénario, et chaque mutant survivant son témoin négatif à la main.
- SSDLC (STRIDE de la brique) :
  - usurpation : sans jeton accordé, `401` ;
  - falsification : seul `POST /v1/messages*` passe, vers le seul amont, et la politique de 1a.0 s'applique ;
  - répudiation : un enregistrement par réponse, avec sa task et son parent ;
  - fuite : la clé ne quitte que son fichier 0600, aucune réponse ne la reflète, et un fichier ouvert à d'autres coupe la dépense (503) ;
  - élévation : un jeton n'est accordé qu'une fois, si bien que le coût d'une task ne se déplace pas.
  - R-11 : un relais dont le puits d'usage refuse s'arrête.
  - Dépendances : aucune ajoutée hors des versions déjà épinglées.
- Opérationnel : aucun secret dans la porte (`gate.yml` sans secret), ni dans un journal, ni dans le dépôt ; la clé d'essai du propriétaire n'a pas été lue.

## 26. T-04R sans commande manuelle : un workflow sur main, la clé dans un environnement restreint à main, 5 novembre 2026

**Demande du propriétaire.** Éviter les commandes manuelles pour l'appel réel du broker.

**Fait.**
- `.github/workflows/broker-live.yml` se déclenche par un push sur `main` qui touche le broker, chaque semaine, ou à la main, et jamais sur une pull request. Il a la permission `contents: read`, et son job ne tourne que si `github.ref` vaut `refs/heads/main`, dans l'environnement `broker-live`.
- Le secret `ANTHROPIC_TEST_KEY` n'entre que dans l'env d'une étape. Cette étape l'écrit avec `umask 077` dans un fichier temporaire du runner. `npm run broker:live` le lit, puis le fichier est retiré, même en cas d'échec. Sans le secret, le job échoue avec un message qui dit au propriétaire quoi créer.
- `features/descriptive/workflows.feature` :
  - le workflow est dans la liste commune : actions épinglées, `npm ci` sans scripts, checkout sans identifiants ;
  - ses règles sont vérifiées ;
  - sept copies cassées sont refusées : déclencheur `pull_request`, autre branche, sans environnement, sans condition `main`, permissions élargies, secret dans une ligne `run`, second secret ;
  - aucun autre workflow ne nomme l'environnement ni le secret.

  La suite passe à 700 scénarios verts.
- `docs/infrastructure.md`, `CLAUDE.md` et `platform-v3-srt.md` §2 le disent.

**Au propriétaire, une fois.** Créer l'environnement GitHub `broker-live`, avec une règle de branches de déploiement qui n'autorise que `main`. Y mettre le secret `ANTHROPIC_TEST_KEY`, une clé d'essai d'un espace de travail dont la limite de dépense est basse.

**Pas encore prouvé.** Le premier verdict réel de T-04R. GitHub n'exécute ce workflow que sur `main`, et `workflow_dispatch` ne vaut qu'une fois le fichier sur la branche par défaut : le verdict vient à la fusion de cette branche, et il sera consigné ici.

**Trois piliers.**
- Recherche : la règle du workflow a son scénario, et chacune de ses barrières un témoin négatif, une copie cassée refusée.
- SSDLC (STRIDE) :
  - fuite : le secret n'est jamais dans une PR, un fork, une autre branche ou une ligne `run` ; GitHub le masque dans les journaux ; le fichier est en 0600 puis retiré ;
  - élévation : `contents: read` seulement ;
  - risque restant, accepté et atténué : du code fusionné sur `main` s'exécute avec la clé. Il passe d'abord la revue et le gate, et la limite de dépense de l'espace de travail borne le coût.
  - Dépendances : aucune nouvelle, actions épinglées par SHA.
- Opérationnel : moindre privilège (environnement restreint à `main`, une seule clé d'essai) ; aucune clé lue par l'agent.

## 27. Brique 1b.3 : `data` en MCP, tables écrites déclarées, usage en append-only, relais de la gateway, 5 novembre 2026

**Fait.**
- Contrats (`packages/contracts/src/data-ops.ts`) :
  - chaque opération de `DATA_OPS` déclare les tables qu'elle écrit (`writes`) ;
  - deux opérations : `usage.append` (l'enregistrement du broker plus sa couche, `broker` ou `client`) et `usage.aggregate` (M2 : sommes par task, couche et modèle, 1 000 groupes au plus, 100 par défaut).
- `data` :
  - migration `0004_usage_records.sql`, en append-only : un UPDATE ou un DELETE d'une ligne, ou un TRUNCATE de la table, lève 55000 ;
  - `usage.append.sql` et `usage.aggregate.sql`. Un compte de tokens absent vaut 0, l'ordre est bytewise (`COLLATE "C"`, comme le store en mémoire) et les sommes sont en float8, car pg rend un bigint en chaîne ;
  - le chargeur de `operations.json` compare les tables que le SQL de chaque opération écrit (INSERT, UPDATE, DELETE, TRUNCATE, MERGE, commentaires retirés, `FOR UPDATE` et `DO UPDATE` exclus) à sa déclaration, et refuse un écart ;
  - serveur MCP généré depuis `DATA_OPS` (`src/presentation/mcp-server.ts`) : un tool par opération, sans aucun tool qui prenne du SQL. Un refus rend son code nommé ; une panne du store rend `INTERNAL`, sans son message ;
  - entrée stdio `src/serve-mcp.ts` (`serveStdio`) : MCP seul sur stdout, journal sur stderr, 0 à la fin du stdin, 1 si le store ne s'ouvre pas ;
  - l'API HTTP reste jusqu'au retrait de compose (1b.6). Son processus passe dans `src/serve-http.ts`, sans logique, et compose le lance ; `serveHttp` est couvert.
- Gateway :
  - ports `BrokerControl`, `UsageSink` et `Scheduler`, chacun avec son adaptateur en mémoire ;
  - cas d'usage `UsageForwarder` : chaque enregistrement du broker est écrit avec la couche `broker`. Quand une écriture trouve `data` indisponible, la gateway retire les jetons de toutes les tasks, perd les enregistrements reçus entre-temps (R-9) et sonde `data` à intervalle fixe ; à son retour, elle réémet les jetons des tasks encore ouvertes. Une task ouverte pendant la panne reçoit son jeton au retour ; une task retirée n'est jamais réémise ;
  - adaptateurs MCP `McpUsageSink` et `McpBrokerControl`, plus `onUsage` (seul le logger `usage` passe) et `TimerScheduler`.
  - Le lancement des enfants et le câblage dans `gateway/src/main.ts` restent à 1b.4.
- Garde : le SDK MCP est permis dans la présentation et l'infrastructure de `data`, avec deux fixtures qui le refusent dans son domaine et son application.

**Décisions.**
- La couche est posée par l'écrivain, pas par le broker : la gateway pose `broker` ; `client` viendra du hook M1 de 1c. Le contrat du broker reste inchangé.
- `data` est indisponible quand le `tools/call` échoue (transport fermé) ou quand il rend `INTERNAL` (store injoignable). Un autre refus est une réponse : l'enregistrement est refusé et `data` reste disponible.
- La sonde du retour de `data` est une lecture de son store (`usage.aggregate`, 1 groupe), parce qu'un ping de la session MCP ne prouverait pas que Postgres répond.

**Prouvé.**
- Scénarios :
  - `features/integration/usage.feature`, de bout en bout : vrai broker, vrai serveur MCP de `data`, relais de la gateway et faux amont. Un appel laisse un enregistrement par réponse, sommé par task, couche et modèle. `data` absent : l'appel suivant reçoit 401 et l'enregistrement est perdu. Au retour de `data`, le jeton dépense à nouveau. Les contrats des ports `UsageSink` et `BrokerControl` passent sur leurs deux adaptateurs ;
  - `gateway/features/usage-forwarder.feature` : couche posée, refus, panne, sonde, réémission, écritures concurrentes (chaque jeton révoqué une seule fois), task retirée puis rouverte pendant la réémission, autre erreur pas prise pour une panne, autre logger non transmis ;
  - `data/features` : agrégation sur les deux stores, Postgres compris ; UPDATE, DELETE et TRUNCATE refusés par la base (55000) ; tables écrites lues dans neuf formes de SQL ; une écriture non déclarée et une déclaration non écrite, refusées au chargement ; serveur MCP (liste exacte, refus nommés, `INTERNAL` sans fuite, stdio, Postgres réel).
- Témoin négatif à la main : sans la révocation de `down()`, le scénario de bout en bout échoue (« not within 2 s: a 401 of the broker »).
- Gate, commit par commit (le gate ne juge que le diff d'un commit contre son premier parent) :
  - `8e30c4b` : rouge, 19 survivants (dont les 2 du canari, attendus) ;
  - `3996b9d` : jamais passé seul (ma redirection pointait vers un chemin invalide, `npm run gate` n'a pas tourné) ;
  - `c844dc3` : vert ;
  - `f281d5a` : jugé seulement dans le gate de toute la brique ci-dessous ;
  - `61518f7` (format) : vert, 767 scénarios ;
  - ce commit du journal : documentation seule.
- Toute la brique en un seul gate, dans un worktree jetable avec un commit squashé de `ef3e19e` à `f281d5a` :
  - mutation : 293 mutants dans le périmètre, 275 tués, 10 en délai dépassé, 7 en erreur d'exécution, 1 ignoré, aucun survivant ; règles 5, 6 et 7 sans violation ;
  - règle 2 rouge : un fichier de steps n'était pas formaté, corrigé par `61518f7`.
- Aucun run squashé n'a encore donné un verdict tout vert après la correction de format. L'argument, et non un run : `61518f7` ne change que le format d'un fichier de steps, sans aucune ligne de production, et ne peut donc pas changer un verdict de Stryker ; son propre gate est vert.
- Ce que la CI prouvera : `gate.yml` compare la tête au premier parent. Elle ne jugera donc que le dernier commit, du texte, et ne prouve rien de la brique : d'où le gate squashé local. Le run complet hebdomadaire `mutation-full.yml` mute tout le code de production : un survivant absent du registre de dette, par exemple l’un des 31 retirés par cette brique s’il revenait, le rend rouge.
- Rouges rencontrés en route, corrigés à la cause :
  - 17 survivants (messages non vérifiés, refus de `data` repéré par l'ordre des clés de son JSON, tri, couche `client`, enregistrement reçu entre le retour de `data` et la sonde, stdin déjà lu) ;
  - règle 6 : la dette décalée par du code ajouté au-dessus. Le nouveau code passe après les lignes à dette ; les adaptateurs d'usage de la gateway vont dans `in-memory-usage.ts` ; les entrées de l'ancien `main()` HTTP sont retirées, son code n'existant plus ; la dette `exclude(['running'])` est payée par un scénario ;
  - règle 7 : 14 « tués » de Stryker démentis par le rejeu (les `\s+` du lecteur de tables, la comparaison des tables, la fin du pool). Chacun a désormais un scénario qui le tue, vérifié à la main (12 sur 12) ;
  - mon propre défaut : un `| tail` dans la commande de commit masquait un contrôle de format en échec.

**Trois piliers.**
- Recherche : chaque propriété de la ligne 1b.3 a son scénario, et chaque barrière son témoin négatif (copie cassée refusée, mutant tué, révocation retirée à la main).
- SSDLC (STRIDE de la brique) :
  - falsification : registre en append-only par la base ; tables écrites déclarées et vérifiées au chargement. Le refus à l'opération par `writes_tables` vient en 1b.4 ;
  - répudiation : aucun chemin UPDATE ni DELETE vers `usage_records`, et seul `usage.append` l'écrit (scénario) ;
  - fuite : un enregistrement ne porte ni contenu, ni clé, ni jeton (schéma strict, refus d'un champ `content`) ; une panne du store rend `INTERNAL` sans le message de la base ;
  - déni de service : agrégat borné à 1 000 groupes ; sonde à intervalle fixe ; `data` absent coupe la dépense (401) au lieu de la laisser sans trace ;
  - usurpation et élévation : un jeton réémis garde sa task et son parent ; une task retirée n'est jamais réémise.
  - Limite connue : une écriture cachée dans une fonction SQL échappe à la lecture des tables. Les droits de base par module de la brique 4 la ferment.
  - Dépendances : `@modelcontextprotocol/sdk` 1.32.2 ajouté à `data`, même version épinglée que la gateway et le broker ; lockfile à jour.
- Opérationnel : aucun secret lu ni écrit ; IRB sans objet, aucune donnée humaine (des comptes de tokens).

## 28. Brique 1b.4 : topologie validée, identifiants d'appel, bornes de task, modules lancés et relancés, 6 novembre 2026

**Fait.**
- Contrats (`packages/contracts/src/modules.ts`, `ids.ts`, `data-ops.ts`) :
  - manifeste de module, catalogue écrit par `manifest-registry`, serveurs de `topology/modules.mcp.json` (stdio seul, `type: http` refusé) et profils clients, validés ensemble par `TopologySchema` ; une topologie qui enfreint une règle est refusée entière ;
  - règles : un tool `agent` n'est jamais stable et exige le bloc `agent`, pas d'appel de soi, pas de cycle de `calls_allowed`, pas de module appelé qui n'existe pas, une table a un seul écrivain, une adresse `domaine.tool` est unique, chaque module a son serveur et chaque serveur son module, un profil ne voit que des modules du catalogue ;
  - registre des tasks : `tasks.open`, `tasks.end` et `tasks.get`, avec la fin parmi terminée, délai, nombre d'appels, annulée, erreur.
- `data` : migration `0005_tasks.sql`, où une task se termine une fois et n'est jamais supprimée (déclencheurs, 55000), plus les trois opérations, sur les deux stores.
- Fichiers décrits : `topology/modules.mcp.json` (vide jusqu'au premier module, brique 1b.5) et `topology/clients.json` (le profil du propriétaire).
- Gateway, domaine et application (`gateway/src/domain/routing.ts`, `gateway/src/application/task-router.ts`) :
  - `TaskRouter` ouvre une task sous un profil : registre, jeton au broker, échéance ;
  - chaque appel de module reçoit un identifiant d'appel neuf, relié à sa task, son module, sa profondeur et son échéance, et invalide à son retour ;
  - un module rappelle avec cet identifiant, vers un module de son `calls_allowed` ou vers une opération de `data` dont les tables sont dans son `writes_tables` ;
  - refus nommés : `UNAUTHORIZED`, `UNKNOWN_TASK`, `UNKNOWN_TOOL`, `FORBIDDEN_CALL`, `FORBIDDEN_WRITE`, `DEPTH_EXCEEDED`, `DEADLINE_EXCEEDED`, `MAX_CALLS_EXCEEDED`, `TASK_ENDED`, `UNKNOWN_PROFILE` ; chaque appel et chaque refus est journalisé avec son code ;
  - fin de task, par le délai, par le nombre d'appels, par le client ou par l'annulation du propriétaire : appels en vol annulés et identifiants invalidés, jeton retiré, sandboxes de la task arrêtées, fin écrite au registre, task oubliée.
- Gateway, infrastructure :
  - `ModuleHost` lance chaque module par le `SandboxRunner` à son premier appel, et parle MCP sur son stdio (`StreamClientTransport`), l'identifiant d'appel dans `_meta`, l'échéance en `signal` et en `timeout` de la requête ;
  - un module dont la sandbox a fini est relancé à son appel suivant ; après 3 lancements de suite sans réponse, il est `SERVICE_UNAVAILABLE` pour la vie de la gateway ;
  - un module qui écrit autre chose que du MCP est arrêté et compte comme un lancement raté ;
  - `McpTaskRegistry` et `McpDataClient` sur le serveur MCP de `data`, `RandomIds`, `TaskSandboxGroups`, et `loadTopology` qui lit les trois fichiers et les valide ensemble ;
  - `composeRouting` (`gateway/src/main.ts`) compose le tout.

**Décisions.**
- « Sandbox jamais relancée » vise la sandbox d'une task, son worker : une task finie ne repart pas. Un module, partagé entre tasks, est relancé à son appel suivant, dans la limite de 3 lancements de suite sans réponse.
- Le compteur de lancements repart de zéro à chaque réponse ; un module épuisé reste indisponible jusqu'au redémarrage de la gateway, ce qui coupe une boucle de plantages.
- L'appel au-delà du nombre maximal d'appels du profil termine la task (`max_calls`) et est refusé.
- La fin d'une task exécute ses trois effets (jeton, sandboxes, registre) quoi qu'il arrive à l'un d'eux. Si `data` est indisponible, la task reste finie pour la gateway, et l'échec est journalisé avec son code. Rattraper une task restée ouverte au registre est prévu à la brique 3, avec l'executor.
- Un module qui répond après l'annulation de son appel n'est pas routé ; son appelant reçoit le refus.
- Le client nomme sa task ; la présentation la tirera de ce que le client présente, son jeton (brique 3). Un module ne nomme jamais sa task : elle vient de son identifiant d'appel.

**Prouvé.**
- Scénarios :
  - `features/descriptive/manifest.feature` : la topologie de fixture et les fichiers commités tiennent ; chaque règle a sa copie cassée refusée, avec son message ; chaque format et chaque énumération a sa ligne acceptée et sa ligne refusée ;
  - `data/features` : tasks sur les deux stores, Postgres compris ; une task ne se termine qu'une fois, ne change plus ensuite et n'est jamais supprimée (55000) ; sorties conformes au schéma ; les cinq fins, et les entrées hors schéma refusées, sur le serveur MCP ;
  - `gateway/features/gateway.feature` (29 scénarios) :
    - identifiant neuf, invalide au retour ; profondeur ; échéance du parent ;
    - refus nommés et journalisés : module hors profil ou hors `calls_allowed`, table hors `writes_tables`, opération inconnue, au-delà de la profondeur, après l'échéance, identifiant inconnu, rendu ou qui n'en est pas un (jeton, nom de task) ;
    - fin par le délai, par le nombre d'appels, par le client ou par le propriétaire : appels en vol annulés, jeton retiré, sandboxes arrêtées, fin écrite une fois. Aucun module n'est atteint ensuite, celui nommé `verify` compris, et la fin n'est jamais `completed` ; le vrai validateur `verify` n'existe pas encore (brique 3) ;
    - la fin d'une task laisse les appels d'une autre task en vol ; un module qui répond après son annulation n'est pas routé ; avec `data` indisponible à la fin, jeton et sandboxes finissent quand même et l'échec est journalisé ;
  - `gateway/features/adapters.feature` : contrat de chaque nouveau port sur chacun de ses adaptateurs (en mémoire, MCP, `UsageForwarder`, `RandomIds`, `TaskSandboxGroups`), avec `data` absent ou sans store ;
  - `features/integration/gateway.feature` : des modules qui sont de vrais serveurs MCP du SDK, dans de fausses sandboxes ; `data` réel sur son store en mémoire :
    - identifiant dans `_meta` ; annulation reçue par le module à l'échéance ; réponses transmises telles quelles (erreur, contenu structuré, sans contenu, sans texte) ;
    - un lancement pour deux appels simultanés ; relance après une mort ; `SERVICE_UNAVAILABLE` après 3 lancements ratés, sans quatrième ; compteur remis à zéro par une réponse ; module qui écrit autre chose que du MCP arrêté ; arrêt de tous les modules ;
    - fin écrite au registre de `data` ; topologie invalide refusée sans aucun lancement.
- Gate, commit par commit, chacun amendé localement avant d'être poussé :
  - contrats : rouge (72 survivants), puis vert (270 mutants, 0 survivant) ;
  - gateway, domaine et application : rouge (37 survivants, 1 non couvert), rouge (1), puis vert (273 mutants, 0 survivant) ;
  - infrastructure : rouge (31 survivants, 10 non couverts), rouge (1), puis vert (136 mutants, 0 survivant).
- Gate de la brique entière, dans un worktree jetable, avec un commit écrasé `a197c79..0cefecc` : vert ; 901 scénarios exécutés, soit 767 de base et 134 ajoutés ; 17 fichiers, 679 mutants, aucun survivant ; règles 1 à 7 sans violation.
- Témoins négatifs à la main, en plus du gate : 8 mutants du routeur et 7 de l'hôte des modules, tous tués. Le retrait de la fermeture sur un flux non MCP bloque la suite de tests ; Stryker le compte comme un délai dépassé.
- Rouges rencontrés en route, corrigés à la cause :
  - messages et listes non vérifiés ;
  - mutants équivalents retirés par simplification : détection de cycle réécrite, refus de zod en forme chaîne, garde et écoute en double du transport ;
  - annulation rendue déterministe (`Call.cancelled`) au lieu d'une course entre deux rejets ;
  - dette de `gateway/src/domain/errors.ts` payée : le nom `GatewayError` est vérifié à chaque refus. Le registre passe de 598 à 597 entrées.

**Pas fait dans cette brique, avec son étape.**
- Le canal de rappel des modules, MCP sur HTTP en `127.0.0.1:8080`, avec l'identifiant d'appel comme jeton, et le profil srt `module` : brique 1b.5, avec le premier module réel (`manifest-registry`). Le routage qu'il appellera, `TaskRouter.call` et `TaskRouter.operate` avec un identifiant d'appel, est prouvé ici.
- Le serveur MCP de la gateway sur les flux de chaque sandbox de task, pour l'executor et le worker : briques 1b.5 (worker) et 3 (executor).
- `maxTurns` : brique 1b.5, avec le worker agent.
- Le câblage de `composeRouting` dans le processus de la gateway : brique 1b.5, quand le catalogue cesse d'être vide.

**Trois piliers.**
- Recherche : chaque case de la sortie de la ligne 1b.4 a son scénario, sauf `maxTurns`, prévu à la brique 1b.5 avec le worker. Chaque barrière a son témoin négatif : copie cassée refusée, mutant tué, panne injectée.
- SSDLC (STRIDE de la brique) :
  - usurpation : la task et l'appelant viennent de l'identifiant d'appel, jamais d'un argument. Un identifiant inconnu, rendu ou qui n'en est pas un (jeton, nom de task) est refusé (`UNAUTHORIZED`). Les identifiants sont des UUID aléatoires, sans valeur hors de leur appel (R-10 inchangé) ;
  - falsification : écriture hors `writes_tables` refusée à l'opération (`FORBIDDEN_WRITE`) ; topologie validée entière (un écrivain par table, pas de cycle, pas d'appel de soi), invalide = rien n'est lancé ;
  - répudiation : chaque appel, chaque refus et chaque fin de task est au journal avec son code ; la fin est au registre, une seule fois, jamais supprimée (déclencheurs) ;
  - fuite : un module qui échoue rend `INTERNAL` au journal ; une réponse après annulation n'est pas routée. Le rappel, et la question de ce qu'il expose, est prévu à 1b.5 ;
  - déni de service : délai, nombre d'appels et profondeur par task, échéance par appel ; une boucle de plantages est coupée après 3 lancements ; un module hors protocole est arrêté ; deux appels simultanés ne lancent qu'une sandbox ;
  - élévation : un profil ne voit que ses modules, un module que son `calls_allowed` ; l'annulation est réservée au profil propriétaire ;
  - dépendances : la gateway dépend désormais de `@architect-os/sandbox` (paquet du dépôt, déjà dans l'image) ; aucune dépendance externe ajoutée ; lockfile à jour.
- Opérationnel : aucun secret lu ni écrit ; les sandboxes des tests sont des fausses en mémoire, sans réseau ; IRB sans objet, aucune donnée humaine.

## 29. Brique 1b.5 : module `memory` et worker sous srt, `agents/memory.md`, rappel en `127.0.0.1`, `recall` de bout en bout, 7 novembre 2026

**Fait.**
- Contrats (`packages/contracts`) :
  - `evidence` bornée (décision 3) dans `WorkerOutputSchema` et dans un `Result` : 50 preuves au plus, `source` 64, `ref` 256, `excerpt` 2000 caractères ;
  - `TaskInputSchema`, ce que `task_input` rend au worker : le tool, son entrée et `max_turns`, sans budget en dollars (décision 11) ;
  - `AgentFileSchema`, le frontmatter d'un profil de task `agents/<nom>.md`.
- Fichiers décrits :
  - `topology/catalog.json` : module `memory` (tools `search` et `insert`, sorte data, écrivain de `memory.memories`) et module `memory-agent` (tools `recall` et `remember`, sorte agent, profil `memory`, haiku au moins, 8 tours, `calls_allowed: [memory]`) ;
  - leurs schémas sous `modules/<module>/schemas/`, leurs serveurs dans `topology/modules.mcp.json`, le profil propriétaire qui voit `memory-agent` ;
  - `agents/memory.md`, le profil de task du worker ;
  - les profils srt `module` (réseau : le rappel de la gateway seul ; `GATEWAY_CALLBACK_URL` ; `NODE_USE_ENV_PROXY=1`) et `worker` (réseau : le broker seul ; le jeton de la task comme clé).
- Sandbox : un processus de la plateforme tourne dans un cwd jetable 0700, dans le dossier de sa sandbox, retiré avec elle ; il lit la racine de la plateforme et n'y écrit jamais.
- Gateway :
  - un tool de sorte agent lance son worker une fois pour son appel (`WorkerSession`, `WorkerHost`) : sandbox `worker` par exécution, jeton de la task en variable du profil, gardée avec la task ;
  - sur les flux du worker, la gateway sert `task_input`, `call` (relais sous l'identifiant de l'appel servi) et `task_complete` (sortie prise une fois, validée par le contrat du worker et celui du tool) ;
  - `max_turns` atteint termine la task (fin `error`, refus `MAX_TURNS_EXCEEDED`) ; l'échéance est la plus courte du parent, du module et de l'agent ;
  - l'hôte de rappel des modules : MCP sur HTTP, `POST /mcp` en `127.0.0.1`, l'identifiant d'appel en jeton porteur, `401` sinon ; une opération de `data` va à `operate`, une adresse de module à `call` ;
  - `BrokerTaskTokens` : le jeton d'une task accordé au broker à l'ouverture, révoqué à la fin.
- Module `memory` (`modules/memory`) : serveur MCP sur son stdio ; chaque tool rappelle son opération de `data` avec l'identifiant reçu dans `_meta.call` ; sans identifiant, rien n'est rappelé.
- Worker v3 (`services/memory/worker/task-*.ts`, `infrastructure/`) : client MCP sur son propre stdio, profil de task comme fil principal du SDK (`agent`, `agents`), `maxTurns`, sortie structurée, preuves coupées à leurs bornes.
- Le gate et `npm test` construisent d'abord (`tsc -b`) : la plateforme lance ses modules et ses workers depuis leurs points d'entrée construits.

**Décisions.**
- Topologie à deux modules, choix du propriétaire : `memory` (données) et `memory-agent` (agent, qui appelle `memory`).
- **Mode additif, décision du propriétaire** : rien n'est retiré tant que les trois environnements hôtes (macOS, Linux, Windows) ne sont pas viables. Le retrait de `internal-http.ts`, prévu à la ligne 1b.5 du plan, est donc reporté ; le service memory v2, le worker Docker et `compose.yaml` restent en état de marche. La gateway reste un processus séparé (§9.1 A) ; seul son câblage v2 partira.
- `max_turns` atteint termine la task en `error` ; le `Result` de l'appel garde `WORKER_FAILED`, `MAX_TURNS_EXCEEDED` n'étant pas un code de `Result` ; le refus `MAX_TURNS_EXCEEDED` et la fin sont du routeur.
- Le jeton de la task arrive au worker par une variable de son profil, jamais dans un message MCP ni au journal.
- Variables de profil : `${worktree}` est le cwd jetable, `${repo}` la racine de la plateforme.
- Le dossier de la clé du broker, `${home}/.config/architect-os`, est en `denyRead` dans tous les profils, `builder` compris (correction).
- Trois faits sondés contre un faux modèle local, chacun corrigé à sa cause :
  - les tools d'un agent en fil principal retirent `StructuredOutput` : l'adaptateur le lui donne avec ses tools ;
  - Claude Code refuse le `$schema` du draft 2020-12, défaut de zod : le schéma de sortie vise draft-07. L'ancien `sdk-agent.ts` porte le même défaut, latent, puisqu'il n'a jamais tourné contre le vrai CLI ;
  - avec les tools de l'agent et `settingSources: []`, ni `strictMcpConfig`, ni `tools: []`, ni `permissionMode` ne changent ce qui est offert au modèle. Un `.mcp.json` intrus n'est pas chargé, et un appel `Bash` jamais offert est refusé. Ces trois options ne sont plus posées ; le plancher est la liste des tools de l'agent, et la frontière la sandbox `worker`.
- Un CLI qui sort sans message `result` termine le flux sans erreur (sondé) : l'adaptateur le refuse (`WORKER_FAILED`) ; son exécutable est une option de configuration (`pathToClaudeCodeExecutable`).

**Prouvé.**
- Scénarios :
  - `packages/contracts/features/tools.feature` : 50, 64, 256 et 2000 acceptés, 51, 65, 257 et 2001 refusés, dans une sortie de worker et dans un `Result` ;
  - `features/descriptive/manifest.feature` : catalogue, schémas (chacun égal au schéma JSON de son contrat), et chaque module agent dont le serveur nomme `agents/<profil>.md`, un profil de ce nom ;
  - `packages/sandbox/features/platform-profiles.feature` : profils `module` et `worker`, valeurs exactes, copies cassées refusées ;
  - `features/sandbox/srt-runner.feature`, sous vrai srt : cwd jetable 0700, retiré ; la racine se lit et ne s'écrit pas ;
  - `gateway/features/agent-tools.feature` : exécution unique, relais à profondeur 2, refus hors `calls_allowed`, sorties hors contrat, 50 contre 51 preuves, sortie absente ou donnée deux fois, `max_turns`, échéance 1499 contre 1500 ms, worker qui ne démarre pas ;
  - `gateway/features/worker-host.feature` : lancement unique avec le jeton, liste exacte des tools, relais et refus, annulation, sortie du worker ;
  - `gateway/features/callback-host.feature` : `401` sans jeton, avec un jeton inconnu ou sous un autre schéma ; réponses en JSON ; `operate` et `call` sous l'identifiant ; refus et erreurs transmis ;
  - `modules/memory/features/memory-module.feature` et `services/memory/features/task-worker.feature` : rappel sous l'identifiant, rien sans lui ; profil de task et ses copies cassées ; preuves coupées à leurs bornes ; canal MCP du worker ;
  - `features/integration/agent-worker.feature` : vrai SDK, vrai CLI, faux modèle en boucle locale. Prompt du profil, haiku, outils offerts, résultat d'outil renvoyé au modèle, `max_turns` réel, sortie jamais structurée, API en 400, sortie qui casse son schéma, CLI muet, aucune transcription de session ;
  - **sortie attendue de la ligne 1b.5**, `features/sandbox/recall.feature`, sous vrai srt : `recall` de bout en bout, le module `memory` et le worker de `memory-agent` dans leurs profils, depuis la topologie commitée. Le faux modèle ne reçoit que la clé du broker, jamais le jeton de la task ; la preuve est la mémoire insérée ; à la fin de la task, la sandbox du worker est arrêtée et le broker refuse le jeton.
- Gate, commit par commit, chacun amendé localement :
  - contrats et fichiers décrits : vert ;
  - sandbox : rouge (littéral `'work'`), puis vert ;
  - outils agent de la gateway : rouge, puis vert (101 mutants, 0 survivant) ;
  - infrastructure : rouge (66 survivants, 9 non couverts), rouge (3), puis vert (401 mutants, 0 survivant) ;
  - `recall` de bout en bout : vert.
- Gate de la brique entière, dans un worktree jetable, avec un commit écrasé `1e3b0d5..ae5e1dc` : vert ; 1020 scénarios exécutés, soit 901 de base, 120 ajoutés et 1 retiré ; 25 fichiers, 518 mutants, aucun survivant ; règles 1 à 7 sans violation.
- Rouges corrigés à la cause : littéraux non vérifiés (identités MCP, descriptions, schémas des tools), branches non couvertes, et code sans effet retiré après sondage ou lecture de la source :
  - `catch` et fermeture de l'hôte de rappel : Hono répond lui-même 500, et le transport en JSON ne garde aucun flux ;
  - `once` d'un `AbortSignal` ;
  - filtre des tools, déjà fait par l'agent ;
  - les trois options du SDK sans effet.
- Processus de test périmés trouvés et arrêtés : quatre sandboxes srt du 4 novembre, issues de runs de mutation antérieurs (un mutant de l'arrêt laisse un enfant qui ignore SIGTERM). Aucune ne venait de 1b.5.

**Pas fait dans cette brique, avec son étape.**
- **Preuve Windows** (WSL2 avec srt, ou Docker natif), avant tout retrait : étape « Hôtes », brief remis au propriétaire le 6 novembre, à exécuter sur son poste Windows ; sa place au plan, avant 1b.6, est à décider par le propriétaire avec son résultat.
- Retrait de `internal-http.ts`, du service memory v2 et du worker Docker : après la preuve des trois hôtes, avec 1b.6 (`compose.yaml`).
- Le câblage de `composeRouting`, de `WorkerHost`, de l'hôte de rappel et de `BrokerTaskTokens` dans le processus natif de la gateway : avec le choix de l'hôte, même étape. Le scénario `recall.feature` compose déjà exactement ces pièces.
- `manifest-registry`, qui écrirait le catalogue : aucune brique ne le porte ; le catalogue est écrit à la main dans son format, et `manifest.feature` le valide.
- Le gabarit de base `denyRead: ["~"]` est remplacé par la liste du profil `builder` ; le test d'évasion appartient à `escape.feature`, à la sortie de 1b.
- `remember` de bout en bout sous srt : son chemin est le même que `recall` (même worker, `memory.insert`) et est prouvé en processus ; un scénario srt lui sera ajouté avec 1b.6.

**Trois piliers.**
- Recherche : chaque case de la sortie de la ligne 1b.5 a son scénario, `recall` sous vrai srt compris ; chaque barrière a son témoin négatif (copie cassée refusée, mutant tué, panne injectée). Les faits du SDK sont établis par sondage reproductible contre un faux modèle, `features/support/fake-model.ts`, et chacun est fixé par un scénario.
- SSDLC (STRIDE de la brique) :
  - usurpation : le module présente l'identifiant de l'appel qu'il sert, sinon `401` avant tout MCP ; le worker ne nomme rien, son identité est son flux ;
  - falsification : sortie du worker validée deux fois (worker, tool), prise une fois ; écriture hors `writes_tables` refusée ;
  - répudiation : chaque appel, refus et fin de task au journal et au registre ;
  - fuite : le jeton de la task ne quitte pas le worker vers le modèle (prouvé : seul le broker parle à l'amont, avec sa clé) ; aucun secret dans les profils, les tests ni le dépôt ; la clé du broker du test est factice, dans un fichier jetable ;
  - déni de service : `max_turns`, échéance, nombre d'appels ; un worker annulé est arrêté, sa sandbox finie avec sa task ;
  - élévation : réseau du module limité au rappel, du worker au broker ; la racine de la plateforme se lit sans s'écrire ; les tools offerts au modèle sont ceux du profil de task seuls ;
  - dépendances : `yaml` 2.9.1 épinglé pour le worker, déjà dans le lockfile ; nouveau paquet du dépôt `@architect-os/module-memory` ; aucune dépendance externe nouvelle.
- Opérationnel : aucun secret lu ni écrit, aucune clé réelle ; le faux modèle et le broker écoutent en boucle locale ; IRB sans objet, aucune donnée humaine.

## 30. Mesure A : le surcoût de la structure, isolation et `recall`, sans coût de modèle, 7 novembre 2026

**Question du propriétaire.** Avec 1b.5, refaire des mesures pour montrer l'intérêt de la structure. Partage retenu : A, ce que la structure coûte en temps, gratuit et reproductible ; B, ce qu'elle fait gagner en coût de modèle, avec un vrai modèle, plus tard et sur accord.

**Fait.**
- Protocole et hypothèses commités avant toute mesure (`baseline/README.md`, commit `eb2cca5`), seuils compris.
- Banc : `npm run baseline:overhead`, puis `npm run baseline:overhead-analyze -- <fichier>`. Il réutilise exactement ce que prouvent les scénarios, sorti dans `features/support` :
  - `srt-platform.ts`, la plateforme de `features/sandbox/recall.feature` ;
  - `inproc-worker.ts`, l'appel en processus de `features/integration/agent-worker.feature`.
- Faux modèle en boucle locale, script cyclique (une recherche, puis la sortie structurée) : aucun token dépensé.
- Docker : image `node:26-bookworm-slim` épinglée par digest.
- Chaque `recall` est vérifié avant d'être compté (statut, données, preuve = la mémoire insérée).
- Répétition à 2 mesures, puis campagne ; les deux fichiers restent dans `baseline/results/`.

**Résultats** (`baseline/results/overhead-2026-11-07T08-21-20-467Z.jsonl`, analyse `.md` à côté). Apple M4, macOS (Darwin 27), Node 26.11.1, srt 0.0.81, Docker 28.3.3 (VM Colima déjà démarrée), Claude Code 2.1.312. 30 mesures par configuration après 2 de chauffe, aucun échec.

| Configuration | Médiane | p10 | p90 |
|---|---|---|---|
| `iso-none` | 132 ms | 119 ms | 140 ms |
| `iso-srt` | 668 ms | 655 ms | 697 ms |
| `iso-docker` | 108 ms | 97 ms | 124 ms |
| `recall-inproc` | 301 ms | 295 ms | 342 ms |
| `recall-srt-warm` | 1 000 ms | 982 ms | 1 040 ms |
| `recall-srt-cold` | 1 771 ms | 1 746 ms | 1 796 ms |

Écarts de médianes, intervalle à 95 % par bootstrap (10 000 tirages, graine 42) :
- démarrage sous srt, canari compris : + 536 ms (529 à 551) ;
- démarrage sous Docker : − 24 ms (− 29 à − 16) ;
- H1 : srt − Docker = + 560 ms (553 à 574), seuil < 0 : **mesure invalide pour H1, aucune conclusion** (correction ci-dessous) ;
- **H2, tient** : `recall` sous srt, module chaud, moins en processus = + 700 ms (686 à 709), seuil < 1 000 ms ;
- **H3, tient** : premier appel, qui lance le module, = + 771 ms (751 à 782), seuil < 1 000 ms.

**Correction du propriétaire.** La comparaison de H1 n'a pas de valeur :
- elle opposait un srt froid (sandbox créée de zéro, canari à chaque lancement, comme le veut la conception) à un Docker chaud (VM Colima et démon déjà démarrés, seule la création du conteneur chronométrée) ;
- une comparaison ne vaut que si les deux environnements sont froids par défaut ;
- l'inverse, un srt chaud, n'a pas d'intérêt : la sandbox meurt après chaque exécution, sans reprise de session, pour bloquer la contamination.

H1 n'est donc ni réfutée ni confirmée ; ma première lecture, « réfutée », est retirée. H2 et H3 comparent srt à srt et restent valides. Le protocole amendé est dans `baseline/README.md`, à côté de l'original, qui n'est pas réécrit.

**H1 amendée, les deux froids** (amendement accepté par le propriétaire avant toute mesure, commit `3499901` ; résultats `baseline/results/overhead-2026-11-07T09-36-52-336Z.jsonl`, analyse `.md` à côté) :
- protocole : à chaque exécution, une VM Colima dédiée (`aos-bench`, 2 cœurs, 2 Gio) est démarrée, le conteneur lancé, puis la VM arrêtée, les trois étapes chronométrées ; l'image reste sur le disque de la VM, comme Node sur celui de l'hôte pour srt ; Colima tourne avec son propre dossier de configuration Docker, et le contexte de l'hôte (`colima-ci-autonome`) n'a pas bougé ;
- 30 mesures par configuration après 2 de chauffe, en alternance, aucun échec ;
- `iso-srt` : médiane 686 ms (p10 652, p90 730) ; `iso-docker-cold` : médiane 17 870 ms (p10 16 637, p90 18 395) ;
- **H1 amendée, tient** : srt − Docker froid = − 17 184 ms (− 17 326 à − 17 096), seuil < 0 ; srt froid démarre environ 26 fois plus vite que Docker froid sur cet hôte.

**H1 amendée sous Linux**, le froid étant le démon arrêté (décision du propriétaire avant toute mesure, commit `75c35a7` ; résultats `baseline/results/overhead-2026-11-07T12-10-43-525Z-linux.jsonl`, analyse `.md` à côté) :
- hôte : la VM dédiée `aos-bench`, Ubuntu 24.04, noyau 6.8, 2 cœurs, 2 Gio, sur l'hôte macOS ; Node 26.11.1 posé depuis nodejs.org, SHA-256 vérifié ; bubblewrap 0.9.0, avec les espaces de noms utilisateur autorisés comme dans `gate.yml` ; Docker 28.3.3 et containerd 1.7.27 (relevés à part : l'en-tête ne peut pas lire la version d'un démon arrêté) ; copie du commit par `git archive`, dépendances par le lockfile ;
- deux corrections avant la campagne, trouvées à l'essai et non comptées : systemd refuse une unité démarrée 3 fois en 60 s (`start-limit-hit`), un garde-fou de systemd et non un coût de Docker, et son compteur est remis à zéro hors chronomètre avant chaque démarrage ; `containerd`, sur lequel tourne `dockerd`, restait actif, donc une part du moteur restait chaude, et il est désormais arrêté et démarré avec lui ;
- 30 mesures par configuration après 2 de chauffe, en alternance, aucun échec ;
- `iso-srt` : médiane 187 ms (p10 184, p90 305) ; `iso-docker-cold` : médiane 467 ms (p10 439, p90 489) ;
- **H1 amendée, tient sous Linux** : srt − Docker froid = − 279 ms (− 285 à − 266), seuil < 0 ; environ 2,5 fois plus rapide, contre environ 26 fois sous macOS.

Portée : sur macOS, Docker exige une VM, et c'est son démarrage qui fait l'écart. Sous Linux, l'écart vient du démarrage du moteur (containerd et dockerd) ; il est mesuré dans une VM sur un hôte macOS, sans gage pour une machine Linux nue. Windows : avec la preuve de l'étape « Hôtes ».

**Délégation isolée, H4** (demande du propriétaire : comparer la même délégation, `claude -p`, isolée dans srt et dans Docker, les deux froids ; un `claude -p` hors isolation n'apporte ni la sécurité ni la réduction de coûts de l'architecture et n'est pas comparé). Protocole pré-enregistré (`07b01e3`), puis amendé deux fois par le propriétaire avant toute mesure retenue :
- `fbadb32` : l'image d'une délégation est reconstruite sans cache ;
- `e4b8440` : l'environnement est jetable en entier.

Pour chaque délégation Docker, sont chronométrés :
- l'écriture de sa configuration (jamais la clé) ;
- le démarrage du moteur ;
- la construction `--no-cache --pull` : base épinglée retéléchargée, binaire Linux 0.3.312 dont le sha512 est vérifié contre le lockfile ;
- le conteneur ;
- l'effacement de toutes les images et de tout le cache (`system prune -af`) ;
- l'arrêt du moteur.

Côté srt : une sandbox neuve, profil `worker`, réseau vers le seul port du modèle, canari compris. Faux modèle, réponse en un tour ; une délégation n'est comptée que si elle sort en 0 avec la réponse.
- Essais avant les campagnes, conservés et non analysés :
  - une campagne interrompue, dont l'image était construite d'avance (disque chaud, retirée par le propriétaire) ;
  - trois échecs d'environ 18 s, avant l'enregistrement des étapes, qui n'ont pas pu être attribués ;
  - deux mesures de chauffe à 369 et 381 s : lenteurs du registre.
- **macOS** (`baseline/results/overhead-2026-11-07T13-03-08-844Z.jsonl`) : `deleg-srt` 921 ms (p10 696, p90 1 218) ; `deleg-docker-cold` 64 057 ms (p10 61 770, p90 67 170). Médianes des étapes Docker : VM 15,5 s, construction 45,4 s, conteneur 0,4 s, effacement 0,1 s, arrêt 2,4 s. **H4 tient** : − 63 136 ms (− 64 244 à − 62 324), soit environ 70 fois moins.
- **Linux**, VM `aos-bench`, démon arrêté (`baseline/results/overhead-2026-11-07T13-39-32-644Z-linux.jsonl`) : `deleg-srt` 475 ms (p10 358, p90 595) ; `deleg-docker-cold` 45 050 ms (p10 43 559, p90 47 534). Médianes des étapes : démon 0,4 s, construction 44,0 s, conteneur 0,4 s, effacement 0,1 s, arrêt 0,02 s. **H4 tient** : − 44 575 ms (− 45 437 à − 43 843), soit environ 95 fois moins.
- Aucun échec dans les deux campagnes, 30 mesures par configuration après 2 de chauffe.

**Lecture pour la conception** (question du propriétaire : pourquoi srt plutôt qu'un Docker relancé à chaque délégation, ou qu'une délégation à une autre session Claude) :
- à isolation froide égale, une délégation sous srt démarre plus vite que sous Docker, sur les deux hôtes mesurés ;
- un Docker à démon résident, avec un conteneur neuf par délégation, est un autre modèle : il garde un composant résident et privilégié, partagé entre les tâches, alors que srt n'en a aucun et que rien ne survit à une délégation. La comparaison froide ne tranche pas ce point, qui relève de la sécurité ;
- la délégation à une session Claude hors isolation n'est pas mesurée, par décision du propriétaire : elle n'a ni la sécurité ni la réduction de coûts de l'architecture, et ne se compare pas à une délégation isolée. La comparaison retenue est H4 ; le coût réel viendra de la mesure B.

**Lecture.**
- srt paie à chaque lancement son canari, une seconde exécution sous srt qui vérifie lecture et connexion refusées (§6, sans repli).
- Une décomposition (srt sans canari) répondrait à la question suivante : faut-il un canari par lancement, ou par profil et par démarrage de la gateway ? Elle n'était pas au protocole : ce serait une mesure exploratoire, annoncée comme telle, et le changement du canari est une décision du propriétaire, puisque c'est un plancher de sécurité.
- Le démarrage de la sandbox du worker fait l'essentiel des 700 ms ajoutés à un `recall` (536 ms). Le reste, environ 160 ms, se partage entre le broker, la gateway et le rappel du module.
- La mesure A dit ce que la structure coûte, pas ce qu'elle rapporte. Avec un vrai modèle, chaque tour coûte des secondes, mais ce rapport n'est pas mesuré ici : c'est la mesure B, qui comparera aussi les coûts.
- délégation isolée : à environnement jetable égal, srt délègue en moins d'une seconde, Docker en 45 à 64 s. L'écart vient de ce que Docker doit fabriquer et jeter un environnement à chaque délégation : télécharger sa base, copier le binaire de 293 Mo, construire. srt, lui, ne fabrique rien : il restreint le système de l'hôte autour d'un processus et le tue ensuite. Le conteneur lui-même ne coûte que 0,4 s des deux côtés de l'hôte ;
- limites : la construction dépend du réseau de cet hôte vers Docker Hub ; un miroir de registre la raccourcirait, mais il garderait l'image de base hors de l'environnement, ce que la décision du propriétaire exclut. Le réseau du conteneur n'est pas restreint au modèle : Docker n'a pas de liste d'hôtes autorisés sans proxy de sortie, un écart de sécurité qui s'ajoute à celui du démon.

**Fait annexe.** Le `recall` v2 (worker Docker) échoue avec le Claude Code actuel avant tout tour : le CLI refuse son schéma de sortie (draft 2020-12), le défaut corrigé en v3 au §29. Sondé en processus contre le faux modèle. Le chemin v2 gardé en mode additif ne sert donc plus un `recall` réel. Le réparer touche `run-worker.ts`, endetté, pour un chemin destiné au retrait : décision du propriétaire.

**Limites.**
- Faux modèle : ni latence réseau, ni temps du modèle.
- Un seul hôte. Le contexte Docker actif (VM Colima) sert aussi à une autre session : du bruit est possible, sans écriture de notre part (`run --rm` seul).
- La VM Docker n'est pas comptée dans la première campagne : c'est ce qui invalide sa H1 ; la campagne froide la compte.
- Le profil Colima `aos-bench` reste sur le disque (20 Gio alloués) : sa suppression, définitive, revient au propriétaire (`colima delete --profile aos-bench`).

**Pas fait, avec son étape.**
- La même commande sur Linux (bwrap) et, avec la preuve Windows, sur WSL2 et sur Docker natif : étape « Hôtes ».
- Mesure B, coût réel avec un vrai modèle, lancée par le propriétaire (sa clé) : sur son accord, protocole pré-enregistré de la même façon.
- La décomposition du canari : exploratoire, sur décision.

**Trois piliers.**
- Recherche : protocole commité avant les mesures, hypothèse réfutée publiée telle quelle, données et analyse versionnées, une commande par étape, graine fixe.
- SSDLC : aucune dépendance ajoutée, image Docker épinglée par digest ; le banc ne lit aucune clé, la clé du broker est factice et jetable ; le code de production est inchangé, seul le code de test est partagé.
- Opérationnel : aucun token dépensé, aucune donnée humaine, IRB sans objet.
