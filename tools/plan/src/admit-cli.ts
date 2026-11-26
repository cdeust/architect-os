// `npm run admit` : l'émetteur du reçu d'admission de Step, entrée distincte de `npm run step` (journal, §123).
import '@architect-os/sandbox/require-run';
const { runAdmit } = await import('./main.js');
process.exitCode = runAdmit(process);
