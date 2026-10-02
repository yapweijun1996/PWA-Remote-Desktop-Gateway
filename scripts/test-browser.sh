#!/bin/sh
# Only disposable loopback resources and test-classpath code. No target host access.
set -eu
umask 077
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"
node scripts/build-web.mjs
./scripts/maven.sh -B -q -f gateway/pom.xml test-compile dependency:build-classpath -Dmdep.outputFile=target/test-classpath.txt -Dmdep.includeScope=test
mkdir -p .tools
fixture_dir=$(mktemp -d "$root/.tools/browser-fixture.XXXXXX")
java_pid= proxy_pid=
cleanup(){
  if [ -n "$proxy_pid" ]; then kill "$proxy_pid" 2>/dev/null || true; wait "$proxy_pid" 2>/dev/null || true; fi
  if [ -n "$java_pid" ]; then kill "$java_pid" 2>/dev/null || true; wait "$java_pid" 2>/dev/null || true; fi
  rm -rf "$fixture_dir"
}
trap cleanup EXIT INT TERM
fixture_port=${RDG_FIXTURE_PORT:-32122}
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$fixture_dir/key.pem" -out "$fixture_dir/cert.pem" -days 1 -subj /CN=127.0.0.1 -addext 'subjectAltName=IP:127.0.0.1' > "$fixture_dir/cert-build.log" 2>&1
java -cp "gateway/target/test-classes:gateway/target/classes:$(cat gateway/target/test-classpath.txt)" com.rdg.BrowserFixtureMain "$fixture_dir" "https://127.0.0.1:$fixture_port" > "$fixture_dir/gateway.log" 2>&1 &
java_pid=$!
i=0
while [ ! -f "$fixture_dir/proxy.json" ]; do
  i=$((i+1)); [ "$i" -le 100 ] || { printf '%s\n' 'Fixture failed to start' >&2; exit 1; }
  sleep 0.1
done
node qa/fixture-proxy.mjs "$fixture_dir" "$fixture_port" > "$fixture_dir/proxy.log" 2>&1 &
proxy_pid=$!
export RDG_FIXTURE_URL="https://127.0.0.1:$fixture_port"
node qa/browser-checks.mjs
