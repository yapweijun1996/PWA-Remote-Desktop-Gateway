# Compact workspace layout verification

Date: 2026-10-04, Asia/Kuala_Lumpur. Implementation branch: `codex/compact-workspace-ui`; base: `f9a069b`. The owner requested the preview-image layout, a focused commit and a merge into local `main`.

## Behavior

The connected workspace shares a single opaque header with the launcher. Device/profile and connection/input status sit beside Keys, Clipboard, More, Release all and End session. More provides scaling, fullscreen, pause, profile, diagnostics, optional trusted browsers and node sign-out. Opening menus/dialogs pauses input; Escape and dialog close restore focus without recapturing the desktop. Sign-out uses its existing handler and returns to the launcher when the workspace ends. Fullscreen includes the header. At 840px and below the header uses two compact rows; phone buttons retain accessible labels and 44px targets. No dependency, remote protocol, credential, Access or deployment setting changed.

Testing exposed a 761px horizontal overflow, corrected by moving the two-row breakpoint to 840px. It also exposed an existing view-only status regression: display fitting paused input after `start('view')` and replaced the label with a control-mode pause message. The default pause label now preserves View only, with a unit regression and browser reconnect check. Input restrictions are unchanged.

## Evidence

- `npm test`: 109 PASS, zero failures, including original reference tests and focused input regression.
- `npm run build:web`: PASS, build `d3d201de7cabda02`.
- `npm run test:connect-browser`: 19 PASS in Chrome `154.0.8037.97`, zero JavaScript/unexpected-console/fixture errors. Ten existing connection lifecycle cases and nine new UI cases are recorded in [connect-browser-results.json](connect-browser-results.json).
- 862×844: one 65px header; 728px surface with an extra 24px test-only banner. Tested widths: 320, 390, 430, 760, 761, 768, 780, 800, 820, 840, 841, 862, 1024 and 1440; landscape 850×390. Long synthetic labels preserve visible safety controls and viewport bounds.
- Enter/Space/Escape, menu/dialog focus restoration, scale selection, diagnostics/profile access, native Chromium fullscreen, disconnect reset, view-only controls and workspace sign-out PASS. Screenshots are in ignored `output/playwright/workspace-refined-{862,menu,mobile}.png` and clearly identify simulated data.
- Independent read-only source review found no P0/P1 in changed input ownership, cleanup, fullscreen, privacy or view-only paths. Its responsive concern was reproduced and corrected.
- `git diff --check` and JavaScript syntax checks PASS. [workspace-artifacts.json](workspace-artifacts.json) records exact current source, web-output and evidence digests; it supersedes prior ledgers only for this UI build.

## Limits and reproduction

The loopback fixture uses simulated APIs and Guacamole. It verifies the production UI's layout and focus/state transitions, not real Access authentication, desktop pixels, pointer scaling, physical key transmission, clipboard delivery or backend revocation. No real Mac, Windows, Safari/iOS, hardware safe-area or browser-zoom acceptance is claimed. The stronger Java/official-protocol browser suite was updated for the new visible Release all action but not rerun: the development host lacks a Java runtime. Existing release gates remain unchanged. Nothing was deployed or pushed by this task.

Use an installed Playwright module and Chromium-compatible executable:

```sh
npm test
npm run build:web
RDG_PLAYWRIGHT_MODULE=/path/to/playwright RDG_TEST_CHROMIUM=/path/to/chromium npm run test:connect-browser
node scripts/verify-artifacts.mjs qa/implementation/workspace-artifacts.json
```

Before delivery to the personal gateway, rebuild its artifact, verify the exact UI build and preserve the existing active-session/update boundary. This report is local verification, not a deployment receipt.
