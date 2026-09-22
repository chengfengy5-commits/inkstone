import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NoteSummary } from '@shared/types'
import { initI18n, t } from '../../lib/i18n'
import { useNotes } from '../../store/notes'
import { LearningWorkbenchPanel } from './LearningWorkbenchPanel'
import { LEARNING_STATUS_PREFIX, LEARNING_STATUS_TAGS } from './learning-workbench'

let root: Root
let container: HTMLDivElement
let notesState: ReturnType<typeof useNotes.getState>

beforeEach(async () => {
  localStorage.clear()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  await initI18n()
  notesState = useNotes.getState()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(() => root.unmount())
  useNotes.setState(notesState, true)
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
