import { describe, expect, it, vi } from 'vitest'

const imageMocks = vi.hoisted(() => ({
  alertError: vi.fn(),
  requestChatData: vi.fn(),
  selectSingleFile: vi.fn(),
}))

vi.mock('src/ts/process/modules', () => ({
  getModuleAssets: vi.fn(() => []),
  getModuleLorebooks: vi.fn(() => []),
  getModuleRegexScripts: vi.fn(() => []),
  getModules: vi.fn(() => []),
  moduleUpdate: vi.fn(),
}))

vi.mock('src/ts/util', async (importActual) => {
  const actual = await importActual<typeof import('src/ts/util')>()
  return {
    ...actual,
    jsonOutputTrimmer: (value: string) => value.trim(),
    selectSingleFile: imageMocks.selectSingleFile,
    sleep: vi.fn(async () => {}),
  }
})

vi.mock('src/ts/process/request/request', () => ({
  requestChatData: imageMocks.requestChatData,
}))

vi.mock('src/ts/alert', async (importActual) => {
  const actual = await importActual<typeof import('src/ts/alert')>()
  return {
    ...actual,
    alertError: imageMocks.alertError,
  }
})

import {
  imageSelectionRectFromPoints,
  normalizeImageSelectionRect,
  parseImageTranslationRenderOutput,
} from './PlaygroundImageTrans.svelte'

describe('PlaygroundImageTrans JSON rendering', () => {
  it('returns null instead of throwing on invalid edited JSON', () => {
    expect(parseImageTranslationRenderOutput('{"x_min":')).toBeNull()
    expect(
      parseImageTranslationRenderOutput(
        '[{"x_min":0,"y_min":0,"x_max":1,"y_max":1,"bg_hex_color":"#fff","text_hex_color":"#000","translation":"ok"}]',
      ),
    ).toHaveLength(1)
  })

  it('keeps the original anchor while dragging a selection up and left', () => {
    expect(imageSelectionRectFromPoints(100, 80, 40, 20)).toEqual({
      left: 40,
      top: 20,
      width: 60,
      height: 60,
    })
  })

  it('normalizes selection coordinates using the displayed canvas dimensions', () => {
    expect(
      normalizeImageSelectionRect(
        { left: 150, top: 75, right: 250, bottom: 125 },
        { left: 100, top: 50, width: 400, height: 200 },
      ),
    ).toEqual([0.125, 0.125, 0.375, 0.375])
  })
})
