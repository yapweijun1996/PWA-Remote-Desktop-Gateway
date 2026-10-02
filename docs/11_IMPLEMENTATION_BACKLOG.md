# 11 · Implementation backlog

Tickets are ordered by dependency, not time estimates. Each ticket produces a small reviewed commit and evidence. No arbitrary completion percentage.

| ID | Priority / dependency | Deliverable and acceptance |
|---|---|---|
| RDG-001 | P0 / none | Inspect authorized repo/host/tunnel; branch/worktree; record preflight and open gaps |
| RDG-002 | P0 / 001 | Recheck official Guacamole versions/advisories, Java javax.websocket compatibility and ARM64 image support; pin verified artifacts |
| RDG-003 | P0 / 002 | Local official Java/JS/guacd → real Mac desktop; visible harmless editor input; no public ingress |
| RDG-004 | P0 / 003 | Calibrate Command/Option/Control keysyms, demonstrate Windows and Mac event paths; capture browser reservations |
| RDG-005 | P0 / 003 | Signed Access JWT verification + exact owner authorization; failing negative tests prove no bypass |
| RDG-006 | P0 / 005 | Host-only sessions, CSRF, one-use intents, controller leases and authenticated WS endpoint |
| RDG-007 | P0 / 006 | Server idle/absolute expiry, logout/revocation, upstream resource cleanup; raw view-only abuse test |
| RDG-008 | P1 / 004,006 | Single input adapter, three profiles, key ownership, release safety, AltGr/IME strategy and pointer scaling |
| RDG-009 | P1 / 008 | Virtual key/chord palette, copy versus clipboard distinctions, permission-denied fallbacks |
| RDG-010 | P1 / 006 | Minimal device/workspace UI, truthful statuses, accessibility and safe-area mobile behavior |
| RDG-011 | P1 / 007,010 | PWA shell/offline privacy, explicit worker update and multi-tab active-session guard |
| RDG-012 | P1 / 007 | Metadata-only audit, retention, sanitized diagnostics, secret/backup policy |
| RDG-013 | P1 / 005–012 | Approved one-node Tunnel/Access rollout, full negative and external-network acceptance |
| RDG-014 | P1 / 013 | Second independent Mac node; direct-node fail independence; no cross-node session reuse |
| RDG-015 | P1 / 014 | Complete controller matrix, recovery/lock/sleep tests, documentation and owner handoff |
| RDG-016 | P2 / V1 accepted | Optional multi-monitor enhancements, stronger IdP authentication or custom native agent feasibility ADR |

## P0 stop/go record
Answer before building a polished portal: Does the actual Mac accept the selected VNC mode? Do browser→Guacamole events produce the intended modifiers? Does the chosen Java runtime support the library API? Can the container reach host VNC without broad exposure? Does gateway auth fail closed before public routing? What startup/restart path actually works?

If an engine fails a gate, write a short ADR comparing a bounded alternative (e.g. noVNC for browser display or a supported stock Guacamole deployment). Do not silently replace the auth model, expose a password field to the browser or claim an untested custom remote engine is complete. The owner did not require noVNC.

## Agent delivery requirements
Complete software should eventually include frontend, gateway build/runtime, dependency lock files, migrations if used, official-library integration, tests, safe templates, install/uninstall/rollback procedure and a compatibility matrix. The current ZIP supplies the brief and references; it does not supply those completed backend binaries.

Inspect code before modifying it. Keep existing uncommitted work and current production configuration safe. Request specific approval only for genuinely external/privileged changes; continue coding/tests/documentation on safe isolated work. Report every remaining blocked item with the missing evidence and exact next verification action.
