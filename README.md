# PWA Remote Desktop Gateway

An implemented local pilot: vanilla JavaScript PWA, authenticated Java gateway and the official Apache Guacamole transport. Each approved personal Mac gets its own independent node and hostname. Cloudflare Access supplies email OTP; the gateway verifies the signed assertion, exact owner, app session and one-use WebSocket intent.

**Public/real-device readiness is BLOCKED.** No actual Mac Screen Sharing, modifier calibration, Windows/Safari/iOS controller, external-network route or sleep/reboot acceptance has passed. The test protocol peer and HTTPS test edge are explicitly disposable fixtures. They are excluded from the production JAR/image and cannot prove Mac compatibility.

## Build and verify

Use Java 17 and Node 22 or newer. No frontend npm runtime dependencies or CDN assets are required.

```sh
npm ci --ignore-scripts
npm test
npm run build
npm run test:backup
```

`npm test`: 74 unchanged reference tests plus production input tests. The Maven build runs actual gateway unit/integration tests: signed JWTs, HTTP/API policy, real javax WebSocket upgrades to an official-protocol fixture, replay/ownership, view-only abuse, live deadline/logout teardown and maintenance locking. `gateway/dependencies.lock.json` verifies the resolved runtime coordinates and JAR digests.

Build outputs: `gateway/target/rdg-gateway.jar` and `web/dist/`. Output identities are recorded in `qa/implementation/artifacts.json` after verification.

Browser regression uses a separately installed Playwright library and Chromium, with no `@playwright/test` dependency:

```sh
npm run test:browser
```

Optional paths: `RDG_PLAYWRIGHT_MODULE` points to an existing Playwright module, and `RDG_TEST_CHROMIUM` to an existing Chromium executable. The launcher generates temporary test credentials/certificate, starts loopback-only fixtures, checks the production UI and two-tab worker update, then removes its temporary resources. Sanitized results are in `qa/implementation/`; fixture screenshots are in `output/playwright/`.

## Configure and operate

See [deployment/README.md](deployment/README.md). Startup refuses missing/placeholder Access settings, unknown target configuration, permissive/symlinked secrets or absent explicit modifier calibration. Browser requests cannot select an upstream host, protocol, port or password. The app provides no local OTP/authentication bypass.

```sh
docker build --platform linux/arm64 -t rdg-gateway:reviewed .
RDG_TEST_IMAGE=rdg-gateway:reviewed npm run test:container
RDG_TEST_IMAGE=rdg-gateway:reviewed npm run test:official-guacd
```

The pinned JRE and official guacd index support ARM64. No deployment, Tunnel/Access policy, Screen Sharing, firewall or existing host service was changed by implementation. `deployment/compose.blueprint.yaml` remains an operator-filled, approval-gated template; it publishes only gateway port 32120 on loopback and never guacd/VNC.

## Evidence and limits

- [PROGRESS.md](PROGRESS.md): backlog IDs, worktree/authority record and remaining gates.
- [qa/implementation/REPORT.md](qa/implementation/REPORT.md): exact local validation and limitations.
- [qa/acceptance-matrix.csv](qa/acceptance-matrix.csv): production release gates; fixture checks are not promoted to real-device passes.
- [docs/17_IMPLEMENTATION_AND_OPERATIONS.md](docs/17_IMPLEMENTATION_AND_OPERATIONS.md): implementation decisions, configuration, lifecycle, deployment/recovery and acceptance procedure.
- [web/vendor/provenance.json](web/vendor/provenance.json): Guacamole artifact source, SHA256 and verified Apache signing key.

The original `.md` specification, prototype and reference modules remain design inputs. `npm run preview` opens the explicitly labelled design prototype. `MANIFEST.sha256` describes the untouched handoff; `npm run verify:handoff` is only for that original archive, not this intentionally modified implementation branch.
