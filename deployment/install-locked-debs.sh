#!/bin/sh
# Install only the exact Ubuntu artifacts reviewed for this image's architecture.
set -eu
export DEBIAN_FRONTEND=noninteractive
lock=$1
set --
expected=0
while read -r digest filename package version extra; do
  [ -z "$extra" ] && [ ${#digest} -eq 64 ] || exit 1
  case "$digest" in *[!a-f0-9]*) exit 1 ;; esac
  case "$filename" in ''|*[!a-zA-Z0-9_.+~%:-]*|*/*) exit 1 ;; esac
  case "$package" in ''|*[!a-z0-9+.-]*) exit 1 ;; esac
  case "$version" in ''|*[!a-zA-Z0-9.+:~_-]*) exit 1 ;; esac
  set -- "$@" "$package=$version"
  expected=$((expected + 1))
done < "$lock"
[ "$expected" -gt 0 ] || exit 1
# Keep archives until their independent SHA256 checks complete.
if [ -f /etc/apt/apt.conf.d/docker-clean ]; then rm /etc/apt/apt.conf.d/docker-clean; fi
apt-get update -qq
apt-get --yes --no-install-recommends --download-only install "$@"
cd /var/cache/apt/archives
actual=$(find . -maxdepth 1 -type f -name '*.deb' | wc -l)
[ "$actual" -eq "$expected" ] || { printf '%s\n' 'Unreviewed or missing package artifact' >&2; exit 1; }
while read -r digest filename package version; do
  printf '%s  %s\n' "$digest" "$filename" | sha256sum --check --strict
  [ "$(dpkg-deb -f "$filename" Package)" = "$package" ]
  [ "$(dpkg-deb -f "$filename" Version)" = "$version" ]
done < "$lock"
# APT orders Pre-Depends correctly; --no-download prevents fetching any extra artifact.
apt-get --yes --no-install-recommends --no-download install "$@"
dpkg --audit
while read -r digest filename package version; do
  [ "$(dpkg-query -W -f='${Version}' "$package")" = "$version" ]
done < "$lock"
rm ./*.deb
find /var/lib/apt/lists -mindepth 1 -delete
