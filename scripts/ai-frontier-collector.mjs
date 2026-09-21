#!/usr/bin/env node

import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const DEFAULT_BASE_URL = 'https://inkstone.ai-dark.top'
const DEFAULT_TIME_ZONE = 'Asia/Shanghai'
const HF_PAPERS_URL = process.env.HF_PAPERS_URL || 'https://hf-mirror.com/api/daily_papers?limit=40'
const GITHUB_API = 'https://api.github.com'
const USER_AGENT = 'Inkstone-AI-Frontier-Collector/1.0'
const SEARCH_TOPICS = [
  ['AI Agent / Coding Agent', 'ai-agents', 50, 180],
  ['MCP / Tool Use', 'model-context-protocol', 20, 180],
  ['RAG / Agent Memory', 'rag', 50, 180],
  ['多模态', 'multimodal', 50, 240],
  ['推理与模型服务', 'llm-inference', 100, 365],
  ['World Model / Embodied AI', 'world-model', 30, 365],
]
const RELEASE_WATCHLIST = [
  'openai/codex',
  'modelcontextprotocol/typescript-sdk',
  'modelcontextprotocol/python-sdk',
  'huggingface/transformers',
  'vllm-project/vllm',
  'ollama/ollama',
  'langgenius/dify',
  'langchain-ai/langchain',
  'run-llama/llama_index',
  'microsoft/autogen',
  'microsoft/semantic-kernel',
]

const baseUrl = (process.env.INKSTONE_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '')
const timeZone = process.env.AI_FRONTIER_TIME_ZONE || DEFAULT_TIME_ZONE
const stateDirectory = process.env.STATE_DIRECTORY || '/var/lib/inkstone-ai-frontier'
const today = formatDate(new Date(), timeZone)
const pendingPath = join(stateDirectory, `pending-${today}.json`)
const successPath = join(stateDirectory, 'last-success-date')

async function main() {
  if ((await readOptional(successPath)).trim() === today) {
    console.log(`[ai-frontier] ${today} already collected; skipping`)
    return
  }

  const pending = await loadOrCreatePending()
  const token = await readToken()
  const client = new McpClient(`${baseUrl}/mcp`, token)
  await client.initialize()

  const result = await client.callTool('create_note', {
    operation_id: pending.operationId,
    title: pending.title,
    content: pending.content,
  })
  if (result?.isError) throw new Error(`Inkstone create_note failed: ${extractToolText(result)}`)

  await atomicWrite(successPath, `${today}\n`)
  await rm(pendingPath, { force: true })
  console.log(
    `[ai-frontier] created "${pending.title}" with ${pending.paperCount} papers, `
    + `${pending.repositoryCount} GitHub projects and ${pending.releaseCount} releases`,
  )
}

async function loadOrCreatePending() {
  const existing = await readOptional(pendingPath)
  if (existing) return JSON.parse(existing)

  const warnings = []
  const papers = await collectOrWarn('Hugging Face Daily Papers', fetchPapers, warnings, [])
  const repositories = await collectOrWarn('GitHub repository search', fetchRepositories, warnings, [])
  const releases = await collectOrWarn('GitHub releases', fetchReleases, warnings, [])

  if (papers.length === 0 && repositories.length === 0 && releases.length === 0) {
    throw new Error(`All AI frontier sources failed: ${warnings.join('; ')}`)
  }

  const content = buildNote({ papers, repositories, releases, warnings })
  const pending = {
    date: today,
    operationId: `ai-frontier-${today}`,
    title: `AI 前沿雷达 · ${today}`,
    content,
    paperCount: papers.length,
    repositoryCount: repositories.length,
    releaseCount: releases.length,
  }
  await atomicWrite(pendingPath, `${JSON.stringify(pending)}\n`)
  return pending
}

async function collectOrWarn(name, callback, warnings, fallback) {
  try {
    return await callback()
  } catch (error) {
    warnings.push(`${name}: ${error instanceof Error ? error.message : String(error)}`)
    return fallback
  }
}

async function fetchPapers() {
  const data = await fetchJson(HF_PAPERS_URL)
  if (!Array.isArray(data)) throw new Error('response is not an array')
  return data
    .map((entry) => normalizePaper(entry.paper || entry))
    .filter((paper) => paper.id && paper.title)
    .sort((left, right) => right.upvotes - left.upvotes || right.publishedAt.localeCompare(left.publishedAt))
    .slice(0, 12)
}

async function fetchRepositories() {
  const createdAfterByDays = new Map()
  const repositories = new Map()
  const failures = []

  for (const [category, topic, minimumStars, maximumAgeDays] of SEARCH_TOPICS) {
    if (!createdAfterByDays.has(maximumAgeDays)) {
      createdAfterByDays.set(maximumAgeDays, dateDaysAgo(maximumAgeDays))
    }
    const query = [
      `topic:${topic}`,
      `created:>=${createdAfterByDays.get(maximumAgeDays)}`,
      `pushed:>=${dateDaysAgo(45)}`,
      `stars:>=${minimumStars}`,
      'archived:false',
      'fork:false',
    ].join(' ')
    const url = new URL(`${GITHUB_API}/search/repositories`)
    url.searchParams.set('q', query)
    url.searchParams.set('sort', 'stars')
    url.searchParams.set('order', 'desc')
    url.searchParams.set('per_page', '10')
    try {
      const data = await fetchJson(url.toString(), githubHeaders())
      if (!Array.isArray(data?.items)) throw new Error('response has no items array')
      for (const item of data.items) {
        const normalized = normalizeRepository(item)
        const existing = repositories.get(normalized.fullName)
        if (existing) existing.categories.add(category)
        else repositories.set(normalized.fullName, { ...normalized, categories: new Set([category]) })
      }
    } catch (error) {
      failures.push(`${topic}: ${error instanceof Error ? error.message : String(error)}`)
    }
    await delay(700)
  }

  if (repositories.size === 0 && failures.length) {
    throw new Error(failures.join('; '))
  }

  return [...repositories.values()]
    .map((repo) => ({ ...repo, categories: [...repo.categories] }))
    .sort((left, right) => right.momentum - left.momentum || right.stars - left.stars)
    .slice(0, 18)
}

async function fetchReleases() {
  const results = await Promise.all(RELEASE_WATCHLIST.map(async (repository) => {
    const url = `${GITHUB_API}/repos/${repository}/releases/latest`
    try {
      const data = await fetchJson(url, githubHeaders(), { allowNotFound: true })
      if (!data) return null
      return normalizeRelease(repository, data)
    } catch (error) {
      return { repository, error: error instanceof Error ? error.message : String(error) }
    }
  }))
  const failures = results.filter((entry) => entry?.error)
  if (failures.length === results.length) throw new Error('all watched release endpoints failed')
  return results
    .filter((entry) => entry && !entry.error)
    .sort((left, right) => right.publishedAt.localeCompare(left.publishedAt))
    .slice(0, 12)
}

function buildNote({ papers, repositories, releases, warnings }) {
  const lines = [
    `# AI 前沿雷达 · ${today}`,
    '',
    `> 自动采集时间：${formatTimestamp(new Date(), timeZone)}（${timeZone}）`,
    '> 关注 Agent、MCP、RAG/记忆、多模态、推理基础设施、World Model 与具身智能。',
    '> “前沿”依据近期创建、持续活跃、增长速度、论文社区热度与核心项目发布综合筛选，不代表投资或生产选型建议。',
    '',
  ]

  if (warnings.length) {
    lines.push('## 数据源提示', '', ...warnings.map((warning) => `- ${escapeMarkdown(warning)}`), '')
  }

  lines.push('## GitHub 新锐 AI 项目', '')
  if (repositories.length === 0) lines.push('- 本次未取得符合条件的 GitHub 项目。')
  repositories.forEach((repo, index) => {
    lines.push(
      `${index + 1}. [${escapeMarkdown(repo.fullName)}](${repo.url}) — ${escapeMarkdown(repo.description || '暂无简介')}  `,
      `   ${repo.categories.map((category) => `\`${category}\``).join(' ')} · ${repo.language ? `\`${escapeMarkdown(repo.language)}\` · ` : ''}`
      + `⭐ ${formatCount(repo.stars)} · Fork ${formatCount(repo.forks)} · 估算 ${repo.momentum.toFixed(1)} Star/天 · 最近推送 ${formatShortDate(repo.pushedAt)}`,
    )
  })

  lines.push('', '## Hugging Face 每日论文', '')
  if (papers.length === 0) lines.push('- 本次未取得论文数据。')
  papers.forEach((paper, index) => {
    const authors = paper.authors.slice(0, 4).join('、')
    lines.push(
      `${index + 1}. [${escapeMarkdown(paper.title)}](https://huggingface.co/papers/${encodeURIComponent(paper.id)})  `,
      `   ${escapeMarkdown(truncate(paper.summary, 360))}  `,
      `   arXiv: [${paper.id}](https://arxiv.org/abs/${encodeURIComponent(paper.id)}) · 👍 ${paper.upvotes}`
      + `${authors ? ` · ${escapeMarkdown(authors)}` : ''}`,
    )
  })

  lines.push('', '## 核心 AI 开源项目最新 Release', '')
  if (releases.length === 0) lines.push('- 本次未取得 Release 数据。')
  releases.forEach((release, index) => {
    lines.push(
      `${index + 1}. [${escapeMarkdown(release.repository)} ${escapeMarkdown(release.tag)}](${release.url}) — ${escapeMarkdown(release.name || release.tag)}  `,
      `   发布于 ${formatShortDate(release.publishedAt)}${release.summary ? ` · ${escapeMarkdown(truncate(release.summary, 280))}` : ''}`,
    )
  })

  lines.push(
    '',
    '## 建议怎么学',
    '',
    '1. GitHub 新项目先判断它解决的是“模型能力”还是“工程编排”问题，再看 Demo、评测、许可证和最近 Issues。',
    '2. 论文先读摘要、方法图和实验结论；只有与当前项目相关时再精读公式和附录。',
    '3. Release 优先关注 Breaking Changes、性能、部署方式和安全修复，不要只看版本号。',
    '4. 每周选一个方向做最小实验，并在 Inkstone 追加“可复用点 / 风险 / 是否继续”的结论。',
    '',
    '## 数据来源与筛选说明',
    '',
    '- [GitHub Search API](https://docs.github.com/en/rest/search/search#search-repositories)：筛选近期创建且最近仍活跃的 AI 主题仓库。',
    '- [GitHub Releases API](https://docs.github.com/en/rest/releases/releases#get-the-latest-release)：跟踪核心 AI 工程项目正式版本。',
    '- [Hugging Face Daily Papers](https://huggingface.co/papers)：论文数据通过国内可达镜像读取，笔记链接指向官方论文页和 arXiv。',
    '',
  )
  return lines.join('\n')
}

function normalizePaper(paper) {
  return {
    id: cleanText(paper?.id || ''),
    title: cleanText(paper?.title || ''),
    summary: cleanText(paper?.summary || ''),
    upvotes: numberValue(paper?.upvotes),
    publishedAt: cleanText(paper?.publishedAt || ''),
    authors: Array.isArray(paper?.authors)
      ? paper.authors.map((author) => cleanText(author?.name || author?.user?.fullname || '')).filter(Boolean)
      : [],
  }
}

function normalizeRepository(item) {
  const createdAt = cleanText(item?.created_at || '')
  const ageDays = Math.max(7, (Date.now() - Date.parse(createdAt)) / 86_400_000)
  const stars = numberValue(item?.stargazers_count)
  return {
    fullName: cleanText(item?.full_name || ''),
    url: safeHttpUrl(item?.html_url),
    description: cleanText(item?.description || ''),
    language: cleanText(item?.language || ''),
    stars,
    forks: numberValue(item?.forks_count),
    createdAt,
    pushedAt: cleanText(item?.pushed_at || ''),
    momentum: stars / ageDays,
  }
}

function normalizeRelease(repository, release) {
  return {
    repository,
    tag: cleanText(release?.tag_name || ''),
    name: cleanText(release?.name || ''),
    url: safeHttpUrl(release?.html_url),
    publishedAt: cleanText(release?.published_at || release?.created_at || ''),
    summary: cleanText(release?.body || ''),
  }
}

function githubHeaders() {
  return {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': USER_AGENT,
  }
}

async function fetchJson(url, headers = {}, options = {}) {
  const response = await fetchWithTimeout(url, { headers: { 'user-agent': USER_AGENT, ...headers } })
  if (options.allowNotFound && response.status === 404) return null
  if (!response.ok) {
    const remaining = response.headers.get('x-ratelimit-remaining')
    throw new Error(`HTTP ${response.status}${remaining !== null ? ` (rate remaining ${remaining})` : ''}`)
  }
  return response.json()
}

function dateDaysAgo(days) {
  return formatDate(new Date(Date.now() - days * 86_400_000), 'UTC')
}

function formatDate(date, zone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  return `${values.year}-${values.month}-${values.day}`
}

function formatTimestamp(date, zone) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

function formatShortDate(value) {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? formatDate(new Date(parsed), timeZone) : '未知'
}

function formatCount(value) {
  return Math.max(0, value).toLocaleString('en-US')
}

function numberValue(value) {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function cleanText(value) {
  return String(value).replace(/\s+/g, ' ').trim()
}

function escapeMarkdown(value) {
  return cleanText(value).replace(/([\\`*_[\]()])/g, '\\$1')
}

function truncate(value, maximum) {
  const text = cleanText(value)
  return text.length > maximum ? `${text.slice(0, maximum - 1)}…` : text
}

function safeHttpUrl(value) {
  try {
    const url = new URL(String(value))
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : ''
  } catch {
    return ''
  }
}

async function readToken() {
  const credentialDirectory = process.env.CREDENTIALS_DIRECTORY
  const credentialPath = credentialDirectory ? join(credentialDirectory, 'mcp-token') : ''
  const token = process.env.INKSTONE_MCP_TOKEN || (credentialPath ? await readOptional(credentialPath) : '')
  if (!token.trim()) throw new Error('Inkstone MCP token is not configured')
  return token.trim()
}

async function readOptional(path) {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return ''
    throw error
  }
}

async function atomicWrite(path, content) {
  const temporaryPath = `${path}.${process.pid}.tmp`
  await writeFile(temporaryPath, content, { mode: 0o600 })
  await rename(temporaryPath, path)
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 20_000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

class McpClient {
  constructor(url, token) {
    this.url = url
    this.token = token
    this.sessionId = ''
    this.requestId = 0
  }

  async initialize() {
    await this.request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'inkstone-ai-frontier-collector', version: '1.0.0' },
    })
    await this.notify('notifications/initialized', {})
  }

  async callTool(name, args) {
    return this.request('tools/call', { name, arguments: args })
  }

  async request(method, params) {
    const id = ++this.requestId
    const response = await this.post({ jsonrpc: '2.0', id, method, params })
    const message = await parseMcpResponse(response, id)
    if (message?.error) throw new Error(`MCP ${method} failed: ${message.error.message || JSON.stringify(message.error)}`)
    return message?.result
  }

  async notify(method, params) {
    const response = await this.post({ jsonrpc: '2.0', method, params })
    if (!response.ok) throw new Error(`MCP ${method} notification returned HTTP ${response.status}`)
  }

  async post(body) {
    const headers = {
      authorization: `Bearer ${this.token}`,
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
    }
    if (this.sessionId) headers['mcp-session-id'] = this.sessionId
    const response = await fetchWithTimeout(this.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })
    const returnedSessionId = response.headers.get('mcp-session-id')
    if (returnedSessionId) this.sessionId = returnedSessionId
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500)
      throw new Error(`MCP HTTP ${response.status}: ${detail}`)
    }
    return response
  }
}

async function parseMcpResponse(response, expectedId) {
  const body = await response.text()
  if (!body.trim()) return null
  if ((response.headers.get('content-type') || '').includes('text/event-stream')) {
    const messages = body
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .filter(Boolean)
      .map((data) => JSON.parse(data))
    return messages.find((message) => message.id === expectedId) || messages.at(-1)
  }
  return JSON.parse(body)
}

function extractToolText(result) {
  return (result?.content || [])
    .filter((item) => item?.type === 'text')
    .map((item) => item.text)
    .join(' ')
    .slice(0, 500)
}

await main()
