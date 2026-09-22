import { parseFrontMatter } from '@shared/markdown-utils'
import type { LearningWorkbenchItem } from './learning-workbench'

export const REVIEW_DATE_KEY = String.fromCodePoint(0x590d, 0x4e60, 0x65e5, 0x671f)
export const LAST_STUDIED_KEY = String.fromCodePoint(0x4e0a, 0x6b21, 0x5b66, 0x4e60)

export type ReviewDueKind = 'overdue' | 'today' | 'upcoming' | 'unscheduled' | 'invalid'

export interface LearningReviewMetadata {
  reviewDate: string | null
  lastStudied: string | null
  invalidReviewDate: boolean
}

export interface LearningReviewItem {
  item: LearningWorkbenchItem
  metadata: LearningReviewMetadata
  due: ReviewDueKind
}

export type LearningReviewQueue = Record<ReviewDueKind, LearningReviewItem[]>

export function parseLearningReviewMetadata(content: string): LearningReviewMetadata {
  const frontMatter = parseFrontMatter(content)
  const rawReviewDate = frontMatter.data[REVIEW_DATE_KEY]
  const rawLastStudied = frontMatter.data[LAST_STUDIED_KEY]
  const reviewDate = validLocalDate(rawReviewDate)
  const reviewDateDeclared = frontMatter.raw.split('\n').some((line) => line.startsWith(`${REVIEW_DATE_KEY}:`))
    || (frontMatter.lineOffset === 0 && startsWithFrontMatter(content)
      && content.slice(0, 64 * 1024).split(/\r?\n/).some((line) => line.startsWith(`${REVIEW_DATE_KEY}:`)))
  return {
    reviewDate,
    lastStudied: validLocalDate(rawLastStudied),
    invalidReviewDate: reviewDateDeclared && reviewDate === null,
  }
}

export function updateLearningReviewMetadata(
  content: string,
  patch: { reviewDate?: string; lastStudied?: string },
): string {
  const entries = Object.entries({
    ...(patch.reviewDate !== undefined ? { [REVIEW_DATE_KEY]: requireLocalDate(patch.reviewDate) } : {}),
    ...(patch.lastStudied !== undefined ? { [LAST_STUDIED_KEY]: requireLocalDate(patch.lastStudied) } : {}),
  })
  if (entries.length === 0) return content

  const frontMatter = parseFrontMatter(content)
  if (frontMatter.lineOffset > 0 && frontMatter.errors.length > 0) throw new Error('Invalid Front Matter')
  if (frontMatter.lineOffset === 0 && startsWithFrontMatter(content)) throw new Error('Invalid Front Matter')
  const newline = content.includes('\r\n') ? '\r\n' : '\n'
  const lines = content.split(/\r?\n/)

  if (frontMatter.lineOffset === 0) {
    const header = ['---', ...entries.map(([key, value]) => `${key}: "${value}"`), '---', '']
    return `${header.join(newline)}${content}`
  }

  let closingIndex = frontMatter.lineOffset - 1
  for (const [key, value] of entries) {
    const fieldIndex = lines.slice(1, closingIndex).findIndex((line) => line.startsWith(`${key}:`))
    if (fieldIndex >= 0) lines[fieldIndex + 1] = `${key}: "${value}"`
    else {
      lines.splice(closingIndex, 0, `${key}: "${value}"`)
      closingIndex++
    }
  }
  return lines.join(newline)
}

export function buildLearningReviewQueue(
  items: Iterable<LearningWorkbenchItem>,
  contents: Record<string, string>,
  today: string,
): LearningReviewQueue {
  const queue: LearningReviewQueue = { overdue: [], today: [], upcoming: [], unscheduled: [], invalid: [] }
  for (const item of items) {
    const content = contents[item.note.id]
    if (content === undefined) continue
    const metadata = parseLearningReviewMetadata(content)
    const due = reviewDueKind(metadata, today)
    queue[due].push({ item, metadata, due })
  }
  for (const kind of ['overdue', 'today', 'upcoming', 'unscheduled', 'invalid'] as const) {
    queue[kind].sort((left, right) => compareReviewItems(left, right, kind))
  }
  return queue
}

export function formatLocalDate(date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function reviewDueKind(metadata: LearningReviewMetadata, today: string): ReviewDueKind {
  if (metadata.invalidReviewDate) return 'invalid'
  if (!metadata.reviewDate) return 'unscheduled'
  if (metadata.reviewDate < today) return 'overdue'
  if (metadata.reviewDate === today) return 'today'
  return 'upcoming'
}

function compareReviewItems(left: LearningReviewItem, right: LearningReviewItem, kind: ReviewDueKind): number {
  if (kind === 'overdue' || kind === 'upcoming') {
    const byDate = left.metadata.reviewDate!.localeCompare(right.metadata.reviewDate!)
    if (byDate !== 0) return byDate
  }
  return right.item.note.updatedAt - left.item.note.updatedAt
    || left.item.note.title.localeCompare(right.item.note.title, 'zh-CN')
    || left.item.note.id.localeCompare(right.item.note.id)
}

function requireLocalDate(value: string): string {
  const valid = validLocalDate(value)
  if (!valid) throw new Error('Invalid local date')
  return valid
}

function validLocalDate(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year!, month! - 1, day!)
  return date.getFullYear() === year && date.getMonth() === month! - 1 && date.getDate() === day ? value : null
}

function startsWithFrontMatter(content: string): boolean {
  return /^\uFEFF?---[ \t]*(?:\r?\n|$)/.test(content)
}
