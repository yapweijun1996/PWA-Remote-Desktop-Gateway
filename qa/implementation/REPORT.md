# Local implementation acceptance report

Recorded: 2026-10-03, Asia/Singapore (UTC+08:00). Source revision: `e366e91dffb981f2b522985cf371aed5eacf4199` on `codex/production-gateway`. Evidence is committed separately. Original `main` remains unchanged at `d0ce352b7ad76e6b427f68488c40346d0601d491`.

**Result: the local implementation is built and tested; real-Mac/public release is BLOCKED.** The delivered code includes the Java gateway, vanilla JavaScript PWA, official Guacamole integration, security tests, pinned runtime artifacts, ARM64 image, protected metadata backup and deployment/recovery instructions. No actual target Mac, Cloudflare account/policy, Tunnel, host permission, firewall, Screen Sharing, reboot or existing service was changed. Nothing was pushed or publicly published. This report contains implementer verification; no independent reviewer sign-off is claimed.

## Evidence levels

| Layer | Result | Evidence and boundary |
|---|---|---|
| Reference and production JavaScript | PASS: 84 tests | [node-tests.txt](node-tests.txt); original 74 reference tests unchanged, 9 input and 1 atomic-artifact test |
| Implemented Java gateway | PASS: 32 tests, 0 failures/errors/skips | [gateway-tests.json](gateway-tests.json); real local HTTP/javax WebSocket runtime, signed fixture identities and a disposable official-protocol peer |
| Production UI in Chromium | PASS: 11 scenarios | [browser-results.json](browser-results.json); Chromium 153.0.8010.12 / Playwright 1.62.1 on macOS; 0 JavaScript errors, 0 unexpected console errors, 3 expected offline fetch errors |
| Metadata backup/restore | PASS: 3 tests | [backup-tests.txt](backup-tests.txt); disposable SQLite data, node binding, owner-only files, symlink and unsafe-directory rejection |
| Linux ARM64 image | PASS | [container-tests.txt](container-tests.txt); non-root, read-only root, noexec tmpfs, dropped capabilities, SQLite initialization, health, missing-JWT HTTP 401 and missing-config startup refusal; no network/ports or real VNC connection |
| Actual official guacd failure path | PASS: 3 checks | [official-guacd-tests.txt](official-guacd-tests.txt); native VNC argument contract, control and view requests close after unreachable-target failure; no real VNC desktop or Mac |
| Dependency/build identity | PASS | [artifacts.json](artifacts.json), runtime lock and vendor provenance; 142 source/output digests verified; 11 runtime JARs, extracted SQLite natives and official browser artifact verified |
| Historical handoff manifest | FAIL | Untouched-main `npm run verify` returns `Missing/unreadable: .gitignore`; original archive manifest is preserved |
| Real Mac/official guacd VNC interoperability | BLOCKED | No approved actual target or separate protected VNC credential/calibration record |
| Windows/macOS controller and Safari/iOS PWA acceptance | BLOCKED | Actual required controller/target combinations, physical layouts and installation/recovery tests unavailable |
| Cloudflare Access/Tunnel external pilot | BLOCKED | Exact owner/application/domain and authorized additive deployment path unavailable |
| Actual lock/sleep/lid/FileVault/restart/rollback | BLOCKED | Owner-assisted target recovery path and explicit scope unavailable |

All 64 scenarios in [acceptance-matrix.csv](../acceptance-matrix.csv) are real-system release gates and remain BLOCKED. Their notes identify missing prerequisites and narrower local coverage. This does not indicate 64 local test failures. Synthetic keyboard events and a protocol peer cannot prove a real Mac desktop, physical shortcut capture, native IME, clipboard paste or measured input latency.

## Verified local behavior

The gateway rejects missing/forged identity, wrong issuer/audience/algorithm/email/type, expired/future claims, token-controlled key URLs and invalid JWKS. It uses server-owned target configuration, owner-bound cookies, CSRF, exact Origin/Host and atomic one-use intents. Tests cover controller/intent races, replay, target injection, view-only raw input, maintenance conflicts, failed-cleanup refusal and metadata privacy. Live fixture streams close at idle/absolute expiry and logout on both browser and upstream sides. These checks prove local application policy; real Cloudflare issuance/rotation/revocation and actual guacd teardown timing still require pilot measurement.

The UI uses official Guacamole browser objects, focused input ownership, native Control, observed Left Alt opt-in, AltGr protection, calibrated modifier configuration, virtual controls, explicit bounded clipboard and truthful readiness. Blur/profile/composition/disconnect clear ownership without replay. Direct local IME is disabled with an explicit text/clipboard fallback; its actual Mac compatibility remains unverified.

Chromium checks cover a clean first worker installation, portrait/landscape workspace fitting, focus-loss pause, a second tab preserving the active session, server-authoritative update deferral, accepting-tab-only explicit reload, disconnect cleanup, five launcher widths, dark theme, reduced motion, 200% text sizing, static-only Cache Storage and generic offline navigation. Real browser zoom, device safe areas, suspended tabs and installed PWA behavior on required platforms remain open.

Only harmless protocol fixtures appear in these screenshots:

![Production launcher using a disposable protocol fixture](screenshots/protocol-fixture-desktop.png)

![Mobile production launcher using a disposable protocol fixture](screenshots/protocol-fixture-mobile.png)

## Exact artifacts and versions

- Gateway JAR SHA256: `cbdb8badd531447d83bc38d8cca47445b6f30b95f0a63d0681875a986c2f2bfd`.
- Web build: `37d1363d197142d5`. Per-file output/source hashes are in `artifacts.json`.
- Local image/index ID: `sha256:e2e995ed4b377ad7fde8e2d84741bc83bf8e7816b6362ecec4ae1575bd2e7f15`; Linux ARM64. Local tag is a convenience only; it was not published.
- Gateway image manifest: `sha256:51986e6e50d2305f3e0827d06ae27452f7c9d86045f571e8dbd2b60e054f56d4`.
- Guacamole Java/JS/guacd 1.6.0; Tomcat 9.0.122; build JDK 17.0.17; container Temurin 17.0.20.1+1; Maven 3.9.16; Node 23.10.0 / npm 10.9.2; Docker daemon 28.3.0.
- Development computer only: macOS 26.6.2 (25G83), Darwin ARM64. It was not designated as a deployment target.

Production JAR inspection found no test/fixture/debug classes. The production image contains the production JAR/assets and the pinned SQLite native library; fixture edge/protocol code stays on the test classpath. The Compose blueprint parses with fictional operator settings but has not been deployed.

Official Guacamole Java and JavaScript artifacts were signature-checked against the [Apache release signing keys](https://downloads.apache.org/guacamole/KEYS), fingerprint recorded in [vendor provenance](../../web/vendor/provenance.json); no independent Web-of-Trust certification is claimed. Runtime coordinates and SHA256 values are in [dependencies.lock.json](../../gateway/dependencies.lock.json). The public-coordinate OSV query returned no advisories for those 11 dependencies; [dependency-advisories.json](dependency-advisories.json) is not a container OS vulnerability scan or proof of absence of vulnerabilities. Recheck maintained vendor advisories and OS packages before a public pilot.

## Reproduce and inspect

Run from this isolated checkout with Java 17 and Node 22 or newer:

```sh
npm ci --ignore-scripts
npm test
npm run build
npm run test:backup
npm run verify:dependencies
npm run test:browser
docker build --platform linux/arm64 -t rdg-gateway:local-verified .
npm run test:container
npm run test:official-guacd
npm run verify:artifacts
```

The browser check requires an existing Playwright library and Chromium executable. The verified invocation set `RDG_PLAYWRIGHT_MODULE` to the bundled Playwright module and `RDG_TEST_CHROMIUM` to Chromium 153.0.8010.12. No frontend runtime npm dependency, CDN script, tracker or production authentication bypass was added. `verify:artifacts` compares this recorded source/output snapshot; a later reviewed source/build change needs a new evidence ledger. A rebuilt image may have a different attestation/index identity; inspect it separately rather than assuming the recorded tag is immutable.

`qa/test-container.sh` creates and removes only its random fixture volumes/container. The browser launcher similarly removes its loopback processes and temporary key/certificate/assertion. Manual debugging fixtures, old browser session and debug classes were removed. Useful ignored build outputs and local Maven cache remain.

## Failures resolved and remaining risks

The read-only ARM64 image initially refused startup because SQLite JDBC tried loading a native library from noexec tmpfs. The fixed image selects a digest-checked native library from immutable `/app/lib`, preserving non-root/read-only/noexec restrictions. Container regression passed. [ADR-009](../../docs/17_IMPLEMENTATION_AND_OPERATIONS.md) records the decision; AMD64 execution remains unverified.

An additional official-daemon regression exposed two transport cleanup gaps. The browser is now registered with the session before upstream negotiation, and upstream `error`/`disconnect` instructions cause server-owned teardown even when the browser ignores them. Three added Java regressions and the real pinned guacd failure-path check passed; no Mac compatibility is inferred.

Other local regressions fixed during implementation include the official sample endpoint's close/send race, Guacamole's empty `?` WebSocket query interoperability, same-cookie second-tab bootstrap revocation, first-worker prompt timing, modifier alias refcounts/composition release, and wrapped mobile headers overflowing the workspace. Final relevant checks passed; none establish real-target compatibility.

P0 remaining: approved actual-Mac identity/runtime and protected credential custody; successful official guacd-to-Screen-Sharing authentication; six modifier calibrations; LAN/IPv6 isolation; exact real Access/owner policy; actual supported-browser/controller paths; and image OS advisory review. P1 remaining: Chinese/dead-key/emoji path, retina pointer/clipboard behavior, actual PWA installation/update/recovery, second-node independence, external-network harmless editor tasks, measured performance and owner-approved rollback/recovery. No FPS/latency claim is made.

## Next authorized boundary

The next action requires the owner to identify one personal Mac and authorize a bounded local pilot/access method. Provision VNC secrets locally outside Git and chat. Start with read-only host preflight and a reviewed node-specific config; perform only explicitly approved project deployment and settings changes. Public routes, Access/Tunnel changes, firewall/Screen Sharing permission changes and reboot remain outside current authorization. Then execute every required real-system row or obtain an explicit owner-approved scope reduction before release.

See [deployment runbook](../../deployment/README.md), [implementation and recovery decisions](../../docs/17_IMPLEMENTATION_AND_OPERATIONS.md), and [backlog record](../../PROGRESS.md).
