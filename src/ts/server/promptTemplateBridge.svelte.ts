import type { PromptItem } from '../process/prompt'
import { mirrorTopLevelPresetField } from '../presetFieldMirror'
import { DBState } from '../stores.svelte'
import {
  canUseServerCommands,
  patchPromptSettingsCommand,
  peekCachedServerCommandRevision,
  runServerCommand,
  updatePromptItemCommand,
  type PromptItemSnapshot,
  type ServerCommandTransportOptions,
  type SettingsPatch,
} from './commands'
import { withTrustedServerProjectionWrite } from './projectionWriteGuard.svelte'
import { isPromptTemplateHydrated } from './promptTemplateHydration'
import { mergeProjectionIntoDirtyDraft } from './staleStateGuards'

/**
 * Prompt-template editor projection helpers.
 *
 * The prompt-template editor keeps a local `promptTemplate` draft and mirrors
 * edits into the read-only server projection (`DBState.db.promptTemplate`). The
 * These helpers avoid two per-keystroke costs:
 *
 * - the optimistic projection write cloned the WHOLE `promptTemplate` array on
 *   every keystroke (High), and
 * - the change-detection `$effect` ran two whole-template `JSON.stringify`
 *   passes on every reactive fire (Medium).
 *
 * These helpers narrow both: a keystroke writes only the edited item in place,
 * and reconciliation is gated by the cached server command revision instead of a
 * per-fire whole-template stringify diff. They are intentionally independent of
 * the component so the clone-cost regression can exercise them directly.
 */

export function cloneJsonValue<T>(value: T): T {
  if (value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}

export function snapshotJson(value: unknown): string {
  const snapshot = JSON.stringify(value)
  return snapshot === undefined ? '__undefined__' : snapshot
}

export interface PromptTemplateDraftBinding {
  getItems: () => PromptItem[]
  setItems: (items: PromptItem[]) => void
}

export interface FailedPromptTemplateItemCreateRollback {
  binding: PromptTemplateDraftBinding
  itemId: string
  attemptedItem: PromptItem
}

export interface FailedPromptTemplateItemDeleteRollback {
  binding: PromptTemplateDraftBinding
  itemId: string
  previousIndex: number
  previousItem: PromptItem
}

export interface FailedPromptTemplateItemReorderRollback {
  binding: PromptTemplateDraftBinding
  previousItemIds: string[]
  attemptedItemIds: string[]
}

interface PendingPromptItemUpdate {
  itemId: string
  previousItem: PromptItem
  attemptedItem: PromptItem
  binding: PromptTemplateDraftBinding
  timer: ReturnType<typeof setTimeout> | null
}

interface PendingPromptSettingsPatch {
  patch: SettingsPatch
  previous: SettingsPatch
  attempted: SettingsPatch
  timer: ReturnType<typeof setTimeout> | null
}

const pendingPromptItemUpdates = new Map<string, PendingPromptItemUpdate>()
const pendingPromptSettingsPatch: PendingPromptSettingsPatch = {
  patch: {},
  previous: {},
  attempted: {},
  timer: null,
}
const promptItemDirtyFieldsById = new Map<string, Set<string>>()

/**
 * Mirror one edited prompt item into the read-only projection in place, without
 * cloning the whole `promptTemplate` array. Returns the cloned item that was
 * written (use it as the server patch / rollback "attempted" baseline), or
 * `null` when the item is no longer in the draft.
 *
 * Falls back to a full-array sync only when the projection has no row with this
 * id yet (rare: the projection has drifted from the draft); that path is still
 * correct, just not narrowed.
 */
export function applyPromptItemProjectionWrite(draftItems: PromptItem[], itemId: string): PromptItem | null {
  if (!isPromptTemplateHydrated()) return null
  const draftItem = (draftItems ?? []).find((item) => item.id === itemId)
  if (!draftItem) return null
  const snapshot = cloneJsonValue(draftItem)
  withTrustedServerProjectionWrite(() => {
    const template = DBState.db.promptTemplate
    if (!Array.isArray(template)) {
      DBState.db.promptTemplate = cloneJsonValue(draftItems)
      return
    }
    const index = template.findIndex((item) => item.id === itemId)
    if (index === -1) {
      DBState.db.promptTemplate = cloneJsonValue(draftItems)
      return
    }
    template[index] = snapshot
  })
  return snapshot
}

/**
 * Restore a single prompt item in the projection in place (failed-command
 * rollback), leaving every other item untouched. The former rollback re-cloned
 * the whole `promptTemplate` array.
 */
export function restorePromptItemProjectionWrite(itemId: string, previousItem: PromptItem): void {
  withTrustedServerProjectionWrite(() => {
    const template = DBState.db.promptTemplate
    if (!Array.isArray(template)) return
    const index = template.findIndex((item) => item.id === itemId)
    if (index !== -1) template[index] = cloneJsonValue(previousItem)
  })
}

export function rollbackFailedPromptTemplateItemCreate(input: FailedPromptTemplateItemCreateRollback): void {
  const liveItems = input.binding.getItems() ?? []
  const liveIndex = findPromptItemIndexById(liveItems, input.itemId)
  if (liveIndex === -1) return
  if (snapshotJson(liveItems[liveIndex]) !== snapshotJson(input.attemptedItem)) return

  const nextItems = [...liveItems]
  nextItems.splice(liveIndex, 1)
  applyPromptTemplateCollectionRollback(input.binding, nextItems)
  promptItemDirtyFieldsById.delete(input.itemId)
}

export function rollbackFailedPromptTemplateItemDelete(input: FailedPromptTemplateItemDeleteRollback): void {
  const liveItems = input.binding.getItems() ?? []
  if (findPromptItemIndexById(liveItems, input.itemId) !== -1) return

  const insertIndex = Math.max(0, Math.min(input.previousIndex, liveItems.length))
  const nextItems = [...liveItems]
  nextItems.splice(insertIndex, 0, cloneJsonValue(input.previousItem))
  applyPromptTemplateCollectionRollback(input.binding, nextItems)
}

export function rollbackFailedPromptTemplateItemReorder(input: FailedPromptTemplateItemReorderRollback): void {
  const liveItems = input.binding.getItems() ?? []
  const liveItemIds = promptItemIdList(liveItems)
  if (!stringArraysEqual(liveItemIds, input.attemptedItemIds)) return

  const liveItemsById = promptItemsById(liveItems)
  const previousOrder = input.previousItemIds
    .map((itemId) => liveItemsById.get(itemId))
    .filter((item): item is PromptItem => Boolean(item))
  if (previousOrder.length !== liveItems.length) return

  applyPromptTemplateCollectionRollback(input.binding, previousOrder)
}

export function queuePromptItemProjectionUpdate(
  binding: PromptTemplateDraftBinding,
  itemId: string,
  previousItem: PromptItem,
  delayMs = 250,
): void {
  if (!isPromptTemplateHydrated()) return
  const attemptedItem = applyPromptItemProjectionWrite(binding.getItems(), itemId)
  if (!attemptedItem) return
  markDirtyPromptItemFields(itemId, previousItem, attemptedItem)
  mirrorTopLevelPresetField('promptTemplate', binding.getItems())
  if (!canUseServerCommands()) return

  const existing = pendingPromptItemUpdates.get(itemId)
  if (existing?.timer) clearTimeout(existing.timer)
  const pending: PendingPromptItemUpdate = {
    itemId,
    previousItem: cloneJsonValue(existing?.previousItem ?? previousItem),
    attemptedItem,
    binding,
    timer: null,
  }
  pending.timer = setTimeout(() => runPendingPromptItemUpdate(itemId), delayMs)
  pendingPromptItemUpdates.set(itemId, pending)
}

export function queuePromptSettingsProjectionPatch(patch: SettingsPatch, previous: SettingsPatch, delayMs = 250): void {
  if (!canUseServerCommands()) return
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in pendingPromptSettingsPatch.previous)) {
      pendingPromptSettingsPatch.previous[key] = previous[key]
    }
    if (snapshotJson(value) === snapshotJson(pendingPromptSettingsPatch.previous[key])) {
      delete pendingPromptSettingsPatch.patch[key]
      delete pendingPromptSettingsPatch.previous[key]
      delete pendingPromptSettingsPatch.attempted[key]
      continue
    }
    pendingPromptSettingsPatch.patch[key] = value
    pendingPromptSettingsPatch.attempted[key] = value
  }

  if (pendingPromptSettingsPatch.timer) clearTimeout(pendingPromptSettingsPatch.timer)
  if (Object.keys(pendingPromptSettingsPatch.patch).length === 0) {
    pendingPromptSettingsPatch.timer = null
    return
  }
  pendingPromptSettingsPatch.timer = setTimeout(() => {
    runPendingPromptSettingsPatch()
  }, delayMs)
}

export function flushPendingPromptTemplatePatches(options: ServerCommandTransportOptions = {}): void {
  for (const itemId of Array.from(pendingPromptItemUpdates.keys())) {
    runPendingPromptItemUpdate(itemId, options)
  }
  runPendingPromptSettingsPatch(options)
}

export function resetPromptTemplateSelectionDirtyState(): void {
  for (const pending of pendingPromptItemUpdates.values()) {
    if (pending.timer) clearTimeout(pending.timer)
  }
  pendingPromptItemUpdates.clear()
  promptItemDirtyFieldsById.clear()
}

function runPendingPromptItemUpdate(itemId: string, options: ServerCommandTransportOptions = {}): void {
  const pending = pendingPromptItemUpdates.get(itemId)
  if (!pending) return
  if (pending.timer) clearTimeout(pending.timer)
  pendingPromptItemUpdates.delete(itemId)

  void runServerCommand({
    command: (baseRevision) =>
      updatePromptItemCommand(
        {
          baseRevision,
          itemId: pending.itemId,
          patch: cloneJsonValue(pending.attemptedItem) as PromptItemSnapshot,
        },
        options.signal,
        options.keepalive,
      ),
    rollback: () =>
      rollbackPendingPromptItemUpdate(pending.binding, pending.itemId, pending.previousItem, pending.attemptedItem),
    signal: options.signal,
    keepalive: options.keepalive,
  }).then((result) => {
    if (result.status !== 'ok') return
    clearDirtyPromptItemFieldsMatchingProjection(
      pending.binding.getItems(),
      (DBState.db.promptTemplate ?? []) as PromptItem[],
    )
  })
}

function runPendingPromptSettingsPatch(options: ServerCommandTransportOptions = {}): void {
  if (pendingPromptSettingsPatch.timer) {
    clearTimeout(pendingPromptSettingsPatch.timer)
    pendingPromptSettingsPatch.timer = null
  }
  const commandPatch = pendingPromptSettingsPatch.patch
  const commandPrevious = pendingPromptSettingsPatch.previous
  const commandAttempted = pendingPromptSettingsPatch.attempted
  pendingPromptSettingsPatch.patch = {}
  pendingPromptSettingsPatch.previous = {}
  pendingPromptSettingsPatch.attempted = {}

  if (Object.keys(commandPatch).length === 0) return

  void runServerCommand({
    command: (baseRevision) =>
      patchPromptSettingsCommand(
        {
          baseRevision,
          patch: commandPatch,
        },
        options.signal,
        options.keepalive,
      ),
    rollback: () => rollbackPromptSettingsPatch(commandPrevious, commandAttempted),
    signal: options.signal,
    keepalive: options.keepalive,
  })
}

function rollbackPendingPromptItemUpdate(
  binding: PromptTemplateDraftBinding,
  itemId: string,
  previousItem: PromptItem,
  attemptedItem: PromptItem,
): void {
  const draftItems = binding.getItems()
  const index = draftItems.findIndex((item) => item.id === itemId)
  if (index === -1) return
  if (snapshotJson(draftItems[index]) !== snapshotJson(attemptedItem)) return
  const nextItems = [...draftItems]
  nextItems[index] = cloneJsonValue(previousItem)
  binding.setItems(nextItems)
  restorePromptItemProjectionWrite(itemId, previousItem)
  clearPromptItemDirtyFields(itemId, changedPromptItemFields(previousItem, attemptedItem))
}

function rollbackPromptSettingsPatch(previous: SettingsPatch, attempted: SettingsPatch): void {
  withTrustedServerProjectionWrite(() => {
    const target = DBState.db as unknown as Record<string, unknown>
    for (const [key, previousValue] of Object.entries(previous)) {
      if (snapshotJson(target[key]) === snapshotJson(attempted[key])) {
        target[key] = cloneJsonValue(previousValue)
      }
    }
  })
}

export interface PromptTemplateReconcileResult {
  /** The cached command revision observed on this pass (store it as the next baseline). */
  revision: number | null
  /** A fresh draft value to adopt, or `null` when no reconcile is needed. */
  nextDraft: PromptItem[] | null
}

/**
 * Decide whether the prompt-template draft should be re-pulled from the server
 * projection. The cached command revision is the discriminator: a keystroke's
 * optimistic write never advances it, so reconciliation only runs after a real
 * server push / command response. The whole-template stringify only happens on
 * such a revision advance, never per keystroke.
 *
 * Reads `DBState.db.promptTemplate` first so a caller `$effect` registers the
 * projection dependency (`DBState.db` is reassigned on every guarded write /
 * projection apply) and re-runs on a server push.
 */
export function reconcilePromptTemplateDraft(
  draftItems: PromptItem[],
  previousRevision: number | null,
): PromptTemplateReconcileResult {
  if (!isPromptTemplateHydrated()) {
    return { revision: previousRevision, nextDraft: null }
  }
  const serverValue = (DBState.db.promptTemplate ?? []) as PromptItem[]
  const revision = peekCachedServerCommandRevision()
  if (revision === previousRevision) return { revision, nextDraft: null }
  if (promptItemDirtyFieldsById.size > 0) {
    clearDirtyPromptItemFieldsMatchingProjection(draftItems ?? [], serverValue)
  }
  if (snapshotJson(serverValue) === snapshotJson(draftItems ?? [])) {
    return { revision, nextDraft: null }
  }
  if (promptItemDirtyFieldsById.size > 0) {
    const mergedDraft = mergePromptTemplateProjectionRows(draftItems ?? [], serverValue)
    if (mergedDraft) {
      if (snapshotJson(mergedDraft) === snapshotJson(draftItems ?? [])) {
        return { revision, nextDraft: null }
      }
      return { revision, nextDraft: mergedDraft }
    }
    promptItemDirtyFieldsById.clear()
  }
  return { revision, nextDraft: cloneJsonValue(serverValue) }
}

type PromptItemRecord = Record<string, unknown> & { id?: string }

function promptItemAsRecord(item: PromptItem): PromptItemRecord {
  return item as unknown as PromptItemRecord
}

function promptItemIdValue(item: PromptItem): string | null {
  const id = promptItemAsRecord(item).id
  return typeof id === 'string' && id.length > 0 ? id : null
}

function changedPromptItemFields(previousItem: PromptItem, attemptedItem: PromptItem): string[] {
  const previous = promptItemAsRecord(previousItem)
  const attempted = promptItemAsRecord(attemptedItem)
  const changed: string[] = []
  const keys = new Set([...Object.keys(previous), ...Object.keys(attempted)])

  for (const key of keys) {
    if (key === 'id') continue
    if (snapshotJson(previous[key]) !== snapshotJson(attempted[key])) {
      changed.push(key)
    }
  }

  return changed
}

function markDirtyPromptItemFields(itemId: string, previousItem: PromptItem, attemptedItem: PromptItem): void {
  const changedFields = changedPromptItemFields(previousItem, attemptedItem)
  if (changedFields.length === 0) return

  let dirtyFields = promptItemDirtyFieldsById.get(itemId)
  if (!dirtyFields) {
    dirtyFields = new Set()
    promptItemDirtyFieldsById.set(itemId, dirtyFields)
  }

  for (const field of changedFields) {
    dirtyFields.add(field)
  }
}

function clearPromptItemDirtyFields(itemId: string, fields: Iterable<string>): void {
  const dirtyFields = promptItemDirtyFieldsById.get(itemId)
  if (!dirtyFields) return

  for (const field of fields) {
    dirtyFields.delete(field)
  }

  if (dirtyFields.size === 0) {
    promptItemDirtyFieldsById.delete(itemId)
  }
}

function clearDirtyPromptItemFieldsMatchingProjection(draftItems: PromptItem[], serverItems: PromptItem[]): void {
  const draftItemsById = promptItemsById(draftItems)
  const serverItemsById = promptItemsById(serverItems)

  for (const [itemId, dirtyFields] of Array.from(promptItemDirtyFieldsById.entries())) {
    const draftItem = draftItemsById.get(itemId)
    const serverItem = serverItemsById.get(itemId)

    if (!draftItem || !serverItem) {
      promptItemDirtyFieldsById.delete(itemId)
      continue
    }

    const draftRecord = promptItemAsRecord(draftItem)
    const serverRecord = promptItemAsRecord(serverItem)
    for (const field of Array.from(dirtyFields)) {
      if (snapshotJson(draftRecord[field]) === snapshotJson(serverRecord[field])) {
        dirtyFields.delete(field)
      }
    }

    if (dirtyFields.size === 0) {
      promptItemDirtyFieldsById.delete(itemId)
    }
  }
}

function mergePromptTemplateProjectionRows(draftItems: PromptItem[], serverItems: PromptItem[]): PromptItem[] | null {
  if (!samePromptItemIdSequence(draftItems, serverItems)) return null

  const draftItemsById = promptItemsById(draftItems)
  return serverItems.map((serverItem) => {
    const itemId = promptItemIdValue(serverItem)
    const dirtyFields = itemId ? promptItemDirtyFieldsById.get(itemId) : undefined
    const draftItem = itemId ? draftItemsById.get(itemId) : undefined

    if (!itemId || !dirtyFields || dirtyFields.size === 0 || !draftItem) {
      return cloneJsonValue(serverItem)
    }

    return mergeProjectionIntoDirtyDraft({
      draft: cloneJsonValue(promptItemAsRecord(draftItem)),
      projection: promptItemAsRecord(serverItem),
      dirtyFields,
    }) as unknown as PromptItem
  })
}

function samePromptItemIdSequence(leftItems: PromptItem[], rightItems: PromptItem[]): boolean {
  if (leftItems.length !== rightItems.length) return false

  for (let index = 0; index < leftItems.length; index += 1) {
    const leftId = promptItemIdValue(leftItems[index])
    const rightId = promptItemIdValue(rightItems[index])
    if (!leftId || !rightId || leftId !== rightId) return false
  }

  return true
}

function findPromptItemIndexById(items: PromptItem[], itemId: string | null): number {
  if (!itemId) return -1
  return items.findIndex((item) => promptItemIdValue(item) === itemId)
}

function promptItemIdList(items: PromptItem[]): string[] | null {
  const itemIds: string[] = []
  const seen = new Set<string>()

  for (const item of items) {
    const itemId = promptItemIdValue(item)
    if (!itemId || seen.has(itemId)) return null
    seen.add(itemId)
    itemIds.push(itemId)
  }

  return itemIds
}

function stringArraysEqual(left: readonly string[] | null, right: readonly string[] | null): boolean {
  if (!left || !right || left.length !== right.length) return false
  return left.every((value, index) => value === right[index])
}

function promptItemsById(items: PromptItem[]): Map<string, PromptItem> {
  const itemsById = new Map<string, PromptItem>()
  for (const item of items) {
    const itemId = promptItemIdValue(item)
    if (itemId) itemsById.set(itemId, item)
  }
  return itemsById
}

function applyPromptTemplateCollectionRollback(binding: PromptTemplateDraftBinding, nextItems: PromptItem[]): void {
  binding.setItems(nextItems)
  withTrustedServerProjectionWrite(() => {
    DBState.db.promptTemplate = cloneJsonValue(nextItems)
  })
}
