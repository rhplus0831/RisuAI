import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const otherBotMocks = vi.hoisted(() => ({
  alertConfirm: vi.fn(),
  alertError: vi.fn(),
  alertInput: vi.fn(),
  alertMd: vi.fn(),
  alertNormal: vi.fn(),
  drafts: new Map<string, { value: any; project?: (value: any) => void }>(),
  hypaEnabled: false,
  hypaPresets: [] as Array<Record<string, any>>,
  initialWavespeedImage: {} as Record<string, any>,
  loraWrites: [] as Array<Array<{ path: string; scale: number }>>,
  ensurePromptTemplateHydrated: vi.fn(),
  getCharToken: vi.fn(),
  providerOperation: vi.fn(),
  providerOperationCredential: vi.fn((apiKey: string) => ({ source: 'provided', apiKey })),
  persistServerBackedSettingsPatch: vi.fn(),
  saveAsset: vi.fn(),
  selectSingleFile: vi.fn(),
  tokenizePreset: vi.fn(),
}))

vi.mock('src/ts/util', async (importActual) => {
  const actual = await importActual<typeof import('src/ts/util')>()
  return {
    ...actual,
    selectSingleFile: otherBotMocks.selectSingleFile,
  }
})

vi.mock('src/ts/process/modules', () => ({
  getModuleAssets: vi.fn(() => []),
  getModuleLorebooks: vi.fn(() => []),
  getModuleRegexScripts: vi.fn(() => []),
  getModules: vi.fn(() => []),
  moduleUpdate: vi.fn(),
}))

vi.mock('src/ts/server/settingsBridge.svelte', async () => {
  const { fromStore, writable } = await import('svelte/store')

  return {
    createServerBackedSettingDraft: (key: string, fallback: unknown) => {
      const clone = <T>(value: T): T => (value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T))

      let value = key === 'sdProvider' ? 'wavespeed' : clone(fallback)
      if (key === 'hypaV3') value = otherBotMocks.hypaEnabled
      if (key === 'hypaV3Presets') value = clone(otherBotMocks.hypaPresets)
      if (key === 'hypaV3Presets') {
        const valueStore = writable(value)
        const reactiveValue = fromStore(valueStore)
        const draft = {
          get value() {
            return reactiveValue.current
          },
          set value(nextValue: unknown) {
            valueStore.set(clone(nextValue))
          },
          project(nextValue: unknown) {
            valueStore.set(clone(nextValue))
          },
        }
        otherBotMocks.drafts.set(key, draft)
        return draft
      }
      if (key !== 'wavespeedImage') {
        const draft = { value }
        otherBotMocks.drafts.set(key, draft)
        return draft
      }

      let current: Record<string, any>
      let valueStore: ReturnType<typeof writable<Record<string, any>>>
      const createReactiveValue = (nextValue: Record<string, any>) =>
        new Proxy(clone(nextValue), {
          set(target, property, propertyValue) {
            if (property === 'loras') {
              otherBotMocks.loraWrites.push(clone(propertyValue))
            }
            return Reflect.set(target, property, propertyValue)
          },
        })

      current = createReactiveValue(otherBotMocks.initialWavespeedImage)
      valueStore = writable(current)
      const reactiveValue = fromStore(valueStore)
      const draft = {
        get value() {
          return reactiveValue.current
        },
        set value(nextValue: Record<string, any>) {
          current = createReactiveValue(nextValue)
          valueStore.set(current)
        },
        project(nextValue: Record<string, any>) {
          current = createReactiveValue(nextValue)
          valueStore.set(current)
        },
      }
      otherBotMocks.drafts.set(key, draft)
      return draft
    },
    persistServerBackedSettingsPatch: otherBotMocks.persistServerBackedSettingsPatch,
    watchServerBackedSettings: vi.fn(() => vi.fn()),
  }
})

vi.mock('src/ts/globalApi.svelte', () => ({
  downloadFile: vi.fn(),
  saveAsset: otherBotMocks.saveAsset,
}))

vi.mock('src/ts/server/providerOperations', () => ({
  providerOperationCredential: otherBotMocks.providerOperationCredential,
  requestProviderOperation: otherBotMocks.providerOperation,
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
  tokenizePreset: otherBotMocks.tokenizePreset,
}))

vi.mock('src/ts/tokenizer', () => ({
  getCharToken: otherBotMocks.getCharToken,
}))

vi.mock('src/ts/process/memory/hypav3', () => ({
  createHypaV3Preset: vi.fn((name = 'Default', settings = {}) => ({ name, settings })),
}))

vi.mock('src/ts/server/promptTemplateHydration', () => ({
  ensurePromptTemplateHydrated: otherBotMocks.ensurePromptTemplateHydrated,
}))

vi.mock('src/ts/gui/highlight', () => ({
  AllCBS: [],
  getNewHighlightId: vi.fn(() => 1),
  highlighter: vi.fn(),
  removeHighlight: vi.fn(),
}))

import OtherBotSettings from './OtherBotSettings.svelte'
import { language } from 'src/lang'
import { getResourceDatabase, replaceResourceDatabase as setDatabaseLite } from 'src/ts/server/resourceState.svelte'
import { selectedCharID } from 'src/ts/stores.svelte'

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

function hypaPresetNames(): Array<string | null> {
  const select = target.querySelector<HTMLSelectElement>('select')
  if (!select) throw new Error('Hypa preset select not found')
  return Array.from(select.options, (option) => option.textContent)
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })
  return { promise, resolve }
}

function projectSettingsPatch(patch: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(patch)) {
    const draft = otherBotMocks.drafts.get(key)
    if (!draft) continue
    if (draft.project) draft.project(value)
    else draft.value = structuredClone(value)
  }
}

beforeEach(() => {
  target = document.createElement('div')
  document.body.appendChild(target)
  otherBotMocks.drafts.clear()
  otherBotMocks.alertConfirm.mockReset()
  otherBotMocks.alertError.mockReset()
  otherBotMocks.alertInput.mockReset()
  otherBotMocks.alertNormal.mockReset()
  otherBotMocks.hypaEnabled = false
  otherBotMocks.hypaPresets = []
  otherBotMocks.loraWrites.length = 0
  otherBotMocks.ensurePromptTemplateHydrated.mockReset().mockResolvedValue(true)
  otherBotMocks.getCharToken.mockReset().mockResolvedValue({ dynamic: 0, persistant: 0 })
  otherBotMocks.persistServerBackedSettingsPatch.mockReset().mockImplementation(async (patch) => {
    projectSettingsPatch(patch as Record<string, unknown>)
    return true
  })
  otherBotMocks.saveAsset.mockReset()
  otherBotMocks.selectSingleFile.mockReset()
  otherBotMocks.tokenizePreset.mockReset().mockResolvedValue(0)
  otherBotMocks.initialWavespeedImage = {
    key: 'wavespeed-key',
    model: 'wavespeed/saved-model',
    loras: [
      { path: 'owner/first-lora', scale: 0.7 },
      { path: 'https://example.com/second-lora.safetensors', scale: 1.4 },
    ],
    reference_mode: '',
  }
  otherBotMocks.providerOperation.mockReset()
  otherBotMocks.providerOperationCredential.mockClear()
  otherBotMocks.providerOperation.mockResolvedValue({
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
  })
  setDatabaseLite({ useLegacyGUI: false } as any)
  selectedCharID.set(-1)
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  target.remove()
  document.body.innerHTML = ''
  setDatabaseLite({} as any)
  selectedCharID.set(-1)
})

describe('OtherBotSettings navigation semantics', () => {
  it('contains the narrow tab strip and exposes the selected panel', async () => {
    component = mount(OtherBotSettings, { target })
    await tick()

    const tabs = target.querySelector<HTMLElement>('[data-risu-media-settings-tabs]')
    expect(tabs).toBeTruthy()
    expect(tabs?.classList.contains('overflow-x-auto')).toBe(true)

    const memory = buttonNamed(language.longTermMemory)
    const image = buttonNamed(language.imageGeneration)
    expect(memory.getAttribute('aria-pressed')).toBe('true')
    expect(image.getAttribute('aria-pressed')).toBe('false')

    image.click()
    await tick()

    expect(memory.getAttribute('aria-pressed')).toBe('false')
    expect(image.getAttribute('aria-pressed')).toBe('true')
  })

  it('switches mounted layouts when the authoritative legacy-GUI setting changes', async () => {
    component = mount(OtherBotSettings, { target })
    await tick()

    expect(target.querySelector('[data-risu-media-settings-tabs]')).toBeTruthy()

    setDatabaseLite({ ...getResourceDatabase({ snapshot: true }), useLegacyGUI: true } as any)
    await tick()
    expect(target.querySelector('[data-risu-media-settings-tabs]')).toBeNull()

    setDatabaseLite({ ...getResourceDatabase({ snapshot: true }), useLegacyGUI: false } as any)
    await tick()
    expect(target.querySelector('[data-risu-media-settings-tabs]')).toBeTruthy()
  })
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
    expect(
      Array.from(target.querySelectorAll<HTMLElement>('[role="slider"]'), (slider) =>
        slider.getAttribute('aria-label'),
      ),
    ).toEqual([language.loraScaleLabel(1), language.loraScaleLabel(2), language.loraScaleLabel(3)])
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

  it('reconciles visible rows after an authoritative LoRA projection without echoing it', async () => {
    component = mount(OtherBotSettings, { target })
    await tick()

    buttonNamed(language.imageGeneration).click()
    await tick()
    buttonNamed('Refresh Models').click()
    await vi.waitFor(() => {
      expect(target.querySelectorAll<HTMLInputElement>('input[placeholder^="LoRA "]')).toHaveLength(3)
    })

    let loraInputs = target.querySelectorAll<HTMLInputElement>('input[placeholder^="LoRA "]')
    loraInputs[0].value = 'owner/attempted-lora'
    loraInputs[0].dispatchEvent(new Event('input', { bubbles: true }))
    await vi.waitFor(() => expect(otherBotMocks.loraWrites).toHaveLength(1))

    const wavespeedDraft = otherBotMocks.drafts.get('wavespeedImage')!
    wavespeedDraft.project?.({
      ...wavespeedDraft.value,
      loras: [{ path: 'owner/canonical-lora', scale: 2.3 }],
    })

    await vi.waitFor(() => {
      loraInputs = target.querySelectorAll<HTMLInputElement>('input[placeholder^="LoRA "]')
      expect(Array.from(loraInputs, (input) => input.value)).toEqual(['owner/canonical-lora', '', ''])
    })
    expect(otherBotMocks.loraWrites).toHaveLength(1)

    loraInputs[1].value = 'owner/newer-lora'
    loraInputs[1].dispatchEvent(new Event('input', { bubbles: true }))
    await vi.waitFor(() => expect(otherBotMocks.loraWrites).toHaveLength(2))
    expect(wavespeedDraft.value.loras).toEqual([
      { path: 'owner/canonical-lora', scale: 2.3 },
      { path: 'owner/newer-lora', scale: 1 },
    ])
  })

  it('orders fetched models by display name instead of unrelated model ids', async () => {
    otherBotMocks.providerOperation.mockResolvedValue({
      code: 200,
      data: [
        {
          type: 'text-to-image',
          model_id: 'aaa-id',
          name: 'Zulu Model',
          base_price: 0.02,
          api_schema: { api_schemas: [] },
        },
        {
          type: 'text-to-image',
          model_id: 'zzz-id',
          name: 'Alpha Model',
          base_price: 0.01,
          api_schema: { api_schemas: [] },
        },
      ],
    })
    component = mount(OtherBotSettings, { target })
    await tick()

    buttonNamed(language.imageGeneration).click()
    await tick()
    buttonNamed('Refresh Models').click()

    let modelSelect: HTMLSelectElement | undefined
    await vi.waitFor(() => {
      modelSelect = Array.from(target.querySelectorAll('select')).find((select) =>
        Array.from(select.options).some((option) => option.value === 'aaa-id'),
      )
      expect(modelSelect).toBeTruthy()
    })

    expect(
      Array.from(modelSelect!.options)
        .map((option) => option.value)
        .filter(Boolean),
    ).toEqual(['zzz-id', 'aaa-id'])
    expect(otherBotMocks.providerOperation).toHaveBeenCalledWith('wavespeed.models', {
      credential: { source: 'provided', apiKey: 'wavespeed-key' },
    })
  })

  it('drops a delayed model response after the API key draft changes', async () => {
    const delayedModels = deferred<{
      code: number
      data: Array<{ type: string; model_id: string; name: string; base_price: number; api_schema: object }>
    }>()
    otherBotMocks.providerOperation.mockReturnValueOnce(delayedModels.promise)
    component = mount(OtherBotSettings, { target })
    await tick()

    buttonNamed(language.imageGeneration).click()
    await tick()
    buttonNamed('Refresh Models').click()
    await vi.waitFor(() => expect(otherBotMocks.providerOperation).toHaveBeenCalledOnce())

    const apiKeyInput = target.querySelector<HTMLInputElement>('input[placeholder="sk-..."]')
    expect(apiKeyInput).toBeTruthy()
    apiKeyInput!.value = 'new-wavespeed-key'
    apiKeyInput!.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()

    delayedModels.resolve({
      code: 200,
      data: [
        {
          type: 'text-to-image',
          model_id: 'stale-model',
          name: 'Stale model',
          base_price: 0.01,
          api_schema: { api_schemas: [] },
        },
      ],
    })

    await vi.waitFor(() => expect(buttonNamed('Refresh Models').disabled).toBe(false))
    expect(otherBotMocks.drafts.get('wavespeedImage')?.value.key).toBe('new-wavespeed-key')
    expect(Array.from(target.querySelectorAll('option'), (option) => option.value)).not.toContain('stale-model')
    expect(otherBotMocks.alertNormal).not.toHaveBeenCalled()
  })

  it('keeps an older delayed file read from superseding a newer reference-image selection', async () => {
    const olderRead = deferred<{ name: string; data: Uint8Array } | null>()
    const newerSave = deferred<string>()
    const olderFile = { name: 'older.png', data: new Uint8Array([1]) }
    const newerFile = { name: 'newer.png', data: new Uint8Array([2]) }
    let pickerCall = 0

    otherBotMocks.initialWavespeedImage.reference_mode = 'image'
    otherBotMocks.providerOperation.mockResolvedValue({
      code: 200,
      data: [
        {
          type: 'image-to-image',
          model_id: 'wavespeed/saved-model',
          name: 'Saved model',
          base_price: 0.01,
          api_schema: { api_schemas: [] },
        },
      ],
    })
    otherBotMocks.selectSingleFile.mockImplementation(
      async (_extensions: string[], options: { onFileSelected?: (file: File) => void } = {}) => {
        pickerCall += 1
        const selected = pickerCall === 1 ? olderFile : newerFile
        options.onFileSelected?.(selected as unknown as File)
        return pickerCall === 1 ? olderRead.promise : selected
      },
    )
    otherBotMocks.saveAsset.mockImplementation((data: Uint8Array) => {
      if (data[0] === 2) return newerSave.promise
      return Promise.resolve('older-asset')
    })

    component = mount(OtherBotSettings, { target })
    await tick()
    buttonNamed(language.imageGeneration).click()
    await tick()
    buttonNamed('Refresh Models').click()

    let uploadButton: HTMLButtonElement | undefined
    await vi.waitFor(() => {
      uploadButton = Array.from(target.querySelectorAll('button')).find(
        (button) => button.textContent?.replace(/\s/g, '') === 'UploadImage',
      )
      expect(uploadButton).toBeTruthy()
    })

    uploadButton!.click()
    await tick()
    uploadButton!.click()
    await vi.waitFor(() => expect(otherBotMocks.saveAsset).toHaveBeenCalledTimes(1))
    expect(otherBotMocks.saveAsset).toHaveBeenCalledWith(newerFile.data, '', newerFile.name)

    olderRead.resolve(olderFile)
    await tick()
    await Promise.resolve()
    expect(otherBotMocks.saveAsset).toHaveBeenCalledTimes(1)

    newerSave.resolve('newer-asset')
    await vi.waitFor(() => {
      expect(otherBotMocks.drafts.get('wavespeedImage')?.value.reference_image).toBe('newer-asset')
    })
  })
})

describe('OtherBotSettings Hypa preset import', () => {
  it('names every preset toolbar action for its target', async () => {
    otherBotMocks.hypaEnabled = true
    otherBotMocks.hypaPresets = [{ name: 'Existing', settings: {} }]
    component = mount(OtherBotSettings, { target })
    await tick()

    const buttons = [
      target.querySelector<SVGElement>('svg.lucide-plus')?.closest('button'),
      target.querySelector<SVGElement>('svg.lucide-pencil')?.closest('button'),
      target.querySelector<SVGElement>('svg.lucide-trash')?.closest('button'),
      target.querySelector<SVGElement>('svg.lucide-download')?.closest('button'),
      target.querySelector<SVGElement>('svg.lucide-hard-drive-upload')?.closest('button'),
    ]

    expect(buttons.map((button) => button?.getAttribute('aria-label'))).toEqual([
      `${language.add}: ${language.presets}`,
      `${language.edit}: Existing`,
      `${language.remove}: Existing`,
      `${language.export}: Existing`,
      `${language.import}: ${language.presets}`,
    ])
    expect(buttons.every((button) => button?.type === 'button')).toBe(true)
    expect(target.querySelector('select')?.getAttribute('aria-label')).toBe(
      `${language.HypaMemory} V3 ${language.presets}`,
    )
  })

  it('silently leaves the preset list unchanged when file selection is canceled', async () => {
    otherBotMocks.hypaEnabled = true
    otherBotMocks.hypaPresets = [{ name: 'Existing', settings: {} }]
    otherBotMocks.selectSingleFile.mockResolvedValue(null)
    component = mount(OtherBotSettings, { target })
    await tick()

    const uploadButton = target.querySelector<SVGElement>('svg.lucide-hard-drive-upload')?.closest('button')
    expect(uploadButton).toBeTruthy()
    const presetsBeforeCancel = structuredClone(otherBotMocks.drafts.get('hypaV3Presets')?.value)
    uploadButton?.click()

    await vi.waitFor(() => expect(otherBotMocks.selectSingleFile).toHaveBeenCalledWith(['json']))
    expect(otherBotMocks.alertError).not.toHaveBeenCalled()
    expect(otherBotMocks.drafts.get('hypaV3Presets')?.value).toEqual(presetsBeforeCancel)
  })

  it('announces import success only after the exact settings patch is acknowledged', async () => {
    const persistence = deferred<boolean>()
    otherBotMocks.hypaEnabled = true
    otherBotMocks.hypaPresets = [{ name: 'Existing', settings: {} }]
    otherBotMocks.selectSingleFile.mockResolvedValue({
      name: 'import.json',
      data: Buffer.from(JSON.stringify({ type: 'risu', data: { name: 'Imported', settings: { queryChatCount: 5 } } })),
    })
    otherBotMocks.persistServerBackedSettingsPatch.mockImplementationOnce((patch) => {
      projectSettingsPatch(patch as Record<string, unknown>)
      return persistence.promise
    })
    component = mount(OtherBotSettings, { target })
    await tick()

    const uploadButton = target.querySelector<SVGElement>('svg.lucide-hard-drive-upload')?.closest('button')
    uploadButton?.click()
    await vi.waitFor(() => expect(otherBotMocks.persistServerBackedSettingsPatch).toHaveBeenCalledOnce())

    const importPatch = otherBotMocks.persistServerBackedSettingsPatch.mock.calls[0][0] as Record<string, any>
    expect(Object.keys(importPatch).sort()).toEqual(['hypaV3PresetId', 'hypaV3Presets'])
    expect(importPatch).toMatchObject({
      hypaV3Presets: [{ name: 'Existing' }, { name: 'Imported', settings: { queryChatCount: 5 } }],
      hypaV3PresetId: 1,
    })
    expect(uploadButton?.disabled).toBe(true)
    expect(otherBotMocks.alertNormal).not.toHaveBeenCalled()

    uploadButton?.click()
    expect(otherBotMocks.selectSingleFile).toHaveBeenCalledTimes(1)

    persistence.resolve(true)
    await vi.waitFor(() => expect(otherBotMocks.alertNormal).toHaveBeenCalledWith(language.successImport))
    expect(uploadButton?.disabled).toBe(false)
  })

  it('does not announce success when preset persistence fails', async () => {
    otherBotMocks.hypaEnabled = true
    otherBotMocks.hypaPresets = [{ name: 'Existing', settings: {} }]
    otherBotMocks.selectSingleFile.mockResolvedValue({
      name: 'import.json',
      data: Buffer.from(JSON.stringify({ type: 'risu', data: { name: 'Imported', settings: {} } })),
    })
    otherBotMocks.persistServerBackedSettingsPatch.mockResolvedValue(false)
    component = mount(OtherBotSettings, { target })
    await tick()

    target.querySelector<SVGElement>('svg.lucide-hard-drive-upload')?.closest('button')?.click()
    await vi.waitFor(() => expect(otherBotMocks.persistServerBackedSettingsPatch).toHaveBeenCalledOnce())
    await tick()

    expect(otherBotMocks.alertNormal).not.toHaveBeenCalled()
  })

  it('drops a file-picker continuation after the settings page unmounts', async () => {
    const selectedFile = deferred<{ name: string; data: Uint8Array } | null>()
    otherBotMocks.hypaEnabled = true
    otherBotMocks.hypaPresets = [{ name: 'Existing', settings: {} }]
    otherBotMocks.selectSingleFile.mockReturnValue(selectedFile.promise)
    component = mount(OtherBotSettings, { target })
    await tick()

    const originalPresets = structuredClone(otherBotMocks.drafts.get('hypaV3Presets')?.value)
    target.querySelector<SVGElement>('svg.lucide-hard-drive-upload')?.closest('button')?.click()
    await vi.waitFor(() => expect(otherBotMocks.selectSingleFile).toHaveBeenCalledOnce())
    unmount(component)
    component = undefined

    selectedFile.resolve({
      name: 'import.json',
      data: Buffer.from(JSON.stringify({ type: 'risu', data: { name: 'Imported', settings: {} } })),
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(otherBotMocks.persistServerBackedSettingsPatch).not.toHaveBeenCalled()
    expect(otherBotMocks.drafts.get('hypaV3Presets')?.value).toEqual(originalPresets)
    expect(otherBotMocks.alertNormal).not.toHaveBeenCalled()
  })
})

describe('OtherBotSettings Hypa memory ratio', () => {
  it('does not advertise client GPU summarizers in server-backed mode', async () => {
    Object.defineProperty(navigator, 'gpu', { configurable: true, value: {} })
    otherBotMocks.hypaEnabled = true
    otherBotMocks.hypaPresets = [{ name: 'Default', settings: { summarizationModel: 'subModel' } }]

    component = mount(OtherBotSettings, { target })
    await tick()

    const values = [...target.querySelectorAll<HTMLOptionElement>('option')].map((option) => option.value)
    expect(values).toContain('subModel')
    expect(values.some((value) => value.startsWith('Qwen3-'))).toBe(false)
    Reflect.deleteProperty(navigator, 'gpu')
  })

  it('recomputes the displayed maximum when its context inputs change', async () => {
    otherBotMocks.hypaEnabled = true
    otherBotMocks.hypaPresets = [
      {
        name: 'Default',
        settings: {
          summarizationModel: 'subModel',
          summarizationPrompt: '',
          reSummarizationPrompt: '',
          memoryTokensRatio: 0.2,
          extraSummarizationRatio: 0,
          maxChatsPerSummary: 6,
          recentMemoryRatio: 0.4,
          similarMemoryRatio: 0.4,
          enableSimilarityCorrection: false,
          preserveOrphanedMemory: false,
          processRegexScript: false,
          doNotSummarizeUserMessage: false,
          summaryChunkSeparator: '\\n\\n',
          useExperimentalImpl: false,
          summarizationRequestsPerMinute: 20,
          summarizationMaxConcurrent: 1,
          embeddingRequestsPerMinute: 100,
          embeddingMaxConcurrent: 1,
          alwaysToggleOn: false,
          queryChatCount: 3,
        },
      },
    ]
    otherBotMocks.tokenizePreset.mockResolvedValue(100)
    otherBotMocks.getCharToken.mockResolvedValue({ dynamic: 0, persistant: 100 })
    selectedCharID.set(0)

    const database = (maxContext: number) =>
      ({
        useLegacyGUI: false,
        promptTemplate: [],
        characters: [
          {
            chaId: 'character-1',
            chats: [],
            chatPage: 0,
            loreSettings: { tokenBudget: 0 },
          },
        ],
        loreBookToken: 0,
        maxResponse: 100,
        maxContext,
      }) as any

    setDatabaseLite(database(1000))
    component = mount(OtherBotSettings, { target })

    const ratioInput = () =>
      target.querySelector<HTMLInputElement>(`input[aria-label="${language.hypaV3Settings.maxMemoryTokensRatioLabel}"]`)

    await vi.waitFor(() => expect(ratioInput()?.valueAsNumber).toBe(0.5))
    expect(
      Array.from(target.querySelectorAll<HTMLElement>('[role="slider"]'), (slider) =>
        slider.getAttribute('aria-label'),
      ),
    ).toEqual([
      language.hypaV3Settings.memoryTokensRatioLabel,
      language.hypaV3Settings.extraSummarizationRatioLabel,
      language.hypaV3Settings.recentMemoryRatioLabel,
      language.hypaV3Settings.similarMemoryRatioLabel,
    ])

    setDatabaseLite(database(2000))

    await vi.waitFor(() => expect(ratioInput()?.valueAsNumber).toBe(0.75))
    expect(otherBotMocks.tokenizePreset).toHaveBeenCalledTimes(2)
    expect(otherBotMocks.getCharToken).toHaveBeenCalledTimes(2)
  })
})

describe('OtherBotSettings Hypa preset async actions', () => {
  it('does not rename an authoritative preset projection after stale input resolves', async () => {
    const rename = deferred<string | null>()
    const authoritativePresets = [
      { name: 'Server One', settings: { recentMemoryRatio: 0.2 } },
      { name: 'Server Two', settings: { recentMemoryRatio: 0.3 } },
    ]
    otherBotMocks.hypaEnabled = true
    otherBotMocks.hypaPresets = [
      { name: 'Local One', settings: { recentMemoryRatio: 0.1 } },
      { name: 'Local Two', settings: { recentMemoryRatio: 0.4 } },
    ]
    otherBotMocks.alertInput.mockReturnValue(rename.promise)
    component = mount(OtherBotSettings, { target })
    await tick()

    const renameButton = target.querySelector<SVGElement>('svg.lucide-pencil')?.closest('button')
    expect(renameButton).toBeTruthy()
    renameButton?.click()
    await vi.waitFor(() => expect(otherBotMocks.alertInput).toHaveBeenCalledOnce())

    const presetsDraft = otherBotMocks.drafts.get('hypaV3Presets')!
    presetsDraft.project?.(authoritativePresets)
    await vi.waitFor(() => {
      expect(hypaPresetNames()).toEqual(['Server One', 'Server Two'])
    })

    rename.resolve('Stale Rename')
    await tick()
    await Promise.resolve()

    expect(presetsDraft.value).toEqual(authoritativePresets)
    expect(hypaPresetNames()).toEqual(['Server One', 'Server Two'])
  })

  it('does not delete from an authoritative preset projection after stale confirmation resolves', async () => {
    const confirmation = deferred<boolean>()
    const authoritativePresets = [
      { name: 'Server One', settings: { recentMemoryRatio: 0.2 } },
      { name: 'Server Two', settings: { recentMemoryRatio: 0.3 } },
      { name: 'Server Three', settings: { recentMemoryRatio: 0.4 } },
    ]
    otherBotMocks.hypaEnabled = true
    otherBotMocks.hypaPresets = [
      { name: 'Local One', settings: { recentMemoryRatio: 0.1 } },
      { name: 'Local Two', settings: { recentMemoryRatio: 0.5 } },
    ]
    otherBotMocks.alertConfirm.mockReturnValue(confirmation.promise)
    component = mount(OtherBotSettings, { target })
    await tick()

    const deleteButton = target.querySelector<SVGElement>('svg.lucide-trash')?.closest('button')
    expect(deleteButton).toBeTruthy()
    deleteButton?.click()
    await vi.waitFor(() => expect(otherBotMocks.alertConfirm).toHaveBeenCalledOnce())

    const presetsDraft = otherBotMocks.drafts.get('hypaV3Presets')!
    presetsDraft.project?.(authoritativePresets)
    await vi.waitFor(() => {
      expect(hypaPresetNames()).toEqual(['Server One', 'Server Two', 'Server Three'])
    })

    confirmation.resolve(true)
    await tick()
    await Promise.resolve()

    expect(presetsDraft.value).toEqual(authoritativePresets)
    expect(hypaPresetNames()).toEqual(['Server One', 'Server Two', 'Server Three'])
  })
})
