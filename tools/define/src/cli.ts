import '@architect-os/sandbox/require-run';
const { runDefine } = await import('./main.js');

process.exitCode = await runDefine(process);
