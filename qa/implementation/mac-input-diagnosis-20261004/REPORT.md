# Real Mac input and clipboard diagnosis — 2026-10-04

Target: the owner's Mac (macOS 26.6.2, build 25G83) through the deployed gateway (web 1.2.10, guacd image `sha256:3cbaad3b…`). Port 5900 is the built-in Screen Sharing service (`com.apple.screensharing` enabled, launchd-owned socket, ARDAgent not running). `VNCLegacyConnectionsEnabled = 1`; the gateway's guacd authenticates with the classic VNC password only (security type 2 of the offered `[30,33,36,31,32,2,35]`). Keyboard layout ABC; secure keyboard entry not active. No password, typed text, clipboard content or key log was recorded.

## Owner observations (Windows browser)
| Test | Result |
| --- | --- |
| Send `hello` through Text / Clipboard, then right-click → Paste on the Mac | Old pasteboard content; the sent text never reached the Mac pasteboard |
| Remote Paste (virtual Command+V) with Command code Meta, Super, Alt, Hyper | Plain `v` typed for every code |
| Remote keys Spotlight button (Command+Space) and a held Left Alt → Command test | Spotlight never opened |
| TextEdit: `abc`, hold Control ~1 s, `a`, release, `x` | `abcax` (Control+A not applied) |
| TextEdit: `abc`, hold Left Alt (→ Command, Super) ~1 s, `a`, release, `x` | `abcax` (Command+A not applied) |

## Hop-by-hop verification on our side
- Browser: real `Guacamole.Keyboard` + real `RemoteInput` in Chromium with a Windows user agent (`browser-keyboard-probe.mjs`): Ctrl held → `0xffe3↓`, 500 ms later `0x61↓ 0x61↑`, then `0xffe3↑`; Left Alt (Left Alt → Command) → Command keysym held across the letter. Correct order, modifier held.
- Gateway: InputPolicy passes `key` instructions (unit and integration tests).
- guacd: the reviewed official daemon forwards Super/Meta/Alt/Hyper + V, Super + Space and Shift + a to an RFB server as exactly four KeyEvents each, modifier first and last, about 1 ms apart (`KeyProbe.java`, isolated network, fake RFB server).
- guacd clipboard: forwards ClientCutText within about 1 ms (`../clipboard-20261004/results.txt`).

## Mac unified log (read-only, templates only)
- Every connection checks in two agents: one as the console user (`euid 501, onconsole 1, vfb 0, loginwindow 0`) and one as root in a login-window virtual frame buffer (`euid 0, onconsole 0, vfb 1, loginwindow 1`).
- The root agents fail `com.apple.CFPasteboard` lookups hundreds of times (`Connection init failed at lookup with error 3 - No such process`; `Failed to set up CFPasteboardRef 'Apple CFPasteboard drag'`, `'DefaultAsciiKeyboardLayoutPasteboard'`).
- The agent repeatedly logs `mask N not set` for 0x1, 0x2, 0x4, 0x8, 0x10, 0x20, 0x40, 0x2000, 0x10000 and 0x800000 (left/right Control, Shift, Command, Option, Caps Lock and Fn device flags): the modifiers we sent were not registered as modifier state.

## Conclusion and limits
Our pipeline delivers held modifiers and clipboard text to the Mac's VNC server; on this Mac the built-in Screen Sharing in classic VNC password mode applies neither modifiers nor incoming clipboard text. Plain characters work. Public reports agree that the built-in service ignores client → Mac clipboard from non-Apple viewers. Whether Apple's ARD authentication (security type 30) or a third-party VNC server changes the modifier behavior is untested here: authenticating to the real Mac needs the owner's credentials, which this diagnosis did not use.
