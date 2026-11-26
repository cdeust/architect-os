#!/bin/sh
# GitHub's Ubuntu 24.04 image configures several vendors. Only the Ubuntu archive
# supplies the sandbox tools; PostgreSQL 17 and pgvector come from noble-pgdg.
set -eu

case ${1:-} in
  gate) set -- postgresql-17 postgresql-17-pgvector ;;
  bench) set -- postgresql-17 ;;
  *) echo 'expected gate or bench' >&2; exit 2 ;;
esac

dir=$(mktemp -d)
trap 'rm -rf "$dir"' EXIT
cp /etc/apt/sources.list.d/ubuntu.sources "$dir/ubuntu.sources"
test -s "$dir/ubuntu.sources"
apt() {
  sudo apt-get -o Dir::Etc::sourcelist=/dev/null -o "Dir::Etc::sourceparts=$dir" "$@"
}

apt update --error-on=any
apt install -y --no-install-recommends bubblewrap socat ripgrep postgresql-common

# Ubuntu's postgresql-common ships this public key. Keep the Ubuntu stanzas
# for server dependencies and add exactly the PGDG archive under that key.
cat > "$dir/pgdg.sources" <<'PGDG'
Types: deb
URIs: https://apt.postgresql.org/pub/repos/apt
Suites: noble-pgdg
Components: main
Signed-By: /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
PGDG
apt update --error-on=any
apt install -y --no-install-recommends "$@"
