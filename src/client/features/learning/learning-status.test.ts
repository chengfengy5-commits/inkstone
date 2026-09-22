import { describe, expect, it } from 'vitest'
import { extractTags } from '@shared/markdown-utils'
import { LEARNING_STATUS_PREFIX, LEARNING_STATUS_TAGS } from './learning-workbench'
import { replaceLearningStatus } from './learning-status'

describe('replaceLearningStatus', () => {
  it('replaces a body status without changing links, text, or other tags', () => {
    const source = '# Topic\n\nKeep [[Original link]] and this text.\n\n#topic/Java #learning-state'
      .replace('#learning-state', `#${status('practice')}`)

    const next = replaceLearningStatus(source, 'learning')

    expect(next).toContain('Keep [[Original link]] and this text.')
    expect(next).toContain('#topic/Java')
    expect(next).not.toContain(status('practice'))
    expect(extractTags(next)).toContain(status('learning'))
  })

  it('collapses conflicting front matter and body statuses to one logical status', () => {
    const source = `---\ntitle: Stable\ntags:\n  - ${status('practice')}\n  - topic/AI\nreviewed: false\n---\n\nBody #${status('review')} with [source](https://example.com).`

    const next = replaceLearningStatus(source, 'mastered')

    expect(next).toContain('title: Stable')
    expect(next).toContain('reviewed: false')
    expect(next).toContain('topic/AI')
    expect(next).toContain('[source](https://example.com)')
    expect(extractTags(next).filter((tag) => tag.startsWith(LEARNING_STATUS_PREFIX))).toEqual([status('mastered')])
  })

  it('appends a body tag when the content has no learning status', () => {
    const source = '# Topic\n\nBody #topic/Java'
    const next = replaceLearningStatus(source, 'review')

    expect(next).toBe(`${source}\n\n#${status('review')}`)
  })

  it('returns the original content when the requested status is already unique', () => {
    const source = `Body #${status('review')}`
    expect(replaceLearningStatus(source, 'review')).toBe(source)
  })
})

function status(lane: keyof typeof LEARNING_STATUS_TAGS): string {
  return `${LEARNING_STATUS_PREFIX}${LEARNING_STATUS_TAGS[lane]}`
}
