# 10 · Verification plan and release criteria

## Evidence levels
1. **PACK** — files parse, reference functions pass unit tests, ZIP hashes match.
2. **LOCAL_UI** — the design prototype renders/works in a stated browser. This does not establish authentication or remote control.
3. **INTEGRATION** — implemented gateway, Guacamole, actual Mac Screen Sharing and real browser path work together.
4. **PUBLIC_PILOT** — approved Tunnel/Access route tested from another network and negative security checks pass.
5. **RECOVERY** — sleep/restart/revocation/update scenarios tested on stated devices.

Never promote a result from one level to another. `NOT_RUN`, `BLOCKED`, `FAIL`, `PASS` and `N/A with reason` are separate outcomes. A fake device fixture may test layout but cannot pass an integration row. `qa/acceptance-matrix.csv` begins with all real-system rows NOT_RUN.

## Automated layers
- Pure unit: profiles, aliases, keyup pairing, sink failure cleanup, release-all, intent deadline/binding/reuse, cache safelist, URL/Origin predicates.
- Gateway integration: trusted-JWKS JWT validation, key rotation, algorithm confusion, issuer/audience/expiry, missing edge identity, cookie fixation/CSRF, owner deny, view-only bypass, same-owner control races, SSRF target injection, expired/replayed intent.
- Transport: upstream failure, malicious oversized client instruction, frame backpressure, normal desktop stream, idle/absolute revocation with live traffic, losing browser, process restart, no key replay.
- Browser: Playwright interaction and console checks, profile change, focus loss, virtual modifiers, disconnect and two-tab worker update. Synthetic keyboard events are not evidence of OS-level shortcut capture.

## Real-device matrix
Controllers: macOS Chrome and Safari; Windows Chrome and Edge. Targets: both actual Macs. Record versions/build, local keyboard layout, mapping profile, runtime/engine versions, network path, screen resolution and evidence filenames. Cover every controller family against both targets; do not infer Air compatibility from mini.

Key tasks: editor Command+C/V/Z/S, Terminal Control+C, LeftAlt profile, right AltGr (@/€/braces), Chinese IME, dead keys, menu bar interception, local Alt+Tab/Cmd+Tab, lost keyup, switch tabs while a modifier is held, held mouse during disconnect, temporary network drop, remote lock screen and scaling/retina pointer alignment.

## Security negative tests (authorized systems only)
Use controlled test accounts/fixtures and target only the owned gateway. Validate wrong email, forged JWT, valid JWT from another app, expired identity, mismatched app cookie, missing Origin, cross-origin WS/CSRF, intent replay races, arbitrary upstream address rejection, raw input in view-only mode, logout while streaming and private data after offline/reload. Never attack third-party Cloudflare infrastructure.

## Performance methodology
Proposed useful-working target: readable editor/terminal and responsive pointer on the owner's actual network, measured rather than advertised. Record first-frame time, input-to-visible latency with a repeatable timer/video method, RTT, bandwidth, target CPU/RAM, disconnect count and test duration. Separate 1080p office workload from high-motion video; report limitations. No claim of AnyDesk-equivalent latency/FPS without side-by-side evidence.

## Release gate
All P0/P1 blocking acceptance rows must PASS on required environments or have an owner-approved scope reduction with a prominently visible limitation. Missing host access is BLOCKED, not PASS. Deliver commit ID, pinned dependency lock/digests, sanitized test commands/output, screenshots of nonprivate test content, compatibility report, rollback runbook and residual risks. Never remove existing recovery access as part of an unverified rollout.
