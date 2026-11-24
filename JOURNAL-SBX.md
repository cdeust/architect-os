# Constructeur SBX — 24 novembre 2026

## B.1 — Le port de construction

Step confie la consigne enrichie et le prompt admis à un Builder. L’adaptateur Claude conserve le lanceur SRT, les arguments, stdin, le délai, le code de sortie et les mesures du flux. La sortie de construction est bornée par la limite en octets du fichier admis. Une sortie trop longue refuse l’étape. Le contrat couvre les deux adaptateurs, la réussite, l’interruption et la limite à l’octet près. TypeScript a compilé. Le rejeu de `builder.feature` et `step-tool.feature` a réussi (69 scénarios, 729 pas).
