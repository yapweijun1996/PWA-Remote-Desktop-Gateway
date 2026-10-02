# Implementation and acceptance record

This supplements the original design pack. The implemented local pilot is reviewable on `codex/production-gateway`; public/real-Mac release remains BLOCKED. No personal target, Cloudflare account/policy, Tunnel, host permission, company device or existing MCP service was modified.

## Ownership and transport

- `Config`: strict server-owned node/target configuration, exact HTTPS origin/Access issuer/audience/owner and owner-only secret loading. VNC protocol/address/port/password are never accepted from the browser.
- `AccessVerifier`: Nimbus RS256 verification, fixed issuer JWKS, exact audience/email and signed subject/type/time claims. It rejects token-supplied discovery URLs, duplicate/invalid keys, missing assertions and unknown keys during failed refresh. JWKS fetch has size/deadline bounds, a five-minute cache and bounded refresh rate.
- `Sessions`: one-process authority for hashed opaque cookies, CSRF, 30-second intents, atomic consume, one controller/two desktop limit, monotonic idle/absolute deadlines and update reservations. Restart invalidates all transient authorization.
- `GuacdConnector` / `DesktopEndpoint`: official Guacamole Java configuration/handshake, parser, reader/writer and tunnel. The javax WebSocket endpoint adds input allowlisting, cleanup and backpressure. Client frames are limited to 48 KiB; upstream instruction budget is 8 MiB rather than using the input limit for screen data. Guacd is never host-published.
- `Audit`: fixed SQLite metadata fields, hashed user reference, 30-day/10,000-entry retention, no arbitrary payload field. The stored node ID prevents restoring another node's database unnoticed.
- `web/src/`: vanilla production UI and official Guacamole browser objects; reference ownership logic is deliberately reused as a pure library, not treated as a transport/security adapter.

Absolute lifetime is min(verified Access expiry, app bootstrap + 60 minutes); input idle is 15 minutes. Heartbeat/video traffic cannot renew input activity. A 250 ms server scheduler and inline instruction checks enforce lifetime independently of the browser. Logout and read-only abuse close the browser and upstream; failed upstream cleanup blocks fresh connections/updates until operator recovery. The session owns the browser before upstream negotiation, so a failed handshake cannot leave an open WebSocket. The display pump reads official parsed instructions and closes both ends on terminal error/disconnect; it does not wait for a cooperative browser. These failure paths passed against the actual pinned guacd daemon in a network-none namespace with no VNC listener. Actual target revocation latency still needs measurement.

## ADR-007: bounded javax endpoint

Tomcat 9.0.122 provides the javax APIs used by Guacamole 1.6.0. Both compile and real WebSocket fixture upgrades passed. Do not replace it with a Jakarta-only runtime without an explicit migration/interoperability test. Monitor its support horizon and current vendor advisories before production.

The official WebSocket example's background read loop produced an uncaught close/send race in local tests. The application therefore owns a small javax Endpoint that uses the official Guacamole Java transport and parser. It catches close races, releases reader/writer ownership and sanitizes failure reasons. It does not implement VNC or screen codecs.

The official JavaScript WebSocketTunnel always appends `?` even with empty connection data. The gateway permits the empty query only; any nonempty query remains denied. No bearer credential or upstream selection parameter is placed in the URL.

## ADR-008: shared cookie, fixed deadline

Same-origin tabs share the host-only Secure/HttpOnly `__Host-rdg` cookie. Bootstrapping a second valid tab reuses the existing owner-bound session and CSRF without extending its deadline; rotating it would unexpectedly revoke the first tab. An identity mismatch is rejected. Expired/re-authenticated sessions start fresh. Node logout deliberately ends that node's app transports; it does not claim Access/fleet logout.

## Input and clipboard

Guacamole.Keyboard is the single normalizer bound to a fresh focused capture element. Command/Option/Control keysyms come from explicit node calibration. Control is never globally mapped to Command; only observed physical Left Alt is eligible in the opt-in profile. Right Alt/AltGr is preserved. Ownership is counted both by logical source and encoded keysym, including a target that collapses left/right aliases.

Blur, hiding, pagehide, profile change, explicit pause/release, scaling and disconnect release keys/buttons; lost events are never replayed. Virtual controls use logical ownership directly. Pointer events originate on the official display element, are clamped to scaled bounds and are converted by the official client exactly once. Touch is explicitly trackpad-like; direct touch and remote resolution changes are not advertised.

Direct local IME into arbitrary Mac apps is unverified and disabled. Composition pauses input. The explicit Text / Clipboard panel accepts local IME as a separate fallback; actual Chinese/punctuation/emoji clipboard capability and remote IME still need real-Mac tests. Clipboard is off by default, plain text and limited to 16 KiB in both UI directions; server write policy also enforces the limit. Enabling it requires a new connection. A protocol acknowledgement is not proof that an arbitrary target app received/pasted the full text.

## PWA lifecycle

The build fingerprints all JS/CSS/icons, vendors Guacamole locally and derives worker/cache version from code and policy bytes. Only a generated same-origin GET safelist and generic offline page may cache. Redirects, wrong MIME, private/no-store responses, queries and unknown resources are excluded. API/identity/viewer HTML, tokens, frames and clipboard never enter offline storage.

A new worker waits. Clicking Update first checks node sessions; the waiting worker must then acquire a server reservation atomically with intent/controller state. Pending intents, another active/suspended tab or uncertain cleanup defer activation. The 20-second reservation blocks new intents/upgrades. Only the accepting tab reloads; other tabs receive a visible prompt. Offline/failure cannot authorize activation, and timeouts remove the loader and permit retry. No forced-update API exists.

Viewer safety controls remain visible. Smart hide-on-scroll and scroll-to-top are N/A for the short launcher and no-scroll viewer. The native canvas has accessibility limits; controls retain focus labels, 44 px targets, safe areas and page zoom. Real Safari/iOS install, notch/rotation and 200% browser zoom remain hardware/browser acceptance gates; Chromium viewport and text-zoom checks are narrower evidence.

## Configuration and deployment

See `deployment/README.md`. The Dockerfile runs UID/GID 10001, pins the multi-architecture JRE index and packages only production classes/assets. Actual secret file ownership/readability must be checked for that UID on the approved Mac; Compose secret mount permission behavior is not assumed. Do not make the secret group/world-readable. Native deployment defaults to loopback; a container binds internally while Compose publishes only host loopback port 32120.

The process health endpoint reveals only liveness. It does not dial VNC or prove desktop readiness. Bookmarks remain UNVERIFIED and open top-level independent nodes. Access OTP remains provider-hosted; the app has no password/OTP bypass. VNC/macOS login credentials are separate and never exposed to the controller. Legacy VNC authentication/transport limitations and actual LAN/IPv6 isolation remain P0 gates.

An app image update/restart invalidates all transient sessions. Perform image/runtime upgrades only at an explicitly ended session boundary or an approved emergency stop; never restart existing services to make a test pass.

## ADR-009: native SQLite in a read-only container

The first ARM64 image failed to start with a read-only root filesystem and `noexec` tmpfs: SQLite JDBC could not load its extracted native library. Maven now extracts only the Linux ARM64/AMD64 libraries from the pinned, digest-verified JDBC artifact. The image selects the matching library, stores it in immutable `/app/lib`, and passes `org.sqlite.lib.path`. The dependency verifier also checks the extracted library hashes. This preserves the `noexec` temporary filesystem and non-root runtime. The isolated ARM64 image passed SQLite initialization, health and missing-JWT rejection without a host port or target connection. AMD64 container execution remains unverified.

## Backup, restore and rollback

`python3 scripts/metadata-backup.py --source /private/path/metadata.sqlite --output /private/backup/metadata.sqlite --expected-node <node-id>` uses SQLite online backup, integrity checks, exact node binding, 0600 files and atomic same-directory replacement. The destination directory must already be owner-only. It excludes secrets, config and live sessions. The same command restores to a stopped node's intended database path; first preserve any old database according to owner custody policy.

Tests restored a disposable database, compared a known audit row, checked permissions and refusal of symlinks/wrong-node/unsafe-directory cases. This is not actual host recovery acceptance. Secret backup is separate and owner-controlled; no private-key/credential backup was made.

Rollback: end sessions, stop only this project's gateway/guacd, restore the recorded image/config diff, verify deny/replay/read-only/keyboard behavior, then restore only its approved route. Preserve unrelated tunnels/processes and alternate access. Uninstall does not automatically delete volumes/secrets.

## Release gates and source integrity

Real target approval, OS/build/runtime inventory, VNC auth, six modifier calibrations, firewall/LAN/IPv6 tests, macOS/Windows/Safari/Edge/iOS matrix, external network, lock/sleep/lid/FileVault/restart and approved rollout remain BLOCKED. Local production tests are labelled separately in the acceptance matrix.

The untouched main checkout's original handoff integrity command reported a missing `.gitignore` referenced by `MANIFEST.sha256`. Its other state was preserved; this branch does not weaken that historical check. The implementation has its own artifact/dependency hashes and verification report.
