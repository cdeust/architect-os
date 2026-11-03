// `npm run code -- <arguments de claude>` : lance Claude Code sous srt dans le worktree courant (brique 1a.0).
// Point d'entrée seulement : l'outil est `code-tool.ts`, décrit par `code.json`, son profil dans `profiles/`.
// Le lanceur, srt et les plugins doivent vivre hors du worktree visé (refus sinon) : depuis le worktree,
// `npm --prefix <checkout du lanceur> run code`.
import { failureReporter, processDependencies, runCodeTool } from './code-tool.js';

process.exitCode = await runCodeTool(processDependencies(process)).catch(failureReporter(process.stderr));
