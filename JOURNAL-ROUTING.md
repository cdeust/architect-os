# Routage des sessions par rôle et par story points

Journal en ajout seul de la branche `model-routing`. Chaque section est datée ; aucune n'est réécrite.

## 1. Reprise et base, 25 novembre 2026

**Reprise.** La session Codex qui menait la tâche s'est arrêtée sur sa limite de quota après deux commits : la fusion locale de `spec-plug` et la conception du §13 avec son STRIDE. Aucune ligne de routage n'avait été écrite. La session suivante, sous Claude Opus 5.5, reprend le code comme le sien.

**Base.** `main` a reçu le constructeur SBX en squash (#136) et le README de #137. La branche portait deux copies du premier commit de #135 (l'une par l'ancienne branche SBX, l'autre par `spec-plug`), une fusion et les anciens commits SBX. Elle repart de `origin/main` avec deux commits seulement : une copie de `8dde031a` (les tickets de `spec-plug`, conflits résolus sans le contenu de #135), provisoire jusqu'à la livraison de `spec-plug` par sa propre session, et la conception. Le routage dépend réellement de `spec-plug`, qui porte les points et les dépendances des tickets ; il ne dépend pas de #135.

**Décisions de périmètre, avant le code.**

- Step n'a aucun adaptateur Google, et le client Antigravity s'arrête à la création de session hors ligne (banc SBX). Une route de revue vers Gemini est donc une attente nommée : aucune session, aucun repli sur le fournisseur de l'auteur, et l'étape ne rend pas `passed`. L'adaptateur reste à construire.
- Les identifiants exécutables qualifiés sont ceux des étapes commitées et du schéma Codex : `claude-haiku-5-5`, `claude-sonnet-5-5`, `claude-opus-5-5`, `gpt-6.2-astra`, `gpt-6.2-sol`. Terra, Luna et Gemini n'en ont aucun : la table les nomme dans sa base, pas comme candidats. `gemini-4-neon-high` n'apparaît que dans des fixtures de test.
- Il n'existe aucune borne de tours dans les sessions de Step. La seule borne que le lanceur observe est la limite de durée, qui rend la session `stopped` : c'est elle que le signal d'escalade emploie.
- Le rôle de plan (Astra et Fable) n'entre pas dans la table : aucune session de Step ne le consomme, et une entrée que rien ne lit serait de la configuration morte.

**Table.** `packages/sandbox/routing.json`, schéma et dérivation dans `packages/sandbox/src/routing.ts`, une seule implémentation pour Plan et Step. Bandes de construction à 1, 3 et 8 points ; la bande de 1 et 2 points exige au moins un contrôle sans modèle ; Opus puis Sol au-dessus de 8 ; revue vers Google seulement. Limites et efforts : les plus fréquents des étapes commitées. Aucun seuil n'est mesuré, le fichier le dit.

## 2. Construction, 25 novembre 2026

**Plan.** Une politique routée (`step.routing` : ticket facultatif, fournisseurs admis ; noms d'éclaireurs, contrôles, parallélisme) ne nomme aucun modèle, le schéma refuse un `build`. Plan lit la table du lanceur par l'entrée `@architect-os/sandbox/routing.json` du paquet, seulement pour une politique routée, et écrit dans `step.json` la route dérivée et l'empreinte de la table. Une table changée change `step.json`, donc l'empreinte d'approbation : une approbation ancienne est refusée (`PLAN_NOT_APPROVED`). Un ticket impossible à router est refusé avec un code fermé de la dérivation, que Plan affiche tel quel.

**Step.** La table entre dans les fichiers du lanceur, donc dans l'admission. Step refait la route depuis cette copie gelée et refuse `STEP_ROUTING_MISMATCH` avant toute session si `step.json` en diffère, et l'admission exige un spécimen par passe qui peut tourner. Une étape routée joue ses passes une à une ; `src/step-passes.ts` classe chaque passe sur ce que l'hôte observe et décide seul de la promotion. Une étape sans `routing` n'a qu'une passe et garde exactement son relevé et sa sortie d'avant : les 443 scénarios de Step existants sont passés sans changement d'attente.

**Ce qui a été corrigé en route.** Le premier jet posait la raison `BAND_REQUIRES_CHECKS` dès qu'une bande quelconque était sautée ; elle n'est posée que si la bande de départ l'est. Le schéma du bloc `routing` admettait une revue Google marquée comme session (`waiting: false`) ; il exige désormais `waiting: true` pour Google, et un scénario montre le refus. Le §13 laissé par la session précédente disait qu'un verdict invalide « suspend la revue » : le code le traite comme un refus sans promotion, et le texte dit maintenant ce que fait le code ; il parlait d'une « borne de tours » que rien n'observe, remplacée par la limite de durée. Le diagramme disait que des revues Gemini appellent l'agent de Google : faux pour Step, corrigé.

**Ce qui a tourné, hors ligne, sans appel de modèle.** Typage, format, garde d'architecture (436 modules, 1 905 dépendances). Rejeu de `packages/sandbox/features`, `tools/plan/features`, du bout en bout Define, Plan et Step, et de `features/descriptive` : 1 854 scénarios et 6 306 pas verts. Nouveaux : 33 scénarios de la table et de la dérivation, 13 de Plan routé, 21 de Step routé, 1 de bout en bout.

## 3. Base remplacée par `spec-plug` livrée, 25 novembre 2026

La session de `spec-plug` a remis sa branche sur `origin/main` sans le commit de #135 et y a ajouté `05d08528` (les lectures Define et `plan:proposal` prennent l'empreinte du bundle et lancent le serveur directement). La copie provisoire de `8dde031a` (section 1) est retirée : la branche repose sur `spec-plug` telle qu'elle est (`b8b225d6`, `05d08528`). Conflits du seul commit de documentation : la description du diagramme garde la phrase du bundle épinglé de `spec-plug` et remplace celle du routage prévu ; la ligne sous Plan dit le routage. Après le rebase : typage, format, garde d'architecture, et 2 094 scénarios verts sur `packages/sandbox`, `tools/plan`, `tools/define`, le bout en bout Define, Plan et Step, et `features/descriptive`.

## 4. Les constats rendus au relecteur et le plafond de relances, 25 novembre 2026

**Demande.** Le travail sur les exigences des prompts retirés de Spec a transmis deux points, parce que la passe n-1 n'existe que dans `playPass`. R5 : le relecteur de la passe n reçoit les constats bloquants de la passe n-1 et rend un statut par constat ; l'hôte refuse un verdict qui en omet un. I9 : trois réserves sur les relances, chacune à tenir par le code ou à écarter par écrit.

**R5, construit.** Noms convenus par le coordinateur avec l'autre branche, qui ajoute `criteria` au verdict : `prior_findings: [{ id: 'PF-<n>', status: 'resolved' | 'unresolved' }]`, section « Findings of the previous review », borne de 4 000 octets. `verdict`, `findings` et `not_checked` ne changent pas ; le schéma commité est régénéré depuis le contrat. Scénarios : la revue de la passe 2 reçoit PF-1 et PF-2 et passe en les résolvant ; un id omis, aucun statut, un id inventé, un id répété rendent le verdict invalide, sans promotion ; un `unresolved` bloque et, sur la dernière bande, l'étape est refusée ; une première revue qui statue sur des constats est invalide ; une passe promue sur un contrôle ne reçoit pas la section. Contrôle positif : le refus de l'hôte neutralisé, 5 des 29 scénarios de l'étape routée échouent (les quatre cas invalides et la première revue) ; restauré, 29 sur 29.

**I9, décidé.** Le plafond n'est pas un nombre écrit : relances = longueur de l'échelle moins un. Un ticket qui démarre dans la bande haute n'a aucune relance. Une étape non routée garde une passe. Raisons au §13. Le changement du prompt de revue change son empreinte, donc les preuves d'admission : la branche livrée en second refait la réadmission.

## 5. Remise sur `main` après #135, 26 novembre 2026

`main` a reçu #135 (`9483dc5b`) et `spec-plug` est devenu un seul commit, `547b16a9`, encore posé sur l'ancien `main`. La branche est rejouée sur `origin/main` avec une copie de `547b16a9` en tête de pile, provisoire jusqu'à sa livraison. Conflits résolus : dans `CLAUDE.md`, le texte de #135 pour les exceptions de `node:child_process` et le git de l'hôte, celui de `spec-plug` pour le lecteur Define ; dans le diagramme, les phrases de #135 et de `spec-plug` gardées ensemble, puis les cinq phrases du routage réappliquées sur cette base ; dans `docs/bricks.md`, la phrase O.3 réappliquée sur le tableau de `main`.

`spec-plug` refuse maintenant `TICKET-000`. Les trois expressions de ticket du routage (bloc `routing` de `step.json`, politique routée, relevé) prennent désormais l'identifiant du schéma partagé des tickets au lieu de le recopier. Scénario : une politique qui désigne `TICKET-000` est refusée par le schéma ; contrôle positif, l'ancienne expression remise, ce scénario échoue. Après la remise : typage, format, garde d'architecture, et 2 130 scénarios verts sur `packages/sandbox`, `tools/plan`, `tools/define`, le bout en bout et `features/descriptive`. La mutation reste suspendue sur demande du coordinateur (machine saturée).

## 6. Ce que la revue hébergée de #142 a trouvé, 26 novembre 2026

La revue hébergée (1 sur 3) a bloqué sur deux groupes de lignes changées qu'aucun scénario n'exerçait, à juste titre. La coupure des constats à la borne en octets (`renderFindings`, `renderPriorFindings`) n'était jamais atteinte : les fixtures n'avaient que deux constats courts. Les refus `ROUTING_PROVIDER_DUPLICATE` et `ROUTING_PASS_ORDER` n'apparaissaient dans aucun scénario. Ajouts : `packages/sandbox/features/step-passes.feature`, qui place la borne exactement à la longueur de deux entrées puis un octet en dessous, pour les deux rendus, avec les ids reçus par la revue ; une ligne du plan routé qui admet deux fois le même fournisseur ; deux copies du relevé publié aux passes hors d'ordre ou numérotées à partir de 2. Contrôles positifs : un prédicat neutralisé ou `>` changé en `>=`, 1, 1 et 4 scénarios échouent ; restaurés, 122 sur 122.
