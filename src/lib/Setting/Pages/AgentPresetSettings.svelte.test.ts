import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type AgentPresetCommandMockResult = {
  status: 'accepted' | 'queued' | 'blocked' | 'failed'
  result: {
    status: string
    revision?: number
    event?: { type: string; revision: number }
    error?: string
  }
  projectionLatch?: {
    kind: 'preset' | 'step'
    key: string
    baselineIds: string[]
    expectedName: string
    presetId?: string
    expectedOutputKey?: string
    semanticDescriptor?: string
    compareOutputKey?: boolean
  }
}

type AgentPresetProjectionLatchMock = NonNullable<AgentPresetCommandMockResult['projectionLatch']>

const agentPresetSpies = vi.hoisted(() => ({
  createAgentPreset: vi.fn(
    async (): Promise<AgentPresetCommandMockResult> => ({
      status: 'accepted',
      result: { status: 'ok', revision: 1, event: { type: 'ok', revision: 1 } },
    }),
  ),
  updateAgentPreset: vi.fn(
    async (): Promise<AgentPresetCommandMockResult> => ({
      status: 'accepted',
      result: { status: 'ok', revision: 1, event: { type: 'ok', revision: 1 } },
    }),
  ),
  duplicateAgentPreset: vi.fn(
    async (): Promise<AgentPresetCommandMockResult> => ({
      status: 'accepted',
      result: { status: 'ok', revision: 1, event: { type: 'ok', revision: 1 } },
    }),
  ),
  deleteAgentPreset: vi.fn(async () => ({
    status: 'accepted',
    result: { status: 'ok', revision: 1, event: { type: 'ok', revision: 1 } },
  })),
  reorderAgentPresets: vi.fn(async () => ({
    status: 'accepted',
    result: { status: 'ok', revision: 1, event: { type: 'ok', revision: 1 } },
  })),
  setAgentPresetDefault: vi.fn(async () => ({
    status: 'accepted',
    result: { status: 'ok', revision: 1, event: { type: 'ok', revision: 1 } },
  })),
  createAgentPresetStep: vi.fn(
    async (): Promise<AgentPresetCommandMockResult> => ({
      status: 'accepted',
      result: { status: 'ok', revision: 1, event: { type: 'ok', revision: 1 } },
    }),
  ),
  updateAgentPresetStep: vi.fn(async () => ({
    status: 'accepted',
    result: { status: 'ok', revision: 1, event: { type: 'ok', revision: 1 } },
  })),
  duplicateAgentPresetStep: vi.fn(
    async (): Promise<AgentPresetCommandMockResult> => ({
      status: 'accepted',
      result: { status: 'ok', revision: 1, event: { type: 'ok', revision: 1 } },
    }),
  ),
  deleteAgentPresetStep: vi.fn(async () => ({
    status: 'accepted',
    result: { status: 'ok', revision: 1, event: { type: 'ok', revision: 1 } },
  })),
  reorderAgentPresetSteps: vi.fn(async () => ({
    status: 'accepted',
    result: { status: 'ok', revision: 1, event: { type: 'ok', revision: 1 } },
  })),
  currentPendingAgentPresetGeneratedProjectionLatch: vi.fn((): AgentPresetProjectionLatchMock | null => null),
  isAgentPresetGeneratedProjectionResolved: vi.fn((_latch: AgentPresetProjectionLatchMock) => false),
  mergePendingAgentPresetSettingsResource: vi.fn((value) => value),
  mergePendingAgentPresetLoadoutsResource: vi.fn((value) => value),
  mergePendingAgentPresetCharactersResource: vi.fn((value) => value),
}))
const hydrationSpies = vi.hoisted(() => ({
  ensureAllChatsHydrated: vi.fn(async () => undefined),
}))

vi.mock('src/ts/agentPresets', () => agentPresetSpies)
vi.mock('src/ts/server/chatMessageHydration.svelte', async (importOriginal) => ({
  ...(await importOriginal<typeof import('src/ts/server/chatMessageHydration.svelte')>()),
  ...hydrationSpies,
}))
vi.mock('src/ts/process/modules', () => ({
  applyModule: vi.fn(),
  exportModule: vi.fn(),
  getModuleAssets: vi.fn(() => []),
  getModuleLorebooks: vi.fn(() => []),
  getModuleRegexScripts: vi.fn(() => []),
  getModules: vi.fn(() => []),
  importModule: vi.fn(),
  moduleUpdate: vi.fn(),
  readModule: vi.fn(),
  refreshModules: vi.fn(),
}))

import AgentPresetSettings from './AgentPresetSettings.svelte'
import AgentPresetEditorDrawer from './AgentPresetEditorDrawer.svelte'
import { language } from 'src/lang'
import { getDatabase, setDatabaseLite, type Message } from 'src/ts/storage/database.svelte'
import type { AgentPresetRecord, AgentPresetStepRecord } from 'src/ts/agentPresetRecords'
import type { AgentPresetSnapshot } from 'src/ts/server/commands'

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

function diagnosticMessage(
  presetId: string,
  overrides: Record<string, unknown> = {},
  messageOverrides: Partial<Message> = {},
): Message {
  return {
    role: 'char',
    data: 'Assistant response',
    time: 1_700_000_000_000,
    generationInfo: {
      generationId: `generation-${presetId}`,
      model: 'main-model',
      agentPreset: {
        status: 'ready',
        presetId,
        presetName: 'Research Agent',
        presetVersion: 2,
        maxConcurrency: 2,
        beforeMainStepCount: 1,
        afterMainStepCount: 2,
        promptOutputKeys: ['context'],
        steps: [],
        finalTextModified: false,
        ...overrides,
      },
    },
    ...messageOverrides,
  }
}

function seedDb(agentPresets: AgentPresetRecord[] = []): void {
  setDatabaseLite({
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
  } as never)
}

function mountPage(): void {
  component = mount(AgentPresetSettings, { target })
}

function mountDrawer(record: AgentPresetRecord, onSave: (patch: AgentPresetSnapshot) => void | Promise<void>): void {
  component = mount(AgentPresetEditorDrawer, {
    target,
    props: {
      mode: 'edit',
      preset: record,
      onSave,
      onCancel: vi.fn(),
    },
  })
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

function descriptionInput(): HTMLTextAreaElement {
  const input = target.querySelector<HTMLTextAreaElement>('[data-risu-agent-preset-description-input]')
  expect(input).toBeTruthy()
  return input!
}

function metadataCheckbox(name: string): HTMLInputElement {
  const input = [...target.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find(
    (candidate) => candidate.getAttribute('aria-label') === name,
  )
  expect(input, `metadata checkbox ${name}`).toBeTruthy()
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

function stepDestinationSelect(): HTMLSelectElement {
  const element = [...target.querySelectorAll<HTMLSelectElement>('[data-risu-agent-preset-step-form] select')].find(
    (select) => {
      const optionValues = [...select.options].map((option) => option.value)
      return optionValues.includes('promptOutput') && optionValues.includes('intermediate')
    },
  )
  expect(element).toBeTruthy()
  return element!
}

function stepTextInput(value: string): HTMLInputElement {
  const element = [...target.querySelectorAll<HTMLInputElement>('[data-risu-agent-preset-step-form] input')].find(
    (input) => input.type === 'text' && input.value === value,
  )
  expect(element, `step text input with value ${value}`).toBeTruthy()
  return element!
}

function stepInstructionInput(): HTMLTextAreaElement {
  const element = target.querySelector<HTMLTextAreaElement>('[data-risu-agent-preset-step-form] textarea')
  expect(element).toBeTruthy()
  return element!
}

function stepNumberInput(label: string): HTMLInputElement {
  const element = [...target.querySelectorAll<HTMLLabelElement>('[data-risu-agent-preset-step-form] label')]
    .find((candidate) => candidate.textContent?.includes(label))
    ?.querySelector<HTMLInputElement>('input[type="number"]')
  expect(element, `step number input ${label}`).toBeTruthy()
  return element!
}

function stepCheckbox(name: string): HTMLInputElement {
  const element = [...target.querySelectorAll<HTMLInputElement>('[data-risu-agent-preset-step-form] input')].find(
    (input) => input.type === 'checkbox' && input.getAttribute('aria-label') === name,
  )
  expect(element, `step checkbox ${name}`).toBeTruthy()
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
  agentPresetSpies.currentPendingAgentPresetGeneratedProjectionLatch.mockReset().mockReturnValue(null)
  agentPresetSpies.isAgentPresetGeneratedProjectionResolved.mockReset().mockReturnValue(false)
  hydrationSpies.ensureAllChatsHydrated.mockReset().mockResolvedValue(undefined)
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
  setDatabaseLite({} as never)
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

  it('keeps the create editor open when an unresolved generated id blocks submission', async () => {
    seedDb([])
    const latch: AgentPresetProjectionLatchMock = {
      kind: 'preset',
      key: 'agent-preset:generated',
      baselineIds: [],
      expectedName: 'Earlier queued preset',
      semanticDescriptor: 'earlier',
    }
    agentPresetSpies.createAgentPreset.mockResolvedValueOnce({
      status: 'blocked',
      result: { status: 'unavailable' },
      projectionLatch: latch,
    })
    mountPage()
    await tick()

    button('[data-risu-agent-preset-create]').click()
    await tick()
    button('[data-risu-agent-preset-save]').click()
    await flushAsyncWork()

    expect(target.querySelector('[data-risu-agent-preset-editor]')).toBeTruthy()
    expect(target.textContent).toContain(language.agentPresets.commandBlocked)
    expect(target.textContent).not.toContain(language.agentPresets.commandQueued)
  })

  it('latches a queued create until its matching authoritative row arrives', async () => {
    seedDb([])
    const latch: AgentPresetProjectionLatchMock = {
      kind: 'preset',
      key: 'agent-preset:generated',
      baselineIds: [],
      expectedName: 'Research Preset',
      semanticDescriptor: 'Expected description',
    }
    agentPresetSpies.createAgentPreset.mockResolvedValueOnce({
      status: 'queued',
      result: { status: 'unavailable' },
      projectionLatch: latch,
    })
    agentPresetSpies.isAgentPresetGeneratedProjectionResolved.mockImplementation((candidate) => {
      const baselineIds = new Set(candidate.baselineIds)
      return getDatabase().agentPresets.some(
        (record) =>
          !baselineIds.has(record.id) &&
          record.name === candidate.expectedName &&
          record.description === candidate.semanticDescriptor,
      )
    })
    mountPage()
    await tick()

    button('[data-risu-agent-preset-create]').click()
    await tick()
    const input = nameInput()
    input.value = 'Research Preset'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    const description = target.querySelector<HTMLTextAreaElement>('[data-risu-agent-preset-description-input]')!
    description.value = 'Expected description'
    description.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()
    button('[data-risu-agent-preset-save]').click()
    await flushAsyncWork()

    expect(target.querySelector('[data-risu-agent-preset-editor]')).toBeNull()
    expect(target.textContent).toContain(language.agentPresets.commandQueued)
    expect(button('[data-risu-agent-preset-create]').disabled).toBe(true)
    button('[data-risu-agent-preset-create]').click()
    expect(agentPresetSpies.createAgentPreset).toHaveBeenCalledTimes(1)

    unmount(component!)
    component = undefined
    target.innerHTML = ''
    agentPresetSpies.currentPendingAgentPresetGeneratedProjectionLatch.mockReturnValue(latch)
    mountPage()
    await tick()
    expect(target.textContent).toContain(language.agentPresets.commandQueued)
    expect(button('[data-risu-agent-preset-create]').disabled).toBe(true)

    getDatabase().agentPresets = [
      preset({ id: 'ap_unrelated', name: 'Research Preset', description: 'Different description' }),
    ]
    await tick()
    expect(button('[data-risu-agent-preset-create]').disabled).toBe(true)

    getDatabase().agentPresets = [
      preset({ id: 'ap_unrelated', name: 'Research Preset', description: 'Different description' }),
      preset({ id: 'ap_created', name: 'Research Preset', description: 'Expected description' }),
    ]
    await tick()
    expect(button('[data-risu-agent-preset-create]').disabled).toBe(false)
    expect(target.textContent).not.toContain(language.agentPresets.commandQueued)
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

    expect(agentPresetSpies.updateAgentPreset).toHaveBeenCalledWith('ap_a', { name: 'Renamed Agent' })

    rowButton('ap_a', '[data-risu-agent-preset-delete]').click()
    await flushAsyncWork()

    expect(window.confirm).toHaveBeenCalledWith(language.agentPresets.deletePresetConfirm('Research Agent'))
    expect(agentPresetSpies.deleteAgentPreset).toHaveBeenCalledWith('ap_a')
  })

  it('disables default selection while another preset command is pending', async () => {
    type ReorderResult = Awaited<ReturnType<typeof agentPresetSpies.reorderAgentPresets>>
    let resolveReorder!: (result: ReorderResult) => void
    agentPresetSpies.reorderAgentPresets.mockImplementationOnce(
      () =>
        new Promise<ReorderResult>((resolve) => {
          resolveReorder = resolve
        }),
    )
    seedDb([preset({ id: 'ap_a', name: 'Research Agent' }), preset({ id: 'ap_b', name: 'Critique Agent' })])
    mountPage()
    await tick()

    rowButton('ap_a', '[data-risu-agent-preset-move-down]').click()
    await tick()

    const defaultSelect = target.querySelector<HTMLSelectElement>('[data-risu-agent-preset-default-select] select')
    expect(defaultSelect).toBeTruthy()
    expect(defaultSelect!.disabled).toBe(true)

    resolveReorder({
      status: 'accepted',
      result: { status: 'ok', revision: 1, event: { type: 'ok', revision: 1 } },
    })
    await flushAsyncWork()

    expect(defaultSelect!.disabled).toBe(false)
  })

  it('disables and suppresses an unchanged metadata save', async () => {
    seedDb([preset({ id: 'ap_a', name: 'Research Agent', description: 'Existing description' })])
    mountPage()
    await tick()

    rowButton('ap_a', '[data-risu-agent-preset-edit]').click()
    await tick()

    const save = button('[data-risu-agent-preset-save]')
    expect(save.disabled).toBe(true)
    save.click()
    await flushAsyncWork()

    expect(agentPresetSpies.updateAgentPreset).not.toHaveBeenCalled()
  })

  it('sends an explicit metadata clear without unchanged siblings', async () => {
    seedDb([
      preset({
        id: 'ap_a',
        name: 'Research Agent',
        description: 'Existing description',
        maxConcurrency: 6,
      }),
    ])
    mountPage()
    await tick()

    rowButton('ap_a', '[data-risu-agent-preset-edit]').click()
    await tick()

    const description = descriptionInput()
    description.value = ''
    description.dispatchEvent(new Event('input', { bubbles: true }))
    metadataCheckbox(language.agentPresets.limitConcurrency).click()
    await tick()

    button('[data-risu-agent-preset-save]').click()
    await flushAsyncWork()

    expect(agentPresetSpies.updateAgentPreset).toHaveBeenCalledWith('ap_a', {
      description: null,
      maxConcurrency: null,
    })
  })

  it('resets metadata dirty state when the saved draft is reprojected', async () => {
    const initial = preset({ id: 'ap_a', name: 'Research Agent', description: 'Existing description' })
    seedDb([initial])
    const onSave = vi.fn(async (patch: AgentPresetSnapshot) => {
      const current = getDatabase().agentPresets[0]
      getDatabase().agentPresets = [{ ...current, ...patch } as AgentPresetRecord]
    })
    mountDrawer(initial, onSave)
    await tick()

    const input = nameInput()
    input.value = 'Reprojected Agent'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()

    const save = button('[data-risu-agent-preset-save]')
    expect(save.disabled).toBe(false)
    save.click()
    await flushAsyncWork()

    expect(onSave).toHaveBeenCalledWith({ name: 'Reprojected Agent' })
    expect(save.disabled).toBe(true)

    save.click()
    await flushAsyncWork()
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('keeps metadata dirty while an optimistic projection is still unsettled', async () => {
    const initial = preset({ id: 'ap_a', name: 'Research Agent' })
    seedDb([initial])
    let settleUpdate!: () => void
    const pendingUpdate = new Promise<void>((resolve) => {
      settleUpdate = resolve
    })
    agentPresetSpies.updateAgentPreset.mockImplementationOnce(async () => {
      const current = getDatabase().agentPresets[0]
      getDatabase().agentPresets = [{ ...current, name: 'Pending Agent' } as AgentPresetRecord]
      await pendingUpdate
      return { status: 'failed', result: { status: 'error', error: 'rejected' } }
    })
    vi.mocked(window.confirm).mockReturnValue(false)
    mountPage()
    await tick()

    rowButton('ap_a', '[data-risu-agent-preset-edit]').click()
    await tick()
    const input = nameInput()
    input.value = 'Pending Agent'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()
    const save = button('[data-risu-agent-preset-save]')
    save.click()
    await tick()

    const controls = target.querySelector<HTMLFieldSetElement>('[data-risu-agent-preset-controls]')
    expect(controls).toBeTruthy()
    expect(controls!.disabled).toBe(true)
    expect(controls!.contains(input)).toBe(true)
    expect(controls!.contains(descriptionInput())).toBe(true)
    expect(controls!.contains(metadataCheckbox(language.agentPresets.enabledLabel))).toBe(true)

    const close = target.querySelector<HTMLButtonElement>(
      `[data-risu-agent-preset-editor] button[aria-label="${language.modelRoles.close}"]`,
    )
    expect(close).toBeTruthy()
    expect(close!.matches(':disabled')).toBe(true)
    close!.click()
    await tick()
    expect(window.confirm).not.toHaveBeenCalled()
    expect(target.querySelector('[data-risu-agent-preset-editor]')).toBeTruthy()

    settleUpdate()
    await flushAsyncWork()
    expect(controls!.disabled).toBe(false)
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

  it('offers user input only to before-main steps and saves it as the destination', async () => {
    seedDb([preset({ id: 'ap_a', name: 'Research Agent', steps: [baseStep()] })])
    mountPage()
    await tick()

    rowButton('ap_a', '[data-risu-agent-preset-edit]').click()
    await tick()
    stepEditButton().click()
    await tick()

    const destination = stepDestinationSelect()
    expect([...destination.options].map((option) => option.value)).toEqual([
      'promptOutput',
      'intermediate',
      'userInput',
    ])
    destination.value = 'userInput'
    destination.dispatchEvent(new Event('change', { bubbles: true }))
    await tick()

    button('[data-risu-agent-preset-step-save]').click()
    await flushAsyncWork()

    expect(agentPresetSpies.updateAgentPresetStep).toHaveBeenCalledWith('ap_a', 'aps_a', {
      destination: 'userInput',
    })
  })

  it('hides the preset save button while the step editor is open', async () => {
    seedDb([preset({ id: 'ap_a', name: 'Research Agent', steps: [baseStep()] })])
    mountPage()
    await tick()

    rowButton('ap_a', '[data-risu-agent-preset-edit]').click()
    await tick()

    expect(target.querySelector('[data-risu-agent-preset-save]')).toBeTruthy()

    stepEditButton().click()
    await tick()

    expect(target.querySelector('[data-risu-agent-preset-step-save]')).toBeTruthy()
    expect(target.querySelector('[data-risu-agent-preset-save]')).toBeNull()

    button('[data-risu-agent-preset-step-cancel]').click()
    await tick()

    expect(target.querySelector('[data-risu-agent-preset-step-form]')).toBeNull()
    expect(target.querySelector('[data-risu-agent-preset-save]')).toBeTruthy()
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

    expect(agentPresetSpies.updateAgentPresetStep).toHaveBeenCalledWith('ap_a', 'aps_after', {
      phase: 'beforeMain',
      inputScopes: [],
    })
  })

  it('refreshes the open editor step list when projection replaces the preset record', async () => {
    seedDb([preset({ id: 'ap_a', name: 'Research Agent', steps: [baseStep()] })])
    mountPage()
    await tick()

    rowButton('ap_a', '[data-risu-agent-preset-edit]').click()
    await tick()

    expect(target.textContent).toContain('Gather Context')
    expect(target.textContent).not.toContain('Review Draft')

    getDatabase().agentPresets = [
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

  it('creates steps with the complete normalized row', async () => {
    seedDb([preset({ id: 'ap_a', name: 'Research Agent', steps: [baseStep()] })])
    mountPage()
    await tick()

    rowButton('ap_a', '[data-risu-agent-preset-edit]').click()
    await tick()
    target.querySelector<HTMLButtonElement>('[data-risu-agent-preset-step-editor] button')?.click()
    await tick()

    button('[data-risu-agent-preset-step-save]').click()
    await flushAsyncWork()

    expect(agentPresetSpies.createAgentPresetStep).toHaveBeenCalledWith('ap_a', {
      name: 'Step 2',
      enabled: true,
      phase: 'beforeMain',
      dependencies: [],
      instruction: '',
      model: { mode: 'inheritMain' },
      runtime: {
        timeoutMs: 30_000,
        maxInputChars: 24_000,
        maxOutputChars: 1_200,
        temperature: 100,
      },
      inputScopes: ['currentUserMessage'],
      outputKey: 'step_2',
      outputFormat: 'text',
      destination: 'promptOutput',
      failurePolicy: { mode: 'required' },
    })
    expect(agentPresetSpies.updateAgentPresetStep).not.toHaveBeenCalled()
  })

  it('closes and latches a queued step create until the matching step is projected', async () => {
    const original = preset({ id: 'ap_a', name: 'Research Agent', steps: [baseStep()] })
    seedDb([original])
    const latch: AgentPresetProjectionLatchMock = {
      kind: 'step',
      key: 'agent-preset:generated-step:ap_a',
      presetId: 'ap_a',
      baselineIds: ['aps_a'],
      expectedName: 'Step 2',
      expectedOutputKey: 'step_2',
      semanticDescriptor: '',
      compareOutputKey: true,
    }
    agentPresetSpies.createAgentPresetStep.mockResolvedValueOnce({
      status: 'queued',
      result: { status: 'unavailable' },
      projectionLatch: latch,
    })
    agentPresetSpies.isAgentPresetGeneratedProjectionResolved.mockImplementation((candidate) => {
      if (candidate.kind !== 'step') return false
      const baselineIds = new Set(candidate.baselineIds)
      const record = getDatabase().agentPresets.find((presetRecord) => presetRecord.id === candidate.presetId)
      return !!record?.steps.some(
        (stepRecord) =>
          !baselineIds.has(stepRecord.id) &&
          stepRecord.name === candidate.expectedName &&
          (!candidate.expectedOutputKey || stepRecord.outputKey === candidate.expectedOutputKey) &&
          stepRecord.instruction === candidate.semanticDescriptor,
      )
    })
    mountPage()
    await tick()

    rowButton('ap_a', '[data-risu-agent-preset-edit]').click()
    await tick()
    target.querySelector<HTMLButtonElement>('[data-risu-agent-preset-step-editor] button')?.click()
    await tick()
    button('[data-risu-agent-preset-step-save]').click()
    await flushAsyncWork()

    expect(agentPresetSpies.createAgentPresetStep).toHaveBeenCalledTimes(1)
    expect(target.querySelector('[data-risu-agent-preset-editor]')).toBeNull()
    expect(target.textContent).toContain(language.agentPresets.commandQueued)
    expect(button('[data-risu-agent-preset-create]').disabled).toBe(true)

    getDatabase().agentPresets = [
      preset({
        id: 'ap_a',
        name: 'Research Agent',
        steps: [
          baseStep(),
          baseStep({
            id: 'aps_other',
            name: 'Step 2',
            outputKey: 'step_2',
            instruction: 'Different instruction',
          }),
        ],
      }),
    ]
    await tick()
    expect(button('[data-risu-agent-preset-create]').disabled).toBe(true)

    getDatabase().agentPresets = [
      preset({
        id: 'ap_a',
        name: 'Research Agent',
        steps: [
          baseStep(),
          baseStep({
            id: 'aps_other',
            name: 'Step 2',
            outputKey: 'step_2',
            instruction: 'Different instruction',
          }),
          baseStep({
            id: 'aps_created',
            name: 'Step 2',
            outputKey: 'step_2',
            instruction: '',
          }),
        ],
      }),
    ]
    await tick()
    expect(button('[data-risu-agent-preset-create]').disabled).toBe(false)
    expect(target.textContent).not.toContain(language.agentPresets.commandQueued)
  })

  it('sends only a changed step name and omits large unchanged fields', async () => {
    const instruction = 'Large unchanged agent instruction. '.repeat(10_000)
    seedDb([
      preset({
        id: 'ap_a',
        name: 'Research Agent',
        steps: [
          baseStep({
            instruction,
            runtime: {
              timeoutMs: 120_000,
              maxInputChars: 100_000,
              maxOutputChars: 20_000,
              temperature: 150,
            },
            inputScopes: ['recentChatTail', 'currentUserMessage'],
            failurePolicy: { mode: 'fallbackText', text: 'Large fallback. '.repeat(2_000) },
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

    const input = stepTextInput('Gather Context')
    input.value = 'Renamed Context Step'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()

    button('[data-risu-agent-preset-step-save]').click()
    await flushAsyncWork()

    expect(agentPresetSpies.updateAgentPresetStep).toHaveBeenCalledWith('ap_a', 'aps_a', {
      name: 'Renamed Context Step',
    })
  })

  it('preserves unedited runtime fields when changing a rendered runtime value', async () => {
    seedDb([
      preset({
        id: 'ap_a',
        name: 'Research Agent',
        steps: [
          baseStep({
            runtime: {
              timeoutMs: 120_000,
              maxInputChars: 100_000,
              maxOutputChars: 20_000,
              temperature: 150,
              structuredOutputStrict: true,
            },
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

    const timeout = stepNumberInput(language.agentPresets.timeoutMsLabel)
    timeout.value = '90000'
    timeout.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()

    button('[data-risu-agent-preset-step-save]').click()
    await flushAsyncWork()

    expect(agentPresetSpies.updateAgentPresetStep).toHaveBeenCalledWith('ap_a', 'aps_a', {
      runtime: {
        timeoutMs: 90_000,
        maxInputChars: 100_000,
        maxOutputChars: 20_000,
        temperature: 150,
        structuredOutputStrict: true,
      },
    })
  })

  it('locks every step editor control while a step save is pending', async () => {
    let settleUpdate!: () => void
    const pendingUpdate = new Promise<void>((resolve) => {
      settleUpdate = resolve
    })
    agentPresetSpies.updateAgentPresetStep.mockImplementationOnce(async () => {
      await pendingUpdate
      return {
        status: 'accepted',
        result: { status: 'ok', revision: 2, event: { type: 'ok', revision: 2 } },
      }
    })
    seedDb([preset({ id: 'ap_a', name: 'Research Agent', steps: [baseStep()] })])
    mountPage()
    await tick()

    rowButton('ap_a', '[data-risu-agent-preset-edit]').click()
    await tick()
    stepEditButton().click()
    await tick()

    const name = stepTextInput('Gather Context')
    name.value = 'Pending Context Step'
    name.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()

    button('[data-risu-agent-preset-step-save]').click()
    await tick()

    const controls = target.querySelector<HTMLFieldSetElement>('[data-risu-agent-preset-controls]')
    expect(controls).toBeTruthy()
    expect(controls!.disabled).toBe(true)
    expect(controls!.contains(name)).toBe(true)
    expect(controls!.contains(stepInstructionInput())).toBe(true)
    expect(controls!.contains(stepPhaseSelect())).toBe(true)
    expect(controls!.contains(stepCheckbox(language.agentPresets.stepEnabledLabel))).toBe(true)

    settleUpdate()
    await flushAsyncWork()

    expect(agentPresetSpies.updateAgentPresetStep).toHaveBeenCalledWith('ap_a', 'aps_a', {
      name: 'Pending Context Step',
    })
    expect(target.querySelector('[data-risu-agent-preset-step-form]')).toBeNull()
  })

  it('sends multiple changed fields while preserving false and empty values', async () => {
    seedDb([
      preset({
        id: 'ap_a',
        name: 'Research Agent',
        steps: [baseStep({ inputScopes: ['currentUserMessage'] })],
      }),
    ])
    mountPage()
    await tick()

    rowButton('ap_a', '[data-risu-agent-preset-edit]').click()
    await tick()
    stepEditButton().click()
    await tick()

    stepCheckbox(language.agentPresets.stepEnabledLabel).click()
    const instruction = stepInstructionInput()
    instruction.value = ''
    instruction.dispatchEvent(new Event('input', { bubbles: true }))
    const currentUserMessage = target.querySelector<HTMLInputElement>(
      '[data-risu-agent-preset-input-scope="currentUserMessage"] input[type="checkbox"]',
    )
    expect(currentUserMessage).toBeTruthy()
    currentUserMessage!.click()
    await tick()

    button('[data-risu-agent-preset-step-save]').click()
    await flushAsyncWork()

    expect(agentPresetSpies.updateAgentPresetStep).toHaveBeenCalledWith('ap_a', 'aps_a', {
      enabled: false,
      instruction: '',
      inputScopes: [],
    })
  })

  it('does not send an update when normalization returns the step to its initial snapshot', async () => {
    seedDb([preset({ id: 'ap_a', name: 'Research Agent', steps: [baseStep()] })])
    mountPage()
    await tick()

    rowButton('ap_a', '[data-risu-agent-preset-edit]').click()
    await tick()
    stepEditButton().click()
    await tick()

    const input = stepTextInput('Gather Context')
    input.value = '  Gather Context  '
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()

    button('[data-risu-agent-preset-step-save]').click()
    await flushAsyncWork()

    expect(agentPresetSpies.updateAgentPresetStep).not.toHaveBeenCalled()
    expect(target.querySelector('[data-risu-agent-preset-step-form]')).toBeNull()
  })

  it('sends only the changed output key for a normalized step with defaulted runtime fields', async () => {
    seedDb([preset({ id: 'ap_a', name: 'Research Agent', steps: [baseStep()] })])
    mountPage()
    await tick()

    rowButton('ap_a', '[data-risu-agent-preset-edit]').click()
    await tick()
    stepEditButton().click()
    await tick()

    const outputKeyInput = stepTextInput('context')
    outputKeyInput.value = 'context_brief'
    outputKeyInput.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()

    button('[data-risu-agent-preset-step-save]').click()
    await flushAsyncWork()

    expect(agentPresetSpies.updateAgentPresetStep).toHaveBeenCalledWith('ap_a', 'aps_a', {
      outputKey: 'context_brief',
    })
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

  it('loads and renders matching hidden Agent Preset diagnostics on demand', async () => {
    seedDb([preset({ id: 'ap_a', name: 'Research Agent', steps: [baseStep()] })])
    hydrationSpies.ensureAllChatsHydrated.mockImplementationOnce(async () => {
      getDatabase().characters[0].name = 'Aster'
      getDatabase().characters[0].chats[0].name = 'Investigation'
      getDatabase().characters[0].chats[0].message = [
        diagnosticMessage('ap_other', {
          steps: [{ status: 'success', outputPreview: 'Unrelated hidden result' }],
        }),
        diagnosticMessage('ap_a', {
          finalTextModified: true,
          mainOutputPreview: 'Original main draft',
          mainOutputChars: 19,
          failure: {
            phase: 'afterMain',
            stepId: 'aps_failure',
            stepName: 'Required Review',
            message: 'Review stopped the run.',
            failureKind: 'provider_error',
            failurePolicyOutcome: 'required_failure',
          },
          steps: [
            {
              status: 'success',
              stepId: 'aps_success',
              stepName: 'Gather Context',
              phase: 'beforeMain',
              outputKey: 'context',
              destination: 'promptOutput',
              outputFormat: 'text',
              failurePolicy: 'required',
              inputChars: 120,
              outputChars: 20,
              durationMs: 15,
              provider: 'openai',
              profileName: 'Agent Profile',
              modelId: 'agent-model',
              parseStatus: 'not_applicable',
              preparedInputSections: [
                {
                  scope: 'currentUserMessage',
                  sourceLabel: 'Current user message',
                  charCount: 120,
                  truncated: false,
                },
              ],
              preparedInputDiagnostics: [
                { scope: 'memoryContext', reason: 'empty', message: 'No saved memory was available.' },
              ],
              outputPreview: '<script>hidden context</script>',
              outputTruncated: false,
            },
            {
              status: 'failed',
              stepId: 'aps_failure',
              stepName: 'Required Review',
              phase: 'afterMain',
              outputKey: 'review',
              destination: 'intermediate',
              outputFormat: 'jsonObject',
              failurePolicy: 'required',
              inputChars: 220,
              outputChars: 0,
              durationMs: 1_500,
              preparedInputSections: [],
              preparedInputDiagnostics: [],
              failureKind: 'provider_error',
              failurePolicyOutcome: 'required_failure',
              error: 'Provider rejected the request.',
            },
            {
              status: 'skipped',
              stepId: 'aps_skipped',
              stepName: 'Final Rewrite',
              phase: 'afterMain',
              outputKey: 'final',
              destination: 'finalOutput',
              outputFormat: 'text',
              failurePolicy: 'required',
              inputChars: 0,
              outputChars: 0,
              durationMs: 0,
              preparedInputSections: [],
              preparedInputDiagnostics: [],
              reason: 'dependency_skipped',
              error: 'Required Review did not complete.',
            },
          ],
        }),
      ]
    })
    mountPage()
    await tick()

    rowButton('ap_a', '[data-risu-agent-preset-edit]').click()
    await tick()

    expect(target.querySelector('[data-risu-agent-preset-diagnostics-panel]')).toBeNull()
    expect(hydrationSpies.ensureAllChatsHydrated).not.toHaveBeenCalled()

    const openDiagnosticsButton = button('[data-risu-agent-preset-open-diagnostics]')
    expect(openDiagnosticsButton.getAttribute('aria-expanded')).toBe('false')
    expect(openDiagnosticsButton.getAttribute('aria-controls')).toBe('agent-preset-diagnostics-panel')
    openDiagnosticsButton.click()
    await flushAsyncWork()

    expect(hydrationSpies.ensureAllChatsHydrated).toHaveBeenCalledWith({ strict: true })
    expect(target.querySelector('[data-risu-agent-preset-diagnostics-panel]')).toBeTruthy()
    expect(openDiagnosticsButton.getAttribute('aria-expanded')).toBe('true')
    expect(target.querySelectorAll('[data-risu-agent-preset-diagnostic-run]')).toHaveLength(1)
    expect(target.textContent).toContain('Aster · Investigation')
    expect(target.textContent).toContain('Gather Context')
    expect(target.textContent).toContain(language.agentPresets.diagnosticStepStatuses.success)
    expect(target.textContent).toContain(language.agentPresets.diagnosticStepStatuses.failed)
    expect(target.textContent).toContain(language.agentPresets.diagnosticStepStatuses.skipped)
    expect(target.textContent).toContain('<script>hidden context</script>')
    expect(target.querySelector('script')).toBeNull()
    expect(target.textContent).toContain('Provider rejected the request.')
    expect(target.textContent).toContain('Required Review did not complete.')
    expect(target.textContent).toContain('No saved memory was available.')
    expect(target.textContent).toContain('Original main draft')
    expect(target.textContent).toContain('Review stopped the run.')
    expect(target.textContent).not.toContain('Unrelated hidden result')
  })

  it('keeps diagnostics closed for new presets and surfaces history hydration errors', async () => {
    seedDb([preset({ id: 'ap_a', name: 'Research Agent' })])
    mountPage()
    await tick()

    button('[data-risu-agent-preset-create]').click()
    await tick()

    const createDiagnosticsButton = button('[data-risu-agent-preset-open-diagnostics]')
    expect(createDiagnosticsButton.disabled).toBe(true)
    createDiagnosticsButton.click()
    await flushAsyncWork()
    expect(hydrationSpies.ensureAllChatsHydrated).not.toHaveBeenCalled()

    button('[data-risu-agent-preset-cancel]').click()
    await tick()
    rowButton('ap_a', '[data-risu-agent-preset-edit]').click()
    await tick()
    hydrationSpies.ensureAllChatsHydrated.mockRejectedValueOnce(new Error('Bulk history unavailable'))

    button('[data-risu-agent-preset-open-diagnostics]').click()
    await flushAsyncWork()

    expect(target.textContent).toContain(language.agentPresets.diagnosticsLoadError)
    expect(target.textContent).toContain('Bulk history unavailable')
    expect(target.textContent).toContain(language.agentPresets.diagnosticsPending)
  })

  it('contains drawer focus and restores the edit trigger after Escape', async () => {
    seedDb([preset({ id: 'ap_a', name: 'Research Agent' })])
    mountPage()
    await tick()

    const editTrigger = rowButton('ap_a', '[data-risu-agent-preset-edit]')
    editTrigger.focus()
    editTrigger.click()
    await flushAsyncWork()

    const dialog = target.querySelector<HTMLElement>('[role="dialog"]')
    const backdrop = dialog?.parentElement
    const initialFocus = dialog?.querySelector<HTMLElement>('[data-modal-initial-focus]')
    if (!dialog || !backdrop || !initialFocus) throw new Error('Agent Preset editor modal not found')
    expect(backdrop.hasAttribute('data-modal-root')).toBe(true)
    expect(backdrop.hasAttribute('role')).toBe(false)
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(document.activeElement).toBe(initialFocus)

    let backgroundBranch: HTMLElement = editTrigger
    while (backgroundBranch.parentElement && backgroundBranch.parentElement !== backdrop.parentElement) {
      backgroundBranch = backgroundBranch.parentElement
    }
    expect(backgroundBranch.inert).toBe(true)

    editTrigger.focus()
    expect(document.activeElement).toBe(initialFocus)

    const escape = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Escape' })
    initialFocus.dispatchEvent(escape)
    await flushAsyncWork()

    expect(escape.defaultPrevented).toBe(true)
    expect(target.querySelector('[role="dialog"]')).toBeNull()
    expect(backgroundBranch.inert).toBe(false)
    expect(document.activeElement).toBe(editTrigger)
  })

  it('uses Escape to cancel the inline step editor before closing its parent drawer', async () => {
    seedDb([preset({ id: 'ap_a', name: 'Research Agent' })])
    mountPage()
    await tick()

    rowButton('ap_a', '[data-risu-agent-preset-edit]').click()
    await tick()
    const createStep = Array.from(target.querySelectorAll<HTMLButtonElement>('button')).find((candidate) =>
      candidate.textContent?.includes(language.agentPresets.createStep),
    )
    if (!createStep) throw new Error('Create step button not found')
    createStep.click()
    await tick()

    const dialog = target.querySelector<HTMLElement>('[data-risu-agent-preset-editor]')
    if (!dialog) throw new Error('Agent Preset editor not found')
    dialog.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Escape' }))
    await tick()

    expect(window.confirm).not.toHaveBeenCalled()
    expect(target.querySelector('[data-risu-agent-preset-step-form]')).toBeNull()
    expect(target.querySelector('[data-risu-agent-preset-editor]')).toBe(dialog)

    createStep.click()
    await tick()
    const stepName = target.querySelector<HTMLInputElement>('[data-risu-agent-preset-step-form] input')
    if (!stepName) throw new Error('Step name input not found')
    stepName.value = 'Unsaved step'
    stepName.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()

    vi.mocked(window.confirm).mockReturnValueOnce(false)
    dialog.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Escape' }))
    await tick()
    expect(window.confirm).toHaveBeenCalledWith(language.agentPresets.discardStepChangesConfirm)
    expect(target.querySelector('[data-risu-agent-preset-step-form]')).toBeTruthy()
    expect(target.querySelector('[data-risu-agent-preset-editor]')).toBe(dialog)

    vi.mocked(window.confirm).mockReturnValueOnce(true)
    dialog.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Escape' }))
    await tick()
    expect(target.querySelector('[data-risu-agent-preset-step-form]')).toBeNull()
    expect(target.querySelector('[data-risu-agent-preset-editor]')).toBe(dialog)
  })
})
