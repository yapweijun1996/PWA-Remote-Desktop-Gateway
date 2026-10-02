#!/bin/sh
# Corrected-policy synthetic cases in a network-none namespace; never actual Mac/VNC auth.
set -eu
umask 077
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"
local_docker_socket="$HOME/.docker/run/docker.sock"
[ -S "$local_docker_socket" ] || { printf '%s\n' 'LOCAL_DOCKER_SOCKET_UNAVAILABLE' >&2; exit 2; }
local_docker_host="unix://$local_docker_socket"
unset DOCKER_CONTEXT DOCKER_HOST DOCKER_TLS_VERIFY DOCKER_CERT_PATH
docker_local() { command docker --host "$local_docker_host" "$@"; }
ledger_ids=$(node --input-type=module <<'JS'
import {readFileSync} from 'node:fs';
try {
  const ledger = JSON.parse(readFileSync('qa/implementation/artifacts.json', 'utf8'));
  const ids = [ledger.oci.guacd.localId, ledger.oci.gateway.localId];
  if (ids.some(id => typeof id !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(id))) throw new Error();
  console.log(ids.join(' '));
} catch {
  console.error('SYNTHETIC_REVIEWED_IMAGE_LEDGER_REQUIRED');
  process.exit(2);
}
JS
)
# Both words have been validated as exact SHA256 IDs; no endpoint/image override is accepted.
set -- $ledger_ids
expected_guacd=$1
expected_gateway=$2
[ "$(docker_local image inspect "$expected_guacd" --format '{{.Id}}')" = "$expected_guacd" ] || { printf '%s\n' 'SYNTHETIC_GUACD_IMAGE_ID_MISMATCH' >&2; exit 2; }
[ "$(docker_local image inspect "$expected_gateway" --format '{{.Id}}')" = "$expected_gateway" ] || { printf '%s\n' 'SYNTHETIC_GATEWAY_IMAGE_ID_MISMATCH' >&2; exit 2; }
./scripts/maven.sh -o -B -q -f gateway/pom.xml test-compile
mkdir -p .tools
fixture_dir=$(mktemp -d "$root/.tools/vnc-security-selection.XXXXXX")
fixture_name=rdg-$(basename "$fixture_dir")
client_pid= deadline_pid=
cleanup() {
  trap - EXIT INT TERM
  for owned_pid in "$client_pid" "$deadline_pid"; do
    if [ -n "$owned_pid" ]; then kill "$owned_pid" 2>/dev/null || true; wait "$owned_pid" 2>/dev/null || true; fi
  done
  docker_local rm -f "$fixture_name-client" "$fixture_name-daemon" >/dev/null 2>&1 || true
  rmdir "$fixture_dir"
}
trap cleanup EXIT
trap 'exit 124' INT TERM
node -e 'setTimeout(() => process.kill(Number(process.argv[1]), "SIGTERM"), 60000)' "$$" &
deadline_pid=$!
docker_local run -d --name "$fixture_name-daemon" --pull never --network none --log-driver none --read-only --cap-drop ALL --security-opt no-new-privileges:true --pids-limit 64 --memory 256m --tmpfs /tmp:uid=10001,gid=10001,mode=0700,noexec,nosuid,size=32m "$expected_guacd" -f -b 127.0.0.1 -l 4822 -p /tmp/guacd.pid -L error >/dev/null
docker_local run --rm --name "$fixture_name-client" --pull never --network "container:$fixture_name-daemon" --log-driver none --read-only --cap-drop ALL --security-opt no-new-privileges:true --pids-limit 128 --memory 512m --tmpfs /tmp:uid=10001,gid=10001,mode=0700,noexec,nosuid,size=64m --mount "type=bind,src=$root/gateway/target/test-classes,dst=/fixture-classes,readonly" --entrypoint java "$expected_gateway" -Dorg.sqlite.lib.path=/app/lib -Xmx256m -cp /app/rdg-gateway.jar:/fixture-classes com.rdg.VncSecuritySelectionMain &
client_pid=$!
wait "$client_pid"
client_pid=
