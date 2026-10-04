# Full-viewport desktop and on-demand controls

Status: DEPLOYED_LOCAL_RUNTIME_VERIFIED. Release 1.1.1, build f240110b80d1b587.
Source commit: d3dc697938c635a02db50a9e327419353ea6a42e on codex/workspace-sidebar-20261004. At the time of this deployment receipt, main was at cdc0cced41bb81f00a85710878bd2ea6aa6d262e and this feature had not yet been pushed or merged. Subsequent Git history records integration.

## Behavior

The connected desktop occupies the entire viewport. A small right-edge button opens a modal side panel with the existing controls and configuration. The panel overlays the desktop without resizing it. Its header and End session action remain visible while only the middle content scrolls. Escape, the close button and the backdrop close the panel.

Opening controls releases held input and pauses remote input. Closing controls restores local focus without automatically resuming input; focus the remote desktop to resume. Nested dialogs restore focus to their opener. Theme, localization, update status, virtual keys, clipboard, keyboard profile, diagnostics and sign-out remain accessible. Updates never silently reload an active session. Users should end the session, manually update to 1.1.1 and reconnect.

## Verification

- Node/reference/unit: 139 passed.
- Production Java build: 104 passed, zero failures, errors or skips.
- Signed local browser fixture: 18 passed; login browser: 8 passed; connection/sidebar/privacy browser: 28 passed.
- Sidebar coverage: nine viewport sizes in light and dark themes, full-viewport geometry, internal scrolling, accessible exits, keyboard focus and Escape, nested dialogs, fullscreen, localized narrow layout and long labels, session lifecycle and stale callbacks.
- Exact ARM64 image startup, SQLite and missing-identity refusal verified in an isolated network-none container.
- Deployed security/artifact/health checks: 16 passed. Anonymous public requests retain Cloudflare Access redirects. Gateway and unchanged Tunnel are healthy.
- Pinned dependency provenance verified: 11 JARs, SQLite natives, official Guacamole JavaScript and 393 locked OS package records.

## Deployment and preservation

Exact image: sha256:0e832e1d7709125d4358791e172b2f81aea173f3e02be2912f5fd8d49d38f4cf.
Only the gateway was replaced after confirming zero active upstream connections. Nine other containers, gateway environment, state/key mounts, loopback binding, non-root execution and read-only filesystem were preserved. Access policy and Tunnel configuration were unchanged. See deployment.json for exact identities and artifact digests.

Rollback environment is saved privately at /Users/yapweijun/.cloudflared/rdg-current-mac-pilot/owner-setup.env.before-sidebar-1.1.1-20261004. It references the previous image sha256:d9ccc9b0daa7f816c4c4578db74637cdee7ce9369b646b29f7959328841a584b. A rollback requires the same idle-session preflight and gateway-only replacement; it was not executed.

## Limits

All preview images use a clearly labeled simulated local connection fixture. No real desktop pixels, input, clipboard or credentials were captured. Real owner login and real desktop operation with this release, Safari and iOS acceptance remain unverified. No new vulnerability scan was performed. These checks do not claim complete cross-platform acceptance.

The saved deployment and live-check scripts are inspectable evidence, executed from the repository root. The deployment script deliberately refuses a runtime that does not match its recorded previous-image precondition.
