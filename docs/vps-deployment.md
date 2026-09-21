# Inkstone VPS deployment

This guide runs Inkstone as a single, non-root Node 24 container behind an existing Nginx server. The application port is published on loopback only. No Cloudflare account, credential, binding, or network access is required.

## Requirements

- Linux VPS with Docker Engine and the Compose plugin
- Nginx and a TLS certificate for the chosen hostname
- DNS `A` or `AAAA` record pointing to the VPS
- A clean checkout of the owner's GitHub Fork

The first VPS release supports accounts, notes and history, folders, tags, FTS5 keyword search, attachments and avatars, sharing, browser offline recovery, import/export, WebDAV/S3 backups, TOTP, MCP API keys, and OAuth 2.1. It uses polling instead of realtime push and does not provide semantic search without a future compatible provider.

### First-release capability differences

- Multi-device updates use the existing authenticated `/api/sync` polling path. The health API reports `realtime: false`, so the client does not advertise or attempt the unavailable push channel. A future VPS release can add a process-local or external WebSocket fan-out adapter while retaining the same SQLite change log and polling fallback.
- Search uses SQLite FTS5 keyword indexing. The health API reports `semanticSearch: false`, and the client keeps semantic controls unavailable. A future embedding provider must be configured explicitly, preserve per-account index isolation, and rebuild its derived index from the existing notes; no note-data migration is required.

These differences are capability boundaries, not degraded storage modes. Do not set UI flags manually or claim the missing services through a proxy.

## Install

Use a full commit hash for both checkout and image metadata:

```bash
sudo install -d -o root -g root -m 0755 /opt/inkstone
sudo install -d -o "$USER" -g "$USER" -m 0750 /opt/inkstone/source
git clone https://github.com/chengfengy5-commits/inkstone.git /opt/inkstone/source
cd /opt/inkstone/source
git fetch --tags origin
git checkout --detach <FULL_COMMIT>
cp .env.vps.example .env.vps
```

Set these values in `.env.vps`:

```dotenv
INKSTONE_IMAGE_TAG=0.8.0-<SHORT_COMMIT>
INKSTONE_VERSION=0.8.0
INKSTONE_REVISION=<FULL_COMMIT>
INKSTONE_PUBLIC_URL=https://inkstone.example.com
INKSTONE_LISTEN_PORT=17712
INKSTONE_DATA_PATH=/opt/inkstone/data
INKSTONE_MAINTENANCE_INTERVAL_MS=900000
```

Create the persistence directory before the first start. UID/GID `1000` is the unprivileged `node` account in the pinned image; the data directory remains private even though operators can traverse the parent to reach the source checkout:

```bash
sudo install -d -o 1000 -g 1000 -m 0700 /opt/inkstone/data
docker compose --env-file .env.vps -f compose.vps.yaml build --pull
docker compose --env-file .env.vps -f compose.vps.yaml up -d
docker compose --env-file .env.vps -f compose.vps.yaml ps
curl --fail --silent http://127.0.0.1:17712/readyz
```

On first startup, Inkstone creates `/opt/inkstone/data/secrets/vault.key` with mode `0600`. It encrypts WebDAV and S3 credentials and must be backed up together with both SQLite databases and attachments. Never replace it independently.

Compose grants shutdown up to ten minutes. Inkstone cancels an in-flight scheduled remote transfer, records its outcome, and only then closes SQLite; operators should still avoid stopping the service during a time-sensitive backup.

## Nginx and TLS

The proxy must overwrite `X-Real-IP`; Inkstone trusts that header only in the loopback-bound VPS runtime for per-IP throttling.

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name inkstone.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name inkstone.example.com;

    ssl_certificate /etc/letsencrypt/live/inkstone.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/inkstone.example.com/privkey.pem;

    client_max_body_size 101m;
    proxy_read_timeout 300s;
    proxy_send_timeout 300s;

    location / {
        proxy_pass http://127.0.0.1:17712;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header Connection "";
    }
}
```

Validate before reloading:

```bash
sudo nginx -t
sudo systemctl reload nginx
curl --fail --silent https://inkstone.example.com/readyz
```

Use the server's established certificate workflow. For a conventional Certbot installation, issue the certificate before enabling the TLS server block:

```bash
sudo certbot --nginx -d inkstone.example.com
```

## Monitoring

- `GET /healthz` proves the HTTP process is alive.
- `GET /readyz` probes SQLite, OAuth KV, attachment storage, and the credential vault.
- Authenticated `GET /api/health` reports runtime, storage, feature capabilities, version, and source revision.

```bash
docker compose --env-file .env.vps -f compose.vps.yaml ps
docker compose --env-file .env.vps -f compose.vps.yaml logs --since 30m inkstone
curl --fail --silent https://inkstone.example.com/readyz
```

Alert on a non-2xx readiness response, a container restart loop, persistent `Scheduled maintenance failed` messages, filesystem exhaustion, or a backup target's repeated failure state.

## Matched backup and restore rehearsal

Application ZIP backups intentionally omit passwords, sessions, share-password hashes, and remote-backup credentials. An operator backup must therefore preserve the complete mounted data directory as one matched set.

For a crash-consistent archive with the shortest and safest procedure, stop only Inkstone while copying:

```bash
cd /opt/inkstone/source
docker compose --env-file .env.vps -f compose.vps.yaml stop inkstone
sudo tar --xattrs --acls -C /opt/inkstone -czf /root/inkstone-data-<UTC_TIMESTAMP>.tar.gz data
docker compose --env-file .env.vps -f compose.vps.yaml start inkstone
curl --fail --silent http://127.0.0.1:17712/readyz
```

Copy the archive off the VPS. It contains sensitive account data and the vault key; encrypt and restrict it at the storage boundary.

Rehearse restoration in an isolated directory and port without touching production:

```bash
sudo install -d -o root -g root -m 0700 /opt/inkstone-restore-check
sudo tar --xattrs --acls -C /opt/inkstone-restore-check -xzf /root/inkstone-data-<UTC_TIMESTAMP>.tar.gz
sudo chown -R 1000:1000 /opt/inkstone-restore-check/data
docker run --rm -d --name inkstone-restore-check \
  -p 127.0.0.1:27712:7712 \
  -e INKSTONE_PUBLIC_URL=http://127.0.0.1:27712 \
  -v /opt/inkstone-restore-check/data:/data \
  inkstone:<IMAGE_TAG>
curl --fail --silent http://127.0.0.1:27712/readyz
docker rm -f inkstone-restore-check
```

Delete the isolated restored copy after the rehearsal according to the operator's data-retention policy.

## Upgrade and rollback

Record the running revision and take a matched backup before changing the image:

```bash
cd /opt/inkstone/source
docker inspect inkstone-inkstone-1 --format '{{index .Config.Labels "org.opencontainers.image.revision"}}'
git fetch origin
git checkout --detach <NEW_FULL_COMMIT>
cp .env.vps .env.vps.next
```

Update version, revision, and image tag in `.env.vps.next`, then build and replace:

```bash
docker compose --env-file .env.vps.next -f compose.vps.yaml build --pull
docker compose --env-file .env.vps.next -f compose.vps.yaml up -d
curl --fail --silent http://127.0.0.1:17712/readyz
```

After validation, replace `.env.vps` with the reviewed next file. For an application-only rollback with compatible data, restore the previous `.env.vps` image tag and run `docker compose up -d`. If a failed version committed an incompatible migration, stop the service and restore the matched pre-upgrade data archive before starting the previous image. Never mix an old vault key, OAuth database, main database, or attachment directory with a newer set.

## Data layout

```text
/opt/inkstone/data/
├── inkstone.sqlite        # accounts, notes, indexes, settings, shares
├── inkstone.sqlite-wal
├── inkstone.sqlite-shm
├── oauth.sqlite           # OAuth clients, grants, codes, and tokens
├── oauth.sqlite-wal
├── oauth.sqlite-shm
├── attachments/           # attachment objects and metadata
└── secrets/vault.key      # backup-credential encryption key, mode 0600
```

Do not edit these files while the service is running. Use the application UI for JSON/ZIP portability and the matched operator archive for disaster recovery.
