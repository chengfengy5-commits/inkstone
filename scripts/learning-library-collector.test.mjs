import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  contentKeyForCandidate,
  createRunRecorder,
  normalizeContentUrl,
  parseArchiveTree,
  parseGitTree,
  parseRssItems,
  prepareCandidatePool,
  renderIndex,
  renderLearningNote,
  rssCandidate,
  selectKeyPaths,
  validateSingleReport,
  validateSelection,
  writePendingToInkstone,
} from './learning-library-collector.mjs'

test('parses RSS CDATA, source links, discussion links, and categories', () => {
  const [item] = parseRssItems(`<?xml version="1.0"?>
    <rss><channel><item>
      <title><![CDATA[Useful JVM article]]></title>
      <link>https://example.com/article</link>
      <comments>https://example.com/discussion</comments>
      <guid>post-42</guid>
      <pubDate>Mon, 21 Sep 2026 08:00:00 GMT</pubDate>
      <category><![CDATA[java]]></category>
      <description><![CDATA[<p>Points: 51</p><p># Comments: 8</p>]]></description>
    </item></channel></rss>`)

  assert.equal(item.title, 'Useful JVM article')
  assert.equal(item.link, 'https://example.com/article')
  assert.equal(item.comments, 'https://example.com/discussion')
  assert.deepEqual(item.categories, ['java'])

  const candidate = rssCandidate({
    source: '测试社区',
    sourceKind: 'community',
    area: '开源与工程',
    weight: 1_000,
    provider: 'rss',
  }, item)
  assert.equal(candidate.sourceKind, 'community')
  assert.equal(candidate.url, 'https://example.com/discussion')
  assert.equal(candidate.originalUrl, 'https://example.com/article')
  assert.equal(candidate.engagement, 67)
  assert.equal(candidate.area, '后端与虚拟机')
})

test('parses Atom entry links and content', () => {
  const [item] = parseRssItems(`<?xml version="1.0"?>
    <feed xmlns="http://www.w3.org/2005/Atom"><entry>
      <title>Agent runtime design</title>
      <link rel="alternate" href="https://example.com/agent-runtime" />
      <id>tag:example.com,2026:agent-runtime</id>
      <updated>2026-09-21T08:00:00Z</updated>
      <content type="html"><![CDATA[<p>An MCP agent runtime.</p>]]></content>
    </entry></feed>`)

  assert.equal(item.link, 'https://example.com/agent-runtime')
  assert.equal(item.guid, 'tag:example.com,2026:agent-runtime')
  assert.match(item.content, /MCP agent runtime/)
})

test('selects build metadata and representative nested source files from a shallow Git tree', () => {
  const tree = parseGitTree([
    '100644 blob aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 1200\tpom.xml',
    '100644 blob bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb 4200\tdubbo-common/src/main/java/org/apache/dubbo/common/Version.java',
    '100644 blob cccccccccccccccccccccccccccccccccccccccc 5200\tquiche/src/lib.rs',
    '100644 blob dddddddddddddddddddddddddddddddddddddddd 900\tskills/security-audit/SKILL.md',
    '100644 blob eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee 800\texamples/demo/src/main/java/Demo.java',
  ].join('\n'))

  assert.deepEqual(selectKeyPaths(tree), [
    'pom.xml',
    'quiche/src/lib.rs',
    'dubbo-common/src/main/java/org/apache/dubbo/common/Version.java',
    'skills/security-audit/SKILL.md',
  ])
})

test('normalizes GitHub source archive paths without extracting the archive', () => {
  const result = parseArchiveTree([
    'quiche-main/',
    'quiche-main/README.md',
    'quiche-main/Cargo.toml',
    'quiche-main/quiche/src/lib.rs',
    'quiche-main/src/',
  ].join('\n'))

  assert.equal(result.prefix, 'quiche-main/')
  assert.deepEqual(result.tree.map((entry) => entry.path), ['README.md', 'Cargo.toml', 'quiche/src/lib.rs'])
})

test('normalizes content URLs without erasing meaningful query parameters', () => {
  assert.equal(
    normalizeContentUrl('HTTPS://Example.COM:443/posts/agent/?utm_source=rss&lang=zh#comments'),
    'https://example.com/posts/agent?lang=zh',
  )
  assert.equal(
    normalizeContentUrl('https://example.com/search?q=java&utm_medium=email&ref=sidebar'),
    'https://example.com/search?q=java',
  )
})

test('uses one content key for a GitHub repository across trending, search, and release entries', () => {
  const trending = {
    id: 'repo:openai/codex',
    sourceKind: 'github',
    repository: 'OpenAI/Codex',
    url: 'https://github.com/OpenAI/Codex',
  }
  const release = {
    id: 'release:openai/codex:v1.2.3',
    sourceKind: 'github',
    repository: 'openai/codex',
    url: 'https://github.com/openai/codex/releases/tag/v1.2.3',
  }

  assert.equal(contentKeyForCandidate(trending), 'github:openai/codex')
  assert.equal(contentKeyForCandidate(release), 'github:openai/codex')
})

test('deduplicates cross-source candidates by content and preserves the highest-scoring evidence', () => {
  const collected = [
    candidate({ id: 'repo:openai/codex', repository: 'OpenAI/Codex', score: 500, source: 'GitHub Trending' }),
    candidate({ id: 'release:openai/codex:v1', repository: 'openai/codex', url: 'https://github.com/openai/codex/releases/tag/v1', score: 900, source: 'GitHub Releases' }),
    candidate({ id: 'rss:article:a', sourceKind: 'article', url: 'https://example.com/deep-dive/?utm_source=rss', score: 300 }),
    candidate({ id: 'rss:article:b', sourceKind: 'article', url: 'https://EXAMPLE.com:443/deep-dive#intro', score: 700 }),
  ]

  const { candidates, stats } = prepareCandidatePool(collected, {})

  assert.deepEqual(candidates.map((item) => item.id), ['release:openai/codex:v1', 'rss:article:b'])
  assert.equal(candidates[0].contentKey, 'github:openai/codex')
  assert.equal(candidates[1].contentKey, 'url:https://example.com/deep-dive')
  assert.deepEqual(stats, {
    collected: 4,
    eligible: 4,
    deduplicated: 2,
    filteredSeen: 0,
    filteredSuspicious: 0,
    bySource: { github: 1, article: 1, community: 0 },
  })
})

test('filters both new content keys and legacy source ids from the seen window', () => {
  const repository = candidate({ id: 'release:openai/codex:v2', repository: 'openai/codex', score: 900 })
  const legacyArticle = candidate({ id: 'rss:article:legacy', sourceKind: 'article', url: 'https://example.com/legacy', score: 400 })
  const seen = {
    'github:openai/codex': '2026-09-21',
    'rss:article:legacy': '2026-09-20',
  }

  const { candidates, stats } = prepareCandidatePool([repository, legacyArticle], seen)

  assert.deepEqual(candidates, [])
  assert.equal(stats.filteredSeen, 2)
})

test('maps legacy GitHub repo and release ids across source types', () => {
  const release = candidate({
    id: 'release:openai/codex:v2',
    repository: 'openai/codex',
    url: 'https://github.com/openai/codex/releases/tag/v2',
  })
  const repository = candidate({ id: 'repo:apache/kafka', repository: 'apache/kafka' })
  const seen = {
    'repo:openai/codex': '2026-09-20',
    'release:apache/kafka:4.1.0': '2026-09-21',
  }

  const { candidates, stats } = prepareCandidatePool([release, repository], seen)

  assert.deepEqual(candidates, [])
  assert.equal(stats.filteredSeen, 2)
})

test('rejects an eight-item selection that repeats the same content through different ids', () => {
  const candidates = [
    candidate({ id: 'repo:openai/codex', repository: 'openai/codex', area: '人工智能' }),
    candidate({ id: 'release:openai/codex:v1', repository: 'OpenAI/Codex', url: 'https://github.com/openai/codex/releases/tag/v1', area: '人工智能' }),
    candidate({ id: 'repo:apache/kafka', repository: 'apache/kafka', area: '后端与虚拟机' }),
    candidate({ id: 'repo:spring-projects/spring-boot', repository: 'spring-projects/spring-boot', area: '后端与虚拟机' }),
    candidate({ id: 'article:one', sourceKind: 'article', url: 'https://example.com/article-one', area: '人工智能' }),
    candidate({ id: 'article:two', sourceKind: 'article', url: 'https://example.com/article-two', area: '开源与工程' }),
    candidate({ id: 'community:one', sourceKind: 'community', url: 'https://news.example.com/one', area: '开源与工程' }),
    candidate({ id: 'community:two', sourceKind: 'community', url: 'https://news.example.com/two', area: '开源与工程' }),
  ]
  const selection = { items: candidates.map(({ id }) => ({ id, learningAngle: '验证工程设计' })) }

  assert.throws(() => validateSelection(selection, candidates), /duplicated content github:openai\/codex/)
})

test('renders a standalone Chinese learning note with source metadata and evidence-backed code paths', () => {
  const source = candidate({
    id: 'repo:openai/codex',
    repository: 'openai/codex',
    title: 'openai/codex',
    url: 'https://github.com/openai/codex',
    source: 'GitHub Trending',
    metrics: '星标 1,000',
    evidence: { repository: 'openai/codex', files: [{ path: 'src/main.ts', content: 'main' }] },
  })
  const markdown = renderLearningNote(reportFixture(), source)

  assert.match(markdown, /^---\n日期: "\d{4}-\d{2}-\d{2}"/)
  assert.match(markdown, /来源类型: "开源项目"/)
  assert.match(markdown, /原始链接: "https:\/\/github\.com\/openai\/codex"/)
  assert.match(markdown, /标签: \["来源\/开源仓库", "难度\/进阶", "学习状态\/待实践", "方向\/架构设计"\]/)
  for (const heading of ['为什么值得学习', '哪些方面做得好', '核心知识点', '关键代码导读', '可迁移到实际项目的经验', '动手练习', '风险、限制与待验证点']) {
    assert.match(markdown, new RegExp(`## ${heading}`))
  }
  assert.match(markdown, /`src\/main\.ts`/)
})

test('removes model-invented code paths before rendering a repository report', () => {
  const report = reportFixture()
  report.codeReading.push({ path: 'src/invented.ts', insight: '这条路径不存在。' })
  const selected = new Map([[
    report.id,
    candidate({ evidence: { files: [{ path: 'src/main.ts', content: 'main' }] } }),
  ]])

  validateSingleReport(report, selected)

  assert.deepEqual(report.codeReading, [{ path: 'src/main.ts', insight: '观察依赖如何装配。' }])
})

test('renders a compact daily index that links every standalone note', () => {
  const items = [
    createdItem('github', '仓库报告', 'https://inkstone.example/notes/repo'),
    createdItem('article', '文章报告', 'https://inkstone.example/notes/article'),
    createdItem('community', '讨论报告', 'https://inkstone.example/notes/community'),
  ]
  const markdown = renderIndex({
    headline: '今日重点',
    overview: '三类材料分别形成独立学习笔记。',
    closing: '先读文章，再看代码。',
    warnings: ['RSS Feeds: one source timed out'],
  }, items)

  for (const item of items) assert.match(markdown, new RegExp(item.note.url.replaceAll('/', '\\/')))
  assert.match(markdown, /本页只做导航/)
  assert.match(markdown, /## 采集提示/)
  assert.doesNotMatch(markdown, /## 背景与问题/)
})

test('persists run stages and redacts credentials while preserving retry context', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'inkstone-learning-run-'))
  const path = join(directory, 'run.json')
  const timestamps = [
    '2026-09-22T01:00:00.000Z',
    '2026-09-22T01:01:00.000Z',
    '2026-09-22T01:02:00.000Z',
    '2026-09-22T01:03:00.000Z',
  ]
  const now = () => timestamps.shift() || '2026-09-22T01:04:00.000Z'
  try {
    const first = await createRunRecorder(path, '2026-09-22', { now })
    await first.update('selecting', {
      counts: { collected: 42, deduplicated: 17 },
      warnings: ['RSS Feeds: one source timed out'],
    })
    await first.fail(new Error('Authorization: Bearer super-secret ink_private_key https://api.example.test?q=ok&api_key=query-secret token=plain-secret'))

    const failed = JSON.parse(await readFile(path, 'utf8'))
    assert.equal(failed.attempt, 1)
    assert.equal(failed.stage, 'selecting')
    assert.equal(failed.result, 'failed')
    assert.equal(failed.counts.collected, 42)
    assert.deepEqual(failed.warnings, ['RSS Feeds: one source timed out'])
    assert.doesNotMatch(failed.error, /super-secret|ink_private_key|query-secret|plain-secret/)
    assert.match(failed.error, /\[REDACTED\]/)

    const retry = await createRunRecorder(path, '2026-09-22', { now })
    assert.equal(retry.state.attempt, 2)
    assert.deepEqual(retry.state.lastFailure, {
      stage: 'selecting',
      error: failed.error,
      at: failed.finishedAt,
    })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('reuses stable MCP operation ids after a partial write failure', async () => {
  const client = new IdempotentFakeMcpClient({ failOnceAtCall: 2 })
  const progress = []
  const pending = {
    date: '2026-09-22',
    headline: '今日重点',
    overview: '两篇固定夹具。',
    closing: '依次阅读。',
    warnings: [],
    items: [
      pendingItem('github', '仓库笔记'),
      pendingItem('article', '文章笔记'),
    ],
  }
  const folders = {
    index: { id: 'folder-index' },
    github: { id: 'folder-github' },
    article: { id: 'folder-article' },
    community: { id: 'folder-community' },
  }

  await assert.rejects(
    writePendingToInkstone(pending, client, folders, {
      date: pending.date,
      onProgress: async (event) => progress.push(event),
    }),
    /injected MCP failure/,
  )
  assert.deepEqual([...client.notesByOperation.keys()], ['learning-library-note-2026-09-22-01'])

  const result = await writePendingToInkstone(pending, client, folders, {
    date: pending.date,
    onProgress: async (event) => progress.push(event),
  })

  assert.equal(result.created.length, 2)
  assert.equal(client.notesByOperation.size, 3)
  assert.deepEqual([...client.notesByOperation.keys()], [
    'learning-library-note-2026-09-22-01',
    'learning-library-note-2026-09-22-02',
    'learning-library-index-2026-09-22',
  ])
  assert.deepEqual(progress.at(-1), {
    stage: 'writing-index',
    writtenNotes: 2,
    writtenIndex: 1,
  })
})

function candidate(overrides = {}) {
  const sourceKind = overrides.sourceKind || 'github'
  return {
    id: 'repo:example/project',
    sourceKind,
    area: '开源与工程',
    repository: sourceKind === 'github' ? 'example/project' : undefined,
    title: 'example/project',
    url: sourceKind === 'github' ? 'https://github.com/example/project' : 'https://example.com/post',
    source: 'fixture',
    score: 100,
    ...overrides,
  }
}

function reportFixture() {
  return {
    id: 'repo:openai/codex',
    title: 'Codex 的运行时分层',
    category: '开源与工程',
    level: '进阶',
    tags: ['架构设计'],
    oneLine: '通过真实代码理解运行时边界。',
    whyLearn: '它展示了可迁移到工程项目的清晰分层。',
    whatGood: ['边界清晰', '证据充分', '便于测试'],
    background: '复杂工具需要隔离协议与执行层。',
    corePoints: [{ name: '边界', explanation: '接口隔离变化。' }],
    architecture: '入口只负责组装，核心逻辑保持独立。',
    codeReading: [{ path: 'src/main.ts', insight: '观察依赖如何装配。' }],
    transferable: ['为外部系统保留适配层'],
    practice: ['替换一个适配器并运行测试'],
    limitations: ['示例未覆盖分布式部署'],
    questions: ['如何在多节点下保持幂等？'],
  }
}

function createdItem(sourceKind, title, url) {
  return {
    sourceKind,
    title,
    whyLearn: '能够迁移到实际工程。',
    whatGood: ['结构清晰', '验证充分'],
    tags: ['方向/架构设计'],
    note: { url },
  }
}

function pendingItem(sourceKind, title) {
  return {
    id: `${sourceKind}:${title}`,
    sourceKind,
    title,
    whyLearn: '值得深入学习。',
    whatGood: ['结构清晰', '验证充分'],
    tags: ['方向/架构设计'],
    content: `# ${title}`,
  }
}

class IdempotentFakeMcpClient {
  constructor({ failOnceAtCall }) {
    this.failOnceAtCall = failOnceAtCall
    this.callCount = 0
    this.failed = false
    this.notesByOperation = new Map()
  }

  async callTool(name, args) {
    this.callCount += 1
    if (!this.failed && this.callCount === this.failOnceAtCall) {
      this.failed = true
      throw new Error('injected MCP failure')
    }
    if (name !== 'create_note') throw new Error(`unexpected tool ${name}`)
    if (!this.notesByOperation.has(args.operation_id)) {
      const number = this.notesByOperation.size + 1
      this.notesByOperation.set(args.operation_id, {
        id: `note-${number}`,
        url: `https://inkstone.example/notes/${number}`,
      })
    }
    return { structuredContent: { data: { note: this.notesByOperation.get(args.operation_id) } } }
  }
}
