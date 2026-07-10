import type { SettingItem, SettingContext } from './types'
import { DBState } from '../stores.svelte'
import { language } from 'src/lang'
import { accessibilitySettingsItems } from './accessibilitySettingsData'
import { advancedSettingsItems } from './advancedSettingsData'
import {
  basicParameterItems,
  modelSpecificParameterItems,
  penaltyParameterItems,
  samplingParameterItems,
  seedSetting,
} from './botSettingsParamsData'
import { chatFormatSettingsItems } from './chatFormatSettingsData'
import { displaySettingsItems } from './displaySettingsData.svelte'
import {
  canUseServerCommands,
  patchServerBackedSettings,
  settingsGroupForKey,
  type ServerCommandTransportOptions,
} from '../server/commands'
import { withTrustedServerProjectionWrite } from '../server/projectionWriteGuard.svelte'
import { registerPendingBridgePatchFlusher } from '../server/pendingBridgeFlushRegistry'
import {
  currentTopLevelPresetFieldMirrorValue,
  mirrorTopLevelPresetField,
  mirrorTopLevelPresetFieldToTarget,
  resolveTopLevelPresetFieldMirrorTarget,
  type TopLevelPresetFieldMirrorTarget,
} from '../presetFieldMirror'
import {
  currentPromptPresetModelOverrideMirrorValue,
  currentPromptPresetModelOverrideValue,
  mirrorPromptPresetModelOverrideField,
  mirrorPromptPresetModelOverrideFieldToTarget,
  resolvePromptPresetModelOverrideMirrorTarget,
  type PromptPresetModelOverrideMirrorTarget,
} from '../promptPresetModelOverrides.svelte'
import { promptPresetModelOverrideFieldForDatabaseKey } from '../presetSplit'

/**
 * Sentinel value representing an uninitialized local state in wrapper components.
 * Used instead of `undefined` so that a legitimate `undefined` DB value
 * can still be written back without being silently ignored.
 */
export const UNINITIALIZED = Symbol('uninitialized')

export const DEFERRED_SETTING_INPUT_DELAY_MS = 250

export interface DeferredSettingWriteResult {
  ownerKey: string
  queued: boolean
}

interface DeferredServerSettingTarget {
  kind: 'server'
  ownerKey: string
  rootKey: string
}

interface DeferredPresetSettingTarget {
  kind: 'preset'
  ownerKey: string
  rootKey: string
  target: TopLevelPresetFieldMirrorTarget
}

interface DeferredPromptOverrideSettingTarget {
  kind: 'promptOverride'
  ownerKey: string
  rootKey: string
  target: PromptPresetModelOverrideMirrorTarget
}

type DeferredSettingTarget =
  | DeferredServerSettingTarget
  | DeferredPresetSettingTarget
  | DeferredPromptOverrideSettingTarget

interface DeferredSettingEdit {
  path: string[]
  value: unknown
}

interface PendingDeferredSettingWrite {
  desiredRoot: unknown
  edits: Map<string, DeferredSettingEdit>
  previousRoot: unknown
  target: DeferredSettingTarget
  timer: ReturnType<typeof setTimeout>
}

const pendingDeferredSettingWrites = new Map<string, PendingDeferredSettingWrite>()
registerPendingBridgePatchFlusher('setting-renderer-inputs', flushDeferredSettingWrites)

export function getLabel(item: SettingItem): string {
  if (item.labelKey && (language as any)[item.labelKey]) {
    return (language as any)[item.labelKey]
  }
  return item.fallbackLabel ?? ''
}

export function getSettingValue(item: SettingItem, ctx: SettingContext): any {
  const promptOverrideValue = getPromptPresetOverrideSettingValue(item, ctx)
  if (promptOverrideValue.found) return promptOverrideValue.value

  if (item.getValue) {
    return item.getValue(DBState.db, ctx)
  }
  if (item.bindPath) {
    const parts = item.bindPath.split('.')
    let value: any = DBState.db
    for (const part of parts) {
      value = value?.[part]
    }
    return value
  }
  if (item.bindKey) {
    return (DBState.db as any)[item.bindKey]
  }
  return undefined
}

export function setSettingValue(item: SettingItem, newValue: any, ctx: SettingContext): void {
  const previousValue = getSettingValue(item, ctx)
  const commandPatch = buildServerSettingsPatch(item)

  writeLocalSettingValue(item, newValue, ctx)

  const mirroredToPreset = mirrorSettingValueToSelectedPreset(item, newValue, ctx)

  if (commandPatch && !mirroredToPreset) {
    void patchServerBackedSetting(item, commandPatch, newValue, previousValue, ctx)
  }
}

/**
 * Optimistically update a continuous input while delaying its durable command.
 * Writes sharing the same server-owned root and preset owner share one timer,
 * so nested controls cannot race independent whole-root patches.
 */
export function setDeferredSettingValue(
  item: SettingItem,
  newValue: any,
  ctx: SettingContext,
  options: { delayMs?: number } = {},
): DeferredSettingWriteResult {
  const target = resolveDeferredSettingTarget(item, ctx)
  const previousRoot = target ? currentDeferredSettingTargetValue(target) : undefined

  writeLocalSettingValue(item, newValue, ctx)

  if (!target) {
    return { ownerKey: localSettingOwnerKey(item), queued: false }
  }

  return {
    ownerKey: target.ownerKey,
    queued: queueDeferredSettingWrite(
      target,
      previousRoot,
      deferredSettingPath(item),
      newValue,
      options.delayMs ?? DEFERRED_SETTING_INPUT_DELAY_MS,
    ),
  }
}

/** Reapply a dirty control after a projection without scheduling another command. */
export function reassertSettingValue(item: SettingItem, value: any, ctx: SettingContext): void {
  if (snapshotJson(getSettingValue(item, ctx)) === snapshotJson(value)) return
  writeLocalSettingValue(item, cloneJsonValue(value), ctx)
}

export function getSettingWriteOwnerKey(item: SettingItem, ctx: SettingContext): string {
  return resolveDeferredSettingTarget(item, ctx)?.ownerKey ?? localSettingOwnerKey(item)
}

export function flushDeferredSettingWrites(options: ServerCommandTransportOptions = {}): void {
  for (const ownerKey of [...pendingDeferredSettingWrites.keys()]) {
    dispatchDeferredSettingWrite(ownerKey, options)
  }
}

export function clearDeferredSettingWrites(): void {
  for (const pending of pendingDeferredSettingWrites.values()) {
    clearTimeout(pending.timer)
  }
  pendingDeferredSettingWrites.clear()
}

function writeLocalSettingValue(item: SettingItem, newValue: any, ctx: SettingContext): void {
  withTrustedServerProjectionWrite(() => {
    setLocalSettingValue(item, newValue, ctx)
  })

  item.onChange?.(newValue, ctx)
}

function resolveDeferredSettingTarget(item: SettingItem, ctx: SettingContext): DeferredSettingTarget | null {
  const rootKey = settingRootKey(item)
  if (!rootKey) return null

  if (ctx.presetMirrorTarget === 'promptModelOverrides' && promptPresetModelOverrideFieldForDatabaseKey(rootKey)) {
    const target = resolvePromptPresetModelOverrideMirrorTarget(rootKey)
    if (target) {
      return {
        kind: 'promptOverride',
        ownerKey: `promptPreset:${target.presetId}:${target.presetField}`,
        rootKey,
        target,
      }
    }
    return resolveDeferredServerSettingTarget(rootKey)
  }

  const presetTarget = resolveTopLevelPresetFieldMirrorTarget(rootKey)
  if (presetTarget) {
    return {
      kind: 'preset',
      ownerKey: `${presetTarget.kind}Preset:${presetTarget.presetId}:${presetTarget.presetKey}`,
      rootKey,
      target: presetTarget,
    }
  }

  return resolveDeferredServerSettingTarget(rootKey)
}

function resolveDeferredServerSettingTarget(rootKey: string): DeferredServerSettingTarget | null {
  if (!canUseServerCommands() || !settingsGroupForKey(rootKey)) return null
  return { kind: 'server', ownerKey: `settings:${rootKey}`, rootKey }
}

function currentDeferredSettingTargetValue(target: DeferredSettingTarget): unknown {
  if (target.kind === 'server') {
    return cloneJsonValue((DBState.db as unknown as Record<string, unknown>)[target.rootKey])
  }
  if (target.kind === 'promptOverride') {
    return currentPromptPresetModelOverrideMirrorValue(target.target)
  }
  const value = currentTopLevelPresetFieldMirrorValue(target.target)
  return value === undefined
    ? cloneJsonValue((DBState.db as unknown as Record<string, unknown>)[target.rootKey])
    : value
}

function queueDeferredSettingWrite(
  target: DeferredSettingTarget,
  previousRoot: unknown,
  path: string[],
  value: unknown,
  delayMs: number,
): boolean {
  const existing = pendingDeferredSettingWrites.get(target.ownerKey)
  if (existing) clearTimeout(existing.timer)

  const edits = existing?.edits ?? new Map<string, DeferredSettingEdit>()
  const editKey = path.join('\u0000')
  if (path.length === 0) edits.clear()
  edits.set(editKey, { path, value: cloneJsonValue(value) })

  let desiredRoot = cloneJsonValue((DBState.db as unknown as Record<string, unknown>)[target.rootKey])
  for (const edit of edits.values()) {
    desiredRoot = applyDeferredSettingEdit(desiredRoot, edit)
  }

  const baseline = existing?.previousRoot ?? cloneJsonValue(previousRoot)
  if (snapshotJson(desiredRoot) === snapshotJson(baseline)) {
    pendingDeferredSettingWrites.delete(target.ownerKey)
    return false
  }

  const pending: PendingDeferredSettingWrite = {
    desiredRoot: cloneJsonValue(desiredRoot),
    edits,
    previousRoot: baseline,
    target,
    timer: setTimeout(() => dispatchDeferredSettingWrite(target.ownerKey), delayMs),
  }
  pendingDeferredSettingWrites.set(target.ownerKey, pending)
  return true
}

function applyDeferredSettingEdit(root: unknown, edit: DeferredSettingEdit): unknown {
  if (edit.path.length === 0) return cloneJsonValue(edit.value)

  const nextRoot = root && typeof root === 'object' ? cloneJsonValue(root) : {}
  let target = nextRoot as Record<string, unknown>
  for (const part of edit.path.slice(0, -1)) {
    const child = target[part]
    target[part] = child && typeof child === 'object' ? child : {}
    target = target[part] as Record<string, unknown>
  }
  target[edit.path[edit.path.length - 1]] = cloneJsonValue(edit.value)
  return nextRoot
}

function dispatchDeferredSettingWrite(ownerKey: string, options: ServerCommandTransportOptions = {}): void {
  const pending = pendingDeferredSettingWrites.get(ownerKey)
  if (!pending) return
  clearTimeout(pending.timer)
  pendingDeferredSettingWrites.delete(ownerKey)

  const attemptedRoot = cloneJsonValue(pending.desiredRoot)
  if (pending.target.kind === 'preset') {
    mirrorTopLevelPresetFieldToTarget(pending.target.target, attemptedRoot)
    return
  }
  if (pending.target.kind === 'promptOverride') {
    mirrorPromptPresetModelOverrideFieldToTarget(pending.target.target, attemptedRoot)
    return
  }
  const serverTarget = pending.target
  if (attemptedRoot === undefined) {
    rollbackDeferredServerSetting(serverTarget, attemptedRoot, pending.previousRoot, pending.edits)
    return
  }

  void patchServerBackedSettings({
    patch: { [serverTarget.rootKey]: attemptedRoot },
    keepalive: options.keepalive,
    signal: options.signal,
    rollback: () => rollbackDeferredServerSetting(serverTarget, attemptedRoot, pending.previousRoot, pending.edits),
  })
}

function rollbackDeferredServerSetting(
  target: DeferredServerSettingTarget,
  attemptedRoot: unknown,
  previousRoot: unknown,
  edits: Map<string, DeferredSettingEdit>,
): void {
  const currentRoot = (DBState.db as unknown as Record<string, unknown>)[target.rootKey]
  let restoredRoot = cloneJsonValue(currentRoot)
  let changed = false

  for (const edit of edits.values()) {
    const currentValue = valueAtDeferredSettingPath(currentRoot, edit.path)
    const attemptedValue = valueAtDeferredSettingPath(attemptedRoot, edit.path)
    if (snapshotJson(currentValue) !== snapshotJson(attemptedValue)) continue
    const previousValue = valueAtDeferredSettingPath(previousRoot, edit.path)
    restoredRoot = applyDeferredSettingEdit(restoredRoot, { path: edit.path, value: previousValue })
    changed = true
  }

  if (!changed) return
  withTrustedServerProjectionWrite(() => {
    ;(DBState.db as unknown as Record<string, unknown>)[target.rootKey] = restoredRoot
  })
}

function valueAtDeferredSettingPath(root: unknown, path: string[]): unknown {
  let value = root
  for (const part of path) {
    if (!value || typeof value !== 'object') return undefined
    value = (value as Record<string, unknown>)[part]
  }
  return value
}

function settingRootKey(item: SettingItem): string | null {
  if (item.bindPath) return item.bindPath.split('.')[0] ?? null
  const key = item.bindKey ?? serverPatchKeyForItem(item)
  return key ? String(key) : null
}

function deferredSettingPath(item: SettingItem): string[] {
  return item.bindPath ? item.bindPath.split('.').slice(1) : []
}

function localSettingOwnerKey(item: SettingItem): string {
  return `local:${item.id}`
}

function mirrorSettingValueToSelectedPreset(item: SettingItem, newValue: unknown, ctx: SettingContext): boolean {
  const promptOverrideMirror = mirrorPromptPresetOverrideSettingValue(item, newValue, ctx)
  if (promptOverrideMirror !== null) return promptOverrideMirror

  if (item.bindPath) {
    const key = item.bindPath.split('.')[0]
    return mirrorTopLevelPresetField(key, cloneJsonValue((DBState.db as any)[key]))
  }

  const key = item.bindKey ?? serverPatchKeyForItem(item)
  if (!key) return false
  return mirrorTopLevelPresetField(String(key), newValue)
}

function getPromptPresetOverrideSettingValue(
  item: SettingItem,
  ctx: SettingContext,
): { found: true; value: unknown } | { found: false } {
  if (ctx.presetMirrorTarget !== 'promptModelOverrides') return { found: false }

  if (item.bindPath) {
    const parts = item.bindPath.split('.')
    const rootKey = parts[0]
    if (!promptPresetModelOverrideFieldForDatabaseKey(rootKey)) return { found: false }
    let value: any = currentPromptPresetModelOverrideValue(rootKey, (DBState.db as any)[rootKey])
    for (const part of parts.slice(1)) {
      value = value?.[part]
    }
    return { found: true, value }
  }

  const key = item.bindKey ?? serverPatchKeyForItem(item)
  if (!key || !promptPresetModelOverrideFieldForDatabaseKey(String(key))) return { found: false }
  return {
    found: true,
    value: currentPromptPresetModelOverrideValue(String(key), (DBState.db as any)[key]),
  }
}

function mirrorPromptPresetOverrideSettingValue(
  item: SettingItem,
  newValue: unknown,
  ctx: SettingContext,
): boolean | null {
  if (ctx.presetMirrorTarget !== 'promptModelOverrides') return null
  if (!item.bindPath && !item.bindKey && !serverPatchKeyForItem(item)) return null

  if (item.bindPath) {
    const rootKey = item.bindPath.split('.')[0]
    if (!promptPresetModelOverrideFieldForDatabaseKey(rootKey)) return null
    return mirrorPromptPresetModelOverrideField(rootKey, cloneJsonValue((DBState.db as any)[rootKey]))
  }

  const key = item.bindKey ?? serverPatchKeyForItem(item)
  if (!key || !promptPresetModelOverrideFieldForDatabaseKey(String(key))) return null
  return mirrorPromptPresetModelOverrideField(String(key), newValue)
}

function setLocalSettingValue(item: SettingItem, newValue: any, ctx: SettingContext): void {
  if (item.setValue) {
    item.setValue(DBState.db, newValue, ctx)
  } else if (item.bindPath) {
    const parts = item.bindPath.split('.')
    let obj: any = DBState.db
    for (let i = 0; i < parts.length - 1; i++) {
      obj = obj[parts[i]] ??= {}
    }
    obj[parts[parts.length - 1]] = newValue
  } else if (item.bindKey) {
    ;(DBState.db as any)[item.bindKey] = newValue
  }
}

function buildServerSettingsPatch(item: SettingItem): { key: string; valueFromDb: () => unknown } | null {
  if (!canUseServerCommands()) return null

  if (item.bindPath) {
    const rootKey = item.bindPath.split('.')[0]
    const group = settingsGroupForKey(rootKey)
    if (!group) return null
    return {
      key: rootKey,
      valueFromDb: () => cloneJsonValue((DBState.db as any)[rootKey]),
    }
  }

  const key = item.bindKey ?? serverPatchKeyForItem(item)
  if (!key) return null
  const group = settingsGroupForKey(String(key))
  if (!group) return null

  return {
    key: String(key),
    valueFromDb: () => cloneJsonValue((DBState.db as any)[key]),
  }
}

async function patchServerBackedSetting(
  item: SettingItem,
  commandPatch: { key: string; valueFromDb: () => unknown },
  newValue: unknown,
  previousValue: unknown,
  ctx: SettingContext,
): Promise<void> {
  const patch = { [commandPatch.key]: commandPatch.valueFromDb() }
  if (patch[commandPatch.key] === undefined) {
    rollbackLocalSetting(item, newValue, previousValue, ctx)
    return
  }

  await patchServerBackedSettings({
    patch,
    rollback: () => rollbackLocalSetting(item, newValue, previousValue, ctx),
  })
}

function rollbackLocalSetting(
  item: SettingItem,
  attemptedValue: unknown,
  previousValue: unknown,
  ctx: SettingContext,
): void {
  if (getSettingValue(item, ctx) !== attemptedValue) return
  withTrustedServerProjectionWrite(() => {
    setLocalSettingValue(item, previousValue, ctx)
  })
}

function serverPatchKeyForItem(item: SettingItem): string | null {
  if (item.id.startsWith('display.customQuotes')) return 'customQuotesData'
  return null
}

function cloneJsonValue<T>(value: T): T {
  if (value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}

function snapshotJson(value: unknown): string {
  const snapshot = JSON.stringify(value)
  return snapshot === undefined ? '__undefined__' : snapshot
}

/**
 * Check if item should be visible based on condition
 */
export function checkCondition(item: SettingItem, ctx: SettingContext): boolean {
  if (!item.condition) return true
  return item.condition(ctx)
}

export function getFullSettingsData(searchTerm = '') {
  const full = accessibilitySettingsItems.concat(
    advancedSettingsItems,
    basicParameterItems,
    seedSetting,
    samplingParameterItems,
    penaltyParameterItems,
    modelSpecificParameterItems,
    chatFormatSettingsItems,
    displaySettingsItems,
  )

  if (!searchTerm) return full

  const lowerSearch = searchTerm.toLowerCase()
  return full.filter((item) => {
    const label = getLabel(item).toLowerCase()
    const keywords = item.keywords?.map((k) => k.toLowerCase()) || []
    return label.includes(lowerSearch) || keywords.some((k) => k.includes(lowerSearch))
  })
}
