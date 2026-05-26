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
  getServerCommandBaseRevision,
  patchSettingsGroup,
  settingsGroupForKey,
  type SettingsGroup,
} from '../server/commands'
import { withTrustedServerProjectionWrite } from '../server/projectionWriteGuard.svelte'

/**
 * Sentinel value representing an uninitialized local state in wrapper components.
 * Used instead of `undefined` so that a legitimate `undefined` DB value
 * can still be written back without being silently ignored.
 */
export const UNINITIALIZED = Symbol('uninitialized')

export function getLabel(item: SettingItem): string {
  if (item.labelKey && (language as any)[item.labelKey]) {
    return (language as any)[item.labelKey]
  }
  return item.fallbackLabel ?? ''
}

export function getSettingValue(item: SettingItem, ctx: SettingContext): any {
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

  withTrustedServerProjectionWrite(() => {
    setLocalSettingValue(item, newValue, ctx)
  })

  if (item.onChange) {
    item.onChange(newValue, ctx)
  }

  if (commandPatch) {
    void patchServerBackedSetting(item, commandPatch, newValue, previousValue, ctx)
  }
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

function buildServerSettingsPatch(
  item: SettingItem,
): { group: SettingsGroup; key: string; valueFromDb: () => unknown } | null {
  if (!canUseServerCommands()) return null

  if (item.bindPath) {
    const rootKey = item.bindPath.split('.')[0]
    const group = settingsGroupForKey(rootKey)
    if (!group) return null
    return {
      group,
      key: rootKey,
      valueFromDb: () => cloneJsonValue((DBState.db as any)[rootKey]),
    }
  }

  const key = item.bindKey ?? serverPatchKeyForItem(item)
  if (!key) return null
  const group = settingsGroupForKey(String(key))
  if (!group) return null

  return {
    group,
    key: String(key),
    valueFromDb: () => cloneJsonValue((DBState.db as any)[key]),
  }
}

async function patchServerBackedSetting(
  item: SettingItem,
  commandPatch: { group: SettingsGroup; key: string; valueFromDb: () => unknown },
  newValue: unknown,
  previousValue: unknown,
  ctx: SettingContext,
): Promise<void> {
  const baseRevision = await getServerCommandBaseRevision()
  if (baseRevision === null) {
    rollbackLocalSetting(item, newValue, previousValue, ctx)
    return
  }

  const patch = { [commandPatch.key]: commandPatch.valueFromDb() }
  if (patch[commandPatch.key] === undefined) return

  let result = await patchSettingsGroup({
    group: commandPatch.group,
    baseRevision,
    patch,
  })

  if (result.status === 'conflict') {
    result = await patchSettingsGroup({
      group: commandPatch.group,
      baseRevision: result.currentRevision,
      patch,
    })
  }

  if (result.status !== 'ok') {
    rollbackLocalSetting(item, newValue, previousValue, ctx)
  }
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
