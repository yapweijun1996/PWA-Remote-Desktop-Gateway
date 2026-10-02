# 02 · Architecture and concrete baseline

## Chosen design
Use official Apache Guacamole components without requiring noVNC. A custom PWA speaks the Guacamole protocol through the official browser client. A thin Java Gateway authenticates/authorizes sessions and opens configured tunnels through the official Java library to guacd. guacd connects to macOS Screen Sharing using VNC. Official APIs provide this custom-application integration path. [S10,S11,S12,S13]

This is NOT “build the remote-desktop engine from scratch”, NOT “embed an unrestricted Guacamole demo”, and NOT “trust Cloudflare's email header”. The custom work is the policy, user experience, lifecycle and operations layer.

## Per-target node
```text
External Windows/macOS browser
  HTTPS / WSS to remote-mini.example.com
       ↓
Cloudflare edge: Access allowlist + OTP
       ↓ encrypted Tunnel
cloudflared on Mac mini
       ↓ host 127.0.0.1:32120
Gateway container :8080
  ├─ static PWA and own API
  ├─ Access JWT verifier and owner ACL
  ├─ app session / one-use intent store (memory)
  ├─ input mode + expiry policy
  ├─ metadata/settings SQLite and bounded audit
  └─ Guacamole Java tunnel adapter
       ↓ private container network guacd:4822
guacd container
       ↓ host.docker.internal:5900 (test routing and firewall)
macOS Screen Sharing / current console
```

Repeat on MacBook Air with `remote-air.example.com`. Native services can replace containers after equivalent tests, but do not fabricate a Homebrew formula or assume Linux systemd exists on macOS. The included Compose file is a blueprint: the Gateway image does not exist yet. Docker Desktop's host alias is specific to that runtime; localhost in a container is not the Mac host. [S21]

## Why this baseline
Guacamole moves the VNC credential and protocol handling server-side, which fits an OTP-first browser experience. It also exposes explicit keyboard methods, rather than requiring the owner to accept a stock UI. Keeping the gateway on each Mac avoids assuming the Macs share a LAN or using one sleeping laptop as a mandatory relay.

Trade-off: the Java + guacd/runtime footprint is greater than noVNC/websockify. A container runtime can be unavailable before user login, and must be measured on both Macs. These are release gates, not details to conceal. A leaner noVNC pilot is an alternative ADR, but must explicitly solve server-owned credentials and custom keyboard ownership; it is not a drop-in change.

## Central launchpad
Optional `remote.example.com` is an authenticated list of configured target links. Default implementation: same PWA deployed per node; each displays its own verified readiness and other configured bookmarks as UNKNOWN/“Check by opening”. Do not cross-origin fetch target status or share bearer tokens for convenience.

A node's direct link remains usable when the launchpad host is down. Access may reuse an identity session depending on policy, but separate host/application authentication may still be required. V1 does not promise one OTP unlocks all subdomains or fleet-wide logout. A future authenticated heartbeat directory needs its own scoped machine credentials and threat review.

## Frontend boundary
Use vanilla modern JavaScript modules + HTML/CSS and a reproducible build pipeline. Bundle the official Guacamole JavaScript library locally; no CDN. Keep the desktop transport behind an interface:

```text
connect(sessionIntent) / disconnect(reason)
setInputMode(mode)
sendLogicalKey(down, logicalKey)
sendPointer(state)
sendTextClipboard(text)
releaseOwnedInput(reason)
onDisplay / onConnectionState / onCapabilities
```

The concrete Guacamole adapter calibrates logical Command/Option/Control into target keysyms. `Guacamole.Keyboard` handles browser/layout normalization; the custom profile layer must intercept only once and must not duplicate built-in listeners. Mouse scale conversion occurs exactly once. [S12,S13]

## Gateway boundary
Prefer a servlet/WebSocket service using official `guacamole-common` APIs. The researched 1.6.0 WebSocket endpoint uses `javax.websocket`, so do not assume it will link directly with a Jakarta-only framework. Verify runtime/library binary compatibility in P0; pick a currently maintained compatible runtime and pin it. Do not copy the old tutorial's unauthenticated password/target or its sample build plugin versions. [S10,S11]

Custom endpoints are defined by `contracts/openapi.yaml`, not by Guacamole webapp internals. The Gateway resolves a device ID against local configuration, loads a credential from an approved server source, constructs the VNC connection configuration and opens the tunnel. It never accepts a host, port, password, “join existing tunnel” token, or protocol from the browser.

Do not expose `guacd:4822`; it is not the web authentication layer. Limit its network destinations to the intended target where technically enforceable. A gateway compromise still grants powerful desktop access: trusted-host security and patching remain required.

## Authentication sequence
1. Browser requests node URL; Access authenticates at the edge.
2. Gateway verifies Access JWT for protected bootstrap; associates the configured owner subject.
3. Gateway creates a short host-only application session cookie and returns an in-memory CSRF value.
4. Browser posts a requested local device ID/mode. Gateway checks access, concurrency and readiness, then creates a one-use connection intent.
5. Browser opens `/ws/sessions/{intentId}` with the browser's app cookie and edge authentication. The non-secret ID alone conveys no authority.
6. Gateway validates identity, Origin, app session and exact bound intent, consumes it atomically and opens a fixed upstream tunnel.
7. Server timers and local revocation apply for the full connection lifetime. Closing a page is not the only cleanup trigger.

## Data ownership
Memory: app sessions, CSRF values, connection intents and active transport handles. SQLite: settings and sanitized audit only. Configuration: target IDs, exact node origins, owner allowlist, secret references and limits. Secret files/vault: VNC credentials and application cryptographic keys, never exported through settings APIs. V1 restart invalidates all app sessions/intents.

## Trust and encryption
The browser-to-edge connection, Tunnel transport and local/container hop are distinct. Do not market this as end-to-end encrypted away from Cloudflare or the gateway: those components are in the trust path. VNC plaintext transport must not be placed on untrusted networks. macOS Screen Sharing may listen on network interfaces; pointing the client at localhost is not proof the server is loopback-only. Verify IPv4/IPv6 listening and firewall reachability. [S01,S08,S21]

## Fallbacks
If WebSocket is unavailable, show a clear diagnostic. V1 need not implement HTTP tunnel fallback; adding one requires identical auth, CSRF, expiry and cleanup controls. Do not publish it as an unguarded emergency route. WebRTC is a future alternate media architecture and would need its own signaling/ICE/relay design; an HTTP Tunnel route is not an automatic WebRTC media relay.
