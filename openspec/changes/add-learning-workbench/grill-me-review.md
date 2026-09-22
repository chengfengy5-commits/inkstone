# Grill Me Review

## 第一批：输出契约与跨来源去重

### 审查范围

- `scripts/learning-library-collector.mjs`
- `scripts/learning-library-collector.test.mjs`
- OpenSpec 任务 1.1–2.3

### 质询与证据

1. **如果同一仓库同时来自 Trending、Search 和 Release，会不会仍生成两篇？**
   - 结论：不会。三种入口统一为 `github:<owner>/<repo>`，候选池保留分数最高的一项，选择验证器再次拒绝重复内容键。
   - 证据：`uses one content key...`、`deduplicates cross-source candidates...`、`rejects an eight-item selection...`。

2. **如果文章 URL 只差 UTM、片段、默认端口或尾斜杠，会不会绕过去重？**
   - 结论：不会。URL 规范化会清除明确的跟踪参数和片段、归一化主机与路径，同时保留 `q`、`lang` 等业务参数。
   - 变异检查：删除跟踪参数清理或错误删除业务参数都会使 `normalizes content URLs...` 失败。

3. **升级前的 seen 文件只有 `repo:` 或 `release:` ID，新入口会不会再次入选？**
   - 初审发现：会。第一版只检查当前 ID 和新内容键，旧 repo/release ID 不能跨入口命中。
   - 修复：增加 GitHub 旧 ID 到内容键的兼容匹配；repo 和任意 release tag 会互相阻止近期重复。
   - 证据：`maps legacy GitHub repo and release ids across source types` 先红后绿。

4. **模型能否用两个不同候选 ID 选择同一内容？**
   - 结论：不能。`validateSelection` 同时检查来源 ID 和内容键；重复内容键直接拒绝整次选择。

5. **模型虚构一个不存在的代码路径，能否进入笔记？**
   - 初审发现：生产代码已有过滤，但缺少直接回归证据。
   - 修复：增加验证器行为测试，只保留实际读取证据中的路径。
   - 证据：`removes model-invented code paths...` 先因缺少可测试导出而红，导出验证边界后转绿。

6. **每日索引是否重新复制长报告，导致用户仍然无法按文件学习？**
   - 结论：不会。索引只含链接、学习价值、两个主要优点和标签；完整章节只存在于独立笔记。
   - 证据：`renders a compact daily index...` 断言全部链接存在且索引不含“背景与问题”正文节。

7. **这些测试能否真正发现生产行为回退？**
   - 结论：可以。按 ID 而非内容键去重、移除 seen 兼容、允许重复选择、删除中文元数据/章节、渲染虚构路径或把完整报告塞入索引，均会使至少一条行为测试失败。

### 验证结果

- 采集器定向测试：13/13 通过（Node 24.15.0）。
- Inkstone 单元测试：111/111 通过（Node 24.15.0）。
- VPS TypeScript 检查：通过。
- `git diff --check`：通过。

### 结论

第一批通过 Grill Me 复审。两个有效缺口均已通过失败测试复现并修复；未发现需要扩大 OpenSpec 范围的问题。

## 第二批：运行状态、脱敏与失败续跑

### 审查范围

- 每日运行记录和阶段转换
- `loadOrCreatePending` 阶段接入
- `writePendingToInkstone` 幂等写入边界
- OpenSpec 任务 3.1–3.4

### 质询与证据

1. **进程失败后，能否直接判断失败发生在哪一步？**
   - 结论：可以。每日原子 JSON 记录 `collecting`、`selecting`、`enriching`、`generating`、`writing-notes`、`writing-index`、`succeeded`，并保留计数、警告、结果和结束时间。
   - 证据：运行记录测试直接读取落盘 JSON，验证阶段、计数、警告和失败结果。

2. **失败重试会不会丢失上次失败上下文？**
   - 结论：不会。同一天新运行递增 `attempt`，并保留最近一次失败的阶段、脱敏错误和时间。

3. **运行记录是否可能泄漏 Token？**
   - 初审发现：Bearer 与 `ink_` Key 已脱敏，但 URL 查询参数中的 `api_key` 和普通 `token=` 仍会保留。
   - 修复：补充查询参数、token、password、secret 和常见 API Key 格式脱敏。
   - 证据：扩展失败测试先暴露 `query-secret`/`plain-secret`，修复后落盘内容不再包含四类测试秘密。

4. **第二篇笔记失败时，会不会先生成一个不完整索引？**
   - 结论：不会。索引写入在全部独立笔记获得有效引用之后；故障注入后只存在第一篇笔记的 operation ID。

5. **重跑时已写入笔记会不会重复？**
   - 结论：不会。pending 保持顺序，笔记使用日期+序号的稳定 operation ID，假 MCP 以同一幂等语义重跑后最终只有两篇笔记和一个索引。
   - 变异检查：改用随机 ID 或在笔记循环前创建索引，会使故障注入测试失败。

6. **运行记录写入自身失败时是否会伪装成采集成功？**
   - 结论：不会。阶段写入属于主流程的一部分，失败会中止；外层尝试记录失败但保留原始异常，成功日期只在笔记、索引和 seen 写入完成后更新。

### 验证结果

- 采集器定向测试：15/15 通过（Node 24.15.0）。
- Inkstone 单元测试：111/111 通过（Node 24.15.0）。
- VPS TypeScript 检查、脚本语法和 `git diff --check`：通过。

### 结论

第二批通过 Grill Me 复审。一个敏感信息脱敏缺口已由失败测试驱动修复；幂等重跑和索引完成边界均有直接行为证据。

## 第三批：systemd 切换、运维手册与完整验证

### 审查范围

- `scripts/install-learning-library-collector.sh`
- `scripts/install-learning-library-collector.test.mjs`
- `docs/tech-learning-digest.md`
- i18n 校验边界与完整验证矩阵
- OpenSpec 任务 4.1–5.2

### 质询与证据

1. **切换是否只是复制 unit，却没有停掉旧 timer？**
   - 结论：不是。`apply` 更新统一 service/timer，执行 daemon-reload，明确停用 GitHub Trending 与 AI Frontier timer，再启用统一 timer，并校验最终状态。

2. **重复执行会不会覆盖最初的回滚依据？**
   - 结论：不会。切换状态只在首次执行时创建；隔离测试比较两次 `apply` 后的状态文件完全一致。

3. **回滚能否恢复 unit 内容和三个 timer 的原启用状态？**
   - 结论：可以。首次切换备份原统一 service/timer，并记录统一、GitHub 和 AI 三个 timer 状态；测试在回滚后验证旧 unit 文本和三项状态全部恢复。

4. **脚本会不会为了“清理”删除历史笔记、运行记录或凭据？**
   - 结论：不会。脚本没有数据删除步骤；隔离测试在运行目录放置历史状态标记，apply、重复 apply 和 rollback 后内容均保持不变。

5. **切换状态放进采集器 StateDirectory 会不会改变目录所有权，导致服务无法写入？**
   - 初审风险：默认放入 `/var/lib/inkstone-tech-digest` 可能与 systemd `StateDirectory` 的所有权管理耦合。
   - 修复：切换状态和 unit 备份改存独立的 `/var/lib/inkstone-learning-library-cutover`，不接触采集器数据目录。

6. **中文内容生成脚本为什么导致 i18n 检查失败？是否通过禁用检查绕过？**
   - 结论：原检查把全部 `scripts/` 当成英文 UI 源码，旧的四个中文采集器本来就会失败。修复只对五个明确命名的中文内容生成/测试文件设例外；其余源码和脚本继续执行完整 i18n 校验，没有全局关闭检查。

7. **操作手册是否覆盖失败判断和恢复，而不只是启动命令？**
   - 结论：已补充阶段字段、候选/写入计数、脱敏错误、手动重试、统一切换、检查和回滚；说明成功日期只有在全部笔记和索引完成后更新。

8. **构建警告是否代表本次变更引入前端体积回归？**
   - 结论：Vite 仍报告既有大 chunk 提示，但本批没有修改前端模块或产物拆分；构建成功，该提示记录为非阻塞既有优化项，不在本变更扩大范围。

### 验证结果

- 学习流水线与切换测试：16/16 通过（Node 24.15.0）。
- Inkstone 单元测试：111/111 通过。
- VPS 专项测试：40/40 通过。
- 全量 TypeScript、VPS TypeScript、i18n、注释策略、shell 语法与 `git diff --check`：通过。
- `npm run build:vps`：成功。

### 结论

第三批通过 Grill Me 复审。systemd 切换具备首次快照、幂等应用、无损回滚和隔离测试；i18n 例外边界被限制在明确的中文内容生成文件。代码已满足提交与推送条件，生产切换仍需单独授权。
