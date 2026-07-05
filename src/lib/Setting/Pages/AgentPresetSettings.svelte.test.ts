import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const agentPresetSpies = vi.hoisted(() => ({
  createAgentPreset: vi.fn(async () => ({ status: 'ok', revision: 1, event: { type: 'ok', revision: 1 } })),
  updateAgentPreset: vi.fn(async () => ({ status: 'ok', revision: 1, event: { type: 'ok', revision: 1 } })),
  duplicateAgentPreset: vi.fn(async () => ({ status: 'ok', revision: 1, event: { type: 'ok', revision: 1 } })),
  deleteAgentPreset: vi.fn(async () => ({ status: 'ok', revision: 1, event: { type: 'ok', revision: 1 } })),
  reorderAgentPresets: vi.fn(async () => ({ status: 'ok', revision: 1, event: { type: 'ok', revision: 1 } })),
  setAgentPresetDefault: vi.fn(async () => ({ status: 'ok', revision: 1, event: { type: 'ok', revision: 1 } })),
}))

vi.mock('src/ts/agentPresets', () => agentPresetSpies)

import AgentPresetSettings from './AgentPresetSettings.svelte'
import { language } from 'src/lang'
import { DBState } from 'src/ts/stores.svelte'
import type { AgentPresetRecord, AgentPresetStepRecord } from 'src/ts/agentPresetRecords'

type MountedComponent = Parameters<typeof unmount>[0]

let target: HTMLElement
let component: MountedComponent | undefined

function baseStep(overrides: Partial<AgentPresetStepRecord> = {}): AgentPresetStepRecord {
  return {
    id: 'aps_a',
    name: 'Gather Context',
    enabled: true,
    phase: 'beforeMain',
    dependencies: [],
    instruction: 'Summarize context.',
    model: { mode: 'inheritMain' },
    runtime: {},
    inputScopes: [],
    outputKey: 'context',
    outputFormat: 'text',
    destination: 'promptOutput',
    failurePolicy: { mode: 'required' },
    ...overrides,
  }
}

function preset(overrides: Partial<AgentPresetRecord> = {}): AgentPresetRecord {
  return {
    id: 'ap_a',
    name: 'Research Agent',
    enabled: true,
    version: 1,
    steps: [],
    ...overrides,
  }
}

function seedDb(agentPresets: AgentPresetRecord[] = []): void {
  DBState.db = {
    agentPresets,
    agentPresetDefaultId: agentPresets[0]?.id,
    characters: [
      {
        chaId: 'char-a',
        chatPage: 0,
        chats: [
          {
            id: 'chat-a',
            generationSettings: { agentPresetId: agentPresets[0]?.id ?? '' },
            message: [],
          },
        ],
      },
    ],
    loadouts: agentPresets[0] ? [{ id: 'loadout-a', agentPresetId: agentPresets[0].id }] : [],
  } as never
}

function mountPage(): void {
  component = mount(AgentPresetSettings, { target })
}

function button(selector: string): HTMLButtonElement {
  const element = target.querySelector<HTMLButtonElement>(`${selector} button`)
  expect(element, selector).toBeTruthy()
  return element!
}

function row(presetId: string): HTMLElement {
  const element = target.querySelector<HTMLElement>(`[data-risu-agent-preset-row][data-preset-id="${presetId}"]`)
  expect(element, presetId).toBeTruthy()
  return element!
}

function rowButton(presetId: string, selector: string): HTMLButtonElement {
  const element = row(presetId).querySelector<HTMLButtonElement>(`${selector} button`)
  expect(element, `${presetId} ${selector}`).toBeTruthy()
  return element!
}

function nameInput(): HTMLInputElement {
  const input = target.querySelector<HTMLInputElement>('[data-risu-agent-preset-name-input] input')
  expect(input).toBeTruthy()
  return input!
}

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await tick()
}

beforeEach(() => {
  target = document.createElement('div')
  document.body.appendChild(target)
  Object.values(agentPresetSpies).forEach((spy) => spy.mockClear())
  vi.stubGlobal(
    'confirm',
    vi.fn(() => true),
  )
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  target.remove()
  document.body.innerHTML = ''
  DBState.db = {} as never
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('AgentPresetSettings', () => {
  it('renders an empty Agent Presets shell without Context Agent controls', async () => {
    seedDb([])
    mountPage()
    await tick()

    expect(target.querySelector('[data-risu-agent-preset-settings]')).toBeTruthy()
    expect(target.textContent).toContain(language.agentPresets.settingsTitle)
    expect(target.textContent).toContain(language.agentPresets.emptyState)
    expect(target.textContent).not.toContain(language.agentContextPrompt)
  })

  it('creates a preset through the command helper', async () => {
    seedDb([])
    mountPage()
    await tick()

    button('[data-risu-agent-preset-create]').click()
    await tick()

    const input = nameInput()
    input.value = 'Research Preset'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()

    button('[data-risu-agent-preset-save]').click()
    await flushAsyncWork()

    expect(agentPresetSpies.createAgentPreset).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Research Preset',
        enabled: true,
      }),
    )
  })

  it('updates, duplicates, deletes, reorders, and selects defaults through command helpers', async () => {
    seedDb([
      preset({ id: 'ap_a', name: 'Research Agent', steps: [baseStep()] }),
      preset({ id: 'ap_b', name: 'Critique Agent', enabled: false }),
    ])
    mountPage()
    await tick()

    const defaultSelect = target.querySelector<HTMLSelectElement>('[data-risu-agent-preset-default-select] select')
    expect(defaultSelect).toBeTruthy()
    defaultSelect!.value = 'ap_b'
    defaultSelect!.dispatchEvent(new Event('change', { bubbles: true }))
    await flushAsyncWork()

    expect(agentPresetSpies.setAgentPresetDefault).toHaveBeenCalledWith('ap_b')

    rowButton('ap_a', '[data-risu-agent-preset-move-down]').click()
    await flushAsyncWork()
    expect(agentPresetSpies.reorderAgentPresets).toHaveBeenCalledWith(['ap_b', 'ap_a'])

    rowButton('ap_a', '[data-risu-agent-preset-duplicate]').click()
    await flushAsyncWork()
    expect(agentPresetSpies.duplicateAgentPreset).toHaveBeenCalledWith('ap_a', { name: 'Research Agent Copy' })

    rowButton('ap_a', '[data-risu-agent-preset-edit]').click()
    await tick()
    const input = nameInput()
    input.value = 'Renamed Agent'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()
    button('[data-risu-agent-preset-save]').click()
    await flushAsyncWork()

    expect(agentPresetSpies.updateAgentPreset).toHaveBeenCalledWith(
      'ap_a',
      expect.objectContaining({ name: 'Renamed Agent', enabled: true }),
    )

    rowButton('ap_a', '[data-risu-agent-preset-delete]').click()
    await flushAsyncWork()

    expect(window.confirm).toHaveBeenCalledWith(language.agentPresets.deletePresetConfirm('Research Agent'))
    expect(agentPresetSpies.deleteAgentPreset).toHaveBeenCalledWith('ap_a')
  })

  it('renders disabled and invalid statuses from resolver helpers', async () => {
    seedDb([
      preset({ id: 'ap_disabled', name: 'Disabled Agent', enabled: false }),
      preset({
        id: 'ap_invalid',
        name: 'Invalid Agent',
        steps: [baseStep({ outputKey: '' })],
      }),
    ])
    mountPage()
    await tick()

    expect(row('ap_disabled').textContent).toContain(language.agentPresets.statusDisabled)
    expect(row('ap_invalid').textContent).toContain(language.agentPresets.statusInvalid)
  })
})
