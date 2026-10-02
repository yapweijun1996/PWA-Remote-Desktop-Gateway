# Local implementation acceptance report

Recorded: 2026-10-03, Asia/Singapore (UTC+08:00). Source revision: `a48efff60b295444077ac972dd1e19fb7d9075ae` on `codex/production-gateway`. Evidence is committed separately. Original `main` remains unchanged at `d0ce352b7ad76e6b427f68488c40346d0601d491`.

**Result: the local implementation is built and tested; real-Mac/public release is BLOCKED.** The delivered code includes the Java gateway, vanilla JavaScript PWA, official Guacamole integration, security tests, pinned runtime artifacts, ARM64 image, protected metadata backup and deployment/recovery instructions. No actual target Mac, Cloudflare account/policy, Tunnel, host permission, firewall, Screen Sharing, reboot or existing service was changed. Nothing was pushed or publicly published. This report contains implementer verification; no independent reviewer sign-off is claimed.

## Evidence levels

| Layer | Result | Evidence and boundary |
|---|---|---|
| Reference and production JavaScript | PASS: 84 tests | [node-tests.txt](node-tests.txt); original 74 reference tests unchanged, 9 input and 1 atomic-artifact test |
| Implemented Java gateway | PASS: 38 tests, 0 failures/errors/skips | [gateway-tests.json](gateway-tests.json); real local HTTP/javax WebSocket runtime, signed fixture identities and a disposable official-protocol peer |
| Production UI in Chromium | PASS: 11 scenarios | [browser-results.json](browser-results.json); Chromium 153.0.8010.12 / Playwright 1.62.1 on macOS; 0 JavaScript errors, 0 unexpected console errors, 3 expected offline fetch errors |
| Metadata backup/restore | PASS: 3 tests | [backup-tests.txt](backup-tests.txt); disposable SQLite data, node binding, owner-only files, symlink and unsafe-directory rejection |
| Linux ARM64 image | PASS | [container-tests.txt](container-tests.txt); non-root, read-only root, noexec tmpfs, dropped capabilities, SQLite initialization, health, missing-JWT HTTP 401 and missing-config startup refusal; no network/ports or real VNC connection |
| Actual official-source guacd failure path | PASS: 4 checks | [official-guacd-tests.txt](official-guacd-tests.txt); native VNC argument contract, control/view requests close after unreachable-target failure and non-root/VNC-only Ubuntu 24.04 inventory; no real VNC desktop or Mac |
| Native password policy | PASS:5 synthetic cases and2 source integrity checks | [security selection](vnc-security-results.json), [source integrity](native-policy-tests.txt); corrected exact image; no password challenge or real authentication |
| Test-only native diagnostics | PASS:279 native +6 Node and isolated daemon integration | [privacy/ABI results](native-diagnostics-tests.json), [network-none official-daemon flow](native-diagnostics-integration.json); fixed labels only, explicit failed-capture refusal; no real target in these checks |
| Dependency/build identity | PASS | [artifacts.json](artifacts.json), runtime lock and vendor provenance; 194 source/output/evidence digests verified; 11 runtime JARs, SQLite natives, official browser artifact and 393 Ubuntu package records in six locks verified |
| OS package digest refusal | PASS: 1 negative check | [os-package-lock-tests.txt](os-package-lock-tests.txt); mutated package digest refuses installation before changing the original libssl3 |
| Local ARM64 OS/JAR scan | COMPLETED; remaining findings retained | [image-scan.json](image-scan.json); gateway 13 Medium/16 Low, guacd 12 Medium/6 Low; no Ubuntu-priority High/Critical or fixed-version rows; some Medium priorities have High CVSS scores |
| Historical handoff manifest | FAIL | Untouched-main `npm run verify` returns `Missing/unreadable: .gitignore`; original archive manifest is preserved |
| Real Mac/official guacd VNC interoperability | First and corrected attempts FAIL | [Localhost test report](LOCALHOST_TEST_REPORT.md): current-Mac identity/route preflight PASS; ARD selection reproduced and corrected; corrected real view remains TARGET_UNAVAILABLE with a generic native failure label, cause UNKNOWN; no display/control acceptance |
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
- Local image/index ID: `sha256:f1994501e0d375c16c7e6c3993b6c60de2cabcc5a6126ca8e8ca3218caa34ca1`; Linux ARM64. Local tag is a convenience only; it was not published.
- Gateway image manifest: `sha256:33e9850d94ba9b6b0ceb38dc2b6ca4ab177e1cbfbced6ec3709a8665947aa42d`.
- Official-source guacd local image/index ID: `sha256:3cbaad3b2d040ddfe1905a99b94c5b61448f2f7358e24bb1e4a2838f38daf06f`; manifest `sha256:f76af7eeb34b5af5ec1936711342588ed3ceea5b1918b4a35ea7f394cc417615`, Ubuntu 24.04 ARM64, VNC-only, explicit recorded local authentication policy, unpublished. The earlier unmodified-source image is retained separately in the ledger.
- Guacamole Java/JS/guacd 1.6.0; Tomcat 9.0.122; build JDK 17.0.17; container Temurin 17.0.20.1+1; Maven 3.9.16; Node 23.10.0 / npm 10.9.2; Docker daemon 28.3.0.
- Current localhost test computer: macOS 26.6.2 (25G83), Darwin ARM64. The owner approved bounded testing on 2026-10-03; no production deployment or settings change is authorized.

Production JAR inspection found no test/fixture/debug classes. The production image contains the production JAR/assets and the pinned SQLite native library; fixture edge/protocol code stays on the test classpath. The Compose blueprint parses with fictional operator settings but has not been deployed.

Official Guacamole Java and JavaScript artifacts were signature-checked against the [Apache release signing keys](https://downloads.apache.org/guacamole/KEYS), fingerprint recorded in [vendor provenance](../../web/vendor/provenance.json); no independent Web-of-Trust certification is claimed. Runtime coordinates and SHA256 values are in [dependencies.lock.json](../../gateway/dependencies.lock.json). The public-coordinate OSV query returned no advisories for those 11 dependencies; [dependency-advisories.json](dependency-advisories.json) is not a container OS vulnerability scan or proof of absence of vulnerabilities. The image OS scan and remaining vendor issues are recorded below; recheck before a public pilot.

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
docker build --platform linux/arm64 -f deployment/Guacd.Dockerfile -t rdg-guacd:local-verified .
npm run test:os-lock
npm run test:container
npm run test:official-guacd
npm run test:vnc-security
npm run verify:artifacts
```

The browser check requires an existing Playwright library and Chromium executable. The verified invocation set `RDG_PLAYWRIGHT_MODULE` to the bundled Playwright module and `RDG_TEST_CHROMIUM` to Chromium 153.0.8010.12. No frontend runtime npm dependency, CDN script, tracker or production authentication bypass was added. `verify:artifacts` compares this recorded source/output snapshot; a later reviewed source/build change needs a new evidence ledger. A rebuilt image may have a different attestation/index identity; inspect it separately rather than assuming the recorded tag is immutable.

`qa/test-container.sh` creates and removes only its random fixture volumes/container. The browser launcher similarly removes its loopback processes and temporary key/certificate/assertion. Manual debugging fixtures, old browser session and debug classes were removed. Useful ignored build outputs and local Maven cache remain.

## Failures resolved and remaining risks

The read-only ARM64 image initially refused startup because SQLite JDBC tried loading a native library from noexec tmpfs. The fixed image selects a digest-checked native library from immutable `/app/lib`, preserving non-root/read-only/noexec restrictions. Container regression passed. [ADR-009](../../docs/17_IMPLEMENTATION_AND_OPERATIONS.md) records the decision; AMD64 execution remains unverified.

An additional official-daemon regression exposed two transport cleanup gaps. The browser is now registered with the session before upstream negotiation, and upstream `error`/`disconnect` instructions cause server-owned teardown even when the browser ignores them. Three added Java regressions and the real guacd failure-path check passed; the check was repeated successfully against the supported-OS official-source build. No Mac compatibility is inferred.

The approved current-Mac view attempt failed before display. The original native daemon selected ARD30 in a synthetic reproduction of this Mac's advertised offer list, although the gateway stores a separate VNC password. The explicit integration policy now uses official LibVNCClient APIs to select VNC2 and reject other completed schemes. Five synthetic cases and four final-daemon checks pass; corrected-image real retries still fail at VIEW_CONNECTION/TARGET_UNAVAILABLE. The final diagnostic capture completed with NATIVE_CONNECTION_FAILURE_UNCLASSIFIED only; no authentication cause or real desktop success is inferred. A bounded independent static review found no remaining actionable issue in the native policy, provenance or six pilot/probe files. Its only new evidence-accuracy finding was corrected: the legacy case must actually send ServerInit and observe closure before PASS. This static review is not real-device or release sign-off. [ADR-011](../../docs/17_IMPLEMENTATION_AND_OPERATIONS.md) and [the localhost report](LOCALHOST_TEST_REPORT.md) record the limits.

The optional diagnostic collector is test-only and leaves the production image/JAR/frontend unchanged. It passed279 classifier/file-safety cases on the pinned compiler and production-image ABI, six Node privacy/provenance/process-status checks, and actual official-daemon network-none failure integration. Bounded independent source review confirmed the explicit Docker capture-status fix; no remaining actionable finding in that scope is real-device/release sign-off. Earlier incomplete attach harvesting and a root cleanup interruption are retained and accurately described in the localhost report and ADR-012.

Other local regressions fixed during implementation include the official sample endpoint's close/send race, Guacamole's empty `?` WebSocket query interoperability, same-cookie second-tab bootstrap revocation, first-worker prompt timing, modifier alias refcounts/composition release, and wrapped mobile headers overflowing the workspace. Final relevant checks passed; none establish real-target compatibility.

The OS audit additionally found six OpenSSL package findings in the pinned JRE base, including CVE-2026-84782. The digest-locked Ubuntu libssl3 3.0.2-0ubuntu1.30 patch resolved all six. The published guacd image uses unsupported Alpine 3.18.12; a signature-verified Apache 1.6.0 source build with the recorded explicit local password-authentication modification now supplies only VNC on pinned Ubuntu 24.04. The final daemon passed its native argument/failure cleanup and non-root/VNC-only inventory checks. [ADR-010](../../docs/17_IMPLEMENTATION_AND_OPERATIONS.md) records the packaging decision.

[Trivy source/attestation receipt](scanner-provenance.json), [gateway raw scan](gateway-image-trivy.json), [current guacd raw scan](guacd-password-policy-trivy.json), [earlier unmodified-source scan](guacd-image-trivy.json) and [summary](image-scan.json) retain exact image IDs, database dates and every finding. Scans used only local image access in a minimal environment; nothing was uploaded. The authentication-policy image used the same cached advisory snapshot, with no database refresh. Final Ubuntu-priority High/Critical and fixed-version counts are zero, with 29 gateway and 18 guacd Medium/Low package-CVE instances still present. Ubuntu lists some unresolved/deferred fixes, and some Medium priorities have High CVSS scores. This is a limited package inventory/advisory check, not exploitability certification or a public-release pass. No findings were suppressed. Docker Scout required account login and produced no report; the local Trivy fallback completed.

P0 remaining: real-Mac runtime validation and protected credential custody; successful official guacd-to-Screen-Sharing authentication; six modifier calibrations; LAN/IPv6 isolation; exact real Access/owner policy; actual supported-browser/controller paths; and resolution/assessment of remaining vendor advisories before a public pilot. P1 remaining: Chinese/dead-key/emoji path, retina pointer/clipboard behavior, actual PWA installation/update/recovery, second-node independence, external-network harmless editor tasks, measured performance and owner-approved rollback/recovery. No FPS/latency claim is made.

## Next authorized boundary

The owner approved bounded localhost testing on the current Mac on 2026-10-03. Read-only preflight confirmed an existing local RFB listener with classic VNC authentication. Provision VNC secrets locally outside Git and chat; the first view-only attempt used an ephemeral signed test identity and has separate failure evidence. Its independently reproduced authentication-selection mismatch is corrected in the exact recorded image. Corrected-image real view retries still FAIL; the final fixed-label capture completed but only reports an unclassified native failure. The cause remains UNKNOWN and no saved credential remains. Resolve this actual interoperability prerequisite with the owner before another authentication attempt. No real Cloudflare issuance is claimed. Start with read-only host preflight and a reviewed node-specific config; perform only explicitly approved project deployment and settings changes. Public routes, Access/Tunnel changes, firewall/Screen Sharing permission changes and reboot remain outside current authorization. Then execute every required real-system row or obtain an explicit owner-approved scope reduction before release.

See [deployment runbook](../../deployment/README.md), [implementation and recovery decisions](../../docs/17_IMPLEMENTATION_AND_OPERATIONS.md), and [backlog record](../../PROGRESS.md).
