# 08 · API, sessions and data contracts

`contracts/openapi.yaml` defines the project's own HTTP API, not an existing Apache Guacamole REST API. The Agent must implement it. All operations are same-origin per node; JSON errors expose bounded reason codes and a nonsecret audit ID, not upstream passwords or stack traces.

## Data model
- Node configuration: stable ID, display label, hostname, local target ID and internal upstream address/credential reference. The browser receives a public projection, never upstream/credential fields.
- App session: opaque random identifier stored server-side, validated Access identity reference, creation time, Access expiry ceiling, app absolute expiry, revocation status and active tunnel handles. Cookie contains only the identifier.
- Connect intent: cryptographically random non-bearer ID, owner/app-session binding, node/target, requested mode/profile, created/expiry/consumed timestamps. TTL 30 seconds (design default), atomic consume. Intent is not a reusable Guacamole token.
- Tunnel: app session, intent, upstream handle, mode, input-idle deadline, absolute deadline, state. In-memory is adequate for a one-process pilot; process restart terminates sessions. Multi-replica support is out of scope until atomic state and control-lease coordination exist.
- Preferences: nonsecret keyboard profile and UI choices only. Store locally or in sanitized SQLite; never persist frame/clipboard/input buffers.
- Audit: bounded metadata without keyboard/clipboard/token contents, with a configurable retention policy.

## Bootstrap and auth
`POST /api/session/bootstrap` requires a valid edge assertion and exact allowed Origin. It validates the owner identity, rotates/creates the host-only app session cookie and returns a CSRF token plus public identity/node projection. Do not reflect the raw assertion. Reusing a current session requires its identity to match; logout invalidates its handles. The initial bootstrap does not yet require an existing app CSRF token, so exact Origin, Host, content type and trusted JWT checks are mandatory.

Every subsequent API and WebSocket operation revalidates the trusted edge identity and app-session binding. State-changing APIs require CSRF. Bootstrap and API responses use `Cache-Control: no-store`. Reauthentication must not extend a tunnel's lifetime silently; start a fresh authorized tunnel after the old one ends.

## Connection workflow
1. List public device projection (`GET /api/devices`); remote-node bookmarks carry UNKNOWN status.
2. `POST /api/connect-intents` with allowed `deviceId`, `mode`, `keyboardProfile`, and optional `displayQuality` (`low`, `balanced`, `clear`; omission defaults to `balanced`). Null, invalid types/values and arbitrary VNC parameters are refused; no host/port/password fields accepted. Require consent to control and enforce one controller per device atomically. Optional `backend` (`vnc` default, `agent` only when the server enables the host agent, otherwise 503 `AGENT_DISABLED`); an `agent` intent is valid only on `/ws/agent/{intentId}` (subprotocol `rdg-agent.v1`, [docs/19](19_HOST_AGENT_PROTOCOL.md)) and a `vnc` intent only on `/ws/sessions/{intentId}`, so a wrong-route upgrade is refused with 400 before the intent is consumed. The agent backend is exclusive: it needs no other desktop on the node.
3. Response contains intent ID, expiry and approved display quality. Intent/Desktop retain an immutable server-owned quality preset. Browser upgrades `/ws/sessions/{intentId}` with app cookie; edge adds assertion. The ID alone is insufficient authority. Redact it from access logs anyway. The owning app's `/api/session` status includes its active display quality; other apps cannot inspect that profile or intent ID.
4. Validate Origin/Host/JWT/app session/target/mode/expiry and consume once; reserve the controller lease; create fresh guacd transport. Race two upgrades in tests.
5. Return the official Guacamole protocol over WebSocket. Do not invent JSON key events or prepend control messages to that protocol. Keep application heartbeat/status on a distinct authenticated `/api` channel as necessary.
6. Server releases lease and resources on termination, even if the browser vanishes. A failed upstream connection consumes the intent; reconnect requires a new one.

## State transitions
`IDLE → AUTH_CHECK → INTENT_READY → CONNECTING → ACTIVE_CONTROL | ACTIVE_VIEW → CLOSING → ENDED`.
Failure transitions go to `ENDED` with a reason. A reconnect never reuses a transport handle. Input is enabled only in ACTIVE_CONTROL with a live capture grant. `ACTIVE_VIEW` uses the upstream read-only configuration, not a UI promise.

## Deadlines and heartbeat
Set tunnel absolute expiry to the minimum of the verified identity expiration and the app cap (default 60 minutes from app bootstrap). Limit no-input idle to 15 minutes. Heartbeat, video frames and mouse movement outside a controlled viewer must not extend input activity. Rate-limit activity updates and derive them from authorized input, not an unauthenticated client “still active” claim. Timers use a monotonic duration for enforcement where practical; token timestamps are wall-clock verified with bounded skew.

Reference `session-policy.mjs` tests pure deadline predicates only; it is not JWT signature verification, distributed locking, a scheduler, or the gateway implementation.

## Error taxonomy
`AUTH_REQUIRED` (401), `ACCESS_DENIED` (403), `ORIGIN_DENIED` (403), `CSRF_INVALID` (403), `DEVICE_UNKNOWN` (404), `TARGET_UNAVAILABLE` (503), `CONTROL_BUSY` (409), `INTENT_EXPIRED` (410), `INTENT_USED` (409), `SESSION_EXPIRED` (401), `UNSUPPORTED_CAPABILITY` (422), `RATE_LIMITED` (429). After upgrade use a bounded close reason and nonsecret code; do not send credentials in an exception frame.

## Limits — design defaults to tune from evidence
One control session per target, two concurrent sessions per owner maximum, 30s intents, 10s upstream connect deadline, 16KiB UTF-8 clipboard text maximum, metadata retention 30 days. Separate inbound instruction limits from outbound image sizes. Record p50/p95 measurements before making performance claims. All changing limits are server-authoritative; the UI may display them but cannot increase them.
