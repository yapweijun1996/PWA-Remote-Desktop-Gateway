# 05 · Mac setup and compatibility gates

## Pilot order and host boundary
Start with one explicitly approved personal Mac. Record macOS version/build, Apple silicon architecture, browser versions, display count, current Screen Sharing state, login/lock state and container runtime. Do not assume which Mac is currently reachable. The other Mac must be an independent deployment, not a load-balanced replica pointing to a different desktop. A Windows browser is a controller; this does not enroll or install anything on a company Windows PC.

The current handoff has not inspected either Mac. The preflight script is read-only and must be run by the authorized operator on the actual target. Do not execute Mac commands against an Ubuntu VM and label the result Mac validation.

## Owner-assisted setup
1. Inventory current ports, tunnels, services, repository and uncommitted files. Preserve a before snapshot, excluding secrets.
2. Confirm an approved alternate remote-access path and local recovery method.
3. Enable Screen Sharing in System Settings → General → Sharing, with the narrowest permitted user access and a separate VNC credential when using the third-party VNC mode. Apple documents this option. [S07,S08]
4. Keep the credential outside the repository in an owner-controlled secret store. Do not pass it through shell arguments or chat. Verify the exact accepted authentication method before building UI.
5. From the target's approved runtime, establish a bounded VNC connection to the target Mac. Do not confuse the Linux container's localhost with the Mac's localhost. Docker Desktop documents `host.docker.internal` for reaching the host. [S21]
6. Establish the Guacamole Java/JS/guacd loop locally. Prove visible text-editor control and modifier calibration before public ingress.
7. Test the actual Screen Sharing listener on IPv4/IPv6 and LAN. It may not be loopback-only. An approved firewall restriction must leave the gateway able to connect while denying untrusted LAN peers; record proof. No router port forward.
8. Only after Access and gateway negative tests pass, add an approved hostname/Tunnel route and test from another network.

## macOS permissions
Use native Screen Sharing as the V1 capture/control engine. Do not add a custom screen-capture agent solely for branding. A future custom agent would need its own macOS permissions, packaging, signing and update/revocation design; it is not implemented by this specification. Never automate around TCC prompts or silently expand permissions.

## Compatibility experiments — all initially NOT_RUN
| Experiment | Evidence required | Failure action |
|---|---|---|
| ARM64 runtime/images | Supported manifest/digest; dependency versions | Build reviewed image or stop; no silent emulation claim |
| Screen Sharing handshake | Actual VNC auth negotiation, sanitized result | Recheck supported mode; do not disable authentication |
| Command/Option/Control | Visible harmless menu/editor action on target | Calibrate adapter; do not guess Meta/Super keysyms |
| Clipboard | Separate local→remote and remote→local text tests | Disable unsupported direction and expose text fallback |
| Lock screen | Owner enters macOS password in target screen | Document login requirement; never store password |
| Multiple monitors/headless | Actual geometry and selectable display behavior | Advertise only supported display behavior |
| Sleep/wake and network change | Offline state, reconnect with fresh session | No automatic key replay or fake wake button |
| Restart/login | Exact startup chain and availability | Keep alternate access; classify unattended recovery as blocked |

## Sleep, lid closure and restart
A URL cannot control a sleeping or disconnected Mac unless some independently working wake/recovery mechanism exists. Do not disable sleep indefinitely, change lid behavior, disable FileVault or enable auto-login merely to meet a demo goal. MacBook Air availability varies with power, sleep and lid configuration; report the tested conditions.

Do not make a blanket claim that FileVault makes all remote unlock impossible: Apple documents specific Apple-silicon/macOS-26-or-later Remote Login recovery conditions. That is a different SSH recovery path, not proof that this browser gateway or Docker runtime is available before login. This project's unattended boot recovery remains a separate approval and acceptance gate. [S09]

A native launch daemon and a GUI-launched container runtime have different availability. Choose the service manager only after testing the exact runtime. Provide a start/stop/status procedure and a clean uninstall that removes only this project's resources.

## Pilot stop conditions
Stop public rollout on unverified identity validation, unrestricted VNC reachability, secret exposure, wrong desktop routing, stuck keys after disconnect, read-only bypass, forced SW reload, or unreliable recovery without an approved alternate path. A successful local screenshot is not proof of any of these conditions.
