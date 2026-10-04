# 07 · UI/UX specification

## Design intent
A small utility, not an enterprise monitoring console. Default screen: device name, truthful status, one Open desktop action, keyboard mode and a clear End session action. Hide diagnostics behind a drawer. Use complete English and Simplified Chinese catalogs, selected through App preferences. Device labels, clipboard text and diagnostic codes remain source data. The offline prototype is a design reference and has **no remote-control connection**.

## Screens
| Screen | Required content | Important states |
|---|---|---|
| Access login | Provider-hosted Cloudflare page | OTP/error/denied; not imitated by our app |
| Devices | Target name/type, last checked time, open action | Unverified, checking, reachable, offline, permission denied |
| Connection preparation | Selected target, control/view, keyboard profile | Verifying access, connecting, failed, cancelled |
| Desktop workspace | Display, capture status, compact sticky toolbar | Connected, view only, input paused, reconnect required |
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
Desktop/tablet: single opaque top bar, display fills remaining viewport, side drawer overlay only when requested. Avoid persistent oversized sidebars. The viewer does not auto-hide its safety controls with scroll; this is a documented PWA smart-topbar exception. Mobile: safe-area-aware top bar, explicit touch mode, bottom key tray above the home indicator. Use `100dvh` with tested fallbacks rather than brittle full-height assumptions.

The production workspace uses one shared header: target and keyboard profile, connection/input status, Keys, Clipboard, More, Release all and End session. More contains scale, fullscreen, pause, keyboard profile, diagnostics, optional trusted browsers and node sign-out. Opening More pauses input; Escape returns focus to its trigger. Fullscreen includes the header so safety controls remain visible. Narrow screens use two compact rows and labelled icon buttons while End session keeps its text. The mobile bottom key tray remains a future layout enhancement; current virtual keys open in the existing accessible dialog.

Provide fit-to-window and 100% display modes. Local scaling and remote resolution are distinct controls; disable remote resizing when not supported. Pointer coordinates must account for displayed scale/letterboxing exactly once. Do not zoom the entire UI to fit the desktop. Browser page zoom remains available outside the viewer.

## Keyboard safety UX
Show the current mode next to the device, for example `Windows · Left Alt → Command`. Changing it pauses input and releases held keys. Include a warning that OS shortcuts may remain local. Display a small persistent `Input active` or `Click desktop to control` state, never capture document-wide.

Always offer End session and Release all. Remote modifier buttons indicate latched state; opening a text box releases them. A dedicated remote app-switch button sends a remote combination; Alt+Tab on the physical keyboard is not guaranteed to do so. The keyboard tester is a development-only, local, ephemeral diagnostic; never attach key logging to the production audit stream.

## Accessibility and responsive acceptance
Minimum primary target about 44×44 CSS px; body text comfortably readable, form controls at least 16px on mobile. Visible focus, semantic buttons/labels, drawer focus management and return focus on close. Respect reduced motion; no critical meaning expressed by color alone. No global `user-scalable=no`.

Phone widths 390 and 430, tablet 768/1024, desktop 1440; portrait and landscape; browser zoom 200%; long device names; errors and empty states. Use platform/system fonts, no external font/CDN dependency. Screen-canvas accessibility limitations must be disclosed; the surrounding control UI must remain accessible.

## Prototype contract
`prototype/` runs locally and demonstrates navigation, profile selection and logical key state only. All target statuses are Unverified. The placeholder display is not a mock live Mac screenshot; it explicitly explains that transport is absent. Buttons produce local UI feedback, never system commands. It is not registered as a production service worker and does not simulate a successful OTP login.
