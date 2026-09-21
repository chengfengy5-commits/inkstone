# Tasks

## 1. Establish the VPS development baseline

- [x] 1.1 Create a dedicated `feature/vps-self-hosting` branch from the clean Fork baseline and verify `origin`, read-only `upstream`, and branch status are correct.
- [x] 1.2 Commit the OpenSpec planning artifacts as the first auditable change and verify `openspec validate add-vps-self-hosting --strict` passes.
- [x] 1.3 Add only the Node runtime, server, build, and test dependencies required by the design; verify a clean Node 24 `npm ci` succeeds.
- [x] 1.4 Refactor the Worker fetch and scheduled-maintenance entry points into shared functions without changing Cloudflare behavior; verify existing unit tests and the Cloudflare deploy dry run pass.

## 2. Implement and test local persistence adapters

- [x] 2.1 Implement the SQLite-backed D1 compatibility adapter with serialized operations, atomic batches, WAL, FTS5, D1-style results, and graceful close; verify contract tests cover `prepare`, `bind`, `first`, `all`, `run`, `batch`, `exec`, rollback, and concurrent calls.
- [x] 2.2 Implement the persistent local KV namespace used by OAuth, including expiration and listing semantics exercised by the provider; verify KV contract tests and OAuth registration/token/revocation integration tests pass across a restart.
- [x] 2.3 Implement the filesystem object-store adapter with key confinement, atomic writes, streaming reads, metadata, multi-delete, and restart durability; verify traversal rejection, ownership-preserving application reads, upload/download, and delete tests pass.
- [x] 2.4 Implement the persistent local credential-vault namespace with a separate protected master key and fail-closed key validation; verify encryption/decryption, restart persistence, wrong-key failure, backup credentials, and TOTP tests pass without logging secrets.
- [x] 2.5 Implement the local static asset fetcher and execution-context adapter; verify SPA fallback, API route priority, cache/content-type behavior, and deferred work completion in integration tests.

## 3. Add the production VPS runtime

- [x] 3.1 Add strict environment configuration parsing for bind address, port, public URL, data paths, vault key, maintenance interval, version, and revision; verify invalid or insecure configuration fails before listening and does not print secrets.
- [x] 3.2 Add the Node HTTP entry point that constructs local bindings and invokes the shared application handler; verify unauthenticated liveness and dependency-aware readiness responses against healthy and intentionally broken stores.
- [x] 3.3 Add a non-overlapping maintenance scheduler around the shared scheduled handler with clean shutdown behavior; verify fake-timer tests cover success, failure recovery, overlap prevention, and shutdown.
- [x] 3.4 Make runtime capability reporting identify local attachment storage, polling availability, disabled realtime push, disabled semantic search, MCP availability, application version, and source revision; verify API response tests match the documented state.
- [x] 3.5 Add a VPS-specific client and server production build while preserving existing Worker boundaries; verify `npm run build:vps`, `npm run build`, and `npm run deploy:check` all pass under Node 24.

## 4. Prove application behavior on local storage

- [x] 4.1 Extend the end-to-end harness to launch a fresh VPS instance and verify owner registration, sign-in, note create/edit/history/search/delete/restore, folders, tags, settings, and restart persistence.
- [x] 4.2 Verify attachment and avatar upload/read/export/delete behavior, public sharing with access controls, and import/export round trips against the filesystem store.
- [x] 4.3 Verify offline synchronization and optimistic concurrency APIs with push disabled, including the client polling fallback observing changes from a second session.
- [x] 4.4 Verify WebDAV/S3 backup configuration uses encrypted credentials and exercise a backup against a disposable local test endpoint.
- [x] 4.5 Verify MCP API-key and OAuth authorization flows can read and update permitted notes, reject unauthorized operations, and survive a service restart.

## 5. Package and document deployment

- [x] 5.1 Add a multi-stage, non-root Node 24 production container with embedded version/revision and a health check; verify the image contains no source secrets, Cloudflare credentials, build cache, or development process.
- [x] 5.2 Add a Compose definition with loopback-only HTTP exposure, named persistent paths, restart policy, resource-aware defaults, and root-only secret injection; verify a clean Compose start becomes ready and retains data after container replacement.
- [x] 5.3 Document VPS installation, configuration, Nginx/TLS proxying, upgrades, monitoring, combined data backup, isolated restore rehearsal, and application/image rollback; verify every command against a disposable deployment.
- [x] 5.4 Document the accepted first-release capability differences and future migration paths for realtime push and semantic search; verify the UI and health API do not advertise unavailable capabilities.

## 6. Version, deploy, and live-verify

- [x] 6.1 Run the complete Node 24 verification suite: typecheck, unit tests, i18n check, comment check, VPS integration tests, VPS build, Cloudflare build/dry run, and clean-image smoke test; record results and resolve all in-scope failures.
- [x] 6.2 Review the full branch diff against the OpenSpec requirements, run `git diff --check`, confirm the worktree is clean after commits, and push the feature branch to the owner's GitHub Fork.
- [x] 6.3 Back up the target VPS configuration, deploy the exact pushed commit without modifying existing services, and verify the container, loopback port, readiness, logs, persistent paths, and restart behavior.
- [x] 6.4 Configure `inkstone.ai-dark.top` only if DNS resolves to the VPS, install a separate Nginx TLS virtual host, and verify HTTPS, security headers, request-size limits, and no conflict with existing sites.
- [ ] 6.5 Execute the approved live workflow through the deployed UI and API, including note/search/attachment/share/export/restart/backup/MCP checks, and record evidence for each OpenSpec scenario.
- [ ] 6.6 Run the grill-me verification pass against the approved plan, make only snapshot-protected minimal repairs if needed, rerun the complete verification, and report the final Git commit and deployed version.
- [ ] 6.7 Remove the temporary Cloudflare OAuth credential and temporary SSH authorization after final verification, prove both are unusable, then remove the local temporary key pair and report the cleanup evidence.
