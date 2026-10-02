#!/bin/sh
# Synthetic official-daemon failure-path diagnostic; never current Mac or real credentials.
set -eu
umask 077
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"
local_socket="$HOME/.docker/run/docker.sock"
[ -S "$local_socket" ] || { printf '%s\n' 'LOCAL_DOCKER_SOCKET_UNAVAILABLE' >&2; exit 2; }
unset DOCKER_CONTEXT DOCKER_HOST DOCKER_TLS_VERIFY DOCKER_CERT_PATH
docker_local() { command docker --host "unix://$local_socket" "$@"; }
ids=$(node --input-type=module <<'JS'
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {validateBuild} from './qa/native-vnc-diagnostics.mjs';
const hash = p => createHash('sha256').update(readFileSync(p)).digest('hex');
const ledger = JSON.parse(readFileSync('qa/implementation/artifacts.json', 'utf8'));
const manifest = JSON.parse(readFileSync('.tools/native-vnc-diagnostics/manifest.json', 'utf8'));
const builder = JSON.parse(readFileSync('qa/native-vnc-diagnostics-builder.json', 'utf8')).builderImageId;
const sha = validateBuild(manifest, builder, hash('qa/native-vnc-diagnostics.c'),
  hash('.tools/native-vnc-diagnostics/native-vnc-diagnostics.so'));
const images = [ledger.oci.guacd.localId, ledger.oci.gateway.localId];
if (images.some(id => !/^sha256:[a-f0-9]{64}$/.test(id))) throw new Error('Invalid fixture image identity');
console.log([...images, sha].join(' '));
JS
)
set -- $ids
guacd_image=$1
client_image=$2
library_sha=$3
./scripts/maven.sh -o -B -q -f gateway/pom.xml test-compile
fixture_dir=$(mktemp -d "$root/.tools/native-diagnostics-check.XXXXXX")
fixture_name=rdg-$(basename "$fixture_dir")
deadline_pid=
cleanup() {
  trap - EXIT INT TERM
  docker_local rm -f "$fixture_name-client" "$fixture_name-daemon" >/dev/null 2>&1 || true
  if [ -n "$deadline_pid" ]; then kill "$deadline_pid" 2>/dev/null || true; wait "$deadline_pid" 2>/dev/null || true; fi
  rm -f "$fixture_dir/metadata.json"
  rmdir "$fixture_dir"
}
trap cleanup EXIT
trap 'exit 124' INT TERM
node -e 'setTimeout(() => process.kill(Number(process.argv[1]), "SIGTERM"), 60000)' "$$" &
deadline_pid=$!
docker_local run -d --name "$fixture_name-daemon" --pull never --network none --log-driver none --read-only --cap-drop ALL --security-opt no-new-privileges:true --pids-limit 64 --memory 256m --tmpfs /tmp:uid=10001,gid=10001,mode=0700,noexec,nosuid,size=32m --mount "type=bind,src=$root/.tools/native-vnc-diagnostics/native-vnc-diagnostics.so,dst=/native-logger.so,readonly" --env LD_PRELOAD=/native-logger.so --env RDG_NATIVE_VNC_DIAGNOSTICS_TO_FILE=true "$guacd_image" -f -b 127.0.0.1 -l 4822 -p /tmp/guacd.pid -L error >/dev/null
docker_local run --rm --name "$fixture_name-client" --pull never --network "container:$fixture_name-daemon" --log-driver none --read-only --cap-drop ALL --security-opt no-new-privileges:true --pids-limit 128 --memory 512m --tmpfs /tmp:uid=10001,gid=10001,mode=0700,noexec,nosuid,size=64m --mount "type=bind,src=$root/gateway/target/test-classes,dst=/fixture-classes,readonly" --entrypoint java "$client_image" -Dorg.sqlite.lib.path=/app/lib -Xmx256m -cp /app/rdg-gateway.jar:/fixture-classes com.rdg.OfficialGuacdCheckMain
node qa/native-vnc-diagnostics.mjs capture "$fixture_dir/metadata.json" - local-mac-view.abc123 "$library_sha" "unix://$local_socket" "$fixture_name-daemon"
node --input-type=module - "$fixture_dir/metadata.json" "$guacd_image" "$library_sha" <<'JS'
import {readFile} from 'node:fs/promises';
import {checkedDiagnostic} from './qa/native-vnc-diagnostics.mjs';
import {writeArtifact} from './scripts/atomic-artifact.mjs';
const [file, imageId, sha] = process.argv.slice(2);
const d = checkedDiagnostic(JSON.parse(await readFile(file, 'utf8')), 'local-mac-view.abc123', sha);
if (!(d.stages.NETWORK_CONNECT_FAILURE > 0) || d.stages.AUTHENTICATION_SUCCEEDED)
  throw new Error('SYNTHETIC_NATIVE_DIAGNOSTIC_FAILURE');
const evidence = {scope: 'SYNTHETIC_NATIVE_LOGGER_GUACD_FAILURE_PATH', status: 'PASS',
  imageId, librarySha256: sha, stages: d.stages, rawLogsSaved: false,
  network: 'NONE', authAttempted: false, realMac: false};
await writeArtifact('qa/implementation/native-diagnostics-integration.json', JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify(evidence));
JS
