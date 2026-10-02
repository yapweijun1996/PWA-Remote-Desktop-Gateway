#!/bin/sh
# Local test-only logger compiler; no credentials, target connection or production image edits.
set -eu
umask 077
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"
local_socket="$HOME/.docker/run/docker.sock"
[ -S "$local_socket" ] || { printf '%s\n' 'LOCAL_DOCKER_SOCKET_UNAVAILABLE' >&2; exit 2; }
unset DOCKER_CONTEXT DOCKER_HOST DOCKER_TLS_VERIFY DOCKER_CERT_PATH
docker_local() { command docker --host "unix://$local_socket" "$@"; }
output="$root/.tools/native-vnc-diagnostics"
[ ! -L "$output" ] || { printf '%s\n' 'NATIVE_DIAGNOSTIC_DIRECTORY_REFUSED' >&2; exit 2; }
mkdir -p "$output"
chmod 700 "$output"
node --test qa/native-vnc-diagnostics.test.mjs
# Reuse the locally prepared digest-locked builder; a changed network mode invalidates APT cache.
builder_image=$(node -p "JSON.parse(require('node:fs').readFileSync('qa/native-vnc-diagnostics-builder.json')).builderImageId")
[ "$(docker_local image inspect "$builder_image" --format '{{.Id}}')" = "$builder_image" ] || { printf '%s\n' 'NATIVE_DIAGNOSTIC_BUILDER_ID_MISMATCH' >&2; exit 2; }
docker_local run --rm --pull never --network none --read-only --cap-drop ALL --security-opt no-new-privileges:true --user "$(id -u):$(id -g)" --tmpfs "/tmp:uid=$(id -u),gid=$(id -g),mode=0700,nosuid,size=32m" --mount "type=bind,src=$root/qa,dst=/tests,readonly" --mount "type=bind,src=$output,dst=/output" --workdir /output --entrypoint sh "$builder_image" -c '
set -eu
cc -Wall -Wextra -Werror -O2 -D_FORTIFY_SOURCE=2 -fPIC -shared /tests/native-vnc-diagnostics.c -o native-vnc-diagnostics.so
cc -Wall -Wextra -Werror -O2 -D_FORTIFY_SOURCE=2 /tests/native-vnc-diagnostics-test.c -o native-vnc-diagnostics-test
LD_PRELOAD=/output/native-vnc-diagnostics.so ./native-vnc-diagnostics-test
chmod 644 native-vnc-diagnostics.so
'
node --input-type=module - "$builder_image" <<'JS'
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {writeArtifact} from './scripts/atomic-artifact.mjs';
const hash = async path => createHash('sha256').update(await readFile(path)).digest('hex');
const builderImageId = process.argv[2];
if (!/^sha256:[a-f0-9]{64}$/.test(builderImageId)) throw new Error('Invalid local builder identity');
const manifest = {scope: 'TEST_ONLY_NATIVE_LOGGER', builderImageId,
  sourceSha256: await hash('qa/native-vnc-diagnostics.c'),
  librarySha256: await hash('.tools/native-vnc-diagnostics/native-vnc-diagnostics.so')};
await writeArtifact('.tools/native-vnc-diagnostics/manifest.json', JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify(manifest));
JS
