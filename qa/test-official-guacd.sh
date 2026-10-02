#!/bin/sh
# Official guacd on disposable loopback-only namespaces; no VNC/Mac target or port.
set -eu
cd "$(dirname "$0")/.."
umask 077
./scripts/maven.sh -B -q -f gateway/pom.xml test-compile
fixture_dir=$(mktemp -d "$PWD/.tools/official-guacd.XXXXXX")
fixture_name=rdg-$(basename "$fixture_dir")
image=${RDG_TEST_IMAGE:-rdg-gateway:local-verified}
guacd_image=guacamole/guacd:1.6.0@sha256:8974eaa9ba32f713daf311e7cc8cd7e4cdfba1edea39eed75524e78ef4b08f4f
cleanup(){ docker rm -f "$fixture_name-client" "$fixture_name-daemon" >/dev/null 2>&1 || true; rm -rf "$fixture_dir"; }
trap cleanup EXIT INT TERM
docker run -d --name "$fixture_name-daemon" --network none --log-driver none --read-only --cap-drop ALL --security-opt no-new-privileges:true --pids-limit 64 --memory 256m --tmpfs /tmp:mode=1777,noexec,nosuid,size=32m --entrypoint /opt/guacamole/sbin/guacd "$guacd_image" -f -b 127.0.0.1 -l 4822 -p /tmp/guacd.pid -L error >/dev/null
docker run --rm --name "$fixture_name-client" --network "container:$fixture_name-daemon" --read-only --cap-drop ALL --security-opt no-new-privileges:true --pids-limit 128 --memory 512m --tmpfs /tmp:uid=10001,gid=10001,mode=0700,noexec,nosuid,size=64m --mount "type=bind,src=$PWD/gateway/target/test-classes,dst=/fixture-classes,readonly" --entrypoint java "$image" -Dorg.sqlite.lib.path=/app/lib -Xmx256m -cp /app/rdg-gateway.jar:/fixture-classes com.rdg.OfficialGuacdCheckMain
docker image inspect "$guacd_image" --format 'Official guacd: {{.Os}}/{{.Architecture}} {{.Id}}'
