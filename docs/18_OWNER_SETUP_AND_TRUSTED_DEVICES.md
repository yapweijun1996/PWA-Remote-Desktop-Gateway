# Owner setup and trusted devices

Status: source contract and deployment plan. Production migration is **PENDING** until the deployment receipt records the reviewed image, configuration, Access route, Tunnel route and public verification. This document does not prove a working Mac desktop or browser compatibility.

The owner explicitly requested control, viewing, virtual keys and optional clipboard together for self-testing, plus a browser remembered for one year. `OWNER_SETUP` implements that opt-in without declaring the keyboard calibrated. The original `FULL` and `BLOCKED` modes retain their default authentication and desktop boundaries.

## Policies and prerequisites

| Configuration | Desktop credentials and input | Identity authority |
| --- | --- | --- |
| Default `FULL`, trust disabled | Operator-provided secret file and explicit key mappings required | Verified signed Access JWT on every protected API and WebSocket upgrade |
| Explicit `BLOCKED`, trust disabled | No desktop connection or clipboard enablement; no secret read or calibration required | Same verified Access JWT boundary |
| Explicit `OWNER_SETUP`, trust disabled | Authenticated owner provisions an encrypted VNC password; standard test keyboard profile | Same verified Access JWT boundary |
| Explicit `OWNER_SETUP`, trust enabled | Same encrypted credential and self-test controls | Signed Access at `/login` enrolls a browser; live server-owned trust authorizes subsequent APIs and WebSocket upgrades |

`RDG_DESKTOP_POLICY=OWNER_SETUP` and `RDG_TRUSTED_DEVICES_ENABLED=true` are independent explicit settings. Trust is disabled by default and refuses startup with `FULL` or `BLOCKED`. Unknown policy or trust flag values refuse startup. Owner email, Access issuer/AUD, node identity, exact public origin, server target and supported immutable Guacamole artifacts remain required operator configuration.

Use [device.owner-setup.schema.json](../contracts/device.owner-setup.schema.json) for this mode. It excludes `credentialRef`; do not set `RDG_VNC_SECRET_FILE`. The device stays server-owned: macOS, port `5900`, and `host.docker.internal` or `127.0.0.1` on the explicitly approved personal host. Browser requests supply a device ID, never an arbitrary protocol, target, port or password in a tunnel URL. guacd stays private at `4822`; only the gateway is published through the dedicated Tunnel.

The schema fixes the six standard test keysyms: Command left/right `65511/65512`, Option left/right `65513/65514`, Control left/right `65507/65508`. These are a declared self-test profile, not observed Mac calibration. Diagnostics report `UNVERIFIED_TEST_PROFILE`; the UI says “Standard profile — shortcuts awaiting your test.” Browser/OS-reserved shortcuts and direct local IME still need owner testing. `FULL` continues to use its separate operator mapping contract.

## Password entry and encrypted storage

The authenticated launcher asks for the Mac's Screen Sharing VNC password when `credentialSetupEnabled=true` and `credentialConfigured=false`. Submit uses same-origin `POST /api/desktop/credential`, the existing application session, exact Host/Origin and `X-RDG-CSRF`. The sole JSON field is `password`. Never paste a real value into a command, report, test fixture or source file.

The page clears the input before awaiting the response and on window blur, page hide, private-state clearing, logout, reinitialization and connection changes. Autofill is disabled; the application does not persist the password in local/session storage, render it back, log it or include it in a URL. Stored credentials are write-only. A successful response exposes capability flags and causes fresh initialization, not a password read-back or an automatic desktop connection. It confirms encrypted storage, not successful VNC authentication.

After provisioning, control/view and explicit plain-text clipboard settings are available together. The shared-screen consent and optional clipboard consent remain separate required user choices; view mode cannot send input or clipboard. Virtual keys remain available during control. “Change desktop password” is available only in owner setup and cannot be submitted while an active/pending node desktop lease owns the target. Another tab's lease is covered by the server lock. Invalid input returns `400 INVALID_CREDENTIAL`; lease contention returns `409 CONTROL_BUSY`; unavailable storage returns `503 CREDENTIAL_STORE_UNAVAILABLE`. The page maps errors to fixed text without echoing the submitted value or arbitrary server detail.

`DesktopCredentialStore` writes `${RDG_STATE_DIR}/credentials/vnc.json` as an authenticated AES-256-GCM envelope with a fresh nonce. Its authenticated metadata binds version, purpose, algorithm, node, device and key identity. Atomic publication prevents partially written envelopes. The 32-byte master key is read from `RDG_VNC_KEY_FILE`, outside the metadata/state tree. State and key directories must be owner-only `0700`; the key, encrypted envelope and applicable state files must be `0600`. Invalid ownership, symlinks, corruption or a changed key fail closed.

[compose.owner-setup.yaml](../deployment/compose.owner-setup.yaml) separates the writable metadata volume and read-only key volume. Key creation is an offline operator step using the reviewed image's `--init-vnc-key` entry point. It creates only a new nonexistent key and never prints or replaces a key. Runtime startup does not generate a replacement for missing or damaged encrypted state.

## Remembering a browser for 365 days

The first enrollment goes through the real exact-owner OTP Access application at `/login`. Java independently validates the signed Access assertion with the configured issuer, AUD, signature, expiry and owner identity. An explicit “Trust this browser and continue” POST also verifies exact Host/Origin and a short, one-use, server-held enrollment challenge bound to an HttpOnly cookie. No client-provided email or subject establishes ownership.

Login HTML uses `Referrer-Policy: same-origin`. A native same-origin form POST under `no-referrer` serializes its Origin as `null`, which the enrollment guard correctly rejects; [the Fetch Origin-header algorithm](https://fetch.spec.whatwg.org/#append-a-request-origin-header) specifies this behavior. This policy change is scoped to login GET responses: cross-origin referrers remain suppressed, while protected APIs and other pages retain `no-referrer`. Real Chromium fixtures verify the browser-generated POST Origin instead of injecting the expected Origin in a Java HTTP client.

Login navigation is separate from enrollment authorization. `GET /login` always checks the exact Host and a valid signed owner Access assertion, but accepts an absent, opaque (`null`) or foreign Origin because provider redirects are navigation. The [Fetch standard origin serialization](https://fetch.spec.whatwg.org/#serializing-a-request-origin) permits an opaque origin across redirects; this is a supported return condition, not evidence of the owner screenshot's unobserved headers. Query parameters on a verified login GET are discarded with a fixed `303 /login`; landing GET queries use fixed `303 /`. No parameter supplies identity or a redirect destination. `POST /login` rejects missing, opaque or foreign Origin and any query before the existing-trust shortcut. The short one-use challenge and cookie are still required to issue browser trust. Protected APIs and WebSocket upgrades retain their query and Origin checks. Failed login GETs retain their HTTP error status and render fixed HTML rather than a JSON download.

The gateway issues a random opaque `__Host-rdg-device` bearer cookie: `Secure`, `HttpOnly`, `Path=/`, no Domain, `SameSite=Lax`, and a maximum lifetime of 365 days. JavaScript never reads or writes its value. Clearing cookies, using a private browser, expiration, missing/corrupt state or revocation requires enrollment again. The year is a gateway trust lifetime, not a one-year Cloudflare Access JWT or an indefinite active desktop.

`TrustedDeviceStore` keeps `${RDG_STATE_DIR}/trusted-devices/trusted-devices.sqlite` in a private directory. Bearer lookup is an HMAC-SHA-256 digest; owner identity is AES-GCM encrypted with context-bound authenticated metadata. Separate purpose-derived keys are obtained from the protected master key. Plaintext bearer and owner identity are not stored in SQLite. Expiry, node/owner binding, store/key integrity and revocation are live server authority, checked on each protected request/upgrade and during existing desktop activity. Server inline checks and its 250 ms scheduler close invalid transports; deployment verification must measure actual closure behavior rather than infer a network latency guarantee.

The Trusted devices dialog shows only the owner's opaque management ID, expiry and current-browser flag. `GET /api/trusted-devices` returns `{devices:[{id,createdAt,expiresAt,current}]}`. `DELETE /api/trusted-devices/{id}` requires the same application session, exact Origin and CSRF boundary. Revocation invalidates the affected device's application sessions and live transports; another trusted device's management session remains valid. Current-browser revocation clears its cookie and returns to `/login`. Confirmed sign out revokes the current trust and returns to enrollment. If the short application session has expired while trust is still valid, sign out bootstraps a fresh session and retries revocation first. An unconfirmed failure stays on the gateway with a fixed error; it does not claim revocation or redirect. A short application-session expiry can bootstrap again using still-valid trust; no desktop is automatically reconnected.

Access policy/JWT revocation blocks new enrollment, but does not revoke previously issued gateway trust. Use the gateway Trusted devices revoke action (or an explicitly reviewed offline state operation) to terminate existing device trust. Changing a pinned owner subject invalidates mismatched stored and live identities.

The application lease remains at most one hour, and remote input idle remains 15 minutes. Heartbeat/video does not extend input activity. One-use connect intents, focus-owned input, modifier release, view-only guards, clipboard consent and idle-safe PWA updates remain enforced. A remembered browser does not remove those controls.

## Access and Tunnel migration

This route change is specific to an approved trusted-device deployment. Keep the default all-path Access configuration for `FULL`, `BLOCKED` and owner setup with trust disabled. Do not narrow Access while the live gateway still depends on an Access JWT for every API.

For trust-enabled owner setup, prepare the reviewed gateway, private state/key and dedicated connector before changing the published policy. The proposed Access application covers `remote.gmb01.xyz/login`, uses only OTP and allows only the exact approved owner email; all other identities are denied. Java still verifies every enrollment assertion. No Bypass, Everyone or service-token substitute is needed. Cloudflare supports path-specific applications; verify matching and overlapping policies before publication. [Application paths](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/)

The dedicated Tunnel must match the login route before the general gateway route. A local configuration shape is:

```yaml
ingress:
  - hostname: remote.gmb01.xyz
    path: ^/login(/.*)?$
    service: http://127.0.0.1:32120
    originRequest:
      access:
        required: true
        teamName: APPROVED_TEAM
        audTag: [APPROVED_LOGIN_AUD]
  - hostname: remote.gmb01.xyz
    service: http://127.0.0.1:32120
  - service: http_status:404
```

The general route uses the gateway's verified live trust boundary and must not inherit a global `access.required=true` setting. cloudflared evaluates ingress from top to bottom and requires the catch-all last; the login rule's Access validation adds protection before Java's enrollment check. Preserve the exact public Host/Origin and full path. [Ingress matching](https://developers.cloudflare.com/tunnel/features/locally-managed-tunnels/configuration-file/), [Access origin validation](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/origin-parameters/)

Use only the owned Tunnel/connector/DNS route. Never expose raw VNC `5900`, guacd `4822`, an arbitrary-target proxy, a signed-identity test fixture or a test login mock. Unrelated Tunnels, services and hosts remain unchanged.

Before calling migration complete, record the exact image/configuration/source identities and verify: unauthenticated `/login` is intercepted by Access; an untrusted root returns to `/login`; untrusted APIs and WebSocket upgrades refuse with no private data/upgrade; real owner enrollment sets only the protected cookie; restart preserves the encrypted credential and valid trust; targeted revocation closes affected transports; invalid identity/Origin/CSRF fails; and owner desktop self-tests distinguish observed results from unknown keyboard/platform behavior. Earlier all-path Access redirects and local UI route mocks are historical evidence for different scopes, not proof of this migration. Production migration remains **PENDING** until that receipt is recorded.

The current dedicated connector uses the [separate user LaunchAgent](../deployment/README.md#dedicated-connector-supervision-on-the-approved-mac). [Recovery evidence](../qa/implementation/tunnel-supervision-recovery.json) covers loss of its process and automatic restart, while preserving the current all-path Access policy. Connector persistence does not complete the pending login-only Access migration or verify real Mac pixels/input.

## Backup, recovery and key rotation

The existing metadata backup helper covers the audit database; it does not automatically include the new credentials directory or trusted-device database. An encrypted-state recovery snapshot must explicitly include both, with the gateway stopped for consistency.

Back up metadata/encrypted state and the master key separately under owner custody, preserving `0700` directories and `0600` files. Keep node/device/owner bindings and matching key identity with the recovery record; never include a key, cookie bearer, password, token or protocol payload in Git or evidence. A metadata backup alone cannot decrypt the credential or trusted identities. A key alone is not the state backup.

Stop only the owned gateway/connector before restoring encrypted state. Restore the matching key and metadata snapshot; verify permissions and integrity before reopening the route. Do not delete volumes, regenerate a key or silently reset trust to make startup pass. Missing/corrupt state fails closed and needs an explicit recovery decision.

Key rotation requires the service stopped and a separately reviewed explicit rewrap/migration of both the VNC envelope and trusted-device identities/bindings. No rewrap tool is provided by `--init-vnc-key`. Swapping the key file, deleting an existing key or hot-replacing it is unsupported and fails integrity checks. Preserve old state/key backups until recovery is verified; never perform implicit rotation during deployment or a password change.

Rollback first isolates the owned route or restores a reviewed strict gateway/Access combination. Restore all-path Access protection before returning to strict `FULL`/`BLOCKED`; do not remove the enrollment protection while routes remain reachable. Retain encrypted state and key for recovery, revoke affected application/device sessions as needed, and stop only owned resources. Record the resulting public denial behavior and deployment state.

## Login browser regression

Run `npm run test:login-browser` with the installed Playwright module and reviewed Chromium path (`RDG_PLAYWRIGHT_MODULE`, `RDG_TEST_CHROMIUM`). This launches private disposable loopback HTTPS origins and a test-classpath-only signed owner fixture, then removes its own processes and directory. The fixture cannot open a desktop. It checks provider POST/302 navigation, query cleanup, native same-origin enrollment and cookie attributes/lifetime, unauthorized HTML, and rejected foreign/opaque POSTs. A separately labelled synthetic null-Origin GET complements the natural browser return. It records only status, Origin categories and counts in `qa/implementation/login-browser-results.json`; no identity token, cookie, nonce, password or URL query values are recorded. Self-signed TLS is accepted only for these disposable fixtures. This proves Chromium fixture behavior, not real Access, Safari or Mac compatibility.

## Review sources

- [Config and policy flags](../gateway/src/main/java/com/rdg/Config.java), [runtime wiring](../gateway/src/main/java/com/rdg/Main.java)
- [Desktop credential envelope](../gateway/src/main/java/com/rdg/DesktopCredentialStore.java), [API boundary](../gateway/src/main/java/com/rdg/ApiServlet.java)
- [Enrollment](../gateway/src/main/java/com/rdg/LoginServlet.java), [host-only cookies](../gateway/src/main/java/com/rdg/TrustedDeviceCookies.java)
- [Trusted metadata authority](../gateway/src/main/java/com/rdg/TrustedDeviceStore.java), [device management](../gateway/src/main/java/com/rdg/TrustedDevicesServlet.java)
- [Request/upgrade filter](../gateway/src/main/java/com/rdg/GatewayFilter.java), [short leases and live transport checks](../gateway/src/main/java/com/rdg/Sessions.java)
- [Owner setup and trusted-device UI](../web/src/app.mjs), [deployment receipt/evidence](../qa/implementation/artifacts.json)
