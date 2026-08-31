import { language } from '../../lang'
import { alertSelect } from '../alert'
import { collectionsResourceState, settingsResourceState } from '../server/resourceState.svelte'
import { persistServerBackedSettingsPatch } from '../server/settingsBridge.svelte'
import type { Database } from '../storage/database.svelte'
import { hypaV3PresetIndexFromStableId } from '@risuai/shared-core/hypa-v3-preset-selection-identity'

export type RetiredMemoryAlgorithm = 'SupaMemory' | 'Legacy HypaMemory' | 'Hypa V2' | 'Hanurai' | 'Experimental Hypa V3'

const queuedNoticeDatabases = new WeakSet<object>()

interface LegacyMemoryNoticeOwner {
  database: Partial<Database>
  identity: object
}

function legacyMemoryNoticeOwner(): LegacyMemoryNoticeOwner | undefined {
  const memoryStatus = settingsResourceState.groupStatuses.memory ?? 'idle'
  const presetStatus = collectionsResourceState.statuses.hypaV3Presets ?? 'idle'
  if (
    settingsResourceState.status === 'error' ||
    collectionsResourceState.status === 'error' ||
    memoryStatus === 'error' ||
    presetStatus === 'error'
  ) {
    return undefined
  }

  if (memoryStatus !== 'ready' || presetStatus !== 'ready') return undefined

  const memorySettings = settingsResourceState.value as Partial<Database>
  const hypaV3Presets = collectionsResourceState.values.hypaV3Presets
  if (!memorySettings || !Array.isArray(hypaV3Presets)) return undefined

  return {
    identity: memorySettings,
    database: {
      memoryAlgorithmType: memorySettings.memoryAlgorithmType,
      supaModelType: memorySettings.supaModelType,
      hypaMemory: memorySettings.hypaMemory,
      hypav2: memorySettings.hypav2,
      hanuraiEnable: memorySettings.hanuraiEnable,
      legacyMemoryMigrationNoticeDismissed: memorySettings.legacyMemoryMigrationNoticeDismissed,
      hypaV3: memorySettings.hypaV3,
      selectedHypaV3PresetId: memorySettings.selectedHypaV3PresetId,
      hypaV3Presets,
    },
  }
}

export function detectActiveRetiredMemoryAlgorithms(
  database: Partial<Database>,
  options: { allowLegacyNumericSelection?: boolean } = {},
): RetiredMemoryAlgorithm[] {
  const retired: RetiredMemoryAlgorithm[] = []
  const algorithm = database.memoryAlgorithmType
  const hypaV3Presets = Array.isArray(database.hypaV3Presets) ? database.hypaV3Presets : []
  const selectedPresetIndex = options.allowLegacyNumericSelection
    ? Number.isInteger(database.hypaV3PresetId)
      ? (database.hypaV3PresetId as number)
      : -1
    : hypaV3PresetIndexFromStableId({
        selectedHypaV3PresetId: database.selectedHypaV3PresetId,
        hypaV3Presets,
      })
  const selectedPreset = selectedPresetIndex >= 0 ? hypaV3Presets[selectedPresetIndex] : undefined
  const v3Active = database.hypaV3 === true || algorithm === 'hypaMemoryV3'

  if (v3Active) {
    const experimentalSelected = selectedPreset?.settings?.useExperimentalImpl === true
    if (experimentalSelected) {
      retired.push('Experimental Hypa V3')
    }
    return retired
  }

  let selected: 'supa' | 'hypav2' | 'hanurai' | 'none'
  if (algorithm === 'hypaMemoryV2') selected = 'hypav2'
  else if (algorithm === 'supaMemory') selected = 'supa'
  else if (algorithm === 'hanuraiMemory') selected = 'hanurai'
  else if (database.hypav2 === true) selected = 'hypav2'
  else if (typeof database.supaModelType === 'string' && database.supaModelType !== 'none') selected = 'supa'
  else if (database.hanuraiEnable === true) selected = 'hanurai'
  else selected = 'none'

  if (selected === 'supa') {
    retired.push('SupaMemory')
    if (database.hypaMemory === true) retired.push('Legacy HypaMemory')
  } else if (selected === 'hypav2') {
    retired.push('Hypa V2')
  } else if (selected === 'hanurai') {
    retired.push('Hanurai')
  }
  return retired
}

/** Queue a non-blocking, once-per-database notice after resource hydration. */
export function showLegacyMemoryMigrationNoticeIfNeeded(): boolean {
  const owner = legacyMemoryNoticeOwner()
  if (!owner) return false
  const { database, identity } = owner
  if (database.legacyMemoryMigrationNoticeDismissed === true || queuedNoticeDatabases.has(identity)) return false
  const retired = detectActiveRetiredMemoryAlgorithms(database)
  if (retired.length === 0) return false

  queuedNoticeDatabases.add(identity)
  void alertSelect([language.dismissNotice], language.legacyMemoryMigrationNotice(retired.join(', '))).then(() =>
    persistServerBackedSettingsPatch({ legacyMemoryMigrationNoticeDismissed: true }),
  )
  return true
}
