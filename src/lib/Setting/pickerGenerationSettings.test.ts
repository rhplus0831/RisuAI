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

let target: HTMLElement
let component: MountedComponent | undefined

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function stubCommandFetch(): CapturedFetch[] {
  const calls: CapturedFetch[] = []
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
      if (url.endsWith('/generation-settings')) {
        return jsonResponse({
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

async function waitForCommandFetches(calls: CapturedFetch[]): Promise<void> {
  for (let attempt = 0; attempt < 20 && calls.length < 2; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  expect(calls).toHaveLength(2)
}

function seedDb(): void {
  selectedCharID.set(0)
  DBState.db = {
    botPresetsId: 0,
    botPresets: [
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
              presetId: 'preset-b',
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

function pickerRoot(kind: 'preset' | 'persona', mode: GenerationSettingsPickerMode): HTMLElement {
  return elementBySelector<HTMLElement>(
    `[data-risu-generation-picker][data-risu-picker-kind="${kind}"][data-risu-picker-mode="${mode}"]`,
    `${kind} ${mode} picker root`,
  )
}

function pickerRow(kind: 'preset' | 'persona', id: string): HTMLButtonElement {
  return elementBySelector<HTMLButtonElement>(
    `button[data-risu-generation-picker-row][data-risu-picker-kind="${kind}"][data-risu-row-id="${id}"]`,
    `${kind} row ${id}`,
  )
}

function expectPickerRowSelection(
  kind: 'preset' | 'persona',
  id: string,
  selected: boolean,
): void {
  const row = pickerRow(kind, id)
  expect(row.dataset.risuSelected).toBe(selected ? 'true' : 'false')
  expect(row.getAttribute('aria-current')).toBe(selected ? 'true' : null)
}

function mountPresetPicker(mode: GenerationSettingsPickerMode, close = vi.fn()) {
  component = mount(Botpreset, {
    target,
    props: { mode, close },
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
  it('saves preset rows to the active chat without calling global preset selection', async () => {
    const calls = stubCommandFetch()
    const close = mountPresetPicker('active-chat-generation-settings')

    expect(pickerRoot('preset', 'active-chat-generation-settings')).toBeTruthy()
    expect(pickerRow('preset', 'preset-a').dataset.risuRowIndex).toBe('0')
    expect(pickerRow('preset', 'preset-b').dataset.risuRowIndex).toBe('1')
    expectPickerRowSelection('preset', 'preset-a', false)
    expectPickerRowSelection('preset', 'preset-b', true)

    pickerRow('preset', 'preset-a').click()
    await tick()
    await waitForCommandFetches(calls)

    expect(presetSpies.changeToPreset).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalledOnce()
    expect(DBState.db.characters[0].chats[0].generationSettings).toEqual({
      configured: true,
      personaId: 'persona-b',
      presetId: 'preset-a',
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
          presetId: 'preset-a',
        }),
      },
    })
  })

  it('keeps global preset rows on changeToPreset in global mode', async () => {
    const calls = stubCommandFetch()
    const close = mountPresetPicker('global')

    expect(pickerRoot('preset', 'global')).toBeTruthy()
    expectPickerRowSelection('preset', 'preset-a', true)
    expectPickerRowSelection('preset', 'preset-b', false)

    pickerRow('preset', 'preset-b').click()
    await tick()

    expect(presetSpies.changeToPreset).toHaveBeenCalledWith(1)
    expect(close).toHaveBeenCalledOnce()
    expect(DBState.db.characters[0].chats[0].generationSettings?.presetId).toBe('preset-b')
    expect(calls).toEqual([])
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
      presetId: 'preset-b',
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
