# GitHub Trending collector

The VPS collector writes one private Inkstone note each day from the `all`,
`java`, `python`, and `typescript` daily GitHub Trending snapshots. It uses a
dedicated MCP API key with `notes:read notes:write` scopes and never stores the
raw key in Git.

## Runtime

- Timer: `inkstone-github-trending.timer`
- Service: `inkstone-github-trending.service`
- Schedule: daily at 09:00 Asia/Shanghai, with up to ten minutes of jitter
- State: `/var/lib/inkstone-github-trending`
- Credential source: `/etc/inkstone/github-trending-mcp.token` (root-only)

The collector connects through the VPS HTTPS virtual host so Inkstone receives
its configured public hostname and keeps its host-validation protection. The
domain is a direct DNS record to the VPS; this task does not depend on a CDN.

The collector persists the exact pending note before calling MCP. Retries reuse
the same `operation_id` and payload. A successful date is recorded so repeated
timer or manual starts do not create duplicate daily notes.

## Operations

```bash
systemctl start inkstone-github-trending.service
systemctl status inkstone-github-trending.service
journalctl -u inkstone-github-trending.service --since today
systemctl list-timers inkstone-github-trending.timer
```

To change the selected lists, add a systemd override for
`TRENDING_LANGUAGES`, then run `systemctl daemon-reload`. The upstream feed
paths use lowercase GitHub language names.
