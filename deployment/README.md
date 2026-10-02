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

`deployment/Guacd.Dockerfile` compiles the signed Apache 1.6.0 release without changing its C source. It uses pinned Ubuntu 24.04 and supplies only the VNC protocol plugin. The published 1.6.0 image's Alpine 3.18 is unsupported and is no longer a deployment default. The JRE index remains pinned; the gateway adds a locked `libssl3` security fix. Six architecture-specific locks contain exact Ubuntu package versions/archive SHA256 values, checked before offline installation. Missing, extra, replaced or retired artifacts refuse the build; refresh the locks only through a reviewed signed-APT resolution and re-run image tests/scans. Source/signature/package origins are recorded in `deployment/guacd-provenance.json`.

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

## Stop, rollback and uninstall

End node sessions deliberately. Stop only this Compose project's gateway/guacd; a process restart invalidates all in-memory app sessions/intents/leases. For an emergency, stop that gateway directly through the approved local operator, then disable only the new approved Tunnel route if needed. Never expose VNC or disable Access as a rollback.

Restore the previously recorded image digest and approved configuration diff. Retest identity denial, intent race, read-only and the actual keyboard smoke before restoring ingress. Keep prior remote-access/recovery intact. Remove only the project containers/network when uninstalling; preserve metadata/secrets until the owner chooses their custody/deletion policy. Do not use `down --volumes` as an automatic uninstall.

Metadata backup/restore is described in docs/17. It excludes secret files, host config and live sessions. Actual host startup, FileVault, sleep/lid and runtime availability after reboot remain BLOCKED; no launch daemon, reboot or auto-login change was performed.
