# Host agent protocol v1 (stage 2 contract)

Status: **specification for implementation**, not yet implemented end to end. Stage 1 (the loopback prototype, [ADR-015](13_ADRS_AND_RISKS.md)) proved capture, H.264, key injection and clipboard on the owner's Mac. This document fixes the contract the agent, the gateway relay and the PWA adapter are built and tested against. The Guacamole/VNC backend stays the default and the fallback; a device selects its backend in server-owned configuration only.

## Topology and trust
```
browser PWA ──wss /ws/agent/{intentId}, subprotocol rdg-agent.v1──▶ gateway ──ws host.docker.internal:5960──▶ agent (Mac, 127.0.0.1)
```
- The browser never sees the agent address or token and never chooses capabilities. The gateway builds `hello` from the server-side Intent: token from a read-only mounted secret, `control` = intent mode is `control`, `clipboard` = recorded clipboard consent.
- The gateway is a **validating relay**, not a pipe: every browser message is parsed, checked against the allowlist below, range-checked, size-capped and re-serialised. Raw arbitrary proxying is forbidden.
- Authentication, Origin/Host/CSRF, canonical-path refusal, intent consumption, leases, idle (15 min input) and absolute deadlines, device revocation and the 250 ms tick are the existing gateway mechanisms, unchanged. The agent route needs its own path and subprotocol in `GatewayFilter`. The agent serves one client; the agent backend allows one desktop at a time (`CONTROL_BUSY`).
- The agent token is a credential that controls the Mac. It lives in a 0600 file, is mounted read-only into the gateway (Docker Desktop presents it to uid 10001), never goes to the browser, a URL or a log, and every container on the Mac can reach the agent port, so the 32-byte token is the only barrier. Rotation: delete the token file, restart the agent and the gateway.

## Messages (JSON text frames, UTF-8, ≤ 64 KiB; one object each)
Client → agent (browser messages after gateway validation; `hello` is gateway-only):
| `t` | fields | limits |
| --- | --- | --- |
| `hello` | `v`=1, `token`, `control`, `clipboard` | first message within 2 s, otherwise the agent closes |
| `k` | `s` keysym, `d` down | `s` 1..0x1fffffff; control only |
| `m` | `x`,`y` video pixels, `b` button mask | 0..32767, mask 0..31 (1 left, 2 middle, 4 right); control only |
| `w` | `x`,`y` video pixels, `dy` pixels | `dy` −4000..4000 and non-zero; positive scrolls down (content moves up); posted as continuous pixel scrolling at `x`,`y`; control only; ≤ 120/s. Horizontal scrolling is not part of v1 |
| `clip` | `text` | ≤ 16 KiB, non-empty; control and clipboard consent |
| `type` | `text` | non-empty, ≤ 4096 UTF-8 bytes; control only |
| `release` | – | releases every key and button |
| `kf` | – | requests a keyframe |
| `rate` | `kbps` | 500..12000 |

Agent → client:
| `t` | fields |
| --- | --- |
| `ready` | `v`, `width`, `height`, `control`, `controlReason` (`GRANTED`, `VIEW_ONLY`, `ACCESSIBILITY_NOT_PERMITTED`), `clipboard`, `encoder` |
| `config` | `codec` (`avc1.PPCCLL`), `avcc` (base64), `width`, `height`; repeated on every keyframe whose parameters change and after `kf` |
| binary | 14-byte header: byte 0 `1`, byte 1 keyframe flag, bytes 2–9 capture time (ms, float64 BE), bytes 10–13 sequence (uint32 BE); then an AVCC access unit, ≤ 4 MiB |
| `status` | `secureInput`, `sent`, `dropped`, `bytes` (about once per second) |
| `clip` | `text` (only with clipboard enabled; items marked concealed, transient or auto-generated are never sent) |
| `clip-result` | `ok` |
| `error` | `code`, then the agent closes |

Capture timestamps share a clock with the browser only on loopback. Over a network they are not a latency measurement; the UI uses RTT or shows nothing.

## Fixed error codes (the UI maps each to fixed text; no free text)
Agent, sent as `error` after a valid token: `PROTOCOL_UNSUPPORTED`, `SCREEN_RECORDING_NOT_PERMITTED`, `NO_DISPLAY`, `CAPTURE_FAILED`, `ENCODER_UNAVAILABLE`. A wrong token, a missing or late `hello` and a non-`hello` first message are closed with no data at all (the agent logs `AUTH_FAILED` or `AUTH_TIMEOUT` only), so an unauthenticated peer learns nothing. Gateway adds `AGENT_UNAVAILABLE` (cannot connect), `AGENT_AUTH_FAILED` (closed after `hello` without `ready`), `AGENT_PROTOCOL` (invalid or oversized agent message), `TRANSPORT_FAILED`, `INPUT_DENIED`, `READ_ONLY`, `RATE_LIMITED`, and the existing session codes (`SESSION_EXPIRED`, `CONTROL_BUSY`, …). A missing Accessibility grant is reported as `controlReason` and the UI shows view only; it never claims control.

## Gateway validation rules
- Browser → agent: allowlisted `t` only, unknown or extra fields rejected, types and ranges checked, per-type size caps (≤ 256 B for `k`/`m`/`w`/`release`/`kf`/`rate`, ≤ 20 KiB for `clip`, ≤ 6 KiB for `type`), at most 1000 messages/s, input only in control mode, `clip`/`type` only with consent. Input and clipboard call `desktop.activity()` so the idle timeout works; video and status never do.
- Agent → browser: `ready`, `config`, `status`, `clip`, `clip-result`, `error` and video binaries are passed on after type and size checks; `clip` is dropped without consent. A protocol violation ends the session with `AGENT_PROTOCOL`.
- Nothing typed, copied or captured is logged; the audit records lifecycle only.

## Flow control
Never queue frames in the gateway. The gateway pumps one agent message at a time: it requests the next only after the browser send completes, so TCP pushes back on the agent, which drops frames until the next keyframe (`kf` is sent when needed). Browser sends and input handling use separate locks so a stalled video send never blocks input. The browser decoder closes every `VideoFrame`, resets and sends `kf` on a decode error, and checks `VideoDecoder.isConfigSupported` before choosing this backend.

## Versioning
`hello.v` and `ready.v` carry the protocol version (1). Any other value is refused with `PROTOCOL_UNSUPPORTED`. A new version means a new subprotocol string.

## Limits the owner must know
The agent runs only inside a logged-in user session: at the login window, after a reboot before login, or on a secure-input screen it cannot capture or inject, so VNC remains the fallback. macOS 15+ asks again about Screen Recording roughly monthly for an ad-hoc build, and each rebuild changes the signature and invalidates grants.
