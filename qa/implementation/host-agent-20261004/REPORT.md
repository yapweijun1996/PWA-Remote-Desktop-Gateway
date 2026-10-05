# Host agent prototype (option A) — real-Mac results, 2026-10-04/05

Target: the owner's Mac (macOS 26.6.2), agent 0.1.0-prototype launched as its own app (`com.rdg.local.agent`, ad-hoc signed) with its own Screen Recording and Accessibility grants. Loopback only; the owner watched. Not integrated with the gateway or PWA, not deployed.

## Input and clipboard (`input-test.mjs`, 15/15 passed, `input-test-results.json`)
Injected only into a throwaway TextEdit file, frontmost app checked before every step:
- plain typing; **Control held 1 s + A** (line start); **Command + A** with 150 ms and 1 s holds; **Command+Space opens Spotlight** and Escape closes it;
- typing Chinese as text; **client → Mac clipboard incl. Chinese and é** and **Command+V paste**; **Mac → client clipboard** on copy;
- holding Command+Control then closing the client releases every key; no modifier is left held at the end.
The same Control and Command tests failed on the built-in Screen Sharing (VNC) path and client → Mac clipboard text never reached the pasteboard (`../mac-input-diagnosis-20261004/REPORT.md`).
Test-method corrections made along the way (not agent faults): TextEdit auto-capitalised the first letter, `pbpaste` needs a UTF-8 locale, and Spotlight is an overlay window rather than the frontmost app.

## Video (loopback, view-only, `measurements.json`, `encoder-experiments.json`)
1470x956 H.264 Main, 29-30 fps, capture-to-decode about 10 ms, agent about 5% of one core. Idle bitrate about 254 kbit/s after moving keyframes from 4 s to 30 s and skipping unchanged frames (was 519). Auto-scroll sits at the 4 Mbit/s target, so the target must adapt to the client's network. No real network, Cloudflare or VNC comparison was measured.

## The encoder-creation stall
After rebuilding and re-granting, the app-launched agent blocked in `VTCompressionSessionCreate`, a synchronous XPC call to `VTEncoderXPCService`, for over a minute while the service sat idle. The same code was fine standalone, inside an unauthorised `.app`, and from a terminal. After a further reset and re-grant it created the encoder in 2.2 s once and then in about 120 ms on every later run (default, encoder-before-capture, software-only, hardware-plain), so the cause was not found and could not be reproduced. The agent now tries low-latency hardware, hardware and software encoders in turn with a 5 s deadline each (software was measured at 29 fps), so a stall degrades instead of hanging.

## Operational lessons
- Every rebuild changes the ad-hoc signature (cdhash); macOS keeps the old grant record and logs `Failed to match existing code requirement`. Reset only the agent's records (`tccutil reset <service> com.rdg.local.agent`) and add the app again.
- Launched from a terminal, the agent inherits the terminal's capture grant (it did once by accident). Always launch with `open`.
- macOS 15+ asks monthly about Screen Recording; the persistent-capture entitlement is not available to an ad-hoc build.

## Stage 2 S2 — gateway relay (branch `codex/host-agent-stage2-20261004`, local commits only)
Scope: the gateway side of [docs/19](../../../docs/19_HOST_AGENT_PROTOCOL.md) (`AgentPolicy`, `AgentRelay`, `AgentEndpoint`, `/ws/agent/{intentId}`, `backend` on intents, `RDG_AGENT_*` configuration). Verified against a disposable protocol peer (`AgentFixture`), **not** the Mac and not the Swift agent.
- Java 149/149 (110 before; 39 new: policy 19, settings 6, end-to-end 14), Node 170/170, six consecutive repeats of the 33 agent tests all green.
- End to end through the real HTTP/WebSocket stack: ready/config/video relay, validated input reserialised, view-only and clipboard consent enforced both ways, fixed error codes for agent refusals, closed-after-hello, an unreachable agent, an oversized agent message and a bad video header, wrong-route and wrong-subprotocol upgrades refused before the intent is consumed, the existing identity/cookie/Origin guards, server flag off, owner-blocked desktop, app revocation and the 15-minute idle deadline closing the agent connection, and no typed or copied text or token in the audit, diagnostics or any state file.
- Back-pressure: with 512 KiB frames and a browser that stops reading, the sender stalled at 8 frames (4 MiB across both hops, nothing queued by the gateway) and resumed on reading; input still reached the agent during the stall.
- The agent's emitted shapes were read from `Server.swift`, `Token.swift` and `Capture.swift` and are pinned in `AgentPolicyTest.acceptsTheShapesTheSwiftAgentActuallyEmits` (escaped slashes, integer counters, all five error codes, 43-character base64url token). The agent is not running, so this is source reading, not a live check.
Open for S4 (real Mac, owner watching): the Java WebSocket client against `NWProtocolWebSocket`; `host.docker.internal:5960` reaching an agent bound to `127.0.0.1` from inside the container (first check, the topology depends on it); a reconnect right after a session ends (the agent refuses a second client while its previous session is still tearing down; S5 retries); the largest single video send duration against the 5 s browser send timeout over the real Cloudflare path (loopback tests cannot show it; the fix, if needed, is S5).

## Stage 2 S3 — PWA adapter (same branch, local commits only)
Scope: `AgentAdapter` with `agent-protocol`, `agent-input` and `agent-video` modules, the engine selector and engine-specific texts, fixed failure texts in English and Simplified Chinese ([docs/19](../../../docs/19_HOST_AGENT_PROTOCOL.md), "Browser adapter").
- Node 212/212 (170 before; 42 new: protocol 6, input sink 10, video pipeline 11, adapter 15). Java 149/149 unchanged. Existing VNC browser suite 18/18 and connection lifecycle suite still PASS with the selector hidden (`backends` is only `["vnc"]` there).
- New real-browser check `npm run test:agent-browser` (`qa/agent-browser-checks.mjs`, 9 checks, Chromium 151, 0 page errors, 0 console errors, `qa/implementation/agent-browser-results.json`): the production PWA through the real gateway to a disposable agent peer streaming a synthetic ffmpeg test pattern (`qa/make-agent-test-video.mjs`, never a screen capture). It shows real WebCodecs H.264 decoding and drawing (332 distinct colors, picture changing), the first frame setting CONNECTED, the initial `rate` following the picture mode, keys, a Command chord and clicks arriving in the protocol shape without wheel bits, a 1200-event wheel and mouse flood held to 51 wheel and 57 move messages per second with the session surviving, the clipboard confirmed by `clip-result`, `release` on end, a missing Accessibility grant shown with keys and clipboard disabled, a fixed agent error shown as text that offers Screen Sharing, and a VNC request unchanged and still connecting. Both Playwright's Chromium and installed Google Chrome 154 report H.264 as supported.
- Findings fixed on the way: the VNC-specific clipboard texts ("built-in Screen Sharing did not accept text") were wrong for the agent and now have agent wording; a JDK WebSocket client delivers on demand, so the test browser withholds `request(1)` to model a slow reader.
Not verified (S4 and later, on the real Mac): the real Swift agent through the real gateway and Cloudflare Access with the owner watching; scroll feel (the 1:1 default is a first guess to tune on the Mac); hardware decode choice on the owner's browsers, Safari and Windows browsers; Chinese IME; secure-input behaviour; reconnect and bitrate adaptation (S5).

## Not done
End-to-end over the network, the PWA viewer, authentication through the gateway, bitrate adaptation, scrolling feel under a real connection, Chinese IME composition, secure-input behaviour, LaunchAgent and recovery, and the rest of the exit criteria.
