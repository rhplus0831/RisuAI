// Paint-half coverage: click a sidebar/jailbreak toggle and assert the visual
// toggle flips optimistically.
// The settle half (flip survives command + refreeze) is the Tier-2 journey in
// server/fastify/browser-smoke/phase0VisibleState.spec.ts.
//
// Family: optimistic paint/rollback (taxonomy §5). Tier 1.
//
// Drive: mount the real Toggles.svelte, click the real jailbreak checkbox while
// the save command is still in flight (deferred fetch), and assert the rendered
// `data-risu-selected` flips immediately — the optimistic paint must not wait
// for the server. Classify against resource state only after a DOM check.

import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('src/ts/storage/fastifyStorage', () => ({
  getNodeServerProxyAuth: async () => 'phase0-toggle-paint-token',
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

vi.mock('src/ts/process/scripts', () => ({ resetScriptCache: vi.fn() }))
vi.mock('src/ts/characterCommands', () => ({ setCharacterSupaMemory: vi.fn() }))
vi.mock('src/ts/setting/utils', () => ({ getFullSettingsData: () => [] }))

import Toggles from '../SideBars/Toggles.svelte'
import { selectedCharID } from 'src/ts/stores.svelte'
import { getResourceDatabase, replaceResourceDatabase } from 'src/ts/server/resourceState.svelte'
import { resolveActiveChatGenerationSettings } from 'src/ts/activeChatGenerationSettings'
import { clearCachedServerCommandRevision } from 'src/ts/server/commands'
import { classifyDifferential, readJailbreakSelected, readToggleSelected } from './domStateOracle'

type MountedComponent = Parameters<typeof unmount>[0]

let target: HTMLElement
let component: MountedComponent | undefined

// A deferred fetch so the save command never resolves during the test: this
// isolates the *optimistic* paint from the server-confirmed state.
function stubNeverResolvingCommandFetch(): { count: () => number } {
  let calls = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      calls += 1
      const url = String(input)
      if (url === '/api/v1/bootstrap') {
        return new Response(JSON.stringify({ revision: 400 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      // generation-settings save: hang forever.
      return new Promise<Response>(() => {})
    }) as unknown as typeof fetch,
  )
  return { count: () => calls }
}

function seedDb(): void {
  selectedCharID.set(0)
  replaceResourceDatabase({
    username: 'User',
    selectedPersona: 0,
    botPresetsId: 0,
    modelPresetsId: 0,
    promptPresetsId: 0,
    jailbreakToggle: true,
    customPromptTemplateToggle: '',
    customSidebarItems: [],
    hypaV3: false,
    personas: [{ id: 'persona-a', name: 'Persona A', personaPrompt: '', icon: '', note: '' }],
    botPresets: [],
    modelPresets: [
      {
        id: 'model-a',
        name: 'Model A',
      },
    ],
    promptPresets: [
      {
        id: 'prompt-a',
        name: 'Prompt A',
        jailbreak: 'Jailbreak',
        customPromptTemplateToggle: 'flag=Flag',
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
              personaId: 'persona-a',
              modelPresetId: 'model-a',
              promptPresetId: 'prompt-a',
              jailbreakToggle: true,
              sidebarToggles: { flag: '1' },
            },
          },
        ],
      },
    ],
  } as never)
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
  target.remove()
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  selectedCharID.set(-1)
  replaceResourceDatabase({} as never)
})

describe('Phase 0 / Journey 2: optimistic toggle paint (DOM oracle, Tier 1)', () => {
  it('flips the rendered jailbreak checkbox immediately, before the save resolves', async () => {
    stubNeverResolvingCommandFetch()
    component = mount(Toggles, {
      target,
      props: { chara: getResourceDatabase().characters[0], noContainer: true },
    })
    await tick()

    expect(readJailbreakSelected(target)).toBe(true)

    const checkbox = target.querySelector<HTMLInputElement>(
      '[data-risu-generation-jailbreak-control] input[type="checkbox"]',
    )
    expect(checkbox, 'jailbreak checkbox').toBeTruthy()
    checkbox!.click()
    await tick()

    // DOM oracle: the painted checkbox must already be off, with the command
    // still pending (no server confirmation yet).
    const domSelected = readJailbreakSelected(target)
    expect(domSelected).toBe(false)

    // Classify: the optimistic store write set jailbreakToggle=false; the DOM
    // must agree. No bug iff DOM == store.
    const storeSelected = resolveActiveChatGenerationSettings().settings?.jailbreakToggle === true
    expect(classifyDifferential({ dom: domSelected, store: storeSelected, expected: false })).toBe('dom-matches-store')
  })

  it('flips a rendered sidebar checkbox toggle immediately on click', async () => {
    stubNeverResolvingCommandFetch()
    component = mount(Toggles, {
      target,
      props: { chara: getResourceDatabase().characters[0], noContainer: true },
    })
    await tick()

    expect(readToggleSelected(target, 'flag')).toBe(true)

    const flagCheckbox = target.querySelector<HTMLInputElement>(
      '[data-risu-generation-toggle-control][data-risu-toggle-key="flag"] input[type="checkbox"]',
    )
    expect(flagCheckbox, 'flag checkbox').toBeTruthy()
    flagCheckbox!.click()
    await tick()

    const domSelected = readToggleSelected(target, 'flag')
    expect(domSelected).toBe(false)
    const storeValue = resolveActiveChatGenerationSettings().settings?.sidebarToggles?.flag
    expect(classifyDifferential({ dom: domSelected, store: storeValue === '1', expected: false })).toBe(
      'dom-matches-store',
    )
  })
})
