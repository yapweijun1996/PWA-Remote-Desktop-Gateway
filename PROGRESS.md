# Implementation progress

Branch: `codex/production-gateway`. The original main checkout is unchanged.

## Acceptance and authority

Local software preparation and disposable test fixtures are authorized. No target Mac, Access account, Tunnel policy, firewall, Screen Sharing settings or public route is authorized/configured. Real Mac, Windows/Safari/iOS and external-network gates remain BLOCKED until operator-provided evidence exists. Automated fixture tests cannot satisfy those gates.

## Plan

1. RDG-001/002: workspace preflight, maintained javax-compatible Java runtime, verified official artifacts and provenance.
2. RDG-005/006/007: JWT verifier, session/CSRF/intent/lease state, official Guacamole transport, bounded input, server expiry/revocation and hostile-request tests.
3. RDG-008/009/010/011: vanilla JavaScript viewer, normalized input, virtual keys, explicit clipboard, truthful UI, private offline shell and server-guarded multi-tab updates.
4. RDG-012/015: audit, deployment/rollback/backup instructions, exact build/test artifacts and acceptance matrix.

## Preflight

- Clean original `main` at intake; dedicated managed worktree and branch created.
- Development environment only: macOS 26.6.2 (25G83), Darwin ARM64; Node 23.10.0, npm 10.9.2, Java 17.0.17; Docker daemon 28.3.0 available. This does not identify either deployment target.
- Maven 3.9.16 downloaded into ignored local tools; upstream SHA512 verified.
- Reference tests: 74 PASS. Production tests not yet run.
- Guacamole official release/security/API pages rechecked. Current release 1.6.0; javax.websocket API verified. Tomcat 9.0.122 chosen to retain binary compatibility; dependency/security/runtime validation pending.
- Routed investigation/architecture/verification module files absent. Core/project rules apply.
- Bounded KB retrieval had no applicable exact-project implementation. Reuse PWA privacy/update warnings only; unrelated project decisions are excluded.

## External gates

RDG-003/004 and RDG-013/014/015 require actual approved targets, separate server-held VNC credential, calibrated modifiers, exact Access issuer/audience/owner and domain, approved additive Tunnel routes, and real controller/recovery acceptance. No credentials should be pasted in chat.
