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

## ADR-010: locked OS patches and supported-OS guacd

The local image scan found a fixed OpenSSL vulnerability in the pinned JRE base. The gateway now installs only `libssl3` 3.0.2-0ubuntu1.30 from an architecture-specific digest lock, fixing the six reported OpenSSL instances in [USN-8847-1](https://ubuntu.com/security/notices/USN-8847-1). It preserves the JRE index and all Java/application artifacts.

The published guacd 1.6.0 image uses Alpine 3.18, an unsupported branch. Its official Dockerfile retains that base for an OpenSSL 1.1 compatibility dependency used by RDP. This project only exposes server-configured VNC. `deployment/Guacd.Dockerfile` therefore builds signature-verified Apache 1.6.0 C source with the explicit local password policy described in ADR-011 on pinned Ubuntu 24.04 with VNC/SSL/WebP enabled and RDP/SSH/Telnet/terminal/Kubernetes/input-log/video tools disabled. This is a local official-source build, not an Apache-published image. The production daemon runs UID/GID 10001; Compose uses read-only root, noexec temporary space, dropped capabilities, resource bounds and disabled daemon logs. No native protocol or codec is reimplemented.

Six ARM64/AMD64 package locks cover the gateway security patch and daemon build/runtime dependencies (393 package records). APT validates Ubuntu signed repository metadata during resolution; separate SHA256 locks verify each archive before `--no-download` installation. An extra/missing artifact, changed digest or unavailable pinned version refuses the build. Package sources and lock digests are in `deployment/guacd-provenance.json`; `verify:dependencies` checks their consistency. A disposable negative check proves a tampered digest refuses installation before changing the original library.

The supported-OS ARM64 daemon passed its native VNC argument contract, control/view failure teardown and non-root/VNC-only inventory checks. Both final images were scanned with attestation-verified local Trivy 0.75.0. Ubuntu-priority High/Critical and fixed-version counts are zero; all 29 gateway and 18 guacd Medium/Low package-CVE instances remain recorded without suppression. Some Medium priorities have High CVSS base scores, including [PCRE2](https://ubuntu.com/security/CVE-2026-86145) and [zlib](https://ubuntu.com/security/CVE-2026-85091). Ubuntu lists missing/deferred packaged fixes; application reachability is not certified. Public release still requires vendor risk/patch review and real-target acceptance. AMD64 package resolution is narrower evidence than running its final image. No deployment occurred.

## Backup, restore and rollback

`python3 scripts/metadata-backup.py --source /private/path/metadata.sqlite --output /private/backup/metadata.sqlite --expected-node <node-id>` uses SQLite online backup, integrity checks, exact node binding, 0600 files and atomic same-directory replacement. The destination directory must already be owner-only. It excludes secrets, config and live sessions. The same command restores to a stopped node's intended database path; first preserve any old database according to owner custody policy.

Tests restored a disposable database, compared a known audit row, checked permissions and refusal of symlinks/wrong-node/unsafe-directory cases. This is not actual host recovery acceptance. Secret backup is separate and owner-controlled; no private-key/credential backup was made.

Rollback: end sessions, stop only this project's gateway/guacd, restore the recorded image/config diff, verify deny/replay/read-only/keyboard behavior, then restore only its approved route. Preserve unrelated tunnels/processes and alternate access. Uninstall does not automatically delete volumes/secrets.

## Release gates and source integrity

Real target approval, OS/build/runtime inventory, VNC auth, six modifier calibrations, firewall/LAN/IPv6 tests, macOS/Windows/Safari/Edge/iOS matrix, external network, lock/sleep/lid/FileVault/restart and approved rollout remain BLOCKED. Local production tests are labelled separately in the acceptance matrix.

The untouched main checkout's original handoff integrity command reported a missing `.gitignore` referenced by `MANIFEST.sha256`. Its other state was preserved; this branch does not weaken that historical check. The implementation has its own artifact/dependency hashes and verification report.

## Bounded localhost view test

On 2026-10-03 the owner approved localhost testing on the current development Mac. Read-only preflight found its existing Screen Sharing/RFB listener and classic VNC authentication, without changing settings or trying a password. This approval covers the local test; public routes, Access/Tunnel policy, firewall, Screen Sharing permissions and reboot still require separately scoped authorization.

For the first actual VNC connection, use the separate test-classpath `LocalMacViewMain` via `npm run test:local-mac-view`, with a protected local `RDG_LOCAL_VNC_SECRET_FILE` and the existing Playwright/Chromium paths. Its immutable verified guacd image connects to the current Mac through server-owned `host.docker.internal:5900`; an ephemeral loopback guacd port connects the native Java harness to that container. Its local HTTPS proxy provides a signed ephemeral test assertion to the unchanged gateway validator. It cannot establish Cloudflare account/policy acceptance. A connector guard prohibits control and clipboard before upstream access, and view mode provides no input. Empty test keysyms avoid falsely declaring a calibration; production configuration still refuses absent calibration.

Only connection state, nonzero display dimensions, errors and disconnect/lease cleanup may enter evidence. Do not save the real desktop, clipboard, input or full protocol payload. Delete a task-created temporary password file after the run; preserve user-supplied files unless the owner authorizes deletion. A failed authentication is a blocker to resolve with the owner, not a reason to retry guessed passwords, read Keychain or change host permissions.

## ADR-011: explicit password authentication for macOS VNC

An approved localhost view test reached the current Mac but failed before display. A network-none synthetic peer advertising the observed native Screen Sharing security list reproduced the actual image selecting ARD type 30 before VNC type 2. [LibVNCClient0.9.14](https://github.com/LibVNC/libvncserver/blob/LibVNCServer-0.9.14/libvncclient/rfbproto.c) chooses the first supported server-offered type when no client allowlist exists; the signed Guacamole1.6.0 source enables its username/password callback even when this gateway supplies only a separate VNC password. ARD and the application's password-only credential model are incompatible. This does not establish that the supplied password was wrong.

Guacamole1.6.0 has no VNC security-types connection parameter. The recorded local integration policy uses the maintained [SetClientAuthSchemes API](https://libvnc.github.io/doc/html/group__libvncclient__api.html) for type2, refuses allocation failure, clears the generic account-credential callback, and verifies the completed authScheme after initialization because legacy3.3 bypasses list negotiation. The rejected successful-initialization path frees framebuffer/raw buffers as upstream Guacamole teardown does. Authentication, encryption primitives and display codecs remain in maintained libraries. No native password is obtained from macOS, no VNC proxy is introduced, and no host settings are changed.

`deployment/guacd-provenance.json` retains the signed Apache archive and records the policy script hash, original and modified C file hashes and reason. `apply-vnc-password-policy.py` refuses altered source before mutation. Treat this as an official-source build with a local integration modification; never describe its C source as unmodified. Five exact-image synthetic cases select2 when ARD/None precede2, refuse ARD-only/None-only, and reject3.3 None with no display. Those peers send no password challenge or pixels. Legacy ARD callback disabling has static review evidence only; no DH/account credential exchange was tested.

Classic VNC password authentication and desktop traffic retain the limitations of the existing private-VNC design. This policy does not prove LAN/IPv6 isolation, stronger authentication, real Access issuance, modifier calibration or public readiness. Re-run the official-daemon failure-path tests, exact-image policy tests, package scan and approved real-Mac view test for each reviewed image change. The current raw package scan uses the same recorded cached advisory snapshot; it is not a new zero-vulnerability certification.

## ADR-012: bounded test-only native failure diagnostics

The corrected-image localhost view retry still failed at VIEW_CONNECTION without a desktop. The public TARGET_UNAVAILABLE state and native Guacamole abort are generic; neither proves an authentication cause. Reading signed/pinned source showed that the native VNC callbacks use syslog. The optional QA interposer matches whole bounded calls against exact phrases from the pinned Apache1.6.0/LibVNCClient0.9.14 sources, wipes the formatted buffer and emits only fixed labels. Unknown/server-selected text and truncated/multiline messages are discarded. This helper is test-only and never linked into the production image or transport.

The constant file sink is opt-in, owner-only on the test container's private tmpfs, append-only and capped at64KiB. It rejects symlinks, non-regular files, unsafe permissions, hardlinks and wrong owners and uses nonblocking open/lock. The finite host capture ignores stderr, validates the Docker child's exit status and rejects unavailable metadata. Builder/source/library identities are checked before service startup. The immutable locally reviewed compiler is reused with networking disabled; changing build network mode can invalidate cached APT steps and is not a substitute for a locked compiler.

An earlier Docker attach/FIFO collection attempt did not finish within its bound. Its browser failure remains recorded separately, with incomplete diagnostic harvesting. The cause of that attach lifecycle failure is UNKNOWN: the inspected foreground Guacamole path does not establish stderr closure. The file sink removes that stream-completion dependency. A static-review finding then exposed a POSIX pipeline hiding Docker read failures; explicit child status checks and negative tests resolved it. Root orchestration uses POSIX shell and task-specific exit variables so cleanup is not interrupted by zsh's readonly `status` variable. One earlier cleanup interruption was immediately corrected and its temporary credential removed; no credential is retained.

Final validation:279 native classifier/file cases on both reviewed compiler and exact production image ABI, six Node metadata/provenance/process-status cases, and network-none official guacd failure integration PASS. Independent bounded source review has no remaining actionable findings. Static source review confirms the VNC callbacks format and syslog native messages without a timestamp prefix. Unknown RFB3.8 server-reason text is deliberately dropped; host discardedLines counts only input surviving that native filter, so zero does not mean every native call matched. The final actual-Mac view attempt still failed and captured only NATIVE_CONNECTION_FAILURE_UNCLASSIFIED. No real authentication/display, keyboard calibration, real Access identity or release acceptance is inferred. Never retain raw logs to expand this evidence and never retry guessed passwords.

## ADR-013: production desktop blocking for an authenticated status pilot

Publishing the loopback protocol fixture would misrepresent a desktop connection and its injected test identity would bypass real Access issuance. The real current-Mac view attempt is still FAIL/UNKNOWN, and no desktop credential or observed modifier calibration is retained. A separately authorized public auth/status test therefore uses an explicit immutable production `RDG_DESKTOP_POLICY=BLOCKED` setting. FULL remains the default with all existing credential/calibration checks; unknown policy values refuse startup. BLOCKED accepts omitted calibration/credential references but never reads a credential, allocates a connection intent/desktop lease or opens an upstream socket. API/WebSocket policy guards and clipboard-enablement refusal enforce the limit independently of the disabled UI.

The minimal configuration has its own schema and gateway-only Compose template. There is no test signer, guacd, guessed modifier map or fabricated ONLINE state. All production JWT, owner, Host, Origin and CSRF checks remain unchanged. Real Access integration must be observed separately through the exact approved hostname. A successful login/status pilot does not satisfy desktop, input, cross-platform, recovery or release gates. An additive dedicated Tunnel preserves existing routes and recovery services; Access protection precedes public DNS publication and is retained until the route is removed during rollback.

## ADR-014: owner self-test and one-year trusted browsers

The owner explicitly requested immediate desktop self-test and one-year remembered browsers on the existing personal host. [Owner setup and device trust](18_OWNER_SETUP_AND_TRUSTED_DEVICES.md) defines the opt-in extension to ADR-013. Default FULL/BLOCKED modes remain unchanged. OWNER_SETUP stores the owner-entered VNC credential encrypted and exposes the standard keyboard map as UNVERIFIED_TEST_PROFILE; enablement is not Mac compatibility evidence. In trusted mode Access remains the signed enrollment authority at /login, while revocable server-verified browser cookies authorize protected APIs/WebSockets and live transports. The Cloudflare migration must be recorded in the deployment receipt before claiming it active.
