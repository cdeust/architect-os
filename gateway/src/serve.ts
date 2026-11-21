import '@architect-os/sandbox/require-run';
const { nativeHost, serveNative } = await import('./main.js');

process.exitCode = await serveNative(await nativeHost(process, import.meta.url));
