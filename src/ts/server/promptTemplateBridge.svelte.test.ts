import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, tick, unmount } from 'svelte'

const commandState = vi.hoisted(() => ({
  revision: 1 as number | null,
  commands: [] as Array<{
    built: Record<string, unknown>
    rollback?: () => void
    keepalive?: boolean
  }>,
}))

const commandMocks = vi.hoisted(() => ({
  canUseServerCommands: () => true,
  patchPromptSettingsCommand: async (args: Record<string, unknown>) => ({
    kind: 'patchPromptSettings',
    ...args,
  }),
  peekCachedServerCommandRevision: () => commandState.revision,
  runServerCommand: vi.fn(
    async (args: {
      command: (baseRevision: number) => Promise<Record<string, unknown>>
      rollback?: () => void
      keepalive?: boolean
    }) => {
      const built = await args.command(1)
      commandState.commands.push({
        built,
        rollback: args.rollback,
        ...(args.keepalive ? { keepalive: args.keepalive } : {}),
      })
      return { status: 'ok', revision: 1 }
    },
  ),
  updatePromptItemCommand: async (args: Record<string, unknown>) => ({
    kind: 'updatePromptItem',
    ...args,
  }),
  createPromptItemCommand: async (args: Record<string, unknown>) => ({
    kind: 'createPromptItem',
    ...args,
  }),
  deletePromptItemCommand: async (args: Record<string, unknown>) => ({
    kind: 'deletePromptItem',
    ...args,
  }),
  reorderPromptItemsCommand: async (args: Record<string, unknown>) => ({
    kind: 'reorderPromptItems',
    ...args,
  }),
}))

vi.mock('./commands', () => commandMocks)
vi.mock('src/ts/server/commands', () => commandMocks)

vi.mock('./projectionWriteGuard.svelte', () => ({
  withTrustedServerProjectionWrite: (fn: () => unknown) => fn(),
}))
vi.mock('src/ts/server/projectionWriteGuard.svelte', () => ({
  withTrustedServerProjectionWrite: (fn: () => unknown) => fn(),
}))

vi.mock('src/ts/server/settingsBridge.svelte', () => ({
  createServerBackedSettingDraft: vi.fn((_key: string, fallback: unknown) => ({ value: fallback })),
  watchServerBackedSettings: vi.fn(() => () => {}),
}))

import type { PromptItem } from '../process/prompt'
import { DBState } from '../stores.svelte'
import { withCloneInstrumentation } from '../__tests__/cloneCostHarness'
import PromptSettings from 'src/lib/Setting/Pages/PromptSettings.svelte'
import { queuePromptItemProjectionUpdate as queuePromptItemProjectionUpdateForPromptSettings } from 'src/ts/server/promptTemplateBridge.svelte'
import {
  applyPromptItemProjectionWrite,
  cloneJsonValue,
  flushPendingPromptTemplatePatches,
  queuePromptItemProjectionUpdate,
  queuePromptSettingsProjectionPatch,
  reconcilePromptTemplateDraft,
  restorePromptItemProjectionWrite,
  type PromptTemplateDraftBinding,
} from './promptTemplateBridge.svelte'

const BIG = 'x'.repeat(5000)
type MountedComponent = Parameters<typeof unmount>[0]

function item(id: string, text: string): PromptItem {
  return { id, type: 'plain', type2: 'normal', role: 'system', text } as PromptItem
}

// `text` lives on the plain/jailbreak/cot/chatML PromptItem variants; the seed
// uses plain items, so read it through a narrow cast in assertions.
function textOf(value: PromptItem | undefined): string | undefined {
  return (value as { text?: string } | undefined)?.text
}

// One tiny edited item plus several large items, so a single-item clone is
// distinguishable from a whole-`promptTemplate` clone by serialized size.
function seedTemplate(): void {
  ;(DBState as { db: unknown }).db = {
    promptTemplate: [item('p-0', 'small'), item('p-1', BIG), item('p-2', BIG), item('p-3', BIG)],
  }
}

function draftCopy(): PromptItem[] {
  return cloneJsonValue((DBState.db.promptTemplate ?? []) as PromptItem[])
}

beforeEach(() => {
  vi.useFakeTimers()
  commandState.revision = 1
  commandState.commands.length = 0
})

afterEach(() => {
  vi.useRealTimers()
  ;(DBState as { db: unknown }).db = {}
})

describe('applyPromptItemProjectionWrite', () => {
  it('mirrors only the edited item into the projection without a whole-array clone', () => {
    seedTemplate()
    const draft = draftCopy()
    draft[0] = item('p-0', 'edited')

    const instrumented = withCloneInstrumentation(() =>
      applyPromptItemProjectionWrite(draft, 'p-0'),
    )

    // The clone is one tiny item, never the multi-item array of large bodies.
    expect(instrumented.maxClonedSize).toBeLessThan(BIG.length)
    expect(instrumented.result).toEqual(item('p-0', 'edited'))
    expect((DBState.db.promptTemplate as PromptItem[])[0]).toEqual(item('p-0', 'edited'))
    // Unrelated large items are untouched.
    expect(textOf((DBState.db.promptTemplate as PromptItem[])[1])).toBe(BIG)
  })

  it('returns null and writes nothing when the item is gone from the draft', () => {
    seedTemplate()
    const result = applyPromptItemProjectionWrite(draftCopy(), 'missing')
    expect(result).toBeNull()
    expect((DBState.db.promptTemplate as PromptItem[])[0]).toEqual(item('p-0', 'small'))
  })

  it('falls back to a full sync when the projection has no matching row yet', () => {
    seedTemplate()
    // The draft has a brand-new item not yet present in the projection.
    const draft = draftCopy()
    draft.push(item('p-new', 'fresh'))
    const result = applyPromptItemProjectionWrite(draft, 'p-new')
    expect(result).toEqual(item('p-new', 'fresh'))
    expect((DBState.db.promptTemplate as PromptItem[]).map((p) => p.id)).toEqual([
      'p-0',
      'p-1',
      'p-2',
      'p-3',
      'p-new',
    ])
  })
})

describe('restorePromptItemProjectionWrite', () => {
  it('restores only the edited item, leaving concurrent edits to other items intact', () => {
    seedTemplate()
    const projection = DBState.db.promptTemplate as PromptItem[]
    // The failing command had optimistically changed p-0; meanwhile p-1 changed too.
    ;(projection[0] as { text: string }).text = 'optimistic'
    ;(projection[1] as { text: string }).text = 'concurrent'

    restorePromptItemProjectionWrite('p-0', item('p-0', 'original'))

    expect((DBState.db.promptTemplate as PromptItem[])[0]).toEqual(item('p-0', 'original'))
    // A whole-array rollback would have reverted p-1 to BIG; the scoped rollback does not.
    expect(textOf((DBState.db.promptTemplate as PromptItem[])[1])).toBe('concurrent')
  })
})

describe('flushPendingPromptTemplatePatches', () => {
  it('M8: flushes pending prompt item updates with keepalive and clears debounce', async () => {
    seedTemplate()
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
      itemId: 'p-0',
      patch: item('p-0', 'unload item'),
    })

    await vi.advanceTimersByTimeAsync(500)
    expect(commandState.commands).toHaveLength(1)
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
    DBState.db.promptTemplate = []
    DBState.db.promptSettings = {}

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
      patch: item('p-0', 'component teardown item'),
    })

    await vi.advanceTimersByTimeAsync(500)
    expect(commandState.commands).toHaveLength(1)
  })

  it('M8: flushes pending prompt settings patches with keepalive and clears debounce', async () => {
    ;(DBState as { db: unknown }).db = { jsonSchemaEnabled: true }

    queuePromptSettingsProjectionPatch(
      { jsonSchemaEnabled: false },
      { jsonSchemaEnabled: true },
      500,
    )
    flushPendingPromptTemplatePatches({ keepalive: true })
    await Promise.resolve()

    expect(commandState.commands).toHaveLength(1)
    expect(commandState.commands[0].keepalive).toBe(true)
    expect(commandState.commands[0].built).toEqual({
      kind: 'patchPromptSettings',
      baseRevision: 1,
      patch: { jsonSchemaEnabled: false },
    })

    await vi.advanceTimersByTimeAsync(500)
    expect(commandState.commands).toHaveLength(1)
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

  it('does not reconcile when the revision advances but content already matches', () => {
    seedTemplate()
    commandState.revision = 6
    const result = reconcilePromptTemplateDraft(draftCopy(), 5)

    expect(result.revision).toBe(6)
    expect(result.nextDraft).toBeNull()
  })
})
