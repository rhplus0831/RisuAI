import { describe, expect, it } from 'vitest'
import {
  hasDragType,
  RISU_APP_INTERNAL_DRAG_TYPE,
  RISU_EFFECT_DRAG_TYPE,
  RISU_MODEL_PROFILE_DRAG_TYPE,
  RISU_PRESET_DRAG_TYPE,
  RISU_PROMPT_DRAG_TYPE,
  RISU_SIDEBAR_DRAG_TYPE,
  RISU_TRIGGER_DRAG_TYPE,
} from './dragTypes'

describe('scoped drag types', () => {
  it('assigns a distinct MIME type to every internal drag surface', () => {
    const types = [
      RISU_APP_INTERNAL_DRAG_TYPE,
      RISU_EFFECT_DRAG_TYPE,
      RISU_MODEL_PROFILE_DRAG_TYPE,
      RISU_PRESET_DRAG_TYPE,
      RISU_PROMPT_DRAG_TYPE,
      RISU_SIDEBAR_DRAG_TYPE,
      RISU_TRIGGER_DRAG_TYPE,
    ]

    expect(new Set(types).size).toBe(types.length)
    expect(types.every((type) => type.startsWith('application/x-risu-'))).toBe(true)
  })

  it('matches only the requested type in array-like DataTransfer types', () => {
    const types = { 0: 'Files', 1: RISU_PRESET_DRAG_TYPE, length: 2 }

    expect(hasDragType(types, RISU_PRESET_DRAG_TYPE)).toBe(true)
    expect(hasDragType(types, RISU_SIDEBAR_DRAG_TYPE)).toBe(false)
    expect(hasDragType(undefined, RISU_PRESET_DRAG_TYPE)).toBe(false)
  })
})
