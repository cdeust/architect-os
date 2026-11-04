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
