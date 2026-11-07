# Baseline de coût

Brique 0 de `docs/design/platform-v3-srt.md` : mesurer, sur de vraies tâches, ce que coûte une session de code selon la façon dont Claude Code est lancé. Trois configurations, vingt tâches ; le pilote (une session par cellule) puis la campagne (trois répétitions, 180 sessions) sont consignés au journal, §22 et §23.

| Configuration | Lancement                                                                                                                                                          |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `host`        | Claude Code de l'hôte, tel que le propriétaire l'utilise : plugins, serveurs MCP, hooks, mémoire, CLAUDE.md lu par Claude Code                                     |
| `host-bare`   | Le même Claude Code en `--bare`, chaque entrée explicite (réglages de session, CLAUDE.md du worktree en prompt système), par le proxy d'authentification, sans srt |
| `srt`         | L'outil de code de `packages/sandbox` (`code.json`) : `--bare` sous srt, par le proxy d'authentification                                                           |

Les trois reçoivent le même modèle, la même consigne, `--permission-mode acceptEdits` et la même commande autorisée. `host-bare` isole l'effet de `--bare` ; l'écart entre `host-bare` et `srt` est celui de srt et du proxy.

## Tâches

`tasks.json` : chaque tâche injecte un défaut connu dans une copie jetable d'un dépôt public du propriétaire, épinglé par commit, et demande de faire passer les tests nommés sans les modifier. Avant chaque session, le banc vérifie que le contrôle passe au commit épinglé et échoue avec le défaut. Une tâche est résolue si le contrôle passe après la session ; les fichiers de test modifiés sont relevés.

## Lancer

```bash
npm run baseline:pilot
npm run baseline:campaign
npm run baseline:analyze -- baseline/results/campaign-<date>.jsonl
```

`BASELINE_DRY=1` prépare et vérifie chaque copie sans lancer de session ; `BASELINE_TASKS` et `BASELINE_CONFIGS` restreignent le run. Les sessions consomment le forfait du propriétaire ; le coût publié est `total_cost_usd` de `claude -p --output-format json`, au tarif public. Chaque session écrit une ligne dans `results/pilot-<date>.jsonl` (usage, coût, tours, durées, résolution, diff, texte final) ; `results/pilot-<date>.usage.jsonl` est le journal d'usage du proxy pour `host-bare`.

## Propreté des cibles

Les dépôts sont clonés en miroir dans un dossier temporaire ; chaque session travaille dans un clone local de ce miroir, dans un worktree `.claude/worktrees/bench`, jamais poussé. Les branches et les tags distants (`git ls-remote --heads --tags`) sont relevés avant et comparés après ; la dernière ligne du fichier de résultats dit s'ils sont intacts (`remotesUntouched`) et nomme chaque référence qui a changé (`remoteChanges`), pour distinguer un push venu d'ailleurs. L'`origin` des copies est le cache local, et les sessions ne peuvent lancer que la commande de test.

## Surcoût de la structure (mesure A), protocole pré-enregistré

Mesure du temps que la structure de la plateforme ajoute à un appel, sans coût de modèle : le modèle est le faux
modèle local de `features/support/fake-model.ts`, scripté (une recherche, puis la sortie structurée), donc les tokens
sont fixés et le coût est nul. Ce protocole est commité avant toute mesure ; les résultats ne le modifient pas.

| Configuration     | Ce qui est chronométré                                                                                         |
| ----------------- | -------------------------------------------------------------------------------------------------------------- |
| `iso-none`        | `node -e 0` lancé directement, sans isolation                                                                  |
| `iso-srt`         | le même `node -e 0` par `SrtSandboxRunner`, profil `module`, cwd jetable, canari compris                       |
| `iso-docker`      | le même `node -e 0` par `docker run --rm --network none`, image `node:26-bookworm-slim` épinglée par digest    |
| `recall-inproc`   | un `recall` en processus : serveur MCP de la gateway, worker v3, vrai SDK, vrai CLI, relais répondu en mémoire |
| `recall-srt-warm` | un `recall` par la plateforme sous srt, comme `features/sandbox/recall.feature`, module déjà lancé             |
| `recall-srt-cold` | le même, sur une plateforme neuve : le module est lancé par cet appel                                          |

Le worker est toujours neuf, une sandbox par appel (§2). Le `recall` v2 (worker Docker) n'est pas mesuré : avec le
Claude Code actuel, il échoue avant tout tour, le CLI refusant son schéma de sortie (draft 2020-12, journal §29) ; seule
son isolation est comparée, par `iso-docker`.

Hypothèses, réfutables, publiées quel que soit le résultat :

- H1 : le surcoût de démarrage de srt, canari compris, est inférieur à celui de Docker : médiane(`iso-srt` −
  `iso-none`) < médiane(`iso-docker` − `iso-none`).
- H2 : sur un `recall`, la plateforme sous srt ajoute moins d'une seconde : médiane(`recall-srt-warm`) −
  médiane(`recall-inproc`) < 1 000 ms.
- H3 : lancer le module au premier appel ajoute moins d'une seconde : médiane(`recall-srt-cold`) −
  médiane(`recall-srt-warm`) < 1 000 ms.

Méthode : 30 mesures par configuration après 2 mesures de chauffe écartées (cache d'image, cache du CLI) ; les
configurations d'isolation alternent à chaque répétition, celles de `recall` aussi ; temps mural par
`performance.now()`. Statistiques : médiane, p10 et p90 ; écarts de médianes avec intervalle à 95 % par bootstrap
(10 000 tirages, graine 42). L'en-tête du fichier de résultats relève l'hôte : système, processeur, Node, srt, Docker,
Claude Code.

Limites, écrites d'avance : faux modèle, donc ni latence réseau ni temps du modèle, qui dominent un vrai appel ; un
seul hôte par campagne. La même commande se relance sur Linux et, avec la preuve Windows, sur WSL2 et Docker.

```bash
npm run baseline:overhead
npm run baseline:overhead-analyze -- baseline/results/overhead-<date>.jsonl
```

### Amendement du 7 novembre 2026 : H1, accepté par le propriétaire avant toute mesure

La campagne du 7 novembre ne permet pas de conclure sur H1 (journal §30). Elle opposait un srt froid à un Docker chaud,
dont la VM et le démon étaient déjà démarrés. Règle : les deux environnements sont comparés froids par défaut. Un srt
chaud est exclu, car la sandbox meurt après chaque exécution, sans reprise de session, pour bloquer la contamination.

Définition proposée de `iso-docker-cold` sur macOS, où Docker exige une VM : pour chaque exécution, une VM Colima dédiée
(profil `aos-bench`, distinct des profils des autres sessions) est démarrée, le conteneur lancé, puis la VM arrêtée.
Les trois étapes sont chronométrées, comme srt l'est de la création de sa sandbox jusqu'au retrait de son dossier.
L'image reste sur le disque de la VM, comme le binaire de Node reste sur le disque de l'hôte pour srt : un disque
chaud de part et d'autre, aucun processus chaud. H1 est reformulée sur `iso-docker-cold` ; son seuil ne change pas.
