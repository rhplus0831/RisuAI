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
import {
  closePersonaListModal,
  closePresetListModal,
  DBState,
  openPersonaList,
  openPresetList,
  personaListModalStore,
  presetListModalStore,
  selectedCharID,
} from 'src/ts/stores.svelte'
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

function buttonContaining(label: string): HTMLButtonElement {
  const button = Array.from(target.querySelectorAll<HTMLButtonElement>('button')).find(
    (candidate) => candidate.textContent?.includes(label),
  )
  expect(button, `button containing ${label}`).toBeTruthy()
  return button!
}

function checkboxByName(name: string): HTMLInputElement {
  const input = target.querySelector<HTMLInputElement>(`input[type="checkbox"][alt="${name}"]`)
  expect(input, `checkbox ${name}`).toBeTruthy()
  return input!
}

function textInput(): HTMLInputElement {
  const input = target.querySelector<HTMLInputElement>('input[type="text"]')
  expect(input, 'text toggle input').toBeTruthy()
  return input!
}

function selectInput(): HTMLSelectElement {
  const select = target.querySelector<HTMLSelectElement>('select')
  expect(select, 'select toggle input').toBeTruthy()
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

    expect(buttonContaining('Select chat preset')).toBeTruthy()
    expect(buttonContaining('Select chat persona')).toBeTruthy()
  })

  it('renders preset, persona, and toggle values from the active chat while switching chats', async () => {
    mountToggles()
    await tick()

    expect(buttonContaining('Preset Alpha')).toBeTruthy()
    expect(buttonContaining('Persona Alpha')).toBeTruthy()
    expect(selectInput().value).toBe('1')
    expect(textInput().value).toBe('alpha-note')
    expect(checkboxByName('Flag').checked).toBe(true)
    expect(checkboxByName('Module Flag').checked).toBe(true)
    expect(target.textContent).not.toContain('Legacy Toggle')

    DBState.db.characters[0].chatPage = 1
    await tick()

    expect(buttonContaining('Preset Beta')).toBeTruthy()
    expect(buttonContaining('Persona Beta')).toBeTruthy()
    expect(selectInput().value).toBe('0')
    expect(textInput().value).toBe('beta-note')
    expect(checkboxByName('Flag').checked).toBe(false)
    expect(checkboxByName('Module Flag').checked).toBe(false)
  })

  it('opens preset and persona pickers in active-chat generation-settings mode', async () => {
    mountToggles()
    await tick()

    buttonContaining('Preset Alpha').click()
    await tick()

    expect(get(openPresetList)).toBe(true)
    expect(presetListModalStore.mode).toBe('active-chat-generation-settings')

    closePresetListModal()
    await tick()

    buttonContaining('Persona Alpha').click()
    await tick()

    expect(get(openPersonaList)).toBe(true)
    expect(personaListModalStore.mode).toBe('active-chat-generation-settings')
  })

  it('writes jailbreak and sidebar toggles to active chat settings without touching global state', async () => {
    const calls = stubCommandFetch()
    mountToggles()
    await tick()

    checkboxByName('Toggle Jailbreak').click()
    await tick()
    await waitForFetchCount(calls, 2)

    expect(activeChat().generationSettings?.jailbreakToggle).toBe(false)
    expect(DBState.db.jailbreakToggle).toBe(true)

    checkboxByName('Flag').click()
    await tick()
    await waitForFetchCount(calls, 3)

    expect(activeChat().generationSettings?.sidebarToggles?.flag).toBe('0')
    expect(DBState.db.globalChatVariables.toggle_flag).toBe('global-flag')

    selectInput().value = '0'
    selectInput().dispatchEvent(new Event('change', { bubbles: true }))
    await tick()
    await waitForFetchCount(calls, 4)

    expect(activeChat().generationSettings?.sidebarToggles?.mood).toBe('0')
    expect(DBState.db.globalChatVariables.toggle_mood).toBe('global-mood')

    textInput().value = 'updated-note'
    textInput().dispatchEvent(new Event('input', { bubbles: true }))
    await tick()
    await waitForFetchCount(calls, 5)

    expect(activeChat().generationSettings?.sidebarToggles?.note).toBe('updated-note')
    expect(DBState.db.globalChatVariables.toggle_note).toBe('global-note')
  })
})
