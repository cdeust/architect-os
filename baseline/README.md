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
./aos -- npm run baseline:pilot
./aos -- npm run baseline:campaign
./aos -- npm run baseline:analyze -- baseline/results/campaign-<date>.jsonl
```

`BASELINE_DRY=1` prépare et vérifie chaque copie sans lancer de session ; `BASELINE_TASKS` et `BASELINE_CONFIGS` restreignent le run. Les sessions consomment le forfait du propriétaire ; le coût publié est `total_cost_usd` de `claude -p --output-format json`, au tarif public. Chaque session écrit une ligne dans `results/pilot-<date>.jsonl` (usage, coût, tours, durées, résolution, diff, texte final) ; `results/pilot-<date>.usage.jsonl` est le journal d'usage du proxy pour `host-bare`.

## Propreté des cibles

Les dépôts sont clonés en miroir dans un dossier temporaire ; chaque session travaille dans un clone local de ce miroir, dans un worktree `.claude/worktrees/bench`, jamais poussé. Les branches et les tags distants (`git ls-remote --heads --tags`) sont relevés avant et comparés après ; la dernière ligne du fichier de résultats dit s'ils sont intacts (`remotesUntouched`) et nomme chaque référence qui a changé (`remoteChanges`), pour distinguer un push venu d'ailleurs. L'`origin` des copies est le cache local, et les sessions ne peuvent lancer que la commande de test.

## Résultats

`results/` garde les mesures brutes et leurs rapports ; ce sont les preuves que citent les décisions 21 et 22 de `docs/design/platform-v3-srt.md`.

| Fichiers                            | Contenu                                                                                         |
| ----------------------------------- | ----------------------------------------------------------------------------------------------- |
| `results/pilot-*`, `campaign-*`     | Le pilote et la campagne de coût (180 sessions)                                                 |
| `results/overhead-*.jsonl` et `.md` | Le surcoût de la structure : isolation d'un processus, `recall`, délégation, sous srt et Docker |

Les protocoles pré-enregistrés, leurs amendements et les hôtes mesurés sont au journal, `docs/design/journal.md` (§30 et suivants).

## Analyser les mesures de surcoût

```bash
./aos -- npm run baseline:overhead-analyze -- baseline/results/overhead-<date>.jsonl
```

`overhead-analyze.ts` lit un fichier de résultats : médiane, p10 et p90, écarts de médianes avec intervalle à 95 % par bootstrap (10 000 tirages, graine 42). Il ne lance aucun programme.

Le programme qui a produit ces mesures n'est plus dans l'arbre : il est dans l'historique du dépôt, au dernier commit qui le modifie, `be831caa7fbe80d5e159784d83fea7ee5a406497` (`git show be831caa7fbe80d5e159784d83fea7ee5a406497:baseline/overhead.ts`) ; le README de ce commit porte les protocoles.

Measure Define and Plan using [the planning protocol](../docs/plan.md#measure-the-checkpoint-to-plan-path).
