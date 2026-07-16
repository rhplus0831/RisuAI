import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'

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
    skipNextRollback: false,
    runInputs: [] as Array<{ rollback?: () => void; signal?: AbortSignal | null; keepalive?: boolean }>,
    createInputs: [] as Array<{ baseRevision: number; preset: Record<string, unknown>; select?: boolean }>,
    deleteInputs: [] as Array<{ baseRevision: number; presetId: string; selectPresetId?: string }>,
    selectInputs: [] as Array<{ baseRevision: number; presetId: string }>,
    updateInputs: [] as Array<{ baseRevision: number; presetId: string; patch: Record<string, unknown> }>,
    updateAcknowledgements: [] as Array<Record<string, unknown> | undefined>,
    updateTransportOptions: [] as Array<{ signal?: AbortSignal | null; keepalive?: boolean }>,
    inlineReplayInputs: [] as Array<{
      requests: Array<Record<string, unknown>>
      mutationId: string
      databaseLineage: string
    }>,
    replayInputs: [] as Array<{
      requests: Array<Record<string, unknown>>
      mutationId: string
      databaseLineage: string
    }>,
    inlineReplayResults: [] as Array<Record<string, unknown>>,
    replayResults: [] as Array<Record<string, unknown>>,
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
    acknowledgeServerMutationReceipts: vi.fn(async () => true),
    replayDurableMutationRequests: vi.fn(),
    replayDurableMutationRequestsInline: vi.fn(),
    runServerCommandWithoutMutationReceipt: vi.fn(async (execute: () => Promise<unknown>) => execute()),
    runServerCommandWithMutationReceipt: vi.fn(async (execute: () => Promise<unknown>) => execute()),
  }

  spies.replayDurableMutationRequests.mockImplementation(
    async (requests: Array<Record<string, unknown>>, mutationId: string, databaseLineage: string) => {
      spies.replayInputs.push({ requests, mutationId, databaseLineage })
      return spies.replayResults.shift() ?? { status: 'ok' }
    },
  )
  spies.replayDurableMutationRequestsInline.mockImplementation(
    async (requests: Array<Record<string, unknown>>, mutationId: string, databaseLineage: string) => {
      spies.inlineReplayInputs.push({ requests, mutationId, databaseLineage })
      return spies.inlineReplayResults.shift() ?? { status: 'ok' }
    },
  )

  spies.subscribeServerCommandLocalEffectApplied.mockImplementation(
    (listener: (event: Record<string, unknown>, localEffect: Record<string, unknown>) => void) => {
      spies.localEffectListeners.add(listener)
      return () => spies.localEffectListeners.delete(listener)
    },
  )

  spies.runServerCommand.mockImplementation(
    async (input: {
      command: (baseRevision: number) => Promise<unknown>
      rollback?: () => void
      signal?: AbortSignal | null
      keepalive?: boolean
      executionWrapper?: (execute: () => Promise<Record<string, unknown>>) => Promise<Record<string, unknown>>
    }) => {
      spies.runInputs.push({ rollback: input.rollback, signal: input.signal, keepalive: input.keepalive })
      const execute = async () => {
        const result = (await input.command(spies.nextBaseRevision++)) as Record<string, unknown> & {
          status?: string
        }
        if (result.status !== 'ok') {
          if (spies.skipNextRollback) spies.skipNextRollback = false
          else input.rollback?.()
        }
        return result
      }
      return input.executionWrapper ? input.executionWrapper(execute) : execute()
    },
  )
  spies.updateTranslatorPresetCommand.mockImplementation(
    async (
      input: {
        baseRevision: number
        presetId: string
        patch: Record<string, unknown>
        optimisticAcknowledgement?: Record<string, unknown>
      },
      signal?: AbortSignal | null,
      keepalive?: boolean,
    ) => {
      const { optimisticAcknowledgement, ...wireInput } = input
      spies.updateInputs.push(wireInput)
      spies.updateAcknowledgements.push(optimisticAcknowledgement)
      spies.updateTransportOptions.push({ signal, keepalive })
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
  acknowledgeServerMutationReceipts: commandSpies.acknowledgeServerMutationReceipts,
  canUseServerCommands: commandSpies.canUseServerCommands,
  createTranslatorPresetCommand: commandSpies.createTranslatorPresetCommand,
  deleteTranslatorPresetCommand: commandSpies.deleteTranslatorPresetCommand,
  runServerCommand: commandSpies.runServerCommand,
  replayDurableMutationRequests: commandSpies.replayDurableMutationRequests,
  replayDurableMutationRequestsInline: commandSpies.replayDurableMutationRequestsInline,
  runServerCommandWithoutMutationReceipt: commandSpies.runServerCommandWithoutMutationReceipt,
  runServerCommandWithMutationReceipt: commandSpies.runServerCommandWithMutationReceipt,
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
import { language } from 'src/lang'
import { alertConfirm, alertInput } from 'src/ts/alert'
import { getDatabase, setDatabaseLite } from 'src/ts/storage/database.svelte'
import {
  applyCollectionsResource,
  applySettingsGroupResource,
  isCollectionAcknowledgementTainted,
  isSettingsGroupAcknowledgementTainted,
  resetServerResourceState,
} from 'src/ts/server/resourceState.svelte'
import {
  setResourceWriteGuardEnabled,
  withServerResourceApply,
  withTrustedResourceWrite,
} from 'src/ts/server/resourceWriteGuard.svelte'
import { flushRegisteredPendingBridgePatches } from 'src/ts/server/pendingBridgeFlushRegistry'
import {
  beginPendingMutationDispatch,
  clearPendingMutationOutbox,
  listPendingMutations,
  preparePendingMutationOutbox,
  resetPendingMutationOutboxForTests,
} from 'src/ts/server/pendingMutationOutbox'
import { dispatchDurableMutationReplay } from 'src/ts/server/durableMutationDispatch'

type MountedComponent = Parameters<typeof unmount>[0]

let target: HTMLElement
let component: MountedComponent | undefined
let nextProjectionRevision = 1_000

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

function currentSelectedPresetId(): string | undefined {
  return getDatabase().translatorPresets[getDatabase().translatorPresetId]?.id
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
  const revision = nextProjectionRevision++
  const selectedIndex = input.selectedIndex ?? getDatabase().translatorPresetId
  const selectedPreset = input.presets[selectedIndex]
  withServerResourceApply(() => {
    applyCollectionsResource(
      {
        revision,
        collections: { translatorPresets: input.presets.map((preset) => ({ ...preset })) },
      },
      'translatorPresets',
    )
    applySettingsGroupResource(
      {
        revision,
        group: 'language',
        settings: {
          translatorPresetId: selectedIndex,
          translatorPrompt: selectedPreset?.prompt ?? '',
          translatorMaxResponse: selectedPreset?.maxResponse ?? 0,
        },
      },
      ['translatorPresetId', 'translatorPrompt', 'translatorMaxResponse'],
    )
  })
  await tick()
  await flushMicrotasks()
  await tick()
}

async function appendPresetC(): Promise<void> {
  withTrustedResourceWrite(() => {
    getDatabase().translatorPresets = [
      ...getDatabase().translatorPresets,
      { id: 'preset-c', name: 'Preset C', prompt: 'old prompt C', maxResponse: 300 },
    ]
  })
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
  commandSpies.skipNextRollback = false
  nextProjectionRevision = 1_000
  commandSpies.runInputs.length = 0
  commandSpies.createInputs.length = 0
  commandSpies.deleteInputs.length = 0
  commandSpies.selectInputs.length = 0
  commandSpies.updateInputs.length = 0
  commandSpies.updateAcknowledgements.length = 0
  commandSpies.updateTransportOptions.length = 0
  commandSpies.inlineReplayInputs.length = 0
  commandSpies.replayInputs.length = 0
  commandSpies.inlineReplayResults.length = 0
  commandSpies.replayResults.length = 0
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
  commandSpies.acknowledgeServerMutationReceipts.mockClear()
  commandSpies.replayDurableMutationRequests.mockClear()
  commandSpies.replayDurableMutationRequestsInline.mockClear()
  commandSpies.runServerCommandWithoutMutationReceipt.mockClear()
  commandSpies.runServerCommandWithMutationReceipt.mockClear()
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
  it('names the preset selector and editable fields from their visible settings', () => {
    expect(target.querySelector('select')?.getAttribute('aria-label')).toBe('Preset')
    expect(target.querySelector('input[type="number"]')?.getAttribute('aria-label')).toBe(
      language.translationResponseSize,
    )
    expect(target.querySelector('textarea, [role="textbox"]')?.getAttribute('aria-label')).toBe(
      language.translatorPrompt,
    )
  })

  it('names every preset toolbar action for its target', () => {
    const buttons = Array.from(target.querySelectorAll<HTMLButtonElement>('button')).slice(0, 5)

    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
      `${language.add}: ${language.presets}`,
      `${language.edit}: Preset A`,
      `${language.remove}: Preset A`,
      `${language.export}: Preset A`,
      `${language.import}: ${language.presets}`,
    ])
    expect(buttons.every((button) => button.type === 'button')).toBe(true)
  })

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

  it('persists the exact translator preset PATCH and immediately closes a total revert', async () => {
    vi.useRealTimers()
    vi.stubGlobal('indexedDB', new IDBFactory())
    resetPendingMutationOutboxForTests()
    await preparePendingMutationOutbox({
      writerSessionId: 'writer-translator-preset',
      writerEpoch: 5,
      databaseLineage: 'lineage-translator-preset',
      requestedWriterWasActive: true,
    })

    try {
      await editPrompt('durable prompt A')
      await vi.waitFor(async () => {
        expect((await listPendingMutations()).map((entry) => entry.intent)).toEqual([
          {
            version: 1,
            dependencyKeys: ['translator-preset:selection'],
            requests: [
              {
                method: 'PATCH',
                path: '/translator-presets/preset-a',
                body: { patch: { prompt: 'durable prompt A' } },
              },
            ],
          },
        ])
      })

      await editPrompt('old prompt A')
      await vi.waitFor(() => {
        expect(commandSpies.updateInputs).toEqual([
          {
            baseRevision: 100,
            presetId: 'preset-a',
            patch: { prompt: 'old prompt A' },
          },
        ])
      })
      await vi.waitFor(async () => expect(await listPendingMutations()).toEqual([]))
    } finally {
      await clearPendingMutationOutbox()
      resetPendingMutationOutboxForTests()
      vi.useFakeTimers()
    }
  })

  it('keeps a remotely marked PATCH ahead of an immediate total-revert correction', async () => {
    vi.useRealTimers()
    vi.stubGlobal('indexedDB', new IDBFactory())
    resetPendingMutationOutboxForTests()
    await preparePendingMutationOutbox({
      writerSessionId: 'writer-translator-total-revert',
      writerEpoch: 6,
      databaseLineage: 'lineage-translator-total-revert',
      requestedWriterWasActive: true,
    })
    commandSpies.inlineReplayResults.push({ status: 'error', error: 'predecessor still offline' })

    try {
      await editPrompt('marked prompt A')
      let staged = await listPendingMutations()
      await vi.waitFor(async () => {
        staged = await listPendingMutations()
        expect(staged).toHaveLength(1)
      })
      await expect(beginPendingMutationDispatch(staged[0].handle)).resolves.toBe('persisted')

      await editPrompt('old prompt A')
      await vi.waitFor(async () => {
        staged = await listPendingMutations()
        expect(staged.map((entry) => entry.intent)).toEqual([
          {
            version: 1,
            dependencyKeys: ['translator-preset:selection'],
            requests: [
              {
                method: 'PATCH',
                path: '/translator-presets/preset-a',
                body: { patch: { prompt: 'marked prompt A' } },
              },
            ],
          },
          {
            version: 1,
            dependencyKeys: ['translator-preset:selection'],
            requests: [
              {
                method: 'PATCH',
                path: '/translator-presets/preset-a',
                body: { patch: { prompt: 'old prompt A' } },
              },
            ],
          },
        ])
      })
      expect(staged[0].handle.mutationId).not.toBe(staged[1].handle.mutationId)
      await vi.waitFor(() => expect(commandSpies.inlineReplayInputs).toHaveLength(1))
      expect(commandSpies.updateInputs).toEqual([])
    } finally {
      if (component) {
        unmount(component)
        component = undefined
        await flushMicrotasks()
      }
      await clearPendingMutationOutbox()
      resetPendingMutationOutboxForTests()
      vi.useFakeTimers()
    }
  })

  it('keeps reverted and net-dirty fields in the successor behind a remotely marked PATCH', async () => {
    vi.useRealTimers()
    vi.stubGlobal('indexedDB', new IDBFactory())
    resetPendingMutationOutboxForTests()
    await preparePendingMutationOutbox({
      writerSessionId: 'writer-translator-partial-revert',
      writerEpoch: 7,
      databaseLineage: 'lineage-translator-partial-revert',
      requestedWriterWasActive: true,
    })
    commandSpies.inlineReplayResults.push({ status: 'error', error: 'predecessor still offline' })

    try {
      await editPrompt('marked prompt A')
      let staged = await listPendingMutations()
      await vi.waitFor(async () => {
        staged = await listPendingMutations()
        expect(staged).toHaveLength(1)
      })
      await expect(beginPendingMutationDispatch(staged[0].handle)).resolves.toBe('persisted')

      await editMaxResponse(321)
      await editPrompt('old prompt A')
      await vi.waitFor(async () => {
        staged = await listPendingMutations()
        expect(staged).toHaveLength(2)
        expect(staged[1].intent).toEqual({
          version: 1,
          dependencyKeys: ['translator-preset:selection'],
          requests: [
            {
              method: 'PATCH',
              path: '/translator-presets/preset-a',
              body: { patch: { prompt: 'old prompt A', maxResponse: 321 } },
            },
          ],
        })
      })
      expect(staged[0].handle.mutationId).not.toBe(staged[1].handle.mutationId)
    } finally {
      if (component) {
        unmount(component)
        component = undefined
        await flushMicrotasks()
      }
      await clearPendingMutationOutbox()
      resetPendingMutationOutboxForTests()
      vi.useFakeTimers()
    }
  })

  it('immediately sends a baseline correction when rapid edits return to the first baseline', async () => {
    await editPrompt('temporary prompt A')
    await editPrompt('old prompt A')
    await flushMicrotasks()

    expect(getDatabase().translatorPresets[0].prompt).toBe('old prompt A')
    expect(getDatabase().translatorPrompt).toBe('old prompt A')
    expect(commandSpies.updateInputs).toEqual([
      {
        baseRevision: 100,
        presetId: 'preset-a',
        patch: { prompt: 'old prompt A' },
      },
    ])

    await vi.advanceTimersByTimeAsync(250)

    expect(commandSpies.updateInputs).toHaveLength(1)
  })

  it('keeps the reverted field in the absolute closure while a disjoint field remains dirty', async () => {
    await editPrompt('temporary prompt A')
    await editMaxResponse(321)
    await editPrompt('old prompt A')

    await vi.advanceTimersByTimeAsync(250)

    expect(commandSpies.updateInputs).toEqual([
      {
        baseRevision: 100,
        presetId: 'preset-a',
        patch: { prompt: 'old prompt A', maxResponse: 321 },
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

  it('flushes multiple snapshotted preset edits once even when a later debounce expires during the first request', async () => {
    commandSpies.deferNextUpdate = true
    await editPrompt('flushed prompt A')
    await switchProjectedPreset(1)
    await editPrompt('flushed prompt B')

    toolbarButton(0).click()
    await tick()
    await flushMicrotasks()

    expect(commandSpies.updateInputs).toEqual([
      {
        baseRevision: 100,
        presetId: 'preset-a',
        patch: { prompt: 'flushed prompt A' },
      },
    ])

    commandSpies.deferNextUpdate = true
    await vi.advanceTimersByTimeAsync(250)
    expect(commandSpies.updateInputs).toHaveLength(1)

    const firstResult = commandSpies.deferredUpdateResults.shift()
    expect(firstResult).toBeTruthy()
    firstResult!.resolve({ status: 'ok' })
    for (let attempt = 0; attempt < 5 && commandSpies.deferredUpdateResults.length === 0; attempt++) {
      await flushMicrotasks()
    }

    expect(commandSpies.updateInputs).toEqual([
      {
        baseRevision: 100,
        presetId: 'preset-a',
        patch: { prompt: 'flushed prompt A' },
      },
      {
        baseRevision: 101,
        presetId: 'preset-b',
        patch: { prompt: 'flushed prompt B' },
      },
    ])

    const secondResult = commandSpies.deferredUpdateResults.shift()
    expect(secondResult).toBeTruthy()
    secondResult!.resolve({ status: 'ok' })
    await flushMicrotasks()
    await tick()

    expect(commandSpies.updateInputs).toHaveLength(2)
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

  it('keeps an unsettled target closed when a later staged batch returns to that value', async () => {
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

    expect(commandSpies.updateInputs).toEqual([
      {
        baseRevision: 100,
        presetId: 'preset-a',
        patch: { prompt: 'unsettled prompt A' },
      },
      {
        baseRevision: 101,
        presetId: 'preset-a',
        patch: { prompt: 'unsettled prompt A' },
      },
    ])
    expect(getDatabase().translatorPresets[0].prompt).toBe('old prompt A')
    expect(getDatabase().translatorPrompt).toBe('old prompt A')
  })

  it('returns to the last confirmed field value when two sequential update batches are rejected', async () => {
    commandSpies.deferNextUpdate = true
    await editPrompt('first rejected prompt A')
    await vi.advanceTimersByTimeAsync(250)

    await editPrompt('second rejected prompt A')
    commandSpies.deferNextUpdate = true
    await vi.advanceTimersByTimeAsync(250)

    await failDeferredCommand(commandSpies.deferredUpdateResults, 'forced first update failure')
    for (let attempt = 0; attempt < 5 && commandSpies.deferredUpdateResults.length === 0; attempt++) {
      await flushMicrotasks()
    }
    await failDeferredCommand(commandSpies.deferredUpdateResults, 'forced second update failure')

    expect(getDatabase().translatorPresets[0].prompt).toBe('old prompt A')
    expect(getDatabase().translatorPrompt).toBe('old prompt A')
  })

  it('rolls a rejected later update back to an earlier accepted batch', async () => {
    commandSpies.deferNextUpdate = true
    await editPrompt('accepted prompt A')
    await vi.advanceTimersByTimeAsync(250)

    await editPrompt('rejected later prompt A')
    commandSpies.deferNextUpdate = true
    await vi.advanceTimersByTimeAsync(250)

    const firstResult = commandSpies.deferredUpdateResults.shift()
    expect(firstResult).toBeTruthy()
    firstResult!.resolve({ status: 'ok' })
    for (let attempt = 0; attempt < 5 && commandSpies.deferredUpdateResults.length === 0; attempt++) {
      await flushMicrotasks()
    }
    await failDeferredCommand(commandSpies.deferredUpdateResults, 'forced later update failure')

    expect(getDatabase().translatorPresets[0].prompt).toBe('accepted prompt A')
    expect(getDatabase().translatorPrompt).toBe('accepted prompt A')
  })

  it('cleans up a rejected field edit when a destructive refresh suppressed transport rollback', async () => {
    commandSpies.deferNextUpdate = true
    await editPrompt('reasserted prompt A')
    await vi.advanceTimersByTimeAsync(250)

    await applyTranslatorPresetProjection({
      presets: [
        { id: 'preset-a', name: 'Server A', prompt: 'refreshed prompt A', maxResponse: 111 },
        { id: 'preset-b', name: 'Server B', prompt: 'refreshed prompt B', maxResponse: 222 },
      ],
      selectedIndex: 0,
    })
    expect(getDatabase().translatorPresets[0].prompt).toBe('reasserted prompt A')

    commandSpies.skipNextRollback = true
    await failDeferredCommand(commandSpies.deferredUpdateResults, 'forced update failure after refresh')

    expect(getDatabase().translatorPresets[0].prompt).toBe('refreshed prompt A')
    expect(getDatabase().translatorPrompt).toBe('refreshed prompt A')
    expect(getDatabase().translatorMaxResponse).toBe(111)
  })

  it('preserves newer translator state when a deferred create command fails', async () => {
    commandSpies.deferNextCreate = true

    await clickCreatePreset()

    expect(commandSpies.createInputs).toHaveLength(1)
    expect(commandSpies.createInputs[0]).toMatchObject({
      baseRevision: 100,
      select: true,
    })
    expect(commandSpies.runInputs.at(-1)?.rollback).toEqual(expect.any(Function))
    expect(getDatabase().translatorPresets).toHaveLength(3)
    expect(getDatabase().translatorPresets[2]).toMatchObject({
      id: commandSpies.createInputs[0].preset.id,
      name: 'New Preset',
      prompt: '',
      maxResponse: 1000,
    })
    expect(getDatabase().translatorPresetId).toBe(2)
    expect(getDatabase().translatorPrompt).toBe('')
    expect(getDatabase().translatorMaxResponse).toBe(1000)

    const presetSelect = target.querySelector<HTMLSelectElement>('select')
    expect(presetSelect?.options).toHaveLength(3)
    expect(presetSelect?.value).toBe('2')
    expect(presetSelect?.options.item(2)?.textContent).toBe('New Preset')
    expect(promptTextarea().value).toBe('')
    expect(maxResponseInput().value).toBe('1000')

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

  it('rolls back a rejected optimistic create while it remains current', async () => {
    commandSpies.deferNextCreate = true

    await clickCreatePreset()

    expect(getDatabase().translatorPresets.map((preset) => preset.id)).toEqual([
      'preset-a',
      'preset-b',
      commandSpies.createInputs[0].preset.id,
    ])
    expect(getDatabase().translatorPresetId).toBe(2)

    await failDeferredCommand(commandSpies.deferredCreateResults, 'forced create failure')

    expect(getDatabase().translatorPresets.map((preset) => preset.id)).toEqual(['preset-a', 'preset-b'])
    expect(getDatabase().translatorPresetId).toBe(0)
    expect(getDatabase().translatorPrompt).toBe('old prompt A')
    expect(getDatabase().translatorMaxResponse).toBe(100)
    expect(isCollectionAcknowledgementTainted('translatorPresets')).toBe(true)
    expect(isSettingsGroupAcknowledgementTainted('language')).toBe(true)

    const presetSelect = target.querySelector<HTMLSelectElement>('select')
    expect(presetSelect?.options).toHaveLength(2)
    expect(presetSelect?.value).toBe('0')
    expect(promptTextarea().value).toBe('old prompt A')
    expect(maxResponseInput().value).toBe('100')
  })

  it('removes a rejected optimistic create even when its draft was edited before the response', async () => {
    commandSpies.deferNextCreate = true

    await clickCreatePreset()
    const createdPresetId = commandSpies.createInputs[0].preset.id
    await editPrompt('draft for the pending preset')

    await failDeferredCommand(commandSpies.deferredCreateResults, 'forced create failure')

    expect(getDatabase().translatorPresets.map((preset) => preset.id)).toEqual(['preset-a', 'preset-b'])
    expect(getDatabase().translatorPresetId).toBe(0)
    expect(getDatabase().translatorPrompt).toBe('old prompt A')

    await vi.advanceTimersByTimeAsync(250)
    expect(commandSpies.updateInputs.some((input) => input.presetId === createdPresetId)).toBe(false)
  })

  it('replays a retained create before an edit to its new translator preset owner', async () => {
    vi.useRealTimers()
    vi.stubGlobal('indexedDB', new IDBFactory())
    resetPendingMutationOutboxForTests()
    await preparePendingMutationOutbox({
      writerSessionId: 'writer-translator-create-edit',
      writerEpoch: 6,
      databaseLineage: 'lineage-translator-create-edit',
      requestedWriterWasActive: true,
    })
    commandSpies.deferNextCreate = true

    try {
      await clickCreatePreset()
      await vi.waitFor(() => expect(commandSpies.createInputs).toHaveLength(1))
      const createdPresetId = commandSpies.createInputs[0].preset.id as string
      await editPrompt('draft after retained create')

      await vi.waitFor(async () => expect(await listPendingMutations()).toHaveLength(2))
      await failDeferredCommand(commandSpies.deferredCreateResults, 'transient create failure')
      await vi.waitFor(() => {
        expect(getDatabase().translatorPresets.some((preset) => preset.id === createdPresetId)).toBe(false)
      })

      const retained = await listPendingMutations()
      expect(retained.map((entry) => entry.handle.key)).toEqual([
        'translator-preset:selection',
        `translator-preset:${createdPresetId}`,
      ])
      expect(retained[0].intent.dependencyKeys).toEqual([
        'translator-preset:preset-a',
        `translator-preset:${createdPresetId}`,
      ])
      expect(retained[1].intent).toEqual({
        version: 1,
        dependencyKeys: ['translator-preset:selection'],
        requests: [
          {
            method: 'PATCH',
            path: `/translator-presets/${createdPresetId}`,
            body: { patch: { prompt: 'draft after retained create' } },
          },
        ],
      })
      expect(commandSpies.updateInputs).toEqual([])

      for (const entry of retained) {
        await expect(dispatchDurableMutationReplay(entry.handle, entry.intent)).resolves.toMatchObject({
          disposition: 'succeeded',
        })
      }
      expect(commandSpies.replayInputs.map(({ requests }) => requests[0])).toEqual([
        {
          method: 'POST',
          path: '/translator-presets',
          body: {
            preset: {
              id: createdPresetId,
              name: 'New Preset',
              prompt: '',
              maxResponse: 1000,
            },
            select: true,
          },
        },
        {
          method: 'PATCH',
          path: `/translator-presets/${createdPresetId}`,
          body: { patch: { prompt: 'draft after retained create' } },
        },
      ])
      expect(await listPendingMutations()).toEqual([])
    } finally {
      if (component) {
        unmount(component)
        component = undefined
        await flushMicrotasks()
      }
      await clearPendingMutationOutbox()
      resetPendingMutationOutboxForTests()
      vi.useFakeTimers()
    }
  })

  it('keeps a later optimistic create visible through the first create projection', async () => {
    commandSpies.deferNextCreate = true
    await clickCreatePreset()
    const firstPreset = { ...getDatabase().translatorPresets.at(-1)! }

    commandSpies.deferNextCreate = true
    await clickCreatePreset()
    const secondPreset = { ...getDatabase().translatorPresets.at(-1)! }

    await applyTranslatorPresetProjection({
      presets: [
        { id: 'preset-a', name: 'Preset A', prompt: 'old prompt A', maxResponse: 100 },
        { id: 'preset-b', name: 'Preset B', prompt: 'old prompt B', maxResponse: 200 },
        firstPreset as { id: string; name: string; prompt: string; maxResponse: number },
      ],
      selectedIndex: 2,
    })

    expect(getDatabase().translatorPresets.map((preset) => preset.id)).toEqual([
      'preset-a',
      'preset-b',
      firstPreset.id,
      secondPreset.id,
    ])
    expect(currentSelectedPresetId()).toBe(secondPreset.id)

    const [firstResult, secondResult] = commandSpies.deferredCreateResults.splice(0)
    firstResult.resolve({ status: 'ok' })
    secondResult.resolve({ status: 'ok' })
    await flushMicrotasks()
  })

  it('removes a rejected create reasserted after a destructive refresh suppressed transport rollback', async () => {
    commandSpies.deferNextCreate = true
    await clickCreatePreset()
    const createdPresetId = getDatabase().translatorPresets.at(-1)?.id

    await applyTranslatorPresetProjection({
      presets: [
        { id: 'preset-a', name: 'Server A', prompt: 'server prompt A', maxResponse: 111 },
        { id: 'preset-b', name: 'Server B', prompt: 'server prompt B', maxResponse: 222 },
      ],
      selectedIndex: 0,
    })
    expect(getDatabase().translatorPresets.some((preset) => preset.id === createdPresetId)).toBe(true)

    commandSpies.skipNextRollback = true
    await failDeferredCommand(commandSpies.deferredCreateResults, 'forced create failure after refresh')

    expect(getDatabase().translatorPresets.map((preset) => preset.id)).toEqual(['preset-a', 'preset-b'])
    expect(currentSelectedPresetId()).toBe('preset-a')
    expect(getDatabase().translatorPrompt).toBe('server prompt A')
  })

  it('paints a selection while a pending preset edit is still being persisted', async () => {
    commandSpies.deferNextUpdate = true
    await editPrompt('pending prompt A')

    await selectTranslatorPreset(1)

    expect(commandSpies.updateInputs).toEqual([
      {
        baseRevision: 100,
        presetId: 'preset-a',
        patch: { prompt: 'pending prompt A' },
      },
    ])
    expect(commandSpies.selectInputs).toHaveLength(0)
    expect(getDatabase().translatorPresetId).toBe(1)
    expect(getDatabase().translatorPrompt).toBe('old prompt B')
    expect(getDatabase().translatorMaxResponse).toBe(200)

    const presetSelect = target.querySelector<HTMLSelectElement>('select')
    expect(presetSelect?.value).toBe('1')
    expect(promptTextarea().value).toBe('old prompt B')
    expect(maxResponseInput().value).toBe('200')

    const deferredUpdate = commandSpies.deferredUpdateResults.shift()
    expect(deferredUpdate).toBeTruthy()
    deferredUpdate!.resolve({ status: 'ok' })
    for (let attempt = 0; attempt < 5 && commandSpies.selectInputs.length === 0; attempt++) {
      await flushMicrotasks()
    }
    await tick()

    expect(commandSpies.selectInputs).toEqual([{ baseRevision: 101, presetId: 'preset-b' }])
  })

  it('preserves newer row edits while rolling back a failed selection', async () => {
    commandSpies.deferNextSelect = true

    await selectTranslatorPreset(1)

    expect(commandSpies.selectInputs).toEqual([{ baseRevision: 100, presetId: 'preset-b' }])
    expect(commandSpies.runInputs.at(-1)?.rollback).toEqual(expect.any(Function))
    expect(getDatabase().translatorPresetId).toBe(1)
    expect(getDatabase().translatorPrompt).toBe('old prompt B')
    expect(getDatabase().translatorMaxResponse).toBe(200)

    const presetSelect = target.querySelector<HTMLSelectElement>('select')
    expect(presetSelect?.value).toBe('1')
    expect(promptTextarea().value).toBe('old prompt B')
    expect(maxResponseInput().value).toBe('200')

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

    expect(getDatabase().translatorPresetId).toBe(0)
    expect(getDatabase().translatorPresets[1]).toMatchObject({
      name: 'Preset B Edited',
      prompt: 'newer prompt B',
      maxResponse: 222,
    })
    expect(getDatabase().translatorPrompt).toBe('old prompt A')
    expect(getDatabase().translatorMaxResponse).toBe(100)
  })

  it('rolls back a rejected optimistic selection while it remains current', async () => {
    commandSpies.deferNextSelect = true

    await selectTranslatorPreset(1)

    expect(getDatabase().translatorPresetId).toBe(1)
    expect(getDatabase().translatorPrompt).toBe('old prompt B')
    expect(getDatabase().translatorMaxResponse).toBe(200)

    await failDeferredCommand(commandSpies.deferredSelectResults, 'forced select failure')

    expect(getDatabase().translatorPresetId).toBe(0)
    expect(getDatabase().translatorPrompt).toBe('old prompt A')
    expect(getDatabase().translatorMaxResponse).toBe(100)
    expect(isSettingsGroupAcknowledgementTainted('language')).toBe(true)

    const presetSelect = target.querySelector<HTMLSelectElement>('select')
    expect(presetSelect?.value).toBe('0')
    expect(promptTextarea().value).toBe('old prompt A')
    expect(maxResponseInput().value).toBe('100')
  })

  it('rolls back selection and row edits independently when both commands fail', async () => {
    commandSpies.deferNextSelect = true
    await selectTranslatorPreset(1)
    await editPrompt('rejected prompt B')

    await failDeferredCommand(commandSpies.deferredSelectResults, 'forced select failure')
    commandSpies.failNextUpdate = true
    await vi.advanceTimersByTimeAsync(250)

    expect(currentSelectedPresetId()).toBe('preset-a')
    expect(getDatabase().translatorPresets[1].prompt).toBe('old prompt B')
    expect(getDatabase().translatorPrompt).toBe('old prompt A')
    expect(getDatabase().translatorMaxResponse).toBe(100)
  })

  it('returns to the confirmed selection when two rapid selections are both rejected', async () => {
    commandSpies.deferNextSelect = true
    await selectTranslatorPreset(1)
    commandSpies.deferNextSelect = true
    await selectTranslatorPreset(0)

    expect(getDatabase().translatorPresetId).toBe(0)
    expect(commandSpies.deferredSelectResults).toHaveLength(2)

    await failDeferredCommand(commandSpies.deferredSelectResults, 'forced first select failure')
    await failDeferredCommand(commandSpies.deferredSelectResults, 'forced second select failure')

    expect(getDatabase().translatorPresetId).toBe(0)
    expect(getDatabase().translatorPrompt).toBe('old prompt A')
    expect(getDatabase().translatorMaxResponse).toBe(100)
  })

  it('returns to the confirmed selection after a rejected delete followed by a rejected selection', async () => {
    await appendPresetC()
    commandSpies.deferNextDelete = true
    await clickDeletePreset()
    commandSpies.deferNextSelect = true
    await selectTranslatorPreset(1)

    await failDeferredCommand(commandSpies.deferredDeleteResults, 'forced delete failure')
    await failDeferredCommand(commandSpies.deferredSelectResults, 'forced select failure')

    expect(getDatabase().translatorPresets.map((preset) => preset.id)).toEqual(['preset-a', 'preset-b', 'preset-c'])
    expect(currentSelectedPresetId()).toBe('preset-a')
    expect(getDatabase().translatorPrompt).toBe('old prompt A')
  })

  it('renames the preset named by the open dialog even if selection changes while awaiting input', async () => {
    let resolveName: (value: string | null) => void = () => {}
    vi.mocked(alertInput).mockReturnValueOnce(
      new Promise<string | null>((resolve) => {
        resolveName = resolve
      }),
    )

    toolbarButton(1).click()
    await tick()
    await selectTranslatorPreset(1)
    resolveName('Renamed A')
    await flushMicrotasks()
    await tick()

    expect(getDatabase().translatorPresets[0].name).toBe('Renamed A')
    expect(getDatabase().translatorPresets[1].name).toBe('Preset B')

    await vi.advanceTimersByTimeAsync(250)
    expect(commandSpies.updateInputs.at(-1)).toMatchObject({
      presetId: 'preset-a',
      patch: { name: 'Renamed A' },
    })
  })

  it('does not roll back a selection after a newer language projection', async () => {
    commandSpies.deferNextSelect = true

    await selectTranslatorPreset(1)

    expect(
      applySettingsGroupResource(
        {
          revision: 101,
          group: 'language',
          settings: {
            translatorPresetId: 1,
            translatorPrompt: 'old prompt B',
            translatorMaxResponse: 200,
          },
        },
        ['translatorPresetId', 'translatorPrompt', 'translatorMaxResponse'],
      ),
    ).toBe(true)

    await failDeferredCommand(commandSpies.deferredSelectResults, 'forced select failure')

    expect(getDatabase().translatorPresetId).toBe(1)
    expect(getDatabase().translatorPrompt).toBe('old prompt B')
    expect(getDatabase().translatorMaxResponse).toBe(200)
  })

  it('holds translator selection behind retained outgoing and target preset owners', async () => {
    vi.useRealTimers()
    vi.stubGlobal('indexedDB', new IDBFactory())
    resetPendingMutationOutboxForTests()
    await preparePendingMutationOutbox({
      writerSessionId: 'writer-translator-select-dependencies',
      writerEpoch: 7,
      databaseLineage: 'lineage-translator-select-dependencies',
      requestedWriterWasActive: true,
    })
    commandSpies.failNextUpdate = true
    commandSpies.inlineReplayResults.push({ status: 'error', error: 'preset row predecessor still offline' })

    try {
      await editPrompt('retained prompt A')
      await selectTranslatorPreset(1)

      await vi.waitFor(async () => expect(await listPendingMutations()).toHaveLength(2))
      expect(commandSpies.selectInputs).toEqual([])
      const retained = await listPendingMutations()
      expect(retained.map((entry) => entry.handle.key)).toEqual([
        'translator-preset:preset-a',
        'translator-preset:selection',
      ])
      expect(retained[1].intent).toEqual({
        version: 1,
        dependencyKeys: ['translator-preset:preset-a', 'translator-preset:preset-b'],
        requests: [
          {
            method: 'POST',
            path: '/translator-presets/select',
            body: { presetId: 'preset-b' },
          },
        ],
      })

      for (const entry of retained) {
        await expect(dispatchDurableMutationReplay(entry.handle, entry.intent)).resolves.toMatchObject({
          disposition: 'succeeded',
        })
      }
      expect(commandSpies.replayInputs.map(({ requests }) => requests[0])).toEqual([
        {
          method: 'PATCH',
          path: '/translator-presets/preset-a',
          body: { patch: { prompt: 'retained prompt A' } },
        },
        {
          method: 'POST',
          path: '/translator-presets/select',
          body: { presetId: 'preset-b' },
        },
      ])
      expect(await listPendingMutations()).toEqual([])
    } finally {
      if (component) {
        unmount(component)
        component = undefined
        await flushMicrotasks()
      }
      await clearPendingMutationOutbox()
      resetPendingMutationOutboxForTests()
      vi.useFakeTimers()
    }
  })

  it('keeps a later translator selection behind a retained delete fallback', async () => {
    vi.useRealTimers()
    vi.stubGlobal('indexedDB', new IDBFactory())
    resetPendingMutationOutboxForTests()
    await preparePendingMutationOutbox({
      writerSessionId: 'writer-translator-delete-select',
      writerEpoch: 8,
      databaseLineage: 'lineage-translator-delete-select',
      requestedWriterWasActive: true,
    })
    await appendPresetC()
    commandSpies.failNextDelete = true

    try {
      await clickDeletePreset()
      await vi.waitFor(() => {
        expect(getDatabase().translatorPresets.map((preset) => preset.id)).toEqual(['preset-a', 'preset-b', 'preset-c'])
      })
      await tick()
      commandSpies.inlineReplayResults.push({ status: 'error', error: 'delete fallback still offline' })
      await selectTranslatorPreset(2)

      await vi.waitFor(async () => expect(await listPendingMutations()).toHaveLength(2))
      expect(commandSpies.selectInputs).toEqual([])
      const retained = await listPendingMutations()
      expect(retained.map((entry) => [entry.handle.key, entry.intent.requests[0].method])).toEqual([
        ['translator-preset:selection', 'DELETE'],
        ['translator-preset:selection', 'POST'],
      ])
      expect(retained[0].intent.dependencyKeys).toEqual(['translator-preset:preset-a'])
      expect(retained[1].intent.dependencyKeys).toEqual(['translator-preset:preset-a', 'translator-preset:preset-c'])

      for (const entry of retained) {
        await expect(dispatchDurableMutationReplay(entry.handle, entry.intent)).resolves.toMatchObject({
          disposition: 'succeeded',
        })
      }
      expect(commandSpies.replayInputs.map(({ requests }) => requests[0])).toEqual([
        {
          method: 'DELETE',
          path: '/translator-presets/preset-a',
          body: { selectPresetId: 'preset-b' },
        },
        {
          method: 'POST',
          path: '/translator-presets/select',
          body: { presetId: 'preset-c' },
        },
      ])
      expect(await listPendingMutations()).toEqual([])
    } finally {
      if (component) {
        unmount(component)
        component = undefined
        await flushMicrotasks()
      }
      await clearPendingMutationOutbox()
      resetPendingMutationOutboxForTests()
      vi.useFakeTimers()
    }
  })

  it('retains PATCH then DELETE order after a transient predecessor and restores the latest optimistic row', async () => {
    vi.useRealTimers()
    vi.stubGlobal('indexedDB', new IDBFactory())
    resetPendingMutationOutboxForTests()
    await preparePendingMutationOutbox({
      writerSessionId: 'writer-translator-delete',
      writerEpoch: 8,
      databaseLineage: 'lineage-translator-delete',
      requestedWriterWasActive: true,
    })
    commandSpies.failNextUpdate = true
    commandSpies.inlineReplayResults.push({ status: 'error', error: 'PATCH predecessor still offline' })

    try {
      await editPrompt('latest optimistic prompt A')
      await clickDeletePreset()

      await vi.waitFor(async () => {
        expect((await listPendingMutations()).map((entry) => entry.intent)).toEqual([
          {
            version: 1,
            dependencyKeys: ['translator-preset:selection'],
            requests: [
              {
                method: 'PATCH',
                path: '/translator-presets/preset-a',
                body: { patch: { prompt: 'latest optimistic prompt A' } },
              },
            ],
          },
          {
            version: 1,
            dependencyKeys: ['translator-preset:preset-a'],
            requests: [
              {
                method: 'DELETE',
                path: '/translator-presets/preset-a',
                body: { selectPresetId: 'preset-b' },
              },
            ],
          },
        ])
      })
      expect(commandSpies.deleteInputs).toEqual([])
      expect(getDatabase().translatorPresets.map((preset) => preset.id)).toEqual(['preset-a', 'preset-b'])
      expect(getDatabase().translatorPresets[0].prompt).toBe('latest optimistic prompt A')
      expect(getDatabase().translatorPrompt).toBe('latest optimistic prompt A')

      const retained = await listPendingMutations()
      for (const entry of retained) {
        await expect(dispatchDurableMutationReplay(entry.handle, entry.intent)).resolves.toMatchObject({
          disposition: 'succeeded',
        })
      }

      expect(commandSpies.replayInputs.map(({ requests }) => requests[0])).toEqual([
        {
          method: 'PATCH',
          path: '/translator-presets/preset-a',
          body: { patch: { prompt: 'latest optimistic prompt A' } },
        },
        {
          method: 'DELETE',
          path: '/translator-presets/preset-a',
          body: { selectPresetId: 'preset-b' },
        },
      ])
      expect(await listPendingMutations()).toEqual([])
    } finally {
      if (component) {
        unmount(component)
        component = undefined
        await flushMicrotasks()
      }
      await clearPendingMutationOutbox()
      resetPendingMutationOutboxForTests()
      vi.useFakeTimers()
    }
  })

  it('restores and reasserts the pre-flush optimistic row when PATCH retry succeeds but DELETE fails', async () => {
    vi.useRealTimers()
    vi.stubGlobal('indexedDB', new IDBFactory())
    resetPendingMutationOutboxForTests()
    await preparePendingMutationOutbox({
      writerSessionId: 'writer-translator-delete-rollback',
      writerEpoch: 9,
      databaseLineage: 'lineage-translator-delete-rollback',
      requestedWriterWasActive: true,
    })
    commandSpies.failNextUpdate = true
    commandSpies.failNextDelete = true

    try {
      await editPrompt('pre-flush optimistic prompt A')
      await clickDeletePreset()

      await vi.waitFor(() => {
        expect(commandSpies.deleteInputs).toEqual([
          { baseRevision: 101, presetId: 'preset-a', selectPresetId: 'preset-b' },
        ])
      })
      expect(commandSpies.inlineReplayInputs.map(({ requests }) => requests[0])).toEqual([
        {
          method: 'PATCH',
          path: '/translator-presets/preset-a',
          body: { patch: { prompt: 'pre-flush optimistic prompt A' } },
        },
      ])
      expect(getDatabase().translatorPresets[0]).toMatchObject({
        id: 'preset-a',
        prompt: 'pre-flush optimistic prompt A',
      })
      expect(getDatabase().translatorPrompt).toBe('pre-flush optimistic prompt A')

      await applyTranslatorPresetProjection({
        presets: [
          { id: 'preset-a', name: 'Preset A', prompt: 'old prompt A', maxResponse: 100 },
          { id: 'preset-b', name: 'Preset B', prompt: 'old prompt B', maxResponse: 200 },
        ],
        selectedIndex: 0,
      })
      expect(getDatabase().translatorPresets[0].prompt).toBe('pre-flush optimistic prompt A')
      expect(getDatabase().translatorPrompt).toBe('pre-flush optimistic prompt A')

      const retainedDelete = await listPendingMutations()
      expect(retainedDelete.map((entry) => entry.intent)).toEqual([
        {
          version: 1,
          dependencyKeys: ['translator-preset:preset-a'],
          requests: [
            {
              method: 'DELETE',
              path: '/translator-presets/preset-a',
              body: { selectPresetId: 'preset-b' },
            },
          ],
        },
      ])
      await expect(
        dispatchDurableMutationReplay(retainedDelete[0].handle, retainedDelete[0].intent),
      ).resolves.toMatchObject({ disposition: 'succeeded' })
      expect(await listPendingMutations()).toEqual([])
    } finally {
      if (component) {
        unmount(component)
        component = undefined
        await flushMicrotasks()
      }
      await clearPendingMutationOutbox()
      resetPendingMutationOutboxForTests()
      vi.useFakeTimers()
    }
  })

  it('preserves newer row edits and appended rows when a deferred delete command fails', async () => {
    commandSpies.deferNextDelete = true

    await clickDeletePreset()

    expect(commandSpies.deleteInputs).toEqual([{ baseRevision: 100, presetId: 'preset-a', selectPresetId: 'preset-b' }])
    expect(commandSpies.runInputs.at(-1)?.rollback).toEqual(expect.any(Function))
    expect(getDatabase().translatorPresets.map((preset) => preset.id)).toEqual(['preset-b'])
    expect(getDatabase().translatorPresetId).toBe(0)
    expect(getDatabase().translatorPrompt).toBe('old prompt B')
    expect(getDatabase().translatorMaxResponse).toBe(200)

    const presetSelect = target.querySelector<HTMLSelectElement>('select')
    expect(presetSelect?.options).toHaveLength(1)
    expect(presetSelect?.value).toBe('0')
    expect(presetSelect?.options.item(0)?.textContent).toBe('Preset B')
    expect(promptTextarea().value).toBe('old prompt B')
    expect(maxResponseInput().value).toBe('200')

    withTrustedResourceWrite(() => {
      getDatabase().translatorPresets = [
        {
          ...getDatabase().translatorPresets[0],
          name: 'Preset B Edited',
          prompt: 'newer prompt B',
          maxResponse: 222,
        },
        { id: 'preset-c', name: 'Preset C', prompt: 'new prompt C', maxResponse: 300 },
      ]
      getDatabase().translatorPresetId = 1
      getDatabase().translatorPrompt = 'new prompt C'
      getDatabase().translatorMaxResponse = 300
    })

    await failDeferredCommand(commandSpies.deferredDeleteResults, 'forced delete failure')

    expect(getDatabase().translatorPresets.map((preset) => preset.id)).toEqual(['preset-a', 'preset-b', 'preset-c'])
    expect(getDatabase().translatorPresets[1]).toMatchObject({
      name: 'Preset B Edited',
      prompt: 'newer prompt B',
      maxResponse: 222,
    })
    expect(getDatabase().translatorPresetId).toBe(2)
    expect(getDatabase().translatorPrompt).toBe('new prompt C')
    expect(getDatabase().translatorMaxResponse).toBe(300)
  })

  it('rolls back a rejected optimistic delete while it remains current', async () => {
    commandSpies.deferNextDelete = true

    await clickDeletePreset()

    expect(getDatabase().translatorPresets.map((preset) => preset.id)).toEqual(['preset-b'])
    expect(getDatabase().translatorPresetId).toBe(0)

    await failDeferredCommand(commandSpies.deferredDeleteResults, 'forced delete failure')

    expect(getDatabase().translatorPresets.map((preset) => preset.id)).toEqual(['preset-a', 'preset-b'])
    expect(getDatabase().translatorPresetId).toBe(0)
    expect(getDatabase().translatorPrompt).toBe('old prompt A')
    expect(getDatabase().translatorMaxResponse).toBe(100)
    expect(isCollectionAcknowledgementTainted('translatorPresets')).toBe(true)
    expect(isSettingsGroupAcknowledgementTainted('language')).toBe(true)

    const presetSelect = target.querySelector<HTMLSelectElement>('select')
    expect(presetSelect?.options).toHaveLength(2)
    expect(presetSelect?.value).toBe('0')
    expect(promptTextarea().value).toBe('old prompt A')
    expect(maxResponseInput().value).toBe('100')
  })

  it('restores a failed deletion without replacing a newer fallback edit', async () => {
    commandSpies.deferNextDelete = true

    await clickDeletePreset()

    withTrustedResourceWrite(() => {
      getDatabase().translatorPresets = [
        {
          ...getDatabase().translatorPresets[0],
          name: 'Preset B Edited',
        },
      ]
    })

    await failDeferredCommand(commandSpies.deferredDeleteResults, 'forced delete failure')

    expect(getDatabase().translatorPresets.map((preset) => preset.id)).toEqual(['preset-a', 'preset-b'])
    expect(getDatabase().translatorPresets[1].name).toBe('Preset B Edited')
    expect(getDatabase().translatorPresetId).toBe(0)
    expect(getDatabase().translatorPrompt).toBe('old prompt A')
    expect(getDatabase().translatorMaxResponse).toBe(100)
  })

  it('restores a failed deletion selection even when a fallback row edit also fails', async () => {
    commandSpies.deferNextDelete = true
    await clickDeletePreset()
    await editPrompt('rejected prompt B')

    await failDeferredCommand(commandSpies.deferredDeleteResults, 'forced delete failure')
    commandSpies.failNextUpdate = true
    await vi.advanceTimersByTimeAsync(250)

    expect(getDatabase().translatorPresets.map((preset) => preset.id)).toEqual(['preset-a', 'preset-b'])
    expect(currentSelectedPresetId()).toBe('preset-a')
    expect(getDatabase().translatorPresets[1].prompt).toBe('old prompt B')
    expect(getDatabase().translatorPrompt).toBe('old prompt A')
  })

  it('restores authoritative projected row values when a pending deletion fails', async () => {
    commandSpies.deferNextDelete = true
    await clickDeletePreset()

    expect(
      withServerResourceApply(() =>
        applyCollectionsResource(
          {
            revision: 101,
            collections: {
              translatorPresets: [
                {
                  id: 'preset-a',
                  name: 'Server Preset A',
                  prompt: 'server prompt A',
                  maxResponse: 111,
                },
                { id: 'preset-b', name: 'Preset B', prompt: 'old prompt B', maxResponse: 200 },
              ],
            },
          },
          'translatorPresets',
        ),
      ),
    ).toBe(true)
    await tick()
    await flushMicrotasks()
    await tick()

    expect(getDatabase().translatorPresets.map((preset) => preset.id)).toEqual(['preset-b'])

    await failDeferredCommand(commandSpies.deferredDeleteResults, 'forced delete failure')

    expect(getDatabase().translatorPresets.map((preset) => preset.id)).toEqual(['preset-a', 'preset-b'])
    expect(getDatabase().translatorPresets[0]).toMatchObject({
      name: 'Server Preset A',
      prompt: 'server prompt A',
      maxResponse: 111,
    })
    expect(currentSelectedPresetId()).toBe('preset-a')
    expect(getDatabase().translatorPrompt).toBe('server prompt A')
    expect(getDatabase().translatorMaxResponse).toBe(111)
  })

  it('decodes an authoritative selected index against the unfiltered collection during a pending delete', async () => {
    await appendPresetC()
    commandSpies.deferNextDelete = true
    await clickDeletePreset()

    expect(
      withServerResourceApply(() =>
        applySettingsGroupResource(
          {
            revision: 101,
            group: 'language',
            settings: {
              translatorPresetId: 1,
              translatorPrompt: 'old prompt B',
              translatorMaxResponse: 200,
            },
          },
          ['translatorPresetId', 'translatorPrompt', 'translatorMaxResponse'],
        ),
      ),
    ).toBe(true)
    await tick()
    await flushMicrotasks()
    await tick()

    expect(currentSelectedPresetId()).toBe('preset-b')

    await failDeferredCommand(commandSpies.deferredDeleteResults, 'forced delete failure')

    expect(getDatabase().translatorPresets.map((preset) => preset.id)).toEqual(['preset-a', 'preset-b', 'preset-c'])
    expect(currentSelectedPresetId()).toBe('preset-b')
    expect(getDatabase().translatorPrompt).toBe('old prompt B')
    expect(getDatabase().translatorMaxResponse).toBe(200)
  })

  it('does not resurrect a pending create when both its create and delete commands fail', async () => {
    commandSpies.deferNextCreate = true
    await clickCreatePreset()
    const createdPresetId = getDatabase().translatorPresets.at(-1)?.id
    commandSpies.deferNextDelete = true
    await clickDeletePreset()

    await failDeferredCommand(commandSpies.deferredCreateResults, 'forced create failure')
    await failDeferredCommand(commandSpies.deferredDeleteResults, 'forced delete failure')

    expect(getDatabase().translatorPresets.map((preset) => preset.id)).toEqual(['preset-a', 'preset-b'])
    expect(getDatabase().translatorPresets.some((preset) => preset.id === createdPresetId)).toBe(false)
    expect(currentSelectedPresetId()).toBe('preset-a')
  })

  it('preserves an authoritative created row when its pending create and delete both fail', async () => {
    commandSpies.deferNextCreate = true
    await clickCreatePreset()
    const createdPresetId = getDatabase().translatorPresets.at(-1)?.id
    expect(createdPresetId).toBeTruthy()
    commandSpies.deferNextDelete = true
    await clickDeletePreset()

    await applyTranslatorPresetProjection({
      presets: [
        { id: 'preset-a', name: 'Server A', prompt: 'server prompt A', maxResponse: 111 },
        { id: 'preset-b', name: 'Server B', prompt: 'server prompt B', maxResponse: 222 },
        {
          id: createdPresetId!,
          name: 'Authoritative C',
          prompt: 'authoritative prompt C',
          maxResponse: 333,
        },
      ],
      selectedIndex: 2,
    })
    expect(getDatabase().translatorPresets.some((preset) => preset.id === createdPresetId)).toBe(false)

    await failDeferredCommand(commandSpies.deferredCreateResults, 'forced create failure')
    await failDeferredCommand(commandSpies.deferredDeleteResults, 'forced delete failure')

    expect(getDatabase().translatorPresets.at(-1)).toMatchObject({
      id: createdPresetId,
      name: 'Authoritative C',
      prompt: 'authoritative prompt C',
      maxResponse: 333,
    })
    expect(currentSelectedPresetId()).toBe(createdPresetId)
    expect(getDatabase().translatorPrompt).toBe('authoritative prompt C')
  })

  it('restores a created preset when create succeeds but its pending delete fails', async () => {
    commandSpies.deferNextCreate = true
    await clickCreatePreset()
    const createdPresetId = getDatabase().translatorPresets.at(-1)?.id
    commandSpies.deferNextDelete = true
    await clickDeletePreset()

    const createResult = commandSpies.deferredCreateResults.shift()
    expect(createResult).toBeTruthy()
    createResult!.resolve({ status: 'ok' })
    await flushMicrotasks()
    await failDeferredCommand(commandSpies.deferredDeleteResults, 'forced delete failure')

    expect(getDatabase().translatorPresets.map((preset) => preset.id)).toEqual([
      'preset-a',
      'preset-b',
      createdPresetId,
    ])
    expect(currentSelectedPresetId()).toBe(createdPresetId)
  })

  it('restores rapid failed deletions in their original order', async () => {
    await appendPresetC()
    commandSpies.deferNextDelete = true
    await clickDeletePreset()
    commandSpies.deferNextDelete = true
    await clickDeletePreset()

    await failDeferredCommand(commandSpies.deferredDeleteResults, 'forced first delete failure')
    await failDeferredCommand(commandSpies.deferredDeleteResults, 'forced second delete failure')

    expect(getDatabase().translatorPresets.map((preset) => preset.id)).toEqual(['preset-a', 'preset-b', 'preset-c'])
    expect(currentSelectedPresetId()).toBe('preset-a')
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

  it('flushes a pending preset edit with keepalive through the lifecycle registry', async () => {
    await editPrompt('pagehide-flushed prompt A')

    expect(commandSpies.updateInputs).toHaveLength(0)

    flushRegisteredPendingBridgePatches({ keepalive: true })
    await flushMicrotasks()

    expect(commandSpies.updateInputs).toEqual([
      {
        baseRevision: 100,
        presetId: 'preset-a',
        patch: { prompt: 'pagehide-flushed prompt A' },
      },
    ])
    expect(commandSpies.updateTransportOptions).toEqual([{ signal: undefined, keepalive: true }])
    expect(commandSpies.runInputs[0]).toMatchObject({ keepalive: true })

    await vi.advanceTimersByTimeAsync(250)
    expect(commandSpies.updateInputs).toHaveLength(1)
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

  it('does not settle a dirty prompt when an unrelated resource apply completes', async () => {
    await editPrompt('dirty prompt A')

    withServerResourceApply(() => undefined)
    await tick()
    await applyTranslatorPresetProjection({
      presets: [
        { id: 'preset-a', name: 'Projected A', prompt: 'stale prompt A', maxResponse: 100 },
        { id: 'preset-b', name: 'Projected B', prompt: 'projected prompt B', maxResponse: 220 },
      ],
      selectedIndex: 0,
    })

    expect(getDatabase().translatorPresets[0].prompt).toBe('dirty prompt A')
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
