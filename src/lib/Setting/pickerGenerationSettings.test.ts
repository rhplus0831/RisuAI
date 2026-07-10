import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const presetSpies = vi.hoisted(() => ({
  changeToPreset: vi.fn(),
  copyPreset: vi.fn(),
  createPreset: vi.fn(),
  deletePreset: vi.fn(),
  downloadPreset: vi.fn(),
  importPreset: vi.fn(),
  reorderPresets: vi.fn(),
  updatePreset: vi.fn(),
}))

const personaSpies = vi.hoisted(() => ({
  changeUserPersona: vi.fn(),
}))

const moduleSpies = vi.hoisted(() => ({
  exportModule: vi.fn(),
  getModuleAssets: vi.fn(() => []),
  getModuleLorebooks: vi.fn(() => []),
  getModuleMcps: vi.fn(() => []),
  getModuleRegexScripts: vi.fn(() => []),
  getModuleToggles: vi.fn(() => ''),
  getModuleTriggers: vi.fn(() => []),
  getModules: vi.fn(() => []),
  importModule: vi.fn(),
  moduleUpdate: vi.fn(),
  readModule: vi.fn(),
  refreshModules: vi.fn(),
}))

vi.mock('../../ts/storage/database.svelte', async (importActual) => {
  const actual = await importActual<typeof import('../../ts/storage/database.svelte')>()
  return {
    ...actual,
    changeToPreset: presetSpies.changeToPreset,
    copyPreset: presetSpies.copyPreset,
    createPreset: presetSpies.createPreset,
    deletePreset: presetSpies.deletePreset,
    downloadPreset: presetSpies.downloadPreset,
    importPreset: presetSpies.importPreset,
    reorderPresets: presetSpies.reorderPresets,
    updatePreset: presetSpies.updatePreset,
  }
})

vi.mock('src/ts/persona', async (importActual) => {
  const actual = await importActual<typeof import('src/ts/persona')>()
  return {
    ...actual,
    changeUserPersona: personaSpies.changeUserPersona,
  }
})

vi.mock('src/ts/storage/fastifyStorage', () => ({
  getNodeServerProxyAuth: async () => 'picker-generation-settings-token',
}))

vi.mock('src/ts/process/modules', () => moduleSpies)

import Botpreset from './botpreset.svelte'
import ListedPersona from './listedPersona.svelte'
import { clearCachedServerCommandRevision, type ServerCommandResult } from 'src/ts/server/commands'
import { setServerProjectionWriteGuardEnabled } from 'src/ts/server/projectionWriteGuard.svelte'
import { DBState, selectedCharID, type GenerationSettingsPickerMode } from 'src/ts/stores.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

interface CapturedFetch {
  url: string
  method: string
  authHeader: string | null
  body: unknown
}

interface StubCommandFetchOptions {
  promptSelectConflictOnce?: boolean
}

let target: HTMLElement
let component: MountedComponent | undefined

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function stubCommandFetch(options: StubCommandFetchOptions = {}): CapturedFetch[] {
  const calls: CapturedFetch[] = []
  let promptSelectAttempts = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const headers = init.headers as Record<string, string> | undefined
      const url = String(input)
      calls.push({
        url,
        method: init.method ?? 'GET',
        authHeader: headers?.['risu-auth'] ?? null,
        body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
      })

      if (url === '/api/v1/bootstrap') return jsonResponse({ revision: 200 })
      if (url.endsWith('/prompt-presets/select')) {
        promptSelectAttempts += 1
        if (options.promptSelectConflictOnce && promptSelectAttempts === 1) {
          return jsonResponse({ error: 'revision_conflict', currentRevision: 201 }, 409)
        }
        return jsonResponse({
          status: 'ok',
          revision: options.promptSelectConflictOnce ? 202 : 201,
          event: {
            type: 'promptPreset.selected',
            revision: options.promptSelectConflictOnce ? 202 : 201,
            resource: 'promptPreset',
            id: 'preset-b',
          },
          promptPresetId: 'preset-b',
        })
      }
      if (url.endsWith('/generation-settings')) {
        return jsonResponse({
          status: 'ok',
          revision: 201,
          event: {
            type: 'chat.updated',
            revision: 201,
            resource: 'characterRow',
            id: 'chat-a',
          },
          chatId: 'chat-a',
        } satisfies ServerCommandResult<{ chatId: string }> & Record<string, unknown>)
      }
      return jsonResponse({ error: `unexpected ${url}` }, 404)
    }) as unknown as typeof fetch,
  )
  return calls
}

async function waitForFetchCount(calls: CapturedFetch[], count: number): Promise<void> {
  for (let attempt = 0; attempt < 20 && calls.length < count; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  expect(calls).toHaveLength(count)
}

async function waitForCommandFetches(calls: CapturedFetch[]): Promise<void> {
  await waitForFetchCount(calls, 2)
}

function seedDb(): void {
  selectedCharID.set(0)
  DBState.db = {
    modelPresetsId: 0,
    modelPresets: [
      {
        id: 'model-preset-a',
        name: 'Model Preset A',
      },
    ],
    promptPresetsId: 0,
    promptPresets: [
      {
        id: 'preset-a',
        name: 'Preset A',
        mainPrompt: '',
        jailbreak: '',
        globalNote: '',
        temperature: 0,
        maxContext: 0,
        maxResponse: 0,
        frequencyPenalty: 0,
        PresensePenalty: 0,
        formatingOrder: [],
        promptPreprocess: false,
        bias: [],
        ooba: {},
        ainconfig: {},
        customPromptTemplateToggle: '',
      },
      {
        id: 'preset-b',
        name: 'Preset B',
        mainPrompt: '',
        jailbreak: '',
        globalNote: '',
        temperature: 0,
        maxContext: 0,
        maxResponse: 0,
        frequencyPenalty: 0,
        PresensePenalty: 0,
        formatingOrder: [],
        promptPreprocess: false,
        bias: [],
        ooba: {},
        ainconfig: {},
        customPromptTemplateToggle: '',
      },
    ],
    selectedPersona: 0,
    personas: [
      {
        id: 'persona-a',
        name: 'Persona A',
        personaPrompt: 'Persona A prompt',
        icon: '',
        note: 'A note',
      },
      {
        id: 'persona-b',
        name: 'Persona B',
        personaPrompt: 'Persona B prompt',
        icon: '',
        note: 'B note',
      },
    ],
    modules: [],
    enabledModules: [],
    characters: [
      {
        chaId: 'char-a',
        name: 'Character A',
        chatPage: 0,
        chats: [
          {
            id: 'chat-a',
            name: 'Chat A',
            note: '',
            message: [],
            localLore: [],
            generationSettings: {
              configured: true,
              personaId: 'persona-b',
              modelPresetId: 'model-preset-a',
              promptPresetId: 'preset-b',
              jailbreakToggle: false,
              sidebarToggles: {},
            },
          },
        ],
      },
    ],
  } as any
}

function elementBySelector<T extends Element>(selector: string, label: string): T {
  const element = target.querySelector<T>(selector)
  expect(element, label).toBeTruthy()
  return element!
}

function pickerRoot(kind: 'model' | 'prompt' | 'persona', mode: GenerationSettingsPickerMode): HTMLElement {
  return elementBySelector<HTMLElement>(
    `[data-risu-generation-picker][data-risu-picker-kind="${kind}"][data-risu-picker-mode="${mode}"]`,
    `${kind} ${mode} picker root`,
  )
}

function pickerRow(kind: 'model' | 'prompt' | 'persona', id: string): HTMLElement {
  return elementBySelector<HTMLElement>(
    `[data-risu-generation-picker-row][data-risu-picker-kind="${kind}"][data-risu-row-id="${id}"]`,
    `${kind} row ${id}`,
  )
}

function expectPickerRowSelection(kind: 'model' | 'prompt' | 'persona', id: string, selected: boolean): void {
  const row = pickerRow(kind, id)
  expect(row.dataset.risuSelected).toBe(selected ? 'true' : 'false')
  expect(row.getAttribute('aria-current')).toBe(selected ? 'true' : null)
}

function mountPresetPicker(mode: GenerationSettingsPickerMode, close = vi.fn(), kind: 'model' | 'prompt' = 'prompt') {
  component = mount(Botpreset, {
    target,
    props: { mode, close, kind },
  })
  return close
}

function mountPersonaPicker(mode: GenerationSettingsPickerMode, close = vi.fn()) {
  component = mount(ListedPersona, {
    target,
    props: { mode, close },
  })
  return close
}

beforeEach(() => {
  target = document.createElement('div')
  document.body.appendChild(target)
  vi.clearAllMocks()
  clearCachedServerCommandRevision()
  setServerProjectionWriteGuardEnabled(false)
  seedDb()
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  target.remove()
  document.body.innerHTML = ''
  setServerProjectionWriteGuardEnabled(false)
  vi.unstubAllGlobals()
})

describe('generation settings picker mode', () => {
  it('allows Space in the prompt preset rename input', async () => {
    const close = mountPresetPicker('global')

    elementBySelector<HTMLButtonElement>('[data-risu-preset-edit]', 'prompt preset edit button').click()
    await tick()

    const input = pickerRow('prompt', 'preset-a').querySelector<HTMLInputElement>('input')
    expect(input).toBeTruthy()

    const event = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })
    input!.dispatchEvent(event)
    await tick()

    expect(event.defaultPrevented).toBe(false)
    expect(close).not.toHaveBeenCalled()
  })

  it('saves preset rows to the active chat without calling global preset selection', async () => {
    const calls = stubCommandFetch()
    const close = mountPresetPicker('active-chat-generation-settings')

    expect(pickerRoot('prompt', 'active-chat-generation-settings')).toBeTruthy()
    expect(pickerRow('prompt', 'preset-a').dataset.risuRowIndex).toBe('0')
    expect(pickerRow('prompt', 'preset-b').dataset.risuRowIndex).toBe('1')
    expectPickerRowSelection('prompt', 'preset-a', false)
    expectPickerRowSelection('prompt', 'preset-b', true)

    pickerRow('prompt', 'preset-a').click()
    await tick()
    await waitForCommandFetches(calls)

    expect(presetSpies.changeToPreset).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalledOnce()
    expect(DBState.db.characters[0].chats[0].generationSettings).toEqual({
      configured: true,
      personaId: 'persona-b',
      modelPresetId: 'model-preset-a',
      promptPresetId: 'preset-a',
      jailbreakToggle: false,
      sidebarToggles: {},
    })
    expect(calls[1]).toMatchObject({
      url: '/api/v1/commands/chats/chat-a/generation-settings',
      method: 'PUT',
      authHeader: 'picker-generation-settings-token',
      body: {
        baseRevision: 200,
        generationSettings: expect.objectContaining({
          promptPresetId: 'preset-a',
        }),
      },
    })
  })

  it('keeps global preset rows on changeToPreset in global mode', async () => {
    const calls = stubCommandFetch()
    const close = mountPresetPicker('global')

    expect(pickerRoot('prompt', 'global')).toBeTruthy()
    expectPickerRowSelection('prompt', 'preset-a', true)
    expectPickerRowSelection('prompt', 'preset-b', false)

    pickerRow('prompt', 'preset-b').click()
    await tick()
    await waitForCommandFetches(calls)

    expect(close).toHaveBeenCalledOnce()
    expect(DBState.db.promptPresetsId).toBe(1)
    expect(DBState.db.characters[0].chats[0].generationSettings?.promptPresetId).toBe('preset-b')
    expect(calls[1]).toMatchObject({
      url: '/api/v1/commands/prompt-presets/select',
      method: 'POST',
      authHeader: 'picker-generation-settings-token',
      body: {
        baseRevision: 200,
        promptPresetId: 'preset-b',
      },
    })
  })

  it('retries global prompt preset selection once after a revision conflict', async () => {
    const calls = stubCommandFetch({ promptSelectConflictOnce: true })
    const close = mountPresetPicker('global')

    pickerRow('prompt', 'preset-b').click()
    await tick()
    await waitForFetchCount(calls, 3)

    expect(close).toHaveBeenCalledOnce()
    expect(DBState.db.promptPresetsId).toBe(1)
    const selectCalls = calls.filter((call) => call.url.endsWith('/prompt-presets/select'))
    expect(selectCalls).toHaveLength(2)
    expect(selectCalls[0].body).toMatchObject({
      baseRevision: 200,
      promptPresetId: 'preset-b',
    })
    expect(selectCalls[1].body).toMatchObject({
      baseRevision: 201,
      promptPresetId: 'preset-b',
    })
  })

  it('does not retry a stale prompt preset selection after a newer selection wins', async () => {
    DBState.db.promptPresets.push({
      id: 'preset-c',
      name: 'Preset C',
      mainPrompt: '',
      jailbreak: '',
      globalNote: '',
      temperature: 0,
      maxContext: 0,
      maxResponse: 0,
      frequencyPenalty: 0,
      PresensePenalty: 0,
      formatingOrder: [],
      promptPreprocess: false,
      bias: [],
      ooba: {},
      ainconfig: {},
      customPromptTemplateToggle: '',
    } as any)

    const calls: CapturedFetch[] = []
    let resolvePresetBConflict: (response: Response) => void = () => {}
    const presetBConflict = new Promise<Response>((resolve) => {
      resolvePresetBConflict = resolve
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const headers = init.headers as Record<string, string> | undefined
        const url = String(input)
        const body = typeof init.body === 'string' ? JSON.parse(init.body) : null
        calls.push({
          url,
          method: init.method ?? 'GET',
          authHeader: headers?.['risu-auth'] ?? null,
          body,
        })

        if (url === '/api/v1/bootstrap') return jsonResponse({ revision: 200 })
        if (url.endsWith('/prompt-presets/select') && body?.promptPresetId === 'preset-b') {
          return presetBConflict
        }
        if (url.endsWith('/prompt-presets/select') && body?.promptPresetId === 'preset-c') {
          return jsonResponse({
            status: 'ok',
            revision: 201,
            event: {
              type: 'promptPreset.selected',
              revision: 201,
              resource: 'promptPreset',
              id: 'preset-c',
            },
            promptPresetId: 'preset-c',
          })
        }
        return jsonResponse({ error: `unexpected ${url}` }, 404)
      }) as unknown as typeof fetch,
    )

    mountPresetPicker('global')
    pickerRow('prompt', 'preset-b').click()
    await tick()
    await waitForFetchCount(calls, 2)

    pickerRow('prompt', 'preset-c').click()
    await tick()
    await waitForFetchCount(calls, 3)
    expect(DBState.db.promptPresetsId).toBe(2)

    resolvePresetBConflict(jsonResponse({ error: 'revision_conflict', currentRevision: 201 }, 409))
    await Promise.resolve()
    await Promise.resolve()
    await tick()

    const selectCalls = calls.filter((call) => call.url.endsWith('/prompt-presets/select'))
    expect(selectCalls.map((call) => (call.body as { promptPresetId?: string }).promptPresetId)).toEqual([
      'preset-b',
      'preset-c',
    ])
    expect(DBState.db.promptPresetsId).toBe(2)
  })

  it('saves persona rows to the active chat without calling global persona selection', async () => {
    const calls = stubCommandFetch()
    const close = mountPersonaPicker('active-chat-generation-settings')

    expect(pickerRoot('persona', 'active-chat-generation-settings')).toBeTruthy()
    expect(pickerRow('persona', 'persona-a').dataset.risuRowIndex).toBe('0')
    expect(pickerRow('persona', 'persona-b').dataset.risuRowIndex).toBe('1')
    expectPickerRowSelection('persona', 'persona-a', false)
    expectPickerRowSelection('persona', 'persona-b', true)

    pickerRow('persona', 'persona-a').click()
    await tick()
    await waitForCommandFetches(calls)

    expect(personaSpies.changeUserPersona).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalledOnce()
    expect(DBState.db.characters[0].chats[0].generationSettings).toEqual({
      configured: true,
      personaId: 'persona-a',
      modelPresetId: 'model-preset-a',
      promptPresetId: 'preset-b',
      jailbreakToggle: false,
      sidebarToggles: {},
    })
    expect(calls[1]).toMatchObject({
      url: '/api/v1/commands/chats/chat-a/generation-settings',
      method: 'PUT',
      authHeader: 'picker-generation-settings-token',
      body: {
        baseRevision: 200,
        generationSettings: expect.objectContaining({
          personaId: 'persona-a',
        }),
      },
    })
  })

  it('keeps global persona rows on changeUserPersona in global mode', async () => {
    const calls = stubCommandFetch()
    const close = mountPersonaPicker('global')

    expect(pickerRoot('persona', 'global')).toBeTruthy()
    expectPickerRowSelection('persona', 'persona-a', true)
    expectPickerRowSelection('persona', 'persona-b', false)

    pickerRow('persona', 'persona-b').click()
    await tick()

    expect(personaSpies.changeUserPersona).toHaveBeenCalledWith(1)
    expect(close).toHaveBeenCalledOnce()
    expect(DBState.db.characters[0].chats[0].generationSettings?.personaId).toBe('persona-b')
    expect(calls).toEqual([])
  })
})
