# Guichet des preuves : lier la boucle d'orchestration à Claude Science

Note de conception, 14 novembre 2026. Brique S. Elle suit le principe de la plateforme ([`platform-v3-srt.md`](platform-v3-srt.md)) et de la boucle ([`orchestration-fable-5-2.md`](orchestration-fable-5-2.md)) : un rôle par tâche, avec le moindre privilège et le contexte qui lui suffit ; ce qui vient d'un autre rôle est une donnée, validée par contrat sur l'hôte avant d'être utilisée.

## Trois piliers

- **Recherche.** Fait : les capacités de Claude Science relevées dans sa documentation et dans l'installation locale (§1), les réponses réelles du registre des DOI relevées avant de spécifier (§5). Fait aussi : les essais sur l'application réelle (§1) et la preuve du vérificateur contre le registre réel (journal §37). Prévu à l'étape S.3 : le texte source récupéré par l'hôte, indépendamment du répondant.
- **SSDLC.** Fait : modèle de menaces STRIDE (§6), contrat strict de la réponse, refus nommés, aucune dépendance ajoutée. Prévu à l'étape S.4 : le vérificateur sous srt, comme module de la plateforme.
- **Opérationnel.** Fait : moindre privilège des deux côtés (§3), aucun secret, aucune donnée personnelle envoyée au registre. IRB : sans objet, aucune donnée humaine.

## 1. Ce que Claude Science permet, relevé et non supposé

Sources : pages `claude.com/docs/claude-science/*.md` copiées le 14 novembre 2026 (24 pages, empreintes SHA-256, hors dépôt), et l'installation locale 0.1.56 lue sans la démarrer (`claude-science --help`, `status`, `update --check`, skills livrés sous `runtime/0.1.56-release/skills`).

| Fait | Source | Conséquence |
|---|---|---|
| Aucune entrée programmable : la commande ne fait que démarrer, ouvrir, arrêter, mettre à jour, importer. L'interface est une page locale derrière un lien à usage unique | `command-line-settings.md`, `claude-science --help` | Une session Science est toujours lancée par une personne. La liaison est asynchrone |
| Science est client MCP (commande locale ou serveur HTTPS distant), il n'expose aucun serveur | `custom-connectors.md` | Claude Code ne peut pas appeler Science |
| Un connecteur en commande locale tourne dans le bac à sable de Science, réseau fermé par défaut, avec un dossier inscriptible propre | `custom-connectors.md` | Son accès à un dossier accordé ou à `127.0.0.1` n'est écrit nulle part : il ne se tranche que sur l'application |
| Science lit et écrit sur place dans les dossiers que l'utilisateur accorde, par projet, de façon persistante | `core-concepts.md` | Un dossier partagé est un canal documenté |
| Un skill est un dossier `SKILL.md` (en-tête YAML `name`, `description`) et ses fichiers ; on l'ajoute par écriture, téléversement ou import GitHub | `connectors-and-skills.md`, skills livrés | Le protocole se porte dans un skill |
| Un profil d'agent (spécialiste) restreint skills et connecteurs | skill livré `customize` | Le rôle de documentaliste peut avoir son profil |
| Texte intégral par DOI : Unpaywall, Semantic Scholar, PubMed Central, CrossRef, puis éditeur ; les fichiers récupérés sont enregistrés dans la session | `literature-access.md` | Science peut déposer le texte source |
| `doi.org`, `api.crossref.org`, `arxiv.org`, `api.semanticscholar.org`, `api.openalex.org` sont dans la liste réseau par défaut du bac à sable | `network-requirements.md` | Aucune ouverture réseau à demander pour la littérature |
| Le relecteur intégré vérifie qu'une citation soutient l'affirmation et qu'un DOI désigne le bon article | `the-reviewer.md` | Contrôle utile, mais interne à Science : l'hôte ne le voit pas |

Mesuré sur l'application le 14 novembre 2026 (0.1.72, macOS, fenêtre propre), journal §37 :

| Essai | Résultat |
|---|---|
| Sous-commandes `run`, `ask`, `chat`, `api`, `mcp` | refusées : « is not a command in this build » |
| Connecteur « commande locale » pointant un script du dossier personnel | lancé, puis `Cannot find module` : son bac à sable ne voit pas le dossier personnel |
| Lien `claude-science url` ouvert par un client sans navigateur, puis par un Chrome sans fenêtre ; démon de l'application, puis second démon en mode serveur (`serve --no-browser --detached`) | page « Sign in », `invalid bearer token` sur toutes les routes |
| Connecteur « Remote » vers un serveur MCP de l'hôte derrière un tunnel HTTPS | accepté : `connected via streamable_http`, appels venant de `Claude-Science/0.1.72` |
| Démarrer une session sans geste | aucun moyen documenté |

Les conditions d'utilisation grand public d'Anthropic (en vigueur le 8 octobre 2025) interdisent l'accès aux services « through automated or non-human means, whether through a bot, script, or otherwise », sauf clé d'API ou permission explicite d'Anthropic. Piloter l'application par un script, par un navigateur automatisé ou par ses routes internes est donc écarté, quelle qu'en soit la faisabilité. Un connecteur MCP est une fonction documentée : Science qui appelle nos outils reste permis.

## 2. Décision : un contrat et un vérificateur, quel que soit le répondant

La liaison tient en deux choses qui ne dépendent pas de qui répond : un **contrat** (question, réponse, refus, fiche vérifiée) et un **vérificateur** sur l'hôte. Une réponse est une donnée, comme le verdict d'une revue (journal §33) : elle ne vaut que vérifiée.

Le transport livré à l'étape S.1 est un **dossier d'échange**, le guichet, que l'hôte et le répondant lisent et écrivent chacun de son côté, avec un **skill** qui porte le protocole. C'est le seul canal dont chaque propriété est documentée côté Science, et le seul par lequel un texte intégral de plusieurs dizaines de pages passe sans être retapé par un modèle. Un serveur MCP au-dessus du même guichet n'ajoute que deux choses, mesurées par un essai hors production : la remise des questions à une session à l'écoute, et le verdict rendu dans l'appel qui dépose la réponse.

### Qui répond

Le contrat ne dit pas qui répond. Trois répondants sont possibles, le vérificateur est le même pour tous :

| Répondant | Déclenchement | Sources | État |
|---|---|---|---|
| Documentaliste sous srt : Claude Code sans interface, profil `researcher`, réseau fermé aux registres de publications | une commande, donc pilotable à distance | Crossref et `doi.org`, Europe PMC et PubMed, arXiv, bioRxiv, Semantic Scholar | étape S.2 |
| Claude Science par le dossier et le skill | une phrase collée dans l'application | ses connecteurs de recherche, son relecteur | livré à l'étape S.1 |
| Claude Science par un connecteur Remote (outils `next_question`, `submit_answer`) | une session lancée une fois, qui reste à l'écoute | idem | essai hors production : trois tours complets le 15 novembre 2026 (journal §39, `bench/evidence-remote`) |

**Exigence du propriétaire, 14 novembre 2026 :** aucune interaction manuelle pour traiter une question, la boucle étant pilotée à distance. Science ne se déclenche pas sans geste : le répondant de la boucle est donc le documentaliste sous srt. Science reste un répondant possible quand une personne est devant l'application.

**Décision du propriétaire, 15 novembre 2026 :** en attendant la réponse d'Anthropic, le répondant utilisé est Claude Science par le connecteur Remote, session lancée une fois par lui ; le documentaliste sous srt n'est pas construit.

## 3. Rôles et zones

| Rôle | Où il tourne | Ce qu'il voit | Ce qu'il écrit |
|---|---|---|---|
| Orchestrateur | hôte | le dépôt, le registre, le guichet | les questions |
| Documentaliste | Claude Science, son bac à sable | le guichet seul ; jamais le dépôt ni le registre | les réponses et les textes sources, dans `in` |
| Vérificateur | hôte, commande `npm run evidence -- verify` | le guichet, le registre des DOI (`doi.org`) | le registre, les refus |
| Builder, reviewer | srt | les fiches vérifiées que l'orchestrateur met dans la consigne | rien ici |

Deux dossiers, hors dépôt, de mode 0700, créés par la commande et refusés s'ils ne sont pas de vrais dossiers de l'utilisateur courant :

```
<registre>/                 hôte seul ; fait foi
  asked/<id>.json           la question telle qu'elle a été posée
  verified/<id>.json        la fiche vérifiée
  sources/<sha256>.txt      le texte source dans lequel le passage a été trouvé

<guichet>/                  la zone d'échange ; rien de ce qui s'y trouve ne fait foi
  out/                      l'hôte écrit ; accordé à Science en lecture seule
    <id>.question.json      copie de la question
    <id>.rejected.json      les refus du vérificateur, pour la passe suivante de Science
    SKILL.md                le skill, recopié depuis le lanceur à chaque `ask`
    answer.schema.json      le schéma de la réponse
  in/                       Science écrit ; accordé en lecture et écriture
    <id>.answer.json        la réponse
    <nom>.txt               le texte intégral d'un article cité, en texte brut
```

La question utilisée par le vérificateur est celle du registre ; une fiche vérifiée ne vit que dans le registre, avec la copie du texte qui la prouve.

`out` et `in` sont **plats**, et c'est une règle de sécurité, pas de rangement. Science peut créer des liens dans ce qu'il a le droit d'écrire. Avec des sous-dossiers, il suffirait de remplacer l'un d'eux par un lien vers un dossier de l'hôte pour que le vérificateur lise ou écrive ailleurs, et aucun contrôle fait avant l'accès ne résiste à un remplacement fait entre le contrôle et l'accès (constat de la revue de l'étape S.1a, reproduit sur l'adaptateur). Dans un dossier plat dont le parent n'est pas inscriptible par Science, le seul composant qu'il maîtrise est le dernier, et celui-là se contrôle sans fenêtre : lecture par un descripteur ouvert sans suivre de lien (`O_NOFOLLOW`), puis `fstat` sur ce descripteur (fichier ordinaire, un seul lien physique, taille bornée) et lecture bornée sur ce même descripteur ; écriture dans un fichier temporaire créé en exclusivité, puis renommage, qui remplace un lien au lieu de le suivre.

La lecture seule de `out` protège le skill : sans elle, un article piégé pourrait faire réécrire à Science les instructions de ses propres sessions futures. Elle est tenue par le bac à sable de Science ; si le dossier est accordé en écriture par erreur, l'hôte reste protégé par la règle précédente, et le skill est de toute façon recopié à chaque `ask`.

## 4. Contrat

Identifiant : `^[a-z0-9][a-z0-9-]{0,62}$`.

Question (`asked/<id>.json`, `out/<id>.question.json`) : `{ "id", "question" (1 à 2 000 caractères), "asked_at" (ISO 8601) }`.

Réponse (`in/<id>.answer.json`), objet strict :

```json
{
  "id": "<identifiant de la question>",
  "claims": [
    {
      "statement": "une affirmation, 1 à 600 caractères",
      "sources": [
        {
          "doi": "10.xxxx/yyyy",
          "title": "le titre de l'article",
          "quote": "un passage recopié mot pour mot, 40 à 600 caractères",
          "text": "<nom>.txt"
        }
      ]
    }
  ],
  "not_found": ["ce qui a été cherché et n'a pas été trouvé"]
}
```

- Une affirmation a au moins une source. `claims` et `not_found` ne sont pas vides tous les deux : « aucune publication ne l'établit » est une réponse valide, et elle se vérifie comme les autres.
- `text` est le nom d'un fichier de `in/` : `^[A-Za-z0-9._-]{1,120}\.txt$`, fichier ordinaire (ni lien symbolique ni lien physique), 5 Mio au plus.

Le schéma JSON de la réponse (`answer.schema.json`, dans le skill) est généré du contrat zod ; un scénario compare les deux.

Fiche vérifiée (`verified/<id>.json`) : `{ "id", "question", "verified_at", "level", "claims": [{ "statement", "sources": [{ "doi", "title", "year", "quote", "text_sha256" }] }], "not_found" }`. `title` et `year` viennent du registre des DOI, pas de la réponse. `level` dit ce qui a été prouvé ; à cette étape, une seule valeur : `quote_in_supplied_text`.

Refus (`out/<id>.rejected.json`) : `{ "id", "rejected_at", "answer_sha256", "reasons": [{ "code", "claim", "source", "detail" }] }`, `claim` et `source` étant les rangs concernés ou `null`.

## 5. Ce que le vérificateur prouve, et ce qu'il ne prouve pas

Pour chaque source, dans cet ordre ; tous les refus d'une réponse sont rendus ensemble.

| Code | Refus | Preuve |
|---|---|---|
| `ANSWER_INVALID` | la réponse ne respecte pas le contrat, ou n'est pas du JSON | contrat zod strict |
| `ANSWER_ID_MISMATCH` | l'identifiant du corps n'est pas celui du fichier | comparaison |
| `QUESTION_UNKNOWN` | aucune question de cet identifiant au registre | registre |
| `DOI_UNKNOWN` | le DOI n'existe pas | `GET https://doi.org/<doi>`, `Accept: application/vnd.citationstyles.csl+json`, réponse 404 |
| `TITLE_MISMATCH` | le DOI désigne un autre article | titre du registre contre titre de la réponse, normalisés |
| `RETRACTED` | l'article est rétracté | `updated-by` du registre contient une entrée de type `retraction` |
| `SOURCE_TEXT_MISSING` | le fichier source est absent, n'est pas un fichier ordinaire à un seul lien ou dépasse 5 Mio | `fstat` sur le descripteur ouvert sans suivre de lien |
| `TEXT_NOT_OF_DOI` | le texte fourni ne contient pas le titre du registre | recherche normalisée |
| `QUOTE_ABSENT` | le passage n'est pas dans le texte fourni | recherche après normalisation des blancs |

Normalisations. Titre : balises retirées, NFKC, minuscules, lettres et chiffres seuls. Passage et texte : NFKC, suites de blancs réduites à une espace, casse conservée.

Registre injoignable (réseau, délai de 20 s, statut autre que 200 ou 404, corps de plus de 1 Mio ou sans titre) : la réponse n'est ni vérifiée ni refusée, elle est **différée** et reprise à la passe suivante.

Relevé le 14 novembre 2026 sur le service réel, avant de spécifier :

| DOI | Agence | Réponse de `doi.org` (CSL JSON) |
|---|---|---|
| `10.1145/3597503.3639187` | Crossref | 200, `title`, `issued` |
| `10.1016/S0140-6736(97)11096-0` | Crossref | 200, `updated-by` avec une entrée `retraction` |
| `10.48550/arXiv.1706.03762` | DataCite | 200, `title`, `issued` ; l'API de Crossref, elle, répond 404 |
| `10.1234/does-not-exist-xyz` | aucune | 404 |

D'où le choix de `doi.org` plutôt que de l'API de Crossref : une seule adresse pour toutes les agences, les prépublications arXiv comprises. Ces quatre réponses sont les fixtures de l'adaptateur.

**Limite de l'étape S.1, écrite dans chaque fiche (`level`).** Le passage est prouvé dans le texte que Science a déposé, et ce texte est rattaché au DOI par son titre. Que ce texte soit bien celui de l'article n'est pas prouvé indépendamment : un texte fabriqué qui contient le titre passerait. L'étape S.3 ferme ce trou (texte récupéré par l'hôte : Europe PMC, arXiv) et ajoute le niveau `quote_in_refetched_text`. Une affirmation n'est jamais jugée vraie par le vérificateur : il prouve qu'un article existant, non rétracté, contient ce passage. Le lien entre le passage et l'affirmation reste à la revue.

## 6. Menaces (STRIDE)

| Menace | Vecteur | Parade |
|---|---|---|
| Usurpation | un autre processus local dépose une réponse | dossiers 0700 de l'utilisateur ; une réponse ne vaut que par sa vérification |
| Falsification | Science, ou un texte qu'il a lu, modifie une question, un refus, une fiche ou le skill | le registre est hors du guichet ; question et fiches lues du registre seul ; `out` accordé en lecture seule, skill recopié à chaque `ask` |
| Falsification | texte source fabriqué | limite écrite au §5, fermée à l'étape S.3 |
| Répudiation | d'où vient une fiche | la fiche garde l'empreinte du texte, le registre garde le texte |
| Divulgation | la question emporte du code ou un secret vers Science | la question est écrite par l'orchestrateur, bornée à 2 000 caractères ; Science ne voit jamais le dépôt |
| Divulgation, falsification | lien posé dans le guichet vers un fichier ou un dossier de l'hôte | `out` et `in` plats ; lecture par descripteur sans suivre de lien, fichier ordinaire à un seul lien ; écriture par fichier temporaire exclusif puis renommage (§3) |
| Divulgation | donnée personnelle envoyée au registre | la requête ne porte que le DOI et un nom de client générique, aucune adresse |
| Injection | un article contient des instructions, qui finissent dans une consigne | la fiche est bornée (affirmation et passage de 600 caractères), le passage est une citation prouvée, et le prompt du builder traite le contenu reçu comme une donnée |
| Déni de service | réponse, texte ou réponse du registre énormes | bornes du contrat, 5 Mio par texte, 1 Mio par réponse du registre, délai de 20 s |
| Élévation | le vérificateur, hors srt, lit des fichiers non fiables | aucun code exécuté, aucun processus lancé, JSON validé par contrat ; sous srt à l'étape S.4 |

## 7. Commande

```
npm run evidence -- ask <registre> <guichet> <id> < question.txt
npm run evidence -- verify <registre> <guichet>
```

`ask` enregistre la question au registre, la copie dans `out` et y recopie le skill du lanceur. `verify` traite chaque réponse déposée qui n'est pas encore vérifiée ; une réponse déjà refusée n'est reprise que si son contenu ou celui d'un texte qu'elle cite a changé (l'empreinte du refus couvre les deux). Elle écrit une ligne JSON (`verified`, `rejected`, `deferred`, `pending`) et sort en 0 (rien de refusé ni de différé), 1 (au moins un refus ou un différé), 2 (arguments ou dossiers refusés) ou 3 (erreur imprévue, une ligne sur la sortie d'erreur).

Composant `tools/evidence`, couches `domain`, `application`, `infrastructure`, racine de composition `src/main.ts`, entrée `src/cli.ts`. Les schémas zod du contrat sont dans `packages/contracts` (`evidence.ts`), seule source des contrats du dépôt : le domaine d'un composant n'importe pas zod. Deux ports, chacun avec son adaptateur en mémoire et son contrat : le registre des DOI (`doi.org`, `fetch` injecté) et le dépôt des questions, réponses et fiches (système de fichiers).

## 8. Côté Science

Le skill `evidence-desk` (`tools/evidence/skill/SKILL.md` et `answer.schema.json`) dit au documentaliste : lire les questions sans réponse et les refus ; chercher dans la littérature ; pour chaque source, récupérer le texte intégral par outil et le déposer dans `in/` sans le réécrire ; recopier le passage mot pour mot depuis ce fichier ; écrire la réponse selon le schéma ; dire ce qui n'a pas été trouvé plutôt que de combler.

Geste du propriétaire, une fois par projet Science : accorder `<guichet>/out` en lecture seule et `<guichet>/in` en lecture et écriture. Puis, à chaque lot de questions, une phrase : « Lis `<guichet>/out/SKILL.md` et traite les questions en attente. » Le skill peut ensuite être ajouté dans Réglages, Skills, pour être appelé par `/evidence-desk`.

## 9. Étapes

| Étape | Contenu | État |
|---|---|---|
| S.1 | Contrat, dépôt, registre des DOI, `ask`, `verify`, skill ; preuve réelle contre `doi.org` | livré |
| S.2 | Documentaliste sous srt : profil `researcher`, commande qui fait répondre une question sans geste | en suspens (décision du 15 novembre 2026) ; confinement essayé sous srt réel |
| S.3 | Texte récupéré par l'hôte, niveau `quote_in_refetched_text` | après S.2 |
| S.4 | Vérificateur sous srt, module MCP servi par la gateway ; c'est là que le connecteur Remote de Science trouve sa place | avec O.2 |
