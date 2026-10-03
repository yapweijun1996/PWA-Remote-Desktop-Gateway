#!/bin/sh
# Explicit owner-run localhost VIEW ONLY pilot; no settings, ingress or credential deletion.
set -eu
umask 077
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"

# Pin Docker to this approved Mac; never inherit a remote context or daemon endpoint.
local_docker_socket="$HOME/.docker/run/docker.sock"
[ -S "$local_docker_socket" ] || { printf '%s\n' 'LOCAL_DOCKER_SOCKET_UNAVAILABLE: no service started.' >&2; exit 2; }
local_docker_host="unix://$local_docker_socket"
unset DOCKER_CONTEXT DOCKER_HOST DOCKER_TLS_VERIFY DOCKER_CERT_PATH
docker_local() { command docker --host "$local_docker_host" "$@"; }
export RDG_LOCAL_DOCKER_ENDPOINT_PINNED=true
manual_mode=${RDG_LOCAL_VIEW_MANUAL:-false}
case "$manual_mode" in true|false) ;; *) printf '%s\n' 'LOCAL_VIEW_MANUAL_FLAG_REFUSED' >&2; exit 2 ;; esac
pilot_seconds=60
if [ "$manual_mode" = true ]; then pilot_seconds=900; fi
export RDG_LOCAL_VIEW_MANUAL="$manual_mode"

# Reject missing/unsafe credentials and browser dependencies before any service starts.
node --input-type=module <<'JS'
import {lstatSync, realpathSync, statSync} from 'node:fs';
import {createRequire} from 'node:module';
import {isAbsolute, resolve, sep} from 'node:path';
try {
  const path = process.env.RDG_LOCAL_VNC_SECRET_FILE;
  if (!path || !isAbsolute(path)) throw new Error();
  const file = lstatSync(path);
  const actual = realpathSync(path);
  const repository = realpathSync(process.cwd());
  if (!file.isFile() || file.isSymbolicLink() || file.size < 1 || file.size > 256
      || (file.mode & 0o077) !== 0 || file.uid !== process.getuid()
      || actual === repository || actual.startsWith(repository + sep)) throw new Error();
  if (process.env.RDG_LOCAL_VIEW_MANUAL !== 'true') {
    const require = createRequire(resolve('package.json'));
    require.resolve(process.env.RDG_PLAYWRIGHT_MODULE ?? 'playwright');
    if (!process.env.RDG_TEST_CHROMIUM || !isAbsolute(process.env.RDG_TEST_CHROMIUM)
        || !statSync(process.env.RDG_TEST_CHROMIUM).isFile()) throw new Error();
  }
} catch {
  console.error('LOCAL_VIEW_PREREQUISITE_MISSING: provide an owner-only absolute secret file outside Git and existing Playwright/Chromium paths. No services started.');
  process.exit(2);
}
JS
expected_image=$(node -p "JSON.parse(require('node:fs').readFileSync('qa/implementation/artifacts.json')).oci.guacd.localId")
actual_image=$(docker_local image inspect "$expected_image" --format '{{.Id}}')
[ "$actual_image" = "$expected_image" ] || { printf '%s\n' 'LOCAL_VIEW_IMAGE_ID_MISMATCH: no service started.' >&2; exit 2; }
printf '%s\n' '{"localDockerEndpointPinned":true}'
native_diagnostics=${RDG_LOCAL_VIEW_NATIVE_DIAGNOSTICS:-false}
case "$native_diagnostics" in true|false) ;; *) printf '%s\n' 'LOCAL_VIEW_DIAGNOSTIC_FLAG_REFUSED' >&2; exit 2 ;; esac
native_library_sha=
if [ "$native_diagnostics" = true ]; then
  native_library_sha=$(node --input-type=module <<'JS'
import {lstatSync, readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {validateBuild} from './qa/native-vnc-diagnostics.mjs';
try {
  const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
  const base = '.tools/native-vnc-diagnostics/';
  const manifest = JSON.parse(readFileSync(base + 'manifest.json', 'utf8'));
  const library = lstatSync(base + 'native-vnc-diagnostics.so');
  if (!library.isFile() || library.isSymbolicLink()) throw new Error();
  const expected = JSON.parse(readFileSync('qa/native-vnc-diagnostics-builder.json', 'utf8')).builderImageId;
  console.log(validateBuild(manifest, expected, hash('qa/native-vnc-diagnostics.c'),
    hash(base + 'native-vnc-diagnostics.so')));
} catch { console.error('LOCAL_VIEW_NATIVE_DIAGNOSTIC_BUILD_REQUIRED'); process.exit(2); }
JS
  )
fi
node scripts/build-web.mjs
./scripts/maven.sh -B -q -f gateway/pom.xml test-compile dependency:build-classpath -Dmdep.outputFile=target/test-classpath.txt -Dmdep.includeScope=test
mkdir -p .tools
pilot_dir=$(mktemp -d "$root/.tools/local-mac-view.XXXXXX")
container_name=rdg-$(basename "$pilot_dir")
java_pid= proxy_pid= browser_pid= deadline_pid=
cleanup() {
  trap - EXIT INT TERM
  for owned_pid in "$browser_pid" "$proxy_pid" "$java_pid" "$deadline_pid"; do
    if [ -n "$owned_pid" ]; then kill "$owned_pid" 2>/dev/null || true; wait "$owned_pid" 2>/dev/null || true; fi
  done
  docker_local rm -f "$container_name" >/dev/null 2>&1 || true
  python3 - "$root" "$pilot_dir" <<'PY'
from pathlib import Path
import shutil, sys
parent = Path(sys.argv[1]).resolve() / '.tools'
owned = Path(sys.argv[2])
if owned.parent == parent and owned.name.startswith('local-mac-view.') and not owned.is_symlink():
    shutil.rmtree(owned)
PY
}
trap cleanup EXIT
trap 'exit 124' INT TERM
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$pilot_dir/key.pem" -out "$pilot_dir/cert.pem" -days 1 -subj /CN=127.0.0.1 -addext 'subjectAltName=IP:127.0.0.1' > "$pilot_dir/cert-build.log" 2>&1
# One Node timer owns the bounded runtime; no orphaned sleep subprocess.
node -e 'setTimeout(() => process.kill(Number(process.argv[1]), "SIGTERM"), Number(process.argv[2]) * 1000)' "$$" "$pilot_seconds" &
deadline_pid=$!
set -- --name "$container_name" --pull never --log-driver none --read-only --cap-drop ALL --security-opt no-new-privileges:true --pids-limit 64 --memory 256m --tmpfs /tmp:uid=10001,gid=10001,mode=0700,noexec,nosuid,size=32m -p 127.0.0.1::4822
if [ "$native_diagnostics" = true ]; then
  set -- "$@" --mount "type=bind,src=$root/.tools/native-vnc-diagnostics/native-vnc-diagnostics.so,dst=/rdg-native-vnc-diagnostics.so,readonly" --env LD_PRELOAD=/rdg-native-vnc-diagnostics.so --env RDG_NATIVE_VNC_DIAGNOSTICS_TO_FILE=true
fi
pilot_run_id=$(basename "$pilot_dir")
export RDG_LOCAL_VIEW_RUN_ID="$pilot_run_id"
export RDG_LOCAL_VIEW_NATIVE_DIAGNOSTICS="$native_diagnostics"
docker_local run -d "$@" "$actual_image" -f -b 0.0.0.0 -l 4822 -p /tmp/guacd.pid -L error >/dev/null
bind_ip=$(docker_local inspect "$container_name" --format '{{(index (index .NetworkSettings.Ports "4822/tcp") 0).HostIp}}')
guacd_port=$(docker_local inspect "$container_name" --format '{{(index (index .NetworkSettings.Ports "4822/tcp") 0).HostPort}}')
[ "$bind_ip" = 127.0.0.1 ] || { printf '%s\n' 'LOCAL_VIEW_BIND_REFUSED' >&2; exit 2; }
set -- "$pilot_dir" "$guacd_port" 32122
if [ "$manual_mode" = true ]; then set -- "$@" 900; fi
java -cp "gateway/target/test-classes:gateway/target/classes:$(cat gateway/target/test-classpath.txt)" com.rdg.LocalMacViewMain "$@" > "$pilot_dir/gateway.log" 2>&1 &
java_pid=$!
attempt=0
while [ ! -f "$pilot_dir/proxy.json" ]; do
  attempt=$((attempt+1))
  [ "$attempt" -le 100 ] && kill -0 "$java_pid" 2>/dev/null || { printf '%s\n' 'LOCAL_VIEW_GATEWAY_STARTUP_REFUSED' >&2; exit 2; }
  sleep 0.1
done
node qa/fixture-proxy.mjs "$pilot_dir" 32122 > "$pilot_dir/proxy.log" 2>&1 &
proxy_pid=$!
node --input-type=module - "$java_pid" "$proxy_pid" <<'JS'
import https from 'node:https';
const ownedPids = process.argv.slice(2).map(Number);
const deadline = Date.now() + 10000;
let ready = false;
while (Date.now() < deadline) {
  try { for (const pid of ownedPids) process.kill(pid, 0); }
  catch { break; }
  ready = await new Promise(resolve => {
    const request = https.get('https://127.0.0.1:32122/health', {rejectUnauthorized: false}, response => {
      response.resume();
      resolve(response.statusCode === 200);
    });
    request.setTimeout(500, () => request.destroy());
    request.on('error', () => resolve(false));
  });
  if (ready) {
    try { for (const pid of ownedPids) process.kill(pid, 0); }
    catch { ready = false; }
    break;
  }
  await new Promise(resolve => setTimeout(resolve, 100));
}
if (!ready) {
  console.error('LOCAL_VIEW_EDGE_STARTUP_REFUSED');
  process.exit(2);
}
JS
export RDG_LOCAL_VIEW_URL=https://127.0.0.1:32122
export RDG_LOCAL_VIEW_GUACD_IMAGE_ID="$actual_image"
if [ "$manual_mode" = true ]; then
  printf '%s\n' 'LOCAL_MANUAL_VIEW_READY: https://127.0.0.1:32122 — bounded 15-minute signed test identity, View only, no automated desktop connection.'
  if wait "$java_pid"; then manual_status=0; else manual_status=$?; fi
  java_pid=
  exit "$manual_status"
fi
node qa/local-mac-view.mjs &
browser_pid=$!
if wait "$browser_pid"; then browser_status=0; else browser_status=$?; fi
browser_pid=
if [ "$native_diagnostics" = true ]; then
  # Read only the fixed-label tmpfs file while this daemon still exists; never attach raw logs.
  node qa/native-vnc-diagnostics.mjs capture "$pilot_dir/native-diagnostics.json" - "$pilot_run_id" "$native_library_sha" "$local_docker_host" "$container_name"
  node qa/native-vnc-diagnostics.mjs merge "$pilot_dir/native-diagnostics.json" "${RDG_LOCAL_VIEW_OUTPUT:-qa/implementation/local-mac-view-results.json}" "$pilot_run_id" "$native_library_sha"
fi
exit "$browser_status"
