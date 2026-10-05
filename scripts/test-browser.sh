#!/bin/sh
# Only disposable loopback resources and test-classpath code. No target host access.
set -eu
umask 077
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"
manual_mode=${RDG_BROWSER_FIXTURE_MANUAL:-false}
case "$manual_mode" in true|false) ;; *) printf '%s\n' 'BROWSER_FIXTURE_MANUAL_FLAG_REFUSED' >&2; exit 2 ;; esac
# The host agent check starts the same disposable gateway with a disposable agent peer and runs its own checks.
agent_mode=${RDG_BROWSER_FIXTURE_AGENT:-false}
case "$agent_mode" in true) fixture_agent=agent; checks=qa/agent-browser-checks.mjs ;; false) fixture_agent=; checks=qa/browser-checks.mjs ;; *) printf '%s\n' 'BROWSER_FIXTURE_AGENT_FLAG_REFUSED' >&2; exit 2 ;; esac
node scripts/build-web.mjs
./scripts/maven.sh -B -q -f gateway/pom.xml test-compile dependency:build-classpath -Dmdep.outputFile=target/test-classpath.txt -Dmdep.includeScope=test
mkdir -p .tools
fixture_dir=$(mktemp -d "$root/.tools/browser-fixture.XXXXXX")
java_pid= proxy_pid= deadline_pid=
cleanup(){
  trap - EXIT INT TERM
  if [ -n "$deadline_pid" ]; then kill "$deadline_pid" 2>/dev/null || true; wait "$deadline_pid" 2>/dev/null || true; fi
  if [ -n "$proxy_pid" ]; then kill "$proxy_pid" 2>/dev/null || true; wait "$proxy_pid" 2>/dev/null || true; fi
  if [ -n "$java_pid" ]; then kill "$java_pid" 2>/dev/null || true; wait "$java_pid" 2>/dev/null || true; fi
  rm -rf "$fixture_dir"
}
trap cleanup EXIT
trap 'exit 124' INT TERM
fixture_port=${RDG_FIXTURE_PORT:-32122}
if [ "$manual_mode" = true ]; then
  node -e 'setTimeout(() => process.kill(Number(process.argv[1]), "SIGTERM"), 900000)' "$$" &
  deadline_pid=$!
fi
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$fixture_dir/key.pem" -out "$fixture_dir/cert.pem" -days 1 -subj /CN=127.0.0.1 -addext 'subjectAltName=IP:127.0.0.1' > "$fixture_dir/cert-build.log" 2>&1
java -cp "gateway/target/test-classes:gateway/target/classes:$(cat gateway/target/test-classpath.txt)" com.rdg.BrowserFixtureMain "$fixture_dir" "https://127.0.0.1:$fixture_port" $fixture_agent > "$fixture_dir/gateway.log" 2>&1 &
java_pid=$!
i=0
while [ ! -f "$fixture_dir/proxy.json" ]; do
  i=$((i+1)); [ "$i" -le 100 ] || { printf '%s\n' 'Fixture failed to start' >&2; exit 1; }
  sleep 0.1
done
node qa/fixture-proxy.mjs "$fixture_dir" "$fixture_port" > "$fixture_dir/proxy.log" 2>&1 &
proxy_pid=$!
export RDG_FIXTURE_URL="https://127.0.0.1:$fixture_port"
if [ "$manual_mode" = true ]; then
  node --input-type=module - "$java_pid" "$proxy_pid" "$fixture_dir" <<'JS'
import https from 'node:https';
import {readFileSync} from 'node:fs';
const ownedPids = process.argv.slice(2, 4).map(Number);
const ownedDirectory = process.argv[4];
const deadline = Date.now() + 10000;
let ready = false;
while (Date.now() < deadline) {
  try { for (const pid of ownedPids) process.kill(pid, 0); } catch { break; }
  // Only this proxy's successful listen callback writes this startup marker.
  let listening = false;
  try { listening = readFileSync(ownedDirectory + '/proxy.log', 'utf8')
      .split('\n').includes('Disposable HTTPS fixture edge ready.'); } catch {}
  if (!listening) { await new Promise(resolve => setTimeout(resolve, 100)); continue; }
  ready = await new Promise(resolve => {
    const request = https.get(process.env.RDG_FIXTURE_URL + '/health', {rejectUnauthorized: false}, response => {
      response.resume(); resolve(response.statusCode === 200);
    });
    request.setTimeout(500, () => request.destroy());
    request.on('error', () => resolve(false));
  });
  if (ready) {
    try { for (const pid of ownedPids) process.kill(pid, 0); } catch { ready = false; }
    break;
  }
  await new Promise(resolve => setTimeout(resolve, 100));
}
if (!ready) { console.error('MANUAL_BROWSER_FIXTURE_STARTUP_REFUSED'); process.exit(2); }
JS
  printf 'MANUAL_UI_FIXTURE_READY: %s — disposable protocol test data, up to15 minutes, no real Mac connection.\n' "$RDG_FIXTURE_URL"
  wait "$java_pid"
else
  export RDG_FIXTURE_DIR="$fixture_dir"
  node "$checks"
fi
