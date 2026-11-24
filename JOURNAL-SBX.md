# Constructeur SBX — 24 novembre 2026

## B.1 — Le port de construction

Step confie la consigne enrichie et le prompt admis à un Builder. L’adaptateur Claude conserve le lanceur SRT, les arguments, stdin, le délai, le code de sortie et les mesures du flux. La sortie de construction est bornée par la limite en octets du fichier admis. Une sortie trop longue refuse l’étape. Le contrat couvre les deux adaptateurs, la réussite, l’interruption et la limite à l’octet près. TypeScript a compilé. Le rejeu de `builder.feature` et `step-tool.feature` a réussi (69 scénarios, 729 pas).

## B.2 — Flux natif du fournisseur

Le proxy est un objet du processus hôte. Il authentifie une exécution, réserve une requête avant de demander le jeton du compte et fixe la destination HTTPS. Il relaie le corps natif et les octets SSE. Les déclarations d’outils locaux restent disponibles. Les en-têtes de traitement natif du client épinglé sont transmis. Sur faux amont, deux requêtes avec retour d’outil et une notification inconnue ressortent octet pour octet. Le rejeu du proxy a réussi (22 scénarios, 22 pas) et TypeScript a compilé. Les limites de requêtes et d’octets sont cumulées. La limite de jetons porte sur l’usage constaté ; SIWC ne propose pas de plafond avant génération. [Limites SIWC](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)
