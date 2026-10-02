# PWA Remote Desktop Gateway

**Agent implementation handoff, v1.0 — 2026-10-02.**

Browser-only access to the owner's Mac mini and MacBook Air through an owned domain, Cloudflare Access email OTP, and Cloudflare Tunnel. Own the PWA experience; reuse a maintained remote-desktop engine.

## Status

This archive contains specifications, local reference code, configuration blueprints and a non-networked UI prototype. **It is not a working remote-desktop server.** No real Mac, Windows client, Cloudflare account, Guacamole tunnel or deployment has been tested by this handoff. Read `qa/PACK_VALIDATION.md` for checks actually performed.

## Baseline

```text
Windows/macOS browser
  → HTTPS + Cloudflare Access (exact owner email / OTP)
  → Cloudflare Tunnel on the target Mac
  → own Gateway (JWT verification, sessions, policy, audit)
  → official Guacamole Java API → guacd
  → macOS Screen Sharing (VNC)
```

Frontend: modular JavaScript/HTML/CSS, built into the Gateway's same-origin static resources. Backend: a thin Java service using official Guacamole libraries, not a newly written VNC encoder or a guessed Node wrapper. Proposed persistence: SQLite for bounded audit/settings, configuration for device enrollment, server-side secret files for the pilot. The full upstream Guacamole webapp and its internal REST API are NOT the baseline.

Each Mac has its own gateway node and hostname. A small authenticated launchpad can link nodes, but no inter-Mac relay is needed. The nodes can be on different networks. V1 has one owner and one controlling session per target. See ADRs and portability gates before choosing Java/container versions.

## Start

1. Read `START_HERE_先读这里.md` and `AGENTS.md`.
2. Give `AI_AGENT_TASK_PROMPT.md` to the implementation agent.
3. Run `npm test` to verify the pure reference modules.
4. Run `npm run preview` to inspect the design prototype locally.
5. Implement into a new repository/worktree. Never present the prototype as a live connection.

No npm installation is required for the reference tests or preview. Production dependencies, lockfiles, image digests and build artifacts must be created and verified by the implementation agent.

## Key requirements

Cross-platform keyboard profiles; on-screen remote shortcuts; no automatic Ctrl-to-Command remapping; preserved AltGr/IME; matched keydown/keyup; release-on-blur; no input replay after disconnect; server-enforced authorization and expiries; exact WebSocket Origin validation; no cached credentials, clipboard contents, screen images or personalized offline pages.

## Acceptance

A screenshot of the UI, an HTTP 200 or a passing local unit test is not remote-control acceptance. Real external-network login, desktop display, harmless input, Windows and macOS keyboard checks, negative security tests, reconnection, log redaction and update lifecycle tests are required. Every unexecuted test stays NOT_RUN/BLOCKED.

## Sources and ownership

`docs/14_SOURCE_REGISTER.md` lists official public sources checked for this design. Specifications and reference code were prepared for the owner. Upstream software is not bundled; preserve upstream licenses/notices when adding it. The owner must choose the public repository license before publication. The archive does not grant rights to unrelated upstream assets.

## Verification summary

74 reference tests passed. Four prototype screenshots are in `qa/screenshots/`. 25 local UI/HTTP boundary checks passed, using an offline DOM render because browser localhost navigation was policy-blocked. This is not real-browser HTTP integration or Mac acceptance. See `qa/pack-validation.txt` for exact scope; all 64 real-system acceptance cases remain NOT_RUN. Verify the untouched archive with `npm run verify`.
