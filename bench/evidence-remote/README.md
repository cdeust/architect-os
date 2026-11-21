# Essai : le guichet des preuves servi à Claude Science par un connecteur Remote

Hors production (`bench/`) : rien ne l'importe, la porte ne le compte ni ne le mute, il n'a pas de scénarios. C'est l'essai du 15 novembre 2026 tel qu'il a tourné (journal §39, `docs/design/evidence-desk.md`). La brique qui en fera un composant du dépôt reste à faire (étape S.4).

## Ce que c'est

`server.ts` sert le guichet (`tools/evidence`) en MCP sur HTTP, sur l'hôte et hors du bac à sable de Claude Science. Trois outils :

| Outil | Rôle |
|---|---|
| `desk_instructions` | le mode d'emploi : le skill du guichet, et ce que le connecteur y change |
| `next_question` | la question en attente, avec les raisons du dernier refus s'il y en a un ; sans question, l'appel attend jusqu'à `wait_seconds` qu'il en arrive une |
| `submit_answer` | dépose la réponse, lance `verify` aussitôt et rend le verdict : vérifiée, refusée avec ses raisons, ou différée |

Les textes intégraux des articles ne passent pas par les outils : le répondant les écrit dans `<guichet>/in`, qu'on lui accorde en lecture et écriture.

`wait-verdict.mjs` attend le prochain verdict par événement du système de fichiers (une fiche dans `verified/`, un refus dans `out/`), l'écrit en une ligne JSON et se termine : la fin d'une tâche de fond réveille une session Claude Code.

## Le lancer

```bash
# depuis la racine du dépôt ; le fichier du jeton est créé (0600) s'il n'existe pas
TSX_TSCONFIG_PATH=features/tsconfig.json ./aos -- node --import tsx bench/evidence-remote/server.ts <registre> <guichet> 8790 <fichier du jeton>
# un tunnel HTTPS vers 127.0.0.1:8790, par exemple ngrok, dont le jeton reste dans le trousseau de l'hôte
# dans Claude Science : Connectors > Add connector > Remote, adresse https://<tunnel>/mcp/<jeton>
# dans une session : « Appelle l'outil desk_instructions du connecteur et suis ses instructions. »
./aos -- node bench/evidence-remote/wait-verdict.mjs <registre> <guichet>
```

Le serveur n'écoute que sur `127.0.0.1` et refuse (401) tout appel sans le jeton, en en-tête `Authorization: Bearer` sur `/mcp` ou en dernier segment du chemin `/mcp/<jeton>`.

## Limites connues

- Le jeton est dans l'adresse du connecteur : la configuration de Claude Science le garde, et le tunnel le voit passer.
- Une question est rendue à chaque appel tant qu'elle n'a pas de réponse : deux pistes d'une même session peuvent la traiter deux fois.
- Les questions et les réponses transitent par le tiers qui tient le tunnel.
- Une session à l'écoute reçoit ses questions d'un programme. Elle est lancée par une personne et ne passe que par des fonctions documentées ; la question de l'usage sans surveillance a été posée à Anthropic le 14 novembre 2026.
