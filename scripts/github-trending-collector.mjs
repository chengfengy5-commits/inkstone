#!/usr/bin/env node

import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const DEFAULT_BASE_URL = 'http://127.0.0.1:17712'
const DEFAULT_LANGUAGES = ['all', 'java', 'python', 'typescript']
const DEFAULT_TIME_ZONE = 'Asia/Shanghai'
const FEED_BASE_URL = 'https://cdn.jsdelivr.net/gh/Hyraze/trending-collection@main/api/daily'

const baseUrl = (process.env.INKSTONE_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '')
const hostHeader = process.env.INKSTONE_HOST_HEADER || ''
const timeZone = process.env.TRENDING_TIME_ZONE || DEFAULT_TIME_ZONE
const languages = parseLanguages(process.env.TRENDING_LANGUAGES)
const stateDirectory = process.env.STATE_DIRECTORY || '/var/lib/inkstone-github-trending'
const today = formatDate(new Date(), timeZone)
const pendingPath = join(stateDirectory, `pending-${today}.json`)
const successPath = join(stateDirectory, 'last-success-date')

async function main() {
  if ((await readOptional(successPath)).trim() === today) {
    console.log(`[github-trending] ${today} already collected; skipping`)
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

  if (result?.isError) {
    throw new Error(`Inkstone create_note failed: ${extractToolText(result)}`)
  }

  await atomicWrite(successPath, `${today}\n`)
  await rm(pendingPath, { force: true })
  console.log(`[github-trending] created "${pending.title}" from ${pending.repositoryCount} repositories`)
}

async function loadOrCreatePending() {
  const existing = await readOptional(pendingPath)
  if (existing) return JSON.parse(existing)

  const feeds = await Promise.all(languages.map(fetchFeed))
  const built = buildNote(feeds)
  const pending = {
    date: today,
    operationId: `github-trending-${today}`,
    title: `GitHub 热榜学习清单 · ${today}`,
    content: built.content,
    repositoryCount: built.repositoryCount,
  }
  await atomicWrite(pendingPath, `${JSON.stringify(pending)}\n`)
  return pending
}

async function fetchFeed(language) {
  const url = `${FEED_BASE_URL}/${encodeURIComponent(language)}.json`
  const response = await fetchWithTimeout(url, {
    headers: { 'user-agent': 'Inkstone-GitHub-Trending-Collector/1.0' },
  })
  if (!response.ok) throw new Error(`Trending feed ${language} returned HTTP ${response.status}`)
  const data = await response.json()
  const items = Array.isArray(data) ? data : data?.items
  if (!Array.isArray(items)) throw new Error(`Trending feed ${language} did not return an items array`)
  return { language, url, repositories: items.map(normalizeRepository) }
}

function buildNote(feeds) {
  const labels = {
    all: '综合趋势',
    java: 'Java',
    python: 'Python / AI',
    typescript: 'TypeScript / Web',
  }
  const limits = { all: 12, java: 8, python: 8, typescript: 8 }
  const lines = [
    `# GitHub 热榜学习清单 · ${today}`,
    '',
    `> 自动采集时间：${formatTimestamp(new Date(), timeZone)}（${timeZone}）`,
    '> 排序规则：优先按今日新增 Star，其次按总 Star。热榜适合发现新项目，不等于技术选型结论。',
    '',
    '## 今日优先关注',
    '',
  ]

  const allRepositories = feeds.flatMap((feed) => feed.repositories)
  const priority = uniqueByUrl(allRepositories)
    .sort(compareRepositories)
    .slice(0, 10)
  if (priority.length === 0) lines.push('- 今日数据源没有返回项目。')
  priority.forEach((repo, index) => lines.push(formatRepository(repo, index + 1)))

  for (const feed of feeds) {
    lines.push('', `## ${labels[feed.language] || feed.language}`, '')
    const repositories = uniqueByUrl(feed.repositories)
      .sort(compareRepositories)
      .slice(0, limits[feed.language] || 8)
    if (repositories.length === 0) lines.push('- 暂无数据。')
    repositories.forEach((repo, index) => lines.push(formatRepository(repo, index + 1)))
  }

  lines.push(
    '',
    '## 建议学习方法',
    '',
    '1. 先读 README 的“解决什么问题”和“快速开始”，判断是否与你的场景有关。',
    '2. 再看 Releases、Issues 和提交频率，确认项目是否仍在维护。',
    '3. 真正想采用的项目，应补看许可证、部署成本、安全边界和替代方案。',
    '4. 每天选 1–2 个项目写下“可借鉴点 / 不适用点 / 下一步实验”，避免只收藏不消化。',
    '',
    '## 数据来源',
    '',
    ...feeds.map((feed) => `- [${labels[feed.language] || feed.language}每日快照](${feed.url})`),
    '- 快照项目：[trending-collection](https://github.com/hanishrao/trending-collection)',
    '',
  )

  return { content: lines.join('\n'), repositoryCount: priority.length }
}

function normalizeRepository(repo) {
  return {
    name: cleanText(repo?.title || repo?.name || '未命名项目'),
    url: safeHttpUrl(repo?.url),
    description: cleanText(repo?.description || '暂无简介'),
    language: cleanText(repo?.language || '未标注'),
    stars: parseCount(repo?.stars),
    forks: parseCount(repo?.forks),
    addedStars: parseCount(repo?.added_stars ?? repo?.todayStars),
  }
}

function formatRepository(repo, index) {
  const name = escapeMarkdown(repo.name)
  const description = escapeMarkdown(repo.description)
  const link = repo.url ? `[${name}](${repo.url})` : name
  return `${index}. ${link} — ${description}  \n   \`${repo.language}\` · ⭐ ${formatCount(repo.stars)} · 今日 +${formatCount(repo.addedStars)} · Fork ${formatCount(repo.forks)}`
}

function compareRepositories(left, right) {
  return right.addedStars - left.addedStars || right.stars - left.stars
}

function uniqueByUrl(repositories) {
  const seen = new Set()
  return repositories.filter((repo) => {
    const key = repo.url || repo.name.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function parseLanguages(raw) {
  if (!raw) return DEFAULT_LANGUAGES
  const values = raw.split(',').map((value) => value.trim().toLowerCase()).filter(Boolean)
  return values.length ? [...new Set(values)] : DEFAULT_LANGUAGES
}

function parseCount(value) {
  const parsed = Number(String(value ?? 0).replace(/[^0-9.-]/g, ''))
  return Number.isFinite(parsed) ? parsed : 0
}

function formatCount(value) {
  return Math.max(0, value).toLocaleString('en-US')
}

function cleanText(value) {
  return String(value).replace(/\s+/g, ' ').trim()
}

function escapeMarkdown(value) {
  return cleanText(value).replace(/([\\`*_[\]()])/g, '\\$1')
}

function safeHttpUrl(value) {
  try {
    const url = new URL(String(value))
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : ''
  } catch {
    return ''
  }
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
      clientInfo: { name: 'inkstone-github-trending-collector', version: '1.0.0' },
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
    if (hostHeader) headers.host = hostHeader
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
