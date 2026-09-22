import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { markdown } from '@codemirror/lang-markdown'
import { afterEach, describe, expect, it } from 'vitest'
import { buildMarkdownDecorations } from './decorations'

let view: EditorView | null = null

afterEach(() => {
  view?.destroy()
  view = null
})

describe('markdown decorations', () => {
  it('sorts overlapping task, tag, and wiki decorations before building the range set', () => {
    view = new EditorView({
      state: EditorState.create({
        doc: '- [x] #done\n\n[[#anchor]] and #topic/Java',
        extensions: [markdown()],
      }),
      parent: document.body,
    })

    expect(() => buildMarkdownDecorations(view!)).not.toThrow()
  })
})
