// What the relay must not do, measured (journal §51). Run: node bench/docker-bridge/join.mjs
// A listener answers N bytes and ends. The client, through a relay on a Unix socket, reads nothing until the relay has
// taken the whole answer from the listener, then reads everything. Two ways to join the two connections of the relay
// are compared. The sizes are small on purpose: the relay must be able to take the whole answer while its client reads
// nothing, which holds only below the write buffer of node (64 KiB) plus what the kernel holds for a Unix socket. On a
// host whose kernel holds more than the answer (Linux: about 208 KiB), nothing waits in node and nothing is lost.
import { mkdtempSync, rmSync } from 'node:fs';
import { connect, createServer } from 'node:net';
import { platform, release, tmpdir } from 'node:os';
import { join } from 'node:path';

const listening = (server, where) => new Promise((ready) => server.listen(where, () => ready(server)));

/** Before the review of journal §51: whatever closes one side, the other is destroyed. */
function destroyOnClose(a, b) {
  for (const [one, other] of [[a, b], [b, a]]) {
    one.pipe(other);
    one.on('error', () => undefined);
    one.on('close', () => other.destroy());
  }
}

/** As packages/sandbox/src/container-relay.ts: each direction ends on its own, a failure destroys the other side. */
function endEachDirection(a, b) {
  for (const [one, other] of [[a, b], [b, a]]) {
    one.pipe(other);
    one.on('error', () => other.destroy());
  }
}

/** `taken` names the event of the upstream connection that says the relay took the whole answer. */
async function received(joinSockets, halfOpen, taken, bytes) {
  const folder = mkdtempSync(join(tmpdir(), 'aos-join-'));
  const listener = await listening(
    createServer((socket) => {
      socket.on('error', () => undefined);
      socket.once('data', () => socket.end(Buffer.alloc(bytes, 'x')));
    }),
    { port: 0, host: '127.0.0.1' },
  );
  let tookAll;
  const whole = new Promise((done) => (tookAll = done));
  const relay = await listening(
    createServer({ allowHalfOpen: halfOpen }, (client) => {
      const upstream = connect({ port: listener.address().port, host: '127.0.0.1', allowHalfOpen: halfOpen });
      upstream.once(taken, tookAll);
      joinSockets(client, upstream);
    }),
    join(folder, 's'),
  );
  const client = connect(join(folder, 's'));
  client.on('error', () => undefined);
  client.write('ping');
  await whole;
  let count = 0;
  client.on('data', (chunk) => (count += chunk.length));
  await new Promise((done) => client.on('close', done));
  listener.close();
  relay.close();
  rmSync(folder, { recursive: true, force: true });
  return count;
}

console.log(`${platform()} ${release()}, node ${process.version}`);
for (const bytes of [16384, 32768, 49152]) {
  const before = await received(destroyOnClose, false, 'close', bytes);
  const after = await received(endEachDirection, true, 'end', bytes);
  console.log(`${bytes} bytes answered: destroy on close, ${before} received; end each direction, ${after} received`);
}
