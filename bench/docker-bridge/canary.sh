#!/bin/sh
# Trial, outside production: what a container can read of its own confinement, for the check at start of the Docker
# mode (docs/design/platform-v3-srt.md, §6, "Canari"). Run it on a Linux host, as the user whose rootless daemon runs:
#   DOCKER_HOST=unix://$XDG_RUNTIME_DIR/docker.sock sh bench/docker-bridge/canary.sh
set -u
IMAGE="${IMAGE:-node:22-alpine}"
H="--rm -i --init --log-driver none --network none --read-only --cap-drop ALL --security-opt no-new-privileges --security-opt apparmor=unconfined --user 10001:10001 --tmpfs /tmp:rw,noexec,nosuid,size=16m,uid=10001,gid=10001,mode=0700"
PROBE="const fs=require('fs'),net=require('net'),os=require('os');const rd=(f)=>{try{return fs.readFileSync(f,'utf8').trim()}catch(e){return e.code}};const wr=(f)=>{try{fs.writeFileSync(f,'x');return 'written'}catch(e){return e.code}};const s=net.connect({host:'192.0.2.1',port:80});const t=setTimeout(()=>{s.destroy();done('TIMEOUT')},3000);s.on('connect',()=>done('CONNECTED'));s.on('error',(e)=>done(e.code));function done(c){clearTimeout(t);s.destroy();console.log(JSON.stringify({uid:process.getuid(),interfaces:Object.keys(os.networkInterfaces()),outside:c,writeRoot:wr('/x'),writeTmp:wr('/tmp/x'),memoryMax:rd('/sys/fs/cgroup/memory.max'),swapMax:rd('/sys/fs/cgroup/memory.swap.max'),pidsMax:rd('/sys/fs/cgroup/pids.max')}))}"
docker info --format 'server {{.ServerVersion}} security {{json .SecurityOptions}} cgroup {{.CgroupDriver}} v{{.CgroupVersion}}'
echo "--- docker info, the field the check reads"
docker info --format '{{json .SecurityOptions}}'
echo "--- with the bounds of the adapter (memory 268435456, swap equal, 64 processes)"
docker run $H --memory 268435456 --memory-swap 268435456 --pids-limit 64 $IMAGE node -e "$PROBE" < /dev/null 2>&1 | tail -1
echo "--- without bounds"
docker run $H $IMAGE node -e "$PROBE" < /dev/null 2>&1 | tail -1
echo "--- with a network (the default of docker run), same probe"
docker run --rm -i --init --log-driver none --read-only --cap-drop ALL --security-opt no-new-privileges --security-opt apparmor=unconfined --user 10001:10001 --tmpfs /tmp:rw,noexec,nosuid,size=16m,uid=10001,gid=10001,mode=0700 $IMAGE node -e "$PROBE" < /dev/null 2>&1 | tail -1
echo "--- without --read-only"
docker run --rm -i --init --log-driver none --network none --cap-drop ALL --security-opt no-new-privileges --security-opt apparmor=unconfined --user 10001:10001 $IMAGE node -e "$PROBE" < /dev/null 2>&1 | tail -1
echo "--- as root in the container (no --user)"
docker run --rm -i --init --log-driver none --network none --read-only --cap-drop ALL --security-opt no-new-privileges --security-opt apparmor=unconfined --tmpfs /tmp:rw,noexec,nosuid,size=16m $IMAGE node -e "$PROBE" < /dev/null 2>&1 | tail -1
echo "--- how the kernel writes a memory bound back: what memory.max reads for each --memory"
for m in 268435457 268439551 268439552 6291456 6291455 5242880 1; do
  docker run $H --memory $m --memory-swap $m --pids-limit 64 $IMAGE cat /sys/fs/cgroup/memory.max < /dev/null > /tmp/mm.out 2>&1
  echo "  --memory $m: exit code $? ; $(head -1 /tmp/mm.out | cut -c1-130)"
done
echo "  page size of the host: $(getconf PAGESIZE)"
