# 16 · Original handoff delivery scope

Historical ZIP scope below. Current implementation, test evidence and unresolved gates are in `README.md`, `PROGRESS.md`, `docs/17_IMPLEMENTATION_AND_OPERATIONS.md` and `qa/implementation/REPORT.md`.

| Area | In this ZIP | Required implementation work |
|---|---|---|
| Requirements / threat model | Detailed documents | Validate assumptions on owned environment |
| Agent task / backlog | Full task prompt and ordered tickets | Build isolated repo, review commits |
| Input | Three profiles, ownership module and unit tests | Official Guacamole integration, real keysym/IME/pointer tests |
| Authentication | Signed-JWT, sessions and intent contracts | Actual vetted JWT verifier, CSRF, atomic storage and gateway endpoints |
| Remote desktop | Chosen architecture and transport contract | Java gateway, official libraries, guacd and real Mac setup |
| UI | Interactive local design prototype, screenshots | Production transport, status, privacy and accessibility integration |
| PWA | Lifecycle/offline/update requirements and cache predicate | Real manifest/icons, worker, multi-tab update and install tests |
| Deployment | Guarded templates and read-only preflight | Built pinned images, approved target config, live Access/Tunnel |
| Recovery | Runbooks and stop conditions | Real sleep/restart and revocation evidence |
| QA | Reference test results and future acceptance plan | Every real-system acceptance row |

The reference tests are intentionally narrow; no result in them proves authorized public remote access. No production image, tunnel credential or target password is included.
