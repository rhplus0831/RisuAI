import type { PromptItem } from '../process/prompt'
import {
  canUseServerCommands,
  patchPromptSettingsCommand,
  peekCachedServerCommandRevision,
  runServerCommand,
  updatePromptItemCommand,
  type PromptItemSnapshot,
  type ServerCommandResult,
  type ServerCommandTransportOptions,
  type SettingsPatch,
} from './commands'
import { withTrustedResourceWrite } from './resourceWriteGuard.svelte'
import { currentPromptTemplateOwnerId, isPromptTemplateHydrated } from './promptTemplateHydration'
import { getResourceDatabase as getDatabase } from './resourceState.svelte'
import { mergeProjectionIntoDirtyDraft } from './staleStateGuards'

/**
 * Prompt-template editor projection helpers.
 *
 * The prompt-template editor keeps a local `promptTemplate` draft and mirrors
 * edits into resource-backed state (`getDatabase().promptTemplate`). These
 * helpers avoid two per-keystroke costs:
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
  ownerId: string | null
  binding: PromptTemplateDraftBinding
  itemId: string
  attemptedItem: PromptItem
}

export interface FailedPromptTemplateItemDeleteRollback {
  ownerId: string | null
  binding: PromptTemplateDraftBinding
  itemId: string
  previousIndex: number
  previousItem: PromptItem
}

export interface FailedPromptTemplateItemReorderRollback {
  ownerId: string | null
  binding: PromptTemplateDraftBinding
  previousItemIds: string[]
  attemptedItemIds: string[]
}

interface PendingPromptItemUpdate {
  ownerId: string | null
  itemId: string
  previousItem: PromptItem
  attemptedItem: PromptItem
  binding: PromptTemplateDraftBinding
  timer: ReturnType<typeof setTimeout> | null
}

interface SparsePromptItemUpdate {
  patch: PromptItemSnapshot
  deleteKeys: string[]
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
const promptItemDirtyFieldsByOwnerAndId = new Map<string, Set<string>>()

/**
 * Mirror one edited prompt item into resource-backed state in place, without
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
  withTrustedResourceWrite(() => {
    const template = getDatabase().promptTemplate
    if (!Array.isArray(template)) {
      getDatabase().promptTemplate = cloneJsonValue(draftItems)
      return
    }
    const index = template.findIndex((item) => item.id === itemId)
    if (index === -1) {
      getDatabase().promptTemplate = cloneJsonValue(draftItems)
      return
    }
    template[index] = snapshot
  })
  return snapshot
}

/**
 * Restore a single prompt item in resource-backed state in place (failed-command
 * rollback), leaving every other item untouched. The former rollback re-cloned
 * the whole `promptTemplate` array.
 */
export function restorePromptItemProjectionWrite(itemId: string, previousItem: PromptItem): void {
  withTrustedResourceWrite(() => {
    const template = getDatabase().promptTemplate
    if (!Array.isArray(template)) return
    const index = template.findIndex((item) => item.id === itemId)
    if (index !== -1) template[index] = cloneJsonValue(previousItem)
  })
}

export function promptTemplateOwnerCommandId(ownerId: string | null): string | undefined {
  return ownerId ?? undefined
}

export function isCurrentPromptTemplateOwner(ownerId: string | null): boolean {
  return currentPromptTemplateOwnerId() === ownerId
}

export async function runPromptTemplateOwnerCommand<T extends Record<string, unknown> = {}>(
  ownerId: string | null,
  command: () => Promise<ServerCommandResult<T>>,
): Promise<ServerCommandResult<T>> {
  if (!isCurrentPromptTemplateOwner(ownerId)) return { status: 'unavailable' }
  return command()
}

export function runPromptTemplateOwnerRollback(ownerId: string | null, rollback: () => void): void {
  if (!isCurrentPromptTemplateOwner(ownerId)) return
  rollback()
}

export function rollbackFailedPromptTemplateItemCreate(input: FailedPromptTemplateItemCreateRollback): void {
  if (!isCurrentPromptTemplateOwner(input.ownerId)) return
  const liveItems = input.binding.getItems() ?? []
  const liveIndex = findPromptItemIndexById(liveItems, input.itemId)
  if (liveIndex === -1) return
  if (snapshotJson(liveItems[liveIndex]) !== snapshotJson(input.attemptedItem)) return

  const nextItems = [...liveItems]
  nextItems.splice(liveIndex, 1)
  applyPromptTemplateCollectionRollback(input.binding, nextItems)
  promptItemDirtyFieldsByOwnerAndId.delete(promptItemStateKey(input.ownerId, input.itemId))
}

export function rollbackFailedPromptTemplateItemDelete(input: FailedPromptTemplateItemDeleteRollback): void {
  if (!isCurrentPromptTemplateOwner(input.ownerId)) return
  const liveItems = input.binding.getItems() ?? []
  if (findPromptItemIndexById(liveItems, input.itemId) !== -1) return

  const insertIndex = Math.max(0, Math.min(input.previousIndex, liveItems.length))
  const nextItems = [...liveItems]
  nextItems.splice(insertIndex, 0, cloneJsonValue(input.previousItem))
  applyPromptTemplateCollectionRollback(input.binding, nextItems)
}

export function rollbackFailedPromptTemplateItemReorder(input: FailedPromptTemplateItemReorderRollback): void {
  if (!isCurrentPromptTemplateOwner(input.ownerId)) return
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
  promptPresetId: string | null = currentPromptTemplateOwnerId(),
): void {
  if (!isPromptTemplateHydrated(promptPresetId)) return
  const attemptedItem = applyPromptItemProjectionWrite(binding.getItems(), itemId)
  if (!attemptedItem) return
  markDirtyPromptItemFields(promptPresetId, itemId, previousItem, attemptedItem)
  if (!canUseServerCommands()) return

  const pendingKey = promptItemStateKey(promptPresetId, itemId)
  const existing = pendingPromptItemUpdates.get(pendingKey)
  if (existing?.timer) clearTimeout(existing.timer)
  const pending: PendingPromptItemUpdate = {
    ownerId: promptPresetId,
    itemId,
    previousItem: cloneJsonValue(existing?.previousItem ?? previousItem),
    attemptedItem,
    binding,
    timer: null,
  }
  pending.timer = setTimeout(() => runPendingPromptItemUpdate(pendingKey), delayMs)
  pendingPromptItemUpdates.set(pendingKey, pending)
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

export function dropPendingPromptSettingsProjectionPatchKeys(keys: readonly string[]): void {
  let dropped = false
  for (const key of keys) {
    if (
      key in pendingPromptSettingsPatch.patch ||
      key in pendingPromptSettingsPatch.previous ||
      key in pendingPromptSettingsPatch.attempted
    ) {
      dropped = true
    }
    delete pendingPromptSettingsPatch.patch[key]
    delete pendingPromptSettingsPatch.previous[key]
    delete pendingPromptSettingsPatch.attempted[key]
  }

  if (dropped && pendingPromptSettingsPatch.timer && Object.keys(pendingPromptSettingsPatch.patch).length === 0) {
    clearTimeout(pendingPromptSettingsPatch.timer)
    pendingPromptSettingsPatch.timer = null
  }
}

export function replacePendingPromptSettingsProjectionPatchValue(key: string, value: unknown): void {
  if (!(key in pendingPromptSettingsPatch.patch)) return

  if (snapshotJson(value) === snapshotJson(pendingPromptSettingsPatch.previous[key])) {
    dropPendingPromptSettingsProjectionPatchKeys([key])
    return
  }

  pendingPromptSettingsPatch.patch[key] = value
  pendingPromptSettingsPatch.attempted[key] = value
}

export function flushPendingPromptTemplatePatches(options: ServerCommandTransportOptions = {}): void {
  for (const pendingKey of Array.from(pendingPromptItemUpdates.keys())) {
    runPendingPromptItemUpdate(pendingKey, options)
  }
  runPendingPromptSettingsPatch(options)
}

export function resetPromptTemplateSelectionDirtyState(): void {
  for (const pending of pendingPromptItemUpdates.values()) {
    if (pending.timer) clearTimeout(pending.timer)
  }
  pendingPromptItemUpdates.clear()
  promptItemDirtyFieldsByOwnerAndId.clear()
}

function runPendingPromptItemUpdate(pendingKey: string, options: ServerCommandTransportOptions = {}): void {
  const pending = pendingPromptItemUpdates.get(pendingKey)
  if (!pending) return
  if (pending.timer) clearTimeout(pending.timer)
  pendingPromptItemUpdates.delete(pendingKey)

  if (!isCurrentPromptTemplateOwner(pending.ownerId)) {
    promptItemDirtyFieldsByOwnerAndId.delete(pendingKey)
    return
  }

  const sparseUpdate = sparsePromptItemUpdate(pending.previousItem, pending.attemptedItem)
  if (!sparseUpdate) return

  void runServerCommand({
    command: (baseRevision) =>
      updatePromptItemCommand(
        {
          baseRevision,
          ...(pending.ownerId ? { promptPresetId: pending.ownerId } : {}),
          itemId: pending.itemId,
          patch: sparseUpdate.patch,
          ...(sparseUpdate.deleteKeys.length > 0 ? { deleteKeys: sparseUpdate.deleteKeys } : {}),
        },
        options.signal,
        options.keepalive,
      ),
    rollback: () => {
      if (!isCurrentPromptTemplateOwner(pending.ownerId)) {
        promptItemDirtyFieldsByOwnerAndId.delete(pendingKey)
        return
      }
      rollbackPendingPromptItemUpdate(
        pending.binding,
        pending.ownerId,
        pending.itemId,
        pending.previousItem,
        pending.attemptedItem,
      )
    },
    signal: options.signal,
    keepalive: options.keepalive,
  }).then((result) => {
    if (result.status !== 'ok') return
    clearDirtyPromptItemFieldsMatchingProjection(
      pending.ownerId,
      pending.binding.getItems(),
      (getDatabase().promptTemplate ?? []) as PromptItem[],
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
  ownerId: string | null,
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
  clearPromptItemDirtyFields(ownerId, itemId, changedPromptItemFields(previousItem, attemptedItem))
}

function rollbackPromptSettingsPatch(previous: SettingsPatch, attempted: SettingsPatch): void {
  withTrustedResourceWrite(() => {
    const target = getDatabase() as unknown as Record<string, unknown>
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
 * Decide whether the prompt-template draft should be re-pulled from server
 * resource state. The cached command revision is the discriminator: a keystroke's
 * optimistic write never advances it, so reconciliation only runs after a real
 * server push / command response. The whole-template stringify only happens on
 * such a revision advance, never per keystroke.
 *
 * Reads `getDatabase().promptTemplate` first so a caller `$effect` registers the
 * resource-state dependency and re-runs on a server push.
 */
export function reconcilePromptTemplateDraft(
  draftItems: PromptItem[],
  previousRevision: number | null,
  projectedItems: PromptItem[] = (getDatabase().promptTemplate ?? []) as PromptItem[],
): PromptTemplateReconcileResult {
  const ownerId = currentPromptTemplateOwnerId()
  if (!isPromptTemplateHydrated(ownerId)) {
    return { revision: previousRevision, nextDraft: null }
  }
  const serverValue = projectedItems
  const revision = peekCachedServerCommandRevision()
  if (revision === previousRevision) return { revision, nextDraft: null }
  if (ownerDirtyFieldCount(ownerId) > 0) {
    clearDirtyPromptItemFieldsMatchingProjection(ownerId, draftItems ?? [], serverValue)
  }
  if (snapshotJson(serverValue) === snapshotJson(draftItems ?? [])) {
    return { revision, nextDraft: null }
  }
  if (ownerDirtyFieldCount(ownerId) > 0) {
    const mergedDraft = mergePromptTemplateProjectionRows(ownerId, draftItems ?? [], serverValue)
    if (mergedDraft) {
      if (snapshotJson(mergedDraft) === snapshotJson(draftItems ?? [])) {
        return { revision, nextDraft: null }
      }
      return { revision, nextDraft: mergedDraft }
    }
    clearOwnerDirtyFields(ownerId)
  }
  return { revision, nextDraft: cloneJsonValue(serverValue) }
}

function promptItemStateKey(ownerId: string | null, itemId: string): string {
  return `${ownerId ?? '__legacy__'}:${itemId}`
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

function sparsePromptItemUpdate(previousItem: PromptItem, attemptedItem: PromptItem): SparsePromptItemUpdate | null {
  const previous = promptItemAsRecord(previousItem)
  const attempted = promptItemAsRecord(attemptedItem)
  const patch: PromptItemSnapshot = {}
  const deleteKeys: string[] = []
  const keys = new Set([...Object.keys(previous), ...Object.keys(attempted)])

  for (const key of keys) {
    if (key === 'id') continue
    const previousHasKey = Object.prototype.hasOwnProperty.call(previous, key)
    const attemptedHasKey = Object.prototype.hasOwnProperty.call(attempted, key)
    if (!attemptedHasKey || attempted[key] === undefined) {
      if (previousHasKey) deleteKeys.push(key)
      continue
    }
    if (!previousHasKey || snapshotJson(previous[key]) !== snapshotJson(attempted[key])) {
      patch[key] = cloneJsonValue(attempted[key])
    }
  }

  return Object.keys(patch).length > 0 || deleteKeys.length > 0 ? { patch, deleteKeys } : null
}

function markDirtyPromptItemFields(
  ownerId: string | null,
  itemId: string,
  previousItem: PromptItem,
  attemptedItem: PromptItem,
): void {
  const changedFields = changedPromptItemFields(previousItem, attemptedItem)
  if (changedFields.length === 0) return

  const dirtyKey = promptItemStateKey(ownerId, itemId)
  let dirtyFields = promptItemDirtyFieldsByOwnerAndId.get(dirtyKey)
  if (!dirtyFields) {
    dirtyFields = new Set()
    promptItemDirtyFieldsByOwnerAndId.set(dirtyKey, dirtyFields)
  }

  for (const field of changedFields) {
    dirtyFields.add(field)
  }
}

function clearPromptItemDirtyFields(ownerId: string | null, itemId: string, fields: Iterable<string>): void {
  const dirtyKey = promptItemStateKey(ownerId, itemId)
  const dirtyFields = promptItemDirtyFieldsByOwnerAndId.get(dirtyKey)
  if (!dirtyFields) return

  for (const field of fields) {
    dirtyFields.delete(field)
  }

  if (dirtyFields.size === 0) {
    promptItemDirtyFieldsByOwnerAndId.delete(dirtyKey)
  }
}

function clearDirtyPromptItemFieldsMatchingProjection(
  ownerId: string | null,
  draftItems: PromptItem[],
  serverItems: PromptItem[],
): void {
  const draftItemsById = promptItemsById(draftItems)
  const serverItemsById = promptItemsById(serverItems)

  for (const [dirtyKey, dirtyFields] of Array.from(promptItemDirtyFieldsByOwnerAndId.entries())) {
    const itemId = itemIdFromPromptItemStateKey(ownerId, dirtyKey)
    if (!itemId) continue
    const draftItem = draftItemsById.get(itemId)
    const serverItem = serverItemsById.get(itemId)

    if (!draftItem || !serverItem) {
      promptItemDirtyFieldsByOwnerAndId.delete(dirtyKey)
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
      promptItemDirtyFieldsByOwnerAndId.delete(dirtyKey)
    }
  }
}

function mergePromptTemplateProjectionRows(
  ownerId: string | null,
  draftItems: PromptItem[],
  serverItems: PromptItem[],
): PromptItem[] | null {
  if (!samePromptItemIdSequence(draftItems, serverItems)) return null

  const draftItemsById = promptItemsById(draftItems)
  return serverItems.map((serverItem) => {
    const itemId = promptItemIdValue(serverItem)
    const dirtyFields = itemId ? promptItemDirtyFieldsByOwnerAndId.get(promptItemStateKey(ownerId, itemId)) : undefined
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

function itemIdFromPromptItemStateKey(ownerId: string | null, dirtyKey: string): string | null {
  const prefix = `${ownerId ?? '__legacy__'}:`
  return dirtyKey.startsWith(prefix) ? dirtyKey.slice(prefix.length) : null
}

function ownerDirtyFieldCount(ownerId: string | null): number {
  const prefix = `${ownerId ?? '__legacy__'}:`
  let count = 0
  for (const [dirtyKey, dirtyFields] of promptItemDirtyFieldsByOwnerAndId.entries()) {
    if (dirtyKey.startsWith(prefix)) count += dirtyFields.size
  }
  return count
}

function clearOwnerDirtyFields(ownerId: string | null): void {
  const prefix = `${ownerId ?? '__legacy__'}:`
  for (const dirtyKey of Array.from(promptItemDirtyFieldsByOwnerAndId.keys())) {
    if (dirtyKey.startsWith(prefix)) promptItemDirtyFieldsByOwnerAndId.delete(dirtyKey)
  }
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
  withTrustedResourceWrite(() => {
    getDatabase().promptTemplate = cloneJsonValue(nextItems)
  })
}
