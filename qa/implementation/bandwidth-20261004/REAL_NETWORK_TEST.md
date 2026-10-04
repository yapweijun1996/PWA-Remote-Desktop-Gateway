# Owner-run real network acceptance

Status: BLOCKED pending authenticated owner desktop access and a comparable workload. No real Mac or real internet performance numbers are recorded here. The previous connect-intents 409 report has no confirmed response code.

## Workload and bandwidth

1. End the current session and explicitly update the app. Sign in from the actual external network. Start Balanced, then Low bandwidth, then Clear in separate fresh connections using the same target, screen resolution, browser and network.
2. For each mode, first remain on the same static editor/terminal for 30 seconds. Then repeat the same scroll/window-movement work for 60 seconds. Do not use private clipboard data or record screenshots. Avoid comparing different pictures or periods of idle traffic.
3. Open Remote controls after each interval. Read cumulative received MiB and elapsed duration for that connection; calculate payload throughput as difference in received bytes divided by the controlled interval. The displayed download KiB/s covers the most recent approximately five seconds, including idle time in the panel. Record both the preset and any visible color/readability changes. The panel pauses input but leaves the picture stream running.
4. Use Measure HTTP round trip at least five times per mode; record median and range. This includes HTTP/browser/gateway processing and is not input-to-visible latency. It cannot by itself establish remote interaction latency or solve the reported 409.

## Real interaction latency

For a reproducible input-to-visible result, the owner must focus an explicitly harmless benchmark window on the actual Mac. A manually observed key-to-color-change trial or an owner-controlled external high-speed timing capture can establish that boundary. Use the same procedure and at least20 samples per mode, report median and p95 with the timing method's resolution. Never retain or share private desktop frames, input, clipboard or tokens in this repository. This agent has not run that owner-only test and will not substitute HTTP RTT or synthetic pointer-to-sync values for it.

## Acceptance

Choose the lowest observed payload rate that preserves readable text and acceptable interaction latency. Low bandwidth is a color/codec preset, not a guaranteed bitrate or FPS cap; Clear can be smaller on some pictures. Repeat on a second representative workload if results conflict. Keep FPS work deferred until actual input latency and the dominant network/codec bottleneck are established. Real Safari/iOS and cross-platform checks remain separate gates.
