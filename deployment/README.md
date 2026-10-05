# Approved-node deployment and rollback

The Java/PWA implementation and Dockerfile exist. This template does not grant permission to deploy or change a host. Actual Mac identity, separate VNC credential, calibrated modifiers, Access application and an additive Tunnel route must be supplied and approved. Keep the existing recovery path until external-network and recovery gates pass.

## Build artifacts

Run `npm ci --ignore-scripts`, `npm test`, `npm run build`, `npm run test:backup` and `npm run test:browser`. Then build the Dockerfile for the intended architecture. Record the exact image manifest digest/ID; do not deploy a moving tag. Do not push this private gateway configuration, credentials or customer data to a public registry/repository.

Build the official-source VNC-only daemon separately:

```sh
docker build --platform linux/arm64 -f deployment/Guacd.Dockerfile -t rdg-guacd:reviewed .
RDG_TEST_GUACD_IMAGE=rdg-guacd:reviewed npm run test:official-guacd
npm run test:os-lock
```

`deployment/Guacd.Dockerfile` compiles the signed Apache 1.6.0 release with a small, explicit local password-authentication integration policy. `apply-vnc-password-policy.py` verifies the exact original and modified C source hashes, uses the maintained LibVNCClient API to select classic VNC password authentication, disables account-credential callbacks and rejects other completed schemes. This is a modified official-source local build, not an Apache-published/unmodified binary. See ADR-011 in `docs/17_IMPLEMENTATION_AND_OPERATIONS.md`. It uses pinned Ubuntu 24.04 and supplies only the VNC protocol plugin. The published 1.6.0 image's Alpine 3.18 is unsupported and is no longer a deployment default. The JRE index remains pinned; the gateway adds a locked `libssl3` security fix. Six architecture-specific locks contain exact Ubuntu package versions/archive SHA256 values, checked before offline installation. Missing, extra, replaced or retired artifacts refuse the build; refresh the locks only through a reviewed signed-APT resolution and re-run image tests/scans. Source/signature/package origins are recorded in `deployment/guacd-provenance.json`.

The verified local ARM64 scans and remaining findings are in `qa/implementation/image-scan.json`. Remaining Medium/Low package findings have no fixed version in that database; some have High CVSS scores despite Ubuntu's Medium priority. Recheck vendor patches and assess their actual reachability before a public pilot. No blanket image safety approval is claimed. AMD64 locks were downloaded/verified in an emulator; final AMD64 runtime acceptance remains unverified.

## Operator-owned configuration

Keep `.env`, filled node JSON and credentials outside Git. Provision:

| Variable | Requirement |
|---|---|
| `RDG_NODE_ID` | Unique approved node ID, matching the node JSON |
| `GATEWAY_IMAGE` | Exact reviewed build digest/ID |
| `GUACD_IMAGE` | Exact reviewed supported-OS official-source guacd digest/ID; mandatory |
| `RDG_PUBLIC_ORIGIN` | Exact first-level HTTPS origin, no port/path/query |
| `RDG_ACCESS_ISSUER` | Exact `https://<team>.cloudflareaccess.com` issuer |
| `RDG_ACCESS_AUDIENCE` | Exact 64-character Access app audience |
| `RDG_OWNER_EMAIL` | Exact approved email; placeholders rejected |
| `RDG_DEVICE_CONFIG` | Absolute path to private node JSON |
| `RDG_VNC_SECRET_PATH` | Owner-provisioned protected file outside repo |

Optional `RDG_OWNER_SUBJECT` pins a verified Access subject. A signed owner email and nonempty signed subject are mandatory even without this optional pin.

Node JSON follows `contracts/device.schema.json`. Fill all six modifier keysyms only after an owner-assisted local calibration experiment. The example JSON's null values deliberately fail startup. Use `host.docker.internal:5900` for a Docker-on-Mac pilot; container `127.0.0.1` is not the Mac. Bookmarks remain UNVERIFIED and cannot be dialed through this node.

The image runs as UID/GID 10001. The secret must be readable by that UID and have no group/other permission bits; Compose file secrets may preserve source ownership and do not reliably apply a requested `uid/mode`. Inspect the mounted file before starting. Use a dedicated owner-approved secret mount/volume with correct custody; never loosen it to world-readable or change unrelated host file permissions. The database volume must also be writable by UID 10001. Secret ownership/mounting on each actual Mac remains a pilot acceptance gate.

## Local pilot, then ingress

1. Run the read-only preflight on the explicitly approved actual Mac. Record listeners, versions, existing tunnel management and recovery access without credentials.
2. Provision the private config/secret. Validate the compose config using an external environment file. Inspect its additive changes and exact images.
3. Start only this project's unique Compose namespace. Check generic process health, absent/forged JWT denial and loopback publishing. No 4822 or 5900 host publishing is allowed.
4. Prove guacd → intended Screen Sharing authentication and harmless editor input. Calibrate Command/Option/Control, Terminal Ctrl+C, Left Alt, AltGr and pointer scaling. Record actual OS/browser/library builds.
5. Verify LAN/IPv6 VNC isolation through the approved host firewall workflow. Do not replace PF rules or disable host protections.
6. Only after P0 passes, create/verify the exact-email Access application and approved additive Tunnel HTTPS route. Preserve the existing tunnel source of truth; dashboard/local management differ.
7. Run unauthorized email/JWT/Origin/CSRF/replay/read-only/stream expiry/logout tests through the public hostname and from another network. Repeat against the second independently configured Mac.

`GET /health` and the container healthcheck prove process liveness only. Authenticated devices report GATEWAY_REACHABLE until an actual desktop stream is established. No network “online” claim is inferred from configuration.

## Dedicated connector supervision on the approved Mac

The current personal pilot uses a separate user LaunchAgent with label `com.rdg.current-mac-pilot.cloudflared`. [The plist example](cloudflared.current-mac-pilot.plist.example) specifies a direct foreground `cloudflared` process, its private configuration, a fixed Tunnel UUID, disabled auto-update, loopback-only metrics, `RunAtLoad`, `KeepAlive` and a ten-second restart throttle. Standard output/error are discarded; do not enable request or transport logging to diagnose availability.

Before installation, inspect the approved Mac and existing service labels/listeners. Reserve `127.0.0.1:32124` for this connector; refuse installation if its label, destination plist or port belongs to another process. Replace the three example placeholders with the approved absolute executable path, owner-only private pilot directory and dedicated Tunnel UUID. Keep the existing credential file unchanged and outside Git. Validate the existing `tunnel.yml` with official `cloudflared tunnel --config <private-config> ingress validate`.

Install the filled plist as an owner-owned `0600` regular file at `~/Library/LaunchAgents/com.rdg.current-mac-pilot.cloudflared.plist`, without overwriting an existing service. Run as the logged-in owner, without `sudo`:

```sh
plutil -lint "$HOME/Library/LaunchAgents/com.rdg.current-mac-pilot.cloudflared.plist"
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.rdg.current-mac-pilot.cloudflared.plist"
curl --fail --silent --show-error http://127.0.0.1:32124/ready
```

Do not invoke default `cloudflared service install` on a Mac with an existing `com.cloudflare.cloudflared` service, replace `~/.cloudflared/config.yml`, or use `killall`/broad process matching. This dedicated service preserves unrelated Tunnels and Access policy. Review updates to the executable/config before applying them.

Availability acceptance requires the dedicated launchd-owned PID, `/ready=200`, and the connector's `cloudflared_tunnel_ha_connections=4`, plus gateway process health and public authorization checks. A public unauthenticated `302` to Access proves the edge login boundary only: Access can return that redirect while the connector is down. Error 1033 means no healthy connector; gateway `/health=200` alone cannot rule it out. Read selected status/count fields in memory; do not retain raw metrics, environment dumps, URLs with login queries, tokens or request logs.

For an approved recovery check, verify the current PID's exact executable/config/UUID and launchd ownership before terminating only that connector. Confirm the old PID disappears, the label obtains a different PID with an increased run count, and readiness/four connections return. Recheck that existing service files/processes and the gateway remain unchanged. An active remote desktop will disconnect during this check; no input is replayed or desktop automatically reconnected. [Current recovery evidence](../qa/implementation/tunnel-supervision-recovery.json) records this bounded check, not sleep/reboot or real desktop acceptance.

This user agent starts at owner login and survives the launching terminal or Codex process. It does not keep a sleeping Mac, logged-out GUI session, Docker or network alive. Pre-login/FileVault, sleep/lid and reboot continuity remain unverified; do not change power, auto-login or host permissions as part of this connector repair.

To stop this connector, use only its label:

```sh
launchctl bootout "gui/$(id -u)/com.rdg.current-mac-pilot.cloudflared"
```

`KeepAlive` means killing its process is not a stop/uninstall procedure. For removal, boot out this label, confirm its process/listener is gone, then remove only its plist. Preserve private configuration/credentials and the Access-protected route until the owner chooses their removal. Re-bootstrap the same reviewed plist to restore it.

References: [Cloudflare macOS services](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/as-a-service/macos/), [Cloudflare Tunnel troubleshooting](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/troubleshoot-tunnels/common-errors/), [Apple launchd jobs](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html).

## Authenticated PWA assets and edge script injection

The same-origin manifest link uses `crossorigin="use-credentials"`. Chromium otherwise omits cookies for its native manifest fetch, including on the same origin, causing whole-host Access to redirect that asset to its login page. Keep the manifest protected by the current approved Access scope and keep CSP restricted to self; adding an external login origin to CSP would not turn an HTML login page into a valid manifest. [Manifest credential guidance](https://web.dev/articles/add-manifest#add_the_web_app_manifest_to_your_pages).

For the approved `remote.gmb01.xyz` deployment, the additive Configuration Rule `RDG remote gateway no analytics` matches only `(http.host eq "remote.gmb01.xyz")` and sets only `disable_rum: true`. This stops automatic Cloudflare performance-beacon injection for the private gateway and preserves the prior apex/ERP rule and global Web Analytics setting. Do not whitelist the external beacon in `script-src`, disable security monitoring or change Access to quiet its CSP rejection. No `no-transform` header was added, avoiding effects on unrelated edge transformations. [Disable RUM setting](https://developers.cloudflare.com/rules/configuration-rules/settings/#disable-real-user-monitoring-rum).

`RDG_LOGIN_BROWSER_MANIFEST_RESULTS=true npm run test:login-browser` saves a separate manifest regression receipt and preserves the historical login receipt. Use the installed Playwright/Chromium environment described in docs/18. The native browser manager must recognize the credentialed manifest at `200`; a separate missing-attribute fixture must omit its available HttpOnly cookie and produce the expected redirect/CSP refusal. Only that page's known manifest-CSP error is expected, exactly once; all other console/JavaScript errors fail the gate. Fixtures cannot prove real Access/Safari acceptance. The [manifest deployment receipt](../qa/implementation/manifest-deployment.json) distinguishes those results from the saved edge rule and live negative checks. Verify the real logged-in browser after refresh without recording cookies, tokens or login query values.

## Connection conflicts and scoped recovery

The current [connection deployment receipt](../qa/implementation/connect-deployment.json) identifies source `8e40a1a`, exact gateway image `sha256:9b81c30a0fae9f77a8fe2a26612376935a627a2a91c15088070a9ba35d47b806` and web build `b6f74fcc8435c7c8`. Only this gateway was replaced; its state/key volumes, official-source guacd, dedicated connector and other containers are preserved.

Do not clear controller protection to suppress `409`. At `POST /api/connect-intents`, inspect the fixed code: `CONTROL_BUSY` means an app desktop or node controller exists; `UPDATE_IN_PROGRESS` is the 20-second update reservation. Clipboard consent can conflict before intent issuance. A refusal without a tab-owned ID must not send an app-wide desktop DELETE. Normal cleanup and explicit recovery send `{ "intentId": "<captured-id>" }`; the latter uses the current-session status snapshot so a delayed request cannot end a newer replacement. Empty-body app-wide DELETE remains a compatibility/operator action, and sign-out revokes the shared app explicitly. [Owner setup documentation](../docs/18_OWNER_SETUP_AND_TRUSTED_DEVICES.md#connection-conflicts-and-tab-ownership) describes the UI and test boundaries.

Use `npm run test:connect-browser` after the web build, with the reviewed Playwright/Chromium environment, for the simulated API/Guacamole lifecycle gate. `RDG_CONNECT_BROWSER_PRIOR_APP=true` runs the pinned older-source negative control. Ownership and upstream closure are independently checked by Java integration tests. Recheck the public owner's actual connection without recording credentials or desktop payloads; a local fixture and anonymous Access redirect do not prove that flow.

## Stop, rollback and uninstall

End node sessions deliberately. Stop only this Compose project's gateway/guacd; a process restart invalidates all in-memory app sessions/intents/leases. For an emergency, stop that gateway directly through the approved local operator, then disable only the new approved Tunnel route if needed. Never expose VNC or disable Access as a rollback.

Restore the previously recorded image digest and approved configuration diff. Retest identity denial, intent race, read-only and the actual keyboard smoke before restoring ingress. Keep prior remote-access/recovery intact. Remove only the project containers/network when uninstalling; preserve metadata/secrets until the owner chooses their custody/deletion policy. Do not use `down --volumes` as an automatic uninstall.

Metadata backup/restore is described in docs/17. It excludes secret files, host config and live sessions. The dedicated connector now has the explicitly approved user LaunchAgent described above. Actual pre-login startup, FileVault, sleep/lid and runtime availability after reboot remain BLOCKED; no system launch daemon, reboot or auto-login change was performed.

## Explicitly approved authenticated status pilot

An owner-approved public test may use `compose.blocked-pilot.yaml` while the real desktop acceptance gate is unresolved. This starts only the production gateway with `RDG_DESKTOP_POLICY=BLOCKED`; it does not start guacd, read a VNC secret, supply invented calibration or use a test identity signer. Use `contracts/device.blocked.schema.json` and the operator-filled `device.blocked.example.json`. Omit the desktop credential and keysyms until verified. The normal FULL template and schema remain strict.

The real Cloudflare Access issuer, app audience, exact owner identity, CSRF, Host and Origin checks remain mandatory. Devices and diagnostics expose `desktopEnabled=false`, `desktopPolicy=BLOCKED` and the local device status `BLOCKED`. Prepare connection is disabled. Both view/control connection intents, raw WebSocket connections and clipboard enablement are refused by the server with `503 DESKTOP_BLOCKED_BY_POLICY`, before any upstream socket or credential access. A successful owner login proves Access and gateway identity integration only; it does not prove desktop pixels or input.

Keep filled environment/configuration and connector credentials outside Git with owner-only custody. Run a unique Compose project, pin the reviewed image, publish only `127.0.0.1:32120`, and retain all existing services. Create an exact-host Access app with an exact-email allow policy before publishing a new DNS route. Explicitly select one-time PIN login rather than relying on a new organization's defaults. Use a dedicated Tunnel and an unused first-level hostname unless the owner approves replacing an existing route. The Tunnel may additionally validate the app audience, but the Java gateway independently validates every protected JWT.

Run `RDG_TEST_IMAGE=<exact-reviewed-image-id> npm run test:blocked-container` for an isolated, network-none startup check without desktop secrets/calibration and missing/forged identity denial. These test issuer/identity values are explicit fixtures and are not public configuration. Before returning the test URL, verify missing/forged identities at the origin, unauthenticated public root/API/WebSocket denial, and the connector's exact route. Owner OTP entry is performed by the owner. Record owner-login verification as pending until observed. Release and desktop acceptance remain BLOCKED. Re-enabling FULL requires the separately verified credential, six calibrated modifiers and all applicable real-device acceptance gates; it is not a browser setting.

Rollback preserves protection: first stop this gateway or change this Tunnel's route to `http_status:404`; then remove only this pilot's DNS record/connector/Tunnel. Keep Access protection until the route is gone. Do not modify existing Tunnel configuration, MCP services or recovery access, and do not remove metadata volumes automatically.

## Host agent backend (opt-in, [docs/19](../docs/19_HOST_AGENT_PROTOCOL.md))
`compose.agent.yaml` is an override for `compose.owner-setup.yaml`; the base file is unchanged, so deploying without the override keeps today's gateway (VNC only, no agent route). With it, the gateway gets `RDG_AGENT_ENABLED=true`, the fixed host `host.docker.internal` and port 5960, and a read-only bind of the agent's own token file at `/run/secrets/rdg_agent_token` (`RDG_AGENT_TOKEN_SOURCE`, the absolute path on this Mac). The token is never copied into an image, volume, environment variable or log.

Facts verified for this setup (`qa/implementation/stage2-s4a-20261005/`, Docker Desktop 28.3.0 on macOS, candidate image built from the stage 2 branch):
- The bind appears in the container as a regular file, mode 600, owner 10001:10001, 43 bytes, readable and not writable by the gateway user.
- **A bad token setup stops the whole gateway from starting, VNC included.** Startup refuses (exit 1, `RDG startup refused`) for a token readable by group or others, of the wrong length, not base64url, not mounted at all, a path outside `/run/secrets`, and a host outside the local boundary. Compose itself refuses to create the container when the token file is missing (`create_host_path: false`) and creates nothing on the host. With the flag off and no token the gateway starts exactly as before.
- Before replacing a running gateway, start the new image once on throwaway state with `node qa/implementation/stage2-s4a-20261005/agent-startup-check.mjs`; it prints only modes, owners, sizes and exit codes.
- A service bound to 127.0.0.1 on the Mac is reachable from containers through `host.docker.internal`, on the default bridge and on a user-defined bridge, and arrives from 127.0.0.1. So the agent cannot tell the gateway from any other local container or process: the 32-byte token is the only barrier (`topology-check.mjs`).

Deploying with the override is its own approved step. The replacement must roll back automatically: if the new gateway is not healthy within 60 s, bring the previous image back up without the override and the previous environment file, verify it is healthy, and record the failed attempt. A startup refusal looks exactly like that failure. **The token file is a container start dependency as soon as the override is deployed, even with the flag off.** If the file is missing when Docker starts the gateway (a Mac reboot, a Docker Desktop restart, `restart: unless-stopped`), the bind fails and the gateway does not start, VNC included. So never leave the path empty while the override is deployed. Rotate by writing the new token to a new file beside the old one (`agent --init-token` into a temporary path, mode 0600), moving it over the old name in a single rename, restarting the agent, and then recreating the gateway, which only reads the file at start; do not delete first. The agent and the gateway must hold the same token or the gateway reports `AGENT_AUTH_FAILED`.

