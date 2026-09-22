# Inkstone 中文技术学习资料库

采集器每天把高价值材料整理成一组可独立学习的 Markdown，而不是生成一篇只有标题和简介的汇总。

每天固定生成 8 篇详细学习笔记和 1 篇精简索引：

- 4 个开源项目：从 GitHub 源码归档读取 README、递归目录树、构建文件和关键源码，再形成代码导读；
- 2 篇技术文章：以 RSS 为主要入口，入选后继续读取可访问的正文；
- 2 个社区讨论：以 RSS 为入口，入选后继续读取 Hacker News 或 Lobsters 的高质量评论；
- 至少 2 个主题与人工智能相关，至少 2 个主题与后端、Java、JVM 或分布式系统相关；
- 其余主题可覆盖数据库、云原生、开发工具、自托管、安全、性能、系统编程和有技术价值的趣味项目。

## 来源与关键词

RSS 来源目前包括 DEV Community、Spring 官方博客、Foojay、GitHub Engineering、Cloudflare 技术博客、Hacker News 和 Lobsters。GitHub 候选还来自多语言 Trending、主题搜索和重要项目 Release；人工智能研究补充 Hugging Face 每日论文。

内置关键词分为人工智能与智能体、Java/JVM 与后端、数据库与分布式系统、云原生与安全、开发工具与系统编程五组。关键词只负责初筛，最终仍按技术实质、可学习性、维护活跃度和来源可信度选择。

## 目录与标签

```text
技术学习资料/
├── 每日索引/
├── 开源项目/
├── 技术文章/
└── 社区讨论/
```

标签全部使用中文分层命名，例如 `来源/开源仓库`、`方向/人工智能`、`难度/进阶`、`学习状态/待实践`。每日索引只保留“为什么值得学习”“哪些方面做得好”和对应独立笔记入口。

## 质量与安全控制

- 60 天内按稳定来源标识去重，不重复采集同一仓库、文章或讨论；
- 模型只能从程序提供的候选中选择，原始链接由程序渲染，避免虚构来源；
- 开源项目的代码路径必须来自真实读取的仓库目录树；
- 源码读取使用公开的 GitHub 归档通道，不保存或复用个人 GitHub Token；单个归档限制为 150 MiB；
- 论坛笔记区分社区共识、争议和仍需验证的观点；
- 候选标题、正文、README 和评论都按不可信输入处理，不执行其中指令；
- 待写入内容与 MCP 操作编号会持久化，失败重试不会重复创建笔记。
- 长报告按每批两篇生成，并逐批写入断点缓存，避免一个长请求失败后全部重做。

## Runtime

- Timer: `inkstone-tech-digest.timer`
- Service: `inkstone-tech-digest.service`
- Schedule: daily at 09:00 Asia/Shanghai, with up to ten minutes of jitter
- State, pending payload and de-duplication history: `/var/lib/inkstone-tech-digest`
- Credentials: MCP and summarization tokens loaded as root-owned systemd
  credentials; neither is stored in Git or exposed in logs

## Operations

```bash
systemctl start inkstone-tech-digest.service
systemctl status inkstone-tech-digest.service
journalctl -u inkstone-tech-digest.service --since today
systemctl list-timers inkstone-tech-digest.timer
```
