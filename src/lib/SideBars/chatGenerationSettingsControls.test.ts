import { get } from 'svelte/store'
import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('src/ts/storage/fastifyStorage', () => ({
  getNodeServerProxyAuth: async () => 'sidebar-generation-settings-token',
}))

vi.mock('src/ts/process/modules', () => ({
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

vi.mock('src/ts/process/scripts', () => ({
  resetScriptCache: vi.fn(),
}))

vi.mock('src/ts/characterCommands', () => ({
  setCharacterSupaMemory: vi.fn(),
}))

vi.mock('src/ts/setting/utils', () => ({
  getFullSettingsData: () => [],
}))

import Toggles from './Toggles.svelte'
import GenerationSettingsPickerHost from './GenerationSettingsPickerHost.testHarness.svelte'
import {
  closePersonaListModal,
  closePresetListModal,
  DBState,
  openPersonaList,
  openPresetList,
  personaListModalStore,
  presetListModalStore,
  selectedCharID,
  type GenerationSettingsPickerMode,
} from 'src/ts/stores.svelte'
import { resolveActiveChatGenerationSettings } from 'src/ts/activeChatGenerationSettings'
import { clearCachedServerCommandRevision, type ServerCommandResult } from 'src/ts/server/commands'

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
  let revision = 300
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

      if (url === '/api/v1/bootstrap') return jsonResponse({ revision })
      if (url.endsWith('/generation-settings')) {
        revision += 1
        return jsonResponse({
          revision,
          event: {
            type: 'chat.updated',
            revision,
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

async function waitForFetchCount(calls: CapturedFetch[], expected: number): Promise<void> {
  for (let attempt = 0; attempt < 20 && calls.length < expected; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  expect(calls).toHaveLength(expected)
}

function seedDb(): void {
  selectedCharID.set(0)
  DBState.db = {
    username: 'Global User',
    selectedPersona: 0,
    botPresetsId: 0,
    jailbreakToggle: true,
    globalChatVariables: {
      toggle_flag: 'global-flag',
      toggle_mood: 'global-mood',
      toggle_note: 'global-note',
    },
    customPromptTemplateToggle: 'legacy=Legacy Toggle',
    customSidebarItems: [
      { id: 'preset-control', type: 'preset', subType: '', label: '' },
      { id: 'persona-control', type: 'persona', subType: '', label: '' },
    ],
    lastLoadedLoadoutName: '',
    hypaV3: false,
    personas: [
      {
        id: 'persona-a',
        name: 'Persona Alpha',
        personaPrompt: '',
        icon: '',
        note: '',
      },
      {
        id: 'persona-b',
        name: 'Persona Beta',
        personaPrompt: '',
        icon: '',
        note: '',
      },
    ],
    botPresets: [
      {
        id: 'preset-a',
        name: 'Preset Alpha',
        jailbreak: 'Jailbreak',
        customPromptTemplateToggle: 'mood=Mood=select=Calm,Spicy\nflag=Flag\nnote=Note=text',
      },
      {
        id: 'preset-b',
        name: 'Preset Beta',
        jailbreak: 'Jailbreak',
        customPromptTemplateToggle: 'mood=Mood=select=Calm,Spicy\nflag=Flag\nnote=Note=text',
      },
    ],
    modules: [{ id: 'module-a', customModuleToggle: 'moduleFlag=Module Flag' }],
    enabledModules: ['module-a'],
    characters: [
      {
        chaId: 'char-a',
        name: 'Character Alpha',
        chatPage: 0,
        chats: [
          {
            id: 'chat-a',
            name: 'Chat Alpha',
            note: '',
            message: [],
            localLore: [],
            generationSettings: {
              configured: true,
              personaId: 'persona-a',
              presetId: 'preset-a',
              jailbreakToggle: true,
              sidebarToggles: {
                mood: '1',
                flag: '1',
                note: 'alpha-note',
                moduleFlag: '1',
              },
            },
          },
          {
            id: 'chat-b',
            name: 'Chat Beta',
            note: '',
            message: [],
            localLore: [],
            generationSettings: {
              configured: true,
              personaId: 'persona-b',
              presetId: 'preset-b',
              jailbreakToggle: false,
              sidebarToggles: {
                mood: '0',
                flag: '0',
                note: 'beta-note',
                moduleFlag: '0',
              },
            },
          },
        ],
      },
    ],
  } as never
}

function mountToggles(): void {
  component = mount(Toggles, {
    target,
    props: {
      chara: DBState.db.characters[0],
      noContainer: true,
    },
  })
}

function mountGenerationSettingsPickerHost(): void {
  component = mount(GenerationSettingsPickerHost, { target })
}

function elementBySelector<T extends Element>(selector: string, label: string): T {
  const element = target.querySelector<T>(selector)
  expect(element, label).toBeTruthy()
  return element!
}

function pickerControl(kind: 'preset' | 'persona'): HTMLElement {
  return elementBySelector<HTMLElement>(
    `[data-risu-generation-picker-control][data-risu-picker-kind="${kind}"]`,
    `${kind} picker control`,
  )
}

function pickerButton(kind: 'preset' | 'persona'): HTMLButtonElement {
  const input = pickerControl(kind).querySelector<HTMLButtonElement>('button')
  expect(input, `${kind} picker button`).toBeTruthy()
  return input!
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
    `${kind} picker row ${id}`,
  )
}

function toggleControl(key: string): HTMLElement {
  return elementBySelector<HTMLElement>(
    `[data-risu-generation-toggle-control][data-risu-toggle-key="${key}"]`,
    `${key} toggle control`,
  )
}

function jailbreakControl(): HTMLElement {
  return elementBySelector<HTMLElement>(
    '[data-risu-generation-jailbreak-control]',
    'jailbreak toggle control',
  )
}

function checkboxWithin(container: HTMLElement, label: string): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>('input[type="checkbox"]')
  expect(input, `${label} checkbox`).toBeTruthy()
  return input!
}

function toggleCheckbox(key: string): HTMLInputElement {
  const control = toggleControl(key)
  expect(control.dataset.risuInputKind).toBe('checkbox')
  return checkboxWithin(control, key)
}

function jailbreakCheckbox(): HTMLInputElement {
  const control = jailbreakControl()
  expect(control.dataset.risuInputKind).toBe('checkbox')
  return checkboxWithin(control, 'jailbreak')
}

function textToggleInput(key: string): HTMLInputElement {
  const control = toggleControl(key)
  expect(control.dataset.risuInputKind).toBe('text')
  const input = control.querySelector<HTMLInputElement>('input[type="text"]')
  expect(input, `${key} text toggle input`).toBeTruthy()
  return input!
}

function selectToggleInput(key: string): HTMLSelectElement {
  const control = toggleControl(key)
  expect(control.dataset.risuInputKind).toBe('select')
  const select = control.querySelector<HTMLSelectElement>('select')
  expect(select, `${key} select toggle input`).toBeTruthy()
  return select!
}

function activeChat() {
  const character = DBState.db.characters[0]
  return character.chats[character.chatPage]
}

beforeEach(() => {
  target = document.createElement('div')
  document.body.appendChild(target)
  clearCachedServerCommandRevision()
  seedDb()
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  closePresetListModal()
  closePersonaListModal()
  target.remove()
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  selectedCharID.set(-1)
  DBState.db = {} as never
})

describe('sidebar chat generation settings controls', () => {
  it('shows clear chat setup labels when preset and persona are not configured', async () => {
    DBState.db.characters[0].chats[0].generationSettings = {
      configured: false,
      jailbreakToggle: false,
      sidebarToggles: {},
    }

    mountToggles()
    await tick()

    expect(pickerControl('preset').dataset.risuPickerMode).toBe('active-chat-generation-settings')
    expect(pickerControl('preset').textContent).toContain('Select chat preset')
    expect(pickerControl('persona').dataset.risuPickerMode).toBe('active-chat-generation-settings')
    expect(pickerControl('persona').textContent).toContain('Select chat persona')
  })

  it('remediates a prefilled incomplete chat through visible generation-settings controls', async () => {
    const calls = stubCommandFetch()
    activeChat().generationSettings = {
      configured: false,
      personaId: 'persona-a',
      presetId: 'preset-a',
      jailbreakToggle: true,
      sidebarToggles: {
        mood: '1',
        flag: '1',
        note: 'imported-note',
        moduleFlag: '1',
      },
    }

    mountToggles()
    await tick()

    expect(resolveActiveChatGenerationSettings().readiness.ready).toBe(false)
    expect(resolveActiveChatGenerationSettings().missingLabels).toEqual([
      'Configuration confirmation',
    ])
    expect(pickerControl('preset').dataset.risuPickerSelectedId).toBe('preset-a')
    expect(pickerControl('preset').textContent).toContain('Preset Alpha')
    expect(pickerControl('persona').dataset.risuPickerSelectedId).toBe('persona-a')
    expect(pickerControl('persona').textContent).toContain('Persona Alpha')
    expect(selectToggleInput('mood').value).toBe('1')
    expect(textToggleInput('note').value).toBe('imported-note')
    expect(toggleCheckbox('flag').checked).toBe(true)
    expect(jailbreakControl().dataset.risuSelected).toBe('true')

    jailbreakCheckbox().click()
    await tick()
    await waitForFetchCount(calls, 2)

    expect(activeChat().generationSettings).toMatchObject({
      configured: true,
      personaId: 'persona-a',
      presetId: 'preset-a',
      jailbreakToggle: false,
      sidebarToggles: {
        mood: '1',
        flag: '1',
        note: 'imported-note',
        moduleFlag: '1',
      },
    })
    expect(resolveActiveChatGenerationSettings().readiness.ready).toBe(true)
    expect(pickerControl('preset').dataset.risuPickerSelectedId).toBe('preset-a')
    expect(pickerControl('preset').textContent).toContain('Preset Alpha')
    expect(pickerControl('persona').dataset.risuPickerSelectedId).toBe('persona-a')
    expect(pickerControl('persona').textContent).toContain('Persona Alpha')
    expect(jailbreakControl().dataset.risuSelected).toBe('false')
    expect(target.textContent).not.toContain('Select chat preset')
    expect(target.textContent).not.toContain('Select chat persona')
    expect(calls[1]).toMatchObject({
      url: '/api/v1/commands/chats/chat-a/generation-settings',
      method: 'PUT',
      authHeader: 'sidebar-generation-settings-token',
      body: {
        baseRevision: 300,
        generationSettings: expect.objectContaining({
          configured: true,
          personaId: 'persona-a',
          presetId: 'preset-a',
          jailbreakToggle: false,
        }),
      },
    })
  })

  it('renders preset, persona, and toggle values from the active chat while switching chats', async () => {
    mountToggles()
    await tick()

    expect(pickerControl('preset').dataset.risuPickerSelectedId).toBe('preset-a')
    expect(pickerControl('preset').textContent).toContain('Preset Alpha')
    expect(pickerControl('persona').dataset.risuPickerSelectedId).toBe('persona-a')
    expect(pickerControl('persona').textContent).toContain('Persona Alpha')
    expect(selectToggleInput('mood').value).toBe('1')
    expect(textToggleInput('note').value).toBe('alpha-note')
    expect(toggleCheckbox('flag').checked).toBe(true)
    expect(toggleControl('flag').dataset.risuSelected).toBe('true')
    expect(toggleCheckbox('moduleFlag').checked).toBe(true)
    expect(toggleControl('moduleFlag').dataset.risuSelected).toBe('true')
    expect(target.textContent).not.toContain('Legacy Toggle')

    DBState.db.characters[0].chatPage = 1
    await tick()

    expect(pickerControl('preset').dataset.risuPickerSelectedId).toBe('preset-b')
    expect(pickerControl('preset').textContent).toContain('Preset Beta')
    expect(pickerControl('persona').dataset.risuPickerSelectedId).toBe('persona-b')
    expect(pickerControl('persona').textContent).toContain('Persona Beta')
    expect(selectToggleInput('mood').value).toBe('0')
    expect(textToggleInput('note').value).toBe('beta-note')
    expect(toggleCheckbox('flag').checked).toBe(false)
    expect(toggleControl('flag').dataset.risuSelected).toBe('false')
    expect(toggleCheckbox('moduleFlag').checked).toBe(false)
    expect(toggleControl('moduleFlag').dataset.risuSelected).toBe('false')
  })

  it('opens preset and persona pickers in active-chat generation-settings mode', async () => {
    mountToggles()
    await tick()

    pickerButton('preset').click()
    await tick()

    expect(get(openPresetList)).toBe(true)
    expect(presetListModalStore.mode).toBe('active-chat-generation-settings')

    closePresetListModal()
    await tick()

    pickerButton('persona').click()
    await tick()

    expect(get(openPersonaList)).toBe(true)
    expect(personaListModalStore.mode).toBe('active-chat-generation-settings')
  })

  it('selects preset and persona through composed sidebar pickers without retargeting globals', async () => {
    const calls = stubCommandFetch()
    activeChat().generationSettings = {
      configured: false,
      jailbreakToggle: true,
      sidebarToggles: {
        mood: '1',
        flag: '1',
        note: 'ready-note',
        moduleFlag: '1',
      },
    }

    mountGenerationSettingsPickerHost()
    await tick()

    expect(resolveActiveChatGenerationSettings().readiness.ready).toBe(false)
    expect(pickerControl('preset').dataset.risuPickerSelectedId).toBe('')
    expect(pickerControl('preset').textContent).toContain('Select chat preset')
    expect(pickerControl('persona').dataset.risuPickerSelectedId).toBe('')
    expect(pickerControl('persona').textContent).toContain('Select chat persona')

    pickerButton('preset').click()
    await tick()

    expect(get(openPresetList)).toBe(true)
    expect(presetListModalStore.mode).toBe('active-chat-generation-settings')
    expect(pickerRoot('preset', 'active-chat-generation-settings')).toBeTruthy()
    expect(pickerRow('preset', 'preset-b').textContent).toContain('Preset Beta')
    expect(pickerRow('preset', 'preset-b').dataset.risuSelected).toBe('false')

    pickerRow('preset', 'preset-b').click()
    await tick()
    await waitForFetchCount(calls, 2)

    expect(get(openPresetList)).toBe(false)
    expect(activeChat().generationSettings?.presetId).toBe('preset-b')
    expect(activeChat().generationSettings?.personaId).toBeUndefined()
    expect(DBState.db.botPresetsId).toBe(0)
    expect(DBState.db.selectedPersona).toBe(0)
    expect(pickerControl('preset').dataset.risuPickerSelectedId).toBe('preset-b')
    expect(pickerControl('preset').textContent).toContain('Preset Beta')
    expect(pickerControl('persona').textContent).toContain('Select chat persona')

    pickerButton('persona').click()
    await tick()

    expect(get(openPersonaList)).toBe(true)
    expect(personaListModalStore.mode).toBe('active-chat-generation-settings')
    expect(pickerRoot('persona', 'active-chat-generation-settings')).toBeTruthy()
    expect(pickerRow('persona', 'persona-b').textContent).toContain('Persona Beta')
    expect(pickerRow('persona', 'persona-b').dataset.risuSelected).toBe('false')

    pickerRow('persona', 'persona-b').click()
    await tick()
    await waitForFetchCount(calls, 3)

    expect(get(openPersonaList)).toBe(false)
    expect(activeChat().generationSettings).toMatchObject({
      configured: true,
      presetId: 'preset-b',
      personaId: 'persona-b',
      jailbreakToggle: true,
      sidebarToggles: {
        mood: '1',
        flag: '1',
        note: 'ready-note',
        moduleFlag: '1',
      },
    })
    expect(resolveActiveChatGenerationSettings().readiness.ready).toBe(true)
    expect(DBState.db.botPresetsId).toBe(0)
    expect(DBState.db.selectedPersona).toBe(0)
    expect(pickerControl('preset').dataset.risuPickerSelectedId).toBe('preset-b')
    expect(pickerControl('preset').textContent).toContain('Preset Beta')
    expect(pickerControl('persona').dataset.risuPickerSelectedId).toBe('persona-b')
    expect(pickerControl('persona').textContent).toContain('Persona Beta')
    expect(target.textContent).not.toContain('Select chat preset')
    expect(target.textContent).not.toContain('Select chat persona')
    expect(calls[1]).toMatchObject({
      url: '/api/v1/commands/chats/chat-a/generation-settings',
      method: 'PUT',
      authHeader: 'sidebar-generation-settings-token',
      body: {
        baseRevision: 300,
        generationSettings: expect.objectContaining({
          configured: true,
          presetId: 'preset-b',
        }),
      },
    })
    expect(calls[2]).toMatchObject({
      url: '/api/v1/commands/chats/chat-a/generation-settings',
      method: 'PUT',
      authHeader: 'sidebar-generation-settings-token',
      body: {
        baseRevision: 301,
        generationSettings: expect.objectContaining({
          configured: true,
          presetId: 'preset-b',
          personaId: 'persona-b',
        }),
      },
    })
  })

  it('writes jailbreak and sidebar toggles to active chat settings without touching global state', async () => {
    const calls = stubCommandFetch()
    mountToggles()
    await tick()

    jailbreakCheckbox().click()
    await tick()
    await waitForFetchCount(calls, 2)

    expect(activeChat().generationSettings?.jailbreakToggle).toBe(false)
    expect(jailbreakControl().dataset.risuSelected).toBe('false')
    expect(DBState.db.jailbreakToggle).toBe(true)

    toggleCheckbox('flag').click()
    await tick()
    await waitForFetchCount(calls, 3)

    expect(activeChat().generationSettings?.sidebarToggles?.flag).toBe('0')
    expect(toggleControl('flag').dataset.risuSelected).toBe('false')
    expect(DBState.db.globalChatVariables.toggle_flag).toBe('global-flag')

    const moodSelect = selectToggleInput('mood')
    moodSelect.value = '0'
    moodSelect.dispatchEvent(new Event('change', { bubbles: true }))
    await tick()
    await waitForFetchCount(calls, 4)

    expect(activeChat().generationSettings?.sidebarToggles?.mood).toBe('0')
    expect(DBState.db.globalChatVariables.toggle_mood).toBe('global-mood')

    const noteInput = textToggleInput('note')
    noteInput.value = 'updated-note'
    noteInput.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()
    await waitForFetchCount(calls, 5)

    expect(activeChat().generationSettings?.sidebarToggles?.note).toBe('updated-note')
    expect(DBState.db.globalChatVariables.toggle_note).toBe('global-note')
  })
})
