import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const agentPresetSpies = vi.hoisted(() => ({
  createAgentPreset: vi.fn(async () => ({ status: 'ok', revision: 1, event: { type: 'ok', revision: 1 } })),
  updateAgentPreset: vi.fn(async () => ({ status: 'ok', revision: 1, event: { type: 'ok', revision: 1 } })),
  duplicateAgentPreset: vi.fn(async () => ({ status: 'ok', revision: 1, event: { type: 'ok', revision: 1 } })),
  deleteAgentPreset: vi.fn(async () => ({ status: 'ok', revision: 1, event: { type: 'ok', revision: 1 } })),
  reorderAgentPresets: vi.fn(async () => ({ status: 'ok', revision: 1, event: { type: 'ok', revision: 1 } })),
  setAgentPresetDefault: vi.fn(async () => ({ status: 'ok', revision: 1, event: { type: 'ok', revision: 1 } })),
  createAgentPresetStep: vi.fn(async () => ({ status: 'ok', revision: 1, event: { type: 'ok', revision: 1 } })),
  updateAgentPresetStep: vi.fn(async () => ({ status: 'ok', revision: 1, event: { type: 'ok', revision: 1 } })),
  duplicateAgentPresetStep: vi.fn(async () => ({ status: 'ok', revision: 1, event: { type: 'ok', revision: 1 } })),
  deleteAgentPresetStep: vi.fn(async () => ({ status: 'ok', revision: 1, event: { type: 'ok', revision: 1 } })),
  reorderAgentPresetSteps: vi.fn(async () => ({ status: 'ok', revision: 1, event: { type: 'ok', revision: 1 } })),
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

function stepEditButton(): HTMLButtonElement {
  const element = target.querySelector<HTMLButtonElement>('[data-risu-agent-preset-step-edit]')
  expect(element).toBeTruthy()
  return element!
}

function stepPhaseSelect(): HTMLSelectElement {
  const element = [...target.querySelectorAll<HTMLSelectElement>('[data-risu-agent-preset-step-form] select')].find(
    (select) => {
      const optionValues = [...select.options].map((option) => option.value)
      return optionValues.includes('beforeMain') && optionValues.includes('afterMain')
    },
  )
  expect(element).toBeTruthy()
  return element!
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
  it('renders an empty Agent Presets shell', async () => {
    seedDb([])
    mountPage()
    await tick()

    expect(target.querySelector('[data-risu-agent-preset-settings]')).toBeTruthy()
    expect(target.textContent).toContain(language.agentPresets.settingsTitle)
    expect(target.textContent).toContain(language.agentPresets.emptyState)
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

  it('renders disabled, invalid, and incomplete statuses from resolver helpers', async () => {
    seedDb([
      preset({ id: 'ap_disabled', name: 'Disabled Agent', enabled: false }),
      preset({
        id: 'ap_invalid',
        name: 'Invalid Agent',
        steps: [baseStep({ outputKey: '' })],
      }),
      preset({
        id: 'ap_incomplete',
        name: 'Incomplete Agent',
        steps: [
          baseStep({ id: 'aps_a', outputKey: 'a', instruction: 'Use {{agent::b}}.' }),
          baseStep({ id: 'aps_b', outputKey: 'b', dependencies: ['aps_a'] }),
        ],
      }),
    ])
    mountPage()
    await tick()

    expect(row('ap_disabled').textContent).toContain(language.agentPresets.statusDisabled)
    expect(row('ap_invalid').textContent).toContain(language.agentPresets.statusInvalid)
    expect(row('ap_incomplete').textContent).toContain(language.agentPresets.statusIncomplete)
  })

  it('renders the full step editor fields', async () => {
    seedDb([preset({ id: 'ap_a', name: 'Research Agent', steps: [baseStep()] })])
    mountPage()
    await tick()

    rowButton('ap_a', '[data-risu-agent-preset-edit]').click()
    await tick()
    stepEditButton().click()
    await tick()

    expect(target.textContent).toContain(language.agentPresets.stepNameLabel)
    expect(target.textContent).toContain(language.agentPresets.stepPhaseLabel)
    expect(target.textContent).toContain(language.agentPresets.instructionLabel)
    expect(target.textContent).toContain(language.agentPresets.modelModeLabel)
    expect(target.textContent).toContain(language.agentPresets.dependenciesLabel)
    expect(target.textContent).toContain(language.agentPresets.outputFormatLabel)
    expect(target.textContent).toContain(language.agentPresets.destinationLabel)
    expect(target.textContent).toContain(language.agentPresets.failurePolicyLabel)
    expect(target.textContent).toContain(language.agentPresets.timeoutMsLabel)
    expect(target.textContent).toContain(language.agentPresets.maxInputCharsLabel)
    expect(target.textContent).toContain(language.agentPresets.maxOutputCharsLabel)
    expect(target.textContent).toContain(language.agentPresets.temperatureLabel)
    expect(target.textContent).toContain(language.agentPresets.preparedInputScopesLabel)
    expect(
      target.querySelector(
        `[data-risu-agent-preset-prepared-inputs-heading] button[title="${language.agentPresets.preparedInputScopesLabel} ${language.showHelp}"]`,
      ),
    ).toBeTruthy()
    expect(target.textContent).toContain(language.agentPresets.preparedInputCbsNameLabel)
    expect(target.textContent).toContain(language.agentPresets.inputScopeLabels.currentUserMessage)
    expect(target.textContent).toContain('{{currentUserMessage}}')
    for (const scope of [
      'recentChatTail',
      'chatSearchSnippets',
      'lorebookContext',
      'memoryContext',
      'characterSummary',
      'personaSummary',
      'currentUserMessage',
      'previousAgentOutputs',
    ] as const) {
      const inputScope = target.querySelector(`[data-risu-agent-preset-input-scope="${scope}"]`)
      expect(inputScope?.textContent).toContain(language.agentPresets.inputScopeDescriptions[scope])
    }
    expect(target.textContent).not.toContain(language.agentPresets.inputScopeLabels.mainDraft)
    expect(target.textContent).not.toContain(language.agentPresets.inputScopeDescriptions.mainDraft)
    expect(target.textContent).not.toContain('{{mainDraft}}')
  })

  it('does not treat Space or Enter in the step instruction as backdrop activation', async () => {
    seedDb([preset({ id: 'ap_a', name: 'Research Agent', steps: [baseStep()] })])
    mountPage()
    await tick()

    rowButton('ap_a', '[data-risu-agent-preset-edit]').click()
    await tick()
    stepEditButton().click()
    await tick()

    const instruction = target.querySelector<HTMLTextAreaElement>('[data-risu-agent-preset-step-form] textarea')
    expect(instruction).toBeTruthy()
    instruction!.value = 'Summarize context with details.'
    instruction!.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()

    instruction!.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }))
    instruction!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    await tick()

    expect(window.confirm).not.toHaveBeenCalled()
    expect(target.querySelector('[data-risu-agent-preset-editor]')).toBeTruthy()
  })

  it('shows main draft prepared input only for after-main steps', async () => {
    seedDb([
      preset({
        id: 'ap_a',
        name: 'Research Agent',
        steps: [
          baseStep({
            id: 'aps_after',
            name: 'Review Draft',
            phase: 'afterMain',
            inputScopes: ['mainDraft'],
            destination: 'intermediate',
          }),
        ],
      }),
    ])
    mountPage()
    await tick()

    rowButton('ap_a', '[data-risu-agent-preset-edit]').click()
    await tick()
    stepEditButton().click()
    await tick()

    expect(target.textContent).toContain(language.agentPresets.inputScopeLabels.mainDraft)
    expect(target.textContent).toContain(language.agentPresets.inputScopeDescriptions.mainDraft)
    expect(target.textContent).toContain('{{mainDraft}}')

    const select = stepPhaseSelect()
    select.value = 'beforeMain'
    select.dispatchEvent(new Event('change', { bubbles: true }))
    await tick()

    expect(target.textContent).not.toContain(language.agentPresets.inputScopeLabels.mainDraft)
    expect(target.textContent).not.toContain('{{mainDraft}}')

    button('[data-risu-agent-preset-step-save]').click()
    await flushAsyncWork()

    expect(agentPresetSpies.updateAgentPresetStep).toHaveBeenCalledWith(
      'ap_a',
      'aps_after',
      expect.objectContaining({
        phase: 'beforeMain',
        inputScopes: [],
      }),
    )
  })

  it('refreshes the open editor step list when projection replaces the preset record', async () => {
    seedDb([preset({ id: 'ap_a', name: 'Research Agent', steps: [baseStep()] })])
    mountPage()
    await tick()

    rowButton('ap_a', '[data-risu-agent-preset-edit]').click()
    await tick()

    expect(target.textContent).toContain('Gather Context')
    expect(target.textContent).not.toContain('Review Draft')

    DBState.db.agentPresets = [
      preset({
        id: 'ap_a',
        name: 'Research Agent',
        steps: [
          baseStep(),
          baseStep({
            id: 'aps_b',
            name: 'Review Draft',
            phase: 'afterMain',
            outputKey: 'review',
            destination: 'intermediate',
          }),
        ],
      }),
    ]
    await tick()

    expect(target.textContent).toContain('Review Draft')
    expect(target.querySelectorAll('[data-risu-agent-preset-step-row]')).toHaveLength(2)
  })

  it('creates and updates steps through command helpers', async () => {
    seedDb([preset({ id: 'ap_a', name: 'Research Agent', steps: [baseStep()] })])
    mountPage()
    await tick()

    rowButton('ap_a', '[data-risu-agent-preset-edit]').click()
    await tick()
    target.querySelector<HTMLButtonElement>('[data-risu-agent-preset-step-editor] button')?.click()
    await tick()

    button('[data-risu-agent-preset-step-save]').click()
    await flushAsyncWork()

    expect(agentPresetSpies.createAgentPresetStep).toHaveBeenCalledWith(
      'ap_a',
      expect.objectContaining({
        name: 'Step 2',
        outputKey: 'step_2',
        model: { mode: 'inheritMain' },
        inputScopes: ['currentUserMessage'],
      }),
    )

    stepEditButton().click()
    await tick()
    const outputKeyInput = [...target.querySelectorAll<HTMLInputElement>('input')].find(
      (input) => input.value === 'context',
    )
    expect(outputKeyInput).toBeTruthy()
    outputKeyInput!.value = 'context_brief'
    outputKeyInput!.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()

    button('[data-risu-agent-preset-step-save]').click()
    await flushAsyncWork()

    expect(agentPresetSpies.updateAgentPresetStep).toHaveBeenCalledWith(
      'ap_a',
      'aps_a',
      expect.objectContaining({
        outputKey: 'context_brief',
        runtime: expect.objectContaining({
          timeoutMs: 30000,
          maxInputChars: 24000,
          maxOutputChars: 1200,
          temperature: 100,
        }),
      }),
    )
  })

  it('reorders steps within the visible phase group', async () => {
    seedDb([
      preset({
        id: 'ap_a',
        name: 'Research Agent',
        steps: [
          baseStep({ id: 'aps_a', name: 'Before A', phase: 'beforeMain', outputKey: 'before_a' }),
          baseStep({
            id: 'aps_after',
            name: 'After Step',
            phase: 'afterMain',
            outputKey: 'after_step',
            destination: 'intermediate',
          }),
          baseStep({ id: 'aps_b', name: 'Before B', phase: 'beforeMain', outputKey: 'before_b' }),
        ],
      }),
    ])
    mountPage()
    await tick()

    rowButton('ap_a', '[data-risu-agent-preset-edit]').click()
    await tick()

    const beforeARow = [...target.querySelectorAll<HTMLElement>('[data-risu-agent-preset-step-row]')].find((element) =>
      element.textContent?.includes('Before A'),
    )
    expect(beforeARow).toBeTruthy()
    const buttons = beforeARow!.querySelectorAll<HTMLButtonElement>('button')
    expect(buttons.length).toBeGreaterThan(2)
    buttons[2].click()
    await flushAsyncWork()

    expect(agentPresetSpies.reorderAgentPresetSteps).toHaveBeenCalledWith('ap_a', ['aps_b', 'aps_after', 'aps_a'])
  })
})
