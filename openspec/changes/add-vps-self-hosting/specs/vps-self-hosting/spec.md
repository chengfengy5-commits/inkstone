# Spec Delta

## Purpose

Defines a durable, observable, and reversible single-node VPS deployment of Inkstone that does not require a Cloudflare account or Cloudflare-managed runtime services.

## ADDED Requirements

### Requirement: Cloudflare-independent startup
The system SHALL start and serve the Inkstone web application and API on a supported Linux VPS without Cloudflare credentials, bindings, or network access.

#### Scenario: Start with local configuration
- **WHEN** an operator starts the documented VPS deployment with valid local paths and secrets
- **THEN** the application becomes ready without attempting to authenticate to Cloudflare

#### Scenario: Missing required configuration
- **WHEN** an operator starts the VPS deployment without a required secret or with an unwritable persistence path
- **THEN** startup fails before accepting traffic and reports the invalid setting without exposing secret values

### Requirement: Durable local persistence
The system SHALL persist relational application data, OAuth state, encrypted credentials, and attachments in operator-mounted VPS storage.

#### Scenario: Process restart
- **WHEN** the application is restarted after users have created accounts, notes, settings, and attachments
- **THEN** the same data remains available after readiness is restored

#### Scenario: Container replacement
- **WHEN** the application container is replaced while its documented persistent volumes are retained
- **THEN** the replacement instance initializes successfully without resetting or duplicating existing data

#### Scenario: Attachment isolation
- **WHEN** an authenticated user requests an attachment owned by another account
- **THEN** the server denies access under the existing authorization rules

### Requirement: Approved first-release features
The VPS deployment SHALL preserve account access, note editing and history, folders, tags, keyword search, attachments and avatars, public sharing, offline write recovery, import/export, WebDAV/S3 backups, two-factor authentication, and MCP access.

#### Scenario: Core browser workflow
- **WHEN** a user registers or signs in and creates, edits, searches, exports, and reopens a note
- **THEN** each operation completes through the existing browser interface and survives a service restart

#### Scenario: Attachment workflow
- **WHEN** a user uploads an allowed attachment and later opens or exports the containing note
- **THEN** the attachment is retrievable with its content type and is included according to the existing export behavior

#### Scenario: Backup credentials
- **WHEN** a user saves WebDAV or S3 credentials and later runs a backup
- **THEN** credentials are stored encrypted at rest and the backup can use them after a restart

#### Scenario: MCP workflow
- **WHEN** an owner enables MCP and creates an API key
- **THEN** an authorized MCP client can read and update permitted notes using the existing MCP contract

### Requirement: Explicit first-release degradations
The VPS deployment SHALL expose keyword search and automatic polling while reporting realtime push and AI semantic search as unavailable unless compatible providers are configured.

#### Scenario: Multi-device refresh without push
- **WHEN** one device changes a note while another signed-in device remains open
- **THEN** the second device observes the change through the existing automatic polling fallback without requiring a manual page reload

#### Scenario: Semantic search unavailable
- **WHEN** no compatible embedding provider is configured
- **THEN** keyword search remains usable and the interface does not claim that semantic search is available

### Requirement: Safe initialization and upgrades
The VPS deployment SHALL initialize and migrate its local database idempotently and SHALL prevent concurrent schema initialization from corrupting stored data.

#### Scenario: Empty database
- **WHEN** the application starts with an empty persistence directory
- **THEN** it creates the required schema and seed state exactly once

#### Scenario: Repeated startup
- **WHEN** the same application version starts multiple times against an initialized database
- **THEN** schema initialization makes no destructive changes and creates no duplicate seed data

#### Scenario: Failed upgrade
- **WHEN** a database migration cannot complete
- **THEN** the deployment remains unhealthy, logs the failure, and does not silently discard or recreate the database

### Requirement: Operational health and maintenance
The VPS deployment SHALL provide unauthenticated liveness and readiness signals and SHALL execute scheduled cleanup, index maintenance, and configured backups without Cloudflare cron triggers.

#### Scenario: Ready service
- **WHEN** the HTTP process, database, attachment store, credential vault, and OAuth store are usable
- **THEN** the readiness endpoint returns success and identifies the VPS runtime without disclosing secrets

#### Scenario: Unready dependency
- **WHEN** a required persistence component cannot be read or written
- **THEN** readiness returns failure and the reverse proxy can keep the instance out of service

#### Scenario: Scheduled maintenance
- **WHEN** the documented maintenance interval elapses
- **THEN** due backups, cleanup, retention, and search-index work execute once with overlapping runs prevented

### Requirement: Reproducible GitHub-managed deployment
The VPS deployment SHALL be buildable from the owner's GitHub Fork and SHALL expose enough version information to identify the deployed source revision.

#### Scenario: Build from a clean checkout
- **WHEN** an operator checks out a documented commit from the Fork and runs the production build
- **THEN** the same container image can be produced without files copied from an untracked server workspace

#### Scenario: Version diagnosis
- **WHEN** an operator inspects application health or container metadata
- **THEN** the deployed application version and source revision can be identified

### Requirement: Reversible deployment and backups
The deployment documentation SHALL define data backup, restore verification, application upgrade, and rollback procedures for the single-VPS installation.

#### Scenario: Application rollback
- **WHEN** a new application image fails before introducing an incompatible committed migration
- **THEN** the operator can restart the previously identified image against the retained volumes

#### Scenario: Data restore rehearsal
- **WHEN** an operator follows the documented restore procedure against an isolated test location
- **THEN** the database and attachment set can be opened together without modifying the production copy

### Requirement: Cloudflare deployment compatibility
The existing Cloudflare build and deployment path SHALL remain available unless a documented upstream incompatibility is discovered during implementation.

#### Scenario: Cloudflare dry run
- **WHEN** the existing Cloudflare deployment check is run after the VPS adaptation
- **THEN** it completes with the same required bindings and without importing VPS-only Node modules into the Worker bundle
