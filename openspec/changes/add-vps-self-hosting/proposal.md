# Proposal

## Why

Inkstone currently requires Cloudflare Workers and its managed bindings, so it cannot be operated as a conventional service on the owner's existing VPS. A supported single-node mode is needed to keep application data and operations on that VPS while preserving the approved first-release user experience.

## What Changes

- Add a production-oriented single-VPS runtime that serves the existing web application and API without a Cloudflare account.
- Persist relational data in a local SQLite database and attachments in a durable local filesystem volume.
- Preserve account access, note editing, folders and tags, keyword search, attachments, public sharing, offline write recovery, import/export, WebDAV/S3 backups, and MCP access.
- Provide automatic multi-device refresh through the existing polling fallback; Cloudflare Durable Object realtime delivery is not required in the first VPS release.
- Keep keyword search available while treating AI semantic search as unavailable in the first VPS release.
- Add repeatable container deployment, health checks, persistent volumes, environment configuration, reverse-proxy guidance, backup guidance, and upgrade-safe database initialization.
- Manage the VPS adaptation on a dedicated Git branch with auditable commits in the owner's GitHub Fork, and deploy an identified commit rather than an untracked server copy.
- Retain the existing Cloudflare deployment path so upstream-compatible deployments remain possible.

## Capabilities

### New Capabilities

- `vps-self-hosting`: Run and operate Inkstone as a durable single-node VPS service without Cloudflare runtime dependencies.

### Modified Capabilities

None. This repository does not yet contain baseline OpenSpec capabilities.

## Impact

- Affected areas include the Worker environment bindings, database and object-storage adapters, static asset serving, application startup, scheduled maintenance, health reporting, build scripts, container packaging, deployment documentation, and integration tests.
- New runtime dependencies are limited to components required for the Node.js VPS process and local persistence.
- Existing browser API contracts and Cloudflare configuration remain compatible.
- Production deployment will add an Inkstone service, persistent database and attachment directories, and an Nginx virtual host on the target VPS.
