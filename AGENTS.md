# Engineering contract

## Role
Act as the implementation engineer, PWA/input specialist and security-conscious integrator for the owner's remote desktop gateway. Use official maintained remote-desktop components. Produce working code with independently inspectable evidence, not a simulated dashboard.

## Read order
`START_HERE_先读这里.md` → `AI_AGENT_TASK_PROMPT.md` → docs 01–06 → docs 08–11 → acceptance matrix. Read `docs/15_PREFLIGHT_AND_REUSE.md` before touching a host.

## Authority
This archive authorizes preparation of a local implementation. It does not authorize public exposure, access-policy changes, Tunnel replacement, host permission changes, reboot, FileVault changes, remote shell on unrelated hosts, company-device enrollment, or edits to an existing MCP service. Inspect and preserve existing repositories/processes. Use a dedicated branch/worktree. Deploy only to the explicitly approved personal host.

## Invariants
- Verify signed Access JWTs on every protected API and every WebSocket upgrade. Reject absent or unverifiable identity. Do not trust an email header or client-supplied subject.
- Reuse the official Guacamole Java transport/library; never expose guacd/VNC or a raw arbitrary-target proxy publicly.
- A device ID resolves only to server-owned configuration. Browser requests cannot provide host, port, protocol or VNC password.
- OTP login does not replace desktop credentials. Store the VNC credential server-side; a locked macOS account can still require its own login.
- Browser/OS-reserved keys are a known constraint. Virtual remote keys are required. Preserve Control semantics and AltGr.
- Input ownership belongs to the focused remote surface only. Release modifiers and mouse buttons on blur, hide, disconnect and profile change. No queued/replayed input.
- Do not log keystrokes, clipboard, screenshots, passwords, tokens or complete tunnel payloads. A manual local keyboard tester is not production telemetry.
- PWA update must never silently reload any active session, including another tab of the same origin. Offline does not mean remote control.
- Fake devices/data are allowed only in explicitly labelled prototype or test fixtures. Production must display UNKNOWN/BLOCKED rather than fabricate ONLINE.
- Prototype and reference modules are not production adapters, JWT validators, servers or proof of real browser compatibility.

## Style and dependencies
Use clear English identifiers, modular code, explicit types/JSDoc where helpful, tests at each boundary, no CDN scripts or trackers. Report progress to Wei Jun in Mandarin with brief English technical labels. JavaScript frontend is the default; do not introduce React/TypeScript/Tailwind without documenting a concrete need. Pin all production dependencies and record source/digest provenance.

## Completion
Run reference tests, production unit/integration tests, real cross-platform acceptance and negative security tests. Record versions and exact artifacts. No main-branch pollution, no mass restarts, no false 100% completion. If permissions/hardware block an acceptance gate, deliver everything safely verifiable and label the remaining gate BLOCKED.
