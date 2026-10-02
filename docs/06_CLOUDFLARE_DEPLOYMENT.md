# 06 · Cloudflare and deployment runbook

## Hostnames and certificates
Examples use `remote-mini.example.com` and `remote-air.example.com`; substitute an owned domain. `remote.example.com` is an optional launcher. Standard Universal SSL in a full setup normally covers the apex and first-level subdomains, not an arbitrary deeper name such as `mini.remote.example.com`. A deeper name needs confirmed matching certificate coverage. [S06]

Do not deploy this private control interface to an unprotected GitHub Pages URL. A public portfolio can contain sanitized documentation or a clearly labelled simulation, never the private device registry, stream or operational configuration.

## Ownership and existing tunnel rules
Read the target host's actual configuration source of truth. Locally managed tunnels and dashboard-managed tunnels have different configuration workflows; the supplied YAML is only a locally managed example. Back up the relevant configuration safely and propose an additive diff. Do not replace an existing tunnel, rotate credentials, stop another service or move a published project without approval.

Use distinct target identities. Running connectors for one logical tunnel on two unrelated Macs does not create a device selector: traffic may reach a different connector. Do not configure one tunnel/hostname to load-balance Mac mini and Air desktops. Each hostname must deterministically reach its intended target. [S01]

## Ordered rollout
1. Create the private Access application/policy for the exact hostname(s), with the owner's **exact verified email** allowed, all others denied. Do not use an unrestricted email-domain or Everyone rule.
2. Enable the selected one-time PIN identity method. Cloudflare handles email and OTP; do not implement a second OTP service or copy its login page. Email OTP proves access to the mailbox and is not by itself phishing-resistant MFA. Require strong security on that mailbox; a stronger IdP/passkey path can be a later policy upgrade. [S02]
3. Obtain the correct Access application audience and team issuer through the authorized console; provision them server-side. These are identifiers, not replacements for JWT signature verification. [S03]
4. Build the gateway and prove it rejects missing, forged, expired, wrong-issuer and wrong-audience assertions **before** public routing. There is no deployed development bypass.
5. Validate local listeners: host gateway `127.0.0.1:32120`, private guacd, no public VNC. Ensure the intended runtime can reach host Screen Sharing without opening it to untrusted peers.
6. Add the approved HTTPS hostname through the existing authorized Tunnel workflow. Do not publish `tcp://...:5900` as the browser application.
7. Test unauthenticated/unauthorized requests, authorized top-level OTP login, API authorization and WebSocket upgrade through the public hostname. A successful landing page does not prove WebSocket protection.
8. Test stream expiry, logout, revoked local app session, service restart and network interruption. Record browser, node and time.
9. Keep previous authorized access until all release-blocking checks pass; remove old access only after explicit approval.

## Session and WebSocket boundaries
Tunnel is transport, Access is edge identity/access control, and the gateway still enforces app authorization and active-stream lifetime. WebSocket upgrades can be authenticated while an existing stream outlives a subsequent policy/cookie change. Enforce app deadlines and logout upstream rather than assuming the edge kills every running connection. [S03,S04,S05]

The browser WebSocket API does not support arbitrary custom authentication headers. Use the edge-provided signed assertion at the upgrade and the origin-bound app cookie, with exact Origin and a bound one-use intent. Never put a reusable credential into the URL. Use same-origin APIs/transport for each node. [S23]

## Cross-node and logout behavior
A launcher can open each node in a top-level navigation. Do not bypass browser third-party-cookie protections with insecure shared tokens or iframes. Access SSO may reduce repeat prompts; it does not guarantee that every hostname logs in or logs out simultaneously. Define node logout as revoking that node's app session/tunnels and clearing its cookie. Offer a separate, documented Access sign-out action; do not claim global logout across targets until it is actually implemented and tested.

## Availability and costs
Tunnel/WebSocket networking, target upstream bandwidth, relay path and Mac availability affect experience. No FPS, latency, zero-cost plan or unlimited-bandwidth promise is made. Before production, check the owner's current Cloudflare plan, Access entitlements, acceptable-use constraints and chosen runtime licensing. This pack does not require a paid LLM service in the remote-control data path.

## Rollback
Remove/disable only the newly added hostname route or Access app as appropriate; stop this gateway; revoke app sessions; restore the approved prior config diff. Do not roll back by exposing VNC directly, disabling Access or deleting unrelated tunnels. Test alternate access before changing networking remotely.
