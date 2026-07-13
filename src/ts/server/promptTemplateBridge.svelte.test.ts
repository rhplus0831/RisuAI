import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, tick, unmount } from 'svelte'

const commandState = vi.hoisted(() => ({
  revision: 1 as number | null,
  commands: [] as Array<{
    built: Record<string, unknown>
    rollback?: () => void
    keepalive?: boolean
  }>,
  beforeBuild: null as (() => void) | null,
}))

const resourceGuardState = vi.hoisted(() => ({
  epoch: 0,
}))

const commandMocks = vi.hoisted(() => ({
  canUseServerCommands: () => true,
  patchPromptSettingsCommand: vi.fn(
    async (args: Record<string, unknown>): Promise<Record<string, unknown>> => ({
      kind: 'patchPromptSettings',
      ...args,
    }),
  ),
  peekCachedServerCommandRevision: () => commandState.revision,
  runServerCommand: vi.fn(
    async (args: {
      command: (baseRevision: number) => Promise<Record<string, unknown>>
      rollback?: () => void
      keepalive?: boolean
    }) => {
      const beforeBuild = commandState.beforeBuild
      commandState.beforeBuild = null
      beforeBuild?.()
      const built = await args.command(1)
      if (built.status && built.status !== 'ok') {
        args.rollback?.()
        return built
      }
      commandState.commands.push({
        built,
        rollback: args.rollback,
        ...(args.keepalive ? { keepalive: args.keepalive } : {}),
      })
      return { status: 'ok', revision: 1 }
    },
  ),
  updatePromptItemCommand: vi.fn(async (args: Record<string, unknown>) => {
    const { optimisticAcknowledgement: _optimisticAcknowledgement, ...request } = args
    return {
      kind: 'updatePromptItem',
      ...request,
    }
  }),
  createPromptItemCommand: vi.fn(async (args: Record<string, unknown>) => ({
    kind: 'createPromptItem',
    ...args,
  })),
  deletePromptItemCommand: vi.fn(async (args: Record<string, unknown>) => ({
    kind: 'deletePromptItem',
    ...args,
  })),
  reorderPromptItemsCommand: vi.fn(async (args: Record<string, unknown>) => ({
    kind: 'reorderPromptItems',
    ...args,
  })),
  updatePromptPresetCommand: vi.fn(async (args: Record<string, unknown>) => ({
    kind: 'updatePromptPreset',
    ...args,
  })),
  updateModelPresetCommand: vi.fn(async (args: Record<string, unknown>) => ({
    kind: 'updateModelPreset',
    ...args,
  })),
  enablePromptItemsCommand: vi.fn(async (args: Record<string, unknown>) => ({
    kind: 'enablePromptItems',
    ...args,
  })),
}))

const hydrationState = vi.hoisted(() => {
  let hydrated = true
  let ownerId: string | null = null
  let hydratedOwnerId: string | null | undefined = undefined
  const subscribers = new Set<(value: boolean) => void>()
  const ownerEpochs = new Map<string | null, number>()
  const taintedOwners = new Set<string | null>()
  return {
    ensure: vi.fn(
      async (options?: { promptPresetId?: string | null }) =>
        hydrated &&
        (hydratedOwnerId === undefined ||
          hydratedOwnerId === (options?.promptPresetId === undefined ? ownerId : options.promptPresetId)),
    ),
    isHydrated: (promptPresetId: string | null = ownerId) =>
      hydrated && (hydratedOwnerId === undefined || hydratedOwnerId === promptPresetId),
    currentOwner: () => ownerId,
    captureOwnerEpoch: (owner: string | null = ownerId) => ownerEpochs.get(owner) ?? 0,
    hasOwnerEpochChanged: (owner: string | null, epoch: number) => (ownerEpochs.get(owner) ?? 0) !== epoch,
    advanceOwnerEpoch: (owner: string | null) => ownerEpochs.set(owner, (ownerEpochs.get(owner) ?? 0) + 1),
    resetOwnerEpochs: () => ownerEpochs.clear(),
    isTainted: (owner: string | null) => taintedOwners.has(owner),
    markTainted: (owner: string | null) => taintedOwners.add(owner),
    resetTaints: () => taintedOwners.clear(),
    setOwner: (value: string | null) => {
      ownerId = value
    },
    setHydrated: (value: boolean, owner?: string | null) => {
      hydrated = value
      hydratedOwnerId = owner
      for (const subscriber of subscribers) subscriber(value)
    },
    store: {
      subscribe: (run: (value: boolean) => void) => {
        run(hydrated)
        subscribers.add(run)
        return () => subscribers.delete(run)
      },
    },
  }
})

vi.mock('./commands', () => commandMocks)
vi.mock('src/ts/server/commands', () => commandMocks)

vi.mock('./resourceWriteGuard.svelte', () => ({
  getServerResourceApplyEpoch: () => resourceGuardState.epoch,
  withServerResourceApply: (fn: () => unknown) => {
    const result = fn()
    resourceGuardState.epoch += 1
    return result
  },
  withTrustedResourceWrite: (fn: () => unknown) => fn(),
}))
vi.mock('src/ts/server/resourceWriteGuard.svelte', () => ({
  getServerResourceApplyEpoch: () => resourceGuardState.epoch,
  withServerResourceApply: (fn: () => unknown) => {
    const result = fn()
    resourceGuardState.epoch += 1
    return result
  },
  withTrustedResourceWrite: (fn: () => unknown) => fn(),
}))

vi.mock('src/ts/server/settingsBridge.svelte', () => ({
  createServerBackedSettingDraft: vi.fn((_key: string, fallback: unknown) => ({ value: fallback })),
  watchServerBackedSettings: vi.fn(() => () => {}),
}))

vi.mock('./promptTemplateHydration', () => ({
  capturePromptTemplateOwnerProjectionEpoch: hydrationState.captureOwnerEpoch,
  currentPromptTemplateOwnerId: hydrationState.currentOwner,
  hasPromptTemplateOwnerProjectionEpochChanged: hydrationState.hasOwnerEpochChanged,
  ensurePromptTemplateHydrated: hydrationState.ensure,
  isPromptTemplateHydrated: hydrationState.isHydrated,
  markPromptTemplateOwnerAcknowledgementTainted: hydrationState.markTainted,
  promptTemplateHydratedStore: hydrationState.store,
}))
vi.mock('src/ts/server/promptTemplateHydration', () => ({
  capturePromptTemplateOwnerProjectionEpoch: hydrationState.captureOwnerEpoch,
  currentPromptTemplateOwnerId: hydrationState.currentOwner,
  hasPromptTemplateOwnerProjectionEpochChanged: hydrationState.hasOwnerEpochChanged,
  ensurePromptTemplateHydrated: hydrationState.ensure,
  isPromptTemplateHydrated: hydrationState.isHydrated,
  markPromptTemplateOwnerAcknowledgementTainted: hydrationState.markTainted,
  promptTemplateHydratedStore: hydrationState.store,
}))

import type { PromptItem, PromptSettings as PromptSettingsFixture } from '../process/prompt'
import type { Database } from '../storage/database.svelte'
import { withCloneInstrumentation } from '../__tests__/cloneCostHarness'
import {
  applyCollectionsResource,
  captureSettingsGroupProjectionEpoch,
  getResourceDatabase,
  isSettingsGroupAcknowledgementTainted,
  replaceResourceDatabase,
} from './resourceState.svelte'
import PromptSettings from 'src/lib/Setting/Pages/PromptSettings.svelte'
import {
  createPromptItemCommand,
  deletePromptItemCommand,
  enablePromptItemsCommand,
  reorderPromptItemsCommand,
  type PromptItemOptimisticAcknowledgement,
  type PromptItemSnapshot,
} from './commands'
import { queuePromptItemProjectionUpdate as queuePromptItemProjectionUpdateForPromptSettings } from 'src/ts/server/promptTemplateBridge.svelte'
import {
  applyPromptItemProjectionWrite,
  capturePromptTemplateOwnerMutationFence,
  cloneJsonValue,
  flushPendingPromptTemplatePatches,
  queuePromptItemProjectionUpdate,
  queuePromptSettingsProjectionPatch,
  reconcilePromptTemplateDraft,
  resetPromptTemplateSelectionDirtyState,
  promptTemplateOwnerCommandId,
  restorePromptItemProjectionWrite,
  rollbackFailedPromptTemplateItemCreate,
  rollbackFailedPromptTemplateItemDelete,
  rollbackFailedPromptTemplateItemReorder,
  runPromptTemplateOwnerCommand,
  runPromptTemplateOwnerRollback,
  snapshotJson,
  type PromptTemplateDraftBinding,
} from './promptTemplateBridge.svelte'

const BIG = 'x'.repeat(5000)
type MountedComponent = Parameters<typeof unmount>[0]

const resourceDatabase = {
  set current(value: unknown) {
    replaceResourceDatabase(value as Database)
  },
}

const minimalPromptSettings: PromptSettingsFixture = {
  assistantPrefill: '',
  postEndInnerFormat: '',
  sendChatAsSystem: false,
  sendName: false,
  utilOverride: false,
}

function item(id: string, text: string): PromptItem {
  return { id, type: 'plain', type2: 'normal', role: 'system', text } as PromptItem
}

function promptItemSnapshot(id: string, text: string): PromptItemSnapshot {
  return { id, type: 'plain', type2: 'normal', role: 'system', text }
}

function promptItemFixture(value: Record<string, unknown>): PromptItem {
  return value as unknown as PromptItem
}

// `text` lives on the plain/jailbreak/cot/chatML PromptItem variants; the seed
// uses plain items, so read it through a narrow cast in assertions.
function textOf(value: PromptItem | undefined): string | undefined {
  return (value as { text?: string } | undefined)?.text
}

// One tiny edited item plus several large items, so a single-item clone is
// distinguishable from a whole-`promptTemplate` clone by serialized size.
function seedTemplate(): void {
  resourceDatabase.current = {
    promptTemplate: [item('p-0', 'small'), item('p-1', BIG), item('p-2', BIG), item('p-3', BIG)],
  }
}

function readSource(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

function draftCopy(): PromptItem[] {
  return cloneJsonValue((getResourceDatabase().promptTemplate ?? []) as PromptItem[])
}

function draftBindingFor(
  getDraftItems: () => PromptItem[],
  setDraftItems: (items: PromptItem[]) => void,
): PromptTemplateDraftBinding {
  return {
    getItems: getDraftItems,
    setItems: setDraftItems,
  }
}

async function flushPromptItemDirtyTestState(draftItems: PromptItem[]): Promise<void> {
  getResourceDatabase().promptTemplate = cloneJsonValue(draftItems)
  flushPendingPromptTemplatePatches()
  await Promise.resolve()
  await Promise.resolve()
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

function seedPromptSettings(overrides: Record<string, unknown> = {}): void {
  resourceDatabase.current = {
    promptTemplate: [],
    promptSettings: { ...minimalPromptSettings },
    customPromptTemplateToggle: 'server old',
    templateDefaultVariables: '',
    OAIPrediction: '',
    autoSuggestPrompt: '',
    systemContentReplacement: '',
    systemRoleReplacement: 'user',
    jsonSchemaEnabled: false,
    outputImageModal: false,
    strictJsonSchema: false,
    fallbackModels: {
      model: [],
      memory: [],
      translate: [],
      emotion: [],
      otherAx: [],
      scriptMain: [],
      scriptAux: [],
    },
    fallbackWhenBlankResponse: false,
    doNotChangeFallbackModels: false,
    ...overrides,
  }
}

async function mountPromptSettingsComponent(target: HTMLElement): Promise<MountedComponent> {
  const component = mount(PromptSettings, {
    target,
    props: { mode: 'inline', subMenu: 1 },
  })
  await tick()
  await flushMicrotasks()
  await tick()
  return component
}

function promptSettingsTextarea(target: HTMLElement, index = 0): HTMLTextAreaElement {
  const textarea = target.querySelectorAll<HTMLTextAreaElement>('textarea').item(index)
  expect(textarea).toBeTruthy()
  return textarea!
}

function promptSettingsTextInput(target: HTMLElement, index = 0): HTMLInputElement {
  const input = target.querySelectorAll<HTMLInputElement>('input[type="text"]').item(index)
  expect(input).toBeTruthy()
  return input!
}

async function editPromptSettingsTextarea(target: HTMLElement, value: string, index = 0): Promise<void> {
  const textarea = promptSettingsTextarea(target, index)
  textarea.value = value
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
  await tick()
  await flushMicrotasks()
  await tick()
}

async function editPromptSettingsTextInput(target: HTMLElement, value: string, index = 0): Promise<void> {
  const input = promptSettingsTextInput(target, index)
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await tick()
  await flushMicrotasks()
  await tick()
}

async function applyPromptSettingsProjection(apply: () => void): Promise<void> {
  apply()
  resourceDatabase.current = { ...(getResourceDatabase() as unknown as Record<string, unknown>) }
  resourceGuardState.epoch += 1
  await tick()
  await flushMicrotasks()
  await tick()
}

beforeEach(() => {
  vi.useFakeTimers()
  resourceGuardState.epoch = 0
  commandState.revision = 1
  commandState.commands.length = 0
  commandState.beforeBuild = null
  commandMocks.patchPromptSettingsCommand.mockClear()
  commandMocks.updatePromptItemCommand.mockClear()
  commandMocks.createPromptItemCommand.mockClear()
  commandMocks.deletePromptItemCommand.mockClear()
  commandMocks.reorderPromptItemsCommand.mockClear()
  commandMocks.enablePromptItemsCommand.mockClear()
  commandMocks.updatePromptPresetCommand.mockClear()
  commandMocks.updateModelPresetCommand.mockClear()
  commandMocks.runServerCommand.mockClear()
  hydrationState.setHydrated(true)
  hydrationState.setOwner(null)
  hydrationState.resetOwnerEpochs()
  hydrationState.resetTaints()
  hydrationState.ensure.mockClear()
  hydrationState.ensure.mockImplementation(async (options?: { promptPresetId?: string | null }) =>
    hydrationState.isHydrated(
      options?.promptPresetId === undefined ? hydrationState.currentOwner() : options.promptPresetId,
    ),
  )
})

afterEach(() => {
  vi.useRealTimers()
  resourceDatabase.current = {}
})

describe('applyPromptItemProjectionWrite', () => {
  it('mirrors only the edited item into the projection without a whole-array clone', () => {
    seedTemplate()
    const draft = draftCopy()
    draft[0] = item('p-0', 'edited')

    const instrumented = withCloneInstrumentation(() => applyPromptItemProjectionWrite(draft, 'p-0'))

    // The clone is one tiny item, never the multi-item array of large bodies.
    expect(instrumented.maxClonedSize).toBeLessThan(BIG.length)
    expect(instrumented.result).toEqual(item('p-0', 'edited'))
    expect((getResourceDatabase().promptTemplate as PromptItem[])[0]).toEqual(item('p-0', 'edited'))
    // Unrelated large items are untouched.
    expect(textOf((getResourceDatabase().promptTemplate as PromptItem[])[1])).toBe(BIG)
  })

  it('returns null and writes nothing when the item is gone from the draft', () => {
    seedTemplate()
    const result = applyPromptItemProjectionWrite(draftCopy(), 'missing')
    expect(result).toBeNull()
    expect((getResourceDatabase().promptTemplate as PromptItem[])[0]).toEqual(item('p-0', 'small'))
  })

  it('falls back to a full sync when the projection has no matching row yet', () => {
    seedTemplate()
    // The draft has a brand-new item absent from the projection.
    const draft = draftCopy()
    draft.push(item('p-new', 'fresh'))
    const result = applyPromptItemProjectionWrite(draft, 'p-new')
    expect(result).toEqual(item('p-new', 'fresh'))
    expect((getResourceDatabase().promptTemplate as PromptItem[]).map((p) => p.id)).toEqual([
      'p-0',
      'p-1',
      'p-2',
      'p-3',
      'p-new',
    ])
  })

  it('returns null without creating promptTemplate while the template is unloaded', () => {
    hydrationState.setHydrated(false)
    resourceDatabase.current = {}

    const result = applyPromptItemProjectionWrite([item('p-0', 'draft')], 'p-0')

    expect(result).toBeNull()
    expect(getResourceDatabase()).not.toHaveProperty('promptTemplate')
  })
})

describe('restorePromptItemProjectionWrite', () => {
  it('restores only the edited item, leaving concurrent edits to other items intact', () => {
    seedTemplate()
    const projection = getResourceDatabase().promptTemplate as PromptItem[]
    // The failing command had optimistically changed p-0; meanwhile p-1 changed too.
    ;(projection[0] as { text: string }).text = 'optimistic'
    ;(projection[1] as { text: string }).text = 'concurrent'

    restorePromptItemProjectionWrite('p-0', item('p-0', 'original'))

    expect((getResourceDatabase().promptTemplate as PromptItem[])[0]).toEqual(item('p-0', 'original'))
    // A whole-array rollback would have reverted p-1 to BIG; the scoped rollback does not.
    expect(textOf((getResourceDatabase().promptTemplate as PromptItem[])[1])).toBe('concurrent')
  })
})

describe('prompt template collection rollback guards', () => {
  it.each([
    [
      'create',
      async (ownerId: string | null) =>
        createPromptItemCommand({
          baseRevision: 7,
          promptPresetId: promptTemplateOwnerCommandId(ownerId),
          promptItem: promptItemSnapshot('created', 'new'),
        }),
      commandMocks.createPromptItemCommand,
    ],
    [
      'delete',
      async (ownerId: string | null) =>
        deletePromptItemCommand({
          baseRevision: 7,
          promptPresetId: promptTemplateOwnerCommandId(ownerId),
          itemId: 'deleted',
        }),
      commandMocks.deletePromptItemCommand,
    ],
    [
      'reorder',
      async (ownerId: string | null) =>
        reorderPromptItemsCommand({
          baseRevision: 7,
          promptPresetId: promptTemplateOwnerCommandId(ownerId),
          itemIds: ['p-1', 'p-0'],
        }),
      commandMocks.reorderPromptItemsCommand,
    ],
    [
      'enable',
      async (ownerId: string | null) =>
        enablePromptItemsCommand({
          baseRevision: 7,
          promptPresetId: promptTemplateOwnerCommandId(ownerId),
          enabled: true,
        }),
      commandMocks.enablePromptItemsCommand,
    ],
  ])(
    'drops stale %s command construction after the selected owner changes',
    async (_name, buildCommand, commandMock) => {
      hydrationState.setOwner('preset-a')
      const ownerId = hydrationState.currentOwner()
      hydrationState.setOwner('preset-b')

      const result = await runPromptTemplateOwnerCommand(ownerId, () => buildCommand(ownerId))

      expect(result).toEqual({ status: 'unavailable' })
      expect(commandMock).not.toHaveBeenCalled()
    },
  )

  it.each([
    [
      'create',
      async (ownerId: string | null) =>
        createPromptItemCommand({
          baseRevision: 7,
          promptPresetId: promptTemplateOwnerCommandId(ownerId),
          promptItem: promptItemSnapshot('created', 'new'),
        }),
      commandMocks.createPromptItemCommand,
      {
        kind: 'createPromptItem',
        baseRevision: 7,
        promptPresetId: 'preset-a',
        promptItem: promptItemSnapshot('created', 'new'),
      },
    ],
    [
      'delete',
      async (ownerId: string | null) =>
        deletePromptItemCommand({
          baseRevision: 7,
          promptPresetId: promptTemplateOwnerCommandId(ownerId),
          itemId: 'deleted',
        }),
      commandMocks.deletePromptItemCommand,
      {
        kind: 'deletePromptItem',
        baseRevision: 7,
        promptPresetId: 'preset-a',
        itemId: 'deleted',
      },
    ],
    [
      'reorder',
      async (ownerId: string | null) =>
        reorderPromptItemsCommand({
          baseRevision: 7,
          promptPresetId: promptTemplateOwnerCommandId(ownerId),
          itemIds: ['p-1', 'p-0'],
        }),
      commandMocks.reorderPromptItemsCommand,
      {
        kind: 'reorderPromptItems',
        baseRevision: 7,
        promptPresetId: 'preset-a',
        itemIds: ['p-1', 'p-0'],
      },
    ],
    [
      'enable',
      async (ownerId: string | null) =>
        enablePromptItemsCommand({
          baseRevision: 7,
          promptPresetId: promptTemplateOwnerCommandId(ownerId),
          enabled: true,
        }),
      commandMocks.enablePromptItemsCommand,
      {
        kind: 'enablePromptItems',
        baseRevision: 7,
        promptPresetId: 'preset-a',
        enabled: true,
      },
    ],
  ])('uses the captured owner when constructing %s commands', async (_name, buildCommand, commandMock, expected) => {
    hydrationState.setOwner('preset-a')
    const ownerId = hydrationState.currentOwner()

    const result = await runPromptTemplateOwnerCommand(ownerId, () => buildCommand(ownerId))

    expect(result).toEqual(expected)
    expect(commandMock).toHaveBeenCalledWith(expect.objectContaining({ promptPresetId: 'preset-a' }))
  })

  it('skips collection rollback after the selected owner changes', () => {
    hydrationState.setOwner('preset-a')
    const ownerId = hydrationState.currentOwner()
    let draftItems = [item('p-0', 'first'), item('created', 'new')]
    resourceDatabase.current = { promptTemplate: cloneJsonValue(draftItems) }
    const binding = draftBindingFor(
      () => draftItems,
      (items) => {
        draftItems = items
      },
    )

    hydrationState.setOwner('preset-b')
    rollbackFailedPromptTemplateItemCreate({
      ownerId,
      binding,
      itemId: 'created',
      attemptedItem: item('created', 'new'),
    })

    expect(draftItems.map((promptItem) => promptItem.id)).toEqual(['p-0', 'created'])
    expect((getResourceDatabase().promptTemplate as PromptItem[]).map((promptItem) => promptItem.id)).toEqual([
      'p-0',
      'created',
    ])
  })

  it('skips delete rollback after the selected owner changes', () => {
    hydrationState.setOwner('preset-a')
    const ownerId = hydrationState.currentOwner()
    let draftItems = [item('p-0', 'first'), item('p-1', 'second')]
    resourceDatabase.current = { promptTemplate: cloneJsonValue(draftItems) }
    const binding = draftBindingFor(
      () => draftItems,
      (items) => {
        draftItems = items
      },
    )

    hydrationState.setOwner('preset-b')
    rollbackFailedPromptTemplateItemDelete({
      ownerId,
      binding,
      itemId: 'deleted',
      previousIndex: 1,
      previousItem: item('deleted', 'deleted original'),
    })

    expect(draftItems.map((promptItem) => promptItem.id)).toEqual(['p-0', 'p-1'])
    expect((getResourceDatabase().promptTemplate as PromptItem[]).map((promptItem) => promptItem.id)).toEqual([
      'p-0',
      'p-1',
    ])
  })

  it('skips reorder rollback after the selected owner changes', () => {
    hydrationState.setOwner('preset-a')
    const ownerId = hydrationState.currentOwner()
    let draftItems = [item('p-1', 'second'), item('p-0', 'first')]
    resourceDatabase.current = { promptTemplate: cloneJsonValue(draftItems) }
    const binding = draftBindingFor(
      () => draftItems,
      (items) => {
        draftItems = items
      },
    )

    hydrationState.setOwner('preset-b')
    rollbackFailedPromptTemplateItemReorder({
      ownerId,
      binding,
      previousItemIds: ['p-0', 'p-1'],
      attemptedItemIds: ['p-1', 'p-0'],
    })

    expect(draftItems.map((promptItem) => promptItem.id)).toEqual(['p-1', 'p-0'])
    expect((getResourceDatabase().promptTemplate as PromptItem[]).map((promptItem) => promptItem.id)).toEqual([
      'p-1',
      'p-0',
    ])
  })

  it('skips enable rollback after the selected owner changes', () => {
    hydrationState.setOwner('preset-a')
    const ownerId = hydrationState.currentOwner()
    resourceDatabase.current = { promptTemplate: [] }

    hydrationState.setOwner('preset-b')
    runPromptTemplateOwnerRollback(ownerId, () => {
      getResourceDatabase().promptTemplate = undefined
    })

    expect(getResourceDatabase().promptTemplate).toEqual([])
  })

  it('failed create removes unchanged attempted item and preserves newer sibling and appended rows', () => {
    let draftItems = [item('p-0', 'first'), item('p-1', 'second'), item('created', 'new')]
    resourceDatabase.current = { promptTemplate: cloneJsonValue(draftItems) }
    const binding = draftBindingFor(
      () => draftItems,
      (items) => {
        draftItems = items
      },
    )

    draftItems = [item('p-0', 'first edited'), item('p-1', 'second'), item('created', 'new'), item('later', 'later')]
    getResourceDatabase().promptTemplate = cloneJsonValue(draftItems)

    rollbackFailedPromptTemplateItemCreate({
      ownerId: null,
      binding,
      itemId: 'created',
      attemptedItem: item('created', 'new'),
    })

    expect(draftItems.map((promptItem) => promptItem.id)).toEqual(['p-0', 'p-1', 'later'])
    expect(textOf(draftItems[0])).toBe('first edited')
    expect(textOf(draftItems[2])).toBe('later')
    expect((getResourceDatabase().promptTemplate as PromptItem[]).map((promptItem) => promptItem.id)).toEqual([
      'p-0',
      'p-1',
      'later',
    ])
  })

  it('failed preset create also restores the canonical preset projection', () => {
    hydrationState.setOwner('preset-a')
    let draftItems = [item('p-0', 'first'), item('created', 'new')]
    resourceDatabase.current = {
      promptPresetsId: 0,
      promptPresets: [{ id: 'preset-a', promptTemplate: cloneJsonValue(draftItems) }],
      promptTemplate: cloneJsonValue(draftItems),
    }
    const binding = draftBindingFor(
      () => draftItems,
      (items) => {
        draftItems = items
      },
    )

    rollbackFailedPromptTemplateItemCreate({
      ownerId: 'preset-a',
      binding,
      itemId: 'created',
      attemptedItem: item('created', 'new'),
    })

    expect(draftItems.map((promptItem) => promptItem.id)).toEqual(['p-0'])
    expect((getResourceDatabase().promptTemplate as PromptItem[]).map((promptItem) => promptItem.id)).toEqual(['p-0'])
    expect(
      (getResourceDatabase().promptPresets[0].promptTemplate as PromptItem[]).map((promptItem) => promptItem.id),
    ).toEqual(['p-0'])
  })

  it('failed create skips rollback when the created row was edited after dispatch', () => {
    let draftItems = [item('p-0', 'first'), item('created', 'edited after dispatch')]
    resourceDatabase.current = { promptTemplate: cloneJsonValue(draftItems) }
    const binding = draftBindingFor(
      () => draftItems,
      (items) => {
        draftItems = items
      },
    )

    rollbackFailedPromptTemplateItemCreate({
      ownerId: null,
      binding,
      itemId: 'created',
      attemptedItem: item('created', 'new'),
    })

    expect(draftItems.map((promptItem) => promptItem.id)).toEqual(['p-0', 'created'])
    expect(textOf(draftItems[1])).toBe('edited after dispatch')
    expect((getResourceDatabase().promptTemplate as PromptItem[]).map((promptItem) => promptItem.id)).toEqual([
      'p-0',
      'created',
    ])
  })

  it('failed delete reinserts only the missing deleted item and preserves sibling edits', () => {
    const deleted = item('deleted', 'deleted original')
    let draftItems = [item('p-0', 'first edited'), item('p-1', 'second'), item('later', 'later')]
    resourceDatabase.current = { promptTemplate: cloneJsonValue(draftItems) }
    const binding = draftBindingFor(
      () => draftItems,
      (items) => {
        draftItems = items
      },
    )

    rollbackFailedPromptTemplateItemDelete({
      ownerId: null,
      binding,
      itemId: 'deleted',
      previousIndex: 1,
      previousItem: deleted,
    })

    expect(draftItems.map((promptItem) => promptItem.id)).toEqual(['p-0', 'deleted', 'p-1', 'later'])
    expect(textOf(draftItems[0])).toBe('first edited')
    expect(textOf(draftItems[1])).toBe('deleted original')
    expect(textOf(draftItems[3])).toBe('later')
    expect((getResourceDatabase().promptTemplate as PromptItem[]).map((promptItem) => promptItem.id)).toEqual([
      'p-0',
      'deleted',
      'p-1',
      'later',
    ])
  })

  it('failed reorder restores previous id order while preserving item content edits', () => {
    let draftItems = [item('p-1', 'second edited'), item('p-0', 'first edited'), item('p-2', 'third')]
    resourceDatabase.current = { promptTemplate: cloneJsonValue(draftItems) }
    const binding = draftBindingFor(
      () => draftItems,
      (items) => {
        draftItems = items
      },
    )

    rollbackFailedPromptTemplateItemReorder({
      ownerId: null,
      binding,
      previousItemIds: ['p-0', 'p-1', 'p-2'],
      attemptedItemIds: ['p-1', 'p-0', 'p-2'],
    })

    expect(draftItems.map((promptItem) => promptItem.id)).toEqual(['p-0', 'p-1', 'p-2'])
    expect(textOf(draftItems[0])).toBe('first edited')
    expect(textOf(draftItems[1])).toBe('second edited')
    expect((getResourceDatabase().promptTemplate as PromptItem[]).map((promptItem) => promptItem.id)).toEqual([
      'p-0',
      'p-1',
      'p-2',
    ])
  })

  it('failed reorder skips when a newer reorder changed the live id sequence', () => {
    let draftItems = [item('p-1', 'second'), item('p-2', 'third'), item('p-0', 'first')]
    resourceDatabase.current = { promptTemplate: cloneJsonValue(draftItems) }
    const binding = draftBindingFor(
      () => draftItems,
      (items) => {
        draftItems = items
      },
    )

    rollbackFailedPromptTemplateItemReorder({
      ownerId: null,
      binding,
      previousItemIds: ['p-0', 'p-1', 'p-2'],
      attemptedItemIds: ['p-1', 'p-0', 'p-2'],
    })

    expect(draftItems.map((promptItem) => promptItem.id)).toEqual(['p-1', 'p-2', 'p-0'])
    expect((getResourceDatabase().promptTemplate as PromptItem[]).map((promptItem) => promptItem.id)).toEqual([
      'p-1',
      'p-2',
      'p-0',
    ])
  })
})

describe('flushPendingPromptTemplatePatches', () => {
  it('does not dispatch prompt item updates while the template is unloaded', async () => {
    hydrationState.setHydrated(false)
    resourceDatabase.current = {}
    let draftItems = [item('p-0', 'unloaded draft')]
    const binding: PromptTemplateDraftBinding = {
      getItems: () => draftItems,
      setItems: (items) => {
        draftItems = items
      },
    }

    queuePromptItemProjectionUpdate(binding, 'p-0', item('p-0', 'previous'), 500)
    await vi.advanceTimersByTimeAsync(500)

    expect(commandState.commands).toHaveLength(0)
    expect(getResourceDatabase()).not.toHaveProperty('promptTemplate')
  })

  it('M8: flushes pending prompt item updates with keepalive and clears debounce', async () => {
    seedTemplate()
    hydrationState.setOwner('prompt-a')
    let draftItems = draftCopy()
    draftItems[0] = item('p-0', 'unload item')
    const binding: PromptTemplateDraftBinding = {
      getItems: () => draftItems,
      setItems: (items) => {
        draftItems = items
      },
    }

    queuePromptItemProjectionUpdate(binding, 'p-0', item('p-0', 'small'), 500)
    flushPendingPromptTemplatePatches({ keepalive: true })
    await Promise.resolve()

    expect(commandState.commands).toHaveLength(1)
    expect(commandState.commands[0].keepalive).toBe(true)
    expect(commandState.commands[0].built).toEqual({
      kind: 'updatePromptItem',
      baseRevision: 1,
      promptPresetId: 'prompt-a',
      itemId: 'p-0',
      patch: { text: 'unload item' },
    })

    await vi.advanceTimersByTimeAsync(500)
    expect(commandState.commands).toHaveLength(1)
  })

  it('keeps whole-owner acknowledgement cloning off the per-keystroke queue path', () => {
    seedTemplate()
    let draftItems = draftCopy()
    draftItems[0] = item('p-0', 'edited')
    const binding = draftBindingFor(
      () => draftItems,
      (items) => {
        draftItems = items
      },
    )

    const instrumented = withCloneInstrumentation(() =>
      queuePromptItemProjectionUpdate(binding, 'p-0', item('p-0', 'small'), 500),
    )

    expect(instrumented.maxClonedSize).toBeLessThan(BIG.length)
    resetPromptTemplateSelectionDirtyState()
  })

  it('drops a debounced prompt item update when the selected prompt preset owner changes', async () => {
    seedTemplate()
    hydrationState.setOwner('prompt-a')
    let draftItems = draftCopy()
    draftItems[0] = item('p-0', 'stale owner edit')
    const binding: PromptTemplateDraftBinding = {
      getItems: () => draftItems,
      setItems: (items) => {
        draftItems = items
      },
    }

    queuePromptItemProjectionUpdate(binding, 'p-0', item('p-0', 'small'), 500, 'prompt-a')
    hydrationState.setOwner('prompt-b')
    await vi.advanceTimersByTimeAsync(500)

    expect(commandState.commands).toHaveLength(0)
    expect(textOf(draftItems[0])).toBe('stale owner edit')
  })

  it('L25: coalesced prompt item rollback restores the first pre-edit item', async () => {
    seedTemplate()
    let draftItems = draftCopy()
    const binding: PromptTemplateDraftBinding = {
      getItems: () => draftItems,
      setItems: (items) => {
        draftItems = items
      },
    }

    draftItems[0] = item('p-0', 'draft one')
    queuePromptItemProjectionUpdate(binding, 'p-0', item('p-0', 'small'), 500)
    draftItems[0] = item('p-0', 'draft two')
    queuePromptItemProjectionUpdate(binding, 'p-0', item('p-0', 'draft one'), 500)

    await vi.advanceTimersByTimeAsync(500)
    expect(commandState.commands).toHaveLength(1)
    expect(commandState.commands[0].built).toEqual({
      kind: 'updatePromptItem',
      baseRevision: 1,
      itemId: 'p-0',
      patch: { text: 'draft two' },
    })

    commandState.commands[0].rollback?.()

    expect(textOf(draftItems[0])).toBe('small')
    expect(textOf((getResourceDatabase().promptTemplate as PromptItem[])[0])).toBe('small')
  })

  it('rolls back only failed update fields while preserving a newer different-field preset edit', async () => {
    hydrationState.setOwner('preset-a')
    const original = item('p-0', 'server text')
    resourceDatabase.current = {
      promptPresetsId: 0,
      promptPresets: [{ id: 'preset-a', promptTemplate: [cloneJsonValue(original)] }],
      promptTemplate: [cloneJsonValue(original)],
    }
    let draftItems = [cloneJsonValue(original)]
    const binding = draftBindingFor(
      () => draftItems,
      (items) => {
        draftItems = items
      },
    )

    draftItems[0] = promptItemFixture({ ...draftItems[0], text: 'failed text' })
    queuePromptItemProjectionUpdate(binding, 'p-0', original, 500, 'preset-a')
    await vi.advanceTimersByTimeAsync(500)

    const firstAttempt = cloneJsonValue(draftItems[0])
    draftItems[0] = promptItemFixture({ ...draftItems[0], role: 'user' })
    getResourceDatabase().promptPresets[0].promptTemplate = cloneJsonValue(draftItems) as never
    queuePromptItemProjectionUpdate(binding, 'p-0', firstAttempt, 500, 'preset-a')
    commandState.commands[0].rollback?.()

    expect(draftItems[0]).toMatchObject({ text: 'server text', role: 'user' })
    expect((getResourceDatabase().promptTemplate as PromptItem[])[0]).toMatchObject({
      text: 'server text',
      role: 'user',
    })
    expect((getResourceDatabase().promptPresets[0].promptTemplate as PromptItem[])[0]).toMatchObject({
      text: 'server text',
      role: 'user',
    })
    expect(hydrationState.isTainted('preset-a')).toBe(true)

    await vi.advanceTimersByTimeAsync(500)
    expect(commandState.commands[1].built).toMatchObject({ patch: { role: 'user' } })
    const secondInput = commandMocks.updatePromptItemCommand.mock.calls[1][0] as {
      optimisticAcknowledgement: PromptItemOptimisticAcknowledgement
    }
    expect(secondInput.optimisticAcknowledgement.ownerState).toEqual({
      enabled: true,
      items: [expect.objectContaining({ text: 'server text', role: 'user' })],
    })
  })

  it('omits very large unchanged fields from a debounced prompt item update', async () => {
    const previous = promptItemFixture({
      ...item('p-0', 'small'),
      largeMetadata: BIG,
      nestedMetadata: { body: BIG },
    })
    resourceDatabase.current = { promptTemplate: [cloneJsonValue(previous)] }
    let draftItems = [promptItemFixture({ ...previous, text: 'edited' })]
    const binding = draftBindingFor(
      () => draftItems,
      (items) => {
        draftItems = items
      },
    )

    queuePromptItemProjectionUpdate(binding, 'p-0', previous, 500)
    await vi.advanceTimersByTimeAsync(500)

    expect(commandState.commands).toHaveLength(1)
    expect(commandState.commands[0].built).toEqual({
      kind: 'updatePromptItem',
      baseRevision: 1,
      itemId: 'p-0',
      patch: { text: 'edited' },
    })
    expect(snapshotJson(commandState.commands[0].built).length).toBeLessThan(BIG.length)
  })

  it('captures the exact post-write prompt owner state as client-only acknowledgement metadata', async () => {
    seedTemplate()
    let draftItems = draftCopy()
    draftItems[0] = item('p-0', 'accepted optimistic edit')
    const binding = draftBindingFor(
      () => draftItems,
      (items) => {
        draftItems = items
      },
    )
    const projectionFence = capturePromptTemplateOwnerMutationFence(null)

    queuePromptItemProjectionUpdate(binding, 'p-0', item('p-0', 'small'), 500, null, projectionFence)
    await vi.advanceTimersByTimeAsync(500)

    const commandInput = commandMocks.updatePromptItemCommand.mock.calls[0][0]
    expect(commandInput).toMatchObject({
      optimisticAcknowledgement: {
        collectionProjectionEpoch: projectionFence.collectionProjectionEpoch,
        ownerProjectionEpoch: projectionFence.ownerProjectionEpoch,
        ownerState: { enabled: true },
      },
    })
    const optimisticAcknowledgement = commandInput.optimisticAcknowledgement as PromptItemOptimisticAcknowledgement
    expect(optimisticAcknowledgement.ownerState.enabled).toBe(true)
    if (!optimisticAcknowledgement.ownerState.enabled) throw new Error('expected an enabled owner')
    expect(optimisticAcknowledgement.ownerState.items[0]).toEqual(item('p-0', 'accepted optimistic edit'))
    expect(commandState.commands[0].built).not.toHaveProperty('optimisticAcknowledgement')
  })

  it('skips a failed item-update rollback after an authoritative owner collection projection', async () => {
    seedTemplate()
    let draftItems = draftCopy()
    draftItems[0] = item('p-0', 'optimistic edit')
    const binding = draftBindingFor(
      () => draftItems,
      (items) => {
        draftItems = items
      },
    )
    const projectionFence = capturePromptTemplateOwnerMutationFence(null)
    queuePromptItemProjectionUpdate(binding, 'p-0', item('p-0', 'small'), 500, null, projectionFence)
    await vi.advanceTimersByTimeAsync(500)
    applyCollectionsResource(
      { revision: 2, collections: { promptTemplate: [item('p-0', 'authoritative')] } },
      'promptTemplate',
    )

    commandState.commands[0].rollback?.()

    expect(textOf(draftItems[0])).toBe('optimistic edit')
    expect(textOf((getResourceDatabase().promptTemplate as PromptItem[])[0])).toBe('authoritative')
    expect(hydrationState.isTainted(null)).toBe(true)
  })

  it('skips a failed collection rollback after the owner hydration epoch changes', () => {
    let draftItems = [item('p-0', 'first'), item('created', 'optimistic')]
    resourceDatabase.current = { promptTemplate: cloneJsonValue(draftItems) }
    const binding = draftBindingFor(
      () => draftItems,
      (items) => {
        draftItems = items
      },
    )
    const projectionFence = capturePromptTemplateOwnerMutationFence(null)
    hydrationState.advanceOwnerEpoch(null)

    rollbackFailedPromptTemplateItemCreate({
      ownerId: null,
      binding,
      itemId: 'created',
      attemptedItem: item('created', 'optimistic'),
      projectionFence,
    })

    expect(draftItems.map((promptItem) => promptItem.id)).toEqual(['p-0', 'created'])
  })

  it('sends removals through deleteKeys while retaining explicit null values', async () => {
    const previous = promptItemFixture({
      ...item('p-0', 'small'),
      removable: 'drop me',
      innerFormat: 'legacy format',
      unchanged: BIG,
    })
    const attempted = promptItemFixture({ ...previous, innerFormat: null })
    delete (attempted as unknown as Record<string, unknown>).removable
    resourceDatabase.current = { promptTemplate: [cloneJsonValue(previous)] }
    let draftItems = [attempted]
    const binding = draftBindingFor(
      () => draftItems,
      (items) => {
        draftItems = items
      },
    )

    queuePromptItemProjectionUpdate(binding, 'p-0', previous, 500)
    await vi.advanceTimersByTimeAsync(500)

    expect(commandState.commands).toHaveLength(1)
    expect(commandState.commands[0].built).toEqual({
      kind: 'updatePromptItem',
      baseRevision: 1,
      itemId: 'p-0',
      patch: { innerFormat: null },
      deleteKeys: ['removable'],
    })
  })

  it('suppresses a debounced update that reverts to the first retained previous row', async () => {
    seedTemplate()
    let draftItems = draftCopy()
    const binding = draftBindingFor(
      () => draftItems,
      (items) => {
        draftItems = items
      },
    )

    draftItems[0] = item('p-0', 'draft edit')
    queuePromptItemProjectionUpdate(binding, 'p-0', item('p-0', 'small'), 500)
    draftItems[0] = item('p-0', 'small')
    queuePromptItemProjectionUpdate(binding, 'p-0', item('p-0', 'draft edit'), 500)
    await vi.advanceTimersByTimeAsync(500)

    expect(commandState.commands).toHaveLength(0)
    expect(commandMocks.updatePromptItemCommand).not.toHaveBeenCalled()
  })

  it('M8: PromptSettings component teardown flushes pending prompt-template patches', async () => {
    seedTemplate()
    let draftItems = draftCopy()
    draftItems[0] = item('p-0', 'component teardown item')
    const binding: PromptTemplateDraftBinding = {
      getItems: () => draftItems,
      setItems: (items) => {
        draftItems = items
      },
    }
    queuePromptItemProjectionUpdateForPromptSettings(binding, 'p-0', item('p-0', 'small'), 500)
    getResourceDatabase().promptTemplate = []
    getResourceDatabase().promptSettings = { ...minimalPromptSettings }

    const target = document.createElement('div')
    document.body.appendChild(target)
    let component: MountedComponent | null = null
    try {
      component = mount(PromptSettings, {
        target,
        props: { mode: 'inline', subMenu: 0 },
      })
      await tick()
      await unmount(component)
      component = null
    } finally {
      if (component) await unmount(component)
      target.remove()
    }
    await Promise.resolve()

    expect(commandState.commands).toHaveLength(1)
    expect(commandState.commands[0].keepalive).toBeUndefined()
    expect(commandState.commands[0].built).toEqual({
      kind: 'updatePromptItem',
      baseRevision: 1,
      itemId: 'p-0',
      patch: { text: 'component teardown item' },
    })

    await vi.advanceTimersByTimeAsync(500)
    expect(commandState.commands).toHaveLength(1)
  })

  it('PromptSettings does not dispatch or write an empty template while unloaded', async () => {
    hydrationState.setHydrated(false)
    hydrationState.ensure.mockResolvedValueOnce(false)
    resourceDatabase.current = { promptSettings: { ...minimalPromptSettings } }

    const target = document.createElement('div')
    document.body.appendChild(target)
    let component: MountedComponent | null = null
    try {
      component = mount(PromptSettings, {
        target,
        props: { mode: 'inline', subMenu: 0 },
      })
      await tick()
      await unmount(component)
      component = null
    } finally {
      if (component) await unmount(component)
      target.remove()
    }

    expect(commandState.commands).toHaveLength(0)
    expect(getResourceDatabase()).not.toHaveProperty('promptTemplate')
  })

  it('PromptSettings does not repeat an item edit already included in an id sync', async () => {
    hydrationState.setOwner('preset-a')
    resourceDatabase.current = {
      promptSettings: { ...minimalPromptSettings },
      promptPresetsId: 0,
      promptPresets: [
        {
          id: 'preset-a',
          name: 'Preset A',
          promptTemplate: [
            promptItemFixture({
              type: 'plain',
              type2: 'normal',
              role: 'system',
              text: 'server old',
              name: 'Preset row',
            }),
          ],
        },
      ],
      promptTemplate: [
        promptItemFixture({ type: 'plain', type2: 'normal', role: 'system', text: 'server old', name: 'Preset row' }),
      ],
    }

    const target = document.createElement('div')
    document.body.appendChild(target)
    let component: MountedComponent | null = null
    try {
      component = mount(PromptSettings, {
        target,
        props: { mode: 'inline', subMenu: 0 },
      })
      await tick()
      await flushMicrotasks()
      await tick()
      expect(hydrationState.isTainted('preset-a')).toBe(true)

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'o', ctrlKey: true, altKey: true }))
      await tick()
      await flushMicrotasks()
      await tick()

      await editPromptSettingsTextarea(target, 'local dirty')
      await flushMicrotasks()

      expect(commandState.commands[0].built).toMatchObject({
        kind: 'updatePromptPreset',
        baseRevision: 1,
        promptPresetId: 'preset-a',
      })
      const presetPatch = commandState.commands[0].built.patch as {
        promptTemplate: Array<{ id?: string; text?: string }>
      }
      expect(presetPatch.promptTemplate[0]).toMatchObject({ id: expect.any(String), text: 'local dirty' })

      await vi.advanceTimersByTimeAsync(250)
      await flushMicrotasks()

      expect(commandState.commands).toHaveLength(1)
      expect(commandMocks.updatePromptItemCommand).not.toHaveBeenCalled()
    } finally {
      if (component) await unmount(component)
      target.remove()
    }
  })

  it('PromptSettings includes sibling id-less rows in an in-flight selected preset id sync', async () => {
    hydrationState.setOwner('preset-a')
    let resolvePresetSync: ((value: { kind: string } & Record<string, unknown>) => void) | null = null
    commandMocks.updatePromptPresetCommand.mockImplementationOnce(
      (args: Record<string, unknown>) =>
        new Promise<{ kind: string } & Record<string, unknown>>((resolve) => {
          resolvePresetSync = () => resolve({ kind: 'updatePromptPreset', ...args })
        }),
    )
    resourceDatabase.current = {
      promptSettings: { ...minimalPromptSettings },
      promptPresetsId: 0,
      promptPresets: [
        {
          id: 'preset-a',
          name: 'Preset A',
          promptTemplate: [
            promptItemFixture({
              type: 'plain',
              type2: 'normal',
              role: 'system',
              text: 'row A old',
              name: 'Preset row A',
            }),
            promptItemFixture({
              type: 'plain',
              type2: 'normal',
              role: 'system',
              text: 'row B old',
              name: 'Preset row B',
            }),
          ],
        },
      ],
      promptTemplate: [
        promptItemFixture({
          type: 'plain',
          type2: 'normal',
          role: 'system',
          text: 'row A old',
          name: 'Preset row A',
        }),
        promptItemFixture({
          type: 'plain',
          type2: 'normal',
          role: 'system',
          text: 'row B old',
          name: 'Preset row B',
        }),
      ],
    }

    const target = document.createElement('div')
    document.body.appendChild(target)
    let component: MountedComponent | null = null
    try {
      component = mount(PromptSettings, {
        target,
        props: { mode: 'inline', subMenu: 0 },
      })
      await tick()
      await flushMicrotasks()
      await tick()

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'o', ctrlKey: true, altKey: true }))
      await tick()
      await flushMicrotasks()
      await tick()

      await editPromptSettingsTextarea(target, 'row A dirty', 0)
      await flushMicrotasks()

      expect(commandMocks.updatePromptPresetCommand).toHaveBeenCalledTimes(1)
      const presetSyncArgs = commandMocks.updatePromptPresetCommand.mock.calls[0][0] as {
        patch: { promptTemplate: Array<{ id?: string; text?: string }> }
      }
      expect(presetSyncArgs.patch.promptTemplate).toEqual([
        expect.objectContaining({ id: expect.any(String), text: 'row A dirty' }),
        expect.objectContaining({ id: expect.any(String), text: 'row B old' }),
      ])
      expect(commandState.commands).toHaveLength(0)

      await editPromptSettingsTextarea(target, 'row B dirty', 1)
      await flushMicrotasks()

      expect(commandMocks.updatePromptPresetCommand).toHaveBeenCalledTimes(1)
      expect(commandMocks.updatePromptItemCommand).not.toHaveBeenCalled()

      const syncedProjection = cloneJsonValue(presetSyncArgs.patch.promptTemplate)
      getResourceDatabase().promptPresets[0].promptTemplate = cloneJsonValue(syncedProjection) as never
      getResourceDatabase().promptTemplate = cloneJsonValue(syncedProjection) as never
      resolvePresetSync?.({ kind: 'updatePromptPreset', ...presetSyncArgs })
      await flushMicrotasks()
      await vi.advanceTimersByTimeAsync(250)
      await flushMicrotasks()

      const syncedIds = presetSyncArgs.patch.promptTemplate.map((item) => item.id)
      expect(
        commandMocks.updatePromptItemCommand.mock.calls.map(([args]) => (args as { itemId: string }).itemId),
      ).toEqual([syncedIds[1]])
      expect(
        commandMocks.updatePromptItemCommand.mock.calls.map(
          ([args]) => (args as { patch: { text?: string } }).patch.text,
        ),
      ).toEqual(['row B dirty'])
      const updateInput = commandMocks.updatePromptItemCommand.mock.calls[0][0] as {
        optimisticAcknowledgement: PromptItemOptimisticAcknowledgement
      }
      expect(updateInput.optimisticAcknowledgement.ownerState).toEqual({
        enabled: true,
        items: [expect.objectContaining({ text: 'row A dirty' }), expect.objectContaining({ text: 'row B dirty' })],
      })
      expect((getResourceDatabase().promptPresets[0].promptTemplate as PromptItem[])[1]).toMatchObject({
        text: 'row B dirty',
      })
    } finally {
      if (component) await unmount(component)
      target.remove()
    }
  })

  it('PromptSettings immediately adopts a newly selected preset template even when the top-level projection is stale', async () => {
    commandState.revision = 5
    resourceDatabase.current = {
      promptSettings: { ...minimalPromptSettings },
      promptTemplate: [promptItemFixture({ ...item('old-row', 'old text'), name: 'Old preset row' })],
      promptPresetsId: 0,
      promptPresets: [
        {
          id: 'preset-a',
          name: 'Preset A',
          promptTemplate: [promptItemFixture({ ...item('old-row', 'old text'), name: 'Old preset row' })],
        },
        {
          id: 'preset-b',
          name: 'Preset B',
          promptTemplate: [promptItemFixture({ ...item('new-row', 'new text'), name: 'New preset row' })],
        },
      ],
    }

    const target = document.createElement('div')
    document.body.appendChild(target)
    let component: MountedComponent | null = null
    try {
      component = mount(PromptSettings, {
        target,
        props: { mode: 'inline', subMenu: 0 },
      })
      await tick()
      await Promise.resolve()
      await tick()

      expect(target.textContent).toContain('Old preset row')

      getResourceDatabase().promptPresetsId = 1
      getResourceDatabase().promptTemplate = [
        promptItemFixture({ ...item('stale-row', 'stale text'), name: 'Stale top-level row' }),
      ]
      await tick()
      await Promise.resolve()
      await tick()

      expect(commandState.revision).toBe(5)
      expect(target.textContent).toContain('New preset row')
      expect(target.textContent).not.toContain('Old preset row')
      expect(target.textContent).not.toContain('Stale top-level row')
      expect(getResourceDatabase().promptTemplate).toEqual([
        promptItemFixture({ ...item('new-row', 'new text'), name: 'New preset row' }),
      ])

      await vi.advanceTimersByTimeAsync(300)
      expect(commandState.commands).toHaveLength(0)
    } finally {
      if (component) await unmount(component)
      target.remove()
    }
  })

  it('PromptSettings hydrates the newly selected owner before adopting its preset template', async () => {
    commandState.revision = 5
    hydrationState.setOwner('preset-a')
    hydrationState.setHydrated(true, 'preset-a')
    resourceDatabase.current = {
      promptSettings: { ...minimalPromptSettings },
      promptTemplate: [promptItemFixture({ ...item('old-row', 'old text'), name: 'Old preset row' })],
      promptPresetsId: 0,
      promptPresets: [
        {
          id: 'preset-a',
          name: 'Preset A',
          promptTemplate: [promptItemFixture({ ...item('old-row', 'old text'), name: 'Old preset row' })],
        },
        {
          id: 'preset-b',
          name: 'Preset B',
        },
      ],
    }
    hydrationState.ensure.mockImplementation(async (options?: { promptPresetId?: string | null }) => {
      const requestedOwnerId =
        options?.promptPresetId === undefined ? hydrationState.currentOwner() : options.promptPresetId
      if (requestedOwnerId !== 'preset-b') return hydrationState.isHydrated(requestedOwnerId)
      const preset = getResourceDatabase().promptPresets?.[1] as Record<string, unknown> | undefined
      const hydratedTemplate = [promptItemFixture({ ...item('new-row', 'new text'), name: 'Hydrated preset row' })]
      if (preset) preset.promptTemplate = cloneJsonValue(hydratedTemplate)
      getResourceDatabase().promptTemplate = cloneJsonValue(hydratedTemplate)
      hydrationState.setHydrated(true, 'preset-b')
      return true
    })

    const target = document.createElement('div')
    document.body.appendChild(target)
    let component: MountedComponent | null = null
    try {
      component = mount(PromptSettings, {
        target,
        props: { mode: 'inline', subMenu: 0 },
      })
      await tick()
      await Promise.resolve()
      await tick()

      expect(target.textContent).toContain('Old preset row')

      hydrationState.setOwner('preset-b')
      hydrationState.setHydrated(false, 'preset-b')
      getResourceDatabase().promptPresetsId = 1
      getResourceDatabase().promptTemplate = [
        promptItemFixture({ ...item('stale-row', 'stale text'), name: 'Stale top-level row' }),
      ]
      await tick()
      await Promise.resolve()
      await tick()

      expect(hydrationState.ensure).toHaveBeenCalledWith({ promptPresetId: 'preset-b' })
      expect(target.textContent).toContain('Hydrated preset row')
      expect(target.textContent).not.toContain('Old preset row')
      expect(target.textContent).not.toContain('Stale top-level row')
      expect(getResourceDatabase().promptTemplate).toEqual([
        promptItemFixture({ ...item('new-row', 'new text'), name: 'Hydrated preset row' }),
      ])

      await vi.advanceTimersByTimeAsync(300)
      expect(commandState.commands).toHaveLength(0)
    } finally {
      if (component) await unmount(component)
      target.remove()
    }
  })

  it('PromptSettings keeps a dirty prompt setting through a stale projection before debounce flush', async () => {
    seedPromptSettings({ customPromptTemplateToggle: 'server old' })
    const projectionEpoch = captureSettingsGroupProjectionEpoch('prompt')

    const target = document.createElement('div')
    document.body.appendChild(target)
    let component: MountedComponent | null = null
    try {
      component = await mountPromptSettingsComponent(target)

      await editPromptSettingsTextarea(target, 'local dirty')
      expect(getResourceDatabase().customPromptTemplateToggle).toBe('local dirty')

      await applyPromptSettingsProjection(() => {
        ;(getResourceDatabase() as unknown as Record<string, unknown>).customPromptTemplateToggle = 'stale server'
      })

      expect(promptSettingsTextarea(target).value).toBe('local dirty')
      expect(getResourceDatabase().customPromptTemplateToggle).toBe('local dirty')

      await vi.advanceTimersByTimeAsync(250)
      await flushMicrotasks()

      expect(commandState.commands).toHaveLength(1)
      expect(commandState.commands[0].built).toEqual({
        kind: 'patchPromptSettings',
        baseRevision: 1,
        patch: { customPromptTemplateToggle: 'local dirty' },
        acknowledgeOptimistic: true,
        optimisticProjectionEpoch: projectionEpoch,
      })
    } finally {
      if (component) await unmount(component)
      target.remove()
    }
  })

  it('PromptSettings merges clean object subfields while preserving a dirty prompt setting field', async () => {
    seedPromptSettings({
      promptSettings: {
        ...minimalPromptSettings,
        postEndInnerFormat: 'server old',
        sendName: false,
      },
    })

    const target = document.createElement('div')
    document.body.appendChild(target)
    let component: MountedComponent | null = null
    try {
      component = await mountPromptSettingsComponent(target)

      await editPromptSettingsTextInput(target, 'local format')

      await applyPromptSettingsProjection(() => {
        getResourceDatabase().promptSettings = {
          ...minimalPromptSettings,
          postEndInnerFormat: 'stale format',
          sendName: true,
        }
      })

      expect(getResourceDatabase().promptSettings).toMatchObject({
        postEndInnerFormat: 'local format',
        sendName: true,
      })

      await vi.advanceTimersByTimeAsync(250)
      await flushMicrotasks()

      expect(commandState.commands).toHaveLength(1)
      expect(commandState.commands[0].built).toMatchObject({
        kind: 'patchPromptSettings',
        baseRevision: 1,
        acknowledgeOptimistic: true,
        optimisticProjectionEpoch: expect.any(Number),
        patch: {
          promptSettings: {
            postEndInnerFormat: 'local format',
            sendName: true,
          },
        },
      })
    } finally {
      if (component) await unmount(component)
      target.remove()
    }
  })

  it('PromptSettings clears dirty prompt setting state when projection catches up', async () => {
    seedPromptSettings({ customPromptTemplateToggle: 'server old' })

    const target = document.createElement('div')
    document.body.appendChild(target)
    let component: MountedComponent | null = null
    try {
      component = await mountPromptSettingsComponent(target)

      await editPromptSettingsTextarea(target, 'local accepted')
      expect(getResourceDatabase().customPromptTemplateToggle).toBe('local accepted')

      await applyPromptSettingsProjection(() => {
        ;(getResourceDatabase() as unknown as Record<string, unknown>).customPromptTemplateToggle = 'local accepted'
      })
      await applyPromptSettingsProjection(() => {
        ;(getResourceDatabase() as unknown as Record<string, unknown>).customPromptTemplateToggle = 'server later'
      })

      expect(promptSettingsTextarea(target).value).toBe('server later')
      expect(getResourceDatabase().customPromptTemplateToggle).toBe('server later')

      await vi.advanceTimersByTimeAsync(250)
      await flushMicrotasks()
      expect(commandState.commands).toHaveLength(0)
    } finally {
      if (component) await unmount(component)
      target.remove()
    }
  })

  it('PromptSettings reasserts a stale projection only into the captured prompt preset owner', async () => {
    seedPromptSettings({
      customPromptTemplateToggle: 'server A',
      promptPresetsId: 0,
      promptPresets: [
        { id: 'preset-a', name: 'Preset A', customPromptTemplateToggle: 'server A' },
        { id: 'preset-b', name: 'Preset B', customPromptTemplateToggle: 'server B' },
      ],
    })

    const target = document.createElement('div')
    document.body.appendChild(target)
    let component: MountedComponent | null = null
    try {
      component = await mountPromptSettingsComponent(target)

      await editPromptSettingsTextarea(target, 'dirty A')
      await flushMicrotasks()

      expect(getResourceDatabase().customPromptTemplateToggle).toBe('dirty A')
      expect(getResourceDatabase().promptPresets[0].customPromptTemplateToggle).toBe('dirty A')
      expect(commandMocks.updatePromptPresetCommand).toHaveBeenCalledTimes(1)

      await applyPromptSettingsProjection(() => {
        getResourceDatabase().promptPresetsId = 1
        getResourceDatabase().promptPresets = [
          { id: 'preset-a', name: 'Preset A', customPromptTemplateToggle: 'stale A' },
          { id: 'preset-b', name: 'Preset B', customPromptTemplateToggle: 'server B' },
        ]
        getResourceDatabase().customPromptTemplateToggle = 'server B'
      })

      expect(getResourceDatabase().promptPresets[0].customPromptTemplateToggle).toBe('dirty A')
      expect(getResourceDatabase().promptPresets[1].customPromptTemplateToggle).toBe('server B')
      expect(getResourceDatabase().customPromptTemplateToggle).toBe('server B')
      expect(promptSettingsTextarea(target).value).toBe('server B')
      expect(commandMocks.updatePromptPresetCommand).toHaveBeenCalledTimes(1)
    } finally {
      if (component) await unmount(component)
      target.remove()
    }
  })

  it('M8: flushes pending prompt settings patches with keepalive and clears debounce', async () => {
    resourceDatabase.current = { jsonSchemaEnabled: true }
    const projectionEpoch = captureSettingsGroupProjectionEpoch('prompt')

    queuePromptSettingsProjectionPatch({ jsonSchemaEnabled: false }, { jsonSchemaEnabled: true }, 500)
    flushPendingPromptTemplatePatches({ keepalive: true })
    await Promise.resolve()

    expect(commandState.commands).toHaveLength(1)
    expect(commandState.commands[0].keepalive).toBe(true)
    expect(commandState.commands[0].built).toEqual({
      kind: 'patchPromptSettings',
      baseRevision: 1,
      patch: { jsonSchemaEnabled: false },
      acknowledgeOptimistic: true,
      optimisticProjectionEpoch: projectionEpoch,
    })

    await vi.advanceTimersByTimeAsync(500)
    expect(commandState.commands).toHaveLength(1)
  })

  it('drops a pending prompt settings patch when the value returns to its original snapshot', async () => {
    resourceDatabase.current = { jsonSchemaEnabled: true }

    queuePromptSettingsProjectionPatch({ jsonSchemaEnabled: false }, { jsonSchemaEnabled: true }, 500)
    queuePromptSettingsProjectionPatch({ jsonSchemaEnabled: true }, { jsonSchemaEnabled: false }, 500)
    await vi.advanceTimersByTimeAsync(500)

    expect(commandState.commands).toHaveLength(0)
  })

  it('captures a fresh prompt settings epoch after a pending batch fully reverts', async () => {
    resourceDatabase.current = { jsonSchemaEnabled: true }

    queuePromptSettingsProjectionPatch({ jsonSchemaEnabled: false }, { jsonSchemaEnabled: true }, 500)
    queuePromptSettingsProjectionPatch({ jsonSchemaEnabled: true }, { jsonSchemaEnabled: false }, 500)
    const abandonedEpoch = captureSettingsGroupProjectionEpoch('prompt')

    resourceDatabase.current = { jsonSchemaEnabled: true }
    const nextEpoch = captureSettingsGroupProjectionEpoch('prompt')
    expect(nextEpoch).not.toBe(abandonedEpoch)

    getResourceDatabase().jsonSchemaEnabled = false
    queuePromptSettingsProjectionPatch({ jsonSchemaEnabled: false }, { jsonSchemaEnabled: true }, 500)
    await vi.advanceTimersByTimeAsync(500)

    expect(commandState.commands[0].built).toMatchObject({
      acknowledgeOptimistic: true,
      optimisticProjectionEpoch: nextEpoch,
    })
  })

  it('taints acknowledgement and preserves a newer settings projection on command failure', async () => {
    resourceDatabase.current = { jsonSchemaEnabled: true }
    const attemptedEpoch = captureSettingsGroupProjectionEpoch('prompt')
    getResourceDatabase().jsonSchemaEnabled = false
    queuePromptSettingsProjectionPatch({ jsonSchemaEnabled: false }, { jsonSchemaEnabled: true }, 0)
    commandMocks.patchPromptSettingsCommand.mockResolvedValueOnce({ status: 'network-error' })
    commandState.beforeBuild = () => {
      resourceDatabase.current = { jsonSchemaEnabled: 'newer server value' }
    }

    await vi.advanceTimersByTimeAsync(0)
    await flushMicrotasks()

    expect(commandMocks.patchPromptSettingsCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        acknowledgeOptimistic: true,
        optimisticProjectionEpoch: attemptedEpoch,
      }),
      undefined,
      undefined,
    )
    expect(getResourceDatabase().jsonSchemaEnabled).toBe('newer server value')
    expect(isSettingsGroupAcknowledgementTainted('prompt')).toBe(true)
  })
})

describe('prompt settings draft dispatch contracts', () => {
  it('does not redispatch PromptSettings drafts after accepting selected-preset projection changes', () => {
    const source = readSource('src/lib/Setting/Pages/PromptSettings.svelte')

    expect(source).toContain('let previousDraftDispatchSnapshot = snapshotJson(initialValue)')
    expect(source).toContain('previousDraftDispatchSnapshot = serverSnapshot')
    expect(source).toContain('if (snapshot === previousDraftDispatchSnapshot) return')
  })

  it('does not redispatch prompt preset model override drafts after accepting projection changes', () => {
    const source = readSource('src/ts/promptPresetModelOverrides.svelte.ts')

    expect(source).toContain('let previousDraftDispatchSnapshot = snapshotJson(initialValue)')
    expect(source).toContain('previousDraftDispatchSnapshot = serverSnapshot')
    expect(source).toContain('if (snapshot === previousDraftDispatchSnapshot) return')
  })

  it('does not mirror prompt item row edits through whole prompt preset update commands', () => {
    const source = readSource('src/ts/server/promptTemplateBridge.svelte.ts')

    expect(source).not.toContain("mirrorTopLevelPresetField('promptTemplate'")
  })

  it('keeps PromptSettings row edits on prompt item commands after selected-template id repair', () => {
    const source = readSource('src/lib/Setting/Pages/PromptSettings.svelte')

    expect(source).toContain('queuePromptPresetTemplateIdServerSync(ownerId)')
    expect(source).toContain('syncSelectedPromptPresetItemProjection(itemId, promptItem)')
    expect(source).toContain('syncSelectedPromptPresetItemProjection(itemId, currentItem)')
    expect(source).toContain('queueRowPatch(capturePromptTemplateOwnerMutationFence(ownerId))')
    expect(source).toContain('queuePromptItemProjectionUpdate(')
    expect(source).toContain('syncSelectedPromptPresetTemplateProjection(templates)')
    expect(source).toContain('promptPresetId: promptTemplateOwnerCommandId(ownerId)')
    expect(source).toContain('markPromptTemplateOwnerAcknowledgementTainted(ownerId)')
    expect(source).toContain('markPromptTemplateOwnerAcknowledgementTainted(currentPromptTemplateOwnerId())')
  })
})

describe('reconcilePromptTemplateDraft', () => {
  it('does not reconcile or stringify when the cached revision is unchanged', () => {
    seedTemplate()
    commandState.revision = 5
    const draft = [item('p-0', 'local-edit')] // differs from the projection

    const instrumented = withCloneInstrumentation(() => reconcilePromptTemplateDraft(draft, 5))

    expect(instrumented.result.nextDraft).toBeNull()
    expect(instrumented.result.revision).toBe(5)
    // The keystroke path runs zero whole-template stringify passes.
    expect(instrumented.jsonCloneCount).toBe(0)
  })

  it('reconciles from the projection when the revision advances and content differs', () => {
    seedTemplate()
    commandState.revision = 6
    const draft = [item('p-0', 'stale-local')]

    const result = reconcilePromptTemplateDraft(draft, 5)

    expect(result.revision).toBe(6)
    expect(result.nextDraft).not.toBeNull()
    expect(result.nextDraft?.map((p) => p.id)).toEqual(['p-0', 'p-1', 'p-2', 'p-3'])
    expect(textOf(result.nextDraft?.[0])).toBe('small')
  })

  it('preserves dirty prompt item text while clean sibling rows refresh', async () => {
    resourceDatabase.current = {
      promptTemplate: [item('dirty-text', 'server old'), item('clean-sibling', 'sibling old')],
    }
    let draftItems = draftCopy()
    draftItems[0] = item('dirty-text', 'local dirty')
    const binding: PromptTemplateDraftBinding = {
      getItems: () => draftItems,
      setItems: (items) => {
        draftItems = items
      },
    }

    queuePromptItemProjectionUpdate(binding, 'dirty-text', item('dirty-text', 'server old'), 500)
    getResourceDatabase().promptTemplate = [item('dirty-text', 'server old'), item('clean-sibling', 'sibling fresh')]
    commandState.revision = 6

    const result = reconcilePromptTemplateDraft(draftItems, 5)
    if (result.nextDraft) draftItems = result.nextDraft

    expect(result.revision).toBe(6)
    expect(textOf(result.nextDraft?.[0])).toBe('local dirty')
    expect(textOf(result.nextDraft?.[1])).toBe('sibling fresh')

    await flushPromptItemDirtyTestState(draftItems)
  })

  it('refreshes clean fields on the dirty row', async () => {
    resourceDatabase.current = {
      promptTemplate: [promptItemFixture({ ...item('dirty-row', 'server old'), name: 'old name', role: 'system' })],
    }
    let draftItems = draftCopy()
    draftItems[0] = promptItemFixture({ ...item('dirty-row', 'local dirty'), name: 'old name', role: 'system' })
    const binding: PromptTemplateDraftBinding = {
      getItems: () => draftItems,
      setItems: (items) => {
        draftItems = items
      },
    }

    queuePromptItemProjectionUpdate(
      binding,
      'dirty-row',
      promptItemFixture({ ...item('dirty-row', 'server old'), name: 'old name', role: 'system' }),
      500,
    )
    getResourceDatabase().promptTemplate = [
      promptItemFixture({ ...item('dirty-row', 'server old'), name: 'server name', role: 'user' }),
    ]
    commandState.revision = 6

    const result = reconcilePromptTemplateDraft(draftItems, 5)
    if (result.nextDraft) draftItems = result.nextDraft

    expect(textOf(result.nextDraft?.[0])).toBe('local dirty')
    expect((result.nextDraft?.[0] as { name?: string } | undefined)?.name).toBe('server name')
    expect((result.nextDraft?.[0] as { role?: string } | undefined)?.role).toBe('user')

    await flushPromptItemDirtyTestState(draftItems)
  })

  it('clears dirty state once projection matches local dirty value, so later projection can update that field', async () => {
    resourceDatabase.current = {
      promptTemplate: [item('clears-dirty', 'server old')],
    }
    let draftItems = draftCopy()
    draftItems[0] = item('clears-dirty', 'local dirty')
    const binding: PromptTemplateDraftBinding = {
      getItems: () => draftItems,
      setItems: (items) => {
        draftItems = items
      },
    }

    queuePromptItemProjectionUpdate(binding, 'clears-dirty', item('clears-dirty', 'server old'), 500)
    getResourceDatabase().promptTemplate = [{ ...item('clears-dirty', 'local dirty'), name: 'server acknowledged' }]
    commandState.revision = 6

    const acknowledged = reconcilePromptTemplateDraft(draftItems, 5)
    if (acknowledged.nextDraft) draftItems = acknowledged.nextDraft

    expect(textOf(draftItems[0])).toBe('local dirty')
    expect((draftItems[0] as { name?: string }).name).toBe('server acknowledged')

    getResourceDatabase().promptTemplate = [{ ...item('clears-dirty', 'server later'), name: 'server acknowledged' }]
    commandState.revision = 7

    const later = reconcilePromptTemplateDraft(draftItems, 6)
    if (later.nextDraft) draftItems = later.nextDraft

    expect(textOf(later.nextDraft?.[0])).toBe('server later')

    await flushPromptItemDirtyTestState(draftItems)
  })

  it('selection reset clears dirty row merges and cancels pending item patches from the previous preset', async () => {
    resourceDatabase.current = {
      promptTemplate: [item('shared-row', 'old preset server')],
    }
    let draftItems = [item('shared-row', 'old preset local dirty')]
    const binding: PromptTemplateDraftBinding = {
      getItems: () => draftItems,
      setItems: (items) => {
        draftItems = items
      },
    }

    queuePromptItemProjectionUpdate(binding, 'shared-row', item('shared-row', 'old preset server'), 500)
    resetPromptTemplateSelectionDirtyState()

    getResourceDatabase().promptTemplate = [item('shared-row', 'new preset projection')]
    commandState.revision = 6

    const result = reconcilePromptTemplateDraft(draftItems, 5)
    if (result.nextDraft) draftItems = result.nextDraft

    expect(textOf(draftItems[0])).toBe('new preset projection')

    await vi.advanceTimersByTimeAsync(500)
    expect(commandState.commands).toHaveLength(0)
  })

  it('selection reset preserves pending prompt settings patches', async () => {
    resourceDatabase.current = { jsonSchemaEnabled: true }
    const projectionEpoch = captureSettingsGroupProjectionEpoch('prompt')

    queuePromptSettingsProjectionPatch({ jsonSchemaEnabled: false }, { jsonSchemaEnabled: true }, 500)
    resetPromptTemplateSelectionDirtyState()
    await vi.advanceTimersByTimeAsync(500)

    expect(commandState.commands).toHaveLength(1)
    expect(commandState.commands[0].built).toEqual({
      kind: 'patchPromptSettings',
      baseRevision: 1,
      patch: { jsonSchemaEnabled: false },
      acknowledgeOptimistic: true,
      optimisticProjectionEpoch: projectionEpoch,
    })
  })

  it('does not reconcile when the revision advances but content already matches', () => {
    seedTemplate()
    commandState.revision = 6
    const result = reconcilePromptTemplateDraft(draftCopy(), 5)

    expect(result.revision).toBe(6)
    expect(result.nextDraft).toBeNull()
  })
})
