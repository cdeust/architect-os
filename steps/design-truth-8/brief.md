# Step V.1: the rule of the key file of the broker, as the code holds it, in every place

The pass before (`steps/design-truth-7/`) replaced the unpublished section 105 of the journal and wrote the mode of the key file as « readable by its owner only (0600 or 0400) » where a text states what the broker accepts. Its review accepted it and showed the wording is still narrower than the code: `modules/broker/src/infrastructure/key-file.ts` refuses a file whose mode has any permission for the group or for others (`(stat.mode & 0o077) !== 0`), so it accepts 0600, 0400, and also 0700 or 0200; the scenarios prove two cases. And the message of refusal of that file names « 0600 » alone, which the scenarios assert. The rule is said once as the code holds it, everywhere, the message included.

## What to do

1. `modules/broker/src/infrastructure/key-file.ts`: the message of refusal says the rule as the code holds it (the file must give no permission to its group nor to others), and may give 0600 as the example of the provisioning. Change no other line of the code. The scenarios of `modules/broker/features/broker-start.feature` that assert the old text follow; add one row that shows a mode other than 0600 and 0400 with no group or other bit is trusted (0700), and one that shows a write bit for others is refused (0602), if the outline allows a row: the step text stays unique across the repository. Kill every mutant of the changed line: run `npx stryker run --mutate "modules/broker/src/infrastructure/key-file.ts"` if your sandbox allows it, else say so plainly (the host plays the mutation).
2. Every place that states what the broker accepts or refuses (the places of the table of the pass before, and the line of the threat table of `docs/design/platform-v3-srt.md` near line 174, which gives the protected file as a mitigation: that is a statement of what the broker refuses): « no permission for its group nor for others » in the language of its file. A statement of how the owner provisions the key (a file written 0600: `CLAUDE.md`, the holder table near line 67, R-8 near line 191 of the design) stays.
3. The journal: `git show HEAD:docs/design/journal.md | grep -c "^## "` must give 104. Bring the journal back to its published text (`git checkout -- docs/design/journal.md`), then append to its end, after one empty line, the text between the two marker lines below, exactly. Append; do not rewrite; do not format.
4. Check: 105 sections; additions only against `HEAD`.

<<<SECTION-105-BEGINS>>>
## 105. Le document de conception de la plate-forme et la présentation disent ce que l'arbre contient (19 novembre 2026)

**Ce qui a déclenché l'étape.** Le §104 l'a nommée comme suite : un balayage du document de conception de la plate-forme (`docs/design/platform-v3-srt.md`), demandé en lecture seule à un modèle d'un autre fournisseur, y avait relevé une trentaine de passages au présent que l'arbre contredit. Un document de conception qui dit présent ce qui ne l'est pas, ou plus, est une affirmation fausse d'architecture et, quand il parle d'isolation, de sécurité.

**Ce qui est corrigé.** Trois sortes de passages, chacune traitée à sa façon. Une décision renversée dont le texte était resté (les conteneurs après les décisions 21 et 22, les hooks de session après la décision 2) : le passage dit ce qui vaut aujourd'hui et nomme la décision qui l'a renversé. Une conception en vigueur et non construite, écrite comme faite (les trois méta-outils, l'exécuteur, le parcours d'un appel `execute`) : le passage dit ce que l'arbre fait aujourd'hui et quelle brique ajoutera le reste. Une description qui avait dérivé (tous les liens internes en MCP sur stdio, alors qu'un module rappelle la gateway en HTTP ; une promesse sur les secrets du dossier personnel plus large que ce que nomment les profils ; un arrêt de groupe annoncé sans descendant, contre un risque accepté qui documente le cas macOS) : le passage dit ce que fait le code. Les figures de la page de conception, les treize diapositives de la présentation avec leurs notes, sa description et le script de la vidéo sont relus en entier contre le texte corrigé, et chaque marque de preuve (« prouvé », « à prouver », « prévu ») y suit celle du texte. Hors de la documentation, le broker change sur deux points. La description de sa configuration disait une route, quand ses routes en admettent deux. Et la règle du fichier de sa clé est dite partout comme le code la tient : aucun droit pour le groupe ni pour les autres ; le message de refus et ses scénarios disaient « 0600 », qui n'en est qu'un cas.

**Une question de conception, décidée par l'autre fournisseur.** Le tableau de l'état des briques gardait la mesure de la brique 0 sous « prévu », quand le README la dit faite. Le modèle le plus capable de l'autre fournisseur, consulté en lecture seule, a séparé deux mesures que les textes confondaient : la mesure de coût de la brique 0 est faite (4 novembre 2026 : vingt tâches, trois configurations de lancement, cent quatre-vingts sessions, §22, §23) ; la mesure de référence de M1 et M2, sur vingt tâches représentatives de la plate-forme et par couche, reste ouverte à la date du propriétaire (D-7). Le mainteneur a adopté la décision ; le document dit les deux. La ligne de D-7 de ce journal (§4) n'est pas récrite : cette section en tient lieu.

**Ce que les passes ont appris.** Cinq passes. La première a corrigé le texte et laissé les mêmes affirmations dans les figures et les diapositives ; la deuxième les a relues en entier ; la troisième a trouvé une espèce de plus, la marque de preuve en retard sur le texte, et l'a cherchée partout ; la quatrième a porté les décisions du mainteneur sur ce que les passes avaient listé sans le changer ; la cinquième, la décision sur la mesure de référence. La règle du §104 a tenu : une affirmation corrigée à un endroit l'est partout où elle est faite.

**Coût.** Cinq passes : 30,48 $. La décision de l'autre fournisseur se compte sur un abonnement : non chiffrée ici.

**Ce qui n'est pas prouvé.** Les diapositives et la page de conception n'ont pas été rendues dans la sandbox des passes (un navigateur sans tête y refuse de démarrer) : elles ont été relues dans leur source. La date de la mesure de référence de M1 et M2 est au propriétaire.

**Suite, dans l'ordre.** (1) Le lieu d'écriture, étape (1a) : entrée unique, marque, admission. (2) Étape (1b) : les profils, dont les écritures git du constructeur. (3) La porte. (4) Le second constructeur. (5) La copie unique des dépendances.

- Recherche : chaque passage corrigé repose sur un fichier, une décision ou un commit ; une question de conception est tranchée par un relecteur d'un autre fournisseur, sur les fichiers, et adoptée par le mainteneur.
- SSDLC : aucune affirmation d'isolation ni de secret n'en dit plus que ce qu'un profil ou un scénario montre.
- Opérationnel : le document distingue ce qui tourne aujourd'hui de ce qu'un serveur ajoutera ; IRB sans objet.
<<<SECTION-105-ENDS>>>

## Checklist

- [ ] `npx tsc -p modules/broker --noEmit --composite false --incremental false`, `npx prettier --check .`: green.
- [ ] `npx cucumber-js --profile replay features/descriptive modules/broker/features/broker-start.feature`: give the counts; scenarios that need a listening port may fail in your sandbox with `EPERM`: say which, the host replays them. (Run it yourself.)
- [ ] `git status --short` before and after, in the report.
