# 09 · PWA lifecycle, privacy and updates

This is a remote-control utility: **offline desktop control is not a feature**. An offline launch shows a generic explanation and retry action, not the previous user's desktop, device list, identity or clipboard. Installability is not completion.

## Static versus private resources
Use a generic non-personalized shell and fingerprinted self-hosted assets. Cache only an explicit safe list of immutable assets plus a generic offline page. Deny API, tunnel, login/OTP, identity-bearing HTML, redirects, errors, signed URLs and any unknown request. Never cache arbitrary successful responses just because they have a static-looking extension. Restrict methods to GET, same origin, exact allowed path, no query credentials, correct content type, successful nonredirected response. Sensitive endpoints always set no-store. [S22]

The reference cache predicate is a unit-testable guard, not a finished service worker. The full implementation must prevent cross-user data visibility through Cache Storage, IndexedDB, browser history/bfcache and DOM snapshots. On pagehide/disconnect/logout, cover and clear display buffers; on pageshow require revalidation. Never preload or save screen frames for “offline use”.

## Update protocol
A new worker installs and waits. Offer `New version available`; do not automatically call skipWaiting and reload an active desktop. Clicking Update shows a loader and a deliberate session-ending confirmation when appropriate. Release keys/buttons, terminate server tunnels, and wait for a clean session boundary before activating/reloading.

Multiple tabs make this nontrivial: coordinate same-origin clients and server-known active sessions. A suspended tab must not be assumed idle because it missed a BroadcastChannel message. If another controlled session exists or cleanup is uncertain, defer activation. The server must revoke stale clients/tunnels on a deliberate forced update, not depend only on browser callbacks. Test two tabs, bfcache return and an old suspended build.

Version caches and worker bytes by build. Keep old assets required by active clients until the accepted transition; clean obsolete caches after a safe activation. Provide update-failed state and retry; do not leave an overlay forever. Register no worker in the included offline UI prototype.

## Versioned update experience (web release 1.1.0)
`web/src/release.mjs` owns the web release version. `scripts/build-web.mjs` derives a reproducible 16-hex build identity from source bytes and injects it into the application, worker and generic `/build.json`. The launcher and preferences show the current version/build. A waiting worker reports the actual target version/build over MessageChannel; older workers without this interface still show a generic explicit update action rather than invented target metadata. Build metadata is no-store and outside the offline cache. The Java package version remains independent.

Check for updates uses worker registration discovery and a bounded wait. Checking, available, up-to-date, deferred, updating, reloading, failed and unavailable states are visible. An active connection keeps its own status. Activation requires zero server-known active desktops, successful local cleanup, and the existing server reservation from the waiting worker. Duplicate update/check requests are guarded. Discovery cannot overwrite an in-progress loader. Another or suspended tab with a changed controller receives an explicit refresh action and never silently reloads. A pending connection invalidated during preparation is scoped-cancelled; uncertain cleanup prevents activation.

The generic offline shell has the same appearance/language controls and cached self-hosted assets, with no session, device list, desktop or clipboard. Dialog/request generation and session epoch guards discard late clipboard/diagnostic callbacks after closing, disconnecting or losing authorization; detached translation nodes are pruned when private lists clear.

## Install and mobile contract
Manifest: stable application id/name, start URL/scope, standalone display, intentional opaque theme/background, icons including appropriate maskable artwork. Production requires HTTPS. Light/dark themes must use matching solid safe-area/system-chrome surfaces. `viewport-fit=cover`, safe-area inset CSS, mobile form font at least 16px and adequate touch targets. Do not disable browser zoom globally.

Viewer safety bar stays visible; smart hide-on-scroll is N/A on this no-scroll screen. Apply it only to meaningful scrolling lists. Scroll-to-top is N/A for the initial short device list. Document these exceptions rather than blindly implementing decorative scrolling behaviors.

## Required lifecycle acceptance
STARTING, AUTH_REQUIRED, READY, CONNECTING, CONNECTED, INPUT_PAUSED, OFFLINE, REAUTH_REQUIRED, UPDATE_AVAILABLE, UPDATING, RELOADING and ERROR must each have visible, nonmisleading UI. A PWA window does not remove all browser or OS keyboard reservations. [S18,S19]

Verify current Chrome desktop install, Safari Add to Dock/standalone behavior as supported on the actual platform, iOS Safari installed mode, safe areas, rotation, reduced motion, 200% browser zoom and permission denial. Do not report a headless desktop test as a real iOS pass.
