// `npm run step -- <dossier>` : une étape de la boucle d'orchestration (brief, construction, revue sous srt).
// Point d'entrée seulement : l'étape est `step-tool.ts`. Comme `npm run code`, depuis le worktree :
// `npm --prefix <checkout du lanceur> run step -- <dossier>`.
import '@architect-os/sandbox/require-run';
const { runStep, stepDependencies } = await import('./step-tool.js');

process.exitCode = await runStep(stepDependencies(process));
