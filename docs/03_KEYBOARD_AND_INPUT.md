# 03 · Cross-platform keyboard and input contract

## The actual requirement
The owner must control the same Mac from either a Mac keyboard or a Windows keyboard without unexpected modifier substitutions. “Mapping” changes the **remote meaning of an event that reaches the page**; it cannot force the local OS/browser to deliver every event. Keyboard Lock is an optional feature-detected enhancement, not a universal browser guarantee. [S18,S19]

## Profiles
These are proposed product profiles, not claims about every VNC server's default behavior.

| Profile | Controller key | Remote logical key |
|---|---|---|
| mac-native | Command / Meta | Command |
| mac-native | Option / Alt | Option |
| mac-native | Control | Control |
| windows-native (default on Windows) | Win / Meta, when received | Command |
| windows-native | Left/Right Alt | Option; AltGr retains text-composition behavior |
| windows-native | Ctrl | Control |
| windows-alt-command (opt-in) | **Left Alt** | **Left Command** |
| windows-alt-command | Right Alt / AltGr | Original composition behavior / Right Option where applicable |
| windows-alt-command | Ctrl | Control |
| windows-alt-command | Win / Meta | Command when received |

Profile choice is explicit and visible during the session. Persist only the local preference, scoped by target and detected/selected client platform. Auto-detection is a hint, not authority; allow manual correction. Do not modify the user's OS-wide keyboard settings.

### The owner's requested example
With `windows-alt-command` active and the viewer focused, Left Alt+C is intended to send remote Command+C. Left Alt+V is intended to send remote Command+V. This does NOT synchronize the local and remote clipboards; it affects the clipboard inside the remote Mac. Alt+Tab may still switch local applications and must have a “Remote app switch” toolbar alternative.

Ctrl+C remains **Control+C**, especially for Terminal. Never automatically infer whether the foreground target app is Terminal and change this behavior. A Windows-familiar Ctrl-shortcut profile is deferred until a separately reviewed explicit mode can preserve Terminal semantics. There is no default “swap all Ctrl/Command”.

## Logical keys versus protocol keysyms
The profile layer emits logical roles such as CommandLeft or OptionRight, not guessed platform scan codes. The Guacamole adapter maps roles to X11 keysyms accepted by the actual Mac server. `Meta_L`, `Super_L` and a browser's `Meta` name are not proof of the same remote result.

Calibration gate: connect to the actual Mac, use a harmless text editor and visible macOS menu actions, establish which keysym yields Command, Option and Control, then record target OS build, VNC mode, Guacamole version, browser and mapping. Keep left/right identity where available. If the server collapses sides, disclose it and maintain reference counts so releasing one physical key does not release another still-held logical modifier.

The supplied reference module deliberately stops before keysym encoding. It tests state ownership/mapping, not Windows-to-Mac interoperability. Official Guacamole keyboard objects normalize input into keysyms; the adapter integrates that single normalized stream. [S12,S13]

## Event ownership pipeline
```text
Focused desktop/input sink
 → normalized key/input/composition event
 → browser shortcut/escape decision
 → profile + modifier state
 → logical-key ownership tracker
 → one Guacamole adapter
 → server authorized tunnel
 → Mac
```

No document-wide hidden keyboard capture. No capture while profile/settings/clipboard text fields are active. If a virtual button is used, route directly through the logical-key layer; do not manufacture DOM KeyboardEvents to trick the browser or noVNC.

`KeyboardEvent.code` describes a key position; `key` describes its produced value and modifiers. Do not derive printable text from `code` on non-US layouts. Use code/location for left-vs-right profile decisions, and normalized character/composition data for text. Missing/Unidentified code must degrade safely to engine handling, not guessed physical mapping. [S20,S27]

## State machine invariants
- On keydown, snapshot the exact remote logical key and source ownership. Keyup releases that snapshot even if Shift, profile or focus changed.
- Refcount aliases that map multiple sources to the same remote modifier. Releasing Left Alt must not release a still-held Meta key also owning Command.
- Repeats must not create unmatched additional pressed entries. Character auto-repeat is a separate engine policy; the reference intentionally suppresses duplicate state transitions.
- Release all owned keys in reverse acquisition order on blur, hidden document, loss of capture, profile switch, disconnect, pagehide, explicit Release all, or an update transition.
- Release mouse buttons as well. Release calls on a live transport are best effort; when the socket is already gone, clear local state and close the upstream session server-side. Do not claim a release was delivered without transport proof.
- A reconnect creates a fresh upstream session and starts with zero keys/buttons down. Never replay keystrokes, click history, paste or drag after network recovery.
- A keyup for a key not owned by the current session is ignored. No event from another session/tab is accepted.
- Failures in an event sink must end/clear the input session, not silently continue with inconsistent held keys.

## Composition, AltGr and international input
Right Alt may participate in AltGr, sometimes alongside synthetic Ctrl state. Do not convert that into Command or suppress characters such as @, €, braces or backslash. A held Ctrl used for AltGr must not leak as a remote shortcut. Test a genuine Windows international layout; synthetic DOM tests are not sufficient.

While composition is active, do not forward partial Latin keystrokes and then send the completed Chinese text again. Support two explicit strategies: (1) remote IME mode, forwarding keys for macOS to compose; (2) local IME through the engine's input/composition support, with a dedicated Text/Clipboard panel as fallback. Deliver committed text once. Do not mix these streams. Test “你好，世界” and a multiline sample; verify punctuation, selection and no duplication. The reference module ignores composition entirely rather than pretending it implements it. [S12]

Dead keys, non-Latin characters, emoji and grapheme clusters need actual engine/target tests. Do not loop JavaScript UTF-16 code units as independent keysyms. The plain-text clipboard panel can be the documented fallback if the target supports it; no claim of universal Unicode typing through classic VNC.

## Virtual remote-key palette
Always-visible access to Command, Option, Control and Release all. Expanded palette includes Shift, Esc, Tab, arrows, Backspace, Forward Delete, Enter and allowlisted combinations: Command+C/V/X/Z/A/S, Command+Tab, Command+Space. Disable unavailable actions with a reason. Do not add a one-click destructive command, shutdown or arbitrary macro runner.

Modifiers can be latched for touch/keyboard users, show an active state, and release after the next non-modifier chord or an explicit cancel. Opening a text-entry panel releases them. A virtual chord is atomic: acquire modifiers, send key down/up, release only modifiers acquired by that action. Never release a physical modifier owned elsewhere. Reject or queue a virtual chord until a clean input boundary if ownership cannot be kept correct. V1 reference chooses to reject chords while any physical key is held.

Esc is not a reliable universal escape from browser/OS fullscreen constraints. Provide a visible End control button and document browser-native fullscreen exit; never create keyboard traps. Optional keyboard-lock permission denial must leave the UI fully usable.

## Clipboard is three different actions
1. **Remote Copy/Paste shortcut** sends Command+C/V to the Mac.
2. **Send local text to remote clipboard** is user-initiated, plain text, size-bounded and subject to target capability.
3. **Copy remote clipboard locally** requires a user gesture and browser permission/behavior.

Clipboard API behavior differs between browsers and requires secure contexts; do not assume permission names are portable. If permission is denied, show a normal selectable text area and native paste UI. No silent background polling, password-manager scraping or automatic clipboard overwrite. Clear the panel on disconnect and never audit its content. [S26]

## Pointer and display details
Capture only inside the viewer. Translate client coordinates through the current display scale and offsets once; clamp to bounds. Test retina/high DPI, 100%/fit scaling, resize while dragging, right click, wheel direction and click-drag selection. Touch modes must be explicit (trackpad-like vs direct); a two-finger scroll must not become an unintended drag. Pointer events stop immediately when input is disabled. Remote resize is capability-dependent; local canvas scaling does not change the Mac's resolution. [S13,S14]

## Required real-device cases
Mac Chrome and Safari → each Mac; Windows Chrome and Edge → each Mac. Current release versions must be recorded rather than inferred from UA alone. Test native and opt-in mappings, short/long holds, key release outside viewer, tab switch, OS app switch, monitor change, reconnect, capture revoke, Terminal Ctrl+C, editor Command shortcuts, AltGr, dead keys, Chinese composition and separate clipboard actions. iOS Safari installed mode is an additional usability gate, not a substitute for Windows/macOS testing.
