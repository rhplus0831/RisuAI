import { get } from 'svelte/store'
import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const alertSpies = vi.hoisted(() => ({
  alertConfirm: vi.fn(async () => false),
  alertInput: vi.fn(async () => ''),
  alertSelect: vi.fn(async () => '2'),
}))

vi.mock('src/ts/alert', async (importActual) => {
  const actual = await importActual<typeof import('src/ts/alert')>()
  return {
    ...actual,
    alertConfirm: alertSpies.alertConfirm,
    alertInput: alertSpies.alertInput,
    alertSelect: alertSpies.alertSelect,
  }
})

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
import { mergeServerProjectionCharacterRow } from 'src/ts/storage/database.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

interface CapturedFetch {
  url: string
  method: string
  authHeader: string | null
  body: unknown
}

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
}

let target: HTMLElement
let component: MountedComponent | undefined

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function clonePlain<T>(value: T): T {
  if (value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
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
      if (url === '/api/v1/commands/settings/sidebar') {
        revision += 1
        return jsonResponse({
          status: 'ok',
          revision,
          event: {
            type: 'settings.updated',
            revision,
            resource: 'settings',
          },
        } satisfies ServerCommandResult & Record<string, unknown>)
      }
      if (url.endsWith('/generation-settings')) {
        revision += 1
        return jsonResponse({
          status: 'ok',
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

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {
    throw new Error('deferred promise resolved before initialization')
  }
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await tick()
}

function stubDeferredFailedGenerationSettingsFetch(): {
  calls: CapturedFetch[]
  failGenerationSettingsSave: () => void
} {
  const calls: CapturedFetch[] = []
  let completeGenerationSettingsSave: () => void = () => {
    throw new Error('generation settings save was not requested')
  }

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

      if (url === '/api/v1/bootstrap') return jsonResponse({ revision: 300 })
      if (url.endsWith('/generation-settings')) {
        return new Promise<Response>((resolve) => {
          completeGenerationSettingsSave = () => {
            resolve(jsonResponse({ error: 'forced rollback' }, 500))
          }
        })
      }
      return jsonResponse({ error: `unexpected ${url}` }, 404)
    }) as unknown as typeof fetch,
  )

  return {
    calls,
    failGenerationSettingsSave: () => completeGenerationSettingsSave(),
  }
}

async function waitForFetchCount(calls: CapturedFetch[], expected: number): Promise<void> {
  for (let attempt = 0; attempt < 20 && calls.length < expected; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  expect(calls).toHaveLength(expected)
}

function generationSettingsSaves(calls: CapturedFetch[]): CapturedFetch[] {
  return calls.filter((call) => call.url.endsWith('/generation-settings'))
}

async function waitForGenerationSettingsSaveCount(calls: CapturedFetch[], expected: number): Promise<void> {
  for (let attempt = 0; attempt < 20 && generationSettingsSaves(calls).length < expected; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  expect(generationSettingsSaves(calls).length).toBeGreaterThanOrEqual(expected)
}

function seedDb(): void {
  selectedCharID.set(0)
  DBState.db = {
    username: 'Global User',
    selectedPersona: 0,
    modelPresetsId: 0,
    promptPresetsId: 0,
    jailbreakToggle: true,
    globalChatVariables: {
      toggle_flag: 'global-flag',
      toggle_mood: 'global-mood',
      toggle_note: 'global-note',
    },
    customPromptTemplateToggle: 'legacy=Legacy Toggle',
    customSidebarItems: [],
    chatGenerationTogglePresets: [],
    lastLoadedLoadoutName: '',
    hypaV3: false,
    personas: [
      {
        id: 'persona-a',
        name: 'Persona Alpha',
        personaPrompt: '',
        icon: '',
        note: 'Alpha persona note',
      },
      {
        id: 'persona-b',
        name: 'Persona Beta',
        personaPrompt: '',
        icon: '',
        note: 'Beta persona note\nsecond line',
      },
    ],
    modelPresets: [{ id: 'model-preset-a', name: 'Model Prompt preset Alpha' }],
    promptPresets: [
      {
        id: 'preset-a',
        name: 'Prompt preset Alpha',
        jailbreak: 'Jailbreak',
        customPromptTemplateToggle: 'mood=Mood=select=Calm,Spicy\nflag=Flag\nnote=Note=text',
      },
      {
        id: 'preset-b',
        name: 'Prompt preset Beta',
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
              modelPresetId: 'model-preset-a',
              promptPresetId: 'preset-a',
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
              modelPresetId: 'model-preset-a',
              promptPresetId: 'preset-b',
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

function pickerControl(kind: 'model' | 'prompt' | 'persona'): HTMLElement {
  return elementBySelector<HTMLElement>(
    `[data-risu-generation-picker-control][data-risu-picker-kind="${kind}"]`,
    `${kind} picker control`,
  )
}

function pickerButton(kind: 'model' | 'prompt' | 'persona'): HTMLButtonElement {
  const input = pickerControl(kind).querySelector<HTMLButtonElement>('button')
  expect(input, `${kind} picker button`).toBeTruthy()
  return input!
}

function personaNoteLine(): HTMLElement | null {
  return pickerControl('persona').querySelector<HTMLElement>('[data-risu-generation-picker-persona-note]')
}

function resetDefaultsButton(): HTMLButtonElement {
  return elementBySelector<HTMLButtonElement>('[data-risu-generation-reset-defaults] button', 'reset defaults button')
}

function togglePresetRoot(): HTMLElement {
  return elementBySelector<HTMLElement>('[data-risu-generation-toggle-presets]', 'toggle preset controls')
}

function togglePresetSelect(): HTMLSelectElement {
  const select = togglePresetRoot().querySelector<HTMLSelectElement>('select')
  expect(select, 'toggle preset select').toBeTruthy()
  return select!
}

function togglePresetButton(index: number): HTMLButtonElement {
  const button = togglePresetRoot().querySelectorAll<HTMLButtonElement>('button')[index]
  expect(button, `toggle preset button ${index}`).toBeTruthy()
  return button!
}

function togglePresetWarning(): HTMLElement | null {
  return togglePresetRoot().querySelector<HTMLElement>('[data-risu-generation-toggle-preset-warning]')
}

async function chooseTogglePreset(id: string): Promise<void> {
  const select = togglePresetSelect()
  select.value = id
  select.dispatchEvent(new Event('input', { bubbles: true }))
  select.dispatchEvent(new Event('change', { bubbles: true }))
  await tick()
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
  return elementBySelector<HTMLElement>('[data-risu-generation-jailbreak-control]', 'jailbreak toggle control')
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
  alertSpies.alertConfirm.mockReset()
  alertSpies.alertConfirm.mockResolvedValue(false)
  alertSpies.alertInput.mockReset()
  alertSpies.alertInput.mockResolvedValue('')
  alertSpies.alertSelect.mockReset()
  alertSpies.alertSelect.mockResolvedValue('2')
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
  it('always shows chat setup controls without custom sidebar configuration', async () => {
    DBState.db.customSidebarItems = []
    DBState.db.characters[0].chats[0].generationSettings = {
      configured: false,
      jailbreakToggle: false,
      sidebarToggles: {},
    }

    mountToggles()
    await tick()

    expect(pickerControl('prompt').textContent).toContain('Select prompt preset')
    expect(pickerControl('persona').textContent).toContain('Select chat persona')
  })

  it('does not duplicate chat setup controls from legacy custom sidebar items', async () => {
    const legacyDb = DBState.db as { customSidebarItems: unknown }
    legacyDb.customSidebarItems = [
      { id: 'preset-control', type: 'preset', subType: '', label: '' },
      { id: 'persona-control', type: 'persona', subType: '', label: '' },
    ]

    mountToggles()
    await tick()

    expect(
      target.querySelectorAll('[data-risu-generation-picker-control][data-risu-picker-kind="model"]'),
    ).toHaveLength(1)
    expect(
      target.querySelectorAll('[data-risu-generation-picker-control][data-risu-picker-kind="prompt"]'),
    ).toHaveLength(1)
    expect(
      target.querySelectorAll('[data-risu-generation-picker-control][data-risu-picker-kind="persona"]'),
    ).toHaveLength(1)
  })

  it('shows clear chat setup labels when preset and persona are not configured', async () => {
    DBState.db.characters[0].chats[0].generationSettings = {
      configured: false,
      jailbreakToggle: false,
      sidebarToggles: {},
    }

    mountToggles()
    await tick()

    expect(pickerControl('prompt').dataset.risuPickerMode).toBe('active-chat-generation-settings')
    expect(pickerControl('prompt').textContent).toContain('Select prompt preset')
    expect(pickerControl('persona').dataset.risuPickerMode).toBe('active-chat-generation-settings')
    expect(pickerControl('persona').textContent).toContain('Select chat persona')
  })

  it('keeps deleted preset and persona ids unconfigured without selecting global rows', async () => {
    const missingPresetId = 'deleted-preset'
    const missingPersonaId = 'deleted-persona'
    activeChat().generationSettings = {
      configured: true,
      personaId: missingPersonaId,
      modelPresetId: 'model-preset-a',
      promptPresetId: missingPresetId,
      jailbreakToggle: false,
      sidebarToggles: {
        moduleFlag: '1',
      },
    }

    mountGenerationSettingsPickerHost()
    await tick()

    const state = resolveActiveChatGenerationSettings()
    expect(state.persona).toBeUndefined()
    expect(state.promptPreset).toBeUndefined()
    expect(state.readiness.ready).toBe(false)
    expect(state.readiness.missing.map((reason) => reason.code)).toEqual(['persona_missing', 'prompt_preset_missing'])
    expect(state.missingLabels).toEqual(['Persona', 'Prompt preset'])
    expect(pickerControl('prompt').dataset.risuPickerSelectedId).toBe(missingPresetId)
    expect(pickerControl('prompt').textContent).toContain('Select prompt preset')
    expect(pickerControl('prompt').textContent).not.toContain('Prompt preset Alpha')
    expect(pickerControl('persona').dataset.risuPickerSelectedId).toBe(missingPersonaId)
    expect(pickerControl('persona').textContent).toContain('Select chat persona')
    expect(pickerControl('persona').textContent).not.toContain('Persona Alpha')
    expect(activeChat().generationSettings).toMatchObject({
      personaId: missingPersonaId,
      promptPresetId: missingPresetId,
    })
    expect(DBState.db.promptPresetsId).toBe(0)
    expect(DBState.db.selectedPersona).toBe(0)

    pickerButton('prompt').click()
    await tick()

    expect(get(openPresetList)).toBe(true)
    expect(presetListModalStore.mode).toBe('active-chat-generation-settings')
    expect(pickerRow('prompt', 'preset-a').dataset.risuSelected).toBe('false')
    expect(pickerRow('prompt', 'preset-a').getAttribute('aria-current')).toBeNull()
    expect(pickerRow('prompt', 'preset-b').dataset.risuSelected).toBe('false')
    expect(pickerRow('prompt', 'preset-b').getAttribute('aria-current')).toBeNull()

    closePresetListModal()
    await tick()

    pickerButton('persona').click()
    await tick()

    expect(get(openPersonaList)).toBe(true)
    expect(personaListModalStore.mode).toBe('active-chat-generation-settings')
    expect(pickerRow('persona', 'persona-a').dataset.risuSelected).toBe('false')
    expect(pickerRow('persona', 'persona-a').getAttribute('aria-current')).toBeNull()
    expect(pickerRow('persona', 'persona-b').dataset.risuSelected).toBe('false')
    expect(pickerRow('persona', 'persona-b').getAttribute('aria-current')).toBeNull()

    closePersonaListModal()
    await tick()

    expect(activeChat().generationSettings).toMatchObject({
      personaId: missingPersonaId,
      promptPresetId: missingPresetId,
    })
    expect(DBState.db.promptPresetsId).toBe(0)
    expect(DBState.db.selectedPersona).toBe(0)
  })

  it('remediates a prefilled incomplete chat through visible generation-settings controls', async () => {
    const calls = stubCommandFetch()
    activeChat().generationSettings = {
      configured: false,
      personaId: 'persona-a',
      modelPresetId: 'model-preset-a',
      promptPresetId: 'preset-a',
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
    expect(resolveActiveChatGenerationSettings().missingLabels).toEqual(['Configuration confirmation'])
    expect(pickerControl('prompt').dataset.risuPickerSelectedId).toBe('preset-a')
    expect(pickerControl('prompt').textContent).toContain('Prompt preset Alpha')
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
      promptPresetId: 'preset-a',
      jailbreakToggle: false,
      sidebarToggles: {
        mood: '1',
        flag: '1',
        note: 'imported-note',
        moduleFlag: '1',
      },
    })
    expect(resolveActiveChatGenerationSettings().readiness.ready).toBe(true)
    expect(pickerControl('prompt').dataset.risuPickerSelectedId).toBe('preset-a')
    expect(pickerControl('prompt').textContent).toContain('Prompt preset Alpha')
    expect(pickerControl('persona').dataset.risuPickerSelectedId).toBe('persona-a')
    expect(pickerControl('persona').textContent).toContain('Persona Alpha')
    expect(jailbreakControl().dataset.risuSelected).toBe('false')
    expect(target.textContent).not.toContain('Select prompt preset')
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
          promptPresetId: 'preset-a',
          jailbreakToggle: false,
        }),
      },
    })
  })

  it('restores visible active-chat controls when a generation settings save fails', async () => {
    const { calls, failGenerationSettingsSave } = stubDeferredFailedGenerationSettingsFetch()
    mountToggles()
    await tick()

    expect(pickerControl('prompt').dataset.risuPickerSelectedId).toBe('preset-a')
    expect(pickerControl('prompt').textContent).toContain('Prompt preset Alpha')
    expect(pickerControl('persona').dataset.risuPickerSelectedId).toBe('persona-a')
    expect(pickerControl('persona').textContent).toContain('Persona Alpha')
    expect(jailbreakCheckbox().checked).toBe(true)
    expect(jailbreakControl().dataset.risuSelected).toBe('true')

    jailbreakCheckbox().click()
    await tick()
    await waitForFetchCount(calls, 2)

    expect(activeChat().generationSettings?.jailbreakToggle).toBe(false)
    expect(jailbreakCheckbox().checked).toBe(false)
    expect(jailbreakControl().dataset.risuSelected).toBe('false')

    failGenerationSettingsSave()
    await vi.waitFor(() => {
      expect(activeChat().generationSettings?.jailbreakToggle).toBe(true)
    })
    await tick()

    expect(activeChat().generationSettings).toMatchObject({
      configured: true,
      personaId: 'persona-a',
      promptPresetId: 'preset-a',
      jailbreakToggle: true,
      sidebarToggles: {
        mood: '1',
        flag: '1',
        note: 'alpha-note',
        moduleFlag: '1',
      },
    })
    expect(pickerControl('prompt').dataset.risuPickerSelectedId).toBe('preset-a')
    expect(pickerControl('prompt').textContent).toContain('Prompt preset Alpha')
    expect(pickerControl('persona').dataset.risuPickerSelectedId).toBe('persona-a')
    expect(pickerControl('persona').textContent).toContain('Persona Alpha')
    expect(jailbreakCheckbox().checked).toBe(true)
    expect(jailbreakControl().dataset.risuSelected).toBe('true')
    expect(calls[1]).toMatchObject({
      url: '/api/v1/commands/chats/chat-a/generation-settings',
      method: 'PUT',
      authHeader: 'sidebar-generation-settings-token',
      body: {
        baseRevision: 300,
        generationSettings: expect.objectContaining({
          configured: true,
          personaId: 'persona-a',
          promptPresetId: 'preset-a',
          jailbreakToggle: false,
        }),
      },
    })
  })

  it('renders preset, persona, and toggle values from the active chat while switching chats', async () => {
    mountToggles()
    await tick()

    expect(pickerControl('prompt').dataset.risuPickerSelectedId).toBe('preset-a')
    expect(pickerControl('prompt').textContent).toContain('Prompt preset Alpha')
    expect(pickerControl('persona').dataset.risuPickerSelectedId).toBe('persona-a')
    expect(pickerControl('persona').textContent).toContain('Persona Alpha')
    expect(personaNoteLine()?.textContent).toBe('Alpha persona note')
    expect(selectToggleInput('mood').value).toBe('1')
    expect(textToggleInput('note').value).toBe('alpha-note')
    expect(toggleCheckbox('flag').checked).toBe(true)
    expect(toggleControl('flag').dataset.risuSelected).toBe('true')
    expect(toggleCheckbox('moduleFlag').checked).toBe(true)
    expect(toggleControl('moduleFlag').dataset.risuSelected).toBe('true')
    expect(target.textContent).not.toContain('Legacy Toggle')

    DBState.db.characters[0].chatPage = 1
    await tick()

    expect(pickerControl('prompt').dataset.risuPickerSelectedId).toBe('preset-b')
    expect(pickerControl('prompt').textContent).toContain('Prompt preset Beta')
    expect(pickerControl('persona').dataset.risuPickerSelectedId).toBe('persona-b')
    expect(pickerControl('persona').textContent).toContain('Persona Beta')
    expect(personaNoteLine()?.textContent).toBe('Beta persona note\nsecond line')
    expect(selectToggleInput('mood').value).toBe('0')
    expect(textToggleInput('note').value).toBe('beta-note')
    expect(toggleCheckbox('flag').checked).toBe(false)
    expect(toggleControl('flag').dataset.risuSelected).toBe('false')
    expect(toggleCheckbox('moduleFlag').checked).toBe(false)
    expect(toggleControl('moduleFlag').dataset.risuSelected).toBe('false')
  })

  it('renders preset-owned toggles from bootstrap-shaped preset stubs', async () => {
    DBState.db.customPromptTemplateToggle = 'fallback=Fallback'
    DBState.db.promptPresets = [
      {
        id: 'preset-a',
        name: 'Prompt preset Alpha',
        image: 'preset-alpha.png',
        customPromptTemplateToggle: 'stubFlag=Stub Flag',
      },
    ] as any
    activeChat().generationSettings = {
      configured: true,
      personaId: 'persona-a',
      modelPresetId: 'model-preset-a',
      promptPresetId: 'preset-a',
      jailbreakToggle: false,
      sidebarToggles: {
        stubFlag: '1',
        moduleFlag: '0',
      },
    }

    mountToggles()
    await tick()

    expect(toggleCheckbox('stubFlag').checked).toBe(true)
    expect(toggleCheckbox('moduleFlag').checked).toBe(false)
    expect(target.textContent).toContain('Stub Flag')
    expect(target.textContent).not.toContain('Fallback')
  })

  it('renders custom toggle group and groupEnd rows as an accordion', async () => {
    DBState.db.promptPresets[0].customPromptTemplateToggle =
      '=Prompt preset Group=group\nmood=Mood=select=Calm,Spicy\nflag=Flag\n==groupend\nnote=Note=text'

    mountToggles()
    await tick()

    const group = elementBySelector<HTMLElement>(
      '[data-risu-generation-toggle-group][data-risu-toggle-label="Prompt preset Group"]',
      'preset toggle group',
    )
    expect(group.textContent).toContain('Prompt preset Group')
    expect(target.querySelector('[data-risu-generation-toggle-control][data-risu-toggle-key="mood"]')).toBeNull()
    expect(textToggleInput('note').value).toBe('alpha-note')

    const groupButton = group.querySelector<HTMLButtonElement>('button')
    expect(groupButton, 'preset toggle group button').toBeTruthy()
    groupButton!.click()
    await tick()

    expect(selectToggleInput('mood').value).toBe('1')
    expect(toggleCheckbox('flag').checked).toBe(true)
  })

  it('updates mounted active-chat controls after a character-row projection changes generation settings', async () => {
    mountToggles()
    await tick()

    const mountedControls = elementBySelector<HTMLElement>(
      '[data-risu-generation-settings-picker-controls]',
      'mounted generation settings controls',
    )
    expect(pickerControl('prompt').dataset.risuPickerSelectedId).toBe('preset-a')
    expect(pickerControl('prompt').textContent).toContain('Prompt preset Alpha')
    expect(pickerControl('persona').dataset.risuPickerSelectedId).toBe('persona-a')
    expect(pickerControl('persona').textContent).toContain('Persona Alpha')
    expect(selectToggleInput('mood').value).toBe('1')
    expect(textToggleInput('note').value).toBe('alpha-note')
    expect(toggleControl('flag').dataset.risuSelected).toBe('true')
    expect(jailbreakControl().dataset.risuSelected).toBe('true')

    const applied = mergeServerProjectionCharacterRow({
      ...DBState.db.characters[0],
      name: 'Character Alpha Projected',
      chats: DBState.db.characters[0].chats.map((chat) => ({
        ...chat,
        message: [],
        generationSettings:
          chat.id === 'chat-a'
            ? {
                configured: true,
                personaId: 'persona-b',
                modelPresetId: 'model-preset-a',
                promptPresetId: 'preset-b',
                jailbreakToggle: false,
                sidebarToggles: {
                  mood: '0',
                  flag: '0',
                  note: 'projected-note',
                  moduleFlag: '0',
                },
              }
            : chat.generationSettings,
      })),
    })
    expect(applied).toBe(true)
    await tick()

    expect(mountedControls.isConnected).toBe(true)
    expect(target.contains(mountedControls)).toBe(true)
    expect(pickerControl('prompt').dataset.risuPickerSelectedId).toBe('preset-b')
    expect(pickerControl('prompt').textContent).toContain('Prompt preset Beta')
    expect(pickerControl('persona').dataset.risuPickerSelectedId).toBe('persona-b')
    expect(pickerControl('persona').textContent).toContain('Persona Beta')
    expect(selectToggleInput('mood').value).toBe('0')
    expect(textToggleInput('note').value).toBe('projected-note')
    expect(toggleCheckbox('flag').checked).toBe(false)
    expect(toggleControl('flag').dataset.risuSelected).toBe('false')
    expect(toggleCheckbox('moduleFlag').checked).toBe(false)
    expect(toggleControl('moduleFlag').dataset.risuSelected).toBe('false')
    expect(jailbreakCheckbox().checked).toBe(false)
    expect(jailbreakControl().dataset.risuSelected).toBe('false')
  })

  it('opens preset and persona pickers in active-chat generation-settings mode', async () => {
    mountToggles()
    await tick()

    pickerButton('prompt').click()
    await tick()

    expect(get(openPresetList)).toBe(true)
    expect(presetListModalStore.mode).toBe('active-chat-generation-settings')
    expect(presetListModalStore.target?.chatId).toBe('chat-a')
    expect(presetListModalStore.target?.characterId).toBe('char-a')

    closePresetListModal()
    await tick()
    expect(presetListModalStore.target).toBeNull()

    pickerButton('persona').click()
    await tick()

    expect(get(openPersonaList)).toBe(true)
    expect(personaListModalStore.mode).toBe('active-chat-generation-settings')
    expect(personaListModalStore.target?.chatId).toBe('chat-a')
    expect(personaListModalStore.target?.characterId).toBe('char-a')

    closePersonaListModal()
    await tick()
    expect(personaListModalStore.target).toBeNull()
  })

  it('selects preset and persona through composed sidebar pickers without retargeting globals', async () => {
    const calls = stubCommandFetch()
    activeChat().generationSettings = {
      configured: false,
      modelPresetId: 'model-preset-a',
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
    expect(pickerControl('prompt').dataset.risuPickerSelectedId).toBe('')
    expect(pickerControl('prompt').textContent).toContain('Select prompt preset')
    expect(pickerControl('persona').dataset.risuPickerSelectedId).toBe('')
    expect(pickerControl('persona').textContent).toContain('Select chat persona')

    pickerButton('prompt').click()
    await tick()

    expect(get(openPresetList)).toBe(true)
    expect(presetListModalStore.mode).toBe('active-chat-generation-settings')
    expect(pickerRoot('prompt', 'active-chat-generation-settings')).toBeTruthy()
    expect(pickerRow('prompt', 'preset-b').textContent).toContain('Prompt preset Beta')
    expect(pickerRow('prompt', 'preset-b').dataset.risuSelected).toBe('false')

    pickerRow('prompt', 'preset-b').click()
    await tick()
    await waitForGenerationSettingsSaveCount(calls, 1)

    expect(get(openPresetList)).toBe(false)
    expect(activeChat().generationSettings?.promptPresetId).toBe('preset-b')
    expect(activeChat().generationSettings?.personaId).toBeUndefined()
    expect(DBState.db.promptPresetsId).toBe(0)
    expect(DBState.db.selectedPersona).toBe(0)
    expect(pickerControl('prompt').dataset.risuPickerSelectedId).toBe('preset-b')
    expect(pickerControl('prompt').textContent).toContain('Prompt preset Beta')
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
    await waitForGenerationSettingsSaveCount(calls, 2)

    expect(get(openPersonaList)).toBe(false)
    expect(activeChat().generationSettings).toMatchObject({
      configured: true,
      promptPresetId: 'preset-b',
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
    expect(DBState.db.promptPresetsId).toBe(0)
    expect(DBState.db.selectedPersona).toBe(0)
    expect(pickerControl('prompt').dataset.risuPickerSelectedId).toBe('preset-b')
    expect(pickerControl('prompt').textContent).toContain('Prompt preset Beta')
    expect(pickerControl('persona').dataset.risuPickerSelectedId).toBe('persona-b')
    expect(pickerControl('persona').textContent).toContain('Persona Beta')
    expect(target.textContent).not.toContain('Select prompt preset')
    expect(target.textContent).not.toContain('Select chat persona')
    expect(calls[1]).toMatchObject({
      url: '/api/v1/commands/chats/chat-a/generation-settings',
      method: 'PUT',
      authHeader: 'sidebar-generation-settings-token',
      body: {
        baseRevision: 300,
        generationSettings: expect.objectContaining({
          configured: true,
          promptPresetId: 'preset-b',
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
          promptPresetId: 'preset-b',
          personaId: 'persona-b',
        }),
      },
    })
  })

  it('does not save preset or persona picker choices after the picker target goes stale', async () => {
    const calls = stubCommandFetch()
    const originalChatASettings = clonePlain(DBState.db.characters[0].chats[0].generationSettings)
    const originalChatBSettings = clonePlain(DBState.db.characters[0].chats[1].generationSettings)

    mountGenerationSettingsPickerHost()
    await tick()

    pickerButton('prompt').click()
    await tick()

    expect(get(openPresetList)).toBe(true)
    expect(presetListModalStore.target?.chatId).toBe('chat-a')
    expect(pickerRoot('prompt', 'active-chat-generation-settings')).toBeTruthy()

    DBState.db.characters[0].chatPage = 1
    await tick()

    pickerRow('prompt', 'preset-a').click()
    await flushAsyncWork()

    expect(get(openPresetList)).toBe(true)
    expect(calls.filter((call) => call.url.endsWith('/generation-settings'))).toEqual([])
    expect(DBState.db.characters[0].chats[0].generationSettings).toEqual(originalChatASettings)
    expect(DBState.db.characters[0].chats[1].generationSettings).toEqual(originalChatBSettings)
    expect(DBState.db.characters[0].chats[1].generationSettings?.promptPresetId).toBe('preset-b')

    closePresetListModal()
    DBState.db.characters[0].chatPage = 0
    await tick()

    pickerButton('persona').click()
    await tick()

    expect(get(openPersonaList)).toBe(true)
    expect(personaListModalStore.target?.chatId).toBe('chat-a')
    expect(pickerRoot('persona', 'active-chat-generation-settings')).toBeTruthy()

    DBState.db.characters[0].chatPage = 1
    await tick()

    pickerRow('persona', 'persona-a').click()
    await flushAsyncWork()

    expect(get(openPersonaList)).toBe(true)
    expect(calls.filter((call) => call.url.endsWith('/generation-settings'))).toEqual([])
    expect(DBState.db.characters[0].chats[0].generationSettings).toEqual(originalChatASettings)
    expect(DBState.db.characters[0].chats[1].generationSettings).toEqual(originalChatBSettings)
    expect(DBState.db.characters[0].chats[1].generationSettings?.personaId).toBe('persona-b')
  })

  it('prefills preset toggle defaults after selecting a chat preset', async () => {
    const calls = stubCommandFetch()
    activeChat().generationSettings = {
      configured: false,
      personaId: 'persona-a',
      modelPresetId: 'model-preset-a',
      jailbreakToggle: false,
    }

    mountGenerationSettingsPickerHost()
    await tick()

    expect(pickerControl('prompt').dataset.risuPickerSelectedId).toBe('')
    expect(target.querySelector('[data-risu-generation-toggle-control][data-risu-toggle-key="mood"]')).toBeNull()

    pickerButton('prompt').click()
    await tick()

    pickerRow('prompt', 'preset-a').click()
    await tick()
    await waitForGenerationSettingsSaveCount(calls, 1)

    expect(activeChat().generationSettings).toMatchObject({
      configured: true,
      promptPresetId: 'preset-a',
      personaId: 'persona-a',
      jailbreakToggle: false,
      sidebarToggles: {
        mood: '0',
        flag: '0',
        note: '',
        moduleFlag: '0',
      },
    })
    expect(selectToggleInput('mood').value).toBe('0')
    expect(toggleCheckbox('flag').checked).toBe(false)
    expect(textToggleInput('note').value).toBe('')
    expect(resolveActiveChatGenerationSettings().readiness.missing.map((reason) => reason.code)).not.toContain(
      'sidebar_toggle_missing',
    )
    expect(generationSettingsSaves(calls)[0]).toMatchObject({
      url: '/api/v1/commands/chats/chat-a/generation-settings',
      method: 'PUT',
      authHeader: 'sidebar-generation-settings-token',
      body: {
        baseRevision: 300,
        generationSettings: expect.objectContaining({
          configured: true,
          promptPresetId: 'preset-a',
          sidebarToggles: {
            mood: '0',
            flag: '0',
            note: '',
            moduleFlag: '0',
          },
        }),
      },
    })
  })

  it('asks before resetting chat toggle controls to their defaults', async () => {
    const calls = stubCommandFetch()
    activeChat().generationSettings = {
      configured: true,
      personaId: 'persona-a',
      promptPresetId: 'preset-a',
      jailbreakToggle: true,
      sidebarToggles: {
        mood: '',
        flag: '1',
        note: 'legacy-note',
        moduleFlag: '1',
        stale: '1',
      },
    }

    mountGenerationSettingsPickerHost()
    await tick()

    expect(resetDefaultsButton().textContent).toContain('Reset toggle defaults')
    expect(selectToggleInput('mood').value).toBe('')
    expect(toggleCheckbox('flag').checked).toBe(true)
    expect(textToggleInput('note').value).toBe('legacy-note')
    expect(jailbreakControl().dataset.risuSelected).toBe('true')

    resetDefaultsButton().click()
    await tick()

    expect(alertSpies.alertConfirm).toHaveBeenCalledWith('Are you sure you want to reset toggle defaults?')
    expect(calls).toHaveLength(0)
    expect(activeChat().generationSettings).toMatchObject({
      configured: true,
      promptPresetId: 'preset-a',
      personaId: 'persona-a',
      jailbreakToggle: true,
      sidebarToggles: {
        mood: '',
        flag: '1',
        note: 'legacy-note',
        moduleFlag: '1',
        stale: '1',
      },
    })
    expect(selectToggleInput('mood').value).toBe('')
    expect(toggleCheckbox('flag').checked).toBe(true)
    expect(textToggleInput('note').value).toBe('legacy-note')
    expect(jailbreakControl().dataset.risuSelected).toBe('true')

    alertSpies.alertConfirm.mockResolvedValueOnce(true)
    resetDefaultsButton().click()
    await tick()
    await waitForFetchCount(calls, 2)

    expect(activeChat().generationSettings).toMatchObject({
      configured: true,
      promptPresetId: 'preset-a',
      personaId: 'persona-a',
      jailbreakToggle: false,
      sidebarToggles: {
        mood: '0',
        flag: '0',
        note: '',
        moduleFlag: '0',
      },
    })
    expect(activeChat().generationSettings?.sidebarToggles).not.toHaveProperty('stale')
    expect(selectToggleInput('mood').value).toBe('0')
    expect(toggleCheckbox('flag').checked).toBe(false)
    expect(textToggleInput('note').value).toBe('')
    expect(jailbreakControl().dataset.risuSelected).toBe('false')
    expect(calls[1]).toMatchObject({
      url: '/api/v1/commands/chats/chat-a/generation-settings',
      method: 'PUT',
      authHeader: 'sidebar-generation-settings-token',
      body: {
        baseRevision: 300,
        generationSettings: expect.objectContaining({
          configured: true,
          promptPresetId: 'preset-a',
          personaId: 'persona-a',
          jailbreakToggle: false,
          sidebarToggles: {
            mood: '0',
            flag: '0',
            note: '',
            moduleFlag: '0',
          },
        }),
      },
    })
  })

  it('does not reset chat toggle defaults after confirmation resolves for a stale active chat', async () => {
    const calls = stubCommandFetch()
    activeChat().generationSettings = {
      configured: true,
      personaId: 'persona-a',
      promptPresetId: 'preset-a',
      jailbreakToggle: true,
      sidebarToggles: {
        mood: '',
        flag: '1',
        note: 'legacy-note',
        moduleFlag: '1',
        stale: '1',
      },
    }
    const chatASettings = clonePlain(DBState.db.characters[0].chats[0].generationSettings)
    const chatBSettings = clonePlain(DBState.db.characters[0].chats[1].generationSettings)
    const confirmation = deferred<boolean>()
    alertSpies.alertConfirm.mockReturnValueOnce(confirmation.promise)

    mountGenerationSettingsPickerHost()
    await tick()

    resetDefaultsButton().click()
    await tick()
    expect(alertSpies.alertConfirm).toHaveBeenCalledWith('Are you sure you want to reset toggle defaults?')

    DBState.db.characters[0].chatPage = 1
    await tick()

    confirmation.resolve(true)
    await flushAsyncWork()

    expect(calls).toEqual([])
    expect(DBState.db.characters[0].chats[0].generationSettings).toEqual(chatASettings)
    expect(DBState.db.characters[0].chats[1].generationSettings).toEqual(chatBSettings)
    expect(activeChat().id).toBe('chat-b')
    expect(activeChat().generationSettings?.jailbreakToggle).toBe(false)
    expect(activeChat().generationSettings?.sidebarToggles?.note).toBe('beta-note')
  })

  it('renders reset toggle defaults below Toggle HypaMemory in the chat sidebar controls', async () => {
    DBState.db.hypaV3 = true

    mountGenerationSettingsPickerHost()
    await tick()

    const hypaMemoryToggle = elementBySelector<HTMLElement>('[data-risu-hypa-memory-toggle]', 'hypa memory toggle')
    const resetDefaults = elementBySelector<HTMLElement>('[data-risu-generation-reset-defaults]', 'reset defaults')

    expect(hypaMemoryToggle.compareDocumentPosition(resetDefaults) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('saves, applies, and deletes reusable chat toggle presets', async () => {
    const calls = stubCommandFetch()
    alertSpies.alertInput.mockResolvedValueOnce('Spicy toggles')

    mountToggles()
    await tick()

    expect(togglePresetSelect().value).toBe('')

    togglePresetButton(0).click()
    await tick()
    await waitForFetchCount(calls, 2)

    const preset = DBState.db.chatGenerationTogglePresets[0]
    expect(preset).toMatchObject({
      name: 'Spicy toggles',
      jailbreakToggle: true,
      sidebarToggles: {
        mood: '1',
        flag: '1',
        note: 'alpha-note',
        moduleFlag: '1',
      },
      sidebarToggleKinds: {
        mood: 'select',
        flag: 'boolean',
        note: 'text',
        moduleFlag: 'boolean',
      },
    })
    expect(togglePresetSelect().value).toBe(preset.id)
    expect(togglePresetButton(0).disabled).toBe(true)
    expect(togglePresetButton(1).disabled).toBe(true)
    expect(calls[1]).toMatchObject({
      url: '/api/v1/commands/settings/sidebar',
      method: 'PATCH',
      authHeader: 'sidebar-generation-settings-token',
      body: {
        baseRevision: 300,
        patch: {
          chatGenerationTogglePresets: expect.arrayContaining([
            expect.objectContaining({
              id: preset.id,
              name: 'Spicy toggles',
            }),
          ]),
        },
      },
    })

    DBState.db.characters[0].chatPage = 1
    await tick()

    expect(jailbreakControl().dataset.risuSelected).toBe('false')
    expect(jailbreakControl().dataset.risuTogglePresetDifferent).toBe('true')
    expect(toggleControl('mood').dataset.risuTogglePresetDifferent).toBe('true')
    expect(toggleControl('flag').dataset.risuTogglePresetDifferent).toBe('true')
    expect(toggleControl('note').dataset.risuTogglePresetDifferent).toBe('true')
    expect(toggleControl('moduleFlag').dataset.risuTogglePresetDifferent).toBe('true')
    expect(togglePresetButton(0).disabled).toBe(false)
    expect(togglePresetButton(1).disabled).toBe(false)
    expect(togglePresetWarning()).toBeNull()

    alertSpies.alertConfirm.mockResolvedValueOnce(true)
    togglePresetButton(1).click()
    await tick()
    await waitForFetchCount(calls, 3)

    expect(alertSpies.alertConfirm).toHaveBeenCalledWith('Apply these saved toggles to the current chat?')
    expect(activeChat().generationSettings).toMatchObject({
      configured: true,
      personaId: 'persona-b',
      modelPresetId: 'model-preset-a',
      promptPresetId: 'preset-b',
      jailbreakToggle: true,
      sidebarToggles: {
        mood: '1',
        flag: '1',
        note: 'alpha-note',
        moduleFlag: '1',
      },
    })
    expect(jailbreakControl().dataset.risuSelected).toBe('true')
    expect(jailbreakControl().dataset.risuTogglePresetDifferent).toBe('false')
    expect(toggleControl('mood').dataset.risuTogglePresetDifferent).toBe('false')
    expect(togglePresetButton(0).disabled).toBe(true)
    expect(togglePresetButton(1).disabled).toBe(true)
    expect(calls[2]).toMatchObject({
      url: '/api/v1/commands/chats/chat-b/generation-settings',
      method: 'PUT',
      authHeader: 'sidebar-generation-settings-token',
      body: {
        baseRevision: 301,
        generationSettings: expect.objectContaining({
          jailbreakToggle: true,
          sidebarToggles: {
            mood: '1',
            flag: '1',
            note: 'alpha-note',
            moduleFlag: '1',
          },
        }),
      },
    })

    alertSpies.alertConfirm.mockResolvedValueOnce(true)
    togglePresetButton(2).click()
    await tick()
    await waitForFetchCount(calls, 4)

    expect(alertSpies.alertConfirm).toHaveBeenLastCalledWith('Delete "Spicy toggles"?')
    expect(DBState.db.chatGenerationTogglePresets).toEqual([])
    expect(togglePresetSelect().value).toBe('')
    expect(calls[3]).toMatchObject({
      url: '/api/v1/commands/settings/sidebar',
      method: 'PATCH',
      authHeader: 'sidebar-generation-settings-token',
      body: {
        baseRevision: 302,
        patch: {
          chatGenerationTogglePresets: [],
        },
      },
    })
  })

  it('disables saving but allows applying a selected toggle preset when the active chat has different toggle types', async () => {
    const calls = stubCommandFetch()
    DBState.db.promptPresets[0].customPromptTemplateToggle =
      'mood=Mood=select=Calm,Spicy\nflag=Flag\nnote=Note=text\ncodex=Codex\nmoduleFlag=Module Flag'
    DBState.db.chatGenerationTogglePresets = [
      {
        id: 'saved-alpha',
        name: 'Saved Alpha',
        createdAt: 1,
        updatedAt: 1,
        jailbreakToggle: true,
        sidebarToggles: {
          mood: '1',
          flag: '1',
          note: 'alpha-note',
          moduleFlag: '1',
        },
        sidebarToggleKinds: {
          mood: 'select',
          flag: 'boolean',
          note: 'text',
          moduleFlag: 'boolean',
        },
      },
    ]

    mountToggles()
    await tick()

    await chooseTogglePreset('saved-alpha')

    expect(togglePresetButton(0).disabled).toBe(true)
    expect(togglePresetButton(1).disabled).toBe(false)
    expect(togglePresetWarning()?.textContent).toContain(
      'The selected saved toggles do not match the toggles available in this chat.',
    )
    expect(toggleControl('codex').dataset.risuTogglePresetDifferent).toBe('true')
    expect(toggleControl('mood').dataset.risuTogglePresetDifferent).toBe('false')
    expect(jailbreakControl().dataset.risuTogglePresetDifferent).toBe('false')

    alertSpies.alertConfirm.mockResolvedValueOnce(true)
    togglePresetButton(1).click()
    await tick()
    await waitForGenerationSettingsSaveCount(calls, 2)

    expect(alertSpies.alertConfirm).toHaveBeenCalledWith('Apply these saved toggles to the current chat?')
    expect(activeChat().generationSettings?.sidebarToggles).toMatchObject({
      mood: '1',
      flag: '1',
      note: 'alpha-note',
      codex: '0',
      moduleFlag: '1',
    })
    expect(generationSettingsSaves(calls).at(-1)).toMatchObject({
      url: '/api/v1/commands/chats/chat-a/generation-settings',
      method: 'PUT',
      authHeader: 'sidebar-generation-settings-token',
      body: {
        baseRevision: 301,
        generationSettings: expect.objectContaining({
          sidebarToggles: {
            mood: '1',
            flag: '1',
            note: 'alpha-note',
            codex: '0',
            moduleFlag: '1',
          },
        }),
      },
    })
  })

  it('asks whether to overwrite, create, or cancel when saving with a selected toggle preset', async () => {
    const calls = stubCommandFetch()
    DBState.db.chatGenerationTogglePresets = [
      {
        id: 'saved-alpha',
        name: 'Saved Alpha',
        createdAt: 1,
        updatedAt: 1,
        jailbreakToggle: false,
        sidebarToggles: {
          mood: '0',
          flag: '0',
          note: 'old-note',
          moduleFlag: '0',
        },
        sidebarToggleKinds: {
          mood: 'select',
          flag: 'boolean',
          note: 'text',
          moduleFlag: 'boolean',
        },
      },
    ]

    mountToggles()
    await tick()

    await chooseTogglePreset('saved-alpha')

    togglePresetButton(0).click()
    await flushAsyncWork()

    expect(alertSpies.alertSelect).toHaveBeenCalledWith(
      ['Overwrite it', 'Create new Saved Toggle', 'Cancel'],
      'Save changes to "Saved Alpha"?',
    )
    expect(alertSpies.alertInput).not.toHaveBeenCalled()
    expect(calls).toEqual([])
    expect(DBState.db.chatGenerationTogglePresets).toHaveLength(1)

    alertSpies.alertSelect.mockResolvedValueOnce('1')
    alertSpies.alertInput.mockResolvedValueOnce('Fresh copy')
    togglePresetButton(0).click()
    await tick()
    await waitForFetchCount(calls, 2)

    expect(DBState.db.chatGenerationTogglePresets).toHaveLength(2)
    const createdPreset = DBState.db.chatGenerationTogglePresets[1]
    expect(createdPreset).toMatchObject({
      name: 'Fresh copy',
      jailbreakToggle: true,
      sidebarToggles: {
        mood: '1',
        flag: '1',
        note: 'alpha-note',
        moduleFlag: '1',
      },
    })
    expect(togglePresetSelect().value).toBe(createdPreset.id)

    await chooseTogglePreset('saved-alpha')

    alertSpies.alertSelect.mockResolvedValueOnce('0')
    togglePresetButton(0).click()
    await tick()
    await waitForFetchCount(calls, 3)

    expect(DBState.db.chatGenerationTogglePresets).toHaveLength(2)
    expect(DBState.db.chatGenerationTogglePresets[0]).toMatchObject({
      id: 'saved-alpha',
      name: 'Saved Alpha',
      createdAt: 1,
      jailbreakToggle: true,
      sidebarToggles: {
        mood: '1',
        flag: '1',
        note: 'alpha-note',
        moduleFlag: '1',
      },
    })
    expect(togglePresetSelect().value).toBe('saved-alpha')
  })

  it('does not save a reusable toggle preset after the name prompt resolves for a stale active chat', async () => {
    const calls = stubCommandFetch()
    const chatASettings = clonePlain(DBState.db.characters[0].chats[0].generationSettings)
    const chatBSettings = clonePlain(DBState.db.characters[0].chats[1].generationSettings)
    const input = deferred<string>()
    alertSpies.alertInput.mockReturnValueOnce(input.promise)

    mountToggles()
    await tick()

    togglePresetButton(0).click()
    await tick()
    expect(alertSpies.alertInput).toHaveBeenCalledWith('Name this toggle preset')

    DBState.db.characters[0].chatPage = 1
    await tick()

    input.resolve('Late toggles')
    await flushAsyncWork()

    expect(calls).toEqual([])
    expect(DBState.db.chatGenerationTogglePresets).toEqual([])
    expect(DBState.db.characters[0].chats[0].generationSettings).toEqual(chatASettings)
    expect(DBState.db.characters[0].chats[1].generationSettings).toEqual(chatBSettings)
    expect(togglePresetSelect().value).toBe('')
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
