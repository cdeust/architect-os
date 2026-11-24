# Constructeur SBX — 24 novembre 2026

## B.1 — Le port de construction

Step confie la consigne enrichie et le prompt admis à un Builder. L’adaptateur Claude conserve le lanceur SRT, les arguments, stdin, le délai, le code de sortie et les mesures du flux. La sortie de construction est bornée par la limite en octets du fichier admis. Une sortie trop longue refuse l’étape. Le contrat couvre les deux adaptateurs, la réussite, l’interruption et la limite à l’octet près. TypeScript a compilé. Le rejeu de `builder.feature` et `step-tool.feature` a réussi (69 scénarios, 729 pas).

## B.2 — Flux natif du fournisseur

Le proxy est un objet du processus hôte. Il authentifie une exécution, réserve une requête avant de demander le jeton du compte et fixe la destination HTTPS. Il relaie le corps natif et les octets SSE. Les déclarations d’outils locaux restent disponibles. Les en-têtes de traitement natif du client épinglé sont transmis. Sur faux amont, deux requêtes avec retour d’outil et une notification inconnue ressortent octet pour octet. Le rejeu du proxy a réussi (22 scénarios, 22 pas) et TypeScript a compilé. Les limites de requêtes et d’octets sont cumulées. La limite de jetons porte sur l’usage constaté ; SIWC ne propose pas de plafond avant génération. [Limites SIWC](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)

## B.3 — Le vrai client dans la VM

Le test natif a démarré Codex 0.170.0 sous UID 65534. Le faux amont a envoyé un appel à l’outil du client, puis a reçu son résultat. L’hôte a retrouvé le fichier écrit, les deux témoins protégés intacts, deux terminaux (8 jetons en entrée et 4 en sortie) et la VM retirée. La première exécution avait un `/tmp` en lecture seule pour le bac interne du client ; un tmpfs privé de la VM permet son démarrage. Le test natif a pris 32 secondes. Le rejeu de l’admission SBX et de la garde d’architecture a réussi (40 scénarios, 106 pas) avant l’ajout du cas du lien physique. La compilation TypeScript a réussi. L’essai employait l’adaptateur de production avec un faux amont et un dossier jetable.

Le rejeu suivant, avec le lien physique et la VM native, a passé 14 scénarios et 14 pas en 16 secondes.

## B.4 — Compte, admission et résultat du Step

Le processus Step conserve les jetons en mémoire pendant la construction. Il redemande un consentement quand un nouveau processus démarre. Le dossier privé de l’hôte conserve l’identifiant de l’installation et l’association du client au sujet vérifié. Le test du compte exerce un callback PKCE sur la boucle locale, la signature, le catalogue et la rotation. L’admission compare le fournisseur du constructeur aux pièces de provenance du prompt et refuse une relecture de justesse du même fournisseur. Le coût monétaire de l’abonnement reste inconnu.

Les deux Steps ont utilisé le vrai binaire Codex 0.170.0, à travers l’entrée de production. Les services d’identité et de modèle ont fourni les données de test en mémoire. Dans chaque worktree, le processus natif a écrit `result.txt`. Le contrôle SRT a constaté son existence, une session de revue Claude rejouée a rendu `accept`, puis l’hôte a publié `record.json` avec le modèle choisi et deux terminaux totalisant 10 jetons en entrée et 6 en sortie. Le certificat d’acceptation hors ligne provient de ces fichiers, distincts des instructions du faux amont. La preuve par un correctif décidé par le modèle reste ouverte.

Avant le renforcement du contrat d’interruption et du lecteur de terminaux, le rejeu ciblé du Step, de l’admission, des comptes, de la VM et du diagramme a passé 572 scénarios et 2 434 pas. La première mutation du port et du proxy a trouvé 103 survivants et 31 sans couverture. Après passage au lecteur SSE standard et ajout des contrôles adverses, la deuxième mesure a tué tous les 38 mutants du port. Le proxy comptait alors 237 tués, un délai, 20 survivants, un sans couverture et deux erreurs d’exécution.

La sonde historique Antigravity reste dans le banc. La relecture Gemini utilise l’agent de Google hors SBX.

Le contrôle suivant a passé 663 scénarios et 2 595 pas, dont les deux commandes Step natives et le contrôle d’architecture interdisant les lancements de conteneurs. Après ajout des scénarios de droits et d’identité des paramètres de l’hôte, le rejeu du compte a passé 44 scénarios et 44 pas. Le contrat commun du port exerce Claude, Codex et l’adaptateur mémoire, avec une construction achevée, une interruption et une limite de sortie. Le reçu refuse les agrégats incompatibles avec les terminaux et conserve une valeur inconnue pour un usage manquant.

## Vérification complémentaire

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
