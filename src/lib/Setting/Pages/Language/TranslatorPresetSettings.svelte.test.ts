import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const commandSpies = vi.hoisted(() => {
  const createDeferredCommandResult = () => {
    let resolve: (result: Record<string, unknown>) => void = () => {}
    const promise = new Promise<Record<string, unknown>>((resolvePromise) => {
      resolve = resolvePromise
    })
    return { promise, resolve }
  }

  const spies = {
    failNextCreate: false,
    failNextDelete: false,
    failNextSelect: false,
    failNextUpdate: false,
    contradictNextUpdateReceipt: false,
    deferNextCreate: false,
    deferNextDelete: false,
    deferNextSelect: false,
    deferNextUpdate: false,
    nextBaseRevision: 100,
    runInputs: [] as Array<{ rollback?: () => void }>,
    createInputs: [] as Array<{ baseRevision: number; preset: Record<string, unknown>; select?: boolean }>,
    deleteInputs: [] as Array<{ baseRevision: number; presetId: string; selectPresetId?: string }>,
    selectInputs: [] as Array<{ baseRevision: number; presetId: string }>,
    updateInputs: [] as Array<{ baseRevision: number; presetId: string; patch: Record<string, unknown> }>,
    updateAcknowledgements: [] as Array<Record<string, unknown> | undefined>,
    localEffectListeners: new Set<(event: Record<string, unknown>, localEffect: Record<string, unknown>) => void>(),
    deferredCreateResults: [] as Array<ReturnType<typeof createDeferredCommandResult>>,
    deferredDeleteResults: [] as Array<ReturnType<typeof createDeferredCommandResult>>,
    deferredSelectResults: [] as Array<ReturnType<typeof createDeferredCommandResult>>,
    deferredUpdateResults: [] as Array<ReturnType<typeof createDeferredCommandResult>>,
    canUseServerCommands: vi.fn(() => true),
    runServerCommand: vi.fn(),
    createTranslatorPresetCommand: vi.fn(),
    deleteTranslatorPresetCommand: vi.fn(),
    selectTranslatorPresetCommand: vi.fn(),
    updateTranslatorPresetCommand: vi.fn(),
    subscribeServerCommandLocalEffectApplied: vi.fn(),
  }

  spies.subscribeServerCommandLocalEffectApplied.mockImplementation(
    (listener: (event: Record<string, unknown>, localEffect: Record<string, unknown>) => void) => {
      spies.localEffectListeners.add(listener)
      return () => spies.localEffectListeners.delete(listener)
    },
  )

  spies.runServerCommand.mockImplementation(
    async (input: { command: (baseRevision: number) => Promise<unknown>; rollback?: () => void }) => {
      spies.runInputs.push({ rollback: input.rollback })
      const result = (await input.command(spies.nextBaseRevision++)) as { status?: string }
      if (result.status !== 'ok') {
        input.rollback?.()
      }
      return result
    },
  )
  spies.updateTranslatorPresetCommand.mockImplementation(
    async (input: {
      baseRevision: number
      presetId: string
      patch: Record<string, unknown>
      optimisticAcknowledgement?: Record<string, unknown>
    }) => {
      const { optimisticAcknowledgement, ...wireInput } = input
      spies.updateInputs.push(wireInput)
      spies.updateAcknowledgements.push(optimisticAcknowledgement)
      if (spies.deferNextUpdate) {
        spies.deferNextUpdate = false
        const deferred = createDeferredCommandResult()
        spies.deferredUpdateResults.push(deferred)
        return deferred.promise
      }
      if (spies.failNextUpdate) {
        spies.failNextUpdate = false
        return { status: 'error', error: 'forced failure' }
      }
      const selectedPresetId = spies.contradictNextUpdateReceipt
        ? 'contradictory-selection'
        : optimisticAcknowledgement?.selectedPresetId
      spies.contradictNextUpdateReceipt = false
      return {
        status: 'ok',
        revision: input.baseRevision + 1,
        event: {
          type: 'translatorPreset.updated',
          revision: input.baseRevision + 1,
          resource: 'translatorPreset',
          id: input.presetId,
        },
        presetId: input.presetId,
        acknowledgedKeys: Object.keys(input.patch),
        selectedPresetId,
      }
    },
  )
  spies.createTranslatorPresetCommand.mockImplementation(
    async (input: { baseRevision: number; preset: Record<string, unknown>; select?: boolean }) => {
      spies.createInputs.push(input)
      if (spies.deferNextCreate) {
        spies.deferNextCreate = false
        const deferred = createDeferredCommandResult()
        spies.deferredCreateResults.push(deferred)
        return deferred.promise
      }
      if (spies.failNextCreate) {
        spies.failNextCreate = false
        return { status: 'error', error: 'forced create failure' }
      }
      return {
        status: 'ok',
        revision: input.baseRevision + 1,
        event: {
          type: 'translatorPreset.created',
          revision: input.baseRevision + 1,
          resource: 'translatorPreset',
        },
      }
    },
  )
  spies.deleteTranslatorPresetCommand.mockImplementation(
    async (input: { baseRevision: number; presetId: string; selectPresetId?: string }) => {
      spies.deleteInputs.push(input)
      if (spies.deferNextDelete) {
        spies.deferNextDelete = false
        const deferred = createDeferredCommandResult()
        spies.deferredDeleteResults.push(deferred)
        return deferred.promise
      }
      if (spies.failNextDelete) {
        spies.failNextDelete = false
        return { status: 'error', error: 'forced delete failure' }
      }
      return {
        status: 'ok',
        revision: input.baseRevision + 1,
        event: {
          type: 'translatorPreset.deleted',
          revision: input.baseRevision + 1,
          resource: 'translatorPreset',
          id: input.presetId,
        },
      }
    },
  )
  spies.selectTranslatorPresetCommand.mockImplementation(async (input: { baseRevision: number; presetId: string }) => {
    spies.selectInputs.push(input)
    if (spies.deferNextSelect) {
      spies.deferNextSelect = false
      const deferred = createDeferredCommandResult()
      spies.deferredSelectResults.push(deferred)
      return deferred.promise
    }
    if (spies.failNextSelect) {
      spies.failNextSelect = false
      return { status: 'error', error: 'forced select failure' }
    }
    return {
      status: 'ok',
      revision: input.baseRevision + 1,
      event: {
        type: 'translatorPreset.selected',
        revision: input.baseRevision + 1,
        resource: 'translatorPreset',
        id: input.presetId,
      },
    }
  })

  return spies
})

vi.mock('src/ts/server/commands', () => ({
  canUseServerCommands: commandSpies.canUseServerCommands,
  createTranslatorPresetCommand: commandSpies.createTranslatorPresetCommand,
  deleteTranslatorPresetCommand: commandSpies.deleteTranslatorPresetCommand,
  runServerCommand: commandSpies.runServerCommand,
  selectTranslatorPresetCommand: commandSpies.selectTranslatorPresetCommand,
  subscribeServerCommandLocalEffectApplied: commandSpies.subscribeServerCommandLocalEffectApplied,
  updateTranslatorPresetCommand: commandSpies.updateTranslatorPresetCommand,
}))

vi.mock('src/ts/process/modules', () => ({
  getModuleAssets: vi.fn(() => []),
  getModuleLorebooks: vi.fn(() => []),
  getModuleRegexScripts: vi.fn(() => []),
  getModules: vi.fn(() => []),
  moduleUpdate: vi.fn(),
}))

vi.mock('src/ts/alert', () => ({
  alertConfirm: vi.fn(async () => false),
  alertError: vi.fn(),
  alertInput: vi.fn(async () => null),
  alertNormal: vi.fn(),
}))

vi.mock('src/ts/globalApi.svelte', async (importActual) => {
  const actual = await importActual<typeof import('src/ts/globalApi.svelte')>()
  return {
    ...actual,
    downloadFile: vi.fn(),
  }
})

vi.mock('src/ts/util', async (importActual) => {
  const actual = await importActual<typeof import('src/ts/util')>()
  return {
    ...actual,
    selectSingleFile: vi.fn(async () => null),
  }
})

import TranslatorPresetSettings from './TranslatorPresetSettings.svelte'
import { alertConfirm, alertInput } from 'src/ts/alert'
import { getDatabase, setDatabaseLite } from 'src/ts/storage/database.svelte'
import {
  isCollectionAcknowledgementTainted,
  isSettingsGroupAcknowledgementTainted,
  resetServerResourceState,
} from 'src/ts/server/resourceState.svelte'
import {
  setResourceWriteGuardEnabled,
  withServerResourceApply,
  withTrustedResourceWrite,
} from 'src/ts/server/resourceWriteGuard.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

let target: HTMLElement
let component: MountedComponent | undefined

function seedTranslatorPresets(): void {
  setDatabaseLite({
    hotkeys: [],
    longPressToPopupEditor: false,
    translatorPresets: [
      { id: 'preset-a', name: 'Preset A', prompt: 'old prompt A', maxResponse: 100 },
      { id: 'preset-b', name: 'Preset B', prompt: 'old prompt B', maxResponse: 200 },
    ],
    translatorPresetId: 0,
    translatorPrompt: 'old prompt A',
    translatorMaxResponse: 100,
  } as any)
}

function promptTextarea(): HTMLTextAreaElement {
  const textarea = target.querySelector<HTMLTextAreaElement>('textarea')
  expect(textarea).toBeTruthy()
  return textarea!
}

function maxResponseInput(): HTMLInputElement {
  const input = target.querySelector<HTMLInputElement>('input[type="number"]')
  expect(input).toBeTruthy()
  return input!
}

async function editPrompt(value: string): Promise<void> {
  const textarea = promptTextarea()
  textarea.value = value
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
  await tick()
}

async function editMaxResponse(value: number): Promise<void> {
  const input = maxResponseInput()
  input.value = String(value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await tick()
}

async function renameSelectedPreset(value: string): Promise<void> {
  vi.mocked(alertInput).mockResolvedValueOnce(value)
  const buttons = target.querySelectorAll<HTMLButtonElement>('button')
  expect(buttons.length).toBeGreaterThan(1)
  buttons[1].click()
  await tick()
  await flushMicrotasks()
  await tick()
}

function toolbarButton(index: number): HTMLButtonElement {
  const buttons = target.querySelectorAll<HTMLButtonElement>('button')
  expect(buttons.length).toBeGreaterThan(index)
  return buttons[index]
}

async function clickCreatePreset(): Promise<void> {
  toolbarButton(0).click()
  await tick()
  await flushMicrotasks()
  await tick()
}

async function clickDeletePreset(): Promise<void> {
  vi.mocked(alertConfirm).mockResolvedValueOnce(true)
  toolbarButton(2).click()
  await tick()
  await flushMicrotasks()
  await tick()
}

async function selectTranslatorPreset(index: number): Promise<void> {
  const select = target.querySelector<HTMLSelectElement>('select')
  expect(select).toBeTruthy()
  const selectElement = select!
  const option = selectElement.options.item(index)
  expect(option).toBeTruthy()

  selectElement.value = String(index)
  selectElement.selectedIndex = index
  option!.selected = true

  const originalQuerySelector = selectElement.querySelector
  selectElement.querySelector = ((selectors: string) => {
    if (selectors === ':checked') return option
    return originalQuerySelector.call(selectElement, selectors)
  }) as HTMLSelectElement['querySelector']

  try {
    selectElement.dispatchEvent(new Event('change', { bubbles: true }))
  } finally {
    selectElement.querySelector = originalQuerySelector
  }
  await tick()
  await flushMicrotasks()
  await tick()
}

async function switchProjectedPreset(index: number): Promise<void> {
  withTrustedResourceWrite(() => {
    getDatabase().translatorPresetId = index
    getDatabase().translatorPrompt = getDatabase().translatorPresets[index].prompt
    getDatabase().translatorMaxResponse = getDatabase().translatorPresets[index].maxResponse
  })
  await tick()
}

async function applyTranslatorPresetProjection(input: {
  presets: Array<{ id: string; name: string; prompt: string; maxResponse: number }>
  selectedIndex?: number
}): Promise<void> {
  withServerResourceApply(() => {
    const selectedIndex = input.selectedIndex ?? getDatabase().translatorPresetId
    getDatabase().translatorPresets = input.presets.map((preset) => ({ ...preset }))
    getDatabase().translatorPresetId = selectedIndex
    getDatabase().translatorPrompt = getDatabase().translatorPresets[selectedIndex]?.prompt ?? ''
    getDatabase().translatorMaxResponse = getDatabase().translatorPresets[selectedIndex]?.maxResponse ?? 0
  })
  await tick()
  await flushMicrotasks()
  await tick()
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

function notifyTranslatorPresetPatchApplied(input: {
  presetId: string
  attemptedPatch: Record<string, unknown>
  attemptedPreset: Record<string, unknown>
}): void {
  const event = {
    type: 'translatorPreset.updated',
    revision: 101,
    resource: 'translatorPreset',
    id: input.presetId,
  }
  const localEffect = {
    kind: 'translatorPresetPatch',
    presetId: input.presetId,
    attemptedPatch: input.attemptedPatch,
    attemptedPreset: input.attemptedPreset,
  }
  for (const listener of commandSpies.localEffectListeners) listener(event, localEffect)
}

async function failDeferredCommand(
  deferreds: Array<{ resolve: (result: Record<string, unknown>) => void }>,
  error: string,
): Promise<void> {
  const deferred = deferreds.shift()
  expect(deferred).toBeTruthy()
  deferred!.resolve({ status: 'error', error })
  await flushMicrotasks()
  await tick()
}

beforeEach(() => {
  vi.useFakeTimers()
  commandSpies.failNextCreate = false
  commandSpies.failNextDelete = false
  commandSpies.failNextSelect = false
  commandSpies.failNextUpdate = false
  commandSpies.contradictNextUpdateReceipt = false
  commandSpies.deferNextCreate = false
  commandSpies.deferNextDelete = false
  commandSpies.deferNextSelect = false
  commandSpies.deferNextUpdate = false
  commandSpies.nextBaseRevision = 100
  commandSpies.runInputs.length = 0
  commandSpies.createInputs.length = 0
  commandSpies.deleteInputs.length = 0
  commandSpies.selectInputs.length = 0
  commandSpies.updateInputs.length = 0
  commandSpies.updateAcknowledgements.length = 0
  commandSpies.localEffectListeners.clear()
  commandSpies.deferredCreateResults.length = 0
  commandSpies.deferredDeleteResults.length = 0
  commandSpies.deferredSelectResults.length = 0
  commandSpies.deferredUpdateResults.length = 0
  commandSpies.canUseServerCommands.mockClear()
  commandSpies.runServerCommand.mockClear()
  commandSpies.createTranslatorPresetCommand.mockClear()
  commandSpies.deleteTranslatorPresetCommand.mockClear()
  commandSpies.selectTranslatorPresetCommand.mockClear()
  commandSpies.updateTranslatorPresetCommand.mockClear()
  commandSpies.subscribeServerCommandLocalEffectApplied.mockClear()
  vi.mocked(alertConfirm).mockClear()
  vi.mocked(alertInput).mockClear()

  setResourceWriteGuardEnabled(false)
  resetServerResourceState()
  seedTranslatorPresets()
  setResourceWriteGuardEnabled(true)

  target = document.createElement('div')
  document.body.appendChild(target)
  component = mount(TranslatorPresetSettings, { target })
})

afterEach(async () => {
  await vi.runOnlyPendingTimersAsync()
  if (component) {
    unmount(component)
    component = undefined
  }
  setResourceWriteGuardEnabled(false)
  setDatabaseLite({} as any)
  target.remove()
  document.body.innerHTML = ''
  vi.useRealTimers()
})

describe('TranslatorPresetSettings server-backed edits', () => {
  it('optimistically updates resource-backed state before the debounced command is sent', async () => {
    await editPrompt('new prompt A')

    expect(getDatabase().translatorPresets[0].prompt).toBe('new prompt A')
    expect(getDatabase().translatorPrompt).toBe('new prompt A')
    expect(commandSpies.updateInputs).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(250)

    expect(commandSpies.updateInputs).toEqual([
      {
        baseRevision: 100,
        presetId: 'preset-a',
        patch: { prompt: 'new prompt A' },
      },
    ])
    expect(commandSpies.updateAcknowledgements[0]).toMatchObject({
      collectionProjectionEpoch: expect.any(Number),
      languageSettingsProjectionEpoch: expect.any(Number),
      selectedPresetId: 'preset-a',
      attemptedPreset: {
        id: 'preset-a',
        name: 'Preset A',
        prompt: 'new prompt A',
        maxResponse: 100,
      },
    })
  })

  it('drops a pending field patch when rapid edits return to the first baseline', async () => {
    await editPrompt('temporary prompt A')
    await editPrompt('old prompt A')

    expect(getDatabase().translatorPresets[0].prompt).toBe('old prompt A')
    expect(getDatabase().translatorPrompt).toBe('old prompt A')

    await vi.advanceTimersByTimeAsync(250)

    expect(commandSpies.updateInputs).toHaveLength(0)
  })

  it('keeps disjoint pending fields while omitting a field that returns to its baseline', async () => {
    await editPrompt('temporary prompt A')
    await editMaxResponse(321)
    await editPrompt('old prompt A')

    await vi.advanceTimersByTimeAsync(250)

    expect(commandSpies.updateInputs).toEqual([
      {
        baseRevision: 100,
        presetId: 'preset-a',
        patch: { maxResponse: 321 },
      },
    ])
    expect(getDatabase().translatorPresets[0]).toMatchObject({
      prompt: 'old prompt A',
      maxResponse: 321,
    })
    expect(getDatabase().translatorPrompt).toBe('old prompt A')
    expect(getDatabase().translatorMaxResponse).toBe(321)
  })

  it('keeps independent pending edits when another preset is edited before debounce', async () => {
    await editPrompt('new prompt A')
    await switchProjectedPreset(1)
    await editPrompt('new prompt B')

    expect(getDatabase().translatorPresets.map((preset) => preset.prompt)).toEqual(['new prompt A', 'new prompt B'])
    expect(commandSpies.updateInputs).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(250)

    expect(commandSpies.updateInputs).toEqual([
      {
        baseRevision: 100,
        presetId: 'preset-a',
        patch: { prompt: 'new prompt A' },
      },
      {
        baseRevision: 101,
        presetId: 'preset-b',
        patch: { prompt: 'new prompt B' },
      },
    ])
  })

  it('rolls back a failed debounced edit when the preset has not changed again', async () => {
    commandSpies.failNextUpdate = true

    await editPrompt('rejected prompt A')
    await vi.advanceTimersByTimeAsync(250)

    expect(commandSpies.updateInputs).toEqual([
      {
        baseRevision: 100,
        presetId: 'preset-a',
        patch: { prompt: 'rejected prompt A' },
      },
    ])
    expect(getDatabase().translatorPresets[0].prompt).toBe('old prompt A')
    expect(getDatabase().translatorPrompt).toBe('old prompt A')
    expect(isCollectionAcknowledgementTainted('translatorPresets')).toBe(true)
    expect(isSettingsGroupAcknowledgementTainted('language')).toBe(true)
  })

  it('rolls back a failed coalesced field edit to its first baseline', async () => {
    commandSpies.failNextUpdate = true

    await editPrompt('intermediate prompt A')
    await editPrompt('rejected final prompt A')
    await vi.advanceTimersByTimeAsync(250)

    expect(commandSpies.updateInputs).toEqual([
      {
        baseRevision: 100,
        presetId: 'preset-a',
        patch: { prompt: 'rejected final prompt A' },
      },
    ])
    expect(getDatabase().translatorPresets[0].prompt).toBe('old prompt A')
    expect(getDatabase().translatorPrompt).toBe('old prompt A')
  })

  it('keeps an unsettled field dirty when a later batch net-reverts to its attempted value', async () => {
    commandSpies.deferNextUpdate = true

    await editPrompt('unsettled prompt A')
    await vi.advanceTimersByTimeAsync(250)
    await editPrompt('temporary later prompt A')
    await editPrompt('unsettled prompt A')

    expect(commandSpies.updateInputs).toEqual([
      {
        baseRevision: 100,
        presetId: 'preset-a',
        patch: { prompt: 'unsettled prompt A' },
      },
    ])

    await failDeferredCommand(commandSpies.deferredUpdateResults, 'forced update failure')
    await vi.advanceTimersByTimeAsync(250)

    expect(commandSpies.updateInputs).toHaveLength(1)
    expect(getDatabase().translatorPresets[0].prompt).toBe('old prompt A')
    expect(getDatabase().translatorPrompt).toBe('old prompt A')
  })

  it('preserves newer translator state when a deferred create command fails', async () => {
    commandSpies.deferNextCreate = true

    await clickCreatePreset()

    expect(commandSpies.createInputs).toHaveLength(1)
    expect(commandSpies.createInputs[0]).toMatchObject({
      baseRevision: 100,
      select: true,
    })
    expect(commandSpies.runInputs.at(-1)?.rollback).toBeUndefined()

    withTrustedResourceWrite(() => {
      getDatabase().translatorPresets = [
        { ...getDatabase().translatorPresets[0], name: 'Preset A Edited', prompt: 'newer prompt A' },
        { ...getDatabase().translatorPresets[1] },
        { id: 'preset-c', name: 'Preset C', prompt: 'new prompt C', maxResponse: 300 },
      ]
      getDatabase().translatorPresetId = 2
      getDatabase().translatorPrompt = 'new prompt C'
      getDatabase().translatorMaxResponse = 300
    })

    await failDeferredCommand(commandSpies.deferredCreateResults, 'forced create failure')

    expect(getDatabase().translatorPresets.map((preset) => preset.id)).toEqual(['preset-a', 'preset-b', 'preset-c'])
    expect(getDatabase().translatorPresets[0]).toMatchObject({
      name: 'Preset A Edited',
      prompt: 'newer prompt A',
    })
    expect(getDatabase().translatorPresetId).toBe(2)
    expect(getDatabase().translatorPrompt).toBe('new prompt C')
    expect(getDatabase().translatorMaxResponse).toBe(300)
  })

  it('preserves newer translator selection and field edits when a deferred select command fails', async () => {
    commandSpies.deferNextSelect = true

    await selectTranslatorPreset(1)

    expect(commandSpies.selectInputs).toEqual([{ baseRevision: 100, presetId: 'preset-b' }])
    expect(commandSpies.runInputs.at(-1)?.rollback).toBeUndefined()

    withTrustedResourceWrite(() => {
      getDatabase().translatorPresets = [
        { ...getDatabase().translatorPresets[0] },
        {
          ...getDatabase().translatorPresets[1],
          name: 'Preset B Edited',
          prompt: 'newer prompt B',
          maxResponse: 222,
        },
      ]
      getDatabase().translatorPresetId = 1
      getDatabase().translatorPrompt = 'newer prompt B'
      getDatabase().translatorMaxResponse = 222
    })

    await failDeferredCommand(commandSpies.deferredSelectResults, 'forced select failure')

    expect(getDatabase().translatorPresetId).toBe(1)
    expect(getDatabase().translatorPresets[1]).toMatchObject({
      name: 'Preset B Edited',
      prompt: 'newer prompt B',
      maxResponse: 222,
    })
    expect(getDatabase().translatorPrompt).toBe('newer prompt B')
    expect(getDatabase().translatorMaxResponse).toBe(222)
  })

  it('preserves newer row edits and appended rows when a deferred delete command fails', async () => {
    commandSpies.deferNextDelete = true

    await clickDeletePreset()

    expect(commandSpies.deleteInputs).toEqual([{ baseRevision: 100, presetId: 'preset-a', selectPresetId: 'preset-b' }])
    expect(commandSpies.runInputs.at(-1)?.rollback).toBeUndefined()

    withTrustedResourceWrite(() => {
      getDatabase().translatorPresets = [
        {
          ...getDatabase().translatorPresets[0],
          name: 'Preset A Edited',
          prompt: 'newer prompt A',
          maxResponse: 111,
        },
        { ...getDatabase().translatorPresets[1] },
        { id: 'preset-c', name: 'Preset C', prompt: 'new prompt C', maxResponse: 300 },
      ]
      getDatabase().translatorPresetId = 2
      getDatabase().translatorPrompt = 'new prompt C'
      getDatabase().translatorMaxResponse = 300
    })

    await failDeferredCommand(commandSpies.deferredDeleteResults, 'forced delete failure')

    expect(getDatabase().translatorPresets.map((preset) => preset.id)).toEqual(['preset-a', 'preset-b', 'preset-c'])
    expect(getDatabase().translatorPresets[0]).toMatchObject({
      name: 'Preset A Edited',
      prompt: 'newer prompt A',
      maxResponse: 111,
    })
    expect(getDatabase().translatorPresetId).toBe(2)
    expect(getDatabase().translatorPrompt).toBe('new prompt C')
    expect(getDatabase().translatorMaxResponse).toBe(300)
  })

  it('flushes a pending preset edit when the component is destroyed', async () => {
    await editPrompt('destroy-flushed prompt A')

    expect(commandSpies.updateInputs).toHaveLength(0)

    unmount(component!)
    component = undefined
    await flushMicrotasks()

    expect(commandSpies.updateInputs).toEqual([
      {
        baseRevision: 100,
        presetId: 'preset-a',
        patch: { prompt: 'destroy-flushed prompt A' },
      },
    ])
  })

  it('keeps a dirty prompt through a stale projection for the same preset', async () => {
    await editPrompt('dirty prompt A')

    await applyTranslatorPresetProjection({
      presets: [
        { id: 'preset-a', name: 'Projected A', prompt: 'stale prompt A', maxResponse: 100 },
        { id: 'preset-b', name: 'Projected B', prompt: 'projected prompt B', maxResponse: 220 },
      ],
      selectedIndex: 0,
    })

    expect(getDatabase().translatorPresets[0]).toMatchObject({
      id: 'preset-a',
      name: 'Projected A',
      prompt: 'dirty prompt A',
      maxResponse: 100,
    })
    expect(getDatabase().translatorPrompt).toBe('dirty prompt A')
  })

  it('does not settle a dirty prompt for a contradictory successful receipt', async () => {
    commandSpies.contradictNextUpdateReceipt = true
    await editPrompt('optimistic prompt A')
    await vi.advanceTimersByTimeAsync(250)

    await applyTranslatorPresetProjection({
      presets: [
        { id: 'preset-a', name: 'Projected A', prompt: 'stale prompt A', maxResponse: 100 },
        { id: 'preset-b', name: 'Projected B', prompt: 'projected prompt B', maxResponse: 220 },
      ],
      selectedIndex: 0,
    })

    expect(getDatabase().translatorPresets[0].prompt).toBe('optimistic prompt A')
    expect(getDatabase().translatorPrompt).toBe('optimistic prompt A')
  })

  it('settles only after the matching local effect is actually applied', async () => {
    await editPrompt('accepted prompt A')
    await vi.advanceTimersByTimeAsync(250)
    notifyTranslatorPresetPatchApplied({
      presetId: 'preset-a',
      attemptedPatch: { prompt: 'accepted prompt A' },
      attemptedPreset: {
        id: 'preset-a',
        name: 'Preset A',
        prompt: 'accepted prompt A',
        maxResponse: 100,
      },
    })

    await applyTranslatorPresetProjection({
      presets: [
        { id: 'preset-a', name: 'Server A', prompt: 'later server prompt A', maxResponse: 123 },
        { id: 'preset-b', name: 'Server B', prompt: 'later server prompt B', maxResponse: 220 },
      ],
      selectedIndex: 0,
    })

    expect(getDatabase().translatorPresets[0].prompt).toBe('later server prompt A')
    expect(getDatabase().translatorPrompt).toBe('later server prompt A')
  })

  it('preserves a later dirty value when an earlier local effect is applied', async () => {
    await editPrompt('first attempted prompt A')
    await vi.advanceTimersByTimeAsync(250)
    await editPrompt('later dirty prompt A')
    notifyTranslatorPresetPatchApplied({
      presetId: 'preset-a',
      attemptedPatch: { prompt: 'first attempted prompt A' },
      attemptedPreset: {
        id: 'preset-a',
        name: 'Preset A',
        prompt: 'first attempted prompt A',
        maxResponse: 100,
      },
    })

    await applyTranslatorPresetProjection({
      presets: [
        { id: 'preset-a', name: 'Server A', prompt: 'first attempted prompt A', maxResponse: 123 },
        { id: 'preset-b', name: 'Server B', prompt: 'server prompt B', maxResponse: 220 },
      ],
      selectedIndex: 0,
    })

    expect(getDatabase().translatorPresets[0].prompt).toBe('later dirty prompt A')
    expect(getDatabase().translatorPrompt).toBe('later dirty prompt A')
  })

  it('refreshes clean sibling fields while preserving a dirty prompt', async () => {
    await editPrompt('dirty prompt A')

    await applyTranslatorPresetProjection({
      presets: [
        { id: 'preset-a', name: 'Server A', prompt: 'stale prompt A', maxResponse: 333 },
        { id: 'preset-b', name: 'Projected B', prompt: 'projected prompt B', maxResponse: 444 },
      ],
      selectedIndex: 0,
    })

    expect(getDatabase().translatorPresets[0]).toMatchObject({
      name: 'Server A',
      prompt: 'dirty prompt A',
      maxResponse: 333,
    })
    expect(getDatabase().translatorPrompt).toBe('dirty prompt A')
    expect(getDatabase().translatorMaxResponse).toBe(333)
  })

  it('clears dirty prompt state when projection catches up so later clean projections apply', async () => {
    await editPrompt('dirty prompt A')

    await applyTranslatorPresetProjection({
      presets: [
        { id: 'preset-a', name: 'Server A', prompt: 'dirty prompt A', maxResponse: 123 },
        { id: 'preset-b', name: 'Projected B', prompt: 'projected prompt B', maxResponse: 220 },
      ],
      selectedIndex: 0,
    })

    await applyTranslatorPresetProjection({
      presets: [
        { id: 'preset-a', name: 'Server A2', prompt: 'server later prompt A', maxResponse: 456 },
        { id: 'preset-b', name: 'Projected B2', prompt: 'server later prompt B', maxResponse: 230 },
      ],
      selectedIndex: 0,
    })

    expect(getDatabase().translatorPresets[0]).toMatchObject({
      name: 'Server A2',
      prompt: 'server later prompt A',
      maxResponse: 456,
    })
    expect(getDatabase().translatorPrompt).toBe('server later prompt A')
    expect(getDatabase().translatorMaxResponse).toBe(456)
  })

  it('does not roll back a caught-up dirty prompt when its pending update later fails', async () => {
    await editPrompt('dirty prompt A')

    await applyTranslatorPresetProjection({
      presets: [
        { id: 'preset-a', name: 'Server A', prompt: 'dirty prompt A', maxResponse: 333 },
        { id: 'preset-b', name: 'Projected B', prompt: 'projected prompt B', maxResponse: 220 },
      ],
      selectedIndex: 0,
    })

    commandSpies.failNextUpdate = true
    await vi.advanceTimersByTimeAsync(250)

    expect(commandSpies.updateInputs).toEqual([
      {
        baseRevision: 100,
        presetId: 'preset-a',
        patch: { prompt: 'dirty prompt A' },
      },
    ])
    expect(getDatabase().translatorPresets[0]).toMatchObject({
      name: 'Server A',
      prompt: 'dirty prompt A',
      maxResponse: 333,
    })
    expect(getDatabase().translatorPrompt).toBe('dirty prompt A')
    expect(getDatabase().translatorMaxResponse).toBe(333)
  })

  it('clears dirty prompt state when the target preset disappears', async () => {
    await editPrompt('dirty prompt A')

    await applyTranslatorPresetProjection({
      presets: [{ id: 'preset-b', name: 'Projected B', prompt: 'projected prompt B', maxResponse: 220 }],
      selectedIndex: 0,
    })

    await applyTranslatorPresetProjection({
      presets: [{ id: 'preset-a', name: 'Reintroduced A', prompt: 'server prompt A', maxResponse: 321 }],
      selectedIndex: 0,
    })

    expect(getDatabase().translatorPresets[0]).toMatchObject({
      id: 'preset-a',
      name: 'Reintroduced A',
      prompt: 'server prompt A',
      maxResponse: 321,
    })
    expect(getDatabase().translatorPrompt).toBe('server prompt A')
    expect(getDatabase().translatorMaxResponse).toBe(321)
  })

  it('keeps dirty maxResponse and rename values through stale projection', async () => {
    await editMaxResponse(777)
    await renameSelectedPreset('Dirty Name A')

    await applyTranslatorPresetProjection({
      presets: [
        { id: 'preset-a', name: 'Stale Name A', prompt: 'server prompt A', maxResponse: 111 },
        { id: 'preset-b', name: 'Projected B', prompt: 'projected prompt B', maxResponse: 222 },
      ],
      selectedIndex: 0,
    })

    expect(getDatabase().translatorPresets[0]).toMatchObject({
      name: 'Dirty Name A',
      prompt: 'server prompt A',
      maxResponse: 777,
    })
    expect(getDatabase().translatorPrompt).toBe('server prompt A')
    expect(getDatabase().translatorMaxResponse).toBe(777)
  })
})
