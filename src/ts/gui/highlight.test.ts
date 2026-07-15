import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getNewHighlightId, highlighter, removeHighlight } from './highlight'

class FakeHighlight {
  constructor(public readonly ranges: Range[]) {}
}

describe('CSS syntax highlight cleanup', () => {
  let registry: Map<string, FakeHighlight>
  let highlightId: number

  beforeEach(() => {
    registry = new Map()
    highlightId = getNewHighlightId()
    vi.stubGlobal('CSS', { highlights: registry })
    vi.stubGlobal('Highlight', FakeHighlight)
  })

  afterEach(() => {
    removeHighlight(highlightId)
    vi.unstubAllGlobals()
    document.body.replaceChildren()
  })

  it('removes a category after its final matching token is edited away', () => {
    const editor = document.createElement('div')
    editor.textContent = '{{personality}}'
    document.body.append(editor)

    highlighter(editor, highlightId)
    expect(registry.has('deprecated')).toBe(true)

    editor.textContent = 'plain text'
    highlighter(editor, highlightId)
    expect(registry.has('deprecated')).toBe(false)
  })

  it('removes registered ranges when an editor is destroyed', () => {
    const editor = document.createElement('div')
    editor.textContent = '{{personality}}'
    document.body.append(editor)

    highlighter(editor, highlightId)
    expect(registry.has('deprecated')).toBe(true)

    removeHighlight(highlightId)
    expect(registry.has('deprecated')).toBe(false)
  })
})
