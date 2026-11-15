#!/bin/sh
# Trial, outside production: can a container with no network at all reach exactly one listener of its host through a
# Unix socket mounted read-only, and nothing else? Run it on a Linux host with Docker and python3:
#   sh bench/docker-bridge/trial.sh
# It starts a listener on a Unix socket (standing for the bridge to one loopback port of the host), then one container
# with the hardened options of the Docker adapter (packages/sandbox/src/docker-runner.ts) and `--network none`, in which
# 127.0.0.1:4100 forwards to the mounted socket. It prints what the container reached and what it was refused.
set -u
IMAGE="${IMAGE:-node:22-alpine}"
D=$(mktemp -d /tmp/aos-bridge.XXXXXX); chmod 755 "$D"
uname -srm; docker version --format 'docker {{.Server.Version}}'
python3 - "$D/s.sock" <<'PY' &
import socket,sys,os
p=sys.argv[1]
s=socket.socket(socket.AF_UNIX); s.bind(p); os.chmod(p,0o666); s.listen(8)
for _ in range(6):
    c,_a=s.accept(); c.recv(4096); c.sendall(b"HTTP/1.1 200 OK\r\nContent-Length: 4\r\nConnection: close\r\n\r\npong"); c.close()
PY
HOSTPID=$!
for i in 1 2 3 4 5 6 7 8 9 10; do [ -S "$D/s.sock" ] && break; sleep 0.2; done
docker pull -q "$IMAGE" >/dev/null 2>&1 || echo "pull failed"
cat > "$D/probe.js" <<'JS'
const net = require('net'), http = require('http');
// In the container: 127.0.0.1:4100 forwards to the mounted socket.
const fwd = net.createServer((c) => { const u = net.connect('/bridge/s.sock'); c.pipe(u).pipe(c); u.on('error', () => c.destroy()); c.on('error', () => u.destroy()); });
const tryTcp = (host, port) => new Promise((r) => { const s = net.connect({ host, port, timeout: 1500 }); s.on('connect', () => { s.destroy(); r('CONNECTED'); }); s.on('timeout', () => { s.destroy(); r('TIMEOUT'); }); s.on('error', (e) => r(e.code)); });
fwd.listen(4100, '127.0.0.1', async () => {
  const body = await new Promise((r) => http.get('http://127.0.0.1:4100/mcp', (res) => { let b = ''; res.on('data', (d) => (b += d)); res.on('end', () => r(res.statusCode + ' ' + b)); }).on('error', (e) => r('ERR ' + e.code)));
  console.log('through the bridge:', body);
  console.log('uid:', process.getuid(), 'interfaces:', Object.keys(require('os').networkInterfaces()).join(','));
  console.log('internet 1.1.1.1:80:', await tryTcp('1.1.1.1', 80));
  console.log('host gateway 172.17.0.1:22:', await tryTcp('172.17.0.1', 22));
  try { require('fs').writeFileSync('/bridge/x', '1'); console.log('write in the mount: WRITTEN'); } catch (e) { console.log('write in the mount:', e.code); }
  try { require('fs').writeFileSync('/etc/x', '1'); console.log('write in the image: WRITTEN'); } catch (e) { console.log('write in the image:', e.code); }
  fwd.close();
});
JS
echo "--- read-only mount, no network, non-root, read-only filesystem"
docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges --user 10001:10001 \
  --tmpfs /tmp:rw,noexec,nosuid,size=16m -v "$D:/bridge:ro" "$IMAGE" node /bridge/probe.js 2>&1 | head -12
kill $HOSTPID 2>/dev/null; rm -rf "$D"
