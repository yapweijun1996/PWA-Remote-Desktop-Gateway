#!/bin/sh
# Disposable exact-image BLOCKED startup/auth checks; no host port, VNC or real Access identity.
set -eu
cd "$(dirname "$0")/.."
image=${RDG_TEST_IMAGE:?Set the reviewed gateway image ID}
# Ignore any inherited remote daemon/context; this QA is approved only on the local Mac.
local_docker_socket="$HOME/.docker/run/docker.sock"
[ -S "$local_docker_socket" ] || { printf '%s\n' 'LOCAL_DOCKER_SOCKET_UNAVAILABLE' >&2; exit 2; }
local_docker_host="unix://$local_docker_socket"
unset DOCKER_CONTEXT DOCKER_HOST DOCKER_TLS_VERIFY DOCKER_CERT_PATH
docker_local(){ command docker --host "$local_docker_host" "$@"; }
[ "${#image}" -eq 71 ] || { printf '%s\n' 'EXACT_IMAGE_ID_REQUIRED' >&2; exit 2; }
case "$image" in sha256:*) ;; *) printf '%s\n' 'EXACT_IMAGE_ID_REQUIRED' >&2; exit 2 ;; esac
image_suffix=${image#sha256:}
case "$image_suffix" in *[!0-9a-f]*) printf '%s\n' 'EXACT_IMAGE_ID_REQUIRED' >&2; exit 2 ;; esac
actual_image=$(docker_local image inspect "$image" --format '{{.Id}}')
[ "$actual_image" = "$image" ] || { printf '%s\n' 'IMAGE_ID_MISMATCH' >&2; exit 2; }
umask 077
fixture_dir=$(mktemp -d "$PWD/.tools/blocked-container.XXXXXX")
fixture_name=rdg-$(basename "$fixture_dir")
state_volume=$fixture_name-state
cleanup(){
  docker_local rm -f "$fixture_name" >/dev/null 2>&1 || true
  docker_local volume rm "$state_volume" >/dev/null 2>&1 || true
  rm -rf "$fixture_dir"
}
trap cleanup EXIT
trap 'exit 124' INT TERM
cat > "$fixture_dir/device.json" <<'JSON'
{"nodeId":"blocked-container","publicOrigin":"https://blocked.fixture.test","localDevice":{"id":"fixture-mac","label":"Disposable blocked container fixture","targetOS":"macOS","upstreamHost":"host.docker.internal","upstreamPort":5900},"bookmarks":[]}
JSON
chmod 644 "$fixture_dir/device.json"
docker_local volume create "$state_volume" >/dev/null
docker_local run -d --pull never --name "$fixture_name" --network none --read-only --cap-drop ALL --security-opt no-new-privileges:true --pids-limit 128 --memory 512m --tmpfs /tmp:uid=10001,gid=10001,mode=0700,noexec,nosuid,size=64m -e RDG_DESKTOP_POLICY=BLOCKED -e RDG_PUBLIC_ORIGIN=https://blocked.fixture.test -e RDG_ACCESS_ISSUER=https://fixture-team.cloudflareaccess.com -e RDG_ACCESS_AUDIENCE=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa -e RDG_OWNER_EMAIL=owner@fixture.test -e RDG_TARGET_CONFIG=/app/device.json --mount "type=bind,src=$fixture_dir/device.json,dst=/app/device.json,readonly" --mount "type=volume,src=$state_volume,dst=/var/lib/rdg" "$actual_image" >/dev/null
ready=false
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  [ "$(docker_local inspect "$fixture_name" --format '{{.State.Running}}')" = true ] || exit 1
  if docker_local exec "$fixture_name" java -Xmx32m -jar /app/rdg-gateway.jar --health; then ready=true; break; fi
  sleep 1
done
[ "$ready" = true ] || exit 1
for path in /api/devices /ws/sessions/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA; do
  for assertion in missing forged; do
    if [ "$assertion" = forged ]; then assertion_header='Cf-Access-Jwt-Assertion: forged'; else assertion_header='X-Fixture: missing'; fi
    response_status=$(docker_local exec "$fixture_name" bash -c 'exec 3<>/dev/tcp/127.0.0.1/8080; printf "GET %s HTTP/1.1\r\nHost: blocked.fixture.test\r\n%s\r\nOrigin: https://blocked.fixture.test\r\nConnection: close\r\n\r\n" "$1" "$2" >&3; head -n1 <&3' sh "$path" "$assertion_header")
    case "$response_status" in *' 401 '*) ;; *) exit 1 ;; esac
  done
done
python3 - "$actual_image" <<'PYREPORT'
import json,sys,datetime
from pathlib import Path
report={'status':'PASS','recordedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'imageId':sys.argv[1],'level':'LOCAL_BLOCKED_CONTAINER_FIXTURE','desktopPolicy':'BLOCKED','localDockerEndpointPinned':True,'imagePullPolicy':'NEVER','realMac':False,'realAccess':False,'tests':['Non-root read-only SQLite startup without secret or calibration','Network-none health without host ports','Missing and forged JWT API denial','Missing and forged JWT WebSocket-path denial'],'cleanupScope':'Exit trap targets only this temporary container, state volume and fixture directory'}
Path('qa/implementation/blocked-container-results.json').write_text(json.dumps(report,indent=2)+'\n')
PYREPORT
printf '%s\n' 'PASS: BLOCKED exact-image startup without desktop prerequisites and four identity denials. No target or public port.'
