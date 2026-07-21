import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const subtitleMocks = vi.hoisted(() => ({
  alertError: vi.fn(),
  alertSelect: vi.fn(),
  decodeAudioFileWithTemporaryContext: vi.fn(),
  downloadFile: vi.fn(),
  pipeline: vi.fn(),
  requestChatData: vi.fn(),
  requestOpenAITranscription: vi.fn(),
  selectFileByDom: vi.fn(),
  selectSingleFile: vi.fn(),
}))

vi.mock('src/ts/storage/database.svelte', () => ({
  getDatabase: () => ({
    language: 'en',
    openAIKey: '',
    useStreaming: true,
  }),
  reapplyPendingPresetProjections: vi.fn(),
}))

vi.mock('src/ts/model/modellist', () => ({
  getModelInfo: () => ({ flags: ['audio', 'video', 'streaming'] }),
  LLMFlags: {
    hasAudioInput: 'audio',
    hasVideoInput: 'video',
    hasStreaming: 'streaming',
  },
}))

vi.mock('src/ts/model/modelRoles', async (importActual) => {
  const actual = await importActual<typeof import('src/ts/model/modelRoles')>()
  return {
    ...actual,
    resolveModelForRole: () => 'test-model',
  }
})

vi.mock('src/ts/process/request/request', () => ({
  requestChatData: subtitleMocks.requestChatData,
}))

vi.mock('src/ts/util', async (importActual) => {
  const actual = await importActual<typeof import('src/ts/util')>()
  return {
    ...actual,
  }
})

vi.mock('src/ts/filePicker', () => ({
  selectFileByDom: subtitleMocks.selectFileByDom,
  selectSingleFile: subtitleMocks.selectSingleFile,
}))

vi.mock('src/ts/server/openAITranscription', () => ({
  requestOpenAITranscription: subtitleMocks.requestOpenAITranscription,
}))

vi.mock('@huggingface/transformers', () => ({
  pipeline: subtitleMocks.pipeline,
}))

vi.mock('./subtitleMedia', () => ({
  decodeAudioFileWithTemporaryContext: subtitleMocks.decodeAudioFileWithTemporaryContext,
  probeVideoDuration: vi.fn(),
  stereoAudioChannels: vi.fn(),
  subtitlePreviewMimeType: (file: File) => file.type || 'audio/mpeg',
}))

vi.mock('src/ts/alert', () => ({
  alertError: subtitleMocks.alertError,
  alertSelect: subtitleMocks.alertSelect,
}))

vi.mock('src/ts/globalApi.svelte', () => ({
  AppendableBuffer: class {
    buffer = new Uint8Array()
    append() {}
  },
  downloadFile: subtitleMocks.downloadFile,
  getLanguageCodes: () => [],
}))

vi.mock('src/ts/parser/parser.svelte', () => ({
  risuChatParser: (value: string) => value,
}))

vi.mock('src/ts/process/modules', () => ({
  getModuleAssets: vi.fn(() => []),
  getModuleLorebooks: vi.fn(() => []),
  getModuleRegexScripts: vi.fn(() => []),
  getModules: vi.fn(() => []),
  moduleUpdate: vi.fn(),
}))

import PlaygroundSubtitle from './PlaygroundSubtitle.svelte'
import { language } from 'src/lang'

type MountedComponent = Parameters<typeof unmount>[0]

let component: MountedComponent | undefined
let target: HTMLElement
let audioPlay: ReturnType<typeof vi.fn>
let audioConstructor: ReturnType<typeof vi.fn>

function runButton(): HTMLButtonElement | undefined {
  return Array.from(target.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Run')
}

function setTextareaValue(value: string): void {
  const textarea = target.querySelector('textarea')
  if (!textarea) throw new Error('prompt textarea not found')
  textarea.value = value
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
}

beforeEach(() => {
  target = document.createElement('div')
  document.body.append(target)
  subtitleMocks.alertError.mockReset()
  subtitleMocks.alertSelect.mockReset()
  subtitleMocks.decodeAudioFileWithTemporaryContext.mockReset()
  subtitleMocks.downloadFile.mockReset()
  subtitleMocks.pipeline.mockReset()
  subtitleMocks.requestChatData.mockReset()
  subtitleMocks.requestOpenAITranscription.mockReset()
  subtitleMocks.selectFileByDom.mockReset()
  subtitleMocks.selectSingleFile.mockReset()
  audioPlay = vi.fn(async () => {})
  audioConstructor = vi.fn(function () {
    return { play: audioPlay }
  })
  vi.stubGlobal('Audio', audioConstructor)
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  target.remove()
  vi.unstubAllGlobals()
})

async function selectMode(value: 'llm' | 'whisper' | 'whisperLocal'): Promise<void> {
  const select = Array.from(target.querySelectorAll<HTMLSelectElement>('select')).find((candidate) =>
    Array.from(candidate.options).some((option) => option.value === 'whisperLocal'),
  )
  if (!select) throw new Error('mode select not found')
  select.value = value
  select.dispatchEvent(new Event('input', { bubbles: true }))
  select.dispatchEvent(new Event('change', { bubbles: true }))
  await tick()
  if (value !== 'llm') {
    expect(target.querySelector<HTMLTextAreaElement>('textarea')?.value).toContain('{{slot::data}}')
  }
}

describe('PlaygroundSubtitle run recovery', () => {
  it('names its language, prompt, and mode controls and exposes the selected options', async () => {
    component = mount(PlaygroundSubtitle, { target })

    const destination = target.querySelector<HTMLInputElement>('input[type="text"]')
    const prompt = target.querySelector('textarea')
    const mode = target.querySelector('select')
    expect(destination?.getAttribute('aria-label')).toBe(language.destinationLanguage)
    expect(prompt?.getAttribute('aria-label')).toBe(language.prompt)
    expect(mode?.getAttribute('aria-label')).toBe(language.type)
    expect(mode?.value).toBe('llm')

    await selectMode('whisperLocal')
    const source = Array.from(target.querySelectorAll('select')).find(
      (select) => select.getAttribute('aria-label') === language.sourceLanguage,
    )
    expect(source?.value).toBe('auto')
  })

  it('restores the Run control when the selected model cannot stream subtitles', async () => {
    subtitleMocks.selectSingleFile.mockResolvedValue({
      name: 'sample.mp3',
      data: new Uint8Array([1, 2, 3]),
    })
    subtitleMocks.requestChatData.mockResolvedValue({ type: 'success', result: 'unsupported response' })
    component = mount(PlaygroundSubtitle, { target })
    setTextareaValue('Create subtitles in {{slot}}')

    expect(runButton()).toBeTruthy()
    runButton()!.click()

    await vi.waitFor(() => expect(subtitleMocks.alertError).toHaveBeenCalledWith('unsupported response'))
    await tick()

    expect(target.textContent).not.toContain('Loading...')
    expect(runButton()).toBeTruthy()
  })

  it('surfaces an unexpected request failure and allows a retry', async () => {
    const requestError = new Error('subtitle request failed')
    subtitleMocks.selectSingleFile.mockResolvedValue({
      name: 'sample.mp3',
      data: new Uint8Array([1, 2, 3]),
    })
    subtitleMocks.requestChatData.mockRejectedValue(requestError)
    component = mount(PlaygroundSubtitle, { target })
    setTextareaValue('Create subtitles in {{slot}}')

    runButton()!.click()

    await vi.waitFor(() => expect(subtitleMocks.alertError).toHaveBeenCalledWith(requestError))
    expect(runButton()).toBeTruthy()

    runButton()!.click()
    await vi.waitFor(() => expect(subtitleMocks.alertError).toHaveBeenCalledTimes(2))
    expect(runButton()).toBeTruthy()
  })

  it('aborts and cancels an active subtitle stream when the tool unmounts', async () => {
    const reader = {
      cancel: vi.fn(async () => {}),
      read: vi.fn(
        () =>
          new Promise(() => {
            /* intentionally never resolves */
          }),
      ),
      releaseLock: vi.fn(),
    }
    subtitleMocks.selectSingleFile.mockResolvedValue({
      name: 'sample.mp3',
      data: new Uint8Array([1, 2, 3]),
    })
    subtitleMocks.requestChatData.mockResolvedValue({
      type: 'streaming',
      result: { getReader: () => reader },
    })
    component = mount(PlaygroundSubtitle, { target })
    setTextareaValue('Create subtitles in {{slot}}')

    runButton()!.click()
    await vi.waitFor(() => expect(reader.read).toHaveBeenCalledTimes(1))
    const signal = subtitleMocks.requestChatData.mock.calls[0][2] as AbortSignal

    unmount(component)
    component = undefined

    expect(signal.aborted).toBe(true)
    expect(reader.cancel).toHaveBeenCalledTimes(1)
    expect(audioConstructor).not.toHaveBeenCalled()
  })

  it('aborts and clears an active run when a request input changes', async () => {
    subtitleMocks.selectSingleFile.mockResolvedValue({
      name: 'sample.mp3',
      data: new Uint8Array([1, 2, 3]),
    })
    subtitleMocks.requestChatData.mockImplementation(
      () =>
        new Promise(() => {
          /* intentionally never resolves */
        }),
    )
    component = mount(PlaygroundSubtitle, { target })

    runButton()!.click()
    await vi.waitFor(() => expect(subtitleMocks.requestChatData).toHaveBeenCalledOnce())
    const signal = subtitleMocks.requestChatData.mock.calls[0][2] as AbortSignal

    setTextareaValue('A replacement subtitle prompt')
    await tick()

    expect(signal.aborted).toBe(true)
    expect(target.textContent).not.toContain('Loading...')
    expect(runButton()).toBeTruthy()
    expect(audioConstructor).not.toHaveBeenCalled()
  })

  it('passes teardown cancellation into OpenAI transcription', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'sample.mp3', { type: 'audio/mpeg' })
    subtitleMocks.selectFileByDom.mockResolvedValue([file])
    subtitleMocks.requestOpenAITranscription.mockImplementation(
      () =>
        new Promise(() => {
          /* intentionally never resolves */
        }),
    )
    component = mount(PlaygroundSubtitle, { target })
    await selectMode('whisper')

    runButton()!.click()
    await vi.waitFor(() => expect(subtitleMocks.requestOpenAITranscription).toHaveBeenCalledTimes(1))
    const signal = subtitleMocks.requestOpenAITranscription.mock.calls[0][1] as AbortSignal

    unmount(component)
    component = undefined

    expect(signal.aborted).toBe(true)
    expect(subtitleMocks.requestChatData).not.toHaveBeenCalled()
    expect(audioConstructor).not.toHaveBeenCalled()
  })

  it('does not download a generated subtitle when format selection is cancelled', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'sample.mp3', { type: 'audio/mpeg' })
    Object.defineProperty(file, 'arrayBuffer', {
      value: vi.fn(async () => new Uint8Array([1, 2, 3]).buffer),
    })
    const reader = {
      read: vi
        .fn()
        .mockResolvedValueOnce({
          done: false,
          value: {
            response: '```webvtt\nWEBVTT\n\n00:00.000 --> 00:01.000\nHello\n```',
          },
        })
        .mockResolvedValueOnce({ done: true, value: undefined }),
      releaseLock: vi.fn(),
    }
    subtitleMocks.selectFileByDom.mockResolvedValue([file])
    subtitleMocks.requestOpenAITranscription.mockResolvedValue('WEBVTT\n\n00:00.000 --> 00:01.000\nHello')
    subtitleMocks.requestChatData.mockResolvedValue({
      type: 'streaming',
      result: { getReader: () => reader },
    })
    subtitleMocks.alertSelect.mockResolvedValue(null)
    component = mount(PlaygroundSubtitle, { target })
    await selectMode('whisper')

    runButton()!.click()
    await vi.waitFor(() => {
      expect(
        Array.from(target.querySelectorAll('button')).some(
          (button) => button.textContent?.trim() === language.download,
        ),
      ).toBe(true)
    })

    const downloadButton = Array.from(target.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === language.download,
    )
    downloadButton?.click()
    await vi.waitFor(() => expect(subtitleMocks.alertSelect).toHaveBeenCalledWith(['WebVTT', 'SRT']))

    expect(subtitleMocks.downloadFile).not.toHaveBeenCalled()
  })

  it('reports a local Whisper pipeline failure without erasing its details', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'sample.mp3', { type: 'audio/mpeg' })
    const pipelineError = new Error('local Whisper pipeline failed')
    subtitleMocks.selectFileByDom.mockResolvedValue([file])
    subtitleMocks.pipeline.mockRejectedValue(pipelineError)
    component = mount(PlaygroundSubtitle, { target })
    await selectMode('whisperLocal')

    runButton()!.click()

    await vi.waitFor(() => expect(subtitleMocks.alertError).toHaveBeenCalledWith(pipelineError))
    expect(runButton()).toBeTruthy()
    expect(target.textContent).not.toContain('Loading...')
  })

  it('disposes a local Whisper pipeline when the tool unmounts mid-transcription', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'sample.mp3', { type: 'audio/mpeg' })
    const dispose = vi.fn(async () => {})
    const transcriber = Object.assign(
      vi.fn(
        () =>
          new Promise(() => {
            /* intentionally never resolves */
          }),
      ),
      { dispose },
    )
    subtitleMocks.selectFileByDom.mockResolvedValue([file])
    subtitleMocks.pipeline.mockResolvedValue(transcriber)
    subtitleMocks.decodeAudioFileWithTemporaryContext.mockResolvedValue({
      numberOfChannels: 1,
      getChannelData: () => new Float32Array([0.1, 0.2]),
    })
    component = mount(PlaygroundSubtitle, { target })
    await selectMode('whisperLocal')

    runButton()!.click()
    await vi.waitFor(() => expect(transcriber).toHaveBeenCalledTimes(1))

    unmount(component)
    component = undefined

    expect(dispose).toHaveBeenCalledTimes(1)
    expect(audioConstructor).not.toHaveBeenCalled()
  })
})
