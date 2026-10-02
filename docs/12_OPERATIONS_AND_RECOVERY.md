# 12 · Operations, maintenance and recovery

## Health model
Health has layers: gateway process ready, authenticated owner access, guacd reachable, VNC reachable, screen/auth success, and interactive control verified. A generic liveness endpoint must not reveal private devices or secrets. Public status should not expose detailed internal addresses. Cross-node launch links remain Unverified until the target is checked through its own authorized path.

## Troubleshooting table
| Symptom | Checks | Do not do |
|---|---|---|
| Access login denied | Exact email allowlist, app hostname and identity configuration | Change policy to Everyone |
| Login succeeds, socket fails | JWT audience/issuer, cookie, Origin, path, one-use intent, proxy upgrade | Put password or bearer token in URL |
| Gateway reachable, no desktop | Target sleep/lock, VNC auth mode, container-to-host route, guacd health | Publish 5900 to Internet |
| Wrong Command behavior | Selected client profile, left/right physical key, calibrated keysym, local reserved shortcut | Globally swap Ctrl/Command |
| Stuck modifier | Stop input, Release all, close upstream, new session | Replay buffered input after reconnect |
| Remote Copy works, local paste does not | Separate clipboard direction and browser permission | Poll clipboard silently |
| Appears online after target stops | Heartbeat age and state projection | Treat configured hostname as liveness |
| Cannot connect after reboot | Runtime/service manager before login, FileVault state, local recovery | Disable FileVault/auto-login without approval |
| Old UI persists | Build ID, worker waiting, safe update state, immutable asset identity | Force-reload active remote sessions |

## Safe support bundle
Include timestamp/timezone, build IDs, versions, coarse error code, node alias, anonymized log sample and test steps. Exclude JWTs/cookies, credentials, raw intent IDs, keys, clipboard, frames, private desktop screenshots, environment dump and full tunnel config. User reviews the bundle before sharing.

## Backup/restore
Back up source repository, signed/pinned build references, sanitized config schema, metadata database if used and runbooks. Secret store backup is separate and encrypted under the owner's control. Do not bake credentials into a zip.

A metadata backup does not preserve live sessions. Restore invalidates sessions and rechecks target hostname/audience, runtime and permissions. Do not clone one machine's identity/Tunnel credentials onto a different desktop and rely on connector load balancing. After restore, run auth-deny, intent-race, view-only and real keyboard smoke tests before public access.

## Maintenance/revocation
Monitor pinned project's official security advisories and runtime dependencies; do not auto-upgrade remote protocol dependencies in production without testing. Avoid automatic restart during an active session unless applying a deliberate emergency revoke. Provide a visible maintenance banner and a clean controlled disconnect.

Local emergency stop must work independently of the web session. Document exact commands for the actual service manager only after verifying installed paths/names. Stop the new gateway/Tunnel route, invalidate memory sessions, rotate compromised credentials through the owner and restore only approved configuration. Keep alternate access until recovery tests pass.
