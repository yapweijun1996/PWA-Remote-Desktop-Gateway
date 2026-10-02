# 14 · Source register

Research date: **2026-10-02**. Primary vendor/project/security documentation only. No vendor page is reproduced in full. `[Sxx]` markers refer to the sources below. Product limits and proposed architecture are our design decisions, not vendor guarantees. Versions, browser behavior, account plans and advisories must be rechecked when implementation begins.

## S01 · Cloudflare Tunnel

https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/

Evidence scope: Outbound connector architecture; not a remote-desktop engine.

## S02 · Cloudflare Access one-time PIN

https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/

Evidence scope: Provider-handled email OTP for allowed identities; verify current expiry/policy behavior at deployment.

## S03 · Validate Access JWTs

https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/

Evidence scope: Signed assertion, issuer/audience/signature checks and trusted JWKS.

## S04 · Access session management

https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/session-management/

Evidence scope: Access session behavior is not an application-specific active desktop timeout implementation.

## S05 · Cloudflare WebSockets

https://developers.cloudflare.com/network/websockets/

Evidence scope: WebSocket proxy support, reconnect/keepalive considerations and upgrade behavior.

## S06 · Universal SSL limitations

https://developers.cloudflare.com/ssl/edge-certificates/universal-ssl/limitations/

Evidence scope: Certificate hostname coverage; full-setup apex/first-level versus deeper names.

## S07 · Apple Screen Sharing

https://support.apple.com/en-sg/guide/mac-help/mh11848/mac

Evidence scope: Native sharing settings and compatible VNC access option.

## S08 · Apple VNC access/control

https://support.apple.com/guide/remote-desktop/virtual-network-computing-access-and-control-apde0dd523e/mac

Evidence scope: VNC interoperability and security distinctions; see also S28 for password separation.

## S09 · Apple FileVault security

https://support.apple.com/en-sg/guide/security/sec8447f5049/web

Evidence scope: Qualified remote-unlock/restart behavior; not proof this gateway runs before login.

## S10 · Writing a Guacamole application

https://guacamole.apache.org/doc/gug/writing-you-own-guacamole-app.html

Evidence scope: Official Java/JavaScript application and tunnel architecture.

## S11 · Guacamole WebSocket endpoint 1.6.0

https://guacamole.apache.org/doc/1.6.0/guacamole-common/org/apache/guacamole/websocket/GuacamoleWebSocketTunnelEndpoint.html

Evidence scope: javax.websocket API compatibility; verify deployed runtime.

## S12 · Guacamole Keyboard API 1.6.0

https://guacamole.apache.org/doc/1.6.0/guacamole-common-js/Guacamole.Keyboard.html

Evidence scope: Normalized keyboard/input/composition handling and reset behavior.

## S13 · Guacamole Client API 1.6.0

https://guacamole.apache.org/doc/1.6.0/guacamole-common-js/Guacamole.Client.html

Evidence scope: Display, key and pointer client APIs.

## S14 · Guacamole connection configuration

https://guacamole.apache.org/doc/gug/configuring-guacamole.html

Evidence scope: VNC options including server read-only and capability-specific settings.

## S15 · Guacamole Docker deployment

https://guacamole.apache.org/doc/gug/guacamole-docker.html

Evidence scope: Official service separation and images; still verify architecture and digest.

## S16 · Guacamole release index

https://guacamole.apache.org/releases/

Evidence scope: 1.6.0 was the latest shown during research; dated 2025-06-22. Recheck before implementation.

## S17 · Guacamole security advisories

https://guacamole.apache.org/security/

Evidence scope: Verify relevant fixed versions and dependencies at build time.

## S18 · MDN Keyboard.lock

https://developer.mozilla.org/en-US/docs/Web/API/Keyboard/lock

Evidence scope: Limited availability and OS/browser restrictions; feature-detect.

## S19 · Chrome Keyboard Lock

https://developer.chrome.com/docs/capabilities/web-apis/keyboard-lock

Evidence scope: Keyboard capture enhancement, permissions and limitations.

## S20 · MDN KeyboardEvent.key

https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/key

Evidence scope: Produced key values differ from physical codes.

## S21 · Docker Desktop networking

https://docs.docker.com/desktop/features/networking/

Evidence scope: Container/host networking and host.docker.internal.

## S22 · MDN Service Workers

https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers

Evidence scope: Installation, activation and cache lifecycle APIs; product safety policy is this design.

## S23 · OWASP WebSocket security cheat sheet

https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html

Evidence scope: Origin, authentication, session expiry, validation and logging safeguards.

## S24 · Guacamole header authentication

https://guacamole.apache.org/doc/gug/header-auth.html

Evidence scope: Trusted-header integration is distinct from signature verification/connection configuration.

## S25 · noVNC project

https://novnc.com/noVNC/

Evidence scope: Alternative browser VNC foundation; not a required dependency for this baseline.

## S26 · MDN Clipboard API

https://developer.mozilla.org/en-US/docs/Web/API/Clipboard_API

Evidence scope: Secure context, user activation and browser-specific clipboard permissions.

## S27 · MDN KeyboardEvent.code

https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/code

Evidence scope: Physical code semantics; do not derive non-US text from it.

## S28 · Apple set up VNC software

https://support.apple.com/guide/remote-desktop/set-up-a-computer-running-vnc-software-apdbed09830/mac

Evidence scope: Use a VNC password distinct from the local computer/user password.

## S29 · Guacamole FAQ

https://guacamole.apache.org/faq/

Evidence scope: Browser/OS reserved keyboard combinations and practical client limits.

## Source interpretation
Source retrieval is not a real-device test. No public documentation proves the owner's current Mac permissions, tunnel configuration, network exposure or selected browser's observed behavior. No cost/performance estimate is asserted. Source links are supplied for the implementation Agent to inspect and cite. Avoid copying obsolete tutorial authentication or deployment defaults.
