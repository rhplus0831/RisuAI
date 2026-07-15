import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const subtitleMocks = vi.hoisted(() => ({
  alertError: vi.fn(),
  requestChatData: vi.fn(),
  selectSingleFile: vi.fn(),
}))

vi.mock('src/ts/storage/database.svelte', () => ({
  getDatabase: () => ({
    language: 'en',
    openAIKey: '',
    useStreaming: true,
  }),
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
    selectSingleFile: subtitleMocks.selectSingleFile,
  }
})

vi.mock('src/ts/alert', () => ({
  alertError: subtitleMocks.alertError,
  alertSelect: vi.fn(),
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

type MountedComponent = Parameters<typeof unmount>[0]

let component: MountedComponent | undefined
let target: HTMLElement

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
  subtitleMocks.requestChatData.mockReset()
  subtitleMocks.selectSingleFile.mockReset()
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  target.remove()
})

describe('PlaygroundSubtitle run recovery', () => {
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
})
