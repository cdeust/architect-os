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
