# PWA 1.1.0 implementation and current-PC deployment

Date: 2026-10-04 (Asia/Singapore). Application source commit: 79012c9a91d1081beb196a33dabb426b3fc485b0 on dedicated branch codex/deploy-current-pc-20261004. The owner approved implementation, verification and deployment to this PC by choosing A. At deployment time, main had not been changed and no push had been performed.

Web release 1.1.0, build 083af71ae2cdaf38, is running at https://remote.gmb01.xyz on exact ARM64 image sha256:d9ccc9b0daa7f816c4c4578db74637cdee7ce9369b646b29f7959328841a584b. The gateway is healthy, UID/GID 10001, read-only and published only on 127.0.0.1:32120. Its JAR, index, worker and build metadata match the reviewed build. Java archive contents are identical to the prior image; one ZIP entry timestamp changed the whole-JAR digest. All 33 packaged application classes match target/classes, with no fixture classes in the image.

## Delivered behavior

The launcher combines configured devices and connection preferences without duplicate preparation actions for enabled local targets. Consent remains explicit and readiness wording remains truthful. Viewer safety controls, input profiles, scoped recovery, credential entry and trusted-device management are retained.

App preferences provides System/Light/Dark, English/Simplified Chinese, browser-capability installation help, current version/build and Check for updates. Explicit themes also update opaque browser chrome. Language changes update visible labels, accessible text, title and dates, retaining original device names, clipboard text and diagnostic codes. Opening preferences or changing theme/language releases input without reconnecting. Only nonsecret theme/locale values are added to storage; the existing profile preference remains.

Waiting workers supply the actual target version/build. Update discovery is bounded, duplicate actions are guarded, and connection state remains separate from update progress. The existing server reservation and node session checks defer activation while any desktop is active or cleanup is uncertain. Other or suspended tabs never reload automatically. Offline launch contains only generic help and appearance/language controls, never remote content or identity. Late clipboard read/stream/send/copy and diagnostics/history callbacks are discarded after disconnect or dialog invalidation; detached translation entries are pruned.

## Verification

| Check | Result and scope |
|---|---|
| Node/reference/unit | 139 PASS |
| Java unit/integration | 104 PASS, no failure/error/skip |
| Runtime provenance | 11 pinned JARs, SQLite native libraries, official Guacamole JS and 393 locked OS package records PASS |
| Browser regression | 18 PASS, disposable signed local HTTPS fixture |
| Login/manifest regression | 8 PASS, disposable local HTTPS fixture |
| Connection/PWA/privacy | 31 PASS including 6 delayed private-data checks, simulated local API/Guacamole; zero unexpected console/page errors |
| Metadata backup/restore | 3 PASS |
| Exact-image container | Isolated startup, SQLite and missing-identity denial PASS; no real target/host port |
| Deployed live checks | 16 PASS: anonymous/forged identity, Host/Origin, bootstrap, WebSocket and scoped cleanup denial, unsigned login, worker digest, no-store version metadata, Access redirects, gateway/Tunnel readiness |

Chrome 154.0.8037.93. Responsive fixture checks cover 320,390,430,713,768,1024,1440 widths in both locales/themes and native dialog focus/Escape behavior. Screenshots are clearly labelled LOCAL SIMULATED CONNECTION FIXTURE and contain no real desktop or owner identity. The initial live check observed one unsigned /login response at 400. Separate Python and Node probes, a repeated full 16-check run and five fresh HTTP clients returned the expected 401 HTML. Both outcomes denied access; the initial discrepancy cause remains UNKNOWN and its receipt is retained. No assertions or protections were weakened.

The full build log records Java/dependency verification before the final CSS refinement; web-build and subsequent browser/login logs record the final web identity 083af71ae2cdaf38. Browser fixtures temporarily alter a disposable worker and restore it. Historical browser receipts were saved into this directory, then restored at their original paths.

## Preserved runtime and recovery

Only gateway was replaced. Existing OWNER_SETUP/trusted-browser environment, device/key/state mounts, official-source guacd, Tunnel and Access policy were retained. Guacd and eight unrelated containers retained their IDs, images and start times. Established gateway-to-guacd connections were zero before replacement; this does not enumerate every browser tab or pending intent. Replacement resets in-memory application sessions and requires revalidation. It does not force browser reload or activate another tab's worker. The dedicated unchanged connector is ready and has four healthy edge connections.

The private environment change is only GATEWAY_IMAGE. The protected rollback file is ~/.cloudflared/rdg-current-mac-pilot/owner-setup.env.before-pwa-1.1.0-20261004, containing the preserved prior image sha256:513fe8ebfbd6c71dd4578e8e7919d7fdf386138b74217f321448c9f401ab7c7b. Rollback restores that owner-only environment file, then runs deployment/compose.owner-setup.yaml with the explicit local Docker socket, project rdg-current-mac-pilot and up -d --no-deps --pull never gateway. Guacd, volumes and Access protection stay in place. Rollback was prepared, not executed. deploy-current-pc.mjs captures the exact guarded mutation; its previous-image check prevents rerunning against this changed runtime. live-checks.mjs is reproducible from the repository root with the matching built web assets.

A deliberate reload of the owner's prior READY launcher reached the existing Cloudflare login page. The owner must complete OTP in the browser to inspect the authenticated deployed launcher; no email, OTP, token, password or cookie was collected. Deployment artifact/runtime verification is complete, while the positive authenticated UI observation is pending owner login.

## Remaining gates

Real Mac display/input, Windows controller, Safari/iOS installation/safe areas/rotation/native zoom, external positive connection and sleep/reboot acceptance remain unverified in this request. The broader release matrix stays BLOCKED. No new vulnerability scan or advisory resolution was performed. The inherited optional trusted-browser authentication behavior was preserved; no authentication-policy migration was part of this update. Viewer smart-hide and short-list scroll-to-top remain documented exceptions. No private desktop, clipboard, credentials or full protocol payload was saved.

See deployment.json, live-checks.json, test receipts and artifacts.json for exact evidence. The linked previews are fixture screenshots, not generated deployment evidence or a working Mac desktop.

Captured text logs are normalized to LF without trailing spaces for Git. Where normalization changed bytes, artifacts.json retains the original capture digest and size alongside the committed file digest. Test outcomes and assertions are unchanged.
