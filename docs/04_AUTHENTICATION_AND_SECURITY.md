# 04 · Authentication, authorization and privacy

## Threat model
Assets: full desktop authority, VNC credentials, Access identity, session handles, typed secrets, clipboard and screen content. Attackers include unauthorized Internet users, a malicious website opened by the owner, a stolen browser session, a compromised local/container process, hostile protocol data and supply-chain compromise.

The browser, edge, gateway and target are distinct boundaries. An authenticated user controlling the desktop effectively has the target user's interactive capabilities. This is not a limited-scope MCP tool and must not inherit an AI tool's read-only label.

## Identity at the edge and origin
Use a Cloudflare Access self-hosted application covering each full node hostname and all paths, including APIs and WebSocket endpoints. Allow only the configured owner email. OTP establishes access to an approved mailbox; it is not inherently phishing-resistant MFA. Secure the mailbox separately; a stronger IdP/passkey policy can be added later. Do not implement local OTP or password fallbacks. [S02]

Gateway validates the `Cf-Access-Jwt-Assertion` with a maintained JWT library: configured issuer, exact expected application audience, permitted signing algorithm, signature via configured issuer JWKS, exp and relevant temporal claims, and configured identity/subject. No attacker-controlled JWKS URL; ignore token-supplied jku/x5u for key discovery. Bound remote-key fetch time/size and cache age; unknown key on failed refresh denies access. Key rotation must have tests. Decoding a JWT is not verification. [S03]

Do not trust `Cf-Access-Authenticated-User-Email`, arbitrary Forwarded headers, client request email or an app cookie alone as the complete identity proof. Bound trusted proxy settings; reject malformed/duplicate authorization headers. Fail startup if required issuer/audience/allowlist is missing or still a placeholder.

## Application session proposal
Set an opaque, random host-only `__Host-rdg` cookie with Secure, HttpOnly, Path=/ and SameSite=Lax or stricter after testing top-level Access returns. Do not set Domain. Store only a hash/index server-side, bind to verified subject and node. Rotate on authentication; expire at min(Access exp, app issue + 60 minutes). Input idle default 15 minutes. Normal heartbeat traffic does not renew idle time; meaningful authorized input may.

State-changing APIs require a session-bound CSRF token plus same-origin checks. No permissive CORS, wildcard Origins or origin suffix matching. SameSite is defense-in-depth, not the sole CSRF guard. The bootstrap is the only protected endpoint that creates the app cookie; other endpoints require both edge identity and app session.

## WebSocket connection intents
Create an intent only via an authorized CSRF-protected POST. It contains server-side subject, hashed app session binding, local device ID, view/control mode, creation time, 30-second expiry and atomic consumed flag. Return a non-bearer ID and same-origin path. Do not put JWT/VNC passwords, long-lived tokens or cookies in URL parameters or logs.

At upgrade validate the signed Access JWT, app cookie, exact allowed Origin, expected Host, supported subprotocol and bound intent. Reject null/missing Origin for browser endpoints. Consume atomically before allocating upstream resources; only one racing attempt can win. Even a consumed intent must recheck local revocation/ACL immediately before upstream creation. Browser custom authorization headers are not assumed; edge JWT injection and the cookie are available on the HTTP upgrade.

Map one app session to its active transport handles. Enforce absolute and idle deadlines server-side for the whole session. Cloudflare edge authentication at upgrade is not a substitute for stream expiry. On logout/revoke/expiry, close the browser transport AND guacd upstream even if browser cleanup fails. A local revocation must take effect promptly (proposed target ≤2 seconds). Access-policy changes alone may not instantly terminate a running stream; document and test the maximum residual lifetime. [S04,S05,S23]

## Authorization and protocol limits
Device IDs are resolved from an allowlist. For a per-device node, a non-local target ID is a bookmark only and cannot be dialed through this gateway. Reject host, port, protocol, password and upstream tunnel IDs in client bodies. No cross-node session use, arbitrary redirect, ad-hoc connection or generic socket proxy.

Server selects VNC `read-only=true` for a view session and disables clipboard writes. Do not rely on browser controls to enforce read-only. Guacamole supports this VNC parameter; verify it against malicious raw client instructions. Control/view change starts a new authorized tunnel, never merely flips a CSS button. [S14]

Use the official parser/transport rather than parsing instruction streams with a regex or splitting on commas. Apply bounded client input, clipboard and connection limits with backpressure. Do not blindly apply a tiny frame limit to screen data in the opposite direction. Disable unused file/audio/SSH/RDP features. Set connect and handshake deadlines; bound worker/process counts.

## Secret custody
Pilot: owner-provisioned VNC credential file outside repo, restricted permissions, read-only mount into the gateway, protected by the host's storage encryption. This is not an HSM; root or a compromised gateway can read it. Secret references, never contents, live in config. Set a distinct VNC password, not a macOS account password. Consider legacy VNC password limits/weak authentication; a longer UI field does not establish stronger protocol security. [S08]

No secrets in Docker image layers, compose environment literals, command lines, query strings, service workers, localStorage, telemetry, screenshots, Git history or this ZIP. Redact support bundles. Backups exclude secrets by default and explain separate recovery. No macOS password auto-fill or automatic unlock. Do not weaken FileVault, Screen Sharing permissions or macOS privacy settings to pass a test.

## Exposure controls
Gateway publishes only on host loopback; guacd has no published port; VNC is never forwarded by router/Tunnel. The VNC server may still listen on LAN/IPv6. Verify reachability and restrict it with an approved firewall path that still allows the local/container connection. Do not replace the entire PF ruleset or interrupt existing services. Public ingress must reject unmatched hosts/paths. Access is configured and negative-tested before adding the public Tunnel route.

Cloudflare proxies are inside the chosen trust model; do not advertise end-to-end secrecy from them. Do not claim Access/WAF inspects every post-upgrade desktop instruction. [S01,S05,S23]

## Browser privacy and hardening
CSP from same origin with no arbitrary script or framing; no third-party trackers, analytics, fonts or remote scripts. Block framing with frame-ancestors 'none'; Referrer-Policy no-referrer. Sensitive APIs and viewer navigations use Cache-Control no-store. Clear display and clipboard memory on disconnect/logout/pagehide. On pageshow (including bfcache restoration), cover the old display and revalidate before allowing interaction. Browser memory cannot be proven wiped at a forensic level; minimize retained state rather than claiming secure erasure.

Audit: metadata only (opaque user reference, node, result, timestamps, coarse reason, build ID, non-secret audit ID). Do not store raw session IDs or keystrokes. Proposed retention 30 days, local owner access, configurable purge and export. Timeouts/lengths are product defaults, not vendor limits.

## Emergency action
Local owner can stop the gateway/Tunnel route and invalidate app sessions. Keep the pre-existing authorized remote-access method until the new path passes acceptance. Public exposure and system-wide security changes are approval-gated even when normal coding is autonomous.
