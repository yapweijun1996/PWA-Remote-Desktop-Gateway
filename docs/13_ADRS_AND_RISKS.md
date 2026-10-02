# 13 · Architecture decisions and risk register

## ADR-001 · Reuse a protocol engine
Baseline: official Apache Guacamole Java/JavaScript libraries and guacd, with native macOS Screen Sharing. Build our own small PWA and authorization layer. Rationale: separate product UI from established protocol handling. This is a design choice subject to P0 Mac interoperability, not an owner mandate. noVNC remains a possible alternative; neither Cloudflare nor a domain replaces the remote desktop engine. [S01,S10,S25]

## ADR-002 · Thin Java service, not an invented Guacamole REST wrapper
Use documented Guacamole tunnel APIs. The 1.6.0 WebSocket endpoint extends `javax.websocket.Endpoint`; resolve servlet/WebSocket compatibility explicitly. Do not assume a Jakarta-only framework can consume it unchanged. Do not copy a tutorial's unauthenticated open tunnel into production. [S10,S11]

A stock Guacamole UI with trusted-header authentication is another design, not the selected custom UI contract. Its header-auth extension needs a trusted front-end and a connection data provider; an arbitrary browser-supplied email header is not an authenticated identity. [S24]

## ADR-003 · Independent Mac nodes
One node per target, each with local gateway, guacd and Tunnel route. Avoid building a fleet relay/VPN just to support two Macs. Optional launcher uses top-level links and no cross-origin credential sharing. Mac mini being offline should not prevent direct access to an independently running Air node. A centralized launcher may still be unavailable if hosted on mini.

## ADR-004 · Cloudflare email OTP, plus gateway checks
Use owner's selected Access OTP policy; retain target VNC credential server-side. Do not collect target account passwords or implement an app password database. Gateway auth and active-session control remain required. Upgrade to phishing-resistant IdP auth is optional future work, not misrepresented as inherent to email OTP. [S02,S03,S04]

## ADR-005 · Logical keyboard roles
Provide explicit native and optional LeftAlt→Command mappings. Do not silently remap Control or infer foreground application. Keep browser/OS reserved-key fallbacks visible. Layer profile/state logic above one normalized input stream and below the focused viewer. [S12,S18,S20,S27]

## ADR-006 · No WebRTC in V1
The selected remote transport is HTTPS/WebSocket + Guacamole. A custom ScreenCaptureKit/WebRTC engine is a separate future project requiring codec, capture permissions, signaling, NAT/TURN, packaging and security work. A Cloudflare HTTP Tunnel does not by itself solve arbitrary peer-to-peer WebRTC media transport. Do not advertise the V1 as WebRTC or zero-relay/zero-latency.

## Risks
| Risk | Consequence | Mitigation / gate |
|---|---|---|
| Browser/OS intercepts shortcut | Unexpected local action | Visible remote buttons; tested supported matrix |
| Screen Sharing mode differs by macOS | Login/keys fail | P0 actual-Mac calibration before UI polish |
| Legacy VNC auth/data exposure | Unauthorized access | Private path, separate credential, firewall verification; never public VNC |
| Edge login mistaken for lifetime policy | Session survives intended expiry | Server deadlines/revoke closes upstream |
| Multiple tabs or network loss | Stuck keys/stale control | Owned input state, fresh sessions, no replay, controller lease |
| Compromised mailbox/session cookie | Unauthorized owner access | Mailbox MFA, short bounded sessions, revoke; stronger IdP roadmap |
| Cloudflare/host trust compromise | Desktop confidentiality loss | Explicit trust model, minimal logs; no false E2EE claim |
| Sleep/reboot/container startup | Remote path unavailable | Tested recovery path, keep alternate authorized access |
| Incorrect runtime/library versions | Build/runtime failure | API/version/ARM64 gate, locks and digests |
| Worker update while controlling | Interrupted session or key state | Multi-tab/server-aware update boundary |
| Wrong hostname certificate | Browser TLS failure | First-level examples; verify actual cert coverage |
| False Online/acceptance claims | Owner relies on unavailable access | Evidence levels, truthful status and NOT_RUN defaults |

No risk score or readiness percentage is assigned without test evidence.
