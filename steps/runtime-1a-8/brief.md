# Step 1a, commit 1: the unpublished section 106 replaced with the account of the refusal by the CI

Section 106 of `docs/design/journal.md` is part of the last commit of this worktree, which is not published: it is replaced before the commit is redone. The 105 published sections are not touched.

## What to do

1. `git show HEAD~1:docs/design/journal.md | grep -c "^## "` must give 105 (the parent of the unpublished commit) and `git diff --numstat HEAD~1 -- docs/design/journal.md` additions only. If not, stop and say what you found.
2. Bring the journal back to the text of the parent (`git checkout HEAD~1 -- docs/design/journal.md`), check 105 sections and no difference against `HEAD~1`, then append to its end, after one empty line, the text between the two marker lines below, exactly. Append; do not rewrite; do not format. Check: 106 sections, additions only against `HEAD~1`.
3. Read the appended section against the tree and report, without changing it, any statement the tree contradicts.

Touch no other file.

<<<SECTION-106-BEGINS>>>
## 106. L'admission d'une exécution, disponible : l'entrée `./aos`, la marque de la racine, trois environnements (19 novembre 2026)

**Ce qui est construit.** L'étape (1a) de la conception du lieu d'écriture (§14 de la note d'orchestration), dans son premier commit : l'admission existe et peut être employée ; elle n'est pas encore obligatoire. Une entrée en shell, `./aos -- PROGRAMME [ARG ...]`, lit un seul réglage, `ARCHITECT_OS_RUNTIME_ROOT`, sans valeur par défaut ; elle lance un assistant d'admission en Node, pris dans un emplacement de confiance et non dans le `PATH` de l'appelant, à la version épinglée du dépôt, sans aucune dépendance installée ; puis elle lance le programme avec une liste fermée de lieux sous la racine (dossier temporaire, caches, configuration de npm), un masque de droits privé, et les réglages de npm qui pourraient les contredire retirés sous toutes leurs graphies. L'admission est un outil du dépôt, `tools/runtime`, dans les couches du dépôt, avec son port et deux adaptateurs, l'un en mémoire. Aucun script de `package.json` ni aucun workflow ne change : c'est le second commit de l'étape.

**La marque et les trois environnements.** La racine porte une marque, écrite une fois par celui qui l'installe : sa version et le nom de son environnement (poste, exécuteur hébergé, serveur). Les planchers de place libre ne viennent jamais de la marque mais du fichier de règles du dépôt, `tools/runtime/admission.json` : deux par environnement, l'un pour le volume de la racine, l'autre pour le disque du dossier personnel, comparés chacun strictement, même sur un seul disque. Ils sont marqués provisoires : l'étape (4) mesure les pics d'une étape et d'une porte et les revoit. Un dossier sans marque, une marque d'une autre version, un environnement inconnu, une racine qui n'est pas son propre chemin réel : refus nommé, avant tout lancement et avant toute écriture.

**Qui a décidé.** Le propriétaire a demandé que les décisions de conception soient prises par un relecteur d'un autre fournisseur. Ce relecteur avait écrit la spécification de l'étape ; il a ensuite tranché les questions ouvertes (les valeurs des planchers, la marque qui porte l'environnement, Node comme prérequis, le découpage en deux commits, les barrières que le changement ne doit pas affaiblir), puis la revue de la première construction et les douze écarts qu'elle déclarait. Le mainteneur a adopté chaque décision.

**Ce que les passes ont trouvé.** Trois passes. Au-delà de la revue de la première, le relecteur de l'autre fournisseur a relevé dans le code sept défauts que ni la revue ni la construction n'avaient vus : l'interpréteur pris dans le `PATH` de l'appelant ; npm qui pouvait rendre à ses enfants une option de démarrage retirée ; pas de masque de droits privé ; une mesure de place libre qui pouvait être attribuée à un autre disque que celui de la racine ; deux admissions simultanées qui pouvaient se refuser l'une l'autre ; une marque lue en partie acceptée comme entière ; l'adaptateur en mémoire qui pouvait écraser un dossier existant. Tous sont corrigés, chacun avec son scénario. La construction a aussi trouvé elle-même un lien qui, dans un dossier d'exécution, redirigeait une écriture. La revue de la deuxième passe a trouvé une branche de sécurité que plus aucun scénario n'atteignait (une substitution entre la vérification et la création) : elle est exercée. La commande de livraison garde, quand elle est lancée par l'entrée, la configuration de l'hôte par laquelle git et le client de la forge s'authentifient.

**La porte a refusé la première livraison.** La CI, sur Linux, a muté les 1 158 mutants des lignes changées de `tools/runtime` en quatre heures vingt et en a trouvé vingt vivants et un sans couverture. Rien n'a été publié ; la branche d'essai a été supprimée. Le mainteneur avait livré sans jouer la mutation avant, en comptant sur la porte : c'est l'erreur, et la porte a fait son travail. Une passe a tué les vingt et un à leur cause : des cas manquaient au contrat du port (ils jouent sur les deux adaptateurs), une branche était redondante. Sa revue a trouvé que deux marques d'équivalence qu'elle avait ajoutées couvraient chacune, sur sa ligne, un autre mutant que la suite tue : une telle marque cache à la porte un mutant qu'elle sait tuer. Une seconde passe a retiré les deux marques en retirant la redondance qu'elles signalaient ; il ne reste aucune marque dans le code de l'outil. Puis l'hôte a joué la mutation ciblée sur les lignes changées et sur celles des vingt et un : 520 mutants, aucun vivant, aucun sans couverture (cent treize minutes).

**Coût.** Sept passes, revues comprises, avant celle qui écrit cette section : 39,92 $. Les décisions de l'autre fournisseur se comptent sur un abonnement : non chiffrées ici.

**Ce qui n'est pas prouvé.** La mutation des lignes changées est jouée par la porte de cette livraison, non par les passes. Les planchers de l'exécuteur hébergé et du serveur reposent sur des hypothèses : le premier passage de la CI avec l'entrée obligatoire vérifiera ceux de l'exécuteur hébergé ; ceux du serveur attendent un serveur et l'étape (4). L'entrée a été jouée sous trois shells (`sh`, `dash`, `bash`), tous sur macOS, jamais sous Linux. Le code candidat que la porte exécute en tant qu'hôte n'est pas confiné par cette étape : c'est la porte sous sandbox, une étape de la feuille de route.

**Suite.** Le second commit de l'étape (1a) : l'entrée obligatoire, chaque script et les cinq workflows dans le même commit. Puis l'étape (1b) : les profils, dont les écritures git du constructeur.

- Recherche : chaque décision est d'un relecteur d'un autre fournisseur, sur les fichiers, adoptée par le mainteneur ; ce qui repose sur une hypothèse est dit comme tel.
- SSDLC : l'entrée refuse avant d'écrire ; l'interpréteur d'admission n'est pas celui de l'appelant ; aucun secret ni configuration de l'hôte n'est copié sous la racine.
- Opérationnel : aucun chemin du poste n'est écrit dans le dépôt ; la racine est donnée au lancement ; IRB sans objet.
<<<SECTION-106-ENDS>>>

## Checklist

- [ ] 106 sections; additions only against `HEAD~1`.
- [ ] `git status --short` before and after, in the report.
