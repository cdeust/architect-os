# Step W.0, the journal: the unpublished section 104 replaced by its corrected text

The pass before (`steps/runtime-root-0y/`) appended section 104 to `docs/design/journal.md`, word for word, as asked. Its review found two sentences of that text that say more than the guard does (the two words are absent from every file **the rule reads**, not from every tracked file: Markdown, the kept results and the records of the steps are outside the rule) and one that can be read two ways (the text of a symbolic link is its target, read and not followed). The fault is in the text the maintainer gave, not in the appending.

The journal is append-only **against what is published**. Section 104 is not published: it exists only in this worktree, uncommitted. It is replaced before the commit, and the published sections are not touched.

## What to do

1. `git diff --numstat -- docs/design/journal.md` must show additions only, and `git show HEAD:docs/design/journal.md | grep -c "^## "` must give 103. If not, stop and say what you found.
2. Bring the file back to its published text: `git checkout -- docs/design/journal.md`. Check it has 103 sections and no difference against `HEAD`.
3. Append to the end of the file, after one empty line, the text between the two marker lines below, exactly: every character, every accent, every table row, nothing added, nothing reworded. The two marker lines are not part of the text. Append; do not rewrite the file.
4. Check: 104 sections; `git diff --numstat -- docs/design/journal.md` shows additions only; no other file changed by this pass (`git status --short` before and after, in the report).
5. Read the appended section against the tree and report, without changing the text, any statement the tree contradicts. The format check of the repository leaves `docs/design/` out (`.prettierignore`): do not format the file.

Touch no other file.

<<<SECTION-104-BEGINS>>>
## 104. Le banc d'essai de conteneurs retiré, deux contrôles qui lisent du texte remplacés par des règles fermées, trois conceptions (19 novembre 2026)

**Ce qui a déclenché l'étape.** Le 18 novembre, la machine de développement s'est arrêtée, le disque de son dossier personnel plein. Le propriétaire a posé une règle (le travail se fait sur le volume du projet ; s'il manque, on suspend) et rappelé trois exigences : aucun pansement, aucune simplification qui retire une barrière, une règle n'oblige que si un mécanisme l'impose. Il a aussi demandé qu'un modèle d'un autre fournisseur aide à la conception et à l'implémentation.

**Ce qui est livré.**

- Le banc d'essai de conteneurs quitte la surface exécutable : `baseline/overhead.ts` et son script sont retirés (le dépôt a quitté les conteneurs aux décisions 21 et 22 ; le programme lançait une machine virtuelle et un nettoyage de tout le démon). Ses résultats restent ; le commit qui le porte est nommé dans `baseline/README.md`.
- Une garde contre son retour, `features/arch/no-container-command.feature` : hors du Markdown, des résultats gardés et des enregistrements des étapes, deux mots n'apparaissent dans aucun fichier du dépôt en dehors d'une liste fermée de six, tenue dans les deux sens ; le texte d'un lien symbolique suivi, qui est sa cible, est lu sans que le lien soit suivi ; les fichiers `step.json`, que la boucle exécute, sont lus.
- Une image des profils de sandbox produite par une fonction à partir des cinq fichiers de profil, `docs/diagrams/isolation-profiles.svg`, que la porte tient égale à ce que la fonction produit (`features/arch/isolation-diagram.feature`, `npm run diagram:isolation`). L'image dessinée à la main garde qui lance quoi et qui tient l'identifiant.
- Trois conceptions dans la note d'orchestration (§14), chacune avec ses menaces avant son code : une seule copie des dépendances ; un seul lieu d'écriture imposé par l'hôte ; un constructeur d'un autre fournisseur derrière un proxy de l'hôte. Elles entrent dans la feuille de route du README et dans les schémas.
- Le README, la page des tests, trois pages de conception et la diapositive d'isolation corrigés là où ils disaient plus que le code, ou présentaient les conteneurs comme un repli de l'isolation.
- Un scénario publié dépendait d'un dossier temporaire de la machine, disparu au redémarrage : son enfant reçoit maintenant le dossier temporaire du processus.

**Ce que les passes ont appris.** L'étape a pris vingt-quatre passes avant celles qui écrivent cette section. Quatre fois, la revue a trouvé un contournement de plus à un contrôle qui lisait du texte avec des motifs ; quatre fois, le mainteneur a d'abord ajouté un motif, puis changé de question :

| Contrôle | Question qui n'avait pas de réponse fermée | Règle qui la remplace |
| --- | --- | --- |
| Garde contre les conteneurs | quels fichiers peuvent lancer un processus | deux mots absents de tout fichier que la règle lit, hors d'une liste fermée |
| Schéma d'isolation contre les profils | quel texte du schéma parle d'un profil | les lignes des profils sont produites, et le contrôle est une égalité de fichier |
| Texte hors de la zone produite | quel balisage peut cacher un chemin | l'image produite est un fichier à elle ; l'autre est de la prose, relue |
| Place d'un texte dans l'image | quelle largeur a un caractère | police à largeur fixe, largeur calculée pour la taille dessinée |

Une cinquième classe est revenue jusqu'à la fin : une même affirmation écrite à plusieurs endroits, corrigée à un seul. La raison pour laquelle deux dossiers de scénarios sont hors de la mutation était écrite dans quatre fichiers, dont un faux ; elle est écrite une fois, dans `cucumber.mjs`, et les autres y renvoient.

**Un défaut de séparation relevé, non fermé par cette étape.** Le profil du constructeur ouvre en écriture le magasin d'objets partagé du dépôt, ses références sauf celle de `main`, et ses journaux : une session de construction peut créer un commit et déplacer une référence locale. Le schéma disait le contraire. La conception du lieu d'écriture le traite à son étape (1b), avec le cache du dossier personnel que le même profil ouvre ; l'image produite et le README disent ce que le profil ouvre aujourd'hui.

**Le relecteur d'un autre fournisseur.** Deux modèles d'un autre fournisseur ont été employés en lecture seule, par un plugin vérifié avant son installation. Le plus capable a contesté les conceptions : ses constats ont changé neuf points de celle du lieu d'écriture, et retiré de celle des dépendances une autorisation de scripts d'installation qui affaiblissait l'invariant présent. L'autre a balayé le changement entier avant la livraison et proposé des corrections numérotées ; une session de construction a vérifié chacune contre le code avant de l'appliquer, de la reformuler ou de la refuser. Aucun des deux n'a écrit dans le dépôt : le propriétaire a décidé qu'un tel modèle n'écrit que lancé par la boucle, sous srt, derrière un proxy de l'hôte, ce qui est la troisième conception.

**Écarté de cette livraison.** Le script des mesures de la copie unique des dépendances : neuf revues y trouvaient encore des défauts, et la contestation a changé ce qu'il doit mesurer. Il sera spécifié d'un bloc après le lieu d'écriture, sous lequel vit le magasin ; les mesures restent exigées avant toute migration.

**Coût.** Vingt-quatre passes pour le retrait et ses contrôles : 32,97 $. Huit passes mesurées du script écarté : 10,98 $ (une neuvième, interrompue par l'arrêt de la machine, n'a pas de mesure). Les lectures par l'autre fournisseur se comptent sur un abonnement, en requêtes et non en dollars : non chiffrées ici.

**Ce qui n'est pas prouvé.** La suite complète, la mutation et les scénarios de sandbox n'ont pas été joués par les passes : la porte de cette livraison les joue. Les polices de l'image produite ont été mesurées pour une famille ; les autres de la liste sont nommées comme non mesurées. Les conceptions du lieu d'écriture et du second constructeur reposent sur des lectures, dont une préversion d'un éditeur tiers : leurs essais sont écrits avant le code.

**Suite, dans l'ordre.** (1) Le document de conception de la plate-forme et la diapositive d'isolation remis d'accord avec l'arbre : un balayage en a relevé une trentaine de passages au présent que l'arbre contredit (décisions renversées restées dans le texte, conception non construite écrite comme faite, descriptions qui ont dérivé). (2) Le lieu d'écriture, étape (1a) : entrée unique, marque, admission. (3) Étape (1b) : les profils, dont les écritures git du constructeur. (4) La porte. (5) Le second constructeur. (6) La copie unique des dépendances.

- Recherche : chaque règle qui remplace un motif est dite avec la question qu'elle abandonne ; les constats d'un autre fournisseur sont des affirmations, vérifiées contre le code avant d'être appliquées ; ce qui n'est pas prouvé est nommé.
- SSDLC : trois conceptions avec leurs menaces avant leur code ; une image de l'isolation que la porte tient égale aux profils ; un défaut de moindre privilège relevé, daté et placé à son étape ; aucun script d'installation autorisé.
- Opérationnel : aucune machine virtuelle n'est lancée par le dépôt ; aucun poste, compte ni chemin privé n'est nommé dans ce que cette étape écrit ; IRB sans objet.
<<<SECTION-104-ENDS>>>

## Checklist

- [ ] 104 sections; additions only against `HEAD`; the first 103 sections byte for byte those of `HEAD` (`git diff HEAD -- docs/design/journal.md` holds only added lines).
- [ ] No other file changed by this pass.
