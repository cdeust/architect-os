import { serveHttp } from './main.js';

// The process of the HTTP API of data (compose, until brick 1b.6). A store that cannot open rejects: Node prints the
// error and exits with 1.
await serveHttp(process.env, console.warn);
