# La veille d'Anthropic, vérifiée (brique 1b.9)

Demande du propriétaire, 17 novembre 2026 : « Il serait utile d'introduire la vérification des changelog Claude code et la doc de Claude et d'anthropic pour maintenir à jour les mécanismes de l'architecture à niveau avec les dernières fonctionnalités et assurer une concordance avec ce que Anthropic amène à dispo. Le point suivant après sera de faire un inventaire des ajouts non utilisés qui ont une pertinence. »

## Trois piliers

- **Recherche.** Fait : relevé de l'existant et des sources, mesuré le 17 novembre 2026 (§1). Prévu à l'étape 3 : l'inventaire des ajouts non utilisés, chaque page lue une fois, datée, avec sa décision. Reproductible : `npm run watch -- check` rend le même verdict à tout tiers, depuis le registre commité.
- **SSDLC.** Fait : modèle de menaces avant le code (§5). Prévu à l'étape 1 : scénarios avec des réponses enregistrées, mutation des lignes changées, porte. Chaîne d'approvisionnement : aucune dépendance ajoutée.
- **Opérationnel.** Prévu à l'étape 2 : un workflow planifié sans secret, `contents: read`. Aucune donnée personnelle ; IRB sans objet.

## 1. L'existant, relevé et non supposé

La brique 1b.8 a posé un relevé (`docs/claude-code-watch.md`) et un workflow (`pins.yml`) qui compare deux épingles à ce qui est publié. Mesuré le 17 novembre 2026 :

| Ce que la plateforme tient d'Anthropic | Où | Veillé par 1b.8 |
|---|---|---|
| Le SDK de l'agent et le binaire Claude Code qu'il porte | `services/memory/package.json` | Épingle : oui. Publié 0.3.326 la veille, épinglé 0.3.325 |
| Le runtime de sandbox | `packages/sandbox/package.json` | Épingle : oui |
| Le changelog de Claude Code | lu à la main | Lecture : non vérifiée. Rien ne dit jusqu'où il a été lu |
| Le changelog du SDK de l'agent | jamais lu en tant que tel | Non |
| Les options de `query()`, la sortie structurée, les outils en processus | `services/memory/worker/infrastructure/sdk-task-agent.ts` | Non |
| Les drapeaux et variables de `claude --bare`, les réglages d'une session | `packages/sandbox/code.json`, `review.json`, `profiles/*.json` | Non |
| Le format d'un agent et d'un skill | `agents/memory.md`, `.claude/agents/`, `.claude/skills/`, `tools/evidence/skill/` | Non |
| L'API Messages : champs du corps admis, erreurs, version, bêta, usage | `packages/sandbox/code.json` (politique du proxy), `packages/sandbox/src/auth-proxy.ts`, `modules/broker/` | Non |
| Les modèles nommés | `agents/memory.md`, `topology/catalog.json`, `topology/clients.json` | Non |

Les sources sont publiques, lisibles sans compte, et stables d'une lecture à l'autre (même empreinte à deux secondes d'écart, vérifié sur deux pages et les deux index) : le changelog de Claude Code et celui du SDK (`raw.githubusercontent.com`), le registre npm, l'index de la documentation de Claude Code (`code.claude.com/docs/llms.txt`, 205 pages) et celui de la plateforme (`platform.claude.com/llms.txt`, 916 pages), chaque page en Markdown par son suffixe `.md`.

## 2. Décision : un registre commité et une commande qui le compare aux sources

Un fichier descriptif, `tools/watch/watch.json`, nomme chaque source, ce que la plateforme en tient (les fichiers qui s'y appuient, et sur quoi), et l'état lu. Une commande compare cet état à la source ; un workflow planifié la lance. Rien n'est deviné : la commande dit qu'une source a changé, jamais ce qu'il faut en faire. La lecture et la décision restent au mainteneur, consignées dans le relevé `docs/claude-code-watch.md`, dont le tableau d'état disparaît au profit du registre.

| Sorte | Source | État | « En retard » |
|---|---|---|---|
| `pin` | Un paquet npm et les manifestes qui l'épinglent | Les manifestes | La version publiée diffère de l'épingle, ou les manifestes diffèrent entre eux |
| `changelog` | Un fichier dont les titres `## x.y.z` sont des versions | `read.version` | Une version au-dessus de celle lue |
| `page` | Une page de documentation en Markdown | `read.sha256` | L'empreinte a changé, ou la page n'a jamais été lue |
| `index` | Un index `llms.txt` | La liste commitée de ses adresses (`tools/watch/indexes/<id>.txt`), et rien d'autre : la liste présente, l'index a été lu ; absente, il ne l'a jamais été. Elle ne porte aucune date : l'historique git du fichier la donne | Une page ajoutée ou retirée, ou l'index jamais lu |

Une source `page` porte `mechanisms` (les fichiers du dépôt qui s'appuient sur elle ; chacun doit exister) et `relies` (ce sur quoi ils s'appuient, en une phrase). C'est la concordance demandée : quand la page change, la commande nomme les mécanismes à relire.

L'index est ce qui nourrit l'inventaire des ajouts : une page nouvelle est une chose qu'Anthropic met à disposition et que personne n'a encore classée.

Refusé : copier le texte des pages dans le dépôt (c'est le texte d'Anthropic ; seules l'empreinte et l'adresse y entrent) ; une décision automatique sur une entrée ; une mise à jour automatique d'une épingle.

### Ce que la veille garde

Le propriétaire, le 17 novembre 2026 : « La boucle de vérification a pour but de se maintenir à jour avec les évolutions de Anthropic, un changement de livraison a autant d'importance que la sécurité. On garde tout ce [qui] est pertinent qu'il apporte sécurité ou non, coûts ou non. »

Chaque changement lu est classé :

| Classe | Ce que c'est | Ce qu'on en fait |
|---|---|---|
| Obligatoire | Une dépréciation, un changement de défaut, un retrait, une migration, un correctif de sécurité | Pris, à une étape nommée, avant d'y être forcé |
| Pertinent | Il touche un mécanisme de la plateforme, ou lui offre quelque chose | Gardé, avec sa décision : pris maintenant, prévu à une étape, ou à étudier |
| Sans objet | Il ne touche rien de la plateforme | Consigné avec sa raison |

Le mainteneur avait d'abord fait de « sécurité ou coût » un filtre, et écarté par lui la nouvelle voie de livraison des serveurs MCP au binaire, alors que l'ancienne est dépréciée ; le propriétaire : « Pourquoi sortir une évolution qui est plus mandatory qu'un apport ? » La sécurité et le coût sont les priorités de la conception (le propriétaire : « Tu dois privilégier la sécurité et l'optimisation des coûts dans le système. Donc tes changements doivent rester pertinent et en accord avec l'existent ») : ils ordonnent ce qui est fait d'abord, ils n'écartent rien de la veille. Un changement se prend dans les formes de l'architecture en place (la gateway lance, memory est une brique de données, srt isole).

### Ce que la veille coûte

| Poste | Coût | Ce qui le tient bas |
|---|---|---|
| Le contrôle | 5 secondes contre les 28 sources réelles, aucun modèle ; un run par semaine | Une lecture par source et par run |
| La lecture, quand il est rouge | Des jetons, à proportion de ce qui est lu et du modèle qui lit | `--keep` : la différence d'une page, jamais la page entière ; chaque lecture consigne au relevé ce qu'elle a coûté et ce qu'elle a décidé. À venir (`orchestration-fable-5-2.md`, table de routage) : un lecteur par source, en parallèle, sur le plus petit modèle qui sait le faire, dans le profil en lecture seule de la boucle |
| La première lecture (étape 3) | Les 22 pages et les deux index, une fois | Rapportée au journal |

Aucune source ne sort du registre parce que ses changements n'ont mené à aucune décision. Le propriétaire : « elle est fetch une fois, après son coût est relatif et ça nous permet de comparer au registre réel pas à un registre filtré. » La retirer obligerait à la relire en entier le jour où elle compte.

## 3. Commande

```
npm run watch -- check [--keep <dossier>]
npm run watch -- read <id> [<id>...] [--keep <dossier>]
```

Le registre et ses listes d'adresses restent dans la forme que l'outil écrit (hors du formateur du dépôt, un scénario le vérifie), si bien qu'une lecture ne change que le `read` de ce qui a été lu.

`check` lit le registre, puis chaque source, et écrit une ligne par source : `à jour`, `en retard` avec son constat (versions, nombre de pages ajoutées et retirées, date de la dernière lecture d'une page ou d'un changelog), ou `illisible` avec une raison prise dans une liste fermée. Il n'écrit rien dans le dépôt.

`read` consigne qu'une source a été lue : il la relit et écrit son état dans le registre (empreinte et date d'une page, version et date d'un changelog) ou écrit la liste de ses adresses (un index : le registre n'y change pas). Il refuse une source `pin` : une épingle se déplace dans son manifeste, avec sa preuve.

`--keep` nomme un dossier hors du dépôt où `read` garde le texte lu et où `check` pose le texte nouveau à côté, pour que le mainteneur lise la différence et non la page entière.

| Sortie | Sens |
|---|---|
| 0 | Toutes les sources sont à jour |
| 1 | Au moins une source est en retard, aucune illisible |
| 2 | Registre inutilisable : hors schéma, identifiant en double, mécanisme absent du dépôt, hôte hors liste |
| 3 | Au moins une source illisible : on ne peut pas conclure |

## 4. Ce que la commande prouve, et ce qu'elle ne prouve pas

Elle prouve qu'à la date du run aucune source nommée n'a bougé depuis sa lecture. Elle ne prouve pas que la lecture a été bien faite, ni que le registre nomme toutes les pages dont un mécanisme dépend : une dépendance oubliée n'est vue par personne. L'index borne ce risque sans le fermer : toute page nouvelle est signalée, une page existante jamais reliée ne l'est pas.

## 5. Menaces (STRIDE)

L'outil lit du texte distant sur un runner et sur le poste du mainteneur. Ce texte n'est pas de confiance.

| | Menace | Parade |
|---|---|---|
| **S** | Une source usurpée, ou une redirection vers un autre hôte | HTTPS seul ; liste fermée d'hôtes, écrite dans le code et non dans le registre ; aucune redirection suivie hors de cette liste |
| **T** | Le texte lu contient des commandes de workflow GitHub (`::error::`, `::add-mask::`) ou des séquences de terminal, et la commande l'imprime | Aucun texte distant n'est imprimé ni écrit dans le dépôt. Seuls sortent : des identifiants du registre, des versions et des adresses qui passent une expression stricte, des empreintes, des comptes, des raisons d'une liste fermée |
| **T** | Une PR marque une source comme lue sans l'avoir lue | Visible au diff du registre ; même risque accepté que R-6 pour la porte |
| **T** | `read` écrit dans le dépôt une liste d'adresses prise d'un index | Seules sont écrites les adresses de l'hôte de l'index qui passent l'expression stricte ; tout le reste du texte est ignoré ; un index sans aucune adresse est illisible et rien n'est écrit |
| **R** | Qui a lu quoi | Le registre porte la date d'une page et d'un changelog, l'historique git de sa liste celle d'un index ; la décision est au relevé, dans l'historique git |
| **I** | Une requête porte une identité | Aucun secret, aucun jeton, aucun en-tête propre au dépôt ou à son propriétaire |
| **D** | Une source lente, énorme ou absente | Délai et taille bornés par source ; « illisible », sortie 3, distincte de « en retard » ; une lecture par source et par run, pas de reprise |
| **E** | Le texte lu est exécuté ou interprété | Jamais : il est haché, ou parcouru par deux expressions (titres de version, adresses). `--keep` l'écrit dans un dossier nommé par l'appelant, hors du dépôt, sous un nom dérivé de l'identifiant du registre |

Le workflow n'a aucun secret, `contents: read`, installe sans scripts et ne pousse rien.

## 6. Étapes

| Étape | Contenu | Sortie |
|---|---|---|
| 1 et 2, un seul commit | L'outil `tools/watch` (couches `domain`, `application`, `infrastructure`, racine `src/main.ts`, entrée `src/cli.ts`), son registre, ses scénarios devant des réponses données par le scénario ; `watch.yml` remplace `pins.yml` ; le relevé renvoie au registre. Un commit qui ajoute une commande sans sa documentation est refusé par la règle du dépôt : les deux étapes prévues n'en font qu'une | Porte verte, aucun survivant sur ses lignes ; `check` joué sur l'hôte contre les sources réelles : il est rouge tant que les pages ne sont pas lues, et le dit |
| 3 | L'inventaire : chaque page du registre lue, chaque page des index classée (utilisée, pertinente et non utilisée, sans objet), décision par ajout | `check` vert ; l'inventaire au relevé |
