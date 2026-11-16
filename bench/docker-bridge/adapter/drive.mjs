// Runs on the Linux host, as the gateway would: the real adapter before a real daemon.
import { createServer } from 'node:http';
import { createServer as tcp } from 'node:net';
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { once } from 'node:events';
const [root, image, tmpRoot, rootfulHost, homeRoot] = process.argv.slice(2);
const { DockerProcessRunner } = await import(`${root}/packages/sandbox/dist/src/docker-process-runner.js`);
const base = { profilesDir: `${root}/packages/sandbox/profiles`, docker: 'docker', image, node: '/usr/local/bin/node',
  root, tmpRoot, memoryMiB: 256, pidsLimit: 64, checkTimeoutMs: 30000 };
const say = (label, text) => console.log(`${label} | ${text}`);
const attempt = async (label, f) => { const t = Date.now();
  try { const v = await f(); say(label, `ok, ${Date.now() - t} ms${v === undefined ? '' : ` ; ${v}`}`); }
  catch (e) { say(label, `refused, ${Date.now() - t} ms ; ${e.message}`); } };
const text = async (stream) => { let s = ''; for await (const c of stream) s += c; return s.trim(); };
const left = () => { const names = execFileSync('docker', ['ps', '-a', '--format', '{{.Names}}'], { encoding: 'utf8' }).split('\n').filter((n) => n.startsWith('aos-sandbox-'));
  let folders; try { folders = readdirSync(`${tmpRoot}/aos-sb`); } catch (e) { folders = [e.code]; }
  return `containers left ${names.length}, relay folders left ${JSON.stringify(folders)}`; };

const http = createServer((_, res) => res.end('pong from the host'));
await once(http.listen(0, '127.0.0.1'), 'listening');
const port = String(http.address().port);
const second = tcp((s) => s.end('second')); await once(second.listen(0, '127.0.0.1'), 'listening');

const platform = new DockerProcessRunner(base, process.env);
await attempt('1 check, rootless daemon', () => platform.check());
await attempt('2 check again (remembered)', () => platform.check());
say('3 after the check', left());
const run = async (args, runner = platform, stdinEnd = true) => {
  const sb = await runner.withVariables({ callbackPort: port }).start({ profile: 'module', cwd: root, command: ['node', `${root}/module-probe.mjs`, ...args] });
  if (stdinEnd) sb.stdin.end();
  const late = setTimeout(() => void sb.stop(), 20000);
  const [o, e, x] = await Promise.all([text(sb.stdout), text(sb.stderr), sb.exited]);
  clearTimeout(late);
  return `exit ${JSON.stringify(x)} ; stdout ${o || '(nothing)'}${e ? ` ; stderr ${JSON.stringify(e.slice(0, 300))}` : ''}`; };
await attempt('4 a module reads its callback port', () => run(['echo', root]));
await attempt('5 a module tries another port of the host loopback', () => run(['other', String(second.address().port)]));
await attempt('6 a module takes 400 MiB under a bound of 256', () => run(['hog']));
await attempt('7 a module starts 100 children under a bound of 64', () => run(['fork', '100']));
say('8 after four modules', left());
const times = [];
for (let i = 0; i < 5; i++) { const t = Date.now();
  const sb = await platform.withVariables({ callbackPort: port }).start({ profile: 'module', cwd: root, command: ['node', `${root}/module-probe.mjs`, 'sleep'] });
  await once(sb.stdout, 'data'); const up = Date.now() - t; const t2 = Date.now(); await sb.stop(); times.push(`${up}+${Date.now() - t2}`); }
say('9 start to first output + stop, five times (ms)', times.join(', '));
await attempt('10 a stop that follows a start at once', async () => {
  const sb = await platform.withVariables({ callbackPort: port }).start({ profile: 'module', cwd: root, command: ['node', `${root}/module-probe.mjs`, 'sleep'] });
  return JSON.stringify(await sb.stop()); });
say('11 after the stops', left());
const refusal = (label, options, env = process.env) => attempt(label, () => new DockerProcessRunner({ ...base, ...options }, env).check());
await refusal('12 a daemon with root', {}, { ...process.env, DOCKER_HOST: rootfulHost });
await refusal('13 an image that is not there', { image: `node@sha256:${'0'.repeat(64)}` });
await refusal('14 no node at that path in the image', { node: '/usr/local/bin/nodex' });
await refusal('15a a root under a home that others cannot enter (750), the root itself 755', { root: homeRoot, profilesDir: `${homeRoot}/packages/sandbox/profiles` });
await refusal('15b a root that others cannot enter (700)', { root: `${homeRoot}-700`, profilesDir: `${homeRoot}/packages/sandbox/profiles` });
await refusal('16a a bound of the check of 5 ms', { checkTimeoutMs: 5 });
await refusal('16b a bound of the check of 60 ms', { checkTimeoutMs: 60 });
await refusal('17 no daemon at that address', {}, { ...process.env, DOCKER_HOST: 'unix:///nonexistent/docker.sock' });
await refusal('18 no docker client in PATH', {}, { ...process.env, PATH: '/nonexistent' });
say('19 after the refusals', left());
http.close(); second.close();
