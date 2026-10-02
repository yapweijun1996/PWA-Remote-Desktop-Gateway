#!/bin/sh
# A bad artifact digest must refuse installation in a disposable ARM64 container.
set -eu
cd "$(dirname "$0")/.."
umask 077
fixture_dir=$(mktemp -d "$PWD/.tools/os-lock.XXXXXX")
cleanup(){ rm -rf "$fixture_dir"; }
trap cleanup EXIT INT TERM
python3 - "$fixture_dir/packages.lock" <<'PY'
from pathlib import Path
import sys
value = Path('deployment/deb-locks/gateway-arm64.lock').read_text()
Path(sys.argv[1]).write_text(('0' if value[0] != '0' else '1') + value[1:])
PY
docker run --rm --platform linux/arm64 --security-opt no-new-privileges:true --pids-limit 128 --memory 512m --entrypoint sh --mount "type=bind,src=$PWD/deployment/install-locked-debs.sh,dst=/installer,readonly" --mount "type=bind,src=$fixture_dir/packages.lock,dst=/package.lock,readonly" eclipse-temurin:17-jre-jammy@sha256:8993f1aed8b25fcea7a7047a7949c1866fa558fc6830d938c22c4f13b26be9d7 -c '
  before=$(dpkg-query -W -f="\${Version}" libssl3)
  if sh /installer /package.lock >/tmp/result 2>&1; then exit 1; fi
  grep -q "^libssl3_.*: FAILED$" /tmp/result
  after=$(dpkg-query -W -f="\${Version}" libssl3)
  [ "$before" = "$after" ]
  printf "%s\n" "PASS: tampered Ubuntu package digest rejected before installation; original libssl3 unchanged."
'
