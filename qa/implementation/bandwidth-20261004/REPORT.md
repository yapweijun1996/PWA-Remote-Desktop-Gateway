# Quality presets and connection measurements

Status: DEPLOYED_LOCAL_RUNTIME_VERIFIED. Real Mac/internet performance acceptance remains BLOCKED pending authenticated owner desktop access and the defined comparable workload.

Release: 1.2.0, build c94f75df8881af08. Source commit: e72a11a2669b92ddc2980e15b0f6c7b7d65dcc09 on codex/bandwidth-profiles-20261004. At the time of this deployment receipt, main was at cdc0cced41bb81f00a85710878bd2ea6aa6d262e; this feature had not yet been merged or pushed. Subsequent Git history records integration.
Exact ARM64 image: sha 256:8e64c3d7c1414165ce82ef948845355ff982a91fa1a41376a4e9fa18722886d7.
Healthy gateway container: d99067f95093f48df6f27b72d5c1681ef63182021f71c4bed49fd9f818334bf0.
Service: https://remote.gmb01.xyz/.

## Behavior and ownership

Low bandwidth requests 8-bit/256-color output with lossless Guacamole encoding. Balanced retains the existing daemon defaults. Clear requests 24-bit/lossless output. Presets belong to the server, are validated at intent creation and remain immutable for the connection. Client-supplied addresses, credentials, encoding lists, compression and quality parameters remain prohibited. Changing the select has no side effect; the explicit End and reconnect button closes only the displayed old intent, releases input and creates a new connection. Keyboard/clipboard semantics and view-only enforcement remain intact.

The launcher and side panel expose these modes with English and Simplified Chinese text. The side panel shows connection-local Guacamole payload totals, approximately 5-second upload/download rates, elapsed time, first-display time and client processing lag. A user-triggered HTTP timing sample is labeled separately. Neither HTTP time nor processing lag is input-to-visible latency. Metrics remain numeric and in memory; no desktop images, keystrokes, clipboard, tokens or protocol contents are stored or logged. Disconnect clears counters and invalidates outstanding probes.

## Verification

- 147 Node/reference/unit tests passed.
- 108 production Java tests passed; zero failures/errors/skips. 11 pinned JARs, SQLite native files, official Guacamole JavaScript and 393 OS package records verified.
- 18 signed disposable HTTPS browser checks passed; 8 login browser checks passed;30 connection/sidebar/privacy browser checks passed, with zero unexpected console/page errors. New cases cover all three modes, explicit scoped reconnect, input pause, localized counters, delayed probes after close/end, rapid close/reopen and auth-failure cleanup.
-Exact-image network-none startup/SQLite/missing-JWT refusal passed; all fixture containers and volumes were removed.
- 18 actual official-daemon synthetic byte benchmarks passed using immutable production preset source snapshots. See BENCHMARK_REPORT.md and synthetic-benchmark.json for exact bytes, timing samples, source/image digests and limitations.
- 16 deployed negative-security/artifact/health checks passed. Anonymous public requests retain Cloudflare Access redirects. Gateway health and unchanged dedicated Tunnel health passed.
-An initial unsigned local login check returned 400 instead of expected 401. No identity or enrollment was granted. The immediate rerun passed, followed by ten serial 401 checks. The status mismatch was not reproduced; login-stability.json preserves the observation rather than concealing it.

## Measured scope and decisions

For the same 12 synthetic frames, Low transferred 902,709 Guacamole bytes, Balanced 1,751,683 and Clear 406,376. Low was 48.47% smaller than Balanced in this workload; Clear was smaller still. Low saves color information at the cost of a 256-color limit and extra local processing. These are content-dependent protocol payload results, excluding internet framing. They are not real Mac, Cloudflare or WAN wire-byte/interaction-latency results.

The first 16-bit candidate reduced only about 0.07% of browser-side payload even though upstream RFB traffic fell. A lossless 16-bit candidate increased browser-side bytes; they were rejected. Candidate reports remain explicitly preliminary with provenance limitations. Production compression-level overrides were removed after actual negotiation and official 1.6.0 source established that they are assigned after initial negotiation. This release preserves the existing encoding list and does not add Tight, given the upstream LibVNC decoder advisory. No native codec was patched and no full new vulnerability scan was run.

## Deployment and preservation

Deployment preflight found zero active upstream desktop connections. Only the gateway was replaced. Nine other container identities/images/start times, guacd, state/key mounts, runtime environment, loopback binding, non-root execution and read-only filesystem were preserved. The private environment's only change was GATEWAY_IMAGE. Access policy, Tunnel configuration and host permissions were unchanged. The previous image sha 256:0e832e1d7709125d4358791e172b2f81aea173f3e02be2912f5fd8d49d38f4cf remains available, and the owner-only rollback environment is saved at /Users/yapweijun/.cloudflared/rdg-current-mac-pilot/owner-setup.env.before-quality-1.2.0-20261004. Rollback has not been executed and requires the same idle-session preflight.

## Remaining gates

Follow REAL_NETWORK_TEST.md after ending the old session and manually updating to 1.2.0. A real owner login and real Mac desktop test have not been performed with this release; the earlier 409 report has no confirmed Response code. Actual external-network bytes and real input-to-visible median/p95 remain BLOCKED until an authenticated target and controlled workload are available. Real Safari/iOS and cross-platform acceptance are also unverified. FPS control remains deferred until these measurements establish the bottleneck. Preview-controls.png shows only the labeled simulated local fixture.
