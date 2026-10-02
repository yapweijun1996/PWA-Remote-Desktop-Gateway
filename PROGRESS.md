# Implementation progress

Branch: `codex/production-gateway`, isolated managed worktree. Original `main` remains at `d0ce352` with no changes. The current local implementation is complete for review; real-device/public acceptance is BLOCKED. Source revision and exact output identities are in `qa/implementation/artifacts.json`.

## Authority and environment

Local software preparation and disposable fixtures are authorized. No personal target, Cloudflare account/policy, Tunnel, host permission, Screen Sharing, firewall, company device or existing MCP service was changed. On 2026-10-03 the owner approved bounded localhost testing on this development Mac. Read-only preflight confirmed its existing RFB listener at 127.0.0.1:5900 and advertised classic VNC authentication; no authentication was attempted during preflight. This authorization does not include settings changes or public exposure.

Development-only inventory: macOS 26.6.2 (25G83), Darwin ARM64; Node 23.10.0, npm 10.9.2, Java 17.0.17, repository-local Maven 3.9.16 and Docker daemon 28.3.0. Container JRE: Temurin 17.0.20.1+1, Linux ARM64. Browser: Chromium 153.0.8010.12, Playwright 1.62.1 on macOS; synthetic/viewport tests do not prove physical keyboard or Safari/Windows/iOS behavior.

The routed investigation/architecture/verification module files were absent; core/project rules were used. Bounded KB retrieval found no applicable exact-project implementation; only relevant PWA privacy/update warnings were reused.

## Backlog status

| Tickets | Current result | Acceptance limit |
|---|---|---|
| RDG-001 | PASS for repo isolation, source inspection and development preflight | Actual targets/tunnel inventory BLOCKED |
| RDG-002 | PASS for official provenance, pinned Java/OS dependencies, javax build/WS, supported-OS VNC-only guacd and isolated ARM64 checks/scans | Unfixed vendor findings, AMD64 execution and actual-host runtime acceptance remain open |
| RDG-003/004 | Current Mac approved for bounded localhost testing; first real view failed with independently reproduced ARD selection; corrected image passes five synthetic security cases; corrected real view retries FAIL with cause UNKNOWN | Protocol fixture is not a real desktop; view-only evidence cannot prove control |
| RDG-005/006/007 | Implemented and locally tested: signed JWT, owner/session/CSRF/intents, leases, read-only enforcement and expiry/logout teardown | Real Access/guacd/Mac path remains BLOCKED by 003/004 |
| RDG-008/009/010 | Implemented and locally tested: focused input, virtual keys, explicit clipboard and truthful responsive UI | Physical key/AltGr/IME/retina and actual platform acceptance BLOCKED |
| RDG-011 | Implemented; Chromium two-tab update/privacy checks PASS | Actual installed/suspended Safari/iOS/Windows PWA acceptance BLOCKED |
| RDG-012 | Metadata-only audit and protected backup/restore implemented; local tests PASS | Actual host backup/recovery custody BLOCKED |
| RDG-013/014/015 | BLOCKED: no approved ingress, second independent target, real controller/recovery matrix or owner handoff acceptance | No deployment or public exposure performed |
| RDG-016 | N/A: optional post-V1 work | No speculative native agent or extra features introduced |

## Verification

- Node: 84 PASS, including the original unchanged 74 reference tests, 9 input tests and 1 atomic-artifact test.
- Java: 38 PASS, no failures/errors/skips; production classes with signed identity and disposable protocol fixtures, including actual HTTP/WebSocket upgrades and live two-end teardown.
- Browser: 11 PASS, 0 JavaScript errors and 0 unexpected console errors; expected offline fetch errors are recorded separately.
- Backup/restore: 3 PASS, including wrong-node/symlink/permission rejection.
- ARM64 container: pinned build PASS; read-only/non-root/noexec runtime initializes SQLite, responds to health, rejects missing JWT with HTTP 401 and refuses missing configuration. No published port or target connection.
- Official-source guacd 1.6.0: four checks PASS: native VNC contract, unreachable-target control/view cleanup and non-root/VNC-only supported-OS inventory. The signed Apache C source with the explicit recorded VNC-password policy is built on pinned Ubuntu 24.04; the published unsupported Alpine 3.18 image is no longer a deployment default. No real VNC desktop or Mac. Earlier daemon tests exposed and fixed pre-handshake browser ownership and terminal error/disconnect cleanup.
- Native authentication policy: 5 synthetic cases PASS and 2 exact-source integrity checks PASS. The first approved current-Mac view attempt failed before display; its ARD-first selection was independently reproduced and corrected using official LibVNCClient APIs. Corrected-image real view retries failed at VIEW_CONNECTION/TARGET_UNAVAILABLE. The final fixed-label diagnostic capture completed but only reported NATIVE_CONNECTION_FAILURE_UNCLASSIFIED; no successful authentication or display was verified. No saved credential remains. See `qa/implementation/LOCALHOST_TEST_REPORT.md`.
- Test-only native diagnostics: 279 classifier/file-safety cases PASS in the pinned compiler and exact production daemon image; 6 Node privacy/provenance/process-status cases PASS; official guacd network-none failure integration PASS. A static reviewer confirmed the capture exit-status fix; this is bounded source review, not release sign-off.
- OS supply chain: 393 exact Ubuntu package records in six ARM64/AMD64 locks; tampered archive digest refusal PASS before installation. AMD64 resolution in an emulator does not prove final AMD64 execution.
- Final ARM64 image scans: attestation-verified Trivy 0.75.0, local Docker source only. Gateway OpenSSL patch resolves six prior findings including a High; final Ubuntu-priority High/Critical and fixed-version counts are zero. All remaining findings retained: gateway 13 Medium/16 Low, guacd 12 Medium/6 Low. Some Medium priorities have High CVSS scores; vendor fix/reachability review remains open before public release.
- Runtime lock: 11 Maven JARs, extracted SQLite libraries and official Guacamole browser asset digests verified. Public-coordinate OSV query returned no advisories; this is not an OS image scan or blanket safety guarantee.
- Compose template parses with fictional operator settings. It has not been deployed.
- Historical handoff integrity: FAIL on untouched main because `MANIFEST.sha256` refers to a missing `.gitignore`; preserved and disclosed rather than concealed.

See `qa/implementation/REPORT.md` and the real-system `qa/acceptance-matrix.csv` for evidence and remaining gates. Task-created temporary servers, browser session, credentials/certificate and debug classes were removed; useful ignored build outputs and Maven cache remain.

## Required next acceptance

The owner has approved bounded localhost tests on the current Mac. Its existing Screen Sharing listener is reachable, but corrected-image VIEW ONLY retries still fail before display with an unclassified native failure. Resolve the local interoperability prerequisite with the owner before another authentication attempt; do not infer a wrong password from this generic result. Production control still requires actual node/domain/Access settings and a six-modifier calibration record. Local pilot approval does not authorize public routing, firewall/Screen Sharing permission changes or reboot. Those changes require their own explicit scope. Then test the second Mac, required controllers, approved external path and recovery scenarios before release.
