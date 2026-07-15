import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const otherBotMocks = vi.hoisted(() => ({
  alertConfirm: vi.fn(),
  alertError: vi.fn(),
  alertInput: vi.fn(),
  alertMd: vi.fn(),
  alertNormal: vi.fn(),
  drafts: new Map<string, { value: any }>(),
  globalFetch: vi.fn(),
  initialWavespeedImage: {} as Record<string, any>,
  loraWrites: [] as Array<Array<{ path: string; scale: number }>>,
}))

vi.mock('src/ts/process/modules', () => ({
  getModuleAssets: vi.fn(() => []),
  getModuleLorebooks: vi.fn(() => []),
  getModuleRegexScripts: vi.fn(() => []),
  getModules: vi.fn(() => []),
  moduleUpdate: vi.fn(),
}))

vi.mock('src/ts/server/settingsBridge.svelte', () => ({
  createServerBackedSettingDraft: (key: string, fallback: unknown) => {
    const clone = <T>(value: T): T => (value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T))

    let value = key === 'sdProvider' ? 'wavespeed' : clone(fallback)
    if (key === 'wavespeedImage') {
      value = new Proxy(clone(otherBotMocks.initialWavespeedImage), {
        set(target, property, nextValue) {
          if (property === 'loras') {
            otherBotMocks.loraWrites.push(clone(nextValue))
          }
          return Reflect.set(target, property, nextValue)
        },
      })
    }

    const draft = { value }
    otherBotMocks.drafts.set(key, draft)
    return draft
  },
  watchServerBackedSettings: vi.fn(() => vi.fn()),
}))

vi.mock('src/ts/globalApi.svelte', () => ({
  downloadFile: vi.fn(),
  globalFetch: otherBotMocks.globalFetch,
  saveAsset: vi.fn(),
}))

vi.mock('src/ts/alert', () => ({
  alertConfirm: otherBotMocks.alertConfirm,
  alertError: otherBotMocks.alertError,
  alertInput: otherBotMocks.alertInput,
  alertMd: otherBotMocks.alertMd,
  alertNormal: otherBotMocks.alertNormal,
}))

vi.mock('src/ts/characters', () => ({
  getCharImage: vi.fn(),
}))

vi.mock('src/ts/process/prompt', () => ({
  tokenizePreset: vi.fn(async () => 0),
}))

vi.mock('src/ts/tokenizer', () => ({
  getCharToken: vi.fn(async () => ({ dynamic: 0, persistant: 0 })),
}))

vi.mock('src/ts/process/memory/hypav3', () => ({
  createHypaV3Preset: vi.fn(() => ({ name: 'Default', settings: {} })),
}))

vi.mock('src/ts/server/promptTemplateHydration', () => ({
  ensurePromptTemplateHydrated: vi.fn(),
}))

vi.mock('src/ts/gui/highlight', () => ({
  AllCBS: [],
  getNewHighlightId: vi.fn(() => 1),
  highlighter: vi.fn(),
  removeHighlight: vi.fn(),
}))

import OtherBotSettings from './OtherBotSettings.svelte'
import { language } from 'src/lang'
import { replaceResourceDatabase as setDatabaseLite } from 'src/ts/server/resourceState.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

let target: HTMLElement
let component: MountedComponent | undefined

function buttonNamed(name: string): HTMLButtonElement {
  const button = Array.from(target.querySelectorAll('button')).find(
    (candidate) => candidate.textContent?.trim() === name,
  )
  if (!button) throw new Error(`button not found: ${name}`)
  return button
}

beforeEach(() => {
  target = document.createElement('div')
  document.body.appendChild(target)
  otherBotMocks.drafts.clear()
  otherBotMocks.loraWrites.length = 0
  otherBotMocks.initialWavespeedImage = {
    key: 'wavespeed-key',
    model: 'wavespeed/saved-model',
    loras: [
      { path: 'owner/first-lora', scale: 0.7 },
      { path: 'https://example.com/second-lora.safetensors', scale: 1.4 },
    ],
    reference_mode: '',
  }
  otherBotMocks.globalFetch.mockReset()
  otherBotMocks.globalFetch.mockResolvedValue({
    ok: true,
    data: {
      code: 200,
      data: [
        {
          type: 'text-to-image',
          model_id: 'wavespeed/saved-model',
          name: 'Saved model',
          base_price: 0.01,
          api_schema: {
            api_schemas: [{ request_schema: { properties: { loras: {} } } }],
          },
        },
      ],
    },
  })
  setDatabaseLite({ useLegacyGUI: false } as any)
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  target.remove()
  document.body.innerHTML = ''
  setDatabaseLite({} as any)
})

describe('OtherBotSettings WaveSpeed LoRAs', () => {
  it('hydrates persisted rows without writing on mount and syncs later edits', async () => {
    component = mount(OtherBotSettings, { target })
    await tick()

    const wavespeedDraft = otherBotMocks.drafts.get('wavespeedImage')!
    expect(wavespeedDraft.value.loras).toEqual(otherBotMocks.initialWavespeedImage.loras)
    expect(otherBotMocks.loraWrites).toEqual([])

    buttonNamed(language.imageGeneration).click()
    await tick()
    buttonNamed('Refresh Models').click()

    await vi.waitFor(() => {
      expect(target.querySelectorAll<HTMLInputElement>('input[placeholder^="LoRA "]')).toHaveLength(3)
    })

    const loraInputs = target.querySelectorAll<HTMLInputElement>('input[placeholder^="LoRA "]')
    expect(Array.from(loraInputs, (input) => input.value)).toEqual([
      'owner/first-lora',
      'https://example.com/second-lora.safetensors',
      '',
    ])
    expect(otherBotMocks.loraWrites).toEqual([])

    loraInputs[0].value = 'owner/updated-lora'
    loraInputs[0].dispatchEvent(new Event('input', { bubbles: true }))

    await vi.waitFor(() => {
      expect(otherBotMocks.loraWrites).toHaveLength(1)
    })
    expect(wavespeedDraft.value.loras).toEqual([
      { path: 'owner/updated-lora', scale: 0.7 },
      { path: 'https://example.com/second-lora.safetensors', scale: 1.4 },
    ])
  })
})
