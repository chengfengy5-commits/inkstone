import { describe, expect, it } from 'vitest'
import type { NoteSummary } from '@shared/types'
import { buildLearningWorkbench, classifyLearningNote, LEARNING_STATUS_PREFIX, LEARNING_STATUS_TAGS } from './learning-workbench'

describe('learning workbench classification', () => {
  it('places one supported learning status in exactly one lane', () => {
    const model = buildLearningWorkbench([
      note('practice', ['source/repository', status('practice')]),
      note('learning', [status('learning')]),
      note('review', [status('review')]),
      note('mastered', [status('mastered')]),
    ])

    expect(model.total).toBe(4)
    expect(model.lanes.practice.map((item) => item.note.id)).toEqual(['practice'])
    expect(model.lanes.learning.map((item) => item.note.id)).toEqual(['learning'])
    expect(model.lanes.review.map((item) => item.note.id)).toEqual(['review'])
    expect(model.lanes.mastered.map((item) => item.note.id)).toEqual(['mastered'])
    expect(model.lanes.attention).toEqual([])
  })

  it('excludes ordinary, archived, and deleted notes', () => {
    const model = buildLearningWorkbench([
      note('ordinary', ['topic/architecture']),
      note('archived', [status('practice')], { isArchived: true }),
      note('deleted', [status('learning')], { deletedAt: 1 }),
    ])

    expect(model.total).toBe(0)
  })

  it('sends multiple or unknown statuses to one attention lane', () => {
    const multiple = classifyLearningNote(note('multiple', [status('practice'), status('learning')]))
    const unknown = classifyLearningNote(note('unknown', [`${LEARNING_STATUS_PREFIX}paused`]))
    const mixed = classifyLearningNote(note('mixed', [status('mastered'), `${LEARNING_STATUS_PREFIX}custom`]))

    for (const item of [multiple, unknown, mixed]) {
      expect(item?.lane).toBe('attention')
      expect(item?.needsAttention).toBe(true)
    }
  })

  it('deduplicates repeated tags and sorts lanes by update time with deterministic ties', () => {
    const model = buildLearningWorkbench([
      note('older', [status('practice')], { title: 'b', updatedAt: 10 }),
      note('title-b', [status('practice')], { title: 'b', updatedAt: 20 }),
      note('title-a', [status('practice'), status('practice')], { title: 'a', updatedAt: 20 }),
    ])

    expect(model.lanes.practice.map((item) => item.note.id)).toEqual(['title-a', 'title-b', 'older'])
    expect(model.lanes.practice[0]?.statusTags).toEqual([LEARNING_STATUS_TAGS.practice])
  })
})

function note(id: string, tags: string[], overrides: Partial<NoteSummary> = {}): NoteSummary {
  return {
    id,
    title: id,
    excerpt: '',
    folderId: null,
    tags,
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
    ...overrides,
  }
}

function status(lane: keyof typeof LEARNING_STATUS_TAGS): string {
  return `${LEARNING_STATUS_PREFIX}${LEARNING_STATUS_TAGS[lane]}`
}
