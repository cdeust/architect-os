#!/bin/sh
# Trial, outside production: the real Docker adapter of the platform (packages/sandbox/src/docker-process-runner.ts),
# its check at start and a few starts, before a real rootless daemon. Run it on the Linux host, as the user of the
# rootless daemon, with the bundle of bundle.sh at /tmp/aos-bundle.tgz:
#   sh bench/docker-bridge/adapter/host.sh        (in the VM: colima ssh --profile <profile> -- sh -s < .../host.sh)
# It starts the rootless daemon without a bridge, as the design asks of the operator, and stops it at the end.
set -u
export XDG_RUNTIME_DIR=/run/user/$(id -u)
# The user unit a former setup left fails on its bridge: this trial starts the daemon itself.
systemctl --user disable --now docker >/dev/null 2>&1
ROOTFUL=unix:///var/run/docker.sock
export DOCKER_HOST=unix://$XDG_RUNTIME_DIR/docker.sock
pkill -u "$(id -u)" -f dockerd-rootless.sh >/dev/null 2>&1; sleep 1
nohup dockerd-rootless.sh --iptables=false --ip6tables=false --bridge=none > /tmp/dockerd-rootless.log 2>&1 &
trap 'pkill -u "$(id -u)" -f dockerd-rootless.sh; pkill -u "$(id -u)" rootlesskit; sleep 2' EXIT
for i in $(seq 1 40); do docker info >/dev/null 2>&1 && break; sleep 1; done
echo "host | $(. /etc/os-release; echo "$PRETTY_NAME") ; kernel $(uname -r) $(uname -m)"
docker info --format 'daemon | server {{.ServerVersion}} ; security {{json .SecurityOptions}} ; cgroup {{.CgroupDriver}} v{{.CgroupVersion}}' 2>&1 | cut -c1-240
DOCKER_HOST=$ROOTFUL docker info --format 'daemon with root | server {{.ServerVersion}} ; security {{json .SecurityOptions}}' 2>&1 | cut -c1-200
# The image is fetched here, by the operator of the trial: the adapter never downloads.
TAG="${TAG:-node:26-bookworm-slim}"
docker pull -q "$TAG" >/dev/null 2>/tmp/pull.err || { echo "image | $TAG: $(head -1 /tmp/pull.err | cut -c1-160)"; exit 1; }
IMAGE=$(docker image inspect --format '{{index .RepoDigests 0}}' "$TAG")
echo "image | $TAG is $IMAGE"
rm -rf /tmp/aos-root "$HOME/aos-root-home" "$HOME/aos-root-home-700"
mkdir -p /tmp/aos-root && tar -xzf /tmp/aos-bundle.tgz -C /tmp/aos-root 2>/dev/null && chmod -R go+rX /tmp/aos-root
cp -R /tmp/aos-root "$HOME/aos-root-home"; cp -R /tmp/aos-root "$HOME/aos-root-home-700"; chmod 700 "$HOME/aos-root-home-700"
echo "roots | /tmp/aos-root $(stat -c %a /tmp/aos-root) ; $HOME/aos-root-home $(stat -c %a "$HOME/aos-root-home") under a home $(stat -c %a "$HOME") ; $HOME/aos-root-home-700 $(stat -c %a "$HOME/aos-root-home-700")"
# The node of the host is the node of the image, copied out of it: the host of the trial has none.
C=$(docker create "$IMAGE") && docker cp -q "$C:/usr/local/bin/node" /tmp/aos-node && docker rm "$C" >/dev/null
echo "node of the host | $(/tmp/aos-node --version), copied out of the image"
cd /tmp && /tmp/aos-node /tmp/aos-root/drive.mjs /tmp/aos-root "$IMAGE" /tmp "$ROOTFUL" "$HOME/aos-root-home" 2>&1
echo "driver exit $?"
