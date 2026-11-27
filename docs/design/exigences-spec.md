# Les exigences des quatre prompts retirés de Spec, et où architect-os les tient

Le 25 novembre 2026, le dépôt voisin ai-architect-mcp-spec retire quatre prompts que plus rien n'y exécute : `packages/meta-prompting/src/{implementation,testing,review,pr-creation}-prompts.ts` (à `4c3407f`, avant son #400). architect-os a repris l'implémentation et la livraison. Le propriétaire a refusé d'approuver le retrait tant que rien ne garantissait que ces exigences existent ici. Un rapport de correspondance, écrit en lecture seule contre `origin/main` à `24514716`, a classé les 39 exigences : 14 tenues sous une forme plus forte, 5 présentes, 5 sans objet, 12 partielles, 3 absentes. Ce document décide les 15 dernières, une par une. Chaque affirmation du rapport a été revérifiée dans le code avant d'être reprise ici.

Trois formes de décision :

- **tenue par l'hôte** : une règle que le code impose. C'est la forme retenue quand elle est possible ;
- **tenue par le prompt** : seul le modèle peut juger. La sortie structurée porte alors le jugement, et l'hôte refuse une sortie qui ne le porte pas ;
- **écartée** : la raison est écrite, ainsi que ce qui compense, avec la preuve de cette compensation.

## 1. Le tableau

| # | Exigence (Spec) | Décision | Où elle est tenue | Preuve |
| --- | --- | --- | --- | --- |
| R2 | rev:70-75 : FAIL si l'implémentation s'écarte de la spec | Tenue par le prompt, avec une vérification de l'hôte | `step.json` porte `acceptance`, les critères approuvés (Plan, `tools/plan/src/application/prepare.ts`). Le relecteur rend un statut par critère (`prompts/review.md`, « Acceptance criteria » ; `criteria` dans `src/review-verdict.ts`). L'hôte refuse un verdict qui omet, ajoute ou réordonne un critère, ou qui cite une preuve introuvable (`criteriaRefusal`). Un critère `unmet` ou `not_established` bloque (`blocks`). Le relevé garde chaque statut (`src/step-record.ts`). Une preuve de prompt de revue doit attester ces statuts (`src/step-admission.ts`, `attestsCriteria`) | `packages/sandbox/features/step-criteria.feature` (14 cas), `review-verdict.feature`, `review-files.feature`, `step-admission.feature`, `tools/plan/features/plan.feature`. Contre-épreuve et mutation : §2 |
| R5 | rev:40-43, 75 : à la re-revue, vérifier chaque constat antérieur | Tenue par l'hôte, dans la branche `model-routing` | `playPass` de `packages/sandbox/src/step-tool.ts` sur cette branche : le seul code où une passe n-1 existe. Sur `main`, une étape n'a qu'une passe. Champ retenu par le coordinateur : `prior_findings`, `[{ id: 'PF-<n>', status: 'resolved' \| 'unresolved' }]`, section « Findings of the previous review » | Transmise au worker de `model-routing`. Non construite ici |
| I9 | impl:63-72 : reprise sur le même worktree, chaque constat corrigé | Tenue par l'hôte, déjà construite dans `model-routing` | Passes dans le même worktree. Chaque passe reçoit les constats bloquants de la précédente (« Previous pass, as the host observed it »). L'échelle des bandes borne le nombre de passes (§13 de `orchestration-fable-5-2.md` sur cette branche) | Réserves transmises : le plafond est le nombre de bandes moins un, non « deux relances » comptées ; un ticket qui démarre en bande haute n'a aucune relance ; une étape non routée garde une passe |
| I3 | impl:101-103 : ancrer l'exécutant sur l'impact | Écartée | Les éclaireurs restent facultatifs, et l'hôte vérifie leurs citations (`scout-facts.ts`). `build.md` demande de comprendre les appelants | §3.1 : pilote HR1 |
| I4 | impl:104-106 : donner à l'exécutant le résumé de l'historien git | Écartée | Le constructeur lit l'historique lui-même, à la demande. L'historien de Spec informe déjà le PRD | `packages/sandbox/features/profile.feature` (« reads the history of the repository on demand »), `features/sandbox/srt-runner.feature` (`git log` sous le vrai srt, profil `builder`) |
| T1b | test:37 : les tests sont écrits par un autre que l'implémenteur | Écartée, compensée, puis prévue | La porte (aucun mutant survivant sur une ligne changée), plus R2 confrontée par un relecteur indépendant. Prévue : « Scenarios written apart, then frozen » (README, « What comes next ») | §3.2 |
| T5 | test:63-64 : diff sémantique et portes de sécurité après implémentation | Diff sémantique écarté. Portes de sécurité : **défaut ouvert** | Aucune analyse statique de sécurité ne tourne dans `.github/workflows`. La revue de sécurité par Claude arrive dans la CI par une autre PR (workspace claude-security-review) : c'est une revue par un modèle, pas une analyse statique | §3.3 |
| P7 | pr:84-85 : ne jamais fusionner, ni `gh pr merge` | Écartée comme règle tenue par le code d'une session | Rien n'empêche une session qui tient le jeton du propriétaire de fusionner une PR dont la porte est verte : GitHub l'accepte (§5). Ce qui compense : le ruleset de `main` exige une pull request et les deux jobs de la porte, sans contournement ; la fusion est faite par le résolveur (`pipeline-after-merge.yml`), qui lit le verdict de la revue de Claude sur le même commit, sauf pour une mise à jour mineure de Dependabot limitée à ses fichiers de dépendances. Les refus de `.claude/settings.json` (`gh pr merge`, un `PUT` sur `…/merge` par `gh api`, `mcp__github__merge_pull_request`) sont une friction qui épargne un appel à une session honnête, jamais un contrôle | `features/descriptive/ruleset-main.feature`, `features/descriptive/claude-files.feature`, `features/integration/session-denials.feature` (un vrai Claude Code : les appels refusés, et les mêmes appels écrits autrement, qui passent). Défaut ouvert : §5 |
| P8 | pr:84 : jamais `--admin` | Tenue côté GitHub depuis le 26 novembre 2026 | Le ruleset de `main` n'a plus aucun acteur de contournement (`docs/design/ruleset-main.json`, `bypass_actors: []`) : il n'y a plus de contournement à demander. `--admin` n'est une option que de `gh pr merge`, que `.claude/settings.json` refuse en entier, comme friction | `features/descriptive/ruleset-main.feature` refuse une copie qui rend un contournement. Limite : un administrateur peut modifier le ruleset (§5) |
| P1 | pr:46 : seule une action approuvée par un humain est exécutée | Tenue par l'hôte, dans la branche `delivery-preflight` | Phase 5 de `tools/deliver` conditionnée à une approbation liée au SHA du commit, impossible à sauter en silence. C'est le mécanisme de `delivery-maintenance.json` de cette branche | Transmise au worker de `delivery-preflight` |
| P10 | pr:85-87 : un humain relit et fusionne | Comme P1 | `delivery-preflight` | Transmise |
| P2 | pr:74-75 : pousser vers le distant du dépôt cible | Tenue par l'hôte, troisième PR | `deliver.json` par dépôt cible, et l'opération `openPullRequest` (§4) | `openPullRequest` construite pour ce dépôt (journal §124, `tools/deliver/features/ports.feature`) ; le `deliver.json` par dépôt cible reste à construire |
| P3 | pr:75-76 : ouvrir une PR | Tenue par l'hôte, troisième PR | Port `Forge`, `openPullRequest` (§4) | Construite (journal §124) : contrat `Forge` de `tools/deliver/features/ports.feature`, `sequence.feature`, `command.feature` ; non jouée contre GitHub |
| P4 | pr:76-79 : corps de PR (spec, implémentation, vérification, tests, verdict) | Tenue par l'hôte, troisième PR | Corps rendu depuis `record.json`, qui porte désormais le statut par critère (R2) | Construite (journal §124) : `tools/deliver/features/body.feature` |
| P6 | pr:79-80 : lier les fichiers de spec | Tenue par l'hôte, troisième PR | Hachages des entrées de `record.json`, liens vers `steps/<nom>/` dans la PR | Construite (journal §124) : `tools/deliver/features/body.feature` |

## 2. R2 : la revue confronte le diff aux critères du brief

**Avant.** Le relecteur recevait le brief, et avec lui les critères approuvés (`acceptance` du bloc JSON écrit par Plan), mais `review.md` ne lui demandait jamais de les confronter au diff : sa barre était la section « What the review must refuse » de `CLAUDE.md`. Aucun code ne savait quels critères une étape couvrait.

**Après.**

1. Plan écrit `acceptance`, les `acceptance_ids` de la proposition approuvée, dans leur ordre, dans le `step.json` qu'il matérialise. L'approbation couvre donc la liste. Une politique qui nommerait ses propres critères est refusée (`PLAN_INPUT_INVALID`) : la clé appartient à `stepFileSchema`, pas au schéma de la politique, comme `tickets`. Elle reste facultative pour les anciens dossiers. Elle contient au moins un identifiant `AC-<n>`, sans doublon.
2. Les revues reçoivent après le brief le bloc `## Acceptance criteria the verdict covers`, qui liste les identifiants en chaînes JSON (`renderAcceptance`). Ce bloc vient avant celui des contrôles.
3. Le prompt (`review.md`, section « Acceptance criteria ») demande, critère par critère, l'un de trois statuts :
   - `met`, avec des preuves (fichier, ligne, ligne exacte) ;
   - `unmet`, avec la raison ;
   - `not_established`, avec ce qui l'établirait.

   Un critère n'est jamais `met` parce qu'un contrôle a passé. Le verdict est `request_changes` dès qu'un critère n'est pas `met`.
4. L'hôte (`criteriaRefusal`, appelé une seule fois dans `verdictOf` de `step-tool.ts`) rend invalide un verdict dans trois cas :
   - les critères du verdict ne sont pas exactement ceux de l'étape, dans le même ordre ;
   - un critère est `met` sans preuve ;
   - une preuve n'est pas retrouvée telle quelle à sa ligne du worktree. La vérification est celle des citations d’éclaireurs (`rejection` de `scout-facts.ts`), avec les mêmes refus de chemin : absolu, `..`, `.git`.

   `blocks` bloque l'étape dès qu'un critère n'est pas `met`, quel que soit le verdict affiché. Le relevé public garde `criteria: [{ id, status }]` pour chaque revue valide.
5. La revue de PR (`npm run review`) emploie le même prompt et le même schéma. Son brief ne porte pas de critère : `criteria` y est vide. Le schéma reste en draft-07, que Claude Code exige (journal, §29).

**Ce que l'hôte établit et ce qu'il n'établit pas.** L'hôte établit que chaque critère a reçu un statut et que chaque ligne citée existe. Il n'établit pas que la ligne satisfait le critère : ce jugement reste au relecteur, d'un autre fournisseur ou d'un autre modèle que l'auteur. C'est la part « tenue par le prompt ». Une étape sans revue ne confronte aucun critère : avec la table de routage (`model-routing`), chaque passe a une revue ou une attente nommée. Sans route, la politique de l'opérateur décide, et le relevé le montre, puisqu'il n'y a alors aucune entrée `reviews`.

**Les spécimens.** Le prompt change, donc son empreinte. L'admission (`requireStepAdmission`) exige une preuve de prompt par rôle, liée à cette empreinte. Le schéma de spécimen porte désormais `criteria` dans `expected` et `observed`, comparés exactement. Une preuve d'un rôle `review:` doit contenir au moins un cas qui attend des statuts de critères, sinon `STEP_ADMISSION_SPECIMENS_REQUIRED`. L'émission de ces reçus en production n'existe pas encore : aucun outil du dépôt ne les produit (README, « Production issuance of that receipt is pending »), et le dossier d'autorité `~/.config/architect-os/step-admission/` n'existe pas sur le poste. Aucune étape n'est donc admise en production avant comme après ce changement. Ce que ce changement ajoute : le jour où l'émetteur existe, il ne peut pas admettre un prompt de revue qui n'a pas été rejoué sur des critères. La réadmission demandera alors, par modèle de revue, deux cas rejoués sur le prompt de ce commit :

- un diff qui satisfait tous ses critères, attendu `accept` et tous `met` ;
- un diff qui en manque un, attendu `request_changes` et ce critère `unmet`.

Soit deux appels réels par modèle de revue, sur l'abonnement du propriétaire (`npm run review`), chacun borné par sa limite (900 à 1 500 s). Le coût d'une revue mesurée ici va de 0,25 à 0,90 $ (journal, HR2 et HR5). La branche qui modifie le prompt en second (`model-routing`, `prior_findings`) refait cette réadmission sur son empreinte.

**Menaces (STRIDE).**

| Menace | Actif, attaque et décision |
| --- | --- |
| Usurpation | Un relecteur ne choisit pas les critères qu'il rend : l'hôte les prend dans `step.json`, que l'approbation de Plan couvre. Une politique qui en nomme est refusée |
| Altération | Le constructeur peut écrire le worktree, et donc une ligne que le relecteur citera. C'est pourquoi l'hôte vérifie seulement l'existence d'une preuve, jamais sa pertinence. Le texte des critères arrive au relecteur dans le brief approuvé, que la sandbox ne peut pas écrire ; les identifiants arrivent dans un bloc encodé en JSON |
| Répudiation | `record.json`, écrit par l'hôte seul, garde le statut de chaque critère pour chaque revue valide. Le verdict complet, preuves comprises, reste dans l'état de l'hôte (`review.<nom>.verdict.json`) |
| Divulgation | Rien de nouveau ne sort : le relevé public ne porte que des identifiants et des statuts, jamais une preuve ni une raison |
| Déni de service | Un verdict qui ne couvre pas les critères est invalide : l'étape est refusée, sans boucle. Au plus 10 preuves par critère, des citations d'une ligne de 300 caractères au plus |
| Élévation de privilège | La lecture des preuves passe par `readSource`, qui refuse chemin absolu, `..` et `.git`, comme pour les éclaireurs |

**Preuves jouées.**

- Scénarios : `step-criteria.feature` (14 cas sur le chemin de Step, de la brief à l'archive), `review-verdict.feature` (parse, bornes, `blocks`, `criteriaRefusal`, `renderAcceptance`), `review-files.feature` (prompt et schéma, avec copies cassées), `step-admission.feature` (spécimens de revue), `plan.feature` (critères écrits par Plan).
- Contre-épreuve : la règle de l'hôte, le blocage par critère, l'attestation des spécimens et l'écriture par Plan ont été neutralisés dans le code de production, les nouveaux scénarios gardés. 19 scénarios échouent ; les contrôles positifs passent. Les sources ont été remises avant la suite.
- Mutation : résultat dans la PR.

## 3. Les exigences écartées, et ce qui les compense

### 3.1 I3, l'ancrage sur l'impact

Spec donnait à l'exécutant un résumé d'impact tiré d'un graphe de code. architect-os n'a pas ce graphe. Ses éclaireurs, dont l'hôte vérifie chaque citation, ont été mesurés le 17 novembre 2026 (pilote HR1, `orchestration-fable-5-2.md`, §13) :

- coût avec trois éclaireurs : 1,34 $ plus 0,016 $, contre 1,33 $ pour le témoin sans éclaireur ;
- jetons relus par réponse : 87 374 contre 87 850 ;
- bruit mesuré entre deux constructions sans éclaireur : 8 % sur le coût.

L'hypothèse n'est pas soutenue. Rendre les éclaireurs obligatoires ajouterait un coût sans effet montré. Ils restent facultatifs, à la main de la politique.

### 3.2 T1b, des tests écrits par un autre

La mutation des lignes changées prouve que les tests échouent quand le code change : c'est la force des tests. Elle ne prouve pas leur conformité à la spec : un constructeur peut figer sa propre lecture fausse dans des tests qui tuent tous les mutants. La compensation tient donc en deux pièces :

1. la porte refuse un mutant survivant sur une ligne changée (`tools/test-gate/features/control.feature`, fixture « survivor ») ;
2. R2 fait confronter le diff aux critères approuvés par un relecteur indépendant, et l'hôte refuse une revue qui en omet un (§2).

Ce qui manque encore : une session qui écrit les scénarios depuis le brief sans voir le code, et un profil qui les rend non inscriptibles au constructeur. C'est la ligne « Scenarios written apart, then frozen » du README, prévue à l'étape 3 de la boucle.

### 3.3 T5, le diff sémantique et les portes de sécurité

Le diff sémantique de Spec dépendait de son graphe de code ; architect-os n'en a pas, et il n'est pas reconstruit. Les portes de sécurité sont un **défaut ouvert** :

- aucun workflow de `.github/workflows` ne lance d'analyse statique de sécurité ;
- la porte joue les scénarios, la mutation et la garde d'architecture, ce qui n'en tient pas lieu ;
- la revue de sécurité par Claude, qui arrive dans la CI par une autre PR (workspace claude-security-review), est une revue par un modèle, pas une analyse statique.

Il faudrait un analyseur statique épinglé (par exemple CodeQL pour TypeScript, ou Semgrep avec des règles versionnées), lancé à chaque PR, dont un constat bloque, et une dimension de revue `security` dans `step.json`, prévue en O.3d.

## 4. Conception de la troisième PR : ouvrir une pull request sur le dépôt cible (P2, P3, P4, P6)

Décision du propriétaire, transmise le 25 novembre 2026 : architect-os ouvre une pull request sur le dépôt cible. Cette PR se construit après la livraison de `delivery-preflight`, qui réécrit `tools/deliver`.

**Ce qui est construit (26 novembre 2026, journal §124), pour ce dépôt-ci.** `Forge.openPullRequest` avec son double en mémoire et l'adaptateur du client de la forge (`host-process.ts`, environnement fermé), son contrat à deux lignes par cas ; la phase 5 de `tools/deliver` pousse la branche de travail `deliver/<nom>` et ouvre la PR vers `main`, ou retrouve celle qui est ouverte ; le titre (`pullRequestTitle` de `deliver.json`) et le corps, rendus par le domaine depuis `steps/<nom>/record.json` du commit, lu par l'objet du commit et revalidé par le schéma du relevé. Trois écarts à ce qui suit : une PR déjà ouverte pour la même tête et la même base est rendue (`created: false`) et non refusée, comme le veut la ligne « Déni de service » ; chaque valeur passe dans un bloc de code inerte (`@`, `#`, `:` et les mots qui ferment un ticket coupés d'une espace sans chasse) plutôt que par `JSON.stringify` ; le ticket, le reçu de la porte et le run de CI ne sont pas dans le corps, seulement l'empreinte du commit et le lien vers le relevé. Ce qui reste : l'approbation liée au commit (P1, `delivery-preflight`), avant toute poussée, et un `deliver.json` par dépôt cible pris dans le lanceur (P2). L'appel à GitHub n'a pas été joué.

**Le contrat du port.** `Forge.openPullRequest(request): Result` dans `tools/deliver/src/domain/ports.ts`, avec un double en mémoire et l'adaptateur du client de la forge, qui passe par `host-process.ts` et son environnement fermé.

- Entrée : le dépôt (`owner/name`, pris dans le `deliver.json` du dépôt cible, jamais dans un fichier du worktree), la branche de tête déjà poussée, la base, le SHA de tête attendu, un titre et un corps.
- Sortie : l'URL et le numéro, ou une raison fermée (`branche absente`, `tête différente du commit livré`, `PR déjà ouverte pour cette tête`, `refus de la forge`).
- La PR n'est jamais ouverte en brouillon, et n'est jamais fusionnée par ce port. Si la tête distante n'est pas le commit livré, rien n'est ouvert.

**Le corps.** Il est rendu par l'hôte depuis `steps/<nom>/record.json` du commit, et seulement depuis ses champs typés :

- l'étape et son ticket ;
- le statut de chaque critère, par revue ;
- le verdict de chaque revue et son nombre de constats ;
- les contrôles et leur issue ;
- les hachages des entrées (brief, `step.json`, questions), avec un lien vers `steps/<nom>/` au SHA ;
- l'empreinte de l'arbre, le reçu de la porte et le run de CI.

Aucun texte libre d'une session (rapport, raison d'un constat) n'y entre : il viendrait d'un modèle et pourrait porter une consigne.

**Menaces.**

| STRIDE | Décision |
| --- | --- |
| Usurpation | Le dépôt et la base viennent du `deliver.json` du lanceur installé, pas du dépôt cible, qu'une session a pu écrire. Le jeton est celui de l'hôte, passé par l'environnement fermé (`GH_TOKEN`), jamais remis à une session |
| Altération | Le dépôt cible n'est pas fiable : il ne fournit ni le titre ni le corps. Ils sont rendus depuis `record.json`, revalidé par son schéma, et chaque valeur y passe par `JSON.stringify`. Un `record.json` qui ne correspond pas au commit livré arrête l'opération |
| Répudiation | Une ligne de `deliveries.jsonl` par PR ouverte : URL, numéro, SHA de tête, hachage du corps |
| Divulgation | Le corps ne porte que des identifiants, des statuts, des nombres et des hachages |
| Déni de service | Une PR au plus par SHA de tête. Une PR déjà ouverte est retrouvée, jamais doublée |
| Élévation | Le jeton a le droit d'ouvrir une PR. Il ne doit pas avoir celui de contourner le ruleset (§5). Qui approuve la publication : le propriétaire, par l'approbation liée au commit (P1, `delivery-preflight`) avant toute poussée ; la fusion appartient à l'automate du dépôt (§5) |

## 5. La fusion, et la barrière côté GitHub (P7, P8)

**Lu le 25 novembre 2026** (`gh api repos/cdeust/architect-os/rulesets/<id>`) : les deux rulesets actifs, `main` et `feat/gate-1a`, portaient trois règles, `deletion`, `non_fast_forward` et `required_status_checks`, et un contournement : `RepositoryRole` 5 (admin), `bypass_mode: always`. Aucune règle n'exigeait de pull request. Toute session qui tenait le jeton du propriétaire pouvait donc pousser sur `main` sans contrôle.

**Décidé par le propriétaire le 26 novembre 2026** (journal §112) : `main` n'accepte que des pull requests et aucun acteur ne contourne son ruleset ; une pull request est fusionnée quand la porte est verte et que les deux relecteurs, Claude et Codex, ont approuvé le commit exact ; le ruleset attendu est un fichier du dépôt, et un scénario est rouge quand ce fichier est affaibli. Le ruleset de `main` a été modifié ce jour-là par le propriétaire. `docs/design/ruleset-main.json` en est le corps, et `features/descriptive/ruleset-main.feature` refuse ses copies affaiblies.

**Ce qui est une barrière, et ce qui ne l'est pas** (détail et tableau STRIDE : `docs/infrastructure.md`, « How a pull request reaches `main` »).

- Pousser sur `main` hors d'une pull request, la réécrire, la supprimer : refusé par GitHub, pour tout compte, administrateur compris. C'est une barrière, tant que le ruleset reste ce qu'il est.
- Fusionner une PR dont la porte n'a pas tourné au vert : le ruleset exige deux contrôles par leur nom, `gate-linux` et `gate-macos`, et refuse la fusion tant que l'un manque, attend ou échoue. Il ne sait pas quel workflow les rend, et GitHub tient un contrôle `skipped` ou `neutral` pour satisfait. Or GitHub joue `gate.yml` tel que la pull request l'écrit : une PR du dépôt peut donc réécrire ce fichier pour que deux jobs de ces noms réussissent sans jouer la porte. Le résolveur refuse un job sauté, pas un job réécrit. Ce qui le voit aujourd'hui est la revue du diff (R-6). Ce qui le fermerait : un jeton des sessions sans la permission « Workflows », à vérifier par le propriétaire quand il le crée.
- Modifier le ruleset : un administrateur le peut, et les sessions tournent avec le jeton d'administrateur du propriétaire. Ce n'est pas empêché. C'est détectable : GitHub garde l'historique d'un ruleset, et sa comparaison avec le fichier du dépôt se fait à la main, avec un jeton d'administrateur. Aucun job ne la fait : la liste des contournements n'est rendue qu'à qui peut écrire le ruleset ; une lecture sans jeton rend `updated_at`, qu'un job pourrait surveiller pour demander cette comparaison, et qui n'est pas construit. Cela reste ainsi tant que les sessions n'ont pas un jeton sans droit d'administration, ce qui revient au propriétaire.
- Fusionner une PR verte sans l'approbation des relecteurs : GitHub l'accepte de tout compte qui peut écrire, car le ruleset n'exige aucune approbation. L'approbation de Claude est tenue par le résolveur, pour ses propres fusions, avec une exception (une mise à jour mineure de Dependabot, signée par GitHub, limitée à `uv.lock` et `pyproject.toml`, que ce dépôt n'a pas). Le résolveur lit le verdict dans le corps actuel d'un commentaire de `claude[bot]`, sans regarder qui l'a modifié en dernier : un compte qui peut écrire peut modifier ce commentaire. Rien, sur `main`, ne lit un verdict de Codex. Défauts ouverts, pour la PR qui fera des deux verdicts un contrôle et durcira la lecture du verdict (le mainteneur), et pour le propriétaire quant au ruleset.
- Les refus de `.claude/settings.json` : une friction. Ils épargnent à une session honnête un appel refusé, ou un appel qui n'est pas le sien. Ils n'arrêtent ni un processus hors de Claude Code, ni la même commande écrite autrement (`git -C . push origin main`, `sh -c 'gh pr merge 12'` : joués, ils passent). Aucune garantie ne repose sur eux.

Le ruleset de `feat/gate-1a` garde le contournement de l'administrateur. Cette branche est celle de la publication directe, pour laquelle `tools/deliver` est encore écrit : la PR qui retire cette publication en décide.

La pull request #149, qui devait tenir P7 et P8 dans le code de l'hôte, est fermée. Elle refusait la fusion et la poussée par un hook lancé dans la session même qu'il devait retenir : une revue de conception a montré une douzaine de façons de le contourner. Seuls ses refus de réglages sont repris, décrits comme une friction.

## 6. Le sens inverse du contrat : un run de Spec déjà passé la porte

architect-os ne lit de Spec que deux projections, `get_pipeline_state(format: define_handoff_v1)` et `get_pipeline_state(format: verified_plan_v1)` (`tools/define`, `docs/define.md`). Spec ne les rend que pour un run arrêté à la porte d'implémentation ou terminé en `prd_only`. Pour les huit étapes `implementation_gate … pr_creation` sans action en attente, le lecteur de Spec rend `define_not_pending`, qu'architect-os rend en `DEFINE_REFUSED` (sortie 2).

Un tel run **n'est pas repris, et ne doit pas l'être.** Step n'ouvre aucune session sans une admission liée à un plan approuvé : le manifeste de Plan, l'approbation de son empreinte, la projection revue (`reviewed_plan`), l'arbre cible, le lanceur et les spécimens (`requireStepAdmission`). Un run de Spec qui a franchi la porte par l'ancien flux n'a produit aucune de ces pièces. Le reprendre demanderait de les fabriquer après coup, c'est-à-dire de forger la preuve qu'un plan a été approuvé et relu. L'état de son ancienne exécution (branche, worktree, constats de revue de `post_specs`) ne passe pas non plus par le contrat : il n'est ni typé ni vérifié.

Le chemin est donc l'un de deux :

- relancer un run de Spec jusqu'à la porte, puis Define, Plan et Step ;
- si le checkpoint est encore à la porte avec sa question en attente, le lire par Define.

Une exécution déjà entamée par l'ancien flux se termine dans Spec ou à la main ; elle n'entre pas dans architect-os.

Le texte proposé côté Spec, à placer dans la documentation de la frontière (`docs/define-boundary-pilot.md`, section « Define v1 », après la description de `define_handoff_v1`) :

> **Checkpoints past the implementation gate.** A run whose state is past `implementation_gate` (from `pre_impl_grounding` to `pr_creation`), or whose decision is `implement`, is not resumable by architect-os. `get_pipeline_state(format: "define_handoff_v1")` answers `define_not_pending` and architect-os stops with `DEFINE_REFUSED`. This is deliberate: an architect-os Step starts only on an admission bound to an approved Plan manifest, its reviewed projection and the target tree, and a run that crossed the gate through the retired execution flow has none of them; resuming it would mean fabricating that evidence. Such a checkpoint stays readable. To implement its PRD with architect-os, start a new run up to the gate, or read a checkpoint that is still waiting at the gate.
