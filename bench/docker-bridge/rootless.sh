#!/bin/sh
# Trial, outside production: what holds under a rootless Docker daemon, for the Docker mode of the platform
# (docs/design/platform-v3-srt.md, §6). Run it on a Linux host, as the user whose rootless daemon is running:
#   DOCKER_HOST=unix://$XDG_RUNTIME_DIR/docker.sock sh bench/docker-bridge/rootless.sh
# It prints what the daemon says of itself, then: the relay through a Unix socket with the hardened options, the read
# of a mounted file of the host user, the memory and process bounds with and without a bound, the uid the container
# has on the host, and what happens without `apparmor=unconfined`.
set -u
IMAGE="${IMAGE:-node:22-alpine}"
U="--security-opt apparmor=unconfined --network none"
docker info --format 'server {{.ServerVersion}} security {{json .SecurityOptions}} cgroup {{.CgroupDriver}} v{{.CgroupVersion}}'
docker pull -q $IMAGE >/dev/null 2>&1 || echo "pull failed"
D=$(mktemp -d /tmp/aos-bridge.XXXXXX); chmod 755 "$D"; echo "platform file" > "$D/platform.txt"; chmod 644 "$D/platform.txt"
python3 - "$D/s.sock" <<'PY' &
import socket,sys,os
p=sys.argv[1]
s=socket.socket(socket.AF_UNIX); s.bind(p); os.chmod(p,0o666); s.listen(8)
for _ in range(4):
    c,_a=s.accept(); c.recv(4096); c.sendall(b"HTTP/1.1 200 OK\r\nContent-Length: 4\r\nConnection: close\r\n\r\npong"); c.close()
PY
HOSTPID=$!
for i in 1 2 3 4 5 6 7 8 9 10; do [ -S "$D/s.sock" ] && break; sleep 0.2; done
cat > "$D/probe.js" <<'JS'
const net = require('net'), http = require('http'), fs = require('fs');
const fwd = net.createServer((c) => { const u = net.connect('/bridge/s.sock'); c.pipe(u).pipe(c); u.on('error', () => c.destroy()); c.on('error', () => u.destroy()); });
const tryTcp = (host, port) => new Promise((r) => { const s = net.connect({ host, port, timeout: 1500 }); s.on('connect', () => { s.destroy(); r('CONNECTED'); }); s.on('timeout', () => { s.destroy(); r('TIMEOUT'); }); s.on('error', (e) => r(e.code)); });
fwd.listen(4100, '127.0.0.1', async () => {
  const body = await new Promise((r) => http.get('http://127.0.0.1:4100/mcp', (res) => { let b = ''; res.on('data', (d) => (b += d)); res.on('end', () => r(res.statusCode + ' ' + b)); }).on('error', (e) => r('ERR ' + e.code)));
  console.log('through the bridge:', body);
  console.log('uid in the container:', process.getuid(), 'interfaces:', Object.keys(require('os').networkInterfaces()).join(','));
  console.log('read a file of the host user in the mount:', fs.readFileSync('/bridge/platform.txt', 'utf8').trim(), '(owner seen as uid', fs.statSync('/bridge/platform.txt').uid + ')');
  console.log('internet 1.1.1.1:80:', await tryTcp('1.1.1.1', 80));
  try { fs.writeFileSync('/bridge/x', '1'); console.log('write in the mount: WRITTEN'); } catch (e) { console.log('write in the mount:', e.code); }
  try { fs.writeFileSync('/tmp/x', '1'); console.log('write in the tmpfs: written'); } catch (e) { console.log('write in the tmpfs:', e.code); }
  fwd.close();
});
JS
echo "--- rootless daemon: no network, read-only, non-root in the container"
docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges --security-opt apparmor=unconfined --user 10001:10001 --tmpfs /tmp:rw,noexec,nosuid,size=16m -v "$D:/bridge:ro" $IMAGE node /bridge/probe.js 2>&1 | head -10
echo "--- on the host, who owns the container process"
C=$(docker run -d --security-opt apparmor=unconfined --network none --user 10001:10001 $IMAGE sleep 30); sleep 1; ps -o user=,uid=,comm= -p $(docker inspect -f '{{.State.Pid}}' $C) 2>&1; docker rm -f $C >/dev/null
kill $HOSTPID 2>/dev/null; rm -rf "$D"
echo "--- memory: 64m, a program that takes 300 MB"
docker run --rm $U --memory 64m --memory-swap 64m $IMAGE node -e "const a=[];for(let i=0;i<300;i++)a.push(Buffer.alloc(1048576,1));console.log('ALLOCATED 300 MB')" > /tmp/m.out 2>&1; echo "  exit code $? ; output: $(tail -1 /tmp/m.out | cut -c1-80)"
echo "--- memory: no bound, the same program"
docker run --rm $U $IMAGE node -e "const a=[];for(let i=0;i<300;i++)a.push(Buffer.alloc(1048576,1));console.log('ALLOCATED 300 MB')" > /tmp/m2.out 2>&1; echo "  exit code $? ; output: $(tail -1 /tmp/m2.out | cut -c1-80)"
echo "--- processes: a bound of 16, a program that starts 40 children"
docker run --rm $U --pids-limit 16 $IMAGE node -e "const {spawn}=require('child_process');let ok=0,ko=0;for(let i=0;i<40;i++){try{const c=spawn('sleep',['3']);c.on('error',()=>{});if(c.pid)ok++;else ko++}catch(e){ko++}}console.log('started',ok,'refused',ko)" > /tmp/p.out 2>&1; echo "  exit code $? ; output: $(tail -1 /tmp/p.out | cut -c1-80)"
echo "--- processes: no bound, the same program"
docker run --rm $U $IMAGE node -e "const {spawn}=require('child_process');let ok=0,ko=0;for(let i=0;i<40;i++){try{const c=spawn('sleep',['3']);c.on('error',()=>{});if(c.pid)ok++;else ko++}catch(e){ko++}}console.log('started',ok,'refused',ko)" > /tmp/p2.out 2>&1; echo "  exit code $? ; output: $(tail -1 /tmp/p2.out | cut -c1-80)"
echo "--- without apparmor=unconfined"
docker run --rm --network none $IMAGE true > /tmp/a.out 2>&1; echo "  exit code $? ; $(head -1 /tmp/a.out | cut -c1-170)"
