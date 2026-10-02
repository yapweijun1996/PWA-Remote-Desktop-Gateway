# 01 · Product requirements

## Problem and user journey
The owner has a Mac mini and MacBook Air, an owned domain and Cloudflare Tunnel experience. He wants browser-based human control rather than repeatedly installing or launching third-party controlling clients. A Windows computer may be only the **controller**, not an enrolled or managed target.

Normal path: open target hostname → Access OTP → device page → Connect → desktop → Disconnect. A launcher may list both targets, but directly bookmarking either target must work independently. A first session also selects a client-keyboard profile. Subsequent sessions may remember non-sensitive keyboard preferences locally, but not bearer credentials or screen state.

## Scope boundaries
V1 targets the existing macOS desktop on an explicitly enrolled personal Mac. It does not promise an isolated virtual macOS user session, a hidden screen, keyboard privacy from a local user, or control before the target OS/services are ready. A person at the target can see and interact with the same desktop. Document this before Connect.

The controller needs a supported browser and a usable network path. The target needs the gateway stack, Tunnel and Screen Sharing running. A hostname is an address, not a remote-control engine. Access authenticates the web entry; VNC and macOS still have their own authentication boundaries. [S01,S07,S08,S10]

## Required functions
| ID | Requirement | Acceptance |
|---|---|---|
| R01 | Exact-email Cloudflare OTP entry | Allowed mailbox works; unauthorized mailbox cannot reach protected data |
| R02 | Target selection/direct URL | Each configured target can be opened without the other Mac being online |
| R03 | Real desktop and pointer | Harmless text-editing, selection, drag and scroll succeed on the real target |
| R04 | Cross-platform keys | Mac-native, Windows-native and optional left-Alt profile pass the real-key matrix |
| R05 | Virtual remote controls | Command/Option/Control/Shift/Esc/Tab/arrows and allowlisted chords are accessible |
| R06 | Reconnect | Connection loss freezes/hides old display, clears input and requires fresh authorization |
| R07 | Clipboard | Explicit opt-in plain text transfer, independent from remote Cmd+C/Cmd+V |
| R08 | View-only | Server selects a non-interactive connection; UI-only disabling is insufficient |
| R09 | Sessions | One controlling session per target; bounded lifetime; owner can terminate current-node sessions |
| R10 | PWA | Installable production app, private offline behavior and explicit safe updates |
| R11 | Operations | Startup, log rotation, backup/restore and rollback documented/tested |
| R12 | Truthful state | UNKNOWN, AUTH_REQUIRED, UNREACHABLE and CONNECTED are not conflated |

## Capability tiers
Required V1: desktop, keyboard, pointer, profile sheet, remote-key palette, basic explicit text clipboard, connection lifecycle, authentication, private audit, PWA shell and safe updates. Chinese text must have at least one verified path: local IME and explicit transfer or remote IME. Do not claim both until both pass.

Best effort until measured: dynamic display resizing, multiple monitor selection, high-DPI fidelity, direct local IME composition into arbitrary macOS apps, browser clipboard permissions, function/media keys and pinch gestures. Show disabled/unavailable explanations rather than pretend support.

Out of scope V1: file manager, file upload/download, terminal, arbitrary shell, reboot button, Wake-on-LAN, native video/WebRTC engine, audio/microphone, session recording, public multi-tenant sharing, AI autonomous control, unattended FileVault recovery and Windows-as-target. Remote desktop itself is powerful enough to perform sensitive actions; excluding a toolbar button is not an OS permission boundary.

## Proposed defaults, not vendor promises
One owner; one controlling session per target; 15-minute input-idle timeout; 60-minute absolute application session cap; maximum age also bounded by the validated Access token; 30-second one-use connection intent; 30-day metadata audit retention; clipboard off by default, 16 KiB UTF-8 text limit when enabled. All values are explicit product choices, adjustable only within server-approved bounds. Timers start from server clocks; a browser heartbeat is not evidence of user activity.

## Success measurement
The release must pass a real macOS controller and a real Windows controller against each target, including at least one external-network path. Record observed first-frame and input latency, bytes transferred and CPU/RAM under a defined workload. No invented FPS, performance percentages, cost estimate, deployment progress or completed-device state.

## Accessibility and language
Modern uncluttered interface with clear English controls and optional Mandarin hints. Visible focus, 44px primary touch targets, readable labels and safe areas. Do not globally disable browser zoom. Remote-desktop canvas scaling is separate from page accessibility zoom. Mobile is an emergency-control companion, not a promise of desktop-keyboard parity.
