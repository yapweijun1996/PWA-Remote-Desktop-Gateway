# Restored local implementation and current acceptance

Date: 2026-10-03 (Asia/Singapore). Branch: `codex/real-local-gateway`.

The original checkout on `main` contains the specification, prototype and reference pack. The real implementation already exists on `codex/production-gateway` at `f815571b2427551d34fbf7e85abb639bcef19069`, although its old managed checkout is absent. This branch integrates that implementation with the refreshed handoff at `96bc1331015ff5c8e3aae6049e35f10ee3c812d1`. It preserves the handoff reference modules, existing services and current strict AGENTS.md authentication contract. The initial conclusion that the entire project lacked a backend was incomplete: it described only `main`.

The resulting production code contains signed Access JWT validation, owner/session binding, CSRF, atomic one-use WebSocket intents, official Guacamole Java/JavaScript transport, server-owned VNC configuration, view-only input restrictions, deadline/revocation cleanup, focused input ownership, virtual keys, explicit clipboard and guarded PWA updates. Optional trusted-browser setup is inherited code and is disabled by default; this work grants no migration or Access-policy authorization.

## Changes made during integration

- Resolve the four merge conflicts while retaining both the refreshed handoff protections and the production implementation. Keep the original stronger project instructions.
- Preserve `MANIFEST.sha256` unchanged. Handoff commands now explicitly verify its pinned original Git revision; direct checkout verification still rejects the intentionally changed implementation. Add empty/duplicate/unsafe/tampered/missing evidence refusals instead of weakening integrity checks.
- Build and serve a valid ICO container at `/favicon.ico`. The previous build had no allowlisted resource there, causing an unexpected 404 in Chrome 154 login navigation. Login/manifest regression passes after the fix with zero unexpected console errors.
- Add bounded console diagnostics consisting only of fixed categories, resource classes and HTTP statuses. Error text, URL query values, credentials and cookies are not retained.
- Use a separate current artifact ledger, keeping the earlier pilot ledger as historical evidence. Empty/invalid groups, changed hashes and unsafe paths cannot claim successful artifact verification.

## Current verification

| Check | Result | Scope |
|---|---|---|
| `npm ci --ignore-scripts` | PASS | No frontend runtime package dependencies |
| `npm test` | 108 PASS | Reference, input, contracts, archive integrity and artifact refusals |
| `npm run build` | PASS; 104 Java tests, zero failures/errors/skips | Actual gateway HTTP/WS/JWT/session/transport integration with disposable peers |
| `npm run verify:dependencies` | PASS | 11 pinned runtime JARs, SQLite native libraries, official JS artifact and 393 locked OS package records |
| `npm run test:browser` | 18 PASS | Chrome 154 production UI/official-protocol fixtures, responsive states, two-tab update and offline privacy |
| `npm run test:login-browser` | 8 PASS | Native HTTPS enrollment/manifest fixtures; no real Access or desktop authentication |
| `npm run test:connect-browser` | 10 PASS | Simulated connection lifecycle/409/scoped cleanup; not real VNC |
| `npm run test:backup` | 3 PASS | Disposable metadata backup/restore and rejection paths |
| `node --test qa/native-vnc-diagnostics.test.mjs` | 6 PASS | Bounded metadata privacy/provenance/process-status checks |
| `npm run verify` | PASS | 66 files at the pinned original handoff revision, not current software readiness |
| Final ARM64 image build and `test:container` | PASS | Read-only/non-root/network-none startup, SQLite and missing-JWT 401 |
| Official-source guacd integration | 4 PASS | VNC argument contract and control/view failure cleanup, non-root VNC-only inventory; no actual Mac |
| Image-to-workspace digest comparison | PASS | JAR, Service Worker, favicon and build identity match final files |

Chrome version: `154.0.8037.93`; development Java: `17.0.17`; Maven: `3.9.16`; container JRE: `17.0.20.1+1`; Guacamole: `1.6.0`; Tomcat: `9.0.122`. The [official Guacamole release page](https://guacamole.apache.org/releases/) lists 1.6.0, its [Java WebSocket API](https://guacamole.apache.org/doc/guacamole-common/org/apache/guacamole/websocket/GuacamoleWebSocketTunnelEndpoint.html) uses `javax.websocket`, and [Tomcat's current release page](https://tomcat.apache.org/download-90.cgi) lists 9.0.122. Existing digest-checked native password-authentication policy is preserved; the guacd image is an official-source build with a documented local policy modification, not an unchanged Apache binary. No new vulnerability scan was run; historical vendor findings still require review before release.

Final web build: `fed92dc04e51b378`. Final local ARM64 image: `sha256:0f561366d73b3c96cec78f35e8f70f3ee52df2e47cb8bda3c41ac538423f74f7`. JAR SHA256: `6e614867afc693108337fd6ac9b051494b03c60e2656f52ed22ccc89080836f5`.

Official guacd checks used the preceding local image `sha256:b9f7aade9cb7195f440d4e22dace771bad35d09ce56236933bcc45215debf9c9`; its JAR is byte-identical to the final image. The later image change adds only the validated frontend favicon. Final image startup and byte comparisons were independently rerun.

## Real Mac prerequisite: BLOCKED

Read-only current-Mac preflight confirms a recognized RFB greeting on `127.0.0.1:5900`, offering classic VNC and ARD authentication, with no unauthenticated scheme. The existing Gateway container can also read the greeting at `host.docker.internal:5900`. Its encrypted desktop credential file exists. No password was read, printed or supplied to these probes; no authentication scheme was selected and no desktop connection was attempted.

These checks establish reachability only. Historical real view attempts in `LOCALHOST_TEST_REPORT.md` failed before a display with `TARGET_UNAVAILABLE` and an unclassified native failure. They neither establish a wrong password nor prove that today's stored credential works. The current request has not yet supplied the exact approved personal target and protected credential prerequisite for a fresh real authentication test. Required next evidence is a bounded view-only connection to that target using its owner-provisioned existing VNC credential, then a harmless editor input/modifier calibration after a real display succeeds. Never request the password in chat or recover it from Keychain.

The real-system matrix remains BLOCKED. Real owner Access issuance, Mac pixels, physical key/AltGr/IME/pointer/clipboard, Windows/Safari/iOS, two-target fleet, approved external positive access and recovery remain unverified.

## Isolation, operation and rollback

Original `main` remains at `96bc133`. The active pilot continues to use its original Gateway `sha256:9b81c30a0fae9f77a8fe2a26612376935a627a2a91c15088070a9ba35d47b806` and guacd `sha256:3cbaad3b2d040ddfe1905a99b94c5b61448f2f7358e24bb1e4a2838f38daf06f`. All pre-existing containers remain running; task fixture directories and containers were removed. No Screen Sharing, firewall, FileVault, reboot, Tunnel, Access policy, trusted-device migration or unrelated service was changed.

For a fresh local build use `npm ci --ignore-scripts`, `npm test`, `npm run build` and `npm run verify:artifacts`. `npm run preview` intentionally remains the design prototype. Starting the production JAR requires the real operator-owned configuration and credentials described in `docs/17_IMPLEMENTATION_AND_OPERATIONS.md`; it has no unauthenticated development fallback. Existing deployment/rollback runbooks are inherited preparation, not a new deployment receipt. Because no runtime was replaced, no runtime rollback is needed. Return to `main` only after preserving this branch; do not delete volumes, reset history or alter existing tunnels.
