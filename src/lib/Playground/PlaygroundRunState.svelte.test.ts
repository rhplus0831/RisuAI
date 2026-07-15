import { mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const runMocks = vi.hoisted(() => ({
  addText: vi.fn(),
  alertError: vi.fn(),
  generateAIImage: vi.fn(),
  similaritySearchScored: vi.fn(),
}))

vi.mock('src/ts/process/stableDiff', () => ({
  generateAIImage: runMocks.generateAIImage,
}))

vi.mock('src/ts/characters', () => ({
  createBlankChar: vi.fn(() => ({})),
}))

vi.mock('src/ts/process/memory/hypamemory', () => ({
  HypaProcesser: class {
    vectors = []
    addText = runMocks.addText
    similaritySearchScored = runMocks.similaritySearchScored
  },
}))

vi.mock('src/ts/server/settingsBridge.svelte', () => ({
  createServerBackedSettingDraft: (_key: string, fallback: unknown) => ({ value: fallback }),
}))

vi.mock('src/ts/alert', () => ({
  alertError: runMocks.alertError,
}))

vi.mock('src/ts/process/modules', () => ({
  getModuleAssets: vi.fn(() => []),
  getModuleLorebooks: vi.fn(() => []),
  getModuleRegexScripts: vi.fn(() => []),
  getModules: vi.fn(() => []),
  moduleUpdate: vi.fn(),
}))

import PlaygroundEmbedding from './PlaygroundEmbedding.svelte'
import PlaygroundImageGen from './PlaygroundImageGen.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

let component: MountedComponent | undefined
let target: HTMLElement

beforeEach(() => {
  target = document.createElement('div')
  document.body.append(target)
  runMocks.addText.mockReset()
  runMocks.alertError.mockReset()
  runMocks.generateAIImage.mockReset()
  runMocks.similaritySearchScored.mockReset()
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  target.remove()
})

describe('playground run-state recovery', () => {
  it('restores the image generation button after an unexpected failure', async () => {
    runMocks.generateAIImage.mockRejectedValue(new Error('image failed'))
    component = mount(PlaygroundImageGen, { target })

    const button = Array.from(target.querySelectorAll('button')).find((candidate) =>
      candidate.textContent?.includes('Generate'),
    )
    expect(button).toBeTruthy()
    button!.click()

    await vi.waitFor(() => expect(runMocks.alertError).toHaveBeenCalledWith(expect.any(Error)))
    expect(target.querySelector('.loadmove')).toBeNull()
    expect(target.textContent).toContain('Generate')
  })

  it('restores the embedding run button after an embedding failure', async () => {
    runMocks.addText.mockRejectedValue(new Error('embedding failed'))
    component = mount(PlaygroundEmbedding, { target })

    const button = Array.from(target.querySelectorAll('button')).at(-1)
    expect(button).toBeTruthy()
    button!.click()

    await vi.waitFor(() => expect(runMocks.alertError).toHaveBeenCalledWith(expect.any(Error)))
    expect(target.querySelector('.loadmove')).toBeNull()
  })
})
