import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
import PlaygroundImageTrans from './PlaygroundImageTrans.svelte'
import { language } from 'src/lang'

type MountedComponent = Parameters<typeof unmount>[0]

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })
  return { promise, resolve }
}

let component: MountedComponent | undefined
let target: HTMLElement
let deferredImageDecodePromises: Promise<void>[] = []
let deferredImages: DeferredTestImage[] = []

class DeferredTestImage extends EventTarget {
  src = ''
  width: number
  height = 100
  decode: ReturnType<typeof vi.fn>

  constructor() {
    super()
    const index = deferredImages.length
    this.width = index === 0 ? 100 : 200
    this.decode = vi.fn(() => deferredImageDecodePromises[index])
    deferredImages.push(this)
  }
}

beforeEach(() => {
  target = document.createElement('div')
  document.body.append(target)
  imageMocks.alertError.mockReset()
  imageMocks.requestChatData.mockReset()
  imageMocks.selectSingleFile.mockReset()
  deferredImageDecodePromises = []
  deferredImages = []
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  target.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function translationButton(): HTMLButtonElement {
  const button = Array.from(target.querySelectorAll('button')).find(
    (candidate) => candidate.textContent?.trim() === language.imageTranslation,
  )
  if (!(button instanceof HTMLButtonElement)) throw new Error('Image translation button not found')
  return button
}

async function setMode(mode: 'auto' | 'manual'): Promise<void> {
  const select = target.querySelector('select')
  if (!(select instanceof HTMLSelectElement)) throw new Error('Image translation mode selector not found')
  select.value = mode
  select.dispatchEvent(new Event('change', { bubbles: true }))
  await tick()
}

function installImageBrowserMocks() {
  class LoadedImage extends EventTarget {
    src = ''
    width = 80
    height = 40
    naturalWidth = 80
    naturalHeight = 40
    decode = vi.fn(async () => {})
  }

  const canvasContext = {
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 10 })),
    fillStyle: '',
    font: '',
  }

  vi.stubGlobal('Image', LoadedImage)
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:selected-image')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(canvasContext as any)
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,aW1hZ2U=')
  return canvasContext
}

async function waitForTranslationIdle(): Promise<void> {
  await vi.waitFor(() => expect(translationButton().textContent?.trim()).toBe(language.imageTranslation))
}

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

describe('PlaygroundImageTrans request ownership', () => {
  it('names its editable controls and exposes the busy action as disabled', async () => {
    installImageBrowserMocks()
    imageMocks.selectSingleFile.mockResolvedValue({ name: 'image.png', data: new Uint8Array([1, 2, 3]) })
    const response = deferred<{ type: 'success'; result: string }>()
    imageMocks.requestChatData.mockReturnValue(response.promise)
    component = mount(PlaygroundImageTrans, { target })

    expect(target.querySelector('select')?.getAttribute('aria-label')).toBe(language.playground.imageTranslationMode)
    expect(Array.from(target.querySelectorAll('input'), (input) => input.getAttribute('aria-label'))).toEqual([
      language.destinationLanguage,
      language.font,
      language.playground.fontSize,
    ])
    expect(target.querySelector('textarea')?.getAttribute('aria-label')).toBe(language.prompt)

    const button = translationButton()
    button.click()
    await vi.waitFor(() => expect(imageMocks.requestChatData).toHaveBeenCalledOnce())
    expect(button.disabled).toBe(true)
    expect(button.textContent).toContain(language.imageTranslation)
    expect(button.textContent).toContain(language.loading)

    response.resolve({
      type: 'success',
      result:
        '[{"x_min":0,"y_min":0,"x_max":1,"y_max":1,"bg_hex_color":"#fff","text_hex_color":"#000","content":"hello","translation":"translated"}]',
    })
    await waitForTranslationIdle()
    expect(target.querySelectorAll('textarea')[1]?.getAttribute('aria-label')).toBe(language.playground.jsonOutput)
  })

  it('does not submit a model request when automatic file selection is cancelled', async () => {
    imageMocks.selectSingleFile.mockResolvedValue(null)
    component = mount(PlaygroundImageTrans, { target })

    translationButton().click()

    await vi.waitFor(() => expect(imageMocks.selectSingleFile).toHaveBeenCalledOnce())
    await waitForTranslationIdle()
    expect(imageMocks.requestChatData).not.toHaveBeenCalled()
  })

  it('does not submit after the mode changes while file selection is pending', async () => {
    installImageBrowserMocks()
    const selectedFile = deferred<{ name: string; data: Uint8Array }>()
    imageMocks.selectSingleFile.mockReturnValue(selectedFile.promise)
    component = mount(PlaygroundImageTrans, { target })

    translationButton().click()
    await vi.waitFor(() => expect(imageMocks.selectSingleFile).toHaveBeenCalledOnce())
    await setMode('manual')
    await setMode('auto')
    selectedFile.resolve({ name: 'image.png', data: new Uint8Array([1, 2, 3]) })

    await waitForTranslationIdle()
    expect(imageMocks.requestChatData).not.toHaveBeenCalled()
  })

  it('drops a response when the mode changes during the model request', async () => {
    installImageBrowserMocks()
    imageMocks.selectSingleFile.mockResolvedValue({ name: 'image.png', data: new Uint8Array([1, 2, 3]) })
    const response = deferred<{ type: 'success'; result: string }>()
    imageMocks.requestChatData.mockReturnValue(response.promise)
    component = mount(PlaygroundImageTrans, { target })

    translationButton().click()
    await vi.waitFor(() => expect(imageMocks.requestChatData).toHaveBeenCalledOnce())
    await setMode('manual')
    await setMode('auto')
    response.resolve({
      type: 'success',
      result:
        '[{"x_min":0,"y_min":0,"x_max":1,"y_max":1,"bg_hex_color":"#fff","text_hex_color":"#000","content":"hello","translation":"translated"}]',
    })

    await waitForTranslationIdle()
    expect(target.querySelectorAll('textarea')).toHaveLength(1)
    expect(imageMocks.alertError).not.toHaveBeenCalled()
  })

  it('drops a response after the selected image changes', async () => {
    const canvasContext = installImageBrowserMocks()
    imageMocks.selectSingleFile
      .mockResolvedValueOnce({ name: 'image-a.png', data: new Uint8Array([1, 2, 3]) })
      .mockResolvedValueOnce({ name: 'image-b.png', data: new Uint8Array([4, 5, 6]) })
    const response = deferred<{ type: 'success'; result: string }>()
    imageMocks.requestChatData.mockReturnValue(response.promise)
    component = mount(PlaygroundImageTrans, { target })
    await setMode('manual')

    const imageButton = Array.from(target.querySelectorAll('button')).find(
      (candidate) => candidate.textContent?.trim() === language.image,
    )
    if (!(imageButton instanceof HTMLButtonElement)) throw new Error('Image selection button not found')
    imageButton.click()
    await vi.waitFor(() => expect(canvasContext.clearRect).toHaveBeenCalledTimes(1))

    translationButton().click()
    await vi.waitFor(() => expect(imageMocks.requestChatData).toHaveBeenCalledOnce())
    imageButton.click()
    await vi.waitFor(() => expect(canvasContext.clearRect).toHaveBeenCalledTimes(2))

    response.resolve({
      type: 'success',
      result: '{"bg_hex_color":"#fff","text_hex_color":"#000","content":"image A","translation":"translated A"}',
    })

    await waitForTranslationIdle()
    expect(target.querySelectorAll('textarea')).toHaveLength(1)
    expect(imageMocks.alertError).not.toHaveBeenCalled()
  })

  it('drops a response after the manual selection rectangle changes', async () => {
    const canvasContext = installImageBrowserMocks()
    imageMocks.selectSingleFile.mockResolvedValue({ name: 'image.png', data: new Uint8Array([1, 2, 3]) })
    const response = deferred<{ type: 'success'; result: string }>()
    imageMocks.requestChatData.mockReturnValue(response.promise)
    component = mount(PlaygroundImageTrans, { target })
    await setMode('manual')

    const imageButton = Array.from(target.querySelectorAll('button')).find(
      (candidate) => candidate.textContent?.trim() === language.image,
    )
    if (!(imageButton instanceof HTMLButtonElement)) throw new Error('Image selection button not found')
    imageButton.click()
    await vi.waitFor(() => expect(canvasContext.clearRect).toHaveBeenCalledOnce())

    translationButton().click()
    await vi.waitFor(() => expect(imageMocks.requestChatData).toHaveBeenCalledOnce())

    const canvas = target.querySelector('canvas')
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Image canvas not found')
    canvas.setPointerCapture = vi.fn()
    canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10, pointerId: 1 }))
    canvas.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }))

    response.resolve({
      type: 'success',
      result: '{"bg_hex_color":"#fff","text_hex_color":"#000","content":"old crop","translation":"stale"}',
    })

    await waitForTranslationIdle()
    expect(target.querySelectorAll('textarea')).toHaveLength(1)
    expect(imageMocks.alertError).not.toHaveBeenCalled()
  })

  it('preserves a newer invalid JSON draft when a manual response arrives', async () => {
    const canvasContext = installImageBrowserMocks()
    imageMocks.selectSingleFile.mockResolvedValue({ name: 'image.png', data: new Uint8Array([1, 2, 3]) })
    const secondResponse = deferred<{ type: 'success'; result: string }>()
    imageMocks.requestChatData
      .mockResolvedValueOnce({
        type: 'success',
        result: '{"bg_hex_color":"#fff","text_hex_color":"#000","content":"first","translation":"first translated"}',
      })
      .mockReturnValueOnce(secondResponse.promise)
    component = mount(PlaygroundImageTrans, { target })
    await setMode('manual')

    const imageButton = Array.from(target.querySelectorAll('button')).find(
      (candidate) => candidate.textContent?.trim() === language.image,
    )
    if (!(imageButton instanceof HTMLButtonElement)) throw new Error('Image selection button not found')
    imageButton.click()
    await vi.waitFor(() => expect(canvasContext.clearRect).toHaveBeenCalledOnce())

    translationButton().click()
    await vi.waitFor(() => expect(imageMocks.requestChatData).toHaveBeenCalledOnce())
    await waitForTranslationIdle()

    translationButton().click()
    await vi.waitFor(() => expect(imageMocks.requestChatData).toHaveBeenCalledTimes(2))
    const outputDraft = target.querySelectorAll<HTMLTextAreaElement>('textarea')[1]
    if (!outputDraft) throw new Error('Image translation JSON output not found')
    outputDraft.value = '[{"translation":"my newer edit"}'
    outputDraft.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()

    secondResponse.resolve({
      type: 'success',
      result: '{"bg_hex_color":"#fff","text_hex_color":"#000","content":"second","translation":"stale"}',
    })

    await waitForTranslationIdle()
    expect(outputDraft.value).toBe('[{"translation":"my newer edit"}')
    expect(imageMocks.alertError).not.toHaveBeenCalled()
  })

  it('keeps the newest manual image when an older decode finishes last', async () => {
    const decodeA = deferred<void>()
    const decodeB = deferred<void>()
    deferredImageDecodePromises = [decodeA.promise, decodeB.promise]
    const canvasContext = {
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      fillRect: vi.fn(),
      fillText: vi.fn(),
      measureText: vi.fn(() => ({ width: 10 })),
      fillStyle: '',
      font: '',
    }
    vi.stubGlobal('Image', DeferredTestImage)
    vi.spyOn(URL, 'createObjectURL').mockReturnValueOnce('blob:image-a').mockReturnValueOnce('blob:image-b')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(canvasContext as never)
    imageMocks.selectSingleFile
      .mockResolvedValueOnce({ name: 'image-a.png', data: new Uint8Array([1]) })
      .mockResolvedValueOnce({ name: 'image-b.png', data: new Uint8Array([2]) })
    component = mount(PlaygroundImageTrans, { target })
    await setMode('manual')
    const imageButton = Array.from(target.querySelectorAll('button')).find(
      (candidate) => candidate.textContent?.trim() === language.image,
    )
    if (!(imageButton instanceof HTMLButtonElement)) throw new Error('Image selection button not found')

    imageButton.click()
    await vi.waitFor(() => expect(deferredImages).toHaveLength(1))
    imageButton.click()
    await vi.waitFor(() => expect(deferredImages).toHaveLength(2))
    decodeB.resolve()
    await vi.waitFor(() => expect(canvasContext.drawImage).toHaveBeenCalledOnce())
    decodeA.resolve()
    await Promise.resolve()
    await tick()

    expect(canvasContext.drawImage).toHaveBeenCalledOnce()
    expect(canvasContext.drawImage).toHaveBeenCalledWith(deferredImages[1], 0, 0, 200, 100)
    expect(target.querySelector('canvas')?.getAttribute('width')).toBe('200')
  })

  it('drops a response after the destination language changes', async () => {
    installImageBrowserMocks()
    imageMocks.selectSingleFile.mockResolvedValue({ name: 'image.png', data: new Uint8Array([1, 2, 3]) })
    const response = deferred<{ type: 'success'; result: string }>()
    imageMocks.requestChatData.mockReturnValue(response.promise)
    component = mount(PlaygroundImageTrans, { target })

    translationButton().click()
    await vi.waitFor(() => expect(imageMocks.requestChatData).toHaveBeenCalledOnce())

    const destinationLanguage = target.querySelector<HTMLInputElement>('input[type="text"]')
    if (!destinationLanguage) throw new Error('Destination language input not found')
    destinationLanguage.value = 'ko'
    destinationLanguage.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()

    response.resolve({
      type: 'success',
      result:
        '[{"x_min":0,"y_min":0,"x_max":1,"y_max":1,"bg_hex_color":"#fff","text_hex_color":"#000","content":"hello","translation":"translated"}]',
    })

    await waitForTranslationIdle()
    expect(target.querySelectorAll('textarea')).toHaveLength(1)
    expect(imageMocks.alertError).not.toHaveBeenCalled()
  })

  it('preserves a custom prompt after a successful translation', async () => {
    installImageBrowserMocks()
    imageMocks.selectSingleFile.mockResolvedValue({ name: 'image.png', data: new Uint8Array([1, 2, 3]) })
    imageMocks.requestChatData.mockResolvedValue({
      type: 'success',
      result:
        '[{"x_min":0,"y_min":0,"x_max":1,"y_max":1,"bg_hex_color":"#fff","text_hex_color":"#000","content":"hello","translation":"translated"}]',
    })
    component = mount(PlaygroundImageTrans, { target })
    await tick()

    const promptInput = target.querySelector<HTMLTextAreaElement>('textarea')
    if (!promptInput) throw new Error('Prompt input not found')
    promptInput.value = 'Translate this image using my custom instructions.'
    promptInput.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()

    translationButton().click()

    await vi.waitFor(() => expect(imageMocks.requestChatData).toHaveBeenCalledOnce())
    await waitForTranslationIdle()
    expect(target.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe(
      'Translate this image using my custom instructions.',
    )
  })

  it('stops after reporting a failed model response', async () => {
    installImageBrowserMocks()
    imageMocks.selectSingleFile.mockResolvedValue({ name: 'image.png', data: new Uint8Array([1, 2, 3]) })
    imageMocks.requestChatData.mockResolvedValue({ type: 'fail', result: 'provider failed' })
    component = mount(PlaygroundImageTrans, { target })

    translationButton().click()

    await vi.waitFor(() => expect(imageMocks.alertError).toHaveBeenCalledWith('provider failed'))
    await waitForTranslationIdle()
    expect(imageMocks.alertError).toHaveBeenCalledOnce()
    expect(target.querySelectorAll('textarea')).toHaveLength(1)
  })

  it('reports the parse error from malformed successful JSON', async () => {
    installImageBrowserMocks()
    imageMocks.selectSingleFile.mockResolvedValue({ name: 'image.png', data: new Uint8Array([1, 2, 3]) })
    imageMocks.requestChatData.mockResolvedValue({ type: 'success', result: 'not valid JSON' })
    component = mount(PlaygroundImageTrans, { target })

    translationButton().click()

    await vi.waitFor(() => expect(imageMocks.alertError).toHaveBeenCalledOnce())
    await waitForTranslationIdle()
    const reportedError = imageMocks.alertError.mock.calls[0][0]
    expect(reportedError).toBeInstanceOf(SyntaxError)
    expect((reportedError as SyntaxError).message).toMatch(/JSON|Unexpected token/)
  })
})
