# Approved current-Mac localhost test report

Recorded: 2026-10-03, Asia/Singapore. Scope: the owner's approval to test on the current development Mac. Production/public release remains BLOCKED.

## Observed result

Current-Mac identity and route preflight passed. The first real VIEW ONLY attempt failed before CONNECTED or a display; an independent synthetic peer reproduced the original daemon choosing ARD30 over VNC2. The corrected native policy passes its isolated tests, but actual corrected-image view attempts still FAIL at VIEW_CONNECTION with TARGET_UNAVAILABLE. The final diagnostic harvest completed and reported only NATIVE_CONNECTION_FAILURE_UNCLASSIFIED. The underlying cause is UNKNOWN. No successful real desktop authentication, display or lease teardown is claimed; a generic failure does not establish a wrong password.

| Evidence | Result | Boundary |
|---|---|---|
| Native current-Mac identity | PASS | macOS26.6.2 build25G83 ARM64; launchd `com.apple.screensharing` and native `screensharingd` matched the existing5900 listener |
| Existing VNC route | PASS | Local and Docker `host.docker.internal:5900` returned RFB003.889; RFB3.8 offers `[30,33,36,31,32,2,35]` observed without authentication; Docker route also rechecked against the corrected image |
| Existing Java gateway regression | PASS:38 | Signed fixture identity and real local HTTP/WebSocket; no Cloudflare-issued identity |
| Existing Chromium regression | PASS:11 | Chromium153.0.8010.12, zero JavaScript and unexpected console errors; protocol fixture |
| First actual view attempt | FAIL | [original-image metadata](local-mac-view-first-attempt.json); no display; ARD preference reproduced separately |
| Corrected native source integrity | PASS:2 | [source-policy results](native-policy-tests.txt); changed source refuses mutation |
| Corrected security policy | PASS:5 | [synthetic cases](vnc-security-results.json); VNC2 preference and unsupported/legacy None refusal, no password challenge |
| Corrected default view attempt | FAIL | [metadata](local-mac-view-corrected-attempt.json); VIEW_CONNECTION/TARGET_UNAVAILABLE,17740ms, no display or browser errors |
| Earlier stream diagnostic attempt | FAIL; harvest incomplete | [metadata](local-mac-view-stream-attempt.json); browser failed in18339ms; attach harvest reached its bound and did not yield completed diagnostics; cause UNKNOWN |
| Final file diagnostic attempt | FAIL; harvest COMPLETE | [metadata](local-mac-view-diagnostic-attempt.json); VIEW_CONNECTION/TARGET_UNAVAILABLE,21193ms, one generic native failure label, no display or browser errors |
| Native diagnostic privacy/file/ABI tests | PASS:279 native +6 Node | [results](native-diagnostics-tests.json); both immutable compiler and exact production-image ABI; no real target/credentials |
| Actual official-daemon diagnostic flow | PASS | [network-none integration](native-diagnostics-integration.json); expected NETWORK_CONNECT_FAILURE and generic native failure captured from official VNC plugin; no real authentication |
| Native OS scan | COMPLETED | [raw scan](guacd-password-policy-trivy.json):12Medium/6Low, no Ubuntu-priority High/Critical or fixed-version rows; same cached snapshot |

## Native policy and diagnostic evidence

The password-only integration uses maintained LibVNCClient authentication APIs, clears generic account credentials, refuses allocation failure and checks the completed scheme including legacy3.3. Official libraries still own authentication and display codecs. This is an explicit local modification to signed Apache1.6.0 source; [provenance](../../deployment/guacd-provenance.json) records original/modified source and policy digests. Do not call it an unmodified Apache binary. [ADR-011](../../docs/17_IMPLEMENTATION_AND_OPERATIONS.md) records this decision.

Final production image/index ID: `sha256:3cbaad3b2d040ddfe1905a99b94c5b61448f2f7358e24bb1e4a2838f38daf06f`. LinuxARM64 manifest: `sha256:f76af7eeb34b5af5ec1936711342588ed3ceea5b1918b4a35ea7f394cc417615`. Production JAR/frontend/native image are unchanged by the test-only logger.

The optional test-only interposer discards native text in memory and emits only exact fixed labels. It writes a bounded owner-only tmpfs file, not raw Docker logs. Its pinned compiler ID is `sha256:132e4d0f841d82d538a3303018a0ff946223a10d1e8f5ea09e256719ba06b168`; final C source SHA256 is `0a2f3179b5c4c151f8c07c02b622a173363bca46ed0a18f4b7bdb1579b0e35ea` and library SHA256 is `602ee3ed0f95c8ebe3671173a7cdd6d50be010a0b520024874bc412ebda7f2d3`. The temporary library is removed after testing and can be rebuilt through the locked compiler. Whole-call/truncation/privacy tests, unsafe-file refusal and provenance/process-status checks passed. Static source review confirms the VNC callbacks add no timestamp prefix. Unknown server-reason text is deliberately dropped; discardedLines counts host input after that filter and cannot show how many original native calls were unmatched.

The initial attach/FIFO harvesting did not complete within its deadline; inspected foreground Guacamole source does not establish stderr closure as its cause. The new file capture runs while the daemon exists, ignores stderr and explicitly checks Docker's exit code with a ten-second child deadline. An independent static reviewer identified the initial POSIX pipeline hiding failed reads; the explicit status check and exit2/ENOENT privacy regressions resolved it. No actionable finding remained in the bounded logger/wrapper review. These reviews do not establish real-device or release acceptance. [ADR-012](../../docs/17_IMPLEMENTATION_AND_OPERATIONS.md) preserves the verified procedure and limits.

## Privacy and cleanup

The test uses the normal signed JWT/CSRF/Origin/session path with an ephemeral test identity, a fixed server-owned current-Mac target, view-only mode, empty calibration map and denied input/clipboard. HTTPS32122 and temporary daemon publication bind only to loopback. Docker is pinned to this Mac's Unix socket. This temporary arrangement does not establish production32120/private-guacd topology.

Local hidden password input was redirected directly to temporary0600 files outside Git and deleted after each run. No password, token, screenshot, desktop text, clipboard, key event or full transport payload was saved. An earlier root cleanup wrapper hit zsh's readonly `status` variable; the credential was immediately removed manually and later orchestration used POSIX/task-specific variables. No credential currently remains.

Final cleanup verified zero pilot/probe/diagnostic-fixture directories, zero task credential directories, no32122 listener, and all eight pre-existing Docker containers still running. The original clean main remains at `d0ce352b7ad76e6b427f68488c40346d0601d491`. No host settings, Screen Sharing permission, Access/Tunnel policy, firewall, reboot, FileVault, unrelated service or public endpoint was changed.

## Remaining acceptance

The immediate local interoperability failure is unresolved. Do not guess or repeatedly retry a password, read Keychain or change settings to bypass it. Resolve the precise prerequisite with the owner before another real authentication attempt. The final generic label alone cannot distinguish credential rejection from other native initialization failures.

Required target fleet, actual controller/browser combinations, six modifier calibrations, clipboard/IME/pointer behavior, genuine Access issuance, installed PWA and host recovery remain unverified. All64 real-system release scenarios in [the acceptance matrix](../acceptance-matrix.csv) remain BLOCKED; these failures are recorded separately from passing narrower local checks.
