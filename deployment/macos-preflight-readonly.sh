#!/bin/sh
# Read-only local preflight. Run only on the authorized Mac. No sudo or secrets.
set -eu
if [ "$(uname -s)" != "Darwin" ]; then
  printf '%s\n' 'NOT_RUN: this preflight requires the actual authorized macOS target.' >&2
  exit 2
fi
printf '\n== OS and architecture ==\n'
sw_vers
uname -m
printf '\n== Relevant tool availability (no environment dump) ==\n'
for tool in docker cloudflared java node; do
  if command -v "$tool" >/dev/null 2>&1; then command -v "$tool"; else printf '%s unavailable\n' "$tool"; fi
done
printf '\n== Candidate listening ports (visibility may be limited without privileges) ==\n'
for port in 32120 5900 4822; do
  printf '\nPort %s\n' "$port"
  lsof -nP -iTCP:"$port" -sTCP:LISTEN || true
done
printf '\nNo settings changed. Listener absence here is NOT proof of firewall isolation.\n'
printf 'Still required: authorized runtime checks, VNC handshake, key mapping, Access and external-network tests.\n'
