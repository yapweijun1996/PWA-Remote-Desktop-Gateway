#!/bin/sh
# Actual protocol bytes from synthetic pixels through the reviewed official daemon.
# Owns two network-none containers only; never contacts the host desktop or live gateway.
set -eu
umask 077
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"
benchmark_mode=${1:-full}
case "$benchmark_mode" in full|candidate8|candidate16lossless|candidate8lossless) ;; *) printf '%s\n' 'BENCHMARK_MODE_INVALID' >&2; exit 2 ;; esac
benchmark_socket="$HOME/.docker/run/docker.sock"
[ -S "$benchmark_socket" ] || { printf '%s\n' 'LOCAL_DOCKER_SOCKET_UNAVAILABLE' >&2; exit 2; }
unset DOCKER_CONTEXT DOCKER_HOST DOCKER_TLS_VERIFY DOCKER_CERT_PATH
docker_benchmark() { command docker --host "unix://$benchmark_socket" "$@"; }
image_ids=$(node --input-type=module <<'JS'
import {readFileSync} from 'node:fs';
const ledger=JSON.parse(readFileSync('qa/implementation/artifacts.json','utf8'));
const ids=[ledger.oci.guacd.localId,ledger.oci.gateway.localId];
if(ids.some(id=>!/^sha256:[a-f0-9]{64}$/.test(id)))throw new Error('REVIEWED_IMAGE_LEDGER_REQUIRED');
console.log(ids.join(' '));
JS
)
# Both words are verified immutable local IDs; arbitrary image or target overrides are refused.
set -- $image_ids
benchmark_guacd=$1
benchmark_java=$2
[ "$(docker_benchmark image inspect "$benchmark_guacd" --format '{{.Id}}')" = "$benchmark_guacd" ]
[ "$(docker_benchmark image inspect "$benchmark_java" --format '{{.Id}}')" = "$benchmark_java" ]
[ -f gateway/target/rdg-gateway.jar ] || { printf '%s\n' 'BUILD_GATEWAY_JAR_FIRST' >&2; exit 2; }
mkdir -p .tools
benchmark_dir=$(mktemp -d "$root/.tools/bandwidth-benchmark.XXXXXX")
benchmark_name=rdg-$(basename "$benchmark_dir")
benchmark_client_pid= benchmark_deadline_pid=
cleanup() {
  trap - EXIT INT TERM
  for owned_pid in "$benchmark_client_pid" "$benchmark_deadline_pid"; do
    if [ -n "$owned_pid" ]; then kill "$owned_pid" 2>/dev/null || true; wait "$owned_pid" 2>/dev/null || true; fi
  done
  docker_benchmark rm -f "$benchmark_name-client" "$benchmark_name-daemon" >/dev/null 2>&1 || true
  rm -rf "$benchmark_dir"
}
trap cleanup EXIT
trap 'exit 124' INT TERM
# The shell deadline includes compilation, container startup and report validation.
node -e 'setTimeout(() => process.kill(Number(process.argv[1]), "SIGTERM"), 120000)' "$$" &
benchmark_deadline_pid=$!
cp qa/BandwidthBenchmark.java "$benchmark_dir/BandwidthBenchmark.java"
cp gateway/src/main/java/com/rdg/DisplayQuality.java "$benchmark_dir/DisplayQuality.java"
javac --release 17 -cp gateway/target/rdg-gateway.jar -d "$benchmark_dir/classes" \
  "$benchmark_dir/BandwidthBenchmark.java" "$benchmark_dir/DisplayQuality.java"
chmod 755 "$benchmark_dir"
chmod -R a+rX "$benchmark_dir/classes"
docker_benchmark run -d --name "$benchmark_name-daemon" --pull never --network none --log-driver none \
  --read-only --cap-drop ALL --security-opt no-new-privileges:true --pids-limit 64 --memory 256m \
  --tmpfs /tmp:uid=10001,gid=10001,mode=0700,noexec,nosuid,size=32m \
  "$benchmark_guacd" -f -b 127.0.0.1 -l 4822 -p /tmp/guacd.pid -L error >/dev/null
docker_benchmark run --rm --name "$benchmark_name-client" --pull never --network "container:$benchmark_name-daemon" \
  --log-driver none --read-only --cap-drop ALL --security-opt no-new-privileges:true --pids-limit 128 --memory 512m \
  --tmpfs /tmp:uid=10001,gid=10001,mode=0700,noexec,nosuid,size=64m \
  --mount "type=bind,src=$benchmark_dir/classes,dst=/fixture-classes,readonly" --entrypoint java \
  "$benchmark_java" -Djava.awt.headless=true -Xmx256m -cp /fixture-classes:/app/rdg-gateway.jar \
  com.rdg.qa.BandwidthBenchmark ${benchmark_mode#full} > "$benchmark_dir/results.json" &
benchmark_client_pid=$!
wait "$benchmark_client_pid"
benchmark_client_pid=
node qa/bandwidth-benchmark.mjs "$benchmark_dir/results.json" "$benchmark_guacd" "$benchmark_java" \
  "$benchmark_dir/BandwidthBenchmark.java" "$benchmark_mode" "$benchmark_dir/DisplayQuality.java"
