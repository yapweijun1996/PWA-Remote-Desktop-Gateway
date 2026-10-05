# Host agent protocol v1 (stage 2 contract)

Status: the contract is implemented in the agent (stage 2 S1, verified on the owner's Mac) and in the gateway relay (S2, verified against a disposable protocol peer, not the Mac). The PWA adapter (S3) and the deployment behind a server flag (S4) are not done. Stage 1 (the loopback prototype, [ADR-015](13_ADRS_AND_RISKS.md)) proved capture, H.264, key injection and clipboard on the owner's Mac. This document fixes the contract the agent, the gateway relay and the PWA adapter are built and tested against. The Guacamole/VNC backend stays the default and the fallback; a device selects its backend in server-owned configuration only.

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
| `clip` | `text` | ≤ 16 KiB UTF-8, non-empty, no NUL; control and clipboard consent |
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
- Browser → agent: allowlisted `t` only, unknown or extra fields rejected, types and ranges checked, per-type size caps (≤ 256 characters of raw JSON for `k`/`m`/`w`/`release`/`kf`/`rate`; for `clip` and `type` the raw JSON is ≤ 40 KiB, which leaves room for JSON escaping, and the decoded text is then capped at 16 KiB and 4096 UTF-8 bytes), at most 1000 messages/s, input only in control mode, `clip`/`type` only with consent. Input and clipboard call `desktop.activity()` so the idle timeout works; video and status never do.
- Agent → browser: `ready`, `config`, `status`, `clip`, `clip-result`, `error` and video binaries are passed on after type and size checks; `clip` is dropped without consent. A protocol violation ends the session with `AGENT_PROTOCOL`.
- Nothing typed, copied or captured is logged; the audit records lifecycle only.

## Configuration (gateway)
Off unless the owner turns it on; every other value refuses startup.
| Variable | Meaning |
| --- | --- |
| `RDG_AGENT_ENABLED` | `true` or `false` (default `false`). While `false` the route is not registered, `backend=agent` intents get 503 `AGENT_DISABLED`, and nothing else changes. |
| `RDG_AGENT_HOST` | `host.docker.internal` (default) or `127.0.0.1` only. |
| `RDG_AGENT_PORT` | Must be `5960` if set. |
| `RDG_AGENT_TOKEN_FILE` | Required when enabled; must be `/run/secrets/<name>` (lower case, digits, `_`, `-`). Read at startup (refuses if unusable) and again per connection. A regular, non-symlink file with no group/other permission bits, ≤ 256 bytes, holding 43 base64url characters. |

`GET /api/devices` (local device) and `GET /api/diagnostics` list `backends` (`["vnc"]` or `["vnc","agent"]`). Neither exposes the agent address, port, path or token. `POST /api/connect-intents` takes optional `backend` (`vnc` default); the intent is bound to it, and using it on the other backend's route is a 400 that does not consume it. The agent route is `/ws/agent/{intentId}` with subprotocol `rdg-agent.v1` and the same guards as `/ws/sessions/{intentId}`.

Handshake: connect ≤ 3 s, `hello` write ≤ 2 s, validated `ready` ≤ 5 s, inside the existing 10 s connecting deadline; the browser receives `ready` only after the agent has authenticated and the gateway has validated it. The gateway then sends the first `rate` from the intent's picture mode (Low 1500, Balanced 4000, Clear 8000 kbit/s). `ready` may never grant more than the intent: `control` needs a control intent, `clipboard` needs recorded consent, otherwise `AGENT_PROTOCOL`.

Failures before `ready` are reported to the browser as one fixed `error` code and then the socket closes: the agent's own code, `AGENT_UNAVAILABLE`, `AGENT_AUTH_FAILED` (closed or silent after `hello`, which is also what a wrong token looks like) or `AGENT_PROTOCOL`.

## Flow control
Never queue frames in the gateway. The gateway pumps one agent message at a time: it requests the next only after the browser send completes, so TCP pushes back on the agent, which drops frames until the next keyframe (`kf` is sent when needed). Browser sends and input handling use separate locks so a stalled video send never blocks input. Measured against the disposable peer with 512 KiB frames and a browser that stops reading: the sender stalled at 8 frames (4 MiB across both hops, none of it queued by the gateway) and resumed on reading, and input kept flowing during the stall. The browser socket's idle timeout is Tomcat's 30 s, which only expires when both reads and writes are idle, so the agent's roughly 1 Hz `status` keeps a quiet session open and the browser needs no keepalive message. The browser decoder closes every `VideoFrame`, resets and sends `kf` on a decode error, and checks `VideoDecoder.isConfigSupported` before choosing this backend.

## Versioning
`hello.v` and `ready.v` carry the protocol version (1). Any other value is refused with `PROTOCOL_UNSUPPORTED`. A new version means a new subprotocol string.

## Limits the owner must know
The agent runs only inside a logged-in user session: at the login window, after a reboot before login, or on a secure-input screen it cannot capture or inject, so VNC remains the fallback. macOS 15+ asks again about Screen Recording roughly monthly for an ad-hoc build, and each rebuild changes the signature and invalidates grants.
