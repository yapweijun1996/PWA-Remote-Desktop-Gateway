#!/bin/sh
# Disposable loopback HTTPS enrollment fixtures only; no Mac, real Access or desktop secret.
set -eu
umask 077
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"
mkdir -p .tools
fixture_dir=$(mktemp -d "$root/.tools/login-browser-fixture.XXXXXX")
java_pid= browser_pid= deadline_pid=
cleanup(){
  trap - EXIT INT TERM
  for owned_pid in "$browser_pid" "$java_pid" "$deadline_pid"; do
    if [ -n "$owned_pid" ]; then kill "$owned_pid" 2>/dev/null || true; wait "$owned_pid" 2>/dev/null || true; fi
  done
  rm -rf "$fixture_dir"
}
trap cleanup EXIT
trap 'exit 124' INT TERM
node -e 'setTimeout(() => process.kill(Number(process.argv[1]), "SIGTERM"), 60000)' "$$" &
deadline_pid=$!
node scripts/build-web.mjs
./scripts/maven.sh -B -q -f gateway/pom.xml test-compile dependency:build-classpath -Dmdep.outputFile=target/test-classpath.txt -Dmdep.includeScope=test
printf '%s\n' 'LOGIN_BROWSER_FIXTURE_COMPILE_READY'
fixture_port=$(node --input-type=module - <<'JS'
import net from 'node:net';
const server=net.createServer();server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>console.log(port));});
JS
)
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$fixture_dir/key.pem" -out "$fixture_dir/cert.pem" -days 1 -subj /CN=127.0.0.1 -addext 'subjectAltName=IP:127.0.0.1' > "$fixture_dir/cert-build.log" 2>&1
java -cp "gateway/target/test-classes:gateway/target/classes:$(cat gateway/target/test-classpath.txt)" com.rdg.LoginBrowserFixtureMain "$fixture_dir" "https://127.0.0.1:$fixture_port" > "$fixture_dir/gateway.log" 2>&1 &
java_pid=$!
i=0
while [ ! -f "$fixture_dir/proxy.json" ]; do
  kill -0 "$java_pid" 2>/dev/null || { printf '%s\n' 'LOGIN_BROWSER_FIXTURE_STARTUP_REFUSED' >&2; exit 2; }
  i=$((i+1)); [ "$i" -le 100 ] || { printf '%s\n' 'LOGIN_BROWSER_FIXTURE_STARTUP_REFUSED' >&2; exit 2; }
  sleep 0.1
done
kill -0 "$java_pid" 2>/dev/null || { printf '%s\n' 'LOGIN_BROWSER_FIXTURE_STARTUP_REFUSED' >&2; exit 2; }
node qa/login-browser-checks.mjs "$fixture_dir" "$fixture_port" &
browser_pid=$!
wait "$browser_pid"
