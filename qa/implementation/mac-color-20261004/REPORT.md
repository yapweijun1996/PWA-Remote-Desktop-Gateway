# Real Mac color compatibility fix

Status: DEPLOYED_LOCAL_RUNTIME_VERIFIED. Real Mac view-only protocol compatibility verified; authenticated browser control remains unverified.
Release 1.2.2, build 1db76b487cb2834d. Source commit 481ec19f71654b3c788d1b78e085ae79f0226de5 on codex/mac-color-compatibility-20261004. No merge or push for this fix.
Exact ARM64 image sha256:173335c8d27a396f57da8ccd8f9a6f3b0b372af6089865fee082aaae4f7b313d. Healthy gateway a33ed371e1ecc6e426030171b944d628c442b48a12b02e9d01ec02f6e6c1c204.

## Root evidence and change

Recent bounded gateway audit metadata showed authorized connections ending TARGET_UNAVAILABLE within milliseconds or under a second. Gateway/Tunnel health and the local Screen Sharing TCP/RFB greeting passed. A direct official Guacamole VIEW ONLY comparison then reproduced an 8-bit Low failure with UPSTREAM_ERROR 515. Balanced streamed 44 sync/81 image instructions, Clear streamed 57/108, and an otherwise identical 16-bit/lossless candidate streamed 46/71 over bounded 8-second tests. Only aggregate counters/error codes were emitted; no screen pixels, raw protocol, identity, input, clipboard or credential values were saved or logged. Each test refused existing active desktop upstreams, used the existing server-owned credential and auto-terminated by 10 seconds. This establishes a low-color-path compatibility failure on this approved Mac, not a universal failure on every Mac or a proven specific native codec bug.

Production LOW now requests 16-bit/lossless instead of 8-bit/lossless. API enum low and all server-owned target/identity/input restrictions remain unchanged. The user label is Reduced colors (16-bit), with EN/zh-CN guidance; it does not promise lower internet traffic. Balanced and Clear retain their mappings. The adapter recognizes only the exact bounded TARGET_UNAVAILABLE WebSocket close reason; arbitrary close text remains generic and is never rendered. Official transport/codecs are unchanged. The guidance recommends trying Balanced and checking upstream diagnostics for target failures rather than blaming only client network/Access.

Post-deployment, the helper used the actual production LOW enum from the exact new runtime image, with no candidate override. Result: VIEW_PROBE_COMPLETE syncs=46 imageInstructions=80 hasSize=true. Thus the deployed replacement streamed where the earlier 8-bit setting failed. This was a read-only protocol check, not interactive browser rendering or keyboard acceptance. The user's exact selected mode/browser was not supplied; other disconnect causes remain possible.

## Verification

- 153 Node/reference/unit tests passed, including exact bounded close-reason preservation, rejection of arbitrary close text and safe pinned official WebSocket teardown.
- 108 production Java tests passed, zero failures/errors/skips; parameter tests require LOW=16 and CLEAR=24 and preserve all negative target/quality injection checks. 11 runtime JARs, SQLite native files, official JS and 393 OS package records verified.
- 18 signed local HTTPS browser checks and 31 simulated connection/sidebar/privacy checks passed on the final 1.2.2 build, with zero unexpected console/page errors. No claim of real owner Access/Windows/Safari control from these fixtures.
- 18 isolated network-none official guacd benchmarks passed against the immutable production preset snapshot. The same synthetic 12 frames used 1,819,622 Guacamole bytes for Low, 1,751,683 for Balanced and 406,376 for Clear. Low was 3.88% larger than Balanced in this synthetic browser payload, despite reduced upstream RFB bytes. Content dependence prevents a general internet-bandwidth promise. Historical 8-bit savings do not apply to the replacement preset; old receipts were restored unchanged.
- Exact new image startup/SQLite/missing-JWT refusal passed in a disposable network-none, nonroot/read-only fixture, then all fixture resources were removed.
- 16 deployed identity/Origin/WebSocket refusal, exact asset/version and gateway/Tunnel health checks passed.

## Deployment guard observation

The first attempt stopped before runtime mutation because an adapted branch-name precondition was wrong; it was corrected to the actual dedicated branch. The subsequent gateway replacement succeeded and was healthy, but the raw mount/port string comparison stopped receipt generation. The current bind source is represented with Docker Desktop's /host_mnt prefix. Raw previous mount strings were not retained, so that original mismatch is not retrospectively explained with certainty.

Independent read-only acceptance then verified all three mount identities/access modes against the unchanged approved Compose configuration: bind path canonicalization plus exact host/container device-file hashes, existing named state/key volumes, key read-only and state read/write. It also verified exact inherited environment (the earlier environment comparison passed), only GATEWAY_IMAGE changed versus the private preflight backup, loopback-only port, nonroot/read-only runtime, all four runtime artifact hashes and no lifecycle changes for the other nine running containers since preflight. deployment.json records both the original string-check failure and this independent semantic verification. No guard was silently removed, no rollback or additional restart was performed, and no Access/Tunnel/host permission change occurred.

Previous image sha256:7fe91d1e9a375b1433c63a0538c646e745f4a52ace947557b8e98da00de7f088 and private rollback environment /Users/yapweijun/.cloudflared/rdg-current-mac-pilot/owner-setup.env.before-mac-color-1.2.2-20261004 remain available. Rollback was not executed and requires the same idle-session guard.

## Owner action and remaining limits

End an old session and manually update to 1.2.2, then reconnect with Balanced or Reduced colors (16-bit). The old browser's cached 1.2.1 runtime will not silently reload. A connected stream has never been automatically taken over or replayed. Code/evidence stay on the dedicated branch; prior remote-push approval is still unresolved.

Real authenticated browser control, real client FPS/internet bandwidth/input-to-visible latency, native Safari/iOS/Windows acceptance and any remaining disconnect in Balanced/Clear remain unverified. No new vulnerability scan was run. All temporary probe classes and containers were cleaned; UpstreamProbe.java is preserved as inspectable protocol-only evidence. No real desktop screenshot was captured.
