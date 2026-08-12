import { language } from '../../lang'
import { alertSelect } from '../alert'
import { getResourceDatabase as getDatabase } from '../server/resourceState.svelte'
import { persistServerBackedSettingsPatch } from '../server/settingsBridge.svelte'
import type { Database } from '../storage/database.svelte'

export type RetiredMemoryAlgorithm = 'SupaMemory' | 'Legacy HypaMemory' | 'Hypa V2' | 'Hanurai' | 'Experimental Hypa V3'

const queuedNoticeDatabases = new WeakSet<object>()

export function detectActiveRetiredMemoryAlgorithms(database: Partial<Database>): RetiredMemoryAlgorithm[] {
  const retired: RetiredMemoryAlgorithm[] = []
  const algorithm = database.memoryAlgorithmType
  const selectedPreset = Array.isArray(database.hypaV3Presets)
    ? database.hypaV3Presets[database.hypaV3PresetId ?? 0]
    : undefined
  const v3Active = database.hypaV3 === true || algorithm === 'hypaMemoryV3'

  if (v3Active) {
    const experimentalSelected = selectedPreset
      ? selectedPreset.settings?.useExperimentalImpl === true
      : database.hypaV3Settings?.useExperimentalImpl === true
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
  const database = getDatabase()
  if (database.legacyMemoryMigrationNoticeDismissed === true || queuedNoticeDatabases.has(database)) return false
  const retired = detectActiveRetiredMemoryAlgorithms(database)
  if (retired.length === 0) return false

  queuedNoticeDatabases.add(database)
  void alertSelect([language.dismissNotice], language.legacyMemoryMigrationNotice(retired.join(', '))).then(() =>
    persistServerBackedSettingsPatch({ legacyMemoryMigrationNoticeDismissed: true }),
  )
  return true
}
