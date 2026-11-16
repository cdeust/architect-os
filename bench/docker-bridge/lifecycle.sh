#!/bin/sh
# Trial, outside production: what the options and the stop of the Docker adapter of a platform process rely on, under a
# rootless daemon (docs/design/platform-v3-srt.md, §6; journal §51). Run it on a Linux host, as the user whose rootless
# daemon is running:
#   DOCKER_HOST=unix://$XDG_RUNTIME_DIR/docker.sock sh bench/docker-bridge/lifecycle.sh
set -u
IMAGE="${IMAGE:-node:22-alpine}"
H="--network none --read-only --cap-drop ALL --security-opt no-new-privileges --security-opt apparmor=unconfined --user 10001:10001 --tmpfs /tmp:rw,noexec,nosuid,size=16m"
docker info --format 'server {{.ServerVersion}} security {{json .SecurityOptions}} cgroup {{.CgroupDriver}} v{{.CgroupVersion}} init {{.InitBinary}} log {{.LoggingDriver}}'
docker pull -q $IMAGE >/dev/null 2>&1 || echo "pull failed"
ORPHANS="const {spawnSync}=require('child_process'),fs=require('fs');for(let i=0;i<5;i++)spawnSync('sh',['-c','sleep 0.3 & exit 0'],{stdio:'ignore'});setTimeout(()=>{let z=0;for(const p of fs.readdirSync('/proc')){if(!/^[0-9]+\$/.test(p))continue;try{if(fs.readFileSync('/proc/'+p+'/stat','utf8').split(') ')[1][0]==='Z')z++}catch{}}console.log('first process',fs.readFileSync('/proc/1/comm','utf8').trim()+',','zombies',z)},1500)"
echo "--- five orphans of the program, without --init"
docker run --rm -i $H $IMAGE node -e "$ORPHANS" < /dev/null 2>&1 | tail -1
echo "--- five orphans of the program, with --init"
docker run --rm -i --init $H $IMAGE node -e "$ORPHANS" < /dev/null 2>&1 | tail -1
echo "--- the default log driver: what the daemon keeps of the stdout of a container"
docker run --name aos-log-default -i --init $H $IMAGE node -e "console.log('x'.repeat(4096))" < /dev/null > /tmp/l1.out 2>&1; echo "  exit code $? ; stdout of the client: $(wc -c < /tmp/l1.out) bytes"
P=$(docker inspect -f '{{.LogPath}}' aos-log-default); echo "  driver $(docker inspect -f '{{.HostConfig.LogConfig.Type}}' aos-log-default) ; file kept by the daemon: $(wc -c < "$P" 2>/dev/null || echo none) bytes"
docker rm -f aos-log-default >/dev/null
echo "--- --log-driver none"
docker run --name aos-log-none -i --init --log-driver none $H $IMAGE node -e "console.log('x'.repeat(4096))" < /dev/null > /tmp/l2.out 2>&1; echo "  exit code $? ; stdout of the client: $(wc -c < /tmp/l2.out) bytes"
P=$(docker inspect -f '{{.LogPath}}' aos-log-none); echo "  driver $(docker inspect -f '{{.HostConfig.LogConfig.Type}}' aos-log-none) ; file kept by the daemon: '${P}' ; docker logs: $(docker logs aos-log-none 2>&1 | head -1 | cut -c1-110)"
docker rm -f aos-log-none >/dev/null
echo "--- bounds in bytes, swap equal to memory: 67108864, a program that takes 300 MB"
docker run --rm -i --init --log-driver none $H --memory 67108864 --memory-swap 67108864 --pids-limit 64 $IMAGE node -e "const a=[];for(let i=0;i<300;i++)a.push(Buffer.alloc(1048576,1));console.log('ALLOCATED 300 MB')" < /dev/null > /tmp/m.out 2>&1; echo "  exit code $? ; output: $(tail -1 /tmp/m.out | cut -c1-120)"
echo "--- the client killed by SIGKILL, a program that does not read its stdin"
(sleep 30 | docker run --rm -i --init --log-driver none --name aos-kill $H $IMAGE node -e "setInterval(()=>{},1000)" > /dev/null 2>&1) &
for i in 1 2 3 4 5 6 7 8 9 10; do [ -n "$(docker ps -q --filter name=aos-kill)" ] && break; sleep 0.5; done
pkill -9 -f "docker run .*--name aos-kill"; sleep 2
echo "  after the death of the client: $(docker ps -a --filter name=aos-kill --format '{{.Names}} {{.Status}}' | cut -c1-60)"
docker rm -f aos-kill > /tmp/r.out 2>&1; echo "  docker rm -f: exit code $? ; then: '$(docker ps -a -q --filter name=aos-kill)'"
echo "--- the client killed by SIGKILL, a program that ends when its stdin ends"
(sleep 30 | docker run --rm -i --init --log-driver none --name aos-stdin $H $IMAGE node -e "process.stdin.resume();process.stdin.on('end',()=>process.exit(0))" > /dev/null 2>&1) &
for i in 1 2 3 4 5 6 7 8 9 10; do [ -n "$(docker ps -q --filter name=aos-stdin)" ] && break; sleep 0.5; done
pkill -9 -f "docker run .*--name aos-stdin"; sleep 3
echo "  after the death of the client: '$(docker ps -a --filter name=aos-stdin --format '{{.Names}} {{.Status}}' | cut -c1-60)'"
docker rm -f aos-stdin >/dev/null 2>&1
echo "--- docker rm -f of a container that does not exist"
docker rm -f aos-none > /tmp/n.out 2>&1; echo "  exit code $? ; $(head -1 /tmp/n.out | cut -c1-120)"
pkill -f "sleep 30" 2>/dev/null
echo "--- what --mount cannot carry"
M=$(mktemp -d /tmp/aos-mount.XXXXXX); chmod 755 "$M"; mkdir "$M/plain" "$M/with space" "$M/a=b" "$M/a\"b" "$M/a,b"
for name in plain "with space" "a=b" 'a"b' "a,b"; do
  docker run --rm -i --init --log-driver none $H --mount "type=bind,source=$M/$name,target=$M/$name,readonly" $IMAGE node -e "console.log('mounted')" < /dev/null > /tmp/mt.out 2>&1
  echo "  a folder named '$name': exit code $? ; $(head -1 /tmp/mt.out | cut -c1-150)"
done
docker run --rm -i --init --log-driver none $H --mount "type=bind,source=/,target=/,readonly" $IMAGE node -e "console.log('mounted')" < /dev/null > /tmp/mt.out 2>&1
echo "  the root of the host on the root of the container: exit code $? ; $(head -1 /tmp/mt.out | cut -c1-150)"
rm -rf "$M"
