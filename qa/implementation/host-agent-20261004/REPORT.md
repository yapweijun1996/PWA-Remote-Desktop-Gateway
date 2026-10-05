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

## Not done
End-to-end over the network, the PWA viewer, authentication through the gateway, bitrate adaptation, scrolling feel under a real connection, Chinese IME composition, secure-input behaviour, LaunchAgent and recovery, and the rest of the exit criteria.
