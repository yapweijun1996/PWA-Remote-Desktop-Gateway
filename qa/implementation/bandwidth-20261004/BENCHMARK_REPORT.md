# Official-daemon synthetic byte benchmark

Status: PASS for 18 sequential runs. This is a synthetic loopback protocol measurement, not real Mac, browser rendering, Cloudflare or internet acceptance.

The test uses actual Apache Guacamole 1.6.0 Java transport and the exact reviewed daemon image `sha256:3cbaad3b2d040ddfe1905a99b94c5b61448f2f7358e24bb1e4a2838f38daf06f`. The disposable Java image is `sha256:9b81c30a0fae9f77a8fe2a26612376935a627a2a91c15088070a9ba35d47b806`. Both run in a shared network-none namespace with fixed loopback endpoints and no published port. No live container, real desktop, credential file or host setting is changed.

Final presets are taken from an immutable compile snapshot of production `DisplayQuality.java`, through its actual `parse`/`apply` methods. The final validator verifies that the production-source hash still matches and that Low requests 8-bit color with lossless output, Balanced uses existing defaults, and Clear requests 24-bit color with lossless output. Exact source hashes and all observations are in [synthetic-benchmark.json](synthetic-benchmark.json).

Every run starts with one frame and then sends the same 12 full-frame changes in a deterministic 640×360 gradient/noise pattern. Each profile has three repeats for Raw-only and Zlib/Raw targets. Values below are medians. Guacamole download bytes exclude the initial frame; RFB bytes include initialization/authentication and all 13 frames. These are payload bytes before WebSocket/TLS/HTTP framing.

| Target encoding | Preset | Guacamole download bytes / 12 frames | Change vs Balanced | RFB download bytes / 13 frames | Synthetic pointer-to-frame-sync median |
| --- | --- | ---: | ---: | ---: | ---: |
| Raw | Low, 8-bit lossless | 902,709 | −48.47% | 2,995,466 | 71.83 ms |
| Raw | Balanced | 1,751,683 | baseline | 11,981,066 | 26.17 ms |
| Raw | Clear, 24-bit lossless | 406,376 | −76.80% | 11,981,066 | 53.17 ms |
| Zlib | Low, 8-bit lossless | 902,709 | −48.47% | 860,041 | 72.22 ms |
| Zlib | Balanced | 1,751,683 | baseline | 8,667,008 | 49.26 ms |
| Zlib | Clear, 24-bit lossless | 406,376 | −76.80% | 8,667,008 | 77.29 ms |

The 8-bit lossless preset reduces measured browser-side protocol payload for this workload, with extra local processing cost and a 256-color limit. Savings are content dependent. Clear is smaller than Low on this particular structured pattern, showing why image quality names cannot promise a monotonic bandwidth limit. Neither these byte differences nor the local timing figures guarantee performance on a real internet link.

Rejected experiments remain separate: [baseline-16.json](baseline-16.json) had about 0.07% browser-side savings, despite materially reducing RFB bytes. [candidate-8.json](candidate-8.json), with lossy output allowed, had approximately unchanged browser-side bytes. [candidate-16-lossless.json](candidate-16-lossless.json) was about 3.88% larger than Balanced. [candidate-8-lossless.json](candidate-8-lossless.json) established the promising candidate before the final sequential repeats. The three candidate files each contain only one preliminary Zlib run. The initial 16-bit baseline records a source-provenance limitation because the helper was edited while that earlier experiment was running; final evidence uses immutable source snapshots.

The observed Zlib compression pseudoencoding was 3. Earlier requested compression 9/6 did not reach the initial negotiation: Guacamole 1.6.0 assigns these fields after `rfbInitClient` has already negotiated encodings. Production therefore leaves compression and JPEG quality unset. Default encodings remain unchanged, and no Tight rectangles or VNC JPEG payloads are sent. No native codec is patched.

Pointer timing includes synthetic generation, encoding, loopback transfer and daemon processing. It excludes real operating-system input delivery, Mac drawing and browser rendering. Real-session browser payload rate and Guacamole sync observations must be measured separately; real click-to-visible-response latency remains a manual acceptance gate. Pixel content, input coordinates, keys, clipboard, authentication messages and protocol payloads are never saved.

Reproduce with `sh qa/bandwidth-benchmark.sh`. The harness has finite 90/120-second deadlines and cleans up only its own classes/processes/containers. [Procedure and metric definitions](../../bandwidth-benchmark.md) explain the scope and limitations.
