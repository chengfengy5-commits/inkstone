import { describe, expect, it } from 'vitest'
import type { NoteSummary } from '@shared/types'
import { buildLearningReviewQueue, formatLocalDate, LAST_STUDIED_KEY, parseLearningReviewMetadata, REVIEW_DATE_KEY, updateLearningReviewMetadata } from './learning-review'
import type { LearningWorkbenchItem } from './learning-workbench'

describe('learning review metadata', () => {
  it('adds review metadata without changing the body', () => {
    const source = '# Topic\n\nKeep [[source]] and #topic/Java.'
    const next = updateLearningReviewMetadata(source, { reviewDate: '2026-09-30', lastStudied: '2026-09-22' })

    expect(next).toContain(`${REVIEW_DATE_KEY}: "2026-09-30"`)
    expect(next).toContain(`${LAST_STUDIED_KEY}: "2026-09-22"`)
    expect(next).toContain(source)
    expect(parseLearningReviewMetadata(next)).toEqual({
      reviewDate: '2026-09-30',
      lastStudied: '2026-09-22',
      invalidReviewDate: false,
    })
  })

  it('updates existing fields while preserving front matter and CRLF formatting', () => {
    const source = `---\r\ntitle: Stable\r\n${REVIEW_DATE_KEY}: "2026-09-20"\r\nother: true\r\n---\r\nBody`
    const next = updateLearningReviewMetadata(source, { reviewDate: '2026-09-23' })

    expect(next).toBe(`---\r\ntitle: Stable\r\n${REVIEW_DATE_KEY}: "2026-09-23"\r\nother: true\r\n---\r\nBody`)
  })

  it('rejects impossible dates and invalid front matter', () => {
    expect(() => updateLearningReviewMetadata('Body', { reviewDate: '2026-02-30' })).toThrow('Invalid local date')
    expect(() => updateLearningReviewMetadata('---\ntags: [broken\n---\nBody', { reviewDate: '2026-09-22' })).toThrow('Invalid Front Matter')
    expect(() => updateLearningReviewMetadata(`---\n${REVIEW_DATE_KEY}: "2026-09-22"\nBody`, { reviewDate: '2026-09-23' })).toThrow('Invalid Front Matter')
    expect(parseLearningReviewMetadata(`---\n${REVIEW_DATE_KEY}: later\nBody`).invalidReviewDate).toBe(true)
  })

  it('uses local calendar fields instead of UTC string slicing', () => {
    expect(formatLocalDate(new Date(2026, 8, 22, 0, 5))).toBe('2026-09-22')
  })
})

describe('learning review queue', () => {
  it('separates overdue, today, upcoming, unscheduled, and invalid review dates', () => {
    const items = ['overdue', 'today', 'upcoming', 'unscheduled', 'invalid'].map(item)
    const contents = {
      overdue: metadata('2026-09-20'),
      today: metadata('2026-09-22'),
      upcoming: metadata('2026-09-30'),
      unscheduled: 'Body',
      invalid: `---\n${REVIEW_DATE_KEY}: later\n---\nBody`,
    }

    const queue = buildLearningReviewQueue(items, contents, '2026-09-22')

    for (const kind of ['overdue', 'today', 'upcoming', 'unscheduled', 'invalid'] as const) {
      expect(queue[kind].map((entry) => entry.item.note.id)).toEqual([kind])
    }
  })
})

function metadata(reviewDate: string): string {
  return `---\n${REVIEW_DATE_KEY}: "${reviewDate}"\n---\nBody`
}

function item(id: string): LearningWorkbenchItem {
  const note: NoteSummary = {
    id,
    title: id,
    excerpt: '',
    folderId: null,
    tags: [],
    isPinned: false,
    isStarred: false,
    isArchived: false,
    wordCount: 0,
    charCount: 0,
    rev: 1,
    position: 0,
    createdAt: 1,
    updatedAt: 1,
    deletedAt: null,
  }
  return { note, lane: 'review', statusTags: [], needsAttention: false }
}
