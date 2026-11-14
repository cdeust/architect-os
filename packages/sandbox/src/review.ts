// `npm run review -- <arguments de claude>` : lance Claude Code sous srt avec le profil `reviewer` (lecture seule) et le
// prompt du lanceur. Point d'entrée seulement : l'outil est `code-tool.ts`, décrit par `review.json`.
// Comme `npm run code`, depuis le worktree : `npm --prefix <checkout du lanceur> run review`.
import { failureReporter, reviewDependencies, runCodeTool } from './code-tool.js';

process.exitCode = await runCodeTool(reviewDependencies(process)).catch(failureReporter(process.stderr));
