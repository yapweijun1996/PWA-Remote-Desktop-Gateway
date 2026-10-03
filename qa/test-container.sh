#!/bin/sh
# Disposable local image acceptance only; never opens a target or host port.
set -eu
cd "$(dirname "$0")/.."
image=${RDG_TEST_IMAGE:-rdg-gateway:local-verified}
umask 077
fixture_dir=$(mktemp -d "$PWD/.tools/container-fixture.XXXXXX")
fixture_name=rdg-$(basename "$fixture_dir")
secret_volume=$fixture_name-secret
state_volume=$fixture_name-state
cleanup(){ docker rm -f "$fixture_name" >/dev/null 2>&1 || true; docker volume rm "$secret_volume" "$state_volume" >/dev/null 2>&1 || true; rm -rf "$fixture_dir"; }
trap cleanup EXIT INT TERM
if docker run --rm --network none "$image" > "$fixture_dir/missing-config.txt" 2>&1; then
  printf '%s\n' 'FAIL: unconfigured container started' >&2; exit 1
else
  refused_status=$?
  [ "$refused_status" -eq 1 ] || exit 1
  grep -qx 'RDG startup refused: CONFIGURATION_OR_RUNTIME_INVALID' "$fixture_dir/missing-config.txt"
fi
printf '%s\n' 'fixture-only-not-a-real-vnc-password' > "$fixture_dir/secret"
cat > "$fixture_dir/device.json" <<'JSON'
{"nodeId":"container-fixture","publicOrigin":"https://container.fixture.test","localDevice":{"id":"fixture-mac","label":"Disposable container fixture","targetOS":"macOS","upstreamHost":"127.0.0.1","upstreamPort":5900,"credentialRef":"/run/secrets/vnc_password"},"bookmarks":[],"keysyms":{"CommandLeft":65511,"CommandRight":65512,"OptionLeft":65513,"OptionRight":65514,"ControlLeft":65507,"ControlRight":65508}}
JSON
chmod 644 "$fixture_dir/device.json"
docker volume create "$secret_volume" >/dev/null
docker volume create "$state_volume" >/dev/null
docker run --rm --network none --user 0 --entrypoint sh --mount "type=bind,src=$fixture_dir/secret,dst=/source-secret,readonly" --mount "type=volume,src=$secret_volume,dst=/output-secret" "$image" -c 'cp /source-secret /output-secret/vnc_password && chown 10001:10001 /output-secret/vnc_password && chmod 600 /output-secret/vnc_password'
docker run -d --name "$fixture_name" --network none --read-only --cap-drop ALL --security-opt no-new-privileges:true --pids-limit 128 --memory 512m --tmpfs /tmp:uid=10001,gid=10001,mode=0700,noexec,nosuid,size=64m -e RDG_PUBLIC_ORIGIN=https://container.fixture.test -e RDG_ACCESS_ISSUER=https://fixture-team.cloudflareaccess.com -e RDG_ACCESS_AUDIENCE=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa -e RDG_OWNER_EMAIL=owner@fixture.test -e RDG_TARGET_CONFIG=/app/device.json --mount "type=bind,src=$fixture_dir/device.json,dst=/app/device.json,readonly" --mount "type=volume,src=$secret_volume,dst=/run/secrets,readonly" --mount "type=volume,src=$state_volume,dst=/var/lib/rdg" "$image" >/dev/null
ready=false
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  if [ "$(docker inspect "$fixture_name" --format '{{.State.Running}}')" != true ]; then
    docker logs "$fixture_name"
    docker inspect "$fixture_name" --format '{{.State.Status}} {{.State.ExitCode}} {{.State.Error}}'
    exit 1
  fi
  if docker exec "$fixture_name" java -Xmx32m -jar /app/rdg-gateway.jar --health; then ready=true; break; fi
  sleep 1
done
[ "$ready" = true ] || { docker logs "$fixture_name"; exit 1; }
docker exec "$fixture_name" java -Xmx32m -jar /app/rdg-gateway.jar --health
status=$(docker exec "$fixture_name" bash -c 'exec 3<>/dev/tcp/127.0.0.1/8080; printf "GET /api/devices HTTP/1.1\r\nHost: container.fixture.test\r\nConnection: close\r\n\r\n" >&3; head -n1 <&3')
printf '%s\n' "$status"
case "$status" in *' 401 '*) ;; *) exit 1 ;; esac
docker exec "$fixture_name" java -version 2>&1
docker image inspect "$image" --format '{{.Os}}/{{.Architecture}} {{.Id}}'
printf '%s\n' 'PASS: isolated container liveness, SQLite initialization and missing-JWT rejection. No target or public port.'
