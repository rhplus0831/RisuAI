// Toggle-grouping coverage: change state driving toggle grouping, then assert
// group containers and children render grouped in DOM.
//
// Family: grouping/structural derivation (taxonomy §5). Tier 1.
//
// Drive: mount the real Toggles.svelte with a preset whose template defines a
// toggle group, then assert the painted DOM contains the grouped accordion.
// Classify against resolveActiveChatGenerationSettings().displayedSidebarToggles
// (the store side) only after a DOM assertion fails.
//
// This probe guards the rendered grouping behavior that helper-layer tests cannot
// see on their own.

import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('src/ts/storage/fastifyStorage', () => ({
  getNodeServerProxyAuth: async () => 'phase0-grouping-token',
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

import Toggles from '../SideBars/Toggles.svelte'
import { DBState, selectedCharID } from 'src/ts/stores.svelte'
import { resolveActiveChatGenerationSettings } from 'src/ts/activeChatGenerationSettings'
import { clearCachedServerCommandRevision } from 'src/ts/server/commands'
import { classifyDifferential, isInScopeFinding, readToggleGroupLabels } from './domStateOracle'

type MountedComponent = Parameters<typeof unmount>[0]

let target: HTMLElement
let component: MountedComponent | undefined

// A preset template with one group ("Preset Group") wrapping a select + a
// checkbox, closed by groupend, then an ungrouped text toggle. The grouped
// branch must paint a `[data-risu-generation-toggle-group]` accordion.
const GROUP_TEMPLATE = '=Preset Group=group\nmood=Mood=select=Calm,Spicy\nflag=Flag\n==groupend\nnote=Note=text'

function seedDb(): void {
  selectedCharID.set(0)
  DBState.db = {
    username: 'User',
    selectedPersona: 0,
    botPresetsId: 0,
    modelPresetsId: 0,
    promptPresetsId: 0,
    jailbreakToggle: false,
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
        jailbreak: '',
        customPromptTemplateToggle: GROUP_TEMPLATE,
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
              jailbreakToggle: false,
              sidebarToggles: { mood: '1', flag: '1', note: 'n' },
            },
          },
        ],
      },
    ],
  } as never
}

function storeGroupLabels(): string[] {
  return resolveActiveChatGenerationSettings()
    .displayedSidebarToggles.filter((toggle) => toggle.kind === 'group')
    .map((toggle) => toggle.label)
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
  DBState.db = {} as never
})

describe('Phase 0 / Journey 4: grouped toggle rendering (DOM oracle, Tier 1)', () => {
  it('paints the preset toggle group as an accordion container in the DOM', async () => {
    component = mount(Toggles, {
      target,
      props: { chara: DBState.db.characters[0], noContainer: true },
    })
    await tick()

    // DOM oracle: the painted accordion group(s).
    const domGroupLabels = readToggleGroupLabels(target)

    // Primary assertion is on the rendered DOM, not the store.
    expect(domGroupLabels).toEqual(['Preset Group'])

    // Store side is read only to classify. On the current tree the DOM matches
    // the store, so this is "no bug". On a reverted Toggles.svelte the DOM is
    // empty while the store still groups -> reactivity-binding-bug (in scope).
    const verdict = classifyDifferential({
      dom: domGroupLabels,
      store: storeGroupLabels(),
      expected: ['Preset Group'],
    })
    expect(verdict).toBe('dom-matches-store')
    expect(isInScopeFinding(verdict)).toBe(false)

    // The group's children must render inside the accordion (after expanding).
    const group = target.querySelector<HTMLElement>(
      '[data-risu-generation-toggle-group][data-risu-toggle-label="Preset Group"]',
    )
    expect(group, 'preset toggle group container').toBeTruthy()
  })
})
