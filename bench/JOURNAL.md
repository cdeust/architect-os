# Journal du banc 1b.0 (append-only)

Chaque entree : une variable, le constat, la cause racine, la suite. Les echecs restent.

## 2026-10-30, run 41037109539 (commit 9c161f5)
- macOS CI : T-41a, T-41b, T-41d, I-7 en echec. `EPERM: operation not permitted, mkdir '/tmp/claude-501'`. Cause : le binaire Claude Code cree son repertoire temporaire par `mkdir` non recursif ; sur le poste il existait deja (artefact de session), pas sur le runner. Le run local etait donc un faux vert.
- Linux CI : srt fonctionne (bwrap 0.9.0, sysctl a 0). T-38, T-39, E-02 sous srt, T-41 : `ENOENT mkdir /tmp/claude/tsx-1001`. Cause : srt fixe `TMPDIR=/tmp/claude` dans la sandbox sans le creer ; tsx y fait un `mkdir` non recursif. Correction : un tmp par monde, transmis par `CLAUDE_CODE_TMPDIR` et ajoute a `allowWrite`.
- Erreur du banc : T-03f avait son attendu inverse sur Linux (parametre `expectReached` passe a l'envers). Corrige.
- Hypothese du banc fausse sur Linux : `denyRead:["~"]` y masque `~` par un tmpfs (ENOENT, liste vide, ecriture ephemere) au lieu d'un EPERM. La propriete testee devient : rien de sensible visible, rien de persiste sur le disque de l'hote (T-02d2, T-02e*), pas un code d'erreur precis.

## 2026-10-30, run 41037711860 (commit c2af66d)
- macOS CI : 47 pass, 0 fail, 2 residual (T-03f, T-06b), 3 constats.
- Linux CI : 44 pass, 5 fail.
  - T-02e, T-02e2 : un hook git et `.git/config` ECRITS PAR LA SANDBOX PERSISTENT sur l'hote quand le chemin n'existait pas au lancement (README srt : seuls les chemins presents sont proteges, recherche limitee en profondeur). T-02e3 (depot a la racine du cwd, cree par l'hote) tient. Suite : T-02e4, `denyWrite` explicite.
  - T-07-fd0 : sous Linux, un socket d'ecoute passe en fd 0 est utilisable par la sandbox (`servi-depuis-sandbox` recu). macOS : EPERM. fd 3 tient. Echec conserve : l'invariant de conception (fd 0-2 sont des tubes) devient une obligation de l'hote.
  - T-38, T-41c : `list_home` reussit sous Linux (tmpfs vide). Defaut d'assertion du banc, corrige (contenu sensible absent).

## 2026-10-30, run 41038015293 (commit b6fc924), conclusion failure (job Linux rouge)
- Correction appliquee depuis le run precedent : T-02e4 (denyWrite explicite) et assertion de liste de `~` tenant compte du tmpfs.
- macOS CI : 53 tests, 48 pass, 0 fail, 2 residual (T-03f, T-06b), 3 finding (T-06-s-TERM, T-06-s-KILL, BROKER-FOREIGN).
- Linux CI : 53 tests, 47 pass, 3 fail, 3 finding (les memes).
  - Echecs conserves : T-02e (`.git/hooks/pre-commit` persiste sur l'hote), T-02e2 (`repo/.git/hooks/pre-commit` et `repo/.git/config` persistent), T-07-fd0 (`servi-depuis-sandbox` recu par le client). T-02e4 passe sur les deux OS : la regle est de nommer les chemins proteges en `denyWrite`.
  - T-39b : Linux accepte `listen` dans la sandbox, l'hote recoit ECONNREFUSED ; macOS refuse par EPERM.
  - T-06-s-KILL : srt tue seul laisse 10 processus sur 11 (Linux) et 2 sur 3 (macOS) ; SIGTERM : 0 et 1. T-06b : 0 survivant sous Linux, 1 sous macOS (residu documente).
  - BROKER-FOREIGN : un processus natif etranger obtient 200 sur POST ; confirme sur les deux OS, P0 ouvert jusqu'a T-42.
  - T-41a a d passent sur les deux OS avec un faux amont et une seule couche srt. Aucun appel reel a Anthropic. T-41 n'exerce pas l'autorisation de task (T-42).
- Limites du banc : broker bufferise (a faire en flux, 1b.2) ; `npm audit` du banc a examiner ; repertoires temporaires non nettoyes ; rejeu a chaque montee de version de srt.

## 2026-10-30, suite de 1b.0 : T-42, T-43, T-45, FD-PIPES, T-02e5/e6, T-34 etendu, T-35-pre (commit local, macOS d'abord ; CI ensuite)
Chaque ligne = une variable. Le verdict Linux est ajoute plus bas apres le run CI.
- **T-42, plomberie** (variable : mecanisme mask + tlsTerminate + broker.localhost du §11.2). Au premier essai local : sentinelle visible dans l'enfant, autorisation posee par le proxy srt, broker TLS accepte (NODE_EXTRA_CA_CERTS du processus srt est honore). `broker.localhost` se resout en `::1` ET `127.0.0.1` sur macOS : le broker ecoute sur `::`. Aucune option `allowPlaintextInject`.
- **T-42, adversarial** : T-04 (e) est reproduit pour l'autorisation : srt substitue la sentinelle dans le corps et dans les autres en-tetes, le broker les recoit avec l'autorisation ; la protection est le REFUS du broker (LEASE_OUT_OF_PLACE, 4 cas sur 4), pas srt. L'amont ne recoit jamais l'autorisation ; la cle reelle n'est que dans `x-api-key`. Reflexion de la cle reelle par l'amont : litteral et deux ecritures (bufferise) retires ; base64, hex et flux SSE fragmente PASSENT jusqu'au worker (3 `residual`). La garantie tient a la requete amont (T-42d), pas au retrait en reponse.
- **T-43** : natif etranger, 8 formes d'appel sans autorisation valide : 401 chaque fois, 0 requete a l'amont ; autorisation de B sur A : 401 ; apres fermeture : ECONNREFUSED. Temoin (ancien broker) : 200 et cle a l'amont. **Constat T-43d** : sur macOS un natif de meme uid lit l'autorisation dans l'environnement du processus srt (`ps -Eww -p <pid>`) et la rejoue avec succes (200). BROKER-FOREIGN est supprime de broker.ts, remplace par T-43.
- **T-45** : Postgres 17.9 reel (socket Unix, dossier temporaire). Le SQL du §4.5 est extrait du document a l'execution. TEMOIN ancien SQL : defaut ETABLI PAR L'EXECUTION (reserve concurrent du meme id : budget sur-retenu 4 manches sur 6 ; settle rejoue : double debit, reserved negatif ; task/montant des parametres). Nouveau SQL : toutes les propriete tenues, T-20 rejoue (100 puis 30). Ordre des verrous : non uniforme dans le texte du document (reserve budgets->reservations, settle reservations->budgets), mais 0 interblocage 40P01 en entrelacement force et en stress ; variante corrigee ecrite par le banc, meme resultat.
- **Echec du banc, T-45** : premier essai, postmaster macOS meurt (`became multithreaded`, locale) : corrige par LC_ALL=C. Premier essai du parseur : instruction parasite issue de l'en-tete du bloc settle, 10 echecs artificiels, corriges (defaut du banc, pas du SQL).
- **FD-PIPES** : helper `assertStdioPipes` (common.ts) utilise par `runSrt`. Refuse handle, fd numerique socket, fichier, `inherit` ; accepte pipe, ignore, FIFO. T-07-fd0 inchange.
- **T-02e5, T-02e6** : rejeu de T-02e et T-02e2 avec denyWrite nommes, nouvelles variantes, originaux inchanges.
- **T-34a a i** : alias (liens symboliques crees par la sandbox ou poses par l'hote, lien dur, renommage, suppression puis recreation, depot imbrique supplementaire, repertoire cree apres le demarrage), regle denyWrite nommes. Aucune liste ajoutee pour masquer un echec. macOS : rien de protege ne persiste en fichier ; un repertoire vide `repo3/.git/hooks` cree apres demarrage PERSISTE (rapporte a part).
- **T-35-pre** : profil gate-tests reconstruit du tableau du §9.2 (le document n'en donne pas le JSON). Non couvert : porte reelle, cucumber/Stryker reels, Postgres de test dans la sandbox, checkout reel.
- **Defaut du banc, T-41d** : l'assertion cherchait la sous-chaine `srt` dans l'argv ; le chemin du worktree `marketplace-srt` la contient, faux echec local. Corrige : segments de chemin exacts.

## 2026-11-14, hote Windows 11 par WSL2 (commit bb450ee de feat/gate-1a, hors CI, poste du proprietaire)
Etape « Hotes » de docs/design/journal.md (§29, §35). srt 0.0.81 ne prend pas Windows natif en charge : la voie jouee est « WSL2 avec srt ».
Hote : Windows 11 Pro 10.0.26300, AMD Ryzen 7 9800X3D (16 fils), 30 Go vus par WSL. Invite : Ubuntu 24.04.2, noyau 6.6.87.2-microsoft-standard-WSL2, x64, systemd. Node 26.11.1 (archive de nodejs.org, SHA-256 NON verifie), bubblewrap 0.9.0, socat 1.8.0.0, ripgrep 14.1.0, Postgres 17.12 avec pgvector (PGDG), Docker 29.1.3 et containerd 2.2.1 (paquet `docker.io` de la distribution, pas Docker Desktop), Claude Code 2.1.312 (binaire `claude-agent-sdk-linux-x64` du lockfile). Utilisateur non root, depot clone sur le disque ext4 de WSL (pas sous /mnt/c). `kernel.apparmor_restrict_unprivileged_userns` n'existe pas sur ce noyau : aucun sysctl a poser.
Chaque ligne = une variable. Les echecs restent.
- **Echec de methode, Postgres** : j'avais installe Postgres 16. `npm test` : 12 scenarios `@postgres` rouges (« needs a PostgreSQL 17 with pgvector »), 1184 verts. Avec Postgres 17.12, pgvector et `PG_BIN` : 1196 verts sur 1196.
- **Blocage non explique** : le tout premier `npm test` est reste 1 h 30 a 0 % CPU, sans enfant actif (un `node -e setInterval` et esbuild). Tue. Non reproduit : trois lancements ensuite, dont `npm test` a l'identique, finissent en 78 a 95 s. Cause inconnue.
- **Piege de WSL** : un processus lance par `nohup ... &` meurt quand l'appel `wsl.exe` qui l'a lance se termine (la VM s'arrete). Tout run long garde sa session ouverte.
- **bench:sandbox, premier run (avant toute correction)** : 102 tests, 79 pass, 18 fail, 5 finding. Treize echecs ne viennent pas de srt :
  - `broker.localhost` et `evil.localhost` ne se resolvent pas (`ENOTFOUND` : `hosts: files dns`, ni nss-myhostname ni nss-resolve). T-42b, c, e, f : `502`. Exigence d'hote sous WSL2 : ces noms vers 127.0.0.1 et ::1, ici par quatre lignes de `/etc/hosts`.
  - **Defaut du banc, T-42h** : les trois variantes reencodees (base64, hex, sse-split) sortaient `pass` alors que le chemin du broker etait coupe (502) : rien n'etait reflechi, « pas de fuite » ne prouvait rien. Corrige : sans statut 200, le verdict est `fail`.
  - **T-45** : `TypeError ... reading 'split'`, T-45a a h rouges. Le document de travail n'a plus de §4.5 (budgets retires, journal de conception §12) : SQL vide, ce que ce journal annoncait. Independant de l'OS. Corrige sans recopier le SQL : quand la section manque, `t45.ts` la lit par `git show <BENCH_DOC_REV>:docs/design/platform-v3-srt.md`, defaut `70a146f` (le texte du run 41044838678). Il faut l'historique complet du depot ; sinon T-45 sort `fail` avec ce motif, sans exception.
  - **Defaut du banc, rapport** : `BENCH_ONLY` ecrasait `reports/bench-sandbox-<os>.json`. J'y ai perdu le rapport du premier run. Corrige : un run partiel ecrit `bench-sandbox-<os>-only-<fichiers>.json`.
- **bench:sandbox, run complet apres corrections** : 106 tests, **92 pass, 5 fail, 3 residual, 6 finding**. Linux CI, run 41044838678 : 92, 5, 3, 6. Memes identifiants un par un :
  - fail : T-02e (`.git/hooks/pre-commit` persiste), T-02e2 (hook et `.git/config` persistent), T-07-fd0 (`servi-depuis-sandbox` recu), T-34h (`repo2/.git/hooks/pre-commit` cree ; `config` : EROFS), T-34i (`repo3/.git/config` et hook crees).
  - residual : T-42h-base64, T-42h-hex, T-42h-sse-split (statut 200, fuite par la forme reencodee).
  - finding : T-06-s-TERM (0 processus restant sur 11), T-06-s-KILL (10 sur 11 restent), T-35-pre-fds, T-43d (`/proc/<pid>/environ` lu, rejeu 200), T-45i, T-45k-ancien.
  - T-45-sync : pass (`git show 70a146f`, reserve 3, settle 1). T-39b, T-41a a d, I-7, T-38, E-01 a E-03, T-23, T-43a et b : pass.
- **T-45 sur le texte de 0dd97c5** (`BENCH_DOC_REV=0dd97c5 BENCH_ONLY=t45`) : 19 tests, 16 pass, 1 fail, 2 finding. Le fail est T-45-sync (settle = 2 instructions, attendu 1), deja dit rouge a `0dd97c5` par le journal de conception (§1). T-45a a h, j, k passent aussi sur ce texte.
- **bench:bare** (`npm run bench:bare`, `claude` du PATH = le binaire 2.1.312 du lockfile) : sortie 0, 2 requetes, jeton de session en `x-api-key` sans `Authorization`, prompt du lanceur dans le prompt systeme, `git push` refuse, outils declares : Bash, Edit, Read.
- **Lecture** : sous WSL2, srt et bwrap se comportent comme sur `ubuntu-24.04` en CI, y compris pour les cinq echecs Linux connus. Aucun ecart d'isolation propre au noyau Microsoft.
- **Non couvert** : srt sous Windows natif (non pris en charge), Docker Desktop, `npm run gate` (Stryker), `npm run code`, `review` et `step` (sessions reelles ; `code.json` lit l'identifiant par `/usr/bin/security`, qui n'existe que sous macOS : lu dans le fichier, non essaye).
- Rapports hors depot : `bench/reports/bench-sandbox-wsl2.json` et `bench-sandbox-wsl2-t45-0dd97c5.json` sur le poste. Mesures de surcout (srt contre Docker) : docs/design/journal.md §38.
