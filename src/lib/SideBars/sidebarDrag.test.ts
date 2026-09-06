import { describe, expect, it } from 'vitest'
import { RISU_PRESET_DRAG_TYPE, RISU_SIDEBAR_DRAG_TYPE } from 'src/ts/dragTypes'
import { createSidebarCharacterDragController } from './sidebarDrag'

const internalDragTypes = [RISU_SIDEBAR_DRAG_TYPE]
const initialOrder = [
  'char-a',
  {
    id: 'folder-a',
    name: 'Folder A',
    color: 'blue',
    data: ['char-b', 'char-c'],
  },
  'char-d',
]

describe('sidebar character drag ownership', () => {
  it('does not reuse an old internal source for a later external drop', () => {
    const drag = createSidebarCharacterDragController()
    expect(drag.begin({ index: 0 }, initialOrder)).toBe(true)

    expect(drag.consume(['Files'], initialOrder)).toBeNull()
    expect(drag.consume(internalDragTypes, initialOrder)).toBeNull()
  })

  it('clears a canceled drag before another drop can consume it', () => {
    const drag = createSidebarCharacterDragController()
    expect(drag.begin({ folder: 'folder-a', index: 1 }, initialOrder)).toBe(true)

    drag.clear()

    expect(drag.consume(internalDragTypes, initialOrder)).toBeNull()
  })

  it('does not consume another internal surface as a sidebar drag', () => {
    const drag = createSidebarCharacterDragController()
    expect(drag.begin({ index: 0 }, initialOrder)).toBe(true)

    expect(drag.consume([RISU_PRESET_DRAG_TYPE], initialOrder)).toBeNull()
  })

  it('invalidates a raw drag index when character order changes mid-drag', () => {
    const drag = createSidebarCharacterDragController()
    expect(drag.begin({ index: 2 }, initialOrder)).toBe(true)

    const reordered = ['char-d', 'char-a', initialOrder[1]]

    expect(drag.consume(internalDragTypes, reordered)).toBeNull()
  })

  it('returns an unchanged drag source exactly once', () => {
    const drag = createSidebarCharacterDragController()
    expect(drag.begin({ folder: 'folder-a', index: 0 }, initialOrder)).toBe(true)

    expect(drag.consume(internalDragTypes, initialOrder)).toEqual({ folder: 'folder-a', index: 0 })
    expect(drag.consume(internalDragTypes, initialOrder)).toBeNull()
  })
})
