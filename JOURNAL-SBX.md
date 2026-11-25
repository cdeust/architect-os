# Constructeur SBX — 24 novembre 2026

## Résultat du Step hors ligne

Sur macOS, deux Steps admis ont lancé Codex 0.170.0 sous UID 65534 dans une VM Docker SBX, l’un pour Astra, l’autre pour Sol, avec l’effort `medium`. Dans chaque cas, le client a exécuté la commande d’édition, renvoyé son résultat au fournisseur simulé, et écrit `result.txt` dans le worktree. Le contrôle SRT a lu le fichier et vérifié que l’entrée de test du trousseau lui était inaccessible. Le Step a publié le verdict de justesse Claude rejoué et son `record.json`. Celui-ci porte le fournisseur, le modèle, l’effort, la version, le SHA-256 du client et les deux terminaux de test, soit 10 jetons d’entrée et 6 de sortie. [Scénarios natifs](bench/sbx/native-builder.feature) · [Empreintes épinglées](packages/sandbox/sbx/isolation.json)

Le test lance le vrai `aos`, le script npm de production et le client Linux ARM64. Un module chargé dans les processus de test fournit le service d’identité, les réponses du modèle et le callback local. La relecture Claude utilise un flux enregistré et l’admission du Step un dossier de test. L’installation du compte synthétique et le Step s’exécutent dans deux processus distincts. Deux autres consommateurs concurrents du même compte expiré ont effectué un seul renouvellement dans le vrai trousseau macOS. Le Step sans compte a rendu `SBX_SIGN_IN_REQUIRED`. [Configuration du banc](bench/sbx/step-fixture-preload.mjs) · [Installation et limites du compte](packages/sandbox/README.md#codex-in-docker-sbx)

La mesure réseau a compté une livraison sur le port admis de l’hôte et zéro sur un second port en écoute. Codex appelle directement le proxy HTTP du Step par `host.docker.internal`. La règle SBX autorise le POST sur `/v1/responses` et le profil SRT admis autorise le registre npm sur 443. Les essais ont aussi vérifié le refus en dehors de cette route, le refus d’écriture sur les témoins protégés, l’absence d’accès au trousseau dans la session et le retrait des VM. Après le rejeu, `sbx ls --json` a rendu `[]`.

Le dernier rejeu combiné a passé **1 000 scénarios et 3 207 pas** en 1 min 26,792 s, dont les six scénarios du banc natif. Les témoins Python ont détecté les 75 mutations appliquées aux conditions du bootstrap et aux options de sécurité du client. La compilation TypeScript, Prettier et la garde d’architecture ont réussi (431 modules, 1 877 dépendances). Ce relevé porte sur les fonctionnalités modifiées et le diagramme des profils.

Les trois campagnes Stryker ont tourné successivement avec un seul worker. Les sources inscrites dans leurs rapports correspondent octet pour octet aux fichiers du commit `6a33150d`. Le périmètre TypeScript couvre les nouveaux modules de production et les lignes modifiées des modules Step existants. L’entrée `sbx-sign-in.ts` délègue à la commande testée et n’a produit aucun mutant. Le bootstrap Python est vérifié séparément.

| Campagne                                                          |   Mutants |      Tués | Délais | Erreurs d’exécution | Survivants | Sans couverture |
| ----------------------------------------------------------------- | --------: | --------: | -----: | ------------------: | ---------: | --------------: |
| Port, proxy HTTP et cycle de vie SBX                              |       915 |       815 |     27 |                  73 |          0 |               0 |
| Compte, trousseau et assemblage du Step                           |       628 |       574 |     37 |                  17 |          0 |               0 |
| Admission, déclaration, exécution et reçu du Step, lecture privée |       268 |       263 |      2 |                   3 |          0 |               0 |
| **Total**                                                         | **1 811** | **1 652** | **66** |              **93** |      **0** |           **0** |

**Essai encore ouvert.** Sur le signal du mainteneur, un Step de production doit obtenir un correctif choisi par le vrai modèle sur l’abonnement, faire passer ses contrôles et sa revue, puis publier le reçu et l’usage du fournisseur. La commande ordinaire est `"$LAUNCHER/aos" -- npm --prefix "$LAUNCHER" run step -- "$folder"`. Le consentement initial appartient à l’installation. Le coût monétaire de l’abonnement reste inconnu. Le magasin natif Secret Service demande encore une vérification sur un poste Linux. Gemini intervient uniquement en relecture directe avec son agent.

## Historique des étapes

## B.1 — Le port de construction

Step confie la consigne enrichie et le prompt admis à un Builder. L’adaptateur Claude conserve le lanceur SRT, les arguments, stdin, le délai, le code de sortie et les mesures du flux. La sortie de construction est bornée par la limite en octets du fichier admis. Une sortie trop longue refuse l’étape. Le contrat couvre les deux adaptateurs, la réussite, l’interruption et la limite à l’octet près. TypeScript a compilé. Le rejeu de `builder.feature` et `step-tool.feature` a réussi (69 scénarios, 729 pas).

## B.2 — Flux natif du fournisseur

Le proxy est un objet du processus hôte. Il authentifie une exécution, réserve une requête avant de demander le jeton du compte et fixe la destination HTTPS. Il relaie le corps natif et les octets SSE. Les déclarations d’outils locaux restent disponibles. Les en-têtes de traitement natif du client épinglé sont transmis. Sur faux amont, deux requêtes avec retour d’outil et une notification inconnue ressortent octet pour octet. Le rejeu du proxy a réussi (22 scénarios, 22 pas) et TypeScript a compilé. Les limites de requêtes et d’octets sont cumulées. La limite de jetons porte sur l’usage constaté ; SIWC ne propose pas de plafond avant génération. [Limites SIWC](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)

## B.3 — Le vrai client dans la VM

Le test natif a démarré Codex 0.170.0 sous UID 65534. Le faux amont a envoyé un appel à l’outil du client, puis a reçu son résultat. L’hôte a retrouvé le fichier écrit, les deux témoins protégés intacts, deux terminaux (8 jetons en entrée et 4 en sortie) et la VM retirée. La première exécution avait un `/tmp` en lecture seule pour le bac interne du client ; un tmpfs privé de la VM permet son démarrage. Le test natif a pris 32 secondes. Le rejeu de l’admission SBX et de la garde d’architecture a réussi (40 scénarios, 106 pas) avant l’ajout du cas du lien physique. La compilation TypeScript a réussi. L’essai employait l’adaptateur de production avec un faux amont et un dossier jetable.

Le rejeu suivant, avec le lien physique et la VM native, a passé 14 scénarios et 14 pas en 16 secondes.

## B.4 — Compte, admission et résultat du Step

Dans la première version de B.4, le processus Step conservait les jetons en mémoire pendant la construction et redemandait le consentement au démarrage. La version livrée utilise le coffre du système décrit plus bas. Le dossier privé de l’hôte conserve l’identifiant de l’installation et l’association du client au sujet vérifié. Le test du compte exerce un callback PKCE sur la boucle locale, la signature, le catalogue et la rotation. L’admission compare le fournisseur du constructeur aux pièces de provenance du prompt et refuse une relecture de justesse du même fournisseur. Le coût monétaire de l’abonnement reste inconnu.

Les deux Steps ont utilisé le vrai binaire Codex 0.170.0, à travers l’entrée de production. Les services d’identité et de modèle ont fourni les données de test en mémoire. Dans chaque worktree, le processus natif a écrit `result.txt`. Le contrôle SRT a constaté son existence, une session de revue Claude rejouée a rendu `accept`, puis l’hôte a publié `record.json` avec le modèle choisi et deux terminaux totalisant 10 jetons en entrée et 6 en sortie. Le certificat d’acceptation hors ligne provient de ces fichiers, distincts des instructions du faux amont. La preuve par un correctif décidé par le modèle reste ouverte.

Avant le renforcement du contrat d’interruption et du lecteur de terminaux, le rejeu ciblé du Step, de l’admission, des comptes, de la VM et du diagramme a passé 572 scénarios et 2 434 pas. La première mutation du port et du proxy a trouvé 103 survivants et 31 sans couverture. Après passage au lecteur SSE standard et ajout des contrôles adverses, la deuxième mesure a tué tous les 38 mutants du port. Le proxy comptait alors 237 tués, un délai, 20 survivants, un sans couverture et deux erreurs d’exécution.

La sonde historique Antigravity reste dans le banc. La relecture Gemini utilise l’agent de Google hors SBX.

Le contrôle suivant a passé 663 scénarios et 2 595 pas, dont les deux commandes Step natives et le contrôle d’architecture interdisant les lancements de conteneurs. Après ajout des scénarios de droits et d’identité des paramètres de l’hôte, le rejeu du compte a passé 44 scénarios et 44 pas. Le contrat commun du port exerce Claude, Codex et l’adaptateur mémoire, avec une construction achevée, une interruption et une limite de sortie. Le reçu refuse les agrégats incompatibles avec les terminaux et conserve une valeur inconnue pour un usage manquant.

## Vérification complémentaire

Mesures intermédiaires prises avant la reprise de l’admission et le changement de réseau.

Le dernier rejeu natif des trois scénarios a réussi en 54,878 secondes. Le faux amont a reçu le modèle et l’effort demandés par chacun des deux Steps. Le test direct a aussi vérifié le dernier message du client et son absence du journal de métadonnées. Le lecteur des petits fichiers privés du compte et des paramètres du Step partage désormais les contrôles de descripteur à l’ouverture et après la lecture. Les nouveaux témoins couvrent la fermeture des tubes, les interruptions, les durées, les erreurs de consentement et les incohérences entre le résultat du constructeur et son reçu.

| Périmètre de mutation                                                                   | Tués | Délais | Erreurs d’exécution | Survivants | Sans couverture |
| --------------------------------------------------------------------------------------- | ---: | -----: | ------------------: | ---------: | --------------: |
| Port Builder                                                                            |   38 |      0 |                   0 |          0 |               0 |
| Proxy Responses                                                                         |  236 |      1 |                   2 |          0 |               0 |
| Adaptateur et cycle de vie de la VM                                                     |  462 |     15 |                  17 |         26 |               1 |
| Compte et assemblage du Step SBX                                                        |  370 |      2 |                  14 |         42 |               3 |
| Fichier privé, admission, déclaration, orchestration et reçu du Step (lignes modifiées) |  252 |      2 |                   0 |         14 |               8 |

Chaque ligne provient de la dernière campagne achevée pour son périmètre. Les témoins ajoutés ensuite au cycle de vie et au Step attendent une nouvelle mesure. La dernière compilation a signalé un accès mal typé à l’environnement dans le scénario de routage. Le scénario utilise désormais l’environnement du processus de test. La relance de TypeScript et du rejeu s’est arrêtée avant leur démarrage sur `RUNTIME_HOME_SPACE_LOW`. Le profil de production exige plus de 17 179 869 184 octets libres sur le volume du compte. Les vérifications du dernier état, la mesure de mutation et l’essai avec consentement restent ouverts.

## Reprise et compte installé une fois

Le propriétaire a fourni le changement d’admission `f5dc5152`, repris localement en `269241d1`. Le rejeu de reprise a passé 770 scénarios et 2 740 pas. La première forme de B.4 exigeait un consentement à chaque démarrage. La commande séparée `sbx:sign-in` effectue désormais le consentement. Le Step lit la session dans le coffre du système. Avec le vrai trousseau macOS, des identifiants synthétiques et les fournisseurs de test, les trois scénarios natifs ont passé en 69,567 secondes. Pour Astra et Sol, l’installation et le Step ont utilisé des processus distincts ; un contrôle SRT a cherché la même entrée synthétique que l’hôte et n’a pas pu en obtenir la valeur. Les deux correctifs et reçus ont été produits. Le rejeu isolé du compte a passé 77 scénarios et 77 pas ; TypeScript a compilé.

## B.2 et B.3 — Réseau du constructeur

Le profil SRT autorise le proxy de l’hôte et le registre npm. Sur cette station, depuis l’UID 65534, une requête vers `host.docker.internal` a atteint le serveur lié à `127.0.0.1` par le proxy HTTP de la VM, `gateway.docker.internal`. La règle attachée à cette VM nommait `localhost:<port>`, la méthode POST et le chemin `/v1/responses`. Le serveur a compté une livraison sur le chemin admis. Un GET hors du chemin et un POST vers un deuxième serveur en écoute ont reçu 403. Le deuxième serveur a compté zéro livraison. Le processus invité ne disposait pas du socket d’administration en écriture. Après retrait de l’environnement du proxy, aucune de ces requêtes n’a abouti.

Le client Codex utilise désormais son transport HTTP natif. Le bootstrap fournit le jeton éphémère du Step par FIFO. Le processus hôte garde le jeton du compte. Trois scénarios natifs ont passé en 77,406 secondes, dont les Steps Astra et Sol avec écriture et relecture. Leur amont et leur identité étaient synthétiques.

Après la régénération du schéma des cinq profils et l’ajout du cas de rotation entre processus, le rejeu ciblé a passé 973 scénarios et 3 180 pas. Les deux consommateurs du même compte synthétique ont observé une seule rotation et la nouvelle session dans le trousseau. La compilation TypeScript, le format et la garde d’architecture ont passé (431 modules, 1 878 dépendances). Ces mesures incluent le réseau HTTP et le magasin du compte sur macOS.

Le rejeu natif a ensuite passé cinq scénarios en 87,001 secondes. Avec l’entrée du trousseau absente, le Step admis a rendu `SBX_SIGN_IN_REQUIRED`, sans demande de consentement, correctif ni `record.json`. Les deux Steps disposant d’une session installée ont écrit leur fichier. Les profils refusent aussi la lecture des dossiers du trousseau Linux ; l’accès natif au Secret Service reste à exercer sur un hôte Linux.

Le banc du compte a aussi exercé une panne des clés de signature entre la rotation et la vérification du nouveau jeton d’identité. Le processus suivant a repris la réponse de rotation dans le trousseau. Pour le même sujet, il a vérifié la signature avant d’interroger le catalogue, sans second échange de renouvellement. Un sujet différent a été refusé avant tout accès au catalogue. Le magasin conserve le jeton d’identité déjà vérifié pendant cette vérification.
