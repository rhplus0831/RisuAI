import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getNewHighlightId, highlighter, removeHighlight } from './highlight'

class FakeHighlight {
  public readonly ranges: Range[]

  constructor(...ranges: Range[]) {
    this.ranges = ranges
  }
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

  it('highlights a match across every text node in the range', () => {
    const editor = document.createElement('div')
    const start = document.createTextNode('{{per')
    const middle = document.createElement('span')
    middle.textContent = 'son'
    const end = document.createTextNode('ality}}')
    editor.append(start, middle, end)
    document.body.append(editor)

    highlighter(editor, highlightId)

    const highlight = registry.get('deprecated')
    expect(highlight?.ranges).toHaveLength(1)
    expect(highlight?.ranges[0]?.toString()).toBe('{{personality}}')
    expect(highlight?.ranges[0]?.startContainer).toBe(start)
    expect(highlight?.ranges[0]?.endContainer).toBe(end)

    middle.textContent = 'plain'
    highlighter(editor, highlightId)
    expect(registry.has('deprecated')).toBe(false)
  })
})
