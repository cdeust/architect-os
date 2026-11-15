import { nativeHost, serveNative } from './main.js';

process.exitCode = await serveNative(await nativeHost(process, import.meta.url));
