# Current Mac latest-service deployment

Date: 2026-10-04 (Asia/Singapore). Source: `bdbd239effa2f19c5624b977dc6c5016071b16c6`, confirmed against GitHub main. Work branch: `codex/deploy-current-pc-20261004`. No application source changes, commit, push, Access-policy changes, Tunnel changes, host permission changes or reboot were performed.

The existing `rdg-current-mac-pilot-gateway-1` was replaced with exact ARM64 image `sha256:513fe8ebfbd6c71dd4578e8e7919d7fdf386138b74217f321448c9f401ab7c7b`. It serves web build `d3d201de7cabda02`, including the compact workspace toolbar and scoped connection recovery. Its JAR, index, worker and build-file digests match the freshly built workspace. The JAR remains byte-identical to the previous service; the latest changes are web assets.

The gateway is healthy, non-root, read-only and published only on `127.0.0.1:32120`. Existing OWNER_SETUP and trusted-browser configuration was retained exactly. The metadata/key mounts, official-source guacd and eight unrelated containers were preserved, verified by container IDs, image IDs and start times. Before replacement, the gateway's established connections to guacd port 4822 numbered zero; this measures upstream connections, not all browser tabs or pending intents. Restart invalidates in-memory app sessions; clients must revalidate. It does not force a browser reload or silently activate a service worker.

## Verification

- Node/reference tests: 109 PASS.
- Java unit/integration tests: 104 PASS; no failures/errors/skips.
- Runtime dependency verification: 11 pinned JARs, extracted SQLite native libraries, official Guacamole JS and 393 locked OS package records PASS.
- Browser regression: 18 PASS; login/manifest regression: 8 PASS; connection/workspace regression: 19 PASS. Chrome 154.0.8037.93; disposable local fixtures, not actual Mac desktops.
- Metadata backup/restore: 3 PASS.
- Exact-image isolated container startup, SQLite and missing-identity denial: PASS.
- Live checks: 14 PASS using normal browser User-Agent, including missing/forged identity, Host/Origin, bootstrap and WebSocket refusal, scoped cleanup refusal, unsigned login refusal, deployed worker digest and public anonymous Access redirects.
- Gateway health and dedicated connector ready: 200; connector has four healthy edge connections. No connector restart was needed.

The first Python-default User-Agent check returned public Cloudflare 403 rather than the expected 302; retained separately in `live-checks-default-ua.json`. Nonsecret response classification and the same requests with Mozilla/5.0 confirmed browser-style anonymous requests receive Access redirects. This does not prove the exact edge rule responsible for the default-client rejection and was not fixed by changing policy.

The first sandboxed Java build could not bind loopback sockets. Re-running with authorized local socket access passed all 104 tests; no code or test assertions were weakened. Original historical browser-result receipts were restored after saving the new receipts in this directory.

## Operation and rollback

Open https://remote.gmb01.xyz through the existing owner login/trusted-browser flow. If an installed PWA offers an update, end desktop sessions and use its explicit update action. Authentication codes and desktop passwords stay in the browser, never chat.

The only private environment change was GATEWAY_IMAGE. The original owner-only file is saved as `~/.cloudflared/rdg-current-mac-pilot/owner-setup.env.before-deploy-bdbd239-20261004`. Rollback uses the preserved previous image `sha256:9b81c30a0fae9f77a8fe2a26612376935a627a2a91c15088070a9ba35d47b806`: restore that environment backup to `owner-setup.env`, then run the current `deployment/compose.owner-setup.yaml` with the explicit local Docker socket, project `rdg-current-mac-pilot`, that environment file and `up -d --no-deps --pull never gateway`. Preserve guacd, volumes and Access protection. This rollback procedure was prepared, not executed.

## Limits

This completes the requested local service update. Positive owner login, actual Mac display/input, Windows/Safari/iOS, external-network positive connection and sleep/reboot acceptance were not exercised. The broader release matrix remains BLOCKED. No new vulnerability scan was run; existing vendor/advisory findings remain unresolved release work. No desktop password, encryption key, owner cookie, JWT, screenshot or input payload was read or saved. The active service uses its inherited optional trusted-browser behavior; this update did not authorize or implement an authentication-policy migration.

Deployment, runtime checks, browser receipts and artifact hashes are recorded alongside this report.
