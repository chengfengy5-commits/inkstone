import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NoteSummary } from '@shared/types'
import { initI18n, t } from '../../lib/i18n'
import { useNotes } from '../../store/notes'
import { useUi } from '../../store/ui'
import { LearningWorkbenchPanel } from './LearningWorkbenchPanel'
import { formatLocalDate, parseLearningReviewMetadata } from './learning-review'
import { LEARNING_STATUS_PREFIX, LEARNING_STATUS_TAGS } from './learning-workbench'

let root: Root
let container: HTMLDivElement
let notesState: ReturnType<typeof useNotes.getState>
let toast: ReturnType<typeof useUi.getState>['toast']

beforeEach(async () => {
  localStorage.clear()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  await initI18n()
  notesState = useNotes.getState()
  toast = useUi.getState().toast
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(() => root.unmount())
  useNotes.setState(notesState, true)
  useUi.setState({ toast })
  container.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('learning workbench panel', () => {
  it('shows one card per learning note and opens the selected note', async () => {
    const openNote = vi.fn(async () => {})
    const onClose = vi.fn()
    useNotes.setState({
      notes: {
        practice: note('practice', 'Practice one', [status('practice')]),
        attention: note('attention', 'Conflicting status', [status('learning'), status('review')]),
        ordinary: note('ordinary', 'Ordinary note', ['topic/general']),
      },
      openNote,
    })

    await act(() => root.render(createElement(LearningWorkbenchPanel, { onClose })))

    expect(document.body.textContent).toContain(t('learning.title'))
    expect(document.body.textContent).toContain('Practice one')
    expect(document.body.textContent).toContain('Conflicting status')
    expect(document.body.textContent).not.toContain('Ordinary note')

    const button = document.querySelector<HTMLButtonElement>(`button[aria-label="${t('learning.open_note', { title: 'Practice one' })}"]`)!
    await act(() => button.click())
    expect(onClose).toHaveBeenCalledOnce()
    expect(openNote).toHaveBeenCalledWith('practice')
  })

  it('shows an empty state when no note has a learning status', async () => {
    useNotes.setState({ notes: { ordinary: note('ordinary', 'Ordinary note', ['topic/general']) } })

    await act(() => root.render(createElement(LearningWorkbenchPanel, { onClose: vi.fn() })))

    expect(document.body.textContent).toContain(t('learning.empty_title'))
    expect(document.body.textContent).toContain(t('learning.empty_description'))
  })

  it('loads an unopened note without navigation and stages its status change', async () => {
    const editContent = vi.fn()
    const source = `Body #${status('practice')} #topic/Java`
    const openNote = vi.fn(async (id: string) => {
      useNotes.setState((state) => ({ contents: { ...state.contents, [id]: source } }))
    })
    useNotes.setState({
      notes: { practice: note('practice', 'Practice one', [status('practice')]) },
      contents: {},
      openNote,
      editContent,
    })

    await act(() => root.render(createElement(LearningWorkbenchPanel, { onClose: vi.fn() })))
    const select = [...document.querySelectorAll<HTMLSelectElement>('select')]
      .find((item) => item.getAttribute('aria-label') === t('learning.change_status', { title: 'Practice one' }))!

    await act(async () => {
      select.value = 'learning'
      select.dispatchEvent(new Event('change', { bubbles: true }))
      await Promise.resolve()
    })

    expect(openNote).toHaveBeenCalledWith('practice', { navigate: false })
    expect(editContent).toHaveBeenCalledOnce()
    const written = editContent.mock.calls[0]![1] as string
    expect(written).toContain(`Body #${status('learning')} #topic/Java`)
    expect(parseLearningReviewMetadata(written).lastStudied).toBe(formatLocalDate())
  })

  it('reports a failed background load without staging a partial edit', async () => {
    const editContent = vi.fn()
    const toast = vi.fn()
    useUi.setState({ toast })
    useNotes.setState({
      notes: { practice: note('practice', 'Practice one', [status('practice')]) },
      contents: {},
      openNote: vi.fn(async () => {}),
      editContent,
    })

    await act(() => root.render(createElement(LearningWorkbenchPanel, { onClose: vi.fn() })))
    const select = [...document.querySelectorAll<HTMLSelectElement>('select')]
      .find((item) => item.getAttribute('aria-label') === t('learning.change_status', { title: 'Practice one' }))!

    await act(async () => {
      select.value = 'review'
      select.dispatchEvent(new Event('change', { bubbles: true }))
      await Promise.resolve()
    })

    expect(editContent).not.toHaveBeenCalled()
    expect(toast).toHaveBeenCalledWith({ title: t('learning.status_update_failed'), tone: 'danger' })
  })

  it('shows the due queue and schedules a review through the existing write path', async () => {
    const today = formatLocalDate()
    const source = `---\n${String.fromCodePoint(0x590d, 0x4e60, 0x65e5, 0x671f)}: "${today}"\n---\nBody #${status('review')}`
    const editContent = vi.fn()
    useNotes.setState({
      notes: { review: note('review', 'Review one', [status('review')]) },
      contents: { review: source },
      openNote: vi.fn(async () => {}),
      editContent,
    })

    await act(() => root.render(createElement(LearningWorkbenchPanel, { onClose: vi.fn() })))
    expect(document.body.textContent).toContain(t('learning.review_queue'))
    expect(document.body.textContent).toContain(t('learning.review_today'))
    const input = document.querySelector<HTMLInputElement>(`input[aria-label="${t('learning.schedule_review', { title: 'Review one' })}"]`)!
    expect(input.value).toBe(today)

    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '2026-09-30')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
      await Promise.resolve()
    })

    expect(editContent).toHaveBeenCalledOnce()
    const written = editContent.mock.calls[0]![1] as string
    expect(parseLearningReviewMetadata(written)).toEqual({
      reviewDate: '2026-09-30',
      lastStudied: today,
      invalidReviewDate: false,
    })
  })
})

function status(lane: keyof typeof LEARNING_STATUS_TAGS): string {
  return `${LEARNING_STATUS_PREFIX}${LEARNING_STATUS_TAGS[lane]}`
}

function note(id: string, title: string, tags: string[]): NoteSummary {
  return {
    id,
    title,
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
  }
}
