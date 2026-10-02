# Approved current-Mac localhost test report

Recorded: 2026-10-03, Asia/Singapore. Scope: the owner's approval to test on the current development Mac. Production/public release remains BLOCKED.

## Observed result

Read-only current-Mac preflight passed. The first view-only browser connection failed before CONNECTED or a display. A native security-selection mismatch was reproduced and fixed; the corrected daemon passes its isolated checks. The corrected-image real desktop retry is BLOCKED pending required local credential entry. Its native password dialog closed without a saved credential. This report does not mark real desktop authentication successful or infer that the VNC password was wrong.

| Evidence | Result | Boundary |
|---|---|---|
| Native current-Mac identity | PASS | macOS26.6.2 build25G83 ARM64; launchd `com.apple.screensharing` and native `screensharingd` identity matched the existing5900 listener |
| Existing VNC path | PASS | Local listener and Docker route `host.docker.internal:5900` returned `RFB003.889`; RFB3.8 negotiation advertised `[30,33,36,31,32,2,35]` without authentication |
| Production Java gateway tests | PASS:38 | Signed fixture identity, real local HTTP/WebSocket, view-only guards; no real Cloudflare identity |
| Production Chromium scenarios | PASS:11 | Chromium153.0.8010.12; zero JavaScript and unexpected console errors; protocol desktop fixture |
| First current-Mac view attempt | FAIL | [first-attempt metadata](local-mac-view-first-attempt.json); old image selected ARD30 in an independent synthetic reproduction, no real display verified |
| Native integration source integrity | PASS:2 | [source-policy results](native-policy-tests.txt); exact original source produces expected modified digest; altered source refuses before write |
| Corrected native security policy | PASS:5 | [synthetic cases](vnc-security-results.json); VNC2 wins over ARD/None, unsupported-only offers and legacy3.3 completed None are rejected; no password challenge or real credentials |
| Final official-daemon regression | PASS:4 | [native checks](official-guacd-tests.txt); VNC argument contract, unreachable-target control/view teardown and non-root Ubuntu24.04/VNC-only inventory |
| Corrected current-Mac view retry | BLOCKED | Requires owner input through the local hidden-password dialog; no credential currently retained |
| Final native OS scan | COMPLETED | [raw scan](guacd-password-policy-trivy.json):12Medium/6Low retained, no Ubuntu-priority High/Critical or fixed-version rows; same cached advisory snapshot |

## Cause and concrete correction

The native library originally selected the first supported security type in the Mac's advertised list: ARD30. This gateway stores a separate VNC password and has no desktop account username/password. The synthetic probe of the original image reproduced selection30 without authenticating to the Mac.

[The integration policy](../../deployment/apply-vnc-password-policy.py) uses maintained LibVNCClient authentication APIs to allow classic VNC2, clears generic account credentials, rejects allocation failure and checks the completed scheme to cover legacy3.3. The official library still owns authentication and display codecs. This is an explicit local modification to signed Apache1.6.0 source, with input/output and policy-script digests in [provenance](../../deployment/guacd-provenance.json); it is not an unmodified Apache binary. Legacy ARD callback refusal has static review only; no DH or account-credential experiment is claimed. [ADR-011](../../docs/17_IMPLEMENTATION_AND_OPERATIONS.md) records the decision.

Final local image/index ID: `sha256:3cbaad3b2d040ddfe1905a99b94c5b61448f2f7358e24bb1e4a2838f38daf06f`. LinuxARM64 manifest: `sha256:f76af7eeb34b5af5ec1936711342588ed3ceea5b1918b4a35ea7f394cc417615`. Local tag `rdg-guacd:local-verified` is only a convenience; local-view and security-selection harnesses validate exact identities. Original-image evidence is retained separately.

## Static review

Independent read-only review covered the exact native policy/provenance/build integration and six local pilot/probe files. No actionable finding remained after correction and retest of the legacy-case evidence condition: PASS now requires actual ServerInit transmission followed by observed client closure. These reviews inspected code only and do not establish real-host or release acceptance.

## Boundaries and cleanup

The test-only launcher uses the normal signed JWT/CSRF/Origin/session path with an ephemeral test identity, a fixed server-owned current-Mac target, read-only mode, empty keysyms and denied input/clipboard. HTTPS32122 and the temporary daemon port bind only to loopback. The Docker client explicitly uses this Mac's Unix socket regardless of ambient Docker context. This temporary test daemon publication does not establish the production topology, which must keep guacd private.

Native password input was redirected directly to a temporary owner-only file outside Git. No password, token, desktop screenshot, clipboard content, key event or complete transport payload was recorded. The supplied first-attempt credential and later closed-dialog file were removed. Each harness cleans up only its own processes, containers and private temporary directory; no local32122 listener or pilot/probe directory remained at the cleanup check. All eight pre-existing Docker containers remained running and the original clean main stayed at `d0ce352b7ad76e6b427f68488c40346d0601d491`.

No host settings, Screen Sharing permission, Access policy, Tunnel, firewall, reboot, FileVault, unrelated service or public endpoint was changed. Required controller/browser combinations, six modifier calibrations, clipboard/IME/pointer behavior, genuine Access issuance, installed PWA and host recovery remain unverified. The current-Mac scope does not substitute for the required target fleet in [the acceptance matrix](../acceptance-matrix.csv).
