# Design

## Context

Inkstone exposes its application through a Hono Worker and uses Cloudflare D1, R2 or KV, Workers KV, Durable Objects, Workers AI, static asset bindings, and cron triggers. The route and domain code primarily depend on the binding interfaces rather than Cloudflare APIs directly, while the database SQL is already SQLite-oriented. See `proposal.md` for the motivation and `specs/vps-self-hosting/spec.md` for the required external behavior.

The target is one Ubuntu VPS behind its existing Nginx installation. The owner wants source history in the GitHub Fork and a deployable production service rather than a long-running development emulator.

## Goals / Non-Goals

**Goals:**

- Add a production Node.js entry point while sharing the existing Hono routes and business logic.
- Keep local state durable, backupable, and confined to mounted directories.
- Minimize divergence from upstream by adapting binding interfaces at the runtime boundary.
- Keep Cloudflare builds operational and prevent Node-only modules from entering the Worker bundle.
- Provide reproducible containers, health checks, migration safety, tests, and deployment documentation.

**Non-Goals:**

- Horizontal scaling or automatic failover in the first VPS release.
- Replacing automatic polling with a new realtime push implementation in the first VPS release.
- Providing semantic embeddings without an explicitly configured non-Cloudflare provider.
- Migrating existing Cloudflare D1 or R2 data; no production Inkstone data exists yet.
- Rewriting the React client, route contract, or existing domain behavior.

## Decisions

### 1. Add a Node runtime adapter instead of operating a development emulator

Create a VPS-only entry point that invokes the existing Worker fetch handler under a production Node HTTP server. The entry point constructs local implementations of the required environment bindings, supplies an execution context for background work, serves the built client assets, and runs scheduled maintenance.

This avoids relying on `wrangler dev` or Miniflare as a production service. A complete rewrite into a separate API server was rejected because it would duplicate hundreds of existing queries and substantially increase long-term merge conflicts.

### 2. Preserve D1 call sites through a SQLite compatibility adapter

Use Node 24's built-in SQLite support behind the subset of the D1 interface used by Inkstone: `prepare`, `bind`, `first`, `all`, `run`, `batch`, and `exec`. Parameter and result normalization will match the existing route expectations. Database calls and batches will be serialized inside one process; a batch executes within one SQLite transaction.

SQLite is selected because the existing schema and queries are SQLite/D1 dialect, including FTS5. PostgreSQL was rejected for the first release because translating query semantics and transaction behavior would create broad, unnecessary application changes. The database will use WAL mode, foreign-key enforcement, a busy timeout, and explicit shutdown handling.

### 3. Implement local binding adapters at the boundary

- Attachments and avatars use a filesystem-backed object-store adapter rooted under the configured data directory. Keys are validated and resolved beneath that root to prevent traversal. Writes use a temporary file followed by an atomic rename.
- OAuth KV uses a persistent SQLite-backed namespace with expiration support and the KV methods exercised by the OAuth provider.
- The credential vault keeps the existing envelope-encryption behavior behind a local Durable Object-compatible namespace. Its master key is stored in a separate root-readable secret file and is never generated anew when an existing encrypted database is present.
- Realtime Durable Objects and Workers AI are left unbound in the first release so existing polling and keyword-search fallbacks remain authoritative.

The alternative of storing attachments as database blobs was rejected because it complicates streaming, database backup size, and independent file verification.

### 4. Build VPS and Cloudflare targets separately

Add a VPS client build mode that omits the Cloudflare Vite plugin, plus a server bundle that contains only the Node entry point and its runtime adapters. Conditional entry points and build-time boundaries prevent Node built-ins from entering the Worker bundle. Existing Cloudflare commands remain unchanged and are included in regression verification.

The production image will use a pinned Node 24 base image, run as a non-root user, expose only a loopback-bound application port through Compose, include a container health check, and declare database and attachment volumes. The image embeds the package version and Git revision.

### 5. Make startup and maintenance fail closed

Startup validates configuration, permissions, database access, FTS availability, OAuth storage, attachment read/write/delete behavior, and credential-vault key consistency before reporting readiness. Schema initialization remains idempotent and runs before traffic is accepted.

The Worker scheduled handler will be refactored into a shared callable function. The VPS scheduler executes it at a bounded interval with a process-local overlap guard; a failure is logged and retried on the next interval without stopping request handling. Only one application replica is supported.

### 6. Treat Git history as the deployment source of truth

Development occurs on a dedicated branch in the owner's Fork. Planning artifacts, implementation, tests, and deployment files are committed in reviewable units. The server checkout is updated to a specific commit and the container is built from that checkout. No uncommitted source file is part of the production deployment.

### 7. Deploy behind the existing reverse proxy with a dedicated hostname

Use `inkstone.ai-dark.top` as the intended service hostname, subject to DNS availability. Nginx terminates TLS and proxies to the loopback-only application port. Deployment will not reuse or overwrite the existing MindFS or stock-analyzer virtual hosts.

## Risks / Trade-offs

- **[Node SQLite API or FTS behavior differs from D1]** → Contract tests exercise parameter binding, metadata, transactions, FTS initialization, and representative application workflows against the local adapter.
- **[Single-node storage cannot tolerate host loss]** → Document and verify combined backups of the database, credential key, OAuth store, and attachments; keep application-level WebDAV/S3 backups available.
- **[OAuth provider assumes additional Workers KV behavior]** → Trace the installed provider's actual calls and add integration tests for registration, authorization, token issue, refresh, and revocation before enabling MCP in production.
- **[A leaked or lost vault key exposes or strands encrypted secrets]** → Create it with restrictive permissions, fail closed on mismatch, include it in encrypted operator backups, and never log it.
- **[Polling is less immediate than realtime push]** → Preserve the existing bounded polling behavior and report realtime as unavailable; a future change can add WebSocket fan-out without changing this release's persistence model.
- **[Upstream updates conflict with adapters]** → Keep Node-specific code under a dedicated runtime directory, retain the original binding contracts, and run both VPS and Cloudflare build checks.
- **[Container runs newer Node than local developer host]** → Define Node 24 as the authoritative build/test environment and execute verification in the same image used by CI and deployment.

## Migration Plan

1. Create the feature branch and commit the approved OpenSpec artifacts.
2. Implement and contract-test the local database, object storage, OAuth KV, credential vault, asset server, and execution-context adapters.
3. Add the Node entry point, scheduler, health/readiness behavior, VPS build, container, Compose definition, and operator documentation.
4. Run unit tests, VPS integration tests, application build, Cloudflare dry run, and a clean-container smoke test.
5. Push the reviewed commits to the owner's GitHub Fork.
6. On the VPS, back up any target directories, check out the identified commit, create root-only runtime secrets, build the image, and start it on a loopback port.
7. Configure DNS and a separate Nginx TLS virtual host, then execute the live workflow: account creation, note lifecycle, search, attachment, restart persistence, export, share, backup configuration, and MCP access.
8. Roll back by restoring the previous image and configuration. If a database migration has committed, restore the pre-deployment database, OAuth store, vault key, and attachments as one matched backup set before starting the prior image.

## Open Questions

- The final hostname remains conditional on the DNS record being available during deployment; this does not affect the runtime design or task breakdown.
