#!/bin/sh
# Re-resolve one deb lock against the signed Ubuntu archive inside the pinned guacd base image.
# Usage: deployment/refresh-deb-locks.sh <guacd-builder|guacd-runtime> <arm64|amd64>
# Review the resulting diff, then rebuild and re-run the image tests before deploying.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
name=$1
arch=$2
case "$name" in guacd-builder|guacd-runtime) ;; *) printf '%s\n' 'Unsupported lock name' >&2; exit 1 ;; esac
case "$arch" in arm64|amd64) ;; *) printf '%s\n' 'Unsupported architecture' >&2; exit 1 ;; esac
lock="$root/deployment/deb-locks/$name-$arch.lock"
image=$(sed -n 's/^FROM \(ubuntu:24\.04@sha256:[0-9a-f]\{64\}\).*/\1/p' "$root/deployment/Guacd.Dockerfile" | head -n 1)
[ -n "$image" ] || { printf '%s\n' 'Pinned base image not found' >&2; exit 1; }
packages=$(awk '{print $3}' "$lock" | tr '\n' ' ')
docker run --rm --network bridge --platform "linux/$arch" -e PACKAGES="$packages" "$image" sh -eu -c '
  rm -f /etc/apt/apt.conf.d/docker-clean
  apt-get update -qq >/dev/null
  DEBIAN_FRONTEND=noninteractive apt-get --yes -qq --no-install-recommends --download-only install $PACKAGES >/dev/null
  cd /var/cache/apt/archives
  for f in *.deb; do
    printf "%s %s %s %s\n" "$(sha256sum "$f" | cut -d" " -f1)" "$f" "$(dpkg-deb -f "$f" Package)" "$(dpkg-deb -f "$f" Version)"
  done
' | LC_ALL=C sort -k3,3 > "$lock.new"
[ -s "$lock.new" ] || { rm -f "$lock.new"; printf '%s\n' 'Empty resolution; lock unchanged' >&2; exit 1; }
mv "$lock.new" "$lock"
printf '%s %s\n' "$(wc -l < "$lock")" "$lock"
