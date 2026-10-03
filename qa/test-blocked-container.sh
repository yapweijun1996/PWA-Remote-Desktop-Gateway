#!/bin/sh
# Disposable exact-image BLOCKED startup/auth checks; no host port, VNC or real Access identity.
set -eu
cd "$(dirname "$0")/.."
image=${RDG_TEST_IMAGE:?Set the reviewed gateway image ID}
umask 077
fixture_dir=$(mktemp -d "$PWD/.tools/blocked-container.XXXXXX")
fixture_name=rdg-$(basename "$fixture_dir")
state_volume=$fixture_name-state
cleanup(){
  docker rm -f "$fixture_name" >/dev/null 2>&1 || true
  docker volume rm "$state_volume" >/dev/null 2>&1 || true
  rm -rf "$fixture_dir"
}
trap cleanup EXIT
trap 'exit 124' INT TERM
cat > "$fixture_dir/device.json" <<'JSON'
{"nodeId":"blocked-container","publicOrigin":"https://blocked.fixture.test","localDevice":{"id":"fixture-mac","label":"Disposable blocked container fixture","targetOS":"macOS","upstreamHost":"host.docker.internal","upstreamPort":5900},"bookmarks":[]}
JSON
chmod 644 "$fixture_dir/device.json"
docker volume create "$state_volume" >/dev/null
docker run -d --name "$fixture_name" --network none --read-only --cap-drop ALL --security-opt no-new-privileges:true --pids-limit 128 --memory 512m --tmpfs /tmp:uid=10001,gid=10001,mode=0700,noexec,nosuid,size=64m -e RDG_DESKTOP_POLICY=BLOCKED -e RDG_PUBLIC_ORIGIN=https://blocked.fixture.test -e RDG_ACCESS_ISSUER=https://fixture-team.cloudflareaccess.com -e RDG_ACCESS_AUDIENCE=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa -e RDG_OWNER_EMAIL=owner@fixture.test -e RDG_TARGET_CONFIG=/app/device.json --mount "type=bind,src=$fixture_dir/device.json,dst=/app/device.json,readonly" --mount "type=volume,src=$state_volume,dst=/var/lib/rdg" "$image" >/dev/null
ready=false
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  [ "$(docker inspect "$fixture_name" --format '{{.State.Running}}')" = true ] || exit 1
  if docker exec "$fixture_name" java -Xmx32m -jar /app/rdg-gateway.jar --health; then ready=true; break; fi
  sleep 1
done
[ "$ready" = true ] || exit 1
for path in /api/devices /ws/sessions/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA; do
  for assertion in missing forged; do
    if [ "$assertion" = forged ]; then assertion_header='Cf-Access-Jwt-Assertion: forged'; else assertion_header='X-Fixture: missing'; fi
    response_status=$(docker exec "$fixture_name" bash -c 'exec 3<>/dev/tcp/127.0.0.1/8080; printf "GET %s HTTP/1.1\r\nHost: blocked.fixture.test\r\n%s\r\nOrigin: https://blocked.fixture.test\r\nConnection: close\r\n\r\n" "$1" "$2" >&3; head -n1 <&3' sh "$path" "$assertion_header")
    case "$response_status" in *' 401 '*) ;; *) exit 1 ;; esac
  done
done
image_id=$(docker image inspect "$image" --format '{{.Id}}')
python3 - "$image_id" <<'PYREPORT'
import json,sys,datetime
from pathlib import Path
report={'status':'PASS','recordedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'imageId':sys.argv[1],'level':'LOCAL_BLOCKED_CONTAINER_FIXTURE','desktopPolicy':'BLOCKED','realMac':False,'realAccess':False,'tests':['Non-root read-only SQLite startup without secret or calibration','Network-none health without host ports','Missing and forged JWT API denial','Missing and forged JWT WebSocket-path denial'],'cleanupScope':'Exit trap targets only this temporary container, state volume and fixture directory'}
Path('qa/implementation/blocked-container-results.json').write_text(json.dumps(report,indent=2)+'\n')
PYREPORT
printf '%s\n' 'PASS: BLOCKED exact-image startup without desktop prerequisites and four identity denials. No target or public port.'
