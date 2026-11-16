// Runs in a container started by the adapter, as a module would. One mode per question.
import { connect } from 'node:net';
import { writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
const [mode, arg] = process.argv.slice(2);
const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
const tryTo = (f) => { try { return f(); } catch (e) { return e.code ?? String(e); } };
if (mode === 'echo') {
  let answer;
  try { const r = await fetch(process.env.GATEWAY_CALLBACK_URL); answer = `${r.status} ${await r.text()}`; }
  catch (e) { answer = `${e.cause?.code ?? e.message}`; }
  out({ answer, uid: process.getuid(), cwd: process.cwd(), env: Object.keys(process.env).sort(),
        writeRoot: tryTo(() => (writeFileSync(`${arg}/x-probe`, ''), 'written')),
        writeWork: tryTo(() => (writeFileSync('/work/x', ''), 'written')) });
} else if (mode === 'other') {
  const code = await new Promise((done) => { const s = connect({ host: '127.0.0.1', port: Number(arg) });
    s.once('connect', () => { s.destroy(); done('connected'); }); s.once('error', (e) => done(e.code)); });
  out({ other: code });
} else if (mode === 'sleep') {
  out({ ready: true }); process.stdin.resume(); setInterval(() => undefined, 1000);
} else if (mode === 'hog') {
  const kept = []; for (let i = 0; i < 400; i++) { kept.push(Buffer.alloc(1048576, 1)); }
  out({ allocatedMiB: kept.length });
} else if (mode === 'fork') {
  // Children that are no node: a node that cannot start its threads under the bound hangs, and that is not the question.
  let started = 0, refused = 0; const n = Number(arg);
  await Promise.all(Array.from({ length: n }, () => new Promise((done) => {
    const c = spawn('/bin/sleep', ['2']);
    c.once('spawn', () => { started++; }); c.once('error', () => { refused++; done(); }); c.once('close', done); })));
  out({ started, refused });
}
