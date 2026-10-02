# Build PWA Remote Desktop Gateway — full agent task

## Objective
Implement a personal browser-only remote desktop product for Wei Jun. From a Windows or macOS computer, open the owner's domain, authenticate through Cloudflare Access using an explicitly allowlisted email and OTP, choose Mac mini or MacBook Air, and control that Mac in the browser. No controlling-side AnyDesk installation, extension, VPN client or VNC viewer is required by the product. Target-side services are required.

This archive is a design and reference pack, NOT completed application code. Build the real integration. Read AGENTS.md before taking any action.

## Product baseline
Use a custom PWA frontend and a thin authenticated Java Gateway around **official Apache Guacamole Java/JavaScript libraries plus guacd**, connecting to macOS Screen Sharing via VNC. Do not build screen codecs or a raw VNC engine. noVNC is not mandatory and is not the baseline dependency. Do not integrate through undocumented Guacamole webapp REST endpoints. If the baseline fails a measured compatibility gate, write an ADR comparing alternatives and preserve the security/input contracts; do not silently switch stacks.

Use one gateway node per target Mac, with same-origin frontend/API/WebSocket and an independent target hostname. A central launcher is optional and must not be a required relay. Use first-level hostnames such as remote-mini.example.com and remote-air.example.com unless a certificate explicitly covers a deeper name. Do not invent the owner's actual domain or email.

## Mandatory preflight (P0)
Inspect the authorized workspace, git status, branch and uncommitted work. Read relevant KB/MCP knowledge if available; treat it as context, not live host evidence. Discover OS/architecture, available tools, existing ports, container runtime and tunnel management. Do not use VM-MCP to change a Mac host. Do not enroll a company PC merely because it is a browser client.

Validate the exact Guacamole client/server/library versions, Java javax-vs-Jakarta compatibility, signed release artifacts, security advisories and Apple-silicon image manifests. Source baseline is 1.6.0 as listed by the official release page when this pack was researched; recheck before installing. Docker-on-Mac is a pilot topology, not proof of post-reboot availability.

On an approved target, prove: guacd reaches the intended Screen Sharing server; authentication succeeds using a server-owned credential; a harmless test key appears in the correct macOS app; Command, Option and Control are calibrated. Record the actual keysym behavior rather than assuming Windows/Super and Mac/Meta aliases are interchangeable. Do not expose a public route before the negative authentication tests pass.

## Deliver real modules
1. Modular responsive PWA: launcher, device connection screen, desktop viewer, compact toolbar, keyboard profile sheet, virtual remote keys, explicit clipboard panel, connection/re-auth/offline/update states, diagnostics and session history.
2. Gateway: validated Access JWT identity, owner ACL, strictly configured targets, CSRF protection, host-only secure sessions, one-use WebSocket connection intents, server deadline/revocation enforcement, bounded metadata audit, secret loading and fail-closed startup.
3. Guacamole adapter: official display/tunnel/input objects, server-side VNC config, safe read-only connection parameter, cleanup, no credentials in the browser and no target changes from a websocket payload.
4. Cross-platform input layer specified in docs/03: native Mac profile, semantic Windows profile, optional left-Alt-to-Command profile, no global Ctrl remapping, AltGr/IME preservation, profile disclosure, virtual shortcut palette, lost-keyup recovery and no replay.
5. Deployment/operations: locked production versions/digests, startup configuration, local-only port publishing, server secrets, approved Cloudflare Access/Tunnel configuration, backup/restore, rollback and health checks.
6. Tests: unit, authenticated protocol integration, hostile-origin/IDOR/replay cases, real-browser UI, real Mac target and Windows-client acceptance, PWA multi-tab update lifecycle, offline privacy and session teardown.

## Authentication contract
Cloudflare Access handles OTP. Do not create a fake local OTP form. Gateway validates signature, allowed algorithm, trusted issuer, audience, expiry and identity claims using a vetted JWT library and bounded JWKS caching. Exact authorized identities come from server configuration. Verify every API call and WebSocket upgrade. Use a short-lived, host-only app cookie and a one-use session intent; do not put bearer secrets in URLs. Treat Cloudflare policy revocation and app revocation as distinct. Active streams require application timers and local revocation; a connection does not become permanently authorized after upgrade.

VNC authentication must remain server-side. Store its pilot secret in a protected mounted file outside source control or an approved vault. Never use the macOS account password as the VNC password. The OS login screen may still appear. Do not disable FileVault, auto-login or system privacy protections to make a demo succeed.

## Input contract
Never map all Windows Ctrl to Command. Default Ctrl+C must remain Control+C for Terminal. Offer explicit Windows left-Alt → Mac Command, leaving right Alt/AltGr for text composition and Option entry. Keep native mapping available. Do not infer application context from screen pixels. Shortcuts that are intercepted locally must have remote virtual buttons; an installed PWA does not bypass OS security. Text entry, IME composition and clipboard transfer are separate capabilities and require separate tests.

## PWA contract
Follow the product standard in docs/09. No sensitive offline content; no background remote-control queue. Never force activation/reload during an active viewer in any same-origin tab. Use a visible update prompt, server-backed session check, multi-tab coordination and an explicit disconnect/update transition. Revalidate on pageshow/bfcache restoration; hide old frames immediately on session loss.

## Work sequence and reporting
Create an isolated repository/worktree and a progress file tied to backlog task IDs. Build and test P0 before polishing. Implement vertical slices with tests, then release gates. Provide meaningful progress summaries and actual failures; do not request confirmation for ordinary coding. Request only genuinely required approvals/secrets/target access through appropriate channels; never ask the user to paste secrets into a public repository or chat transcript.

Keep reference tests intact. Translate policy vectors into Java/backend tests where appropriate. Add regression tests for every defect. Track unknowns explicitly. The archive's prototype is visual guidance, not production code to deploy unchanged.

## Required final output
A reviewable implementation commit/branch; build instructions; pinned dependency inventory; deploy and rollback runbooks; sanitized test evidence; real screenshots only from approved test apps; acceptance matrix with PASS/FAIL/BLOCKED; remaining limitations; exact deployment hosts and changes, if authorized. Distinguish pack tests from production tests. Do not declare the remote desktop ready until the real external-network browser-to-Mac acceptance succeeds.
