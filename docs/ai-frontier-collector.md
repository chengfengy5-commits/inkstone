# AI frontier collector

The VPS collector writes one private `AI 前沿雷达 · YYYY-MM-DD` note to
Inkstone every day. It complements the general GitHub Trending collector with:

- recently created and still-active GitHub projects for AI agents, MCP, RAG,
  multimodal AI, inference infrastructure, world models, and embodied AI;
- Hugging Face Daily Papers, ranked by community upvotes;
- latest releases from a curated watchlist of important AI engineering repos.

## Runtime

- Timer: `inkstone-ai-frontier.timer`
- Service: `inkstone-ai-frontier.service`
- Schedule: daily at 09:30 Asia/Shanghai, with up to ten minutes of jitter
- State: `/var/lib/inkstone-ai-frontier`
- MCP credential: the existing root-only collector credential loaded through
  systemd credentials

The exact pending note is persisted before the MCP write. Retries use the same
payload and `operation_id`; a successful date is recorded to avoid duplicates.
The collector tolerates one unavailable source but fails without marking the
date complete when every source is unavailable.

## Operations

```bash
systemctl start inkstone-ai-frontier.service
systemctl status inkstone-ai-frontier.service
journalctl -u inkstone-ai-frontier.service --since today
systemctl list-timers inkstone-ai-frontier.timer
```
