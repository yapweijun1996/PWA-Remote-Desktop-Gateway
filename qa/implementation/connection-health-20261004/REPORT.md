# Compact FPS and network health diagnostics

Status: DEPLOYED_LOCAL_RUNTIME_VERIFIED. Web release 1.2.1, build 0ebbd94b65f916a1.
Source commit: 85f2d782bf3b8465d0c3e9cadf85686e0ae4c18d on codex/connection-health-20261004. Source and evidence remain on this dedicated branch; no merge or push for this feature. A previous remote push remains unapproved.
Exact Linux/ARM64 image: sha256:7fe91d1e9a375b1433c63a0538c646e745f4a52ace947557b8e98da00de7f088.
Healthy gateway container: 9ef2ef2889cad7c0ca39c76383670e471419afb0c20a9e11e0313423de7aaf8c.

## Behavior

The controls drawer is capped at 320 CSS pixels, with a fixed header and End action, one scrollable middle and collapsed bandwidth detail. Network/FPS observations appear before picture configuration. EN/zh-CN and light/dark remain supported.

The official 5-second Display statistics window is enabled. Client/gateway FPS, optional remote-desktop FPS and processing lag are finite nullable values; values expire after 5 seconds without updated statistics. Missing or idle data displays an em dash. A still desktop's low FPS is not a failure. No FPS limiter or codec changes were added.

Manual authenticated HTTP ping and optional 5-second live measurements use existing no-store /api/session. Live requests run only with this panel open and the document visible; one request in flight, stale responses invalidated on close/hide/end/reconnect/auth loss. The independent mandatory authorization heartbeat is preserved. Up to 9 numeric samples remain only in memory; at least 3 recent samples are needed for stability. Average over 300 ms or mean absolute successive variation over 100 ms is flagged as a UI heuristic. Samples expire after 15 seconds and restart after failure. This measures browser/network/gateway HTTP work, not ICMP ping, packet loss, network capacity or input-to-visible latency.

Advice distinguishes browser offline/background, official unstable stream, failed HTTP check, client processing over 50 ms and slow/variable HTTP RTT. It cannot identify a specific internet hop or unmeasured remote Mac CPU; remote/gateway problems remain possible even with stable HTTP. Disconnect clears private display/input and numeric metrics.

## Failure investigation

Pinned official WebSocketTunnel calls onerror before setting CLOSED, and official Client.disconnect sends a disconnect instruction. Synchronous application teardown therefore could send on a closing socket. Cleanup now waits one microtask, ignores callbacks after teardown and refuses adapter-owned sends on a disconnected tunnel; official cleanup still clears timers. Regression tests use actual pinned official Client and WebSocketTunnel with minimal DOM/socket boundary doubles, including a held key and closed transport. Manual close still sends the official disconnect once.

409 remains a deliberate server refusal, whose exact code is required: CONTROL_BUSY does not allow automatic takeover and only an owning-app status snapshot can show explicit scoped recovery; UPDATE_IN_PROGRESS is an update reservation. Existing controlled 409 recovery tests pass. The supplied live 409's Response code and authenticated owner reproduction are unavailable, so its actual cause is UNKNOWN, not fixed by assumption.

The PWA beforeinstallprompt warning describes intentional deferred installation; Preferences has the user-triggered install button. The VideoFrame warning was not reproduced. Neither application source nor pinned vendor calls WebCodecs VideoFrame/VideoDecoder; this does not establish the browser warning's origin. No global frame-close interception or vendor changes were made.

## Verification

- 152 Node/reference/unit tests passed, including official closed-socket teardown, finite/stale FPS, bounded/expired RTT history and conservative advice.
- 108 Java tests passed, zero failures/errors/skips. 11 runtime JAR digests, extracted SQLite natives, official browser artifact and 393 OS package records verified.
- 18 signed local HTTPS browser checks and 31 simulated connection/sidebar/privacy checks passed on final build 0ebbd94b65f916a1; 8 independent login browser checks passed during the same 1.2.1 release preparation. All unexpected browser console/page errors were zero.
- Nine viewport sizes, light/dark, narrow Chinese/long labels, fullscreen, focus/close/backdrop, input pause, top/middle/bottom scrolling and persistent header/footer passed. FPS fixture, three-sample status and live sampling/stop were exercised. The polling assertion distinguishes optional measurements from the necessary 10-second auth heartbeat.
- Exact new image passed network-none nonroot/read-only startup, SQLite and missing-JWT refusal. Fixture containers/volumes cleaned.
- 16 deployed negative-security/artifact/version/Tunnel checks passed. Unsigned APIs and WebSocket upgrades refuse identity. Anonymous public routes retain Access redirects.
- Initial Java checks were blocked by sandbox loopback binding; the identical suite passed after authorized local-service execution. An initial network-none Docker build missed the normal cache and could not resolve a pinned package; the normal cached build passed without changing locks or dependencies. No failing check was weakened.

## Deployment and preservation

Service: https://remote.gmb01.xyz/. Guarded deployment verified zero active upstream desktop sessions, exact old/new image and artifacts, inherited environment/state/key mounts, 127.0.0.1:32120 binding, nonroot/read-only settings and the identities/images/start times of nine other containers. Only gateway replaced and only GATEWAY_IMAGE changed in the owner-only private environment. Access policy, Tunnel and host permissions unchanged.
Previous image sha256:8e64c3d7c1414165ce82ef948845355ff982a91fa1a41376a4e9fa18722886d7 remains available. Private rollback environment saved at /Users/yapweijun/.cloudflared/rdg-current-mac-pilot/owner-setup.env.before-health-1.2.1-20261004; rollback not executed. Deployment scripts refuse a runtime that differs from their recorded previous-image precondition. Run saved scripts from repository root.

## Remaining gates and owner use

End an old session and manually update to 1.2.1; updates never silently reload an active session. Open the controls panel, take a manual HTTP timing sample or enable live ping. Scroll within the panel for collapsed bandwidth details and picture mode. Collect at least 3 live samples for a recent stability label.

Real owner login/desktop, real internet FPS/bytes/input-to-visible median/p95, reproduced live 409 and VideoFrame warnings, real Safari/iOS/Windows and actual safe-area/200-percent native zoom acceptance remain unverified. Real-network workload procedure is retained in ../bandwidth-20261004/REAL_NETWORK_TEST.md. Saved previews are labeled simulated fixtures and contain no real desktop/input/clipboard/credentials. Routed instruction-modules files were absent; project core/source evidence and bounded verification were used. KB retrieval returned no applicable prior art.
