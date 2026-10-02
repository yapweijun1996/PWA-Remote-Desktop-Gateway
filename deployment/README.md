# Deployment templates — not turnkey software

These are blueprints for the implementation Agent. There is no built gateway image, configured Access policy or VNC secret in the archive. Do not run this on a production Mac as an installation script.

Read docs/05 and docs/06 first. Build and review the gateway; pin actual image digests; verify the chosen runtime and ARM64 support; provide a validated target config and protected external secret; confirm the actual ports are available. Native cloudflared forwards to the Mac's loopback port. guacd needs outbound access to the configured Mac VNC target; a Docker `internal: true` network can block that path, so do not apply it blindly. No container port for guacd is published.

`compose.blueprint.yaml` uses required variable guards and should fail until the operator fills the approved values. The gateway environment variable names are part of this proposed application configuration, not variables understood by a stock Guacamole image. The gateway entrypoint must validate them and fail closed. Secret mounts are not an encryption boundary against host/root compromise.

`cloudflared.config.example.yml` is only for a locally managed tunnel. For a dashboard-managed existing tunnel, use its actual management workflow and do not paste this over a local file. Protect every published path with the intended Access app. Prefer a single deterministic node route with an unmatched-host 404 fallback. No VNC/TCP public route.

Do not commit a populated `.env`, credentials JSON or screenshots of private configuration. The read-only preflight script prints bounded host facts; it makes no security settings changes and is not itself evidence until run on the authorized target.
