# Curated Chinese technology learning digest

The collector replaces the former raw GitHub Trending and AI frontier notes
with one concise Chinese learning brief per day.

Each digest contains exactly ten unique items: five broad open-source GitHub
discoveries, three AI items, and two Java/JVM items. The GitHub section spans
developer tools, self-hosted applications, productivity software, data and
infrastructure, creative coding, and technically interesting trending projects.
A language model selects and summarizes only supplied candidates;
the program validates every selected id against the candidate set and renders
the original source URL itself, so the model cannot invent links.

Quality controls include:

- a fixed 5/3/2 balance for open-source GitHub, AI, and Java/JVM;
- multi-language Trending feeds plus focused searches for developer tools,
  self-hosted software, productivity, and creative coding;
- filtering obviously anomalous young repositories with extreme star counts;
- excluding items written during the prior 60 days;
- preferring official organizations, important releases, reproducible research,
  maintained infrastructure, security work, and performance improvements;
- persisting an exact pending payload and MCP operation id for safe retries.

## Runtime

- Timer: `inkstone-tech-digest.timer`
- Service: `inkstone-tech-digest.service`
- Schedule: daily at 09:00 Asia/Shanghai, with up to ten minutes of jitter
- State and de-duplication history: `/var/lib/inkstone-tech-digest`
- Credentials: MCP and summarization tokens loaded as root-owned systemd
  credentials; neither is stored in Git or exposed in logs

## Operations

```bash
systemctl start inkstone-tech-digest.service
systemctl status inkstone-tech-digest.service
journalctl -u inkstone-tech-digest.service --since today
systemctl list-timers inkstone-tech-digest.timer
```
