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
  decodeImageBlob,
  imageSelectionRectFromPoints,
  normalizeImageSelectionRect,
  parseImageTranslationRenderOutput,
} from './PlaygroundImageTrans.svelte'

describe('PlaygroundImageTrans JSON rendering', () => {
  it('releases temporary image URLs after decoding', async () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:image-translation')
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const image = { src: '', decode: vi.fn().mockResolvedValue(undefined) }

    await decodeImageBlob(image, new Blob(['image']))

    expect(image.src).toBe('blob:image-translation')
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:image-translation')
    createObjectURL.mockRestore()
    revokeObjectURL.mockRestore()
  })

  it('releases temporary image URLs when decoding fails', async () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:invalid-image')
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const image = { src: '', decode: vi.fn().mockRejectedValue(new Error('invalid image')) }

    await expect(decodeImageBlob(image, new Blob(['invalid']))).rejects.toThrow('invalid image')
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:invalid-image')
    createObjectURL.mockRestore()
    revokeObjectURL.mockRestore()
  })

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
