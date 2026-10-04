# 07 · UI/UX specification

## Design intent
A small utility, not an enterprise monitoring console. Default screen: device name, truthful status, one Open desktop action, keyboard mode and a clear End session action. Hide diagnostics behind a drawer. Use complete English and Simplified Chinese catalogs, selected through App preferences. Device labels, clipboard text and diagnostic codes remain source data. The offline prototype is a design reference and has **no remote-control connection**.

## Screens
| Screen | Required content | Important states |
|---|---|---|
| Access login | Provider-hosted Cloudflare page | OTP/error/denied; not imitated by our app |
| Devices | Target name/type, last checked time, open action | Unverified, checking, reachable, offline, permission denied |
| Connection preparation | Selected target, control/view, keyboard profile | Verifying access, connecting, failed, cancelled |
| Desktop workspace | Display, capture status, full viewport display with an on-demand controls drawer | Connected, view only, input paused, reconnect required |
| Keyboard drawer | Client platform, explicit profile, virtual keys, help | Alt→Command warning, keyboard lock unsupported/denied |
| Clipboard panel | Explicit send/copy text actions and direction | Permission denied, too large, unsupported, cleared |
| Session end | Reason and reconnect or return | User ended, idle, absolute expiry, revoked, network lost |
| Settings/diagnostics | Build/version, nonsecret compatibility facts | No credentials shown, no global dangerous controls |

Device reachability is not the same as a working desktop. Show `Gateway reachable — desktop not tested` when only health is known. Do not label a bookmarked cross-origin node Online based on a locally configured string. Distinguish permission denial from offline.

## Launcher and preferences
The enabled local target is selected automatically in one compact device/connection panel. Shared-desktop consent is unchecked on preparation and remains required before Open desktop. Diagnostics and trusted-device management remain secondary actions. Truthful readiness wording is retained; no fixture data is included in the deployed launcher.

App preferences is available from the launcher and viewer. It provides System/Light/Dark appearance, English/Simplified Chinese language, capability-aware installation help and explicit update checking. Only `rdg:theme` and `rdg:locale` are added to localStorage; existing keyboard-profile storage is retained. Defaults follow browser language and system appearance. System appearance responds to OS changes; explicit themes also update opaque browser chrome. Language changes update titles, status, accessible labels and dates without translating device names, clipboard text or diagnostic event/reason codes. Opening preferences or changing these controls releases remote input without ending the session.

Installation is offered only after a real `beforeinstallprompt`; installed status comes from standalone display or `appinstalled`. Safari receives its own installation instructions. Unsupported browsers receive an explanation, never a fake install action. Native platform acceptance remains required.

## Workspace geometry
Web release 1.1.1 uses the whole viewport for the connected desktop. The launcher header and inline viewer hint are hidden while connected. A fixed 44×56 CSS-pixel entry at the right edge opens Remote controls; it respects the right safe area and stays available in native fullscreen. This replaces the prior persistent safety header at the owner's explicit request. The viewer is still exempt from smart-hide-on-scroll; its only persistent overlay is the small controls entry.

The native modal right drawer overlays the display without changing its size, fit or pointer geometry. Its heading/close action and End session footer stay fixed; only middle controls scroll. It holds target/profile, connection/input state, Keys, Clipboard, Release all, scale, fullscreen, pause, diagnostics, optional trusted devices, sign-out and App preferences. Themes/languages and capability-dependent disabled states are retained. Update notices move inside the drawer while connected, with a small entry indicator when an update needs attention, so they do not cover the desktop.

Opening the drawer pauses and releases remote input. Enter/Space, Tab focus confinement, Escape, close and backdrop dismissal are supported. Closing returns focus to the local entry, never automatically to remote capture; click the desktop to resume. Nested configuration/clipboard/key dialogs retain the parent drawer, close independently and restore focus to their original control. End, sign-out, expiry and offline cleanup close all modal surfaces and restore launcher controls. Shift+Esc remains the independent pause/release escape while remote capture has focus. The desktop's original aspect ratio may still require letterboxing; full page refers to viewer space rather than stretching remote pixels.

Provide fit-to-window and 100% display modes. Local scaling and remote resolution are distinct controls; disable remote resizing when not supported. Pointer coordinates must account for displayed scale/letterboxing exactly once. Do not zoom the entire UI to fit the desktop. Browser page zoom remains available outside the viewer.

## Keyboard safety UX
Show the current mode next to the device, for example `Windows · Left Alt → Command`. Changing it pauses input and releases held keys. Include a warning that OS shortcuts may remain local. Show input status in Remote controls. Its always-reachable entry and Shift+Esc pause path remain available; input is owned only by the focused remote surface.

Always offer End session and Release all. Remote modifier buttons indicate latched state; opening a text box releases them. A dedicated remote app-switch button sends a remote combination; Alt+Tab on the physical keyboard is not guaranteed to do so. The keyboard tester is a development-only, local, ephemeral diagnostic; never attach key logging to the production audit stream.

## Accessibility and responsive acceptance
Minimum primary target about 44×44 CSS px; body text comfortably readable, form controls at least 16px on mobile. Visible focus, semantic buttons/labels, drawer focus management and return focus on close. Respect reduced motion; no critical meaning expressed by color alone. No global `user-scalable=no`.

Phone widths 390 and 430, tablet 768/1024, desktop 1440; portrait and landscape; browser zoom 200%; long device names; errors and empty states. Use platform/system fonts, no external font/CDN dependency. Screen-canvas accessibility limitations must be disclosed; the surrounding control UI must remain accessible.

## Prototype contract
`prototype/` runs locally and demonstrates navigation, profile selection and logical key state only. All target statuses are Unverified. The placeholder display is not a mock live Mac screenshot; it explicitly explains that transport is absent. Buttons produce local UI feedback, never system commands. It is not registered as a production service worker and does not simulate a successful OTP login.
