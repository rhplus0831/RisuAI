import { get } from 'svelte/store'
import { checkNullish, decryptBuffer, encryptBuffer, selectSingleFile } from '../util'
import { changeLanguage, language } from '../../lang'
import type { RisuPlugin } from '../plugins/plugins.svelte'
import type { triggerscript as triggerscriptMain } from '../process/triggers'
import { downloadFile, saveAsset as saveImageGlobal } from '../globalApi.svelte'
import { defaultAutoSuggestPrompt, defaultJailbreak, defaultMainPrompt } from './defaultPrompts'
import { alertNormal } from '../alert'
import type { NAISettings } from '../process/models/nai'
import { prebuiltNAIpresets, prebuiltPresets } from '../process/templates/templates'
import { defaultColorScheme, type ColorScheme } from '../gui/colorscheme'
import type { PromptItem, PromptSettings } from '../process/prompt'
import type { OobaChatCompletionRequestParams } from '../model/ooba'
import {
  createDefaultModelRoleOverrides,
  normalizeLegacyFallbackModels,
  normalizeLegacySeperateModels,
  normalizeModelRoleOverrides,
  type LegacyFallbackModelMap,
  type LegacySeperateModelMap,
  type NormalizedModelRoleOverrides,
} from '../model/modelRoles'
import {
  normalizeModelRuntimeDefaults,
  normalizeModelProfiles,
  normalizeModelRoleProfiles,
  type ModelProfileRecord,
  type ModelProfileRecordRuntimeOptions,
  type ModelRoleProfileMap,
} from '../model/modelProfileRecords'
import { type HypaV3Settings, type HypaV3Preset, createHypaV3Preset } from '../process/memory/hypav3'
import { normalizeTranslatorPresetState, type TranslatorPreset } from '../translator/presets'
import { safeStructuredClone } from '../polyfill'
import {
  canUseServerCommands,
  createModelPresetCommand,
  createPromptPresetCommand,
  copyPresetCommand,
  createPresetCommand,
  deleteModelPresetCommand,
  deletePromptPresetCommand,
  deletePresetCommand,
  extractLegacyBotPresetCommand,
  importPromptPresetCommand,
  reorderModelPresetsCommand,
  reorderPromptPresetsCommand,
  reorderPresetsCommand,
  runServerCommand,
  selectModelPresetCommand,
  selectPromptPresetCommand,
  selectPresetCommand,
  updateModelPresetCommand,
  updatePromptPresetCommand,
  updatePresetCommand,
  type ModelPresetSnapshot,
  peekCachedServerCommandRevision,
  type PromptPresetSnapshot,
  type PresetSnapshot,
} from '../server/commands'
import { currentCharacterRowSnapshot, dispatchCompatibleCharacterUpdateScoped } from '../characterCommands'
import {
  currentChatScopedSnapshot,
  dispatchCompatibleChatUpdateScoped,
  runOptimisticCommandSequence,
} from '../chatCommands'
import {
  createReadOnlyServerProjection,
  isServerProjectionWriteGuardEnabled,
  setServerProjectionWriteGuardEnabled,
  withServerProjectionApply,
  withTrustedServerProjectionWrite,
} from '../server/projectionWriteGuard.svelte'
import { applyAttemptedFieldRollback, applyAttemptedKeyedListRollback } from '../server/staleStateGuards'
import { isServerChatMessagePlaceholder, SERVER_UNLOADED_CHAT_MESSAGE_MARKER } from '../server/chatMessagePlaceholders'
import { DEFAULT_CHAT_DISPLAY_TAIL_COUNT, normalizeChatDisplayTailCount } from '../chatDisplayTailCount'
import type { ChatGenerationSettings } from '../chatGenerationSettings'
import {
  normalizeChatGenerationTogglePresets,
  type ChatGenerationTogglePreset,
} from '../chatGenerationTogglePresetRecords'
import { canUseServerProjection, fetchServerPresetProjection } from '../server/projection'
import {
  createExtractedModelPreset,
  createExtractedPromptPreset,
  databaseKeyForModelPresetField,
  findEquivalentModelPreset,
  MODEL_PRESET_FIELDS,
  PROMPT_PRESET_FIELDS,
  PROMPT_PRESET_MODEL_OTHERS_OVERRIDE_FIELDS,
  PROMPT_PRESET_MODEL_PARAMETER_OVERRIDE_FIELDS,
  promptPresetExportPayload,
  promptPresetOverridesModelParameters,
  resolvePromptPresetRegexField,
} from '../presetSplit'

//APP_VERSION_POINT is to locate the app version in the database file for version bumping
export let appVer = 'Fastify Variant Version: Alpha' //<APP_VERSION_POINT>
export let webAppSubVer = ''

function createClientPresetId() {
  return crypto.randomUUID()
}

function createClientPromptItemId() {
  return crypto.randomUUID()
}

export function normalizePromptTemplateIds(data: Pick<Database, 'promptTemplate'>) {
  if (!Array.isArray(data.promptTemplate)) return

  const seen = new Set<string>()
  for (const item of data.promptTemplate) {
    if (!item || typeof item !== 'object') continue
    const id = typeof item.id === 'string' && item.id.trim() ? item.id : createClientPromptItemId()
    item.id = seen.has(id) ? createClientPromptItemId() : id
    seen.add(item.id)
  }
}

export function promptTemplateIdsNeedNormalization(data: Pick<Database, 'promptTemplate'>) {
  if (!Array.isArray(data.promptTemplate)) return false

  const seen = new Set<string>()
  for (const item of data.promptTemplate) {
    if (!item || typeof item !== 'object') continue
    const id = typeof item.id === 'string' && item.id.trim() ? item.id : null
    if (!id || seen.has(id)) return true
    seen.add(id)
  }

  return false
}

function normalizeModelRoleSettings(data: Partial<Pick<Database, 'modelRoles' | 'seperateModels'>>): void {
  data.modelRoles = normalizeModelRoleOverrides(data.modelRoles)
  data.seperateModels = normalizeLegacySeperateModels(data.seperateModels)
}

function normalizeModelProfileSettings(
  data: Partial<Pick<Database, 'modelProfiles' | 'modelRoleProfiles' | 'modelRuntimeDefaults'>>,
): void {
  data.modelProfiles = normalizeModelProfiles(data.modelProfiles)
  data.modelRoleProfiles = normalizeModelRoleProfiles(data.modelRoleProfiles)
  data.modelRuntimeDefaults = normalizeModelRuntimeDefaults(data.modelRuntimeDefaults)
}

function normalizeSeperateParameters(data: Partial<Pick<Database, 'seperateParameters'>>): void {
  const source: Record<string, unknown> = isPlainRecord(data.seperateParameters) ? data.seperateParameters : {}
  data.seperateParameters = {
    memory: normalizeSeperateParameterSlot(source.memory),
    emotion: normalizeSeperateParameterSlot(source.emotion),
    translate: normalizeSeperateParameterSlot(source.translate),
    otherAx: normalizeSeperateParameterSlot(source.otherAx),
    scriptMain: normalizeSeperateParameterSlot(source.scriptMain),
    scriptAux: normalizeSeperateParameterSlot(source.scriptAux),
    overrides: isPlainRecord(source.overrides) ? (source.overrides as Record<string, SeparateParameters>) : {},
  }
}

function normalizeSeperateParameterSlot(value: unknown): SeparateParameters {
  return isPlainRecord(value) ? (value as SeparateParameters) : {}
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeBotPresetIds(data: Pick<Database, 'botPresets' | 'botPresetsId'>) {
  if (!Array.isArray(data.botPresets)) {
    data.botPresets = []
  }

  const seen = new Set<string>()
  for (const preset of data.botPresets) {
    if (!preset) continue
    const id = typeof preset.id === 'string' && preset.id.trim() ? preset.id : createClientPresetId()
    const nextId = seen.has(id) ? createClientPresetId() : id
    if (preset.id !== nextId) {
      preset.id = nextId
    }
    seen.add(nextId)
  }

  const nextSelected = normalizedBotPresetsId(data.botPresets.length, data.botPresetsId)
  if (data.botPresetsId !== nextSelected) {
    data.botPresetsId = nextSelected
  }
}

function normalizeSplitPresetIds(
  data: Pick<Database, 'modelPresets' | 'modelPresetsId' | 'promptPresets' | 'promptPresetsId'>,
) {
  normalizePresetCollectionIds(data.modelPresets, (next) => {
    data.modelPresets = next as ModelPreset[]
  })
  data.modelPresetsId = normalizedBotPresetsId(data.modelPresets.length, data.modelPresetsId)
  normalizePresetCollectionIds(data.promptPresets, (next) => {
    data.promptPresets = next as PromptPreset[]
  })
  data.promptPresetsId = normalizedBotPresetsId(data.promptPresets.length, data.promptPresetsId)
}

function normalizePresetCollectionIds<T extends { id?: string }>(presets: T[], assign: (next: T[]) => void) {
  if (!Array.isArray(presets)) {
    assign([])
    return
  }

  const seen = new Set<string>()
  for (const preset of presets) {
    if (!preset) continue
    const id = typeof preset.id === 'string' && preset.id.trim() ? preset.id : createClientPresetId()
    const nextId = seen.has(id) ? createClientPresetId() : id
    if (preset.id !== nextId) {
      preset.id = nextId
    }
    seen.add(nextId)
  }
}

export function botPresetIdsNeedNormalization(data: Pick<Database, 'botPresets' | 'botPresetsId'>) {
  if (!Array.isArray(data.botPresets)) return true

  const seen = new Set<string>()
  for (const preset of data.botPresets) {
    if (!preset) continue
    const id = typeof preset.id === 'string' && preset.id.trim() ? preset.id : null
    if (!id || seen.has(id)) return true
    seen.add(id)
  }

  return data.botPresetsId !== normalizedBotPresetsId(data.botPresets.length, data.botPresetsId)
}

function normalizedBotPresetsId(presetCount: number, selected: unknown): number {
  if (!Number.isInteger(selected)) return presetCount > 0 ? 0 : -1

  const index = selected as number
  if (index >= presetCount) return presetCount > 0 ? presetCount - 1 : -1
  if (index < -1) return presetCount > 0 ? 0 : -1
  return index
}

function presetIdAt(index: number): string | null {
  const presets = DBState.db.botPresets
  if (!Number.isInteger(index) || index < 0 || !Array.isArray(presets) || index >= presets.length) {
    return null
  }

  const seen = new Set<string>()
  for (const preset of presets) {
    const id = typeof preset?.id === 'string' && preset.id.trim() ? preset.id : null
    if (!id || seen.has(id)) return null
    seen.add(id)
  }

  return presets[index]?.id ?? null
}

const BOT_PRESET_HYDRATION_SENTINEL_KEYS = [
  'apiType',
  'mainPrompt',
  'jailbreak',
  'globalNote',
  'temperature',
  'modelProfiles',
  'modelRoleProfiles',
  'modelRuntimeDefaults',
  'promptTemplate',
] as const

export function botPresetHasHydratedSettings(preset: botPreset | undefined): preset is botPreset {
  if (!preset?.id) return false
  return BOT_PRESET_HYDRATION_SENTINEL_KEYS.some((key) => Object.prototype.hasOwnProperty.call(preset, key))
}

function presetNeedsHydration(preset: botPreset | undefined): boolean {
  return !!preset?.id && !botPresetHasHydratedSettings(preset)
}

const presetHydrationInFlight = new Map<string, Promise<boolean>>()

export async function ensureBotPresetHydrated(index: number): Promise<boolean> {
  const presetId = presetIdAt(index)
  if (!presetId) return false

  const preset = DBState.db.botPresets[index]
  if (!presetNeedsHydration(preset)) return true
  if (!canUseServerProjection()) return false

  const current = presetHydrationInFlight.get(presetId)
  if (current) return current

  const baselineRevision = peekCachedServerCommandRevision()
  const request = (async () => {
    const result = await fetchServerPresetProjection(presetId)
    if (result.status !== 'ok') {
      presetHydrationWarning(presetId, result.status === 'error' ? result.error : 'server projection unavailable')
      return false
    }
    if (result.presetId !== presetId) {
      presetHydrationWarning(presetId, `response was for preset ${result.presetId}`)
      return false
    }
    if (
      isOlderThanRevision(result.revision, baselineRevision) ||
      isOlderThanRevision(result.revision, peekCachedServerCommandRevision())
    ) {
      return false
    }
    return withTrustedServerProjectionWrite(() => {
      const currentIndex = DBState.db.botPresets.findIndex((candidate) => candidate?.id === presetId)
      if (currentIndex < 0) return false
      DBState.db.botPresets[currentIndex] = result.preset as unknown as botPreset
      return true
    })
  })().finally(() => {
    if (presetHydrationInFlight.get(presetId) === request) {
      presetHydrationInFlight.delete(presetId)
    }
  })

  presetHydrationInFlight.set(presetId, request)
  return request
}

function isOlderThanRevision(revision: number, comparisonRevision: number | null): boolean {
  return comparisonRevision !== null && revision < comparisonRevision
}

function getHydratedPresetIfReady(index: number): botPreset | undefined {
  const preset = DBState.db.botPresets[index]
  if (!presetNeedsHydration(preset)) return preset
  void ensureBotPresetHydrated(index)
  return undefined
}

function presetHydrationWarning(presetId: string, message: string): void {
  console.warn(`preset ${presetId} hydration failed: ${message}`)
}

const SET_PRESET_ROLLBACK_KEYS = [
  'apiType',
  'localNetworkMode',
  'localNetworkTimeoutSec',
  'mainPrompt',
  'jailbreak',
  'globalNote',
  'temperature',
  'maxContext',
  'maxResponse',
  'frequencyPenalty',
  'PresensePenalty',
  'formatingOrder',
  'aiModel',
  'subModel',
  'modelRoles',
  'modelProfiles',
  'modelRoleProfiles',
  'modelRuntimeDefaults',
  'currentPluginProvider',
  'textgenWebUIStreamURL',
  'textgenWebUIBlockingURL',
  'forceReplaceUrl',
  'promptPreprocess',
  'bias',
  'koboldURL',
  'proxyKey',
  'ooba',
  'ainconfig',
  'openrouterRequestModel',
  'proxyRequestModel',
  'NAIsettings',
  'autoSuggestPrompt',
  'autoSuggestPrefix',
  'autoSuggestClean',
  'promptTemplate',
  'NAIadventure',
  'NAIappendName',
  'localStopStrings',
  'customProxyRequestModel',
  'reverseProxyOobaArgs',
  'top_p',
  'promptSettings',
  'repetition_penalty',
  'min_p',
  'top_a',
  'openrouterProvider',
  'useInstructPrompt',
  'customPromptTemplateToggle',
  'templateDefaultVariables',
  'moduleIntergration',
  'top_k',
  'instructChatTemplate',
  'JinjaTemplate',
  'jsonSchemaEnabled',
  'jsonSchema',
  'strictJsonSchema',
  'extractJson',
  'seperateParametersEnabled',
  'customAPIFormat',
  'systemContentReplacement',
  'systemRoleReplacement',
  'customFlags',
  'enableCustomFlags',
  'presetRegex',
  'reasoningEffort',
  'thinkingTokens',
  'thinkingType',
  'deepseekThinkingType',
  'adaptiveThinkingEffort',
  'deepseekReasoningEffort',
  'outputImageModal',
  'seperateModelsForAxModels',
  'seperateModels',
  'fallbackModels',
  'fallbackWhenBlankResponse',
  'seperateParameters',
  'modelTools',
  'verbosity',
  'dynamicOutput',
] as const satisfies readonly (keyof Database)[]

type SetPresetRollbackKey = (typeof SET_PRESET_ROLLBACK_KEYS)[number]

function snapshotSetPresetSettings(db: Database): Partial<Record<SetPresetRollbackKey, unknown>> {
  const snapshot: Partial<Record<SetPresetRollbackKey, unknown>> = {}
  const dbRecord = db as unknown as Record<SetPresetRollbackKey, unknown>
  for (const key of SET_PRESET_ROLLBACK_KEYS) {
    snapshot[key] = safeStructuredClone(dbRecord[key])
  }
  return snapshot
}

type SplitPresetKind = 'model' | 'prompt'
type SplitPresetRow = ModelPreset | PromptPreset

interface BotPresetListRollbackEntry {
  key: string
  previous: botPreset | null
  attempted: botPreset | null
  previousIndex?: number
}

interface BotPresetFieldRollback {
  presetId: string
  previous: Record<string, unknown>
  attempted: Record<string, unknown>
}

interface BotPresetSelectionRollback {
  previousSelectedId: string | null
  attemptedSelectedId: string | null
  previousSettings?: Partial<Record<SetPresetRollbackKey, unknown>>
  attemptedSettings?: Partial<Record<SetPresetRollbackKey, unknown>>
}

interface SplitPresetListRollbackEntry {
  key: string
  previous: SplitPresetRow | null
  attempted: SplitPresetRow | null
  previousIndex?: number
}

interface SplitPresetSelectionRollback {
  kind: SplitPresetKind
  previousSelectedId: string | null
  attemptedSelectedId: string | null
  previousSettings: Partial<Record<SetPresetRollbackKey, unknown>>
  attemptedSettings: Partial<Record<SetPresetRollbackKey, unknown>>
}

function botPresetIds(list: botPreset[]): string[] {
  return list.map((preset) => preset?.id).filter((id): id is string => typeof id === 'string' && id.length > 0)
}

function currentBotPresetSelectedId(): string | null {
  return botPresetSelectedId(DBState.db)
}

function botPresetSelectedId(db: Database): string | null {
  const selectedIndex = db.botPresetsId
  if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || !Array.isArray(db.botPresets)) return null
  return db.botPresets[selectedIndex]?.id ?? null
}

function restoreBotPresetSelectionToId(presetId: string | null): void {
  const list = DBState.db.botPresets
  const index = presetId ? list.findIndex((preset) => preset?.id === presetId) : -1
  DBState.db.botPresetsId = index >= 0 ? index : normalizedBotPresetsId(list.length, -1)
}

function botPresetFieldRollbackFromPatch(
  presetId: string,
  previousPreset: Record<string, unknown>,
  attemptedPatch: Record<string, unknown>,
  options: { includeRemovedPreviousKeys?: boolean } = {},
): BotPresetFieldRollback {
  const previous: Record<string, unknown> = {}
  const attempted = safeStructuredClone(attemptedPatch)
  const keys = new Set(Object.keys(attempted))
  if (options.includeRemovedPreviousKeys) {
    for (const key of Object.keys(previousPreset)) {
      keys.add(key)
    }
  }

  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(previousPreset, key)) {
      previous[key] = safeStructuredClone(previousPreset[key])
    }
    if (!Object.prototype.hasOwnProperty.call(attempted, key)) {
      attempted[key] = undefined
    }
  }
  return {
    presetId,
    previous,
    attempted,
  }
}

function saveCurrentPresetLocalWithRollback(): {
  savedPreset: botPreset | null
  rollback: BotPresetFieldRollback | null
} {
  const db = DBState.db
  normalizeBotPresetIds(db)
  const previousPreset = db.botPresets[db.botPresetsId] ? safeStructuredClone(db.botPresets[db.botPresetsId]) : null
  const savedPreset = saveCurrentPresetLocal()
  if (!savedPreset?.id || !previousPreset) {
    return { savedPreset, rollback: null }
  }
  return {
    savedPreset,
    rollback: botPresetFieldRollbackFromPatch(
      savedPreset.id,
      previousPreset as unknown as Record<string, unknown>,
      savedPreset as unknown as Record<string, unknown>,
      { includeRemovedPreviousKeys: true },
    ),
  }
}

function rollbackBotPresetListEntry(entry: BotPresetListRollbackEntry): void {
  withTrustedServerProjectionWrite(() => {
    const list = DBState.db.botPresets
    const selectedId = currentBotPresetSelectedId()
    const rolledBack = applyAttemptedKeyedListRollback<botPreset, string>({
      list,
      entries: [entry],
      getKey: (preset) => preset?.id,
    })
    if (rolledBack.length === 0) return

    DBState.db.botPresets = list
    restoreBotPresetSelectionToId(selectedId)
  })
}

function rollbackBotPresetCreate(attemptedPreset: botPreset): void {
  const presetId = attemptedPreset.id
  if (!presetId) return
  rollbackBotPresetListEntry({
    key: presetId,
    previous: null,
    attempted: safeStructuredClone(attemptedPreset),
  })
}

function rollbackBotPresetDelete(previousPreset: botPreset, previousIndex: number): void {
  const presetId = previousPreset.id
  if (!presetId) return
  rollbackBotPresetListEntry({
    key: presetId,
    previous: safeStructuredClone(previousPreset),
    attempted: null,
    previousIndex,
  })
}

function rollbackBotPresetFields(rollback: BotPresetFieldRollback | null): void {
  if (!rollback) return
  withTrustedServerProjectionWrite(() => {
    const index = DBState.db.botPresets.findIndex((preset) => preset?.id === rollback.presetId)
    if (index < 0) return

    const rolledBack = applyAttemptedFieldRollback({
      target: DBState.db.botPresets[index] as unknown as Record<string, unknown>,
      previous: rollback.previous,
      attempted: rollback.attempted,
      deleteMissingPrevious: true,
    })
    if (rolledBack.length > 0) {
      DBState.db.botPresets = DBState.db.botPresets
    }
  })
}

function rollbackBotPresetReorder(previousPresetIds: string[], attemptedPresetIds: string[]): void {
  withTrustedServerProjectionWrite(() => {
    const list = DBState.db.botPresets
    if (!stringArraysEqual(botPresetIds(list), attemptedPresetIds)) return

    const selectedId = currentBotPresetSelectedId()
    const liveRowsById = new Map<string, botPreset>()
    for (const preset of list) {
      if (preset?.id) {
        liveRowsById.set(preset.id, preset)
      }
    }

    const restored = previousPresetIds.map((id) => liveRowsById.get(id))
    if (restored.some((preset) => !preset)) return

    DBState.db.botPresets = restored as botPreset[]
    restoreBotPresetSelectionToId(selectedId)
  })
}

function rollbackBotPresetSelection(rollback: BotPresetSelectionRollback): void {
  withTrustedServerProjectionWrite(() => {
    if (!rollback.attemptedSelectedId) return
    if (currentBotPresetSelectedId() !== rollback.attemptedSelectedId) return

    if (rollback.previousSettings && rollback.attemptedSettings) {
      applyAttemptedFieldRollback({
        target: DBState.db as unknown as Record<string, unknown>,
        previous: rollback.previousSettings as Record<string, unknown>,
        attempted: rollback.attemptedSettings as Record<string, unknown>,
        keys: SET_PRESET_ROLLBACK_KEYS,
      })
    }
    restoreBotPresetSelectionToId(rollback.previousSelectedId)
  })
}

function splitPresetList(kind: SplitPresetKind): SplitPresetRow[] {
  return (kind === 'model' ? DBState.db.modelPresets : DBState.db.promptPresets) as SplitPresetRow[]
}

function assignSplitPresetList(kind: SplitPresetKind, list: SplitPresetRow[]): void {
  if (kind === 'model') {
    DBState.db.modelPresets = list as ModelPreset[]
  } else {
    DBState.db.promptPresets = list as PromptPreset[]
  }
}

function splitPresetIds(list: SplitPresetRow[]): string[] {
  return list.map((preset) => preset?.id).filter((id): id is string => typeof id === 'string' && id.length > 0)
}

function currentSplitPresetSelectedId(kind: SplitPresetKind): string | null {
  return splitPresetSelectedId(DBState.db, kind)
}

function splitPresetSelectedId(db: Database, kind: SplitPresetKind): string | null {
  const list = kind === 'model' ? db.modelPresets : db.promptPresets
  const selectedIndex = kind === 'model' ? db.modelPresetsId : db.promptPresetsId
  if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || !Array.isArray(list)) return null
  return list[selectedIndex]?.id ?? null
}

function setSplitPresetSelectedIndex(kind: SplitPresetKind, index: number): void {
  if (kind === 'model') {
    DBState.db.modelPresetsId = index
  } else {
    DBState.db.promptPresetsId = index
  }
}

function restoreSplitPresetSelectionToId(kind: SplitPresetKind, presetId: string | null): void {
  const list = splitPresetList(kind)
  const index = presetId ? list.findIndex((preset) => preset?.id === presetId) : -1
  setSplitPresetSelectedIndex(kind, index >= 0 ? index : normalizedBotPresetsId(list.length, -1))
}

function rollbackSplitPresetListEntry(kind: SplitPresetKind, entry: SplitPresetListRollbackEntry): void {
  withTrustedServerProjectionWrite(() => {
    const list = splitPresetList(kind)
    const selectedId = currentSplitPresetSelectedId(kind)
    const rolledBack = applyAttemptedKeyedListRollback<SplitPresetRow, string>({
      list,
      entries: [entry],
      getKey: (preset) => preset?.id,
    })
    if (rolledBack.length === 0) return

    assignSplitPresetList(kind, list)
    restoreSplitPresetSelectionToId(kind, selectedId)
  })
}

function rollbackSplitPresetCreate(kind: SplitPresetKind, attemptedPreset: SplitPresetRow): void {
  const presetId = attemptedPreset.id
  if (!presetId) return
  rollbackSplitPresetListEntry(kind, {
    key: presetId,
    previous: null,
    attempted: safeStructuredClone(attemptedPreset),
  })
}

function rollbackSplitPresetDelete(kind: SplitPresetKind, previousPreset: SplitPresetRow, previousIndex: number): void {
  const presetId = previousPreset.id
  if (!presetId) return
  rollbackSplitPresetListEntry(kind, {
    key: presetId,
    previous: safeStructuredClone(previousPreset),
    attempted: null,
    previousIndex,
  })
}

function rollbackSplitPresetReorder(
  kind: SplitPresetKind,
  previousPresetIds: string[],
  attemptedPresetIds: string[],
): void {
  withTrustedServerProjectionWrite(() => {
    const list = splitPresetList(kind)
    if (!stringArraysEqual(splitPresetIds(list), attemptedPresetIds)) return

    const selectedId = currentSplitPresetSelectedId(kind)
    const liveRowsById = new Map<string, SplitPresetRow>()
    for (const preset of list) {
      if (preset?.id) {
        liveRowsById.set(preset.id, preset)
      }
    }

    const restored = previousPresetIds.map((id) => liveRowsById.get(id))
    if (restored.some((preset) => !preset)) return

    assignSplitPresetList(kind, restored as SplitPresetRow[])
    restoreSplitPresetSelectionToId(kind, selectedId)
  })
}

function rollbackSplitPresetSelection(rollback: SplitPresetSelectionRollback): void {
  withTrustedServerProjectionWrite(() => {
    if (!rollback.attemptedSelectedId) return
    if (currentSplitPresetSelectedId(rollback.kind) !== rollback.attemptedSelectedId) return

    applyAttemptedFieldRollback({
      target: DBState.db as unknown as Record<string, unknown>,
      previous: rollback.previousSettings as Record<string, unknown>,
      attempted: rollback.attemptedSettings as Record<string, unknown>,
      keys: SET_PRESET_ROLLBACK_KEYS,
    })
    restoreSplitPresetSelectionToId(rollback.kind, rollback.previousSelectedId)
  })
}

function runPromptPresetSelectionCommand(promptPresetId: string, rollback: () => void): void {
  if (!canUseServerCommands()) return
  void (async () => {
    const stillAttemptedSelection = () => currentSplitPresetSelectedId('prompt') === promptPresetId
    const command = (baseRevision: number) =>
      selectPromptPresetCommand({
        baseRevision,
        promptPresetId,
      })

    try {
      const result = await runServerCommand({ command })
      if (result.status === 'ok') return
      if (result.status === 'conflict' && stillAttemptedSelection()) {
        const retry = await runServerCommand({ command })
        if (retry.status === 'ok') return
      }
    } catch (error) {
      console.error('Prompt preset selection command rejected:', error)
    }
    rollback()
  })()
}

function stringArraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

export function setDatabase(data: Database) {
  if (checkNullish(data.characters)) {
    data.characters = []
  }
  data.characters = data.characters.filter((c) => (c as { type?: string } | null)?.type !== 'group')
  if (checkNullish(data.apiType)) {
    data.apiType = 'gemini-3-flash-preview'
  }
  if (checkNullish(data.openAIKey)) {
    data.openAIKey = ''
  }
  if (checkNullish(data.mainPrompt)) {
    data.mainPrompt = defaultMainPrompt
  }
  if (checkNullish(data.jailbreak)) {
    data.jailbreak = defaultJailbreak
  }
  if (checkNullish(data.globalNote)) {
    data.globalNote = ``
  }
  if (checkNullish(data.temperature)) {
    data.temperature = 80
  }
  if (checkNullish(data.maxContext)) {
    data.maxContext = 4000
  }
  if (checkNullish(data.maxResponse)) {
    data.maxResponse = 500
  }
  if (checkNullish(data.frequencyPenalty)) {
    data.frequencyPenalty = 70
  }
  if (checkNullish(data.PresensePenalty)) {
    data.PresensePenalty = 70
  }
  if (checkNullish(data.aiModel)) {
    data.aiModel = 'gemini-3-flash-preview'
  }
  if (checkNullish(data.jailbreakToggle)) {
    data.jailbreakToggle = false
  }
  if (checkNullish(data.formatingOrder)) {
    data.formatingOrder = [
      'main',
      'description',
      'personaPrompt',
      'chats',
      'lastChat',
      'jailbreak',
      'lorebook',
      'globalNote',
      'authorNote',
    ]
  }
  if (checkNullish(data.loreBookDepth)) {
    data.loreBookDepth = 5
  }
  if (checkNullish(data.loreBookToken)) {
    data.loreBookToken = 800
  }
  if (checkNullish(data.username)) {
    data.username = 'User'
  }
  if (checkNullish(data.userIcon)) {
    data.userIcon = ''
  }
  if (checkNullish(data.userNote)) {
    data.userNote = ''
  }
  if (checkNullish(data.additionalPrompt)) {
    data.additionalPrompt = 'The assistant must act as {{char}}. user is {{user}}.'
  }
  if (checkNullish(data.descriptionPrefix)) {
    data.descriptionPrefix = 'description of {{char}}: '
  }
  if (checkNullish(data.forceReplaceUrl)) {
    data.forceReplaceUrl = ''
  }
  if (checkNullish(data.language)) {
    data.language = 'en'
  }
  if (checkNullish(data.swipe)) {
    data.swipe = true
  }
  if (checkNullish(data.translator)) {
    data.translator = ''
  }
  if (checkNullish(data.translatorMaxResponse)) {
    data.translatorMaxResponse = 1000
  }
  if (checkNullish(data.currentPluginProvider)) {
    data.currentPluginProvider = ''
  }
  if (checkNullish(data.plugins)) {
    data.plugins = []
  }
  if (checkNullish(data.zoomsize)) {
    data.zoomsize = 100
  }
  data.chatDisplayTailCount = normalizeChatDisplayTailCount(
    data.chatDisplayTailCount ?? DEFAULT_CHAT_DISPLAY_TAIL_COUNT,
  )
  if (checkNullish(data.customBackground)) {
    data.customBackground = ''
  }
  if (checkNullish(data.textgenWebUIStreamURL)) {
    data.textgenWebUIStreamURL = 'wss://localhost/api/'
  }
  if (checkNullish(data.textgenWebUIBlockingURL)) {
    data.textgenWebUIBlockingURL = 'https://localhost/api/'
  }
  if (checkNullish(data.autoTranslate)) {
    data.autoTranslate = false
  }
  if (checkNullish(data.fullScreen)) {
    data.fullScreen = false
  }
  if (checkNullish(data.playMessage)) {
    data.playMessage = false
  }
  if (checkNullish(data.iconsize)) {
    data.iconsize = 100
  }
  if (checkNullish(data.theme)) {
    data.theme = 'fastify'
  }
  if (checkNullish(data.subModel)) {
    data.subModel = 'gemini-3-flash-preview'
  }
  normalizeModelRoleSettings(data)
  normalizeModelProfileSettings(data)
  if (checkNullish(data.waifuWidth)) {
    data.waifuWidth = 100
  }
  if (checkNullish(data.waifuWidth2)) {
    data.waifuWidth2 = 100
  }
  if (checkNullish(data.emotionPrompt)) {
    data.emotionPrompt = ''
  }
  if (checkNullish(data.proxyKey)) {
    data.proxyKey = ''
  }
  if (checkNullish(data.botPresets)) {
    data.botPresets = []
  }
  normalizeBotPresetIds(data)
  if (checkNullish(data.botPresetsId)) {
    data.botPresetsId = data.botPresets.length > 0 ? 0 : -1
  }
  if (checkNullish(data.modelPresets) || !Array.isArray(data.modelPresets) || data.modelPresets.length === 0) {
    const defaultModelPreset = safeStructuredClone(presetTemplate) as ModelPreset
    defaultModelPreset.id = 'default-model-preset'
    defaultModelPreset.name = 'Default Model'
    data.modelPresets = [defaultModelPreset]
  }
  if (checkNullish(data.promptPresets) || !Array.isArray(data.promptPresets) || data.promptPresets.length === 0) {
    const defaultPromptPreset = safeStructuredClone(presetTemplate) as PromptPreset
    defaultPromptPreset.id = 'default-prompt-preset'
    defaultPromptPreset.name = 'Default Prompt'
    data.promptPresets = [defaultPromptPreset]
  }
  if (checkNullish(data.modelPresetsId)) {
    data.modelPresetsId = 0
  }
  if (checkNullish(data.promptPresetsId)) {
    data.promptPresetsId = 0
  }
  normalizeSplitPresetIds(data)
  if (checkNullish(data.sdProvider)) {
    data.sdProvider = ''
  }
  if (checkNullish(data.webUiUrl)) {
    data.webUiUrl = 'http://127.0.0.1:7860/'
  }
  if (checkNullish(data.sdSteps)) {
    data.sdSteps = 30
  }
  if (checkNullish(data.sdCFG)) {
    data.sdCFG = 7
  }
  if (checkNullish(data.NAIImgUrl)) {
    data.NAIImgUrl = 'https://image.novelai.net/ai/generate-image'
  }
  if (checkNullish(data.NAIApiKey)) {
    data.NAIApiKey = ''
  }
  if (checkNullish(data.NAIImgModel)) {
    data.NAIImgModel = 'nai-diffusion-4-5-full'
  }
  if (checkNullish(data.NAII2I)) {
    data.NAII2I = false
  }
  if (checkNullish(data.NAIREF)) {
    data.NAIREF = false
  }
  if (checkNullish(data.textTheme)) {
    data.textTheme = 'standard'
  }
  if (checkNullish(data.emotionPrompt2)) {
    data.emotionPrompt2 = ''
  }
  if (checkNullish(data.requestRetrys)) {
    data.requestRetrys = 2
  }
  if (checkNullish(data.useSayNothing)) {
    data.useSayNothing = true
  }
  if (checkNullish(data.bias)) {
    data.bias = []
  }
  if (checkNullish(data.showUnrecommended)) {
    data.showUnrecommended = false
  }
  data.doNotWarnExternalServers ??= false
  if (checkNullish(data.pluginCompatibilityMode)) {
    data.pluginCompatibilityMode = false
  }
  data.complexRegexCompatibilityMode ??= 'strict'
  if (data.complexRegexCompatibilityMode !== 'worker') {
    data.complexRegexCompatibilityMode = 'strict'
  }
  data.complexRegexInputTimeoutMs ??= 10000
  if (typeof data.complexRegexInputTimeoutMs !== 'number' || Number.isNaN(data.complexRegexInputTimeoutMs)) {
    data.complexRegexInputTimeoutMs = 10000
  }
  data.complexRegexOutputTimeoutMs ??= 10000
  if (typeof data.complexRegexOutputTimeoutMs !== 'number' || Number.isNaN(data.complexRegexOutputTimeoutMs)) {
    data.complexRegexOutputTimeoutMs = 10000
  }
  data.complexRegexDisplayTimeoutMs ??= 10000
  if (typeof data.complexRegexDisplayTimeoutMs !== 'number' || Number.isNaN(data.complexRegexDisplayTimeoutMs)) {
    data.complexRegexDisplayTimeoutMs = 10000
  }
  if (checkNullish(data.elevenLabKey)) {
    data.elevenLabKey = ''
  }
  if (checkNullish(data.voicevoxUrl)) {
    data.voicevoxUrl = ''
  }
  if (checkNullish(data.showMemoryLimit)) {
    data.showMemoryLimit = false
  }
  if (checkNullish(data.showFirstMessagePages)) {
    data.showFirstMessagePages = false
  }
  if (checkNullish(data.supaMemoryKey)) {
    data.supaMemoryKey = ''
  }
  if (checkNullish(data.hypaV3Key)) {
    data.hypaV3Key = data.supaMemoryKey ?? ''
  }
  if (checkNullish(data.hypaMemoryKey)) {
    data.hypaMemoryKey = ''
  }
  if (checkNullish(data.voyageApiKey)) {
    data.voyageApiKey = ''
  }
  if (checkNullish(data.askRemoval)) {
    data.askRemoval = true
  }
  if (checkNullish(data.sdConfig)) {
    data.sdConfig = {
      width: 512,
      height: 512,
      sampler_name: 'Euler a',
      script_name: '',
      denoising_strength: 0.7,
      enable_hr: false,
      hr_scale: 1.25,
      hr_upscaler: 'Latent',
    }
  }
  if (checkNullish(data.NAIImgConfig)) {
    data.NAIImgConfig = {
      width: 1024,
      height: 1024,
      sampler: 'k_euler_ancestral',
      noise_schedule: 'karras',
      steps: 28,
      scale: 5,
      cfg_rescale: 0,
      sm: true,
      sm_dyn: false,
      noise: 0.0,
      strength: 0.6,
      image: '',
      base64image: '',
      InfoExtracted: 1,
      //add 4
      autoSmea: false,
      legacy_uc: false,
      use_coords: false,
      v4_prompt: {
        caption: {
          base_caption: '',
          char_captions: [],
        },
        use_coords: false,
        use_order: true,
      },
      v4_negative_prompt: {
        caption: {
          base_caption: '',
          char_captions: [],
        },
        legacy_uc: false,
      },
      variety_plus: false,
      decrisp: false,
      reference_mode: '',
      character_image: '',
      character_base64image: '',
      style_aware: false,
    }
  }
  //add NAI v4 (사용중인 사람용 추가 DB Init)
  if (checkNullish(data.NAIImgConfig.v4_prompt)) {
    data.NAIImgConfig.autoSmea = false
    data.NAIImgConfig.use_coords = false
    data.NAIImgConfig.legacy_uc = false
    data.NAIImgConfig.v4_prompt = {
      caption: {
        base_caption: '',
        char_captions: [],
      },
      use_coords: false,
      use_order: true,
    }
    data.NAIImgConfig.v4_negative_prompt = {
      caption: {
        base_caption: '',
        char_captions: [],
      },
      legacy_uc: false,
    }
  }
  if (checkNullish(data.customTextTheme)) {
    data.customTextTheme = {
      FontColorStandard: '#f8f8f2',
      FontColorBold: '#f8f8f2',
      FontColorItalic: '#8C8D93',
      FontColorItalicBold: '#8C8D93',
      FontColorQuote1: '#8BE9FD',
      FontColorQuote2: '#FFB86C',
    }
  }
  if (checkNullish(data.hordeConfig)) {
    data.hordeConfig = {
      apiKey: '',
      model: '',
      softPrompt: '',
    }
  }
  if (checkNullish(data.novelai)) {
    data.novelai = {
      token: '',
      model: 'clio-v1',
    }
  }
  if (checkNullish(data.loreBook)) {
    data.loreBookPage = 0
    data.loreBook = [
      {
        name: 'My First LoreBook',
        data: [],
      },
    ]
  }
  if (checkNullish(data.loreBookPage) || data.loreBook.length < data.loreBookPage) {
    data.loreBookPage = 0
  }
  data.globalscript ??= []
  data.sendWithEnter ??= true
  data.autoSuggestPrompt ??= defaultAutoSuggestPrompt
  data.autoSuggestPrefix ??= ''
  data.OAIPrediction ??= ''
  data.autoSuggestClean ??= true
  data.imageCompression ??= true
  data.enableBlockPartialEdit ??= false
  data.enableDragPartialEdit ??= false
  if (!data.formatingOrder.includes('personaPrompt')) {
    data.formatingOrder.splice(data.formatingOrder.indexOf('main'), 0, 'personaPrompt')
  }
  data.selectedPersona ??= 0
  data.personaPrompt ??= ''
  data.personas ??= [
    {
      name: data.username,
      personaPrompt: '',
      icon: data.userIcon,
      note: data.userNote,
      largePortrait: false,
    },
  ]
  data.classicMaxWidth ??= false
  data.ooba ??= safeStructuredClone(defaultOoba)
  data.ainconfig ??= safeStructuredClone(defaultAIN)
  data.openrouterKey ??= ''
  data.openrouterRequestModel ??= 'openai/gpt-3.5-turbo'
  data.nanogptKey ??= ''
  data.nanogptRequestModel ??= ''
  data.nanogptRequestModelName ??= ''
  data.nanogptProvider ??= ''
  data.nanogptSubscriptionState ??= ''
  data.nanogptUseSubscriptionEndpoint ??= false
  data.NAIsettings ??= safeStructuredClone(prebuiltNAIpresets)
  data.assetWidth ??= -1
  data.animationSpeed ??= 0.4
  data.colorScheme ??= safeStructuredClone(defaultColorScheme)
  data.colorSchemeName ??= 'default'
  data.NAIsettings.starter ??= ''
  data.hypaModel ??= 'MiniLM'
  data.mancerHeader ??= ''
  data.emotionProcesser ??= 'submodel'
  data.translatorType ??= 'google'
  data.htmlTranslation ??= false
  data.deeplOptions ??= {
    key: '',
    freeApi: false,
  }
  data.deeplXOptions ??= {
    url: '',
    token: '',
  }
  data.NAIadventure ??= false
  data.NAIappendName ??= true
  data.NAIsettings.cfg_scale ??= 1
  data.NAIsettings.mirostat_tau ??= 0
  data.NAIsettings.mirostat_lr ??= 1
  data.autofillRequestUrl ??= true
  data.customProxyRequestModel ??= ''
  data.generationSeed ??= -1
  data.newOAIHandle ??= true
  data.localNetworkMode ??= false
  if (typeof data.localNetworkMode !== 'boolean') {
    data.localNetworkMode = false
  }
  data.localNetworkTimeoutSec ??= 600
  if (typeof data.localNetworkTimeoutSec !== 'number' || Number.isNaN(data.localNetworkTimeoutSec)) {
    data.localNetworkTimeoutSec = 600
  }
  data.gptVisionQuality ??= 'low'
  data.huggingfaceKey ??= ''
  data.fishSpeechKey ??= ''
  data.presetRegex ??= []
  data.reverseProxyOobaArgs ??= {
    mode: 'instruct',
  }
  data.top_p ??= 1
  if (typeof data.top_p !== 'number') {
    // Normalize migrated data that stored top_p as a non-number.
    data.top_p = 1
  }
  //@ts-expect-error data.google has required fields (accessToken, projectId), but we use empty object as default and populate below
  data.google ??= {}
  data.google.accessToken ??= ''
  data.google.projectId ??= ''
  data.genTime ??= 1
  data.promptSettings ??= {
    assistantPrefill: '',
    postEndInnerFormat: '',
    sendChatAsSystem: false,
    sendName: false,
    utilOverride: false,
    customChainOfThought: false,
    maxThoughtTagDepth: -1,
  }
  data.keiServerURL ??= ''
  data.top_k ??= 0
  data.promptSettings.maxThoughtTagDepth ??= -1
  data.openrouterFallback ??= true
  data.openrouterMiddleOut ??= false
  data.removePunctuationHypa ??= true
  data.memoryLimitThickness ??= 1
  data.modules ??= []
  data.enabledModules ??= []
  data.additionalParams ??= []
  data.heightMode ??= 'normal'
  data.antiClaudeOverload ??= false
  data.ollamaURL ??= ''
  data.ollamaModel ??= ''
  data.ollamaModelSource ??= data.aiModel === 'ollama-cloud' || data.subModel === 'ollama-cloud' ? 'cloud' : 'local'
  data.ollamaInputMode ??= 'manual'
  data.ollamaRequestFormat ??= LLMFormat.Ollama
  data.ollamaApiKey ??= ''
  data.ollamaModelName ??= ''
  data.ollamaCloudModel ??= ''
  data.ollamaCloudModelName ??= ''
  data.ollamaThinkingMode ??= 'auto'
  if ((data.aiModel === 'ollama-cloud' || data.subModel === 'ollama-cloud') && !data.ollamaCloudModel) {
    data.ollamaCloudModel = data.ollamaModel
    data.ollamaCloudModelName = data.ollamaModelName
  }
  data.repetition_penalty ??= 1
  data.min_p ??= 0
  data.top_a ??= 0
  data.customTokenizer ??= 'tik'
  data.instructChatTemplate ??= 'chatml'
  // Migration: convert old string type into new provider object
  if (typeof data.openrouterProvider === 'string') {
    const oldProvider = data.openrouterProvider as unknown as string
    data.openrouterProvider = {
      order: oldProvider ? [oldProvider] : [],
      only: [],
      ignore: [],
    }
  }
  if (data.botPresets) {
    for (const preset of data.botPresets) {
      preset.localNetworkMode ??= false
      preset.localNetworkTimeoutSec ??= 600
      if (typeof preset.localNetworkMode !== 'boolean') {
        preset.localNetworkMode = false
      }
      if (typeof preset.localNetworkTimeoutSec !== 'number' || Number.isNaN(preset.localNetworkTimeoutSec)) {
        preset.localNetworkTimeoutSec = 600
      }
      if (typeof preset.openrouterProvider === 'string') {
        const oldProvider = preset.openrouterProvider as unknown as string
        preset.openrouterProvider = {
          order: oldProvider ? [oldProvider] : [],
          only: [],
          ignore: [],
        }
      }
    }
  }
  data.openrouterProvider ??= {
    order: [],
    only: [],
    ignore: [],
  }
  data.useInstructPrompt ??= false
  data.textAreaSize ??= 0
  data.sideBarSize ??= 0
  data.textAreaTextSize ??= 0
  data.combineTranslation ??= false
  data.customPromptTemplateToggle ??= ''
  data.globalChatVariables ??= {}
  data.templateDefaultVariables ??= ''
  data.dallEQuality ??= 'standard'
  data.customTextTheme.FontColorQuote1 ??= '#8BE9FD'
  data.customTextTheme.FontColorQuote2 ??= '#FFB86C'
  data.font ??= 'default'
  data.customFont ??= ''
  data.lineHeight ??= 1.25
  data.stabilityModel ??= 'sd3-large'
  data.stabllityStyle ??= ''
  data.legacyTranslation ??= false
  data.comfyUiUrl ??= 'http://localhost:8188'
  data.comfyConfig ??= {
    workflow: '',
    posNodeID: '',
    posInputName: 'text',
    negNodeID: '',
    negInputName: 'text',
    timeout: 30,
  }
  data.hideApiKey ??= true
  data.unformatQuotes ??= false
  data.ttsAutoSpeech ??= false
  data.translatorInputLanguage ??= 'auto'
  data.falModel ??= 'fal-ai/flux/dev'
  data.falLoraScale ??= 1
  data.customCSS ??= ''
  data.strictJsonSchema ??= true
  data.statics ??= {
    messages: 0,
    imports: 0,
  }
  data.customQuotes ??= false
  data.customQuotesData ??= ['“', '”', '‘', '’']
  data.customGUI ??= ''
  data.guiHTML ??= ''
  data.customAPIFormat ??= LLMFormat.OpenAICompatible
  data.systemContentReplacement ??= `system: {{slot}}`
  data.systemRoleReplacement ??= 'user'
  data.vertexAccessToken ??= ''
  data.vertexAccessTokenExpires ??= 0
  data.vertexClientEmail ??= ''
  data.vertexPrivateKey ??= ''
  data.vertexRegion ??= 'global'
  data.seperateParametersEnabled ??= false
  normalizeSeperateParameters(data)
  data.customFlags ??= []
  data.enableCustomFlags ??= false
  data.assetMaxDifference ??= 4
  data.showSavingIcon ??= false
  data.banCharacterset ??= []
  data.showPromptComparison ??= false
  data.OaiCompAPIKeys ??= {}
  data.reasoningEffort ??= 0
  data.hypaV3Presets ??= [
    createHypaV3Preset('Default', {
      summarizationPrompt: (data as { supaMemoryPrompt?: string }).supaMemoryPrompt ?? '',
      ...data.hypaV3Settings,
    }),
  ]
  if (data.hypaV3Presets.length > 0) {
    data.hypaV3Presets = data.hypaV3Presets.map((preset, i) =>
      createHypaV3Preset(preset.name || `Preset ${i + 1}`, preset.settings || {}),
    )
  }
  data.hypaV3PresetId ??= 0
  normalizeTranslatorPresetState(data)
  data.showDeprecatedTriggerV2 ??= false
  data.returnCSSError ??= true
  data.realmDirectOpen ??= false
  data.checkCorruption ??= false
  data.toggleConfirmRecommendedPreset ??= false
  data.useExperimentalGoogleTranslator ??= false
  data.thinkingType ??= 'budget'
  data.deepseekThinkingType ??= 'off'
  data.adaptiveThinkingEffort ??= 'high'
  data.deepseekReasoningEffort ??= 'high'
  if (data.antiClaudeOverload) {
    // Rename antiClaudeOverload to antiServerOverloads.
    data.antiClaudeOverload = false
    data.antiServerOverloads = true
  }
  data.hypaCustomSettings = {
    url: data.hypaCustomSettings?.url ?? '',
    key: data.hypaCustomSettings?.key ?? '',
    model: data.hypaCustomSettings?.model ?? '',
  }
  data.doNotChangeSeperateModels ??= false
  data.seperateModelsForAxModels ??= false
  normalizeModelRoleSettings(data)
  normalizeModelProfileSettings(data)
  data.modelTools ??= []
  data.enableScrollToActiveChar ??= true

  // Merge existing hotkeys with new default hotkeys
  if (!data.hotkeys) {
    data.hotkeys = safeStructuredClone(defaultHotkeys)
  } else {
    const existingActions = new Set(data.hotkeys.map((h) => h.action))
    const newHotkeys = defaultHotkeys.filter((h) => !existingActions.has(h.action))
    if (newHotkeys.length > 0) {
      data.hotkeys.push(...safeStructuredClone(newHotkeys))
    }
  }

  // Remove scrollToActiveChar hotkey if feature is disabled
  if (data.enableScrollToActiveChar === false) {
    data.hotkeys = data.hotkeys.filter((h) => h.action !== 'scrollToActiveChar')
  }

  data.fallbackModels = normalizeLegacyFallbackModels(data.fallbackModels)
  data.customModels ??= []
  data.authRefreshes ??= []
  data.rememberToolUsage ??= true
  data.simplifiedToolUse ??= false
  data.streamGeminiThoughts ??= false
  data.settingsCloseButtonSize ??= 24
  data.hideAllImages ??= false
  data.ImagenModel ??= 'imagen-4.0-generate-001'
  data.ImagenImageSize ??= '1K'
  data.ImagenAspectRatio ??= '1:1'
  data.ImagenPersonGeneration ??= 'allow_all'
  data.openaiCompatImage ??= {
    url: '',
    key: '',
    model: '',
    size: '1024x1024',
    quality: 'auto',
  }
  data.wavespeedImage ??= {
    key: '',
    model: '',
    loras: [],
    reference_mode: '',
    reference_image: '',
    reference_base64image: '',
  }
  data.autoScrollToNewMessage ??= true
  data.alwaysScrollToNewMessage ??= false
  data.newMessageButtonStyle ??= 'bottom-center'
  data.echoMessage ??= 'Echo Message'
  data.echoDelay ??= 0
  data.createFolderOnBranch ??= true
  data.hamburgerButtonBottom ??= false
  data.dynamicModelRegistry ??= true
  data.saveSignatures ??= false
  // If the user uses plugins, its probably better to enable RisuAI Pro Tools by default
  // Because its likely they are power users who would benefit from the features
  data.enableRisuaiProTools ??= data.plugins.length > 0
  data.keepSessionAlive ??= 'off'
  data.chatGenerationTogglePresets = normalizeChatGenerationTogglePresets(data.chatGenerationTogglePresets)
  data.loadouts ??= []
  data.longPressToPopupEditor ??= false
  data.disableAutoPopupMessageEditor ??= false
  data.customSidebarItems = normalizeCustomSidebarItems(data.customSidebarItems)
  changeLanguage(data.language)
  setDatabaseLite(data)
}

export function applyServerProjectionDatabase(data: Database) {
  return withServerProjectionApply(() => {
    data.customSidebarItems = normalizeCustomSidebarItems(data.customSidebarItems)
    data.chatGenerationTogglePresets = normalizeChatGenerationTogglePresets(data.chatGenerationTogglePresets)
    changeLanguage(data.language)
    setDatabaseLite(data)
  })
}

/**
 * Surgically merges targeted projection fields into the live projection without
 * a full `setDatabase` replace. Used for foreign command events and entity
 * hydration. The fields come from the server projection (same source as
 * bootstrap), so no re-normalization is needed; this must not clobber
 * locally-hydrated entities outside the named keys.
 */
export function mergeServerProjectionFields(fields: Partial<Database>) {
  return withServerProjectionApply(() => {
    const db = DBState.db as unknown as Record<string, unknown>
    for (const [key, value] of Object.entries(fields)) {
      if (key === 'promptTemplate' && value === null) {
        delete db.promptTemplate
        continue
      }
      db[key] =
        key === 'customSidebarItems'
          ? normalizeCustomSidebarItems(value)
          : key === 'chatGenerationTogglePresets'
            ? normalizeChatGenerationTogglePresets(value)
            : value
    }
  })
}

export const SERVER_CHARACTER_SHELL_MARKER = '__serverCharacterShell'

export function isServerCharacterShell(character: unknown): boolean {
  return (
    !!character &&
    typeof character === 'object' &&
    !Array.isArray(character) &&
    (character as Record<string, unknown>)[SERVER_CHARACTER_SHELL_MARKER] === true
  )
}

/**
 * Surgically replace a single character row by `chaId` without touching the rest
 * of the `characters` array. Used for foreign per-character refreshes
 * (`characterRow` events: character field edits, module-link reorders, chat /
 * chat-folder metadata edits). The shipped row is message-free (stubbed chats),
 * so already-hydrated chat messages / globalLore are carried over to avoid
 * dropping loaded history. Returns false if the character is unknown so the
 * caller can fall back to a full bootstrap.
 */
export function mergeServerProjectionCharacterRow(character: { chaId?: string } & Record<string, unknown>): boolean {
  return withServerProjectionApply(() => {
    delete character[SERVER_CHARACTER_SHELL_MARKER]
    const characters = DBState.db.characters
    if (!Array.isArray(characters) || typeof character?.chaId !== 'string') return false
    const index = characters.findIndex((candidate) => candidate?.chaId === character.chaId)
    if (index < 0) return false
    const existing = characters[index] as unknown as Record<string, unknown> | undefined

    // The shipped chats are stubs (empty message[]); carry over any messages
    // this client already hydrated so a metadata refresh keeps loaded history.
    const incomingChats = (character as { chats?: Array<Record<string, unknown>> }).chats
    const existingChats = (existing as { chats?: Array<Record<string, unknown>> } | undefined)?.chats
    if (Array.isArray(incomingChats) && Array.isArray(existingChats)) {
      const existingById = new Map(existingChats.map((chat) => [chat?.id, chat]))
      for (const chat of incomingChats) {
        const prior = existingById.get((chat as { id?: unknown }).id)
        if (!prior) continue
        const priorMessage = (prior as { message?: unknown }).message
        if (Array.isArray(priorMessage) && priorMessage.length > 0) {
          ;(chat as { message?: unknown }).message = priorMessage
        }
        const priorHypa = (prior as { hypaV3Data?: unknown }).hypaV3Data
        if (priorHypa !== undefined) (chat as { hypaV3Data?: unknown }).hypaV3Data = priorHypa
      }
    }
    // Preserve resident globalLore if the shipped row stubbed it (stubs on).
    if (
      (character as { globalLore?: unknown }).globalLore === undefined &&
      existing &&
      (existing as { globalLore?: unknown }).globalLore !== undefined
    ) {
      ;(character as { globalLore?: unknown }).globalLore = (existing as { globalLore?: unknown }).globalLore
    }

    characters[index] = character as unknown as (typeof characters)[number]
    return true
  })
}

export function applyServerCharacterSelectionProjection(input: {
  characterId: string
  currentChar: number
  lastInteraction?: number
}): boolean {
  return withServerProjectionApply(() => {
    const characters = DBState.db.characters
    const liveIndex = Array.isArray(characters)
      ? characters.findIndex((candidate) => candidate?.chaId === input.characterId)
      : -1
    if (liveIndex < 0) return false
    ;(DBState.db as unknown as { currentChar?: number }).currentChar = liveIndex
    const character = characters[liveIndex]
    if (character && input.lastInteraction !== undefined) {
      character.lastInteraction = input.lastInteraction
    }
    selectedCharID.set(liveIndex)
    return true
  })
}

/**
 * Fill a stubbed chat's `message[]` with messages hydrated from the server on
 * chat-open. Targets the chat by id across all characters; a trusted projection
 * write so it passes the read-only guard. Returns true if found and hydrated.
 */
export interface ServerChatMessagesHydrationRange {
  start: number
  total: number
}

export { isServerChatMessagePlaceholder }

function createServerChatMessagePlaceholder(): Message {
  return {
    role: 'char',
    data: '',
    isComment: true,
    disabled: true,
    [SERVER_UNLOADED_CHAT_MESSAGE_MARKER]: true,
  } as Message
}

function createServerChatMessagePlaceholderArray(total: number): Message[] {
  return Array.from({ length: total }, () => createServerChatMessagePlaceholder())
}

export function hydrateServerChatMessages(
  chatId: string,
  message: unknown[],
  hypaV3Data?: unknown,
  range?: ServerChatMessagesHydrationRange,
): boolean {
  return withTrustedServerProjectionWrite(() => {
    for (const character of DBState.db.characters ?? []) {
      const chat = character.chats?.find((candidate) => candidate.id === chatId)
      if (chat) {
        if (range) {
          const total = Math.max(0, Math.floor(range.total))
          const start = Math.min(Math.max(0, Math.floor(range.start)), total)
          const next =
            Array.isArray(chat.message) && chat.message.length === total
              ? chat.message.slice()
              : createServerChatMessagePlaceholderArray(total)
          for (let index = 0; index < message.length && start + index < total; index += 1) {
            next[start + index] = message[index] as Message
          }
          chat.message = next
        } else {
          chat.message = message as Message[]
        }
        // `hypaV3Data` is hydrated alongside messages; undefined means the chat
        // has none, so clear any stale value.
        if (hypaV3Data === undefined) {
          delete (chat as { hypaV3Data?: unknown }).hypaV3Data
        } else {
          chat.hypaV3Data = hypaV3Data as typeof chat.hypaV3Data
        }
        return true
      }
    }
    return false
  })
}

/**
 * Fill a stubbed character's `globalLore` with entries hydrated from the server
 * on character-open. Targets by `chaId`; a trusted projection write so it passes
 * the read-only guard. Returns true if found and hydrated.
 */
export function hydrateServerCharacterLorebook(characterId: string, globalLore: unknown[]): boolean {
  return withTrustedServerProjectionWrite(() => {
    return writeServerCharacterLorebook(characterId, globalLore)
  })
}

/**
 * Apply a foreign command-event `character-lorebook` projection. Unlike
 * user-open hydration, this advances the projection epoch so mounted bridge
 * watchers refresh their baselines instead of echoing the foreign edit.
 */
export function applyServerCharacterLorebookProjection(characterId: string, globalLore: unknown[]): boolean {
  return withServerProjectionApply(() => {
    return writeServerCharacterLorebook(characterId, globalLore)
  })
}

function writeServerCharacterLorebook(characterId: string, globalLore: unknown[]): boolean {
  for (const character of DBState.db.characters ?? []) {
    if (character.chaId === characterId) {
      character.globalLore = globalLore as typeof character.globalLore
      return true
    }
  }
  return false
}

export { isServerProjectionWriteGuardEnabled, setServerProjectionWriteGuardEnabled, withTrustedServerProjectionWrite }

export function setDatabaseLite(data: Database) {
  DBState.db = isServerProjectionWriteGuardEnabled() ? createReadOnlyServerProjection(data) : data
}

interface getDatabaseOptions {
  snapshot?: boolean
}

export function getDatabase(options: getDatabaseOptions = {}): Database {
  if (options.snapshot) {
    return $state.snapshot(DBState.db) as Database
  }
  return DBState.db as Database
}

export function getCurrentCharacter(options: getDatabaseOptions = {}): character {
  const db = getDatabase(options)
  if (!db.characters) {
    db.characters = []
  }
  const char = db.characters?.[get(selectedCharID)]
  return char
}

export function setCurrentCharacter(char: character, options: { dispatchServerCommand?: boolean } = {}) {
  withTrustedServerProjectionWrite(() => {
    const shouldDispatch = options.dispatchServerCommand ?? true
    const index = get(selectedCharID)
    const previousState = shouldDispatch && canUseServerCommands() ? currentCharacterRowSnapshot(index) : null
    const previousCharacter =
      previousState && DBState.db.characters ? $state.snapshot(DBState.db.characters[index]) : undefined

    if (!DBState.db.characters) {
      DBState.db.characters = []
    }
    DBState.db.characters[index] = char
    if (previousState) {
      dispatchCompatibleCharacterUpdateScoped(previousCharacter, char, previousState)
    }
  })
}

export function getCharacterByIndex(index: number, options: getDatabaseOptions = {}): character {
  const db = getDatabase(options)
  if (!db.characters) {
    db.characters = []
  }
  const char = db.characters?.[index]
  return char
}

export function setCharacterByIndex(index: number, char: character) {
  withTrustedServerProjectionWrite(() => {
    const previousState = canUseServerCommands() ? currentCharacterRowSnapshot(index) : null
    const previousCharacter =
      previousState && DBState.db.characters ? $state.snapshot(DBState.db.characters[index]) : undefined

    if (!DBState.db.characters) {
      DBState.db.characters = []
    }
    DBState.db.characters[index] = char
    if (previousState) {
      dispatchCompatibleCharacterUpdateScoped(previousCharacter, char, previousState)
    }
  })
}

export function getCurrentChat() {
  const char = getCurrentCharacter()
  return char?.chats[char.chatPage]
}

export function setCurrentChat(chat: Chat) {
  withTrustedServerProjectionWrite(() => {
    // Replacing the active chat row only mutates that one chat, so the scoped
    // snapshot's single-chat clone serves as both the diff baseline and the
    // rollback — never a deep clone of the whole characters array.
    const previousState = canUseServerCommands() ? currentChatScopedSnapshot() : null
    const char = getCurrentCharacter()
    const previousChat = previousState?.chat
    char.chats[char.chatPage] = chat
    setCurrentCharacter(char, { dispatchServerCommand: false })
    if (previousState) {
      dispatchCompatibleChatUpdateScoped(previousChat, chat, previousState)
    }
  })
}

export interface DynamicOutput {
  autoAdjustSchema: boolean
  dynamicMessages: boolean
  dynamicMemory: boolean
  dynamicResponseTiming: boolean
  dynamicOutputPrompt: boolean
  showTypingEffect: boolean
  dynamicRequest: boolean
}

export interface Database {
  characters: character[]
  apiType: string
  openAIKey: string
  proxyKey: string
  mainPrompt: string
  jailbreak: string
  globalNote: string
  temperature: number
  askRemoval: boolean
  maxContext: number
  maxResponse: number
  frequencyPenalty: number
  PresensePenalty: number
  formatingOrder: FormatingOrderItem[]
  aiModel: string
  modelRoles: NormalizedModelRoleOverrides
  modelProfiles: ModelProfileRecord[]
  modelRoleProfiles: ModelRoleProfileMap
  modelRuntimeDefaults: ModelProfileRecordRuntimeOptions
  jailbreakToggle: boolean
  loreBookDepth: number
  loreBookToken: number
  cipherChat: boolean
  loreBook: {
    name: string
    data: loreBook[]
  }[]
  loreBookPage: number
  username: string
  userIcon: string
  userNote: string
  additionalPrompt: string
  descriptionPrefix: string
  forceReplaceUrl: string
  language: string
  translator: string
  plugins: RisuPlugin[]
  currentPluginProvider: string
  zoomsize: number
  chatDisplayTailCount?: number
  customBackground: string
  textgenWebUIStreamURL: string
  textgenWebUIBlockingURL: string
  autoTranslate: boolean
  fullScreen: boolean
  playMessage: boolean
  iconsize: number
  theme: string
  subModel: string
  emotionPrompt: string
  formatversion: number
  waifuWidth: number
  waifuWidth2: number
  modelPresets: ModelPreset[]
  modelPresetsId: number
  promptPresets: PromptPreset[]
  promptPresetsId: number
  botPresets: botPreset[]
  botPresetsId: number
  sdProvider: string
  webUiUrl: string
  sdSteps: number
  sdCFG: number
  sdConfig: sdConfig
  NAIImgUrl: string
  NAIApiKey: string
  NAIImgModel: string
  NAII2I: boolean
  NAIREF: boolean
  NAIImgConfig: NAIImgConfig
  ttsAutoSpeech?: boolean
  promptPreprocess: boolean
  bias: [string, number][]
  swipe: boolean
  instantRemove: boolean
  textTheme: string
  customTextTheme: {
    FontColorStandard: string
    FontColorBold: string
    FontColorItalic: string
    FontColorItalicBold: string
    FontColorQuote1: string
    FontColorQuote2: string
  }
  requestRetrys: number
  localNetworkMode: boolean
  localNetworkTimeoutSec: number
  emotionPrompt2: string
  useSayNothing: boolean
  didFirstSetup: boolean
  showUnrecommended: boolean
  doNotWarnExternalServers: boolean
  pluginCompatibilityMode: boolean
  complexRegexCompatibilityMode: 'strict' | 'worker'
  complexRegexInputTimeoutMs: number
  complexRegexOutputTimeoutMs: number
  complexRegexDisplayTimeoutMs: number
  elevenLabKey: string
  voicevoxUrl: string
  useExperimental: boolean
  showMemoryLimit: boolean
  roundIcons: boolean
  useStreaming: boolean
  supaMemoryKey: string
  hypaV3Key: string
  hypaMemoryKey: string
  voyageApiKey: string
  textScreenColor?: string
  textBorder?: boolean
  textScreenRounded?: boolean
  textScreenBorder?: string
  characterOrder: (string | folder)[]
  hordeConfig: hordeConfig
  novelai: {
    token: string
    model: string
  }
  globalscript: customscript[]
  sendWithEnter: boolean
  fixedChatTextarea: boolean
  clickToEdit: boolean
  disableAutoPopupMessageEditor: boolean
  enableBlockPartialEdit: boolean
  enableDragPartialEdit: boolean
  koboldURL: string
  useAutoSuggestions: boolean
  autoSuggestPrompt: string
  autoSuggestPrefix: string
  autoSuggestClean: boolean
  claudeAPIKey: string
  useChatCopy: boolean
  novellistAPI: string
  useAutoTranslateInput: boolean
  imageCompression: boolean
  account?: {
    token: string
    id: string
    kei?: boolean
  }
  classicMaxWidth: boolean
  useChatSticker: boolean
  useAdditionalAssetsPreview: boolean
  usePlainFetch: boolean
  proxyRequestModel: string
  ooba: OobaSettings
  ainconfig: AINsettings
  personaPrompt: string
  openrouterRequestModel: string
  openrouterKey: string
  openrouterMiddleOut: boolean
  nanogptKey: string
  nanogptRequestModel: string
  nanogptRequestModelName: string
  nanogptProvider: string
  nanogptSubscriptionState: string
  nanogptUseSubscriptionEndpoint: boolean
  openrouterFallback: boolean
  selectedPersona: number
  personas: {
    personaPrompt: string
    name: string
    icon: string
    largePortrait?: boolean
    id?: string
    note?: string
  }[]
  personaNote: boolean
  assetWidth: number
  animationSpeed: number
  botSettingAtStart: false
  NAIsettings: NAISettings
  hideRealm: boolean
  colorScheme: ColorScheme
  colorSchemeName: string
  promptTemplate?: PromptItem[]
  forceProxyAsOpenAI?: boolean
  hypaModel: HypaModel
  saveTime?: number
  mancerHeader: string
  emotionProcesser: 'submodel' | 'embedding'
  showMenuChatList?: boolean
  translatorType: 'google' | 'deepl' | 'none' | 'llm' | 'deeplX' | 'bergamot'
  translatorInputLanguage?: string
  htmlTranslation?: boolean
  NAIadventure?: boolean
  NAIappendName?: boolean
  deeplOptions: {
    key: string
    freeApi: boolean
  }
  deeplXOptions: {
    url: string
    token: string
  }
  localStopStrings?: string[]
  autofillRequestUrl: boolean
  customProxyRequestModel: string
  generationSeed: number
  newOAIHandle: boolean
  gptVisionQuality: string
  reverseProxyOobaMode: boolean
  reverseProxyOobaArgs: OobaChatCompletionRequestParams
  huggingfaceKey: string
  fishSpeechKey: string
  allowAllExtentionFiles?: boolean
  translatorPrompt: string
  translatorMaxResponse: number
  translatorPresets: TranslatorPreset[]
  translatorPresetId: number
  top_p: number
  google: {
    accessToken: string
    projectId: string
  }
  mistralKey?: string
  chainOfThought?: boolean
  genTime: number
  promptSettings: PromptSettings
  keiServerURL: string
  top_k: number
  repetition_penalty: number
  min_p: number
  top_a: number
  claudeAws: boolean
  lastPatchNoteCheckVersion?: string
  removePunctuationHypa?: boolean
  memoryLimitThickness?: number
  modules: RisuModule[]
  enabledModules: string[]
  sideMenuRerollButton?: boolean
  requestInfoInsideChat?: boolean
  additionalParams: [string, string][]
  heightMode: string
  noWaitForTranslate: boolean
  antiClaudeOverload: boolean
  ollamaURL: string
  ollamaModel: string
  ollamaModelSource: 'local' | 'cloud'
  ollamaInputMode: 'list' | 'manual'
  ollamaRequestFormat: LLMFormat
  ollamaApiKey: string
  ollamaModelName: string
  ollamaCloudModel: string
  ollamaCloudModelName: string
  ollamaThinkingMode: 'auto' | 'off' | 'on' | 'low' | 'medium' | 'high'
  removeIncompleteResponse: boolean
  customTokenizer: string
  instructChatTemplate: string
  JinjaTemplate: string
  openrouterProvider: {
    order: string[]
    only: string[]
    ignore: string[]
  }
  useInstructPrompt: boolean
  textAreaSize: number
  sideBarSize: number
  textAreaTextSize: number
  combineTranslation: boolean
  dynamicAssets: boolean
  dynamicAssetsEditDisplay: boolean
  customPromptTemplateToggle: string
  globalChatVariables: { [key: string]: string }
  templateDefaultVariables: string
  cohereAPIKey: string
  goCharacterOnImport: boolean
  dallEQuality: string
  font: string
  customFont: string
  lineHeight: number
  stabilityModel: string
  stabilityKey: string
  stabllityStyle: string
  legacyTranslation: boolean
  comfyConfig: ComfyConfig
  comfyUiUrl: string
  useLegacyGUI: boolean
  claudeCachingExperimental: boolean
  hideApiKey: boolean
  unformatQuotes: boolean
  enableDevTools: boolean
  falToken: string
  falModel: string
  falLora: string
  falLoraName: string
  falLoraScale: number
  moduleIntergration: string
  customCSS: string
  jsonSchemaEnabled: boolean
  jsonSchema: string
  strictJsonSchema: boolean
  extractJson: string
  statics: {
    messages: number
    imports: number
  }
  customQuotes: boolean
  customQuotesData?: [string, string, string, string]
  customGUI: string
  guiHTML: string
  OAIPrediction: string
  customAPIFormat: LLMFormat
  systemContentReplacement: string
  systemRoleReplacement: 'user' | 'assistant'
  vertexPrivateKey: string
  vertexClientEmail: string
  vertexAccessToken: string
  vertexAccessTokenExpires: number
  vertexRegion: string
  seperateParametersEnabled: boolean
  seperateParameters: {
    memory: SeparateParameters
    emotion: SeparateParameters
    translate: SeparateParameters
    otherAx: SeparateParameters
    scriptMain: SeparateParameters
    scriptAux: SeparateParameters
    overrides: Record<string, SeparateParameters>
  }
  translateBeforeHTMLFormatting: boolean
  autoTranslateCachedOnly: boolean
  notification: boolean
  customFlags: LLMFlags[]
  enableCustomFlags: boolean
  googleClaudeTokenizing: boolean
  presetChain: string
  legacyMediaFindings?: boolean
  geminiStream?: boolean
  assetMaxDifference: number
  auxModelUnderModelSettings: boolean
  menuSideBar: boolean
  pluginV2: RisuPlugin[]
  showSavingIcon: boolean
  presetRegex: customscript[]
  banCharacterset: string[]
  showPromptComparison: boolean
  hypaV3: boolean
  hypaV3Settings: HypaV3Settings // legacy
  hypaV3Presets: HypaV3Preset[]
  hypaV3PresetId: number
  realmDirectOpen: boolean
  OaiCompAPIKeys: { [key: string]: string }
  inlayErrorResponse: boolean
  reasoningEffort: number
  bulkEnabling: boolean
  showTranslationLoading: boolean
  showDeprecatedTriggerV1: boolean
  showDeprecatedTriggerV2: boolean
  returnCSSError: boolean
  checkCorruption?: boolean
  toggleConfirmRecommendedPreset?: boolean
  useExperimentalGoogleTranslator: boolean
  thinkingTokens: number
  thinkingType: 'off' | 'budget' | 'adaptive'
  deepseekThinkingType: 'off' | 'enabled'
  adaptiveThinkingEffort: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  deepseekReasoningEffort: 'high' | 'max'
  antiServerOverloads: boolean
  hypaCustomSettings: {
    url: string
    key: string
    model: string
  }
  localActivationInGlobalLorebook: boolean
  showFolderName: boolean
  automaticCachePoint: boolean
  coldstorage: boolean
  claudeRetrivalCaching: boolean
  outputImageModal: boolean
  playMessageOnTranslateEnd: boolean
  seperateModelsForAxModels: boolean
  seperateModels: LegacySeperateModelMap
  doNotChangeSeperateModels: boolean
  modelTools: string[]
  hotkeys: Hotkey[]
  fallbackModels: LegacyFallbackModelMap
  doNotChangeFallbackModels: boolean
  fallbackWhenBlankResponse: boolean
  customModels: {
    id: string
    internalId: string
    url: string
    format: LLMFormat
    tokenizer: LLMTokenizer
    key: string
    name: string
    params: string
    flags: LLMFlags[]
  }[]
  igpPrompt: string
  useTokenizerCaching: boolean
  showMenuHypaMemoryModal: boolean
  authRefreshes: {
    url: string
    tokenUrl: string
    refreshToken: string
    clientId: string
    clientSecret: string
  }[]
  promptInfoInsideChat: boolean
  promptTextInfoInsideChat: boolean
  claudeBatching: boolean
  claude1HourCaching: boolean
  rememberToolUsage: boolean
  simplifiedToolUse: boolean
  requestLocation: string
  newImageHandlingBeta?: boolean
  showFirstMessagePages: boolean
  streamGeminiThoughts: boolean
  verbosity: number
  dynamicOutput?: DynamicOutput
  hubServerType?: string
  pluginCustomStorage: { [key: string]: any }
  ImagenModel: string
  ImagenImageSize: string
  ImagenAspectRatio: string
  ImagenPersonGeneration: string
  enableScrollToActiveChar: boolean
  openaiCompatImage: {
    url: string
    key: string
    model: string
    size: string
    quality: string
  }
  wavespeedImage: {
    key: string
    model: string
    loras: Array<{ path: string; scale: number }>
    reference_mode: string
    reference_image: string
    reference_base64image: string
  }
  settingsCloseButtonSize: number
  promptDiffPrefs: PromptDiffPrefs
  enableBookmark?: boolean
  hideAllImages?: boolean
  autoScrollToNewMessage?: boolean
  alwaysScrollToNewMessage?: boolean
  newMessageButtonStyle?: string
  pluginDevelopMode?: boolean
  echoMessage?: string
  echoDelay?: number
  /** Enables `globalLore` stubs for non-open characters; hydrate before reading lore. */
  enableLorebookStubs?: boolean
  createFolderOnBranch?: boolean
  hamburgerButtonBottom?: boolean
  enableRemoteSaving?: boolean
  blockquoteStyling?: boolean
  dynamicModelRegistry?: boolean
  enableRisuaiProTools?: boolean
  epEnabled?: boolean
  seperateParametersByModel?: boolean
  disableSeperateParameterChangeOnPresetChange?: boolean
  saveSignatures?: boolean
  keepSessionAlive: 'off' | 'pip' | 'sound'
  longPressToPopupEditor?: boolean
  chatGenerationTogglePresets: ChatGenerationTogglePreset[]
  loadouts: Loadout[]
  disableAprilFools?: boolean
  customSidebarItems: CustomSideBarItem[]
  lastLoadedLoadoutName: string
}

export interface CustomSideBarItem {
  id: string
  type: 'model' | 'databaseKey' | 'loadout' | 'setting'
  subType: string
  label: string
}

const CUSTOM_SIDEBAR_ITEM_TYPES = new Set(['model', 'databaseKey', 'loadout', 'setting'])

function normalizeCustomSidebarItems(value: unknown): CustomSideBarItem[] {
  if (!Array.isArray(value)) return []
  const normalized: CustomSideBarItem[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const record = item as Record<string, unknown>
    if (record.type === 'preset' || record.type === 'persona') continue
    if (
      typeof record.id !== 'string' ||
      typeof record.type !== 'string' ||
      !CUSTOM_SIDEBAR_ITEM_TYPES.has(record.type) ||
      typeof record.subType !== 'string' ||
      typeof record.label !== 'string'
    ) {
      continue
    }
    if (record.type === 'setting' && record.subType.trim() === '') continue
    normalized.push({
      id: record.id,
      type: record.type as CustomSideBarItem['type'],
      subType: record.subType,
      label: record.label,
    })
  }
  return normalized
}

export interface SeparateParameters {
  temperature?: number
  top_k?: number
  repetition_penalty?: number
  min_p?: number
  top_a?: number
  top_p?: number
  frequency_penalty?: number
  presence_penalty?: number
  reasoning_effort?: number
  thinking_tokens?: number
  thinking_type?: 'off' | 'budget' | 'adaptive'
  deepseek_thinking_type?: 'off' | 'enabled'
  adaptive_thinking_effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  deepseek_reasoning_effort?: 'high' | 'max'
  outputImageModal?: boolean
  verbosity?: number
}

type OutputModal = 'image' | 'audio' | 'video'

export interface customscript {
  id?: string
  comment: string
  in: string
  out: string
  type: string
  flag?: string
  ableFlag?: boolean
}

export type triggerscript = triggerscriptMain

export interface loreBook {
  key: string
  secondkey: string
  insertorder: number
  comment: string
  content: string
  mode: 'multiple' | 'constant' | 'normal' | 'child' | 'folder'
  alwaysActive: boolean
  selective: boolean
  extentions?: {
    risu_case_sensitive: boolean
  }
  activationPercent?: number
  loreCache?: {
    key: string
    data: string[]
  }
  useRegex?: boolean
  bookVersion?: number
  id?: string
  folder?: string
}

export interface character {
  type?: 'character'
  name: string
  displayName?: string
  image?: string
  firstMessage: string
  desc: string
  notes: string
  chats: Chat[]
  chatFolders: ChatFolder[]
  chatPage: number
  viewScreen: 'emotion' | 'none' | 'imggen'
  bias: [string, number][]
  emotionImages: [string, string][]
  globalLore: loreBook[]
  chaId: string
  sdData: [string, string][]
  newGenData?: {
    prompt: string
    negative: string
    instructions: string
    emotionInstructions: string
  }
  customscript: customscript[]
  triggerscript: triggerscript[]
  utilityBot: boolean
  exampleMessage: string
  removedQuotes?: boolean
  creatorNotes: string
  systemPrompt: string
  postHistoryInstructions: string
  alternateGreetings: string[]
  tags: string[]
  creator: string
  characterVersion: string
  personality: string
  scenario: string
  firstMsgIndex: number
  loreSettings?: loreSettings
  loreExt?: any
  additionalData?: {
    tag?: string[]
    creator?: string
    character_version?: string
  }
  ttsMode?: string
  ttsSpeech?: string
  voicevoxConfig?: {
    speaker?: string
    SPEED_SCALE?: number
    PITCH_SCALE?: number
    INTONATION_SCALE?: number
    VOLUME_SCALE?: number
  }
  naittsConfig?: {
    customvoice?: boolean
    voice?: string
    version?: string
  }
  gptSoVitsConfig?: {
    url?: string
    use_auto_path?: boolean
    ref_audio_path?: string
    use_long_audio?: boolean
    ref_audio_data?: {
      fileName: string
      assetId: string
    }
    volume?: number
    text_lang?: 'auto' | 'auto_yue' | 'en' | 'zh' | 'ja' | 'yue' | 'ko' | 'all_zh' | 'all_ja' | 'all_yue' | 'all_ko'
    text?: string
    use_prompt?: boolean
    prompt?: string | null
    prompt_lang?: 'auto' | 'auto_yue' | 'en' | 'zh' | 'ja' | 'yue' | 'ko' | 'all_zh' | 'all_ja' | 'all_yue' | 'all_ko'
    top_p?: number
    temperature?: number
    speed?: number
    top_k?: number
    text_split_method?: 'cut0' | 'cut1' | 'cut2' | 'cut3' | 'cut4' | 'cut5'
  }
  fishSpeechConfig?: {
    model?: {
      _id: string
      title: string
      description: string
    }
    chunk_length: number
    normalize: boolean
  }
  supaMemory?: boolean
  additionalAssets?: [string, string, string][]
  ttsReadOnlyQuoted?: boolean
  replaceGlobalNote: string
  backgroundHTML?: string
  reloadKeys?: number
  backgroundCSS?: string
  license?: string
  private?: boolean
  additionalText: string
  oaiVoice?: string
  oaiTTSConfig?: {
    /** User opted into advanced OpenAI-compatible settings. When false/absent,
     *  tts.ts ignores the other fields and uses the legacy oaiVoice + db.openAIKey path. */
    enabled?: boolean
    /** Base URL, trailing slash trimmed at runtime. Falls back to 'https://api.openai.com/v1'. */
    baseURL?: string
    /** Per-character API key. Falls back to db.openAIKey; the Authorization header is omitted entirely when both are empty. */
    apiKey?: string
    /** Model ID. Falls back to 'tts-1'. */
    model?: string
    /** Freeform voice ID for custom endpoints. Falls back to character.oaiVoice, then to 'alloy'. */
    voice?: string
    /** Response format. Falls back to 'mp3'. */
    format?: 'mp3' | 'opus' | 'aac' | 'flac' | 'wav' | 'pcm'
  }
  virtualscript?: string
  scriptstate?: { [key: string]: string | number | boolean }
  depth_prompt?: { depth: number; prompt: string }
  extentions?: { [key: string]: any }
  largePortrait?: boolean
  lorePlus?: boolean
  inlayViewScreen?: boolean
  hfTTS?: {
    model: string
    language: string
  }
  vits?: OnnxModelFiles
  realmId?: string
  imported?: boolean
  trashTime?: number
  nickname?: string
  source?: string[]
  group_only_greetings?: string[]
  creation_date?: number
  modification_date?: number
  ccAssets?: Array<{
    type: string
    uri: string
    name: string
    ext: string
  }>
  defaultVariables?: string
  lowLevelAccess?: boolean
  hideChatIcon?: boolean
  lastInteraction?: number
  translatorNote?: string
  doNotChangeSeperateModels?: boolean
  escapeOutput?: boolean
  prebuiltAssetCommand?: boolean
  prebuiltAssetStyle?: string
  prebuiltAssetExclude?: string[]
  modules?: string[]
  coldstorage?: string
  coldStoragedChats?: string[]
}

export interface loreSettings {
  tokenBudget: number
  scanDepth: number
  recursiveScanning: boolean
  fullWordMatching?: boolean
}

export interface botPreset {
  id?: string
  name?: string
  apiType?: string
  openAIKey?: string
  localNetworkMode?: boolean
  localNetworkTimeoutSec?: number
  additionalParams?: [string, string][]
  mainPrompt: string
  jailbreak: string
  globalNote: string
  temperature: number
  maxContext: number
  maxResponse: number
  frequencyPenalty: number
  PresensePenalty: number
  formatingOrder: FormatingOrderItem[]
  aiModel?: string
  subModel?: string
  modelRoles?: NormalizedModelRoleOverrides
  modelProfiles?: ModelProfileRecord[]
  modelRoleProfiles?: ModelRoleProfileMap
  modelRuntimeDefaults?: ModelProfileRecordRuntimeOptions
  currentPluginProvider?: string
  textgenWebUIStreamURL?: string
  textgenWebUIBlockingURL?: string
  forceReplaceUrl?: string
  forceReplaceUrl2?: string
  promptPreprocess: boolean
  bias: [string, number][]
  proxyRequestModel?: string
  openrouterRequestModel?: string
  proxyKey?: string
  ooba: OobaSettings
  ainconfig: AINsettings
  koboldURL?: string
  NAISettings?: NAISettings
  autoSuggestPrompt?: string
  autoSuggestPrefix?: string
  autoSuggestClean?: boolean
  promptTemplate?: PromptItem[]
  NAIadventure?: boolean
  NAIappendName?: boolean
  localStopStrings?: string[]
  customProxyRequestModel?: string
  reverseProxyOobaArgs?: OobaChatCompletionRequestParams
  top_p?: number
  promptSettings?: PromptSettings
  repetition_penalty?: number
  min_p?: number
  top_a?: number
  openrouterProvider?: {
    order: string[]
    only: string[]
    ignore: string[]
  }
  useInstructPrompt?: boolean
  customPromptTemplateToggle?: string
  templateDefaultVariables?: string
  moduleIntergration?: string
  top_k?: number
  instructChatTemplate?: string
  JinjaTemplate?: string
  jsonSchemaEnabled?: boolean
  jsonSchema?: string
  strictJsonSchema?: boolean
  extractJson?: string
  seperateParametersEnabled?: boolean
  seperateParameters?: {
    memory: SeparateParameters
    emotion: SeparateParameters
    translate: SeparateParameters
    otherAx: SeparateParameters
    scriptMain: SeparateParameters
    scriptAux: SeparateParameters
    overrides: Record<string, SeparateParameters>
  }
  customAPIFormat?: LLMFormat
  systemContentReplacement?: string
  systemRoleReplacement?: 'user' | 'assistant'
  enableCustomFlags?: boolean
  customFlags?: LLMFlags[]
  image?: string
  regex?: customscript[]
  reasonEffort?: number
  thinkingTokens?: number
  thinkingType?: 'off' | 'budget' | 'adaptive'
  deepseekThinkingType?: 'off' | 'enabled'
  adaptiveThinkingEffort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  deepseekReasoningEffort?: 'high' | 'max'
  outputImageModal?: boolean
  seperateModelsForAxModels?: boolean
  seperateModels?: LegacySeperateModelMap
  modelTools?: string[]
  fallbackModels?: LegacyFallbackModelMap
  fallbackWhenBlankResponse?: boolean
  verbosity?: number
  dynamicOutput?: DynamicOutput
}

export type ModelPreset = Partial<botPreset> & {
  id?: string
  name?: string
}

export type PromptPreset = Partial<botPreset> & {
  id?: string
  name?: string
  overrideModelParameters?: boolean
}

interface hordeConfig {
  apiKey: string
  model: string
  softPrompt: string
}

export interface folder {
  name: string
  data: string[]
  color: string
  id: string
  imgFile?: string
  img?: string
}

interface sdConfig {
  width: number
  height: number
  sampler_name: string
  script_name: string
  denoising_strength: number
  enable_hr: boolean
  hr_scale: number
  hr_upscaler: string
}

export interface NAIImgConfig {
  width: number
  height: number
  sampler: string
  noise_schedule: string
  steps: number
  scale: number
  cfg_rescale: number
  sm: boolean
  sm_dyn: boolean
  noise: number
  strength: number
  image: string
  base64image: string
  InfoExtracted: number
  //add 4
  autoSmea: boolean
  use_coords: boolean
  legacy_uc: boolean
  v4_prompt: NAIImgConfigV4Prompt
  v4_negative_prompt: NAIImgConfigV4NegativePrompt
  //add vibe
  reference_image_multiple?: string[]
  reference_strength_multiple?: number[]
  vibe_data?: NAIVibeData
  vibe_model_selection?: string
  //add variety+ and decrisp options
  variety_plus: boolean
  decrisp: boolean
  //add character reference
  reference_mode: string
  character_image: string
  character_base64image: string
  style_aware: boolean
}

//add 4
interface NAIImgConfigV4Prompt {
  caption: NAIImgConfigV4Caption
  use_coords: boolean
  use_order: boolean
}
//add 4
interface NAIImgConfigV4NegativePrompt {
  caption: NAIImgConfigV4Caption
  legacy_uc: boolean
}
//add 4
interface NAIImgConfigV4Caption {
  base_caption: string
  char_captions: NAIImgConfigV4CharCaption[]
}
//add 4
interface NAIImgConfigV4CharCaption {
  char_caption: string
  centers: {
    x: number
    y: number
  }[]
}

// NAI Vibe Data interfaces
interface NAIVibeData {
  identifier: string
  version: number
  type: string
  image: string
  id: string
  encodings: {
    [key: string]: {
      [key: string]: NAIVibeEncoding
    }
  }
  name: string
  thumbnail: string
  createdAt: number
  importInfo: {
    model: string
    information_extracted: number
    strength: number
  }
}

interface NAIVibeEncoding {
  encoding: string
  params: {
    information_extracted: number
  }
}

interface ComfyConfig {
  workflow: string
  posNodeID: string
  posInputName: string
  negNodeID: string
  negInputName: string
  timeout: number
}

export type FormatingOrderItem =
  | 'main'
  | 'jailbreak'
  | 'chats'
  | 'lorebook'
  | 'globalNote'
  | 'authorNote'
  | 'lastChat'
  | 'description'
  | 'postEverything'
  | 'personaPrompt'

export interface Chat {
  message: Message[]
  note: string
  name: string
  localLore: loreBook[]
  generationSettings?: ChatGenerationSettings
  sdData?: string
  lastMemory?: string
  suggestMessages?: string[]
  isStreaming?: boolean
  scriptstate?: { [key: string]: string | number | boolean }
  modules?: string[]
  id?: string
  bindedPersona?: string
  fmIndex?: number
  hypaV3Data?: SerializableHypaV3Data
  folderId?: string
  lastDate?: number
  bookmarks?: string[]
  bookmarkNames?: { [chatId: string]: string }
}

export interface ChatFolder {
  id: string
  name?: string
  color?: string
  folded: boolean
}

export interface Message {
  role: 'user' | 'char'
  data: string
  translation?: MessageTranslation | null
  saying?: string
  chatId?: string
  time?: number
  generationInfo?: MessageGenerationInfo
  promptInfo?: MessagePresetInfo
  name?: string
  otherUser?: boolean
  disabled?: false | true | 'allBefore'
  isComment?: boolean
}

export interface MessageTranslation {
  text: string
  source: 'raw'
  sourceHash: string
  targetLanguage: string
  inputLanguage: string
  translatorType: 'google' | 'deepl' | 'deeplX' | 'llm'
  settingsHash: string
  updatedAt: number
}

export interface MessageGenerationInfo {
  model?: string
  generationId?: string
  inputTokens?: number
  outputTokens?: number
  maxContext?: number
  stageTiming?: {
    stage1?: number
    stage2?: number
    stage3?: number
    stage4?: number
  }
}

export interface MessagePresetInfo {
  promptName?: string
  promptToggles?: { key: string; value: string }[]
  promptText?: OpenAIChat[]
}

export interface PromptDiffPrefs {
  diffStyle: 'line' | 'intraline'
  formatStyle: 'raw' | 'card'
  viewStyle: 'unified' | 'split'
  isGrouped: boolean
  showOnlyChanges: boolean
  contextRadius: number
}

interface AINsettings {
  top_p: number
  rep_pen: number
  top_a: number
  rep_pen_slope: number
  rep_pen_range: number
  typical_p: number
  badwords: string
  stoptokens: string
  top_k: number
}

export interface OobaSettings {
  max_new_tokens: number
  do_sample: boolean
  temperature: number
  top_p: number
  typical_p: number
  repetition_penalty: number
  encoder_repetition_penalty: number
  top_k: number
  min_length: number
  no_repeat_ngram_size: number
  num_beams: number
  penalty_alpha: number
  length_penalty: number
  early_stopping: boolean
  seed: number
  add_bos_token: boolean
  truncation_length: number
  ban_eos_token: boolean
  skip_special_tokens: boolean
  top_a: number
  tfs: number
  epsilon_cutoff: number
  eta_cutoff: number
  formating: {
    header: string
    systemPrefix: string
    userPrefix: string
    assistantPrefix: string
    seperator: string
    useName: boolean
  }
}

export const saveImage = saveImageGlobal

export const defaultAIN: AINsettings = {
  top_p: 0.7,
  rep_pen: 1.0625,
  top_a: 0.08,
  rep_pen_slope: 1.7,
  rep_pen_range: 1024,
  typical_p: 1.0,
  badwords: '',
  stoptokens: '',
  top_k: 140,
}

export const defaultOoba: OobaSettings = {
  max_new_tokens: 180,
  do_sample: true,
  temperature: 0.7,
  top_p: 0.9,
  typical_p: 1,
  repetition_penalty: 1.15,
  encoder_repetition_penalty: 1,
  top_k: 20,
  min_length: 0,
  no_repeat_ngram_size: 0,
  num_beams: 1,
  penalty_alpha: 0,
  length_penalty: 1,
  early_stopping: false,
  seed: -1,
  add_bos_token: true,
  truncation_length: 4096,
  ban_eos_token: false,
  skip_special_tokens: true,
  top_a: 0,
  tfs: 1,
  epsilon_cutoff: 0,
  eta_cutoff: 0,
  formating: {
    header: 'Below is an instruction that describes a task. Write a response that appropriately completes the request.',
    systemPrefix: '### Instruction:',
    userPrefix: '### Input:',
    assistantPrefix: '### Response:',
    seperator: '',
    useName: false,
  },
}

export const presetTemplate: botPreset = {
  name: 'New Preset',
  apiType: 'gemini-3-flash-preview',
  openAIKey: '',
  localNetworkMode: false,
  localNetworkTimeoutSec: 600,
  mainPrompt: defaultMainPrompt,
  jailbreak: defaultJailbreak,
  globalNote: '',
  temperature: 80,
  maxContext: 4000,
  maxResponse: 300,
  frequencyPenalty: 70,
  PresensePenalty: 70,
  formatingOrder: [
    'main',
    'description',
    'personaPrompt',
    'chats',
    'lastChat',
    'jailbreak',
    'lorebook',
    'globalNote',
    'authorNote',
  ],
  aiModel: 'gemini-3-flash-preview',
  subModel: 'gemini-3-flash-preview',
  modelRoles: createDefaultModelRoleOverrides(),
  currentPluginProvider: '',
  textgenWebUIStreamURL: '',
  textgenWebUIBlockingURL: '',
  forceReplaceUrl: '',
  forceReplaceUrl2: '',
  promptPreprocess: false,
  proxyKey: '',
  bias: [],
  ooba: safeStructuredClone(defaultOoba),
  ainconfig: safeStructuredClone(defaultAIN),
  reverseProxyOobaArgs: {
    mode: 'instruct',
  },
  top_p: 1,
  useInstructPrompt: false,
  verbosity: 1,
}

const defaultSdData: [string, string][] = [
  ['always', 'solo, 1girl'],
  ['negative', ''],
  ["|character\'s appearance", ''],
  ['current situation', ''],
  ["$character's pose", ''],
  ["$character's emotion", ''],
  ['current location', ''],
]

export const defaultSdDataFunc = () => {
  return safeStructuredClone(defaultSdData)
}

function saveCurrentPresetLocal() {
  let db = DBState.db
  normalizeBotPresetIds(db)
  let pres = db.botPresets

  if (db.botPresetsId === -1) {
    return null
  }
  pres[db.botPresetsId].id ??= createClientPresetId()
  const savedPreset: botPreset = {
    id: pres[db.botPresetsId].id,
    name: pres[db.botPresetsId].name,
    apiType: db.apiType,
    openAIKey: db.openAIKey,
    localNetworkMode: db.localNetworkMode,
    localNetworkTimeoutSec: db.localNetworkTimeoutSec,
    additionalParams: safeStructuredClone(db.additionalParams),
    mainPrompt: db.mainPrompt,
    jailbreak: db.jailbreak,
    globalNote: db.globalNote,
    temperature: db.temperature,
    maxContext: db.maxContext,
    maxResponse: db.maxResponse,
    frequencyPenalty: db.frequencyPenalty,
    PresensePenalty: db.PresensePenalty,
    formatingOrder: db.formatingOrder,
    aiModel: db.aiModel,
    subModel: db.subModel,
    modelRoles: safeStructuredClone(db.modelRoles),
    modelProfiles: safeStructuredClone(db.modelProfiles),
    modelRoleProfiles: safeStructuredClone(db.modelRoleProfiles),
    modelRuntimeDefaults: safeStructuredClone(normalizeModelRuntimeDefaults(db.modelRuntimeDefaults)),
    currentPluginProvider: db.currentPluginProvider,
    textgenWebUIStreamURL: db.textgenWebUIStreamURL,
    textgenWebUIBlockingURL: db.textgenWebUIBlockingURL,
    forceReplaceUrl: db.forceReplaceUrl,
    promptPreprocess: db.promptPreprocess,
    bias: db.bias,
    koboldURL: db.koboldURL,
    proxyKey: db.proxyKey,
    ooba: safeStructuredClone(db.ooba),
    ainconfig: safeStructuredClone(db.ainconfig),
    proxyRequestModel: db.proxyRequestModel,
    openrouterRequestModel: db.openrouterRequestModel,
    NAISettings: safeStructuredClone(db.NAIsettings),
    NAIadventure: db.NAIadventure ?? false,
    NAIappendName: db.NAIappendName ?? false,
    localStopStrings: db.localStopStrings,
    autoSuggestPrompt: db.autoSuggestPrompt,
    customProxyRequestModel: db.customProxyRequestModel,
    reverseProxyOobaArgs: safeStructuredClone(db.reverseProxyOobaArgs) ?? null,
    top_p: db.top_p ?? 1,
    promptSettings: safeStructuredClone(db.promptSettings) ?? null,
    repetition_penalty: db.repetition_penalty,
    min_p: db.min_p,
    top_a: db.top_a,
    openrouterProvider: db.openrouterProvider,
    useInstructPrompt: db.useInstructPrompt,
    customPromptTemplateToggle: db.customPromptTemplateToggle ?? '',
    templateDefaultVariables: db.templateDefaultVariables ?? '',
    moduleIntergration: db.moduleIntergration ?? '',
    top_k: db.top_k,
    instructChatTemplate: db.instructChatTemplate,
    JinjaTemplate: db.JinjaTemplate ?? '',
    jsonSchemaEnabled: db.jsonSchemaEnabled ?? false,
    jsonSchema: db.jsonSchema ?? '',
    strictJsonSchema: db.strictJsonSchema ?? true,
    extractJson: db.extractJson ?? '',
    seperateParametersEnabled: db.seperateParametersEnabled ?? false,
    seperateParameters: safeStructuredClone(db.seperateParameters),
    customAPIFormat: safeStructuredClone(db.customAPIFormat),
    systemContentReplacement: db.systemContentReplacement,
    systemRoleReplacement: db.systemRoleReplacement,
    customFlags: safeStructuredClone(db.customFlags),
    enableCustomFlags: db.enableCustomFlags,
    regex: db.presetRegex,
    image: pres?.[db.botPresetsId]?.image ?? '',
    reasonEffort: db.reasoningEffort ?? 0,
    thinkingTokens: db.thinkingTokens ?? null,
    thinkingType: db.thinkingType ?? 'budget',
    deepseekThinkingType: db.deepseekThinkingType ?? 'off',
    adaptiveThinkingEffort: db.adaptiveThinkingEffort ?? 'high',
    deepseekReasoningEffort: db.deepseekReasoningEffort ?? 'high',
    outputImageModal: db.outputImageModal ?? false,
    seperateModelsForAxModels: db.doNotChangeSeperateModels ? false : (db.seperateModelsForAxModels ?? false),
    seperateModels: db.doNotChangeSeperateModels ? null : safeStructuredClone(db.seperateModels),
    modelTools: safeStructuredClone(db.modelTools),
    fallbackModels: safeStructuredClone(db.fallbackModels),
    fallbackWhenBlankResponse: db.fallbackWhenBlankResponse ?? false,
    verbosity: db.verbosity ?? 1,
    dynamicOutput: db.dynamicOutput ?? null,
  }
  if (!Array.isArray(pres)) {
    pres = []
  }
  //if out of bounds, create a new preset
  if (db.botPresetsId >= pres.length) {
    pres.push(savedPreset)
  } else {
    pres[db.botPresetsId] = savedPreset
  }
  db.botPresets = pres
  return savedPreset
}

export function saveCurrentPreset() {
  withTrustedServerProjectionWrite(() => {
    const { savedPreset, rollback } = saveCurrentPresetLocalWithRollback()
    if (!savedPreset?.id) return []
    runOptimisticCommandSequence(
      [
        (baseRevision) =>
          updatePresetCommand({
            baseRevision,
            presetId: savedPreset.id!,
            patch: safeStructuredClone(savedPreset) as unknown as PresetSnapshot,
          }),
      ],
      () => rollbackBotPresetFields(rollback),
    )
  })
}

export function copyPreset(id: number) {
  withTrustedServerProjectionWrite(() => {
    const db = DBState.db
    const { rollback: saveCurrentRollback } = saveCurrentPresetLocalWithRollback()
    normalizeBotPresetIds(db)
    let pres = db.botPresets
    if (!getHydratedPresetIfReady(id)) {
      void ensureBotPresetHydrated(id).then((hydrated) => {
        if (hydrated) copyPreset(id)
      })
      return []
    }
    const newPres = safeStructuredClone(pres[id])
    if (!newPres?.id) return []
    const sourcePresetId = newPres.id
    newPres.id = createClientPresetId()
    newPres.name += ' Copy'
    db.botPresets.push(newPres)
    const attemptedCopy = safeStructuredClone(newPres)
    runOptimisticCommandSequence(
      [
        (baseRevision) =>
          copyPresetCommand({
            baseRevision,
            presetId: sourcePresetId,
            newPresetId: newPres.id,
            name: newPres.name,
            saveCurrent: true,
          }),
      ],
      () => {
        rollbackBotPresetCreate(attemptedCopy)
        rollbackBotPresetFields(saveCurrentRollback)
      },
    )
  })
}

export function changeToPreset(id = 0, savecurrent = true) {
  withTrustedServerProjectionWrite(() => {
    const db = DBState.db
    normalizeBotPresetIds(db)
    const previousSelectedId = botPresetSelectedId(db)
    const previousSettings = snapshotSetPresetSettings(db)
    const saveCurrentRollback = savecurrent ? saveCurrentPresetLocalWithRollback().rollback : null
    normalizeBotPresetIds(db)
    let pres = db.botPresets
    const newPres = pres[id]
    const targetPresetId = newPres?.id
    db.botPresetsId = id
    if (newPres) {
      const hydratedPreset = getHydratedPresetIfReady(id)
      if (hydratedPreset) {
        setPreset(db, hydratedPreset)
      } else {
        void ensureBotPresetHydrated(id).then((hydrated) => {
          if (!hydrated) return
          withTrustedServerProjectionWrite(() => {
            const nextIndex = DBState.db.botPresets.findIndex((preset) => preset?.id === targetPresetId)
            if (nextIndex < 0 || DBState.db.botPresetsId !== nextIndex) return
            setPreset(DBState.db, DBState.db.botPresets[nextIndex])
          })
        })
      }
    }
    if (!targetPresetId) return
    const selectionRollback: BotPresetSelectionRollback = {
      previousSelectedId,
      attemptedSelectedId: botPresetSelectedId(db),
      previousSettings,
      attemptedSettings: snapshotSetPresetSettings(db),
    }
    runOptimisticCommandSequence(
      [
        (baseRevision) =>
          selectPresetCommand({
            baseRevision,
            presetId: targetPresetId,
            apply: true,
            saveCurrent: savecurrent,
          }),
      ],
      () => {
        rollbackBotPresetFields(saveCurrentRollback)
        rollbackBotPresetSelection(selectionRollback)
      },
    )
  })
}

export function createPreset(preset: botPreset) {
  withTrustedServerProjectionWrite(() => {
    const db = DBState.db
    normalizeBotPresetIds(db)
    const newPreset = safeStructuredClone(preset)
    newPreset.id ??= createClientPresetId()
    db.botPresets.push(newPreset)
    db.botPresets = db.botPresets
    const attemptedPreset = safeStructuredClone(newPreset)
    runOptimisticCommandSequence(
      [
        (baseRevision) =>
          createPresetCommand({
            baseRevision,
            preset: safeStructuredClone(attemptedPreset) as unknown as PresetSnapshot,
          }),
      ],
      () => rollbackBotPresetCreate(attemptedPreset),
    )
  })
}

export function updatePreset(id: number, patch: Partial<botPreset>) {
  withTrustedServerProjectionWrite(() => {
    const db = DBState.db
    normalizeBotPresetIds(db)
    const presetId = db.botPresets[id]?.id
    if (!presetId) return []
    const attempted = safeStructuredClone(patch)
    const rollback = botPresetFieldRollbackFromPatch(
      presetId,
      db.botPresets[id] as unknown as Record<string, unknown>,
      attempted as unknown as Record<string, unknown>,
    )
    Object.assign(db.botPresets[id], attempted)
    runOptimisticCommandSequence(
      [
        (baseRevision) =>
          updatePresetCommand({
            baseRevision,
            presetId,
            patch: safeStructuredClone({ ...attempted, id: presetId }) as PresetSnapshot,
          }),
      ],
      () => rollbackBotPresetFields(rollback),
    )
  })
}

export function deletePreset(id: number, selectIndex = 0, apply = true) {
  withTrustedServerProjectionWrite(() => {
    const db = DBState.db
    normalizeBotPresetIds(db)
    if (db.botPresets.length <= 1) return []
    const presetId = db.botPresets[id]?.id
    const previousPreset = db.botPresets[id] ? safeStructuredClone(db.botPresets[id]) : null
    const previousSelectedId = botPresetSelectedId(db)
    const previousSettings = apply ? snapshotSetPresetSettings(db) : undefined
    const nextSelectedPreset =
      db.botPresets[selectIndex]?.id === presetId
        ? db.botPresets.find((preset) => preset.id !== presetId)
        : db.botPresets[selectIndex]
    const selectPresetId = nextSelectedPreset?.id
    if (!presetId || !previousPreset) return []
    let botPresets = db.botPresets
    botPresets.splice(id, 1)
    db.botPresets = botPresets
    const selectedIndex = selectPresetId ? db.botPresets.findIndex((preset) => preset.id === selectPresetId) : -1
    if (selectedIndex >= 0) {
      db.botPresetsId = selectedIndex
      if (apply) {
        const hydratedPreset = getHydratedPresetIfReady(selectedIndex)
        if (hydratedPreset) {
          setPreset(db, hydratedPreset)
        } else {
          void ensureBotPresetHydrated(selectedIndex).then((hydrated) => {
            if (!hydrated) return
            withTrustedServerProjectionWrite(() => {
              const nextIndex = DBState.db.botPresets.findIndex((preset) => preset?.id === selectPresetId)
              if (nextIndex < 0 || DBState.db.botPresetsId !== nextIndex) return
              setPreset(DBState.db, DBState.db.botPresets[nextIndex])
            })
          })
        }
      }
    } else if (db.botPresetsId >= db.botPresets.length) {
      db.botPresetsId = db.botPresets.length - 1
    }
    const selectionRollback: BotPresetSelectionRollback = {
      previousSelectedId,
      attemptedSelectedId: botPresetSelectedId(db),
      ...(apply && previousSettings
        ? {
            previousSettings,
            attemptedSettings: snapshotSetPresetSettings(db),
          }
        : {}),
    }
    runOptimisticCommandSequence(
      [
        (baseRevision) =>
          deletePresetCommand({
            baseRevision,
            presetId,
            selectPresetId,
            apply,
            saveCurrent: false,
          }),
      ],
      () => {
        rollbackBotPresetDelete(previousPreset, id)
        rollbackBotPresetSelection(selectionRollback)
      },
    )
  })
}

export function reorderPresets(fromIndex: number, toIndex: number) {
  withTrustedServerProjectionWrite(() => {
    const db = DBState.db
    normalizeBotPresetIds(db)
    if (fromIndex === toIndex) return []
    if (fromIndex < 0 || toIndex < 0 || fromIndex >= db.botPresets.length || toIndex > db.botPresets.length) {
      return []
    }

    const previousPresetIds = botPresetIds(db.botPresets)
    let botPresets = [...db.botPresets]
    const movedItem = botPresets.splice(fromIndex, 1)[0]
    if (!movedItem) return []

    const adjustedToIndex = fromIndex < toIndex ? toIndex - 1 : toIndex
    botPresets.splice(adjustedToIndex, 0, movedItem)

    const currentId = db.botPresetsId
    if (currentId === fromIndex) {
      db.botPresetsId = adjustedToIndex
    } else if (fromIndex < currentId && adjustedToIndex >= currentId) {
      db.botPresetsId = currentId - 1
    } else if (fromIndex > currentId && adjustedToIndex <= currentId) {
      db.botPresetsId = currentId + 1
    }

    db.botPresets = botPresets
    const presetIds = db.botPresets.map((preset) => preset.id).filter((id): id is string => !!id)
    runOptimisticCommandSequence(
      [
        (baseRevision) =>
          reorderPresetsCommand({
            baseRevision,
            presetIds,
          }),
      ],
      () => rollbackBotPresetReorder(previousPresetIds, presetIds),
    )
  })
}

export function createModelPreset(preset: ModelPreset) {
  withTrustedServerProjectionWrite(() => {
    const db = DBState.db
    normalizeSplitPresetIds(db)
    const newPreset = safeStructuredClone(preset)
    newPreset.id ??= createClientPresetId()
    db.modelPresets.push(newPreset)
    db.modelPresets = db.modelPresets
    const attemptedPreset = safeStructuredClone(newPreset)
    runOptimisticCommandSequence(
      [
        (baseRevision) =>
          createModelPresetCommand({
            baseRevision,
            preset: safeStructuredClone(attemptedPreset) as unknown as ModelPresetSnapshot,
          }),
      ],
      () => rollbackSplitPresetCreate('model', attemptedPreset),
    )
  })
}

export function updateModelPreset(id: number, patch: Partial<ModelPreset>) {
  withTrustedServerProjectionWrite(() => {
    const db = DBState.db
    const modelPresetId = db.modelPresets[id]?.id
    if (!modelPresetId) return
    const previous = splitPresetPatchSnapshot(
      db.modelPresets[id] as unknown as Record<string, unknown>,
      patch as Record<string, unknown>,
    )
    const attempted = safeStructuredClone(patch)
    Object.assign(db.modelPresets[id], attempted)
    if (db.modelPresetsId === id) {
      applyModelPresetFieldsToDatabase(db, db.modelPresets[id])
    }
    runOptimisticCommandSequence(
      [
        (baseRevision) =>
          updateModelPresetCommand({
            baseRevision,
            modelPresetId,
            patch: safeStructuredClone({ ...attempted, id: modelPresetId }) as ModelPresetSnapshot,
          }),
      ],
      () => rollbackModelPresetPatch(modelPresetId, previous, attempted),
    )
  })
}

export function deleteModelPreset(id: number, selectIndex = 0) {
  withTrustedServerProjectionWrite(() => {
    const db = DBState.db
    normalizeSplitPresetIds(db)
    if (db.modelPresets.length <= 1) return
    const modelPresetId = db.modelPresets[id]?.id
    const previousPreset = db.modelPresets[id] ? safeStructuredClone(db.modelPresets[id]) : null
    const previousSelectedId = splitPresetSelectedId(db, 'model')
    const previousSettings = snapshotSetPresetSettings(db)
    const nextSelectedPreset =
      db.modelPresets[selectIndex]?.id === modelPresetId
        ? db.modelPresets.find((preset) => preset.id !== modelPresetId)
        : db.modelPresets[selectIndex]
    const selectModelPresetId = nextSelectedPreset?.id
    if (!modelPresetId || !previousPreset) return
    db.modelPresets.splice(id, 1)
    db.modelPresets = db.modelPresets
    const selectedIndex = selectModelPresetId
      ? db.modelPresets.findIndex((preset) => preset.id === selectModelPresetId)
      : -1
    db.modelPresetsId = selectedIndex >= 0 ? selectedIndex : Math.min(db.modelPresetsId, db.modelPresets.length - 1)
    applyModelPresetFieldsToDatabase(db, db.modelPresets[db.modelPresetsId])
    const selectionRollback: SplitPresetSelectionRollback = {
      kind: 'model',
      previousSelectedId,
      attemptedSelectedId: splitPresetSelectedId(db, 'model'),
      previousSettings,
      attemptedSettings: snapshotSetPresetSettings(db),
    }
    runOptimisticCommandSequence(
      [
        (baseRevision) =>
          deleteModelPresetCommand({
            baseRevision,
            modelPresetId,
            selectModelPresetId,
          }),
      ],
      () => {
        rollbackSplitPresetDelete('model', previousPreset, id)
        rollbackSplitPresetSelection(selectionRollback)
      },
    )
  })
}

export function selectModelPreset(id: number) {
  withTrustedServerProjectionWrite(() => {
    const db = DBState.db
    normalizeSplitPresetIds(db)
    const previousSelectedId = splitPresetSelectedId(db, 'model')
    const previousSettings = snapshotSetPresetSettings(db)
    const modelPresetId = db.modelPresets[id]?.id
    if (!modelPresetId) return
    db.modelPresetsId = id
    applyModelPresetFieldsToDatabase(db, db.modelPresets[id])
    const selectionRollback: SplitPresetSelectionRollback = {
      kind: 'model',
      previousSelectedId,
      attemptedSelectedId: splitPresetSelectedId(db, 'model'),
      previousSettings,
      attemptedSettings: snapshotSetPresetSettings(db),
    }
    runOptimisticCommandSequence(
      [
        (baseRevision) =>
          selectModelPresetCommand({
            baseRevision,
            modelPresetId,
          }),
      ],
      () => rollbackSplitPresetSelection(selectionRollback),
    )
  })
}

export function reorderModelPresets(fromIndex: number, toIndex: number) {
  withTrustedServerProjectionWrite(() => {
    const db = DBState.db
    normalizeSplitPresetIds(db)
    if (fromIndex === toIndex) return
    if (fromIndex < 0 || toIndex < 0 || fromIndex >= db.modelPresets.length || toIndex > db.modelPresets.length) {
      return
    }
    const previousPresetIds = splitPresetIds(db.modelPresets)
    const modelPresets = [...db.modelPresets]
    const movedItem = modelPresets.splice(fromIndex, 1)[0]
    if (!movedItem) return
    const adjustedToIndex = fromIndex < toIndex ? toIndex - 1 : toIndex
    modelPresets.splice(adjustedToIndex, 0, movedItem)
    db.modelPresetsId = movedSelectedIndex(db.modelPresetsId, fromIndex, adjustedToIndex)
    db.modelPresets = modelPresets
    const modelPresetIds = db.modelPresets.map((preset) => preset.id).filter((id): id is string => !!id)
    runOptimisticCommandSequence(
      [
        (baseRevision) =>
          reorderModelPresetsCommand({
            baseRevision,
            modelPresetIds,
          }),
      ],
      () => rollbackSplitPresetReorder('model', previousPresetIds, modelPresetIds),
    )
  })
}

export function createPromptPreset(preset: PromptPreset) {
  withTrustedServerProjectionWrite(() => {
    const db = DBState.db
    normalizeSplitPresetIds(db)
    const newPreset = safeStructuredClone(preset)
    newPreset.id ??= createClientPresetId()
    db.promptPresets.push(newPreset)
    db.promptPresets = db.promptPresets
    const attemptedPreset = safeStructuredClone(newPreset)
    runOptimisticCommandSequence(
      [
        (baseRevision) =>
          createPromptPresetCommand({
            baseRevision,
            preset: safeStructuredClone(attemptedPreset) as unknown as PromptPresetSnapshot,
          }),
      ],
      () => rollbackSplitPresetCreate('prompt', attemptedPreset),
    )
  })
}

export function addImportedPromptPreset(preset: PromptPreset) {
  withTrustedServerProjectionWrite(() => {
    const db = DBState.db
    normalizeSplitPresetIds(db)
    const newPreset = safeStructuredClone(promptPresetExportPayload(preset)) as PromptPreset
    newPreset.id ??= createClientPresetId()
    db.promptPresets.push(newPreset)
    db.promptPresets = db.promptPresets
    const attemptedPreset = safeStructuredClone(newPreset)
    runOptimisticCommandSequence(
      [
        (baseRevision) =>
          importPromptPresetCommand({
            baseRevision,
            preset: safeStructuredClone(attemptedPreset) as unknown as PromptPresetSnapshot,
          }),
      ],
      () => rollbackSplitPresetCreate('prompt', attemptedPreset),
    )
  })
}

export function updatePromptPreset(id: number, patch: Partial<PromptPreset>) {
  withTrustedServerProjectionWrite(() => {
    const db = DBState.db
    const promptPresetId = db.promptPresets[id]?.id
    if (!promptPresetId) return
    const attempted = normalizePromptPresetPatchAliases(safeStructuredClone(patch))
    const previous = splitPresetPatchSnapshot(
      db.promptPresets[id] as unknown as Record<string, unknown>,
      attempted as Record<string, unknown>,
    )
    Object.assign(db.promptPresets[id], attempted)
    if (db.promptPresetsId === id) {
      applyPromptPresetFieldsToDatabase(db, db.promptPresets[id])
    }
    runOptimisticCommandSequence(
      [
        (baseRevision) =>
          updatePromptPresetCommand({
            baseRevision,
            promptPresetId,
            patch: safeStructuredClone({ ...attempted, id: promptPresetId }) as PromptPresetSnapshot,
          }),
      ],
      () => rollbackPromptPresetPatch(promptPresetId, previous, attempted),
    )
  })
}

function normalizePromptPresetPatchAliases<T extends Partial<PromptPreset>>(patch: T): T {
  if (Object.prototype.hasOwnProperty.call(patch, 'presetRegex')) {
    const target = patch as Record<string, unknown>
    target.regex = []
  }
  return patch
}

function splitPresetPatchSnapshot(
  preset: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const previous: Record<string, unknown> = {}
  for (const key of Object.keys(patch)) {
    previous[key] = safeStructuredClone(preset[key])
  }
  return previous
}

function rollbackModelPresetPatch(
  modelPresetId: string,
  previous: Record<string, unknown>,
  attempted: Partial<ModelPreset>,
): void {
  rollbackSplitPresetPatch('model', modelPresetId, previous, attempted as Record<string, unknown>)
}

function rollbackPromptPresetPatch(
  promptPresetId: string,
  previous: Record<string, unknown>,
  attempted: Partial<PromptPreset>,
): void {
  rollbackSplitPresetPatch('prompt', promptPresetId, previous, attempted as Record<string, unknown>)
}

function rollbackSplitPresetPatch(
  kind: 'model' | 'prompt',
  presetId: string,
  previous: Record<string, unknown>,
  attempted: Record<string, unknown>,
): void {
  withTrustedServerProjectionWrite(() => {
    const presets = kind === 'model' ? DBState.db.modelPresets : DBState.db.promptPresets
    const index = presets.findIndex((preset) => preset?.id === presetId)
    if (index < 0) return

    const preset = presets[index] as Record<string, unknown>
    let changed = false
    for (const key of Object.keys(attempted)) {
      if (key === 'id') continue
      if (jsonSnapshot(preset[key]) !== jsonSnapshot(attempted[key])) continue
      if (previous[key] === undefined) {
        delete preset[key]
      } else {
        preset[key] = safeStructuredClone(previous[key])
      }
      changed = true
    }
    if (!changed) return

    if (kind === 'model') {
      if (DBState.db.modelPresetsId === index) {
        applyModelPresetFieldsToDatabase(DBState.db, DBState.db.modelPresets[index])
      }
    } else if (DBState.db.promptPresetsId === index) {
      applyPromptPresetFieldsToDatabase(DBState.db, DBState.db.promptPresets[index])
    }
  })
}

function jsonSnapshot(value: unknown): string {
  const snapshot = JSON.stringify(value)
  return snapshot === undefined ? '__undefined__' : snapshot
}

export function deletePromptPreset(id: number, selectIndex = 0) {
  withTrustedServerProjectionWrite(() => {
    const db = DBState.db
    normalizeSplitPresetIds(db)
    if (db.promptPresets.length <= 1) return
    const promptPresetId = db.promptPresets[id]?.id
    const previousPreset = db.promptPresets[id] ? safeStructuredClone(db.promptPresets[id]) : null
    const previousSelectedId = splitPresetSelectedId(db, 'prompt')
    const previousSettings = snapshotSetPresetSettings(db)
    const nextSelectedPreset =
      db.promptPresets[selectIndex]?.id === promptPresetId
        ? db.promptPresets.find((preset) => preset.id !== promptPresetId)
        : db.promptPresets[selectIndex]
    const selectPromptPresetId = nextSelectedPreset?.id
    if (!promptPresetId || !previousPreset) return
    db.promptPresets.splice(id, 1)
    db.promptPresets = db.promptPresets
    const selectedIndex = selectPromptPresetId
      ? db.promptPresets.findIndex((preset) => preset.id === selectPromptPresetId)
      : -1
    db.promptPresetsId = selectedIndex >= 0 ? selectedIndex : Math.min(db.promptPresetsId, db.promptPresets.length - 1)
    applyPromptPresetFieldsToDatabase(db, db.promptPresets[db.promptPresetsId])
    const selectionRollback: SplitPresetSelectionRollback = {
      kind: 'prompt',
      previousSelectedId,
      attemptedSelectedId: splitPresetSelectedId(db, 'prompt'),
      previousSettings,
      attemptedSettings: snapshotSetPresetSettings(db),
    }
    runOptimisticCommandSequence(
      [
        (baseRevision) =>
          deletePromptPresetCommand({
            baseRevision,
            promptPresetId,
            selectPromptPresetId,
          }),
      ],
      () => {
        rollbackSplitPresetDelete('prompt', previousPreset, id)
        rollbackSplitPresetSelection(selectionRollback)
      },
    )
  })
}

export function selectPromptPreset(id: number) {
  withTrustedServerProjectionWrite(() => {
    const db = DBState.db
    normalizeSplitPresetIds(db)
    const previousSelectedId = splitPresetSelectedId(db, 'prompt')
    const previousSettings = snapshotSetPresetSettings(db)
    const promptPresetId = db.promptPresets[id]?.id
    if (!promptPresetId) return
    db.promptPresetsId = id
    applyPromptPresetFieldsToDatabase(db, db.promptPresets[id])
    const selectionRollback: SplitPresetSelectionRollback = {
      kind: 'prompt',
      previousSelectedId,
      attemptedSelectedId: splitPresetSelectedId(db, 'prompt'),
      previousSettings,
      attemptedSettings: snapshotSetPresetSettings(db),
    }
    runPromptPresetSelectionCommand(promptPresetId, () => rollbackSplitPresetSelection(selectionRollback))
  })
}

export function reorderPromptPresets(fromIndex: number, toIndex: number) {
  withTrustedServerProjectionWrite(() => {
    const db = DBState.db
    normalizeSplitPresetIds(db)
    if (fromIndex === toIndex) return
    if (fromIndex < 0 || toIndex < 0 || fromIndex >= db.promptPresets.length || toIndex > db.promptPresets.length) {
      return
    }
    const previousPresetIds = splitPresetIds(db.promptPresets)
    const promptPresets = [...db.promptPresets]
    const movedItem = promptPresets.splice(fromIndex, 1)[0]
    if (!movedItem) return
    const adjustedToIndex = fromIndex < toIndex ? toIndex - 1 : toIndex
    promptPresets.splice(adjustedToIndex, 0, movedItem)
    db.promptPresetsId = movedSelectedIndex(db.promptPresetsId, fromIndex, adjustedToIndex)
    db.promptPresets = promptPresets
    const promptPresetIds = db.promptPresets.map((preset) => preset.id).filter((id): id is string => !!id)
    runOptimisticCommandSequence(
      [
        (baseRevision) =>
          reorderPromptPresetsCommand({
            baseRevision,
            promptPresetIds,
          }),
      ],
      () => rollbackSplitPresetReorder('prompt', previousPresetIds, promptPresetIds),
    )
  })
}

export function extractLegacyBotPresetByIndex(id: number, mode: 'all' | 'model' | 'prompt') {
  withTrustedServerProjectionWrite(() => {
    const db = DBState.db
    normalizeBotPresetIds(db)
    normalizeSplitPresetIds(db)
    const preset = db.botPresets[id]
    const presetId = preset?.id
    if (!presetId) return []
    const previousPreset = safeStructuredClone(preset)
    const previousSelectedId = botPresetSelectedId(db)
    const legacyName = typeof preset.name === 'string' && preset.name.trim() ? preset.name : 'Legacy'
    let attemptedModelPreset: ModelPreset | null = null
    let attemptedPromptPreset: PromptPreset | null = null

    if (mode === 'all' || mode === 'model') {
      const modelPreset = createExtractedModelPreset(preset, {
        id: createClientPresetId(),
        name: `${legacyName} Model`,
      }) as ModelPreset
      const existing = findEquivalentModelPreset(db.modelPresets, modelPreset)
      if (!existing) {
        db.modelPresets.push(modelPreset)
        attemptedModelPreset = safeStructuredClone(modelPreset)
      }
    }

    if (mode === 'all' || mode === 'prompt') {
      const promptPreset = createExtractedPromptPreset(preset, {
        id: createClientPresetId(),
        name: `${legacyName} Prompt`,
      }) as PromptPreset
      db.promptPresets.push(promptPreset)
      attemptedPromptPreset = safeStructuredClone(promptPreset)
    }

    db.botPresets.splice(id, 1)
    db.botPresets = db.botPresets
    db.modelPresets = db.modelPresets
    db.promptPresets = db.promptPresets
    db.botPresetsId = normalizedBotPresetsId(db.botPresets.length, db.botPresetsId)
    const selectionRollback: BotPresetSelectionRollback = {
      previousSelectedId,
      attemptedSelectedId: botPresetSelectedId(db),
    }
    runOptimisticCommandSequence(
      [
        (baseRevision) =>
          extractLegacyBotPresetCommand({
            baseRevision,
            presetId,
            mode,
          }),
      ],
      () => {
        rollbackBotPresetDelete(previousPreset, id)
        if (attemptedModelPreset) {
          rollbackSplitPresetCreate('model', attemptedModelPreset)
        }
        if (attemptedPromptPreset) {
          rollbackSplitPresetCreate('prompt', attemptedPromptPreset)
        }
        rollbackBotPresetSelection(selectionRollback)
      },
    )
  })
}

function movedSelectedIndex(currentId: number, fromIndex: number, adjustedToIndex: number): number {
  if (currentId === fromIndex) return adjustedToIndex
  if (fromIndex < currentId && adjustedToIndex >= currentId) return currentId - 1
  if (fromIndex > currentId && adjustedToIndex <= currentId) return currentId + 1
  return currentId
}

const MODEL_PRESET_DATABASE_KEY_OVERRIDES: Record<string, string> = {
  NAISettings: databaseKeyForModelPresetField('NAISettings'),
  reasonEffort: databaseKeyForModelPresetField('reasonEffort'),
}

const PROMPT_PRESET_APPLY_FIELDS = PROMPT_PRESET_FIELDS.filter((field) => field !== 'regex' && field !== 'presetRegex')

const PROMPT_PRESET_DATABASE_KEY_OVERRIDES: Record<string, string> = {}

export function applyModelPresetFieldsToDatabase(db: Database, preset: ModelPreset | undefined): void {
  applySplitPresetFieldsToDatabase(db, preset, MODEL_PRESET_FIELDS, MODEL_PRESET_DATABASE_KEY_OVERRIDES)
  applyPromptPresetFieldsToDatabase(db, db.promptPresets?.[db.promptPresetsId])
  normalizeModelRoleSettings(db)
  normalizeModelProfileSettings(db)
  db.fallbackModels = normalizeLegacyFallbackModels(db.fallbackModels)
  normalizeSeperateParameters(db)
}

export function applyPromptPresetFieldsToDatabase(db: Database, preset: PromptPreset | undefined): void {
  applySplitPresetFieldsToDatabase(db, preset, PROMPT_PRESET_APPLY_FIELDS, PROMPT_PRESET_DATABASE_KEY_OVERRIDES)
  applyPromptPresetRegexFieldToDatabase(db, preset)
  if (promptPresetOverridesModelParameters(preset)) {
    applySplitPresetFieldsToDatabase(
      db,
      preset,
      PROMPT_PRESET_MODEL_PARAMETER_OVERRIDE_FIELDS,
      MODEL_PRESET_DATABASE_KEY_OVERRIDES,
    )
  }
  applySplitPresetFieldsToDatabase(
    db,
    preset,
    PROMPT_PRESET_MODEL_OTHERS_OVERRIDE_FIELDS,
    MODEL_PRESET_DATABASE_KEY_OVERRIDES,
  )
  normalizeModelRoleSettings(db)
  normalizeModelProfileSettings(db)
  db.fallbackModels = normalizeLegacyFallbackModels(db.fallbackModels)
  normalizeSeperateParameters(db)
}

function applyPromptPresetRegexFieldToDatabase(db: Database, preset: PromptPreset | undefined): void {
  const regexField = resolvePromptPresetRegexField(preset)
  if (!regexField.present) return
  const target = db as unknown as Record<string, unknown>
  target.presetRegex = safeStructuredClone(regexField.value)
}

function applySplitPresetFieldsToDatabase(
  db: Database,
  preset: Record<string, unknown> | undefined,
  fields: readonly string[],
  databaseKeyOverrides: Record<string, string>,
): void {
  if (!preset) return
  const target = db as unknown as Record<string, unknown>
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(preset, field)) continue
    const databaseKey = databaseKeyOverrides[field] ?? field
    target[databaseKey] = normalizeSplitPresetAppliedValue(databaseKey, safeStructuredClone(preset[field]))
  }
}

function normalizeSplitPresetAppliedValue(databaseKey: string, value: unknown): unknown {
  if (databaseKey === 'modelProfiles') return normalizeModelProfiles(value)
  if (databaseKey === 'modelRoleProfiles') return normalizeModelRoleProfiles(value)
  if (databaseKey === 'modelRuntimeDefaults') return normalizeModelRuntimeDefaults(value)
  return value
}

export function setPreset(db: Database, newPres: botPreset) {
  db.apiType = newPres.apiType ?? db.apiType
  db.localNetworkMode = newPres.localNetworkMode ?? db.localNetworkMode
  db.localNetworkTimeoutSec = newPres.localNetworkTimeoutSec ?? db.localNetworkTimeoutSec
  db.additionalParams = safeStructuredClone(newPres.additionalParams) ?? db.additionalParams
  db.mainPrompt = newPres.mainPrompt ?? db.mainPrompt
  db.jailbreak = newPres.jailbreak ?? db.jailbreak
  db.globalNote = newPres.globalNote ?? db.globalNote
  db.temperature = newPres.temperature ?? db.temperature
  db.maxContext = newPres.maxContext ?? db.maxContext
  db.maxResponse = newPres.maxResponse ?? db.maxResponse
  db.frequencyPenalty = newPres.frequencyPenalty ?? db.frequencyPenalty
  db.PresensePenalty = newPres.PresensePenalty ?? db.PresensePenalty
  db.formatingOrder = newPres.formatingOrder ?? db.formatingOrder
  db.aiModel = newPres.aiModel ?? db.aiModel
  db.subModel = newPres.subModel ?? db.subModel
  db.modelRoles = normalizeModelRoleOverrides(newPres.modelRoles ?? db.modelRoles)
  db.modelProfiles = normalizeModelProfiles(newPres.modelProfiles ?? db.modelProfiles)
  db.modelRoleProfiles = normalizeModelRoleProfiles(newPres.modelRoleProfiles ?? db.modelRoleProfiles)
  db.modelRuntimeDefaults = normalizeModelRuntimeDefaults(newPres.modelRuntimeDefaults ?? db.modelRuntimeDefaults)
  db.currentPluginProvider = newPres.currentPluginProvider ?? db.currentPluginProvider
  db.textgenWebUIStreamURL = newPres.textgenWebUIStreamURL ?? db.textgenWebUIStreamURL
  db.textgenWebUIBlockingURL = newPres.textgenWebUIBlockingURL ?? db.textgenWebUIBlockingURL
  db.forceReplaceUrl = newPres.forceReplaceUrl ?? db.forceReplaceUrl
  db.promptPreprocess = newPres.promptPreprocess ?? db.promptPreprocess
  db.bias = newPres.bias ?? db.bias
  db.koboldURL = newPres.koboldURL ?? db.koboldURL
  db.proxyKey = newPres.proxyKey ?? db.proxyKey
  db.ooba = safeStructuredClone(newPres.ooba ?? db.ooba)
  db.ainconfig = safeStructuredClone(newPres.ainconfig ?? db.ainconfig)
  db.openrouterRequestModel = newPres.openrouterRequestModel ?? db.openrouterRequestModel
  db.proxyRequestModel = newPres.proxyRequestModel ?? db.proxyRequestModel
  db.NAIsettings = newPres.NAISettings ?? db.NAIsettings
  db.autoSuggestPrompt = newPres.autoSuggestPrompt ?? db.autoSuggestPrompt
  db.autoSuggestPrefix = newPres.autoSuggestPrefix ?? db.autoSuggestPrefix
  db.autoSuggestClean = newPres.autoSuggestClean ?? db.autoSuggestClean
  db.NAIadventure = newPres.NAIadventure
  db.NAIappendName = newPres.NAIappendName
  db.NAIsettings.cfg_scale ??= 1
  db.NAIsettings.mirostat_tau ??= 0
  db.NAIsettings.mirostat_lr ??= 1
  db.localStopStrings = newPres.localStopStrings
  db.customProxyRequestModel = newPres.customProxyRequestModel ?? ''
  db.reverseProxyOobaArgs = safeStructuredClone(newPres.reverseProxyOobaArgs) ?? {
    mode: 'instruct',
  }
  db.top_p = newPres.top_p ?? 1
  db.promptSettings = safeStructuredClone(newPres.promptSettings) ?? {
    assistantPrefill: '',
    postEndInnerFormat: '',
    sendChatAsSystem: false,
    sendName: false,
    utilOverride: false,
  }
  db.promptSettings.maxThoughtTagDepth ??= -1
  db.repetition_penalty = newPres.repetition_penalty
  db.min_p = newPres.min_p
  db.top_a = newPres.top_a
  db.openrouterProvider = newPres.openrouterProvider
  db.useInstructPrompt = newPres.useInstructPrompt ?? false
  db.customPromptTemplateToggle = newPres.customPromptTemplateToggle ?? ''
  db.templateDefaultVariables = newPres.templateDefaultVariables ?? ''
  db.moduleIntergration = newPres.moduleIntergration ?? ''
  db.top_k = newPres.top_k ?? db.top_k
  db.instructChatTemplate = newPres.instructChatTemplate ?? db.instructChatTemplate
  db.JinjaTemplate = newPres.JinjaTemplate ?? db.JinjaTemplate
  db.jsonSchemaEnabled = newPres.jsonSchemaEnabled ?? false
  db.jsonSchema = newPres.jsonSchema ?? ''
  db.strictJsonSchema = newPres.strictJsonSchema ?? true
  db.extractJson = newPres.extractJson ?? ''
  db.seperateParametersEnabled = newPres.seperateParametersEnabled ?? false
  db.customAPIFormat = safeStructuredClone(newPres.customAPIFormat) ?? LLMFormat.OpenAICompatible
  db.systemContentReplacement = newPres.systemContentReplacement ?? ''
  db.systemRoleReplacement = newPres.systemRoleReplacement ?? 'user'
  db.customFlags = safeStructuredClone(newPres.customFlags) ?? []
  db.enableCustomFlags = newPres.enableCustomFlags ?? false
  const presetRegexField = resolvePromptPresetRegexField(newPres)
  db.presetRegex = (presetRegexField.present ? safeStructuredClone(presetRegexField.value) : []) as customscript[]
  db.reasoningEffort = newPres.reasonEffort ?? 0
  db.thinkingTokens = newPres.thinkingTokens ?? null
  db.thinkingType = newPres.thinkingType ?? 'budget'
  db.deepseekThinkingType = newPres.deepseekThinkingType ?? 'off'
  db.adaptiveThinkingEffort = newPres.adaptiveThinkingEffort ?? 'high'
  db.deepseekReasoningEffort = newPres.deepseekReasoningEffort ?? 'high'
  db.outputImageModal = newPres.outputImageModal ?? false
  if (!db.doNotChangeSeperateModels) {
    db.seperateModelsForAxModels = newPres.seperateModelsForAxModels ?? false
    db.seperateModels = normalizeLegacySeperateModels(newPres.seperateModels)
  }
  if (!db.doNotChangeFallbackModels) {
    db.fallbackModels = normalizeLegacyFallbackModels(newPres.fallbackModels)
    db.fallbackWhenBlankResponse = newPres.fallbackWhenBlankResponse ?? false
  }
  if (db.disableSeperateParameterChangeOnPresetChange) {
    db.seperateParameters = safeStructuredClone(db.seperateParameters)
  } else {
    db.seperateParameters = safeStructuredClone(newPres.seperateParameters)
  }
  normalizeSeperateParameters(db)
  db.modelTools = safeStructuredClone(newPres.modelTools ?? [])
  db.verbosity = newPres.verbosity ?? 1
  db.dynamicOutput = newPres.dynamicOutput

  return db
}

import { encode as encodeMsgpack, decode as decodeMsgpack } from 'msgpackr/index-no-eval'
import * as fflate from 'fflate'
import type { OnnxModelFiles } from '../process/transformers'
import type { RisuModule } from '../process/modules'
import { decodeRPack, encodeRPack } from '../rpack/rpack_js'
import { DBState, selectedCharID } from '../stores.svelte'
import { LLMFlags, LLMFormat, LLMTokenizer } from '../model/modellist'
import type { HypaModel } from '../process/memory/hypamemory'
import type { SerializableHypaV3Data } from '../process/memory/hypav3'
import { defaultHotkeys, type Hotkey } from '../defaulthotkeys'
import type { OpenAIChat } from '../process/index.svelte'
import type { Loadout } from '../loadout'

export async function downloadPreset(id: number, type: 'json' | 'risupreset' | 'return' = 'json') {
  let db = getDatabase()
  let pres = promptPresetExportPayload(safeStructuredClone(db.promptPresets[id]))
  pres.openAIKey = ''
  pres.forceReplaceUrl = ''
  pres.forceReplaceUrl2 = ''
  pres.proxyKey = ''
  pres.textgenWebUIStreamURL = ''
  pres.textgenWebUIBlockingURL = ''

  if (type === 'json') {
    downloadFile(pres.name + '_preset.json', Buffer.from(JSON.stringify(pres, null, 2)))
  } else if (type === 'risupreset' || type === 'return') {
    const buf = fflate.compressSync(
      encodeMsgpack({
        presetVersion: 2,
        type: 'preset',
        preset: await encryptBuffer(encodeMsgpack(pres), 'risupreset'),
      }),
    )

    const buf2 = await encodeRPack(buf)

    if (type === 'risupreset') {
      downloadFile(pres.name + '_preset.risup', buf2)
    } else {
      return {
        data: pres,
        buf: buf2,
      }
    }
  }

  alertNormal(language.successExport)

  return {
    data: pres,
    buf: null,
  }
}

export async function importPreset(
  f: {
    name: string
    data: Uint8Array
  } | null = null,
) {
  if (!f) {
    f = await selectSingleFile(['json', 'preset', 'risupreset', 'risup'])
  }
  if (!f) {
    return
  }
  let pre: any
  if (f.name.endsWith('.risupreset') || f.name.endsWith('.risup')) {
    let data = f.data
    if (f.name.endsWith('.risup')) {
      data = await decodeRPack(data)
    }
    const decoded = await decodeMsgpack(fflate.decompressSync(data))
    if ((decoded.presetVersion === 0 || decoded.presetVersion === 2) && decoded.type === 'preset') {
      pre = {
        ...presetTemplate,
        ...decodeMsgpack(Buffer.from(await decryptBuffer(decoded.preset ?? decoded.pres, 'risupreset'))),
      }
    }
  } else {
    pre = { ...presetTemplate, ...JSON.parse(Buffer.from(f.data).toString('utf-8')) }
  }
  let db = DBState.db
  if (pre.presetVersion && pre.presetVersion >= 3) {
    //NAI preset
    const pr = safeStructuredClone(prebuiltPresets.NAI)
    pr.temperature = pre.parameters.temperature * 100
    pr.maxResponse = pre.parameters.max_length
    pr.NAISettings.topK = pre.parameters.top_k
    pr.NAISettings.topP = pre.parameters.top_p
    pr.NAISettings.topA = pre.parameters.top_a
    pr.NAISettings.typicalp = pre.parameters.typical_p
    pr.NAISettings.tailFreeSampling = pre.parameters.tail_free_sampling
    pr.NAISettings.repetitionPenalty = pre.parameters.repetition_penalty
    pr.NAISettings.repetitionPenaltyRange = pre.parameters.repetition_penalty_range
    pr.NAISettings.repetitionPenaltySlope = pre.parameters.repetition_penalty_slope
    pr.NAISettings.frequencyPenalty = pre.parameters.repetition_penalty_frequency
    pr.NAISettings.repostitionPenaltyPresence = pre.parameters.repetition_penalty_presence
    pr.PresensePenalty = pre.parameters.repetition_penalty_presence * 100
    pr.NAISettings.cfg_scale = pre.parameters.cfg_scale
    pr.NAISettings.mirostat_lr = pre.parameters.mirostat_lr
    pr.NAISettings.mirostat_tau = pre.parameters.mirostat_tau
    pr.name = pre.name ?? 'Imported'
    addImportedPromptPreset(pr)
    return
  }

  if (Array.isArray(pre?.prompt_order?.[0]?.order) && Array.isArray(pre?.prompts)) {
    //ST preset
    const pr = safeStructuredClone(presetTemplate)
    pr.promptTemplate = []

    function findPrompt(identifier: number) {
      return pre.prompts.find((p: any) => p.identifier === identifier)
    }
    pr.temperature = (pre.temperature ?? 0.8) * 100
    pr.frequencyPenalty = (pre.frequency_penalty ?? 0.7) * 100
    pr.PresensePenalty = pre.presence_penalty * 0.7 * 100
    pr.top_p = pre.top_p ?? 1

    for (const prompt of pre.prompt_order[0].order) {
      if (!prompt?.enabled) {
        continue
      }
      const p = findPrompt(prompt?.identifier ?? '')
      if (p) {
        switch (p.identifier) {
          case 'main': {
            pr.promptTemplate.push({
              type: 'plain',
              type2: 'main',
              text: p.content ?? '',
              role: p.role ?? 'system',
            })
            break
          }
          case 'jailbreak':
          case 'nsfw': {
            pr.promptTemplate.push({
              type: 'jailbreak',
              type2: 'normal',
              text: p.content ?? '',
              role: p.role ?? 'system',
            })
            break
          }
          case 'dialogueExamples':
          case 'charPersonality':
          case 'scenario': {
            break //ignore
          }
          case 'chatHistory': {
            pr.promptTemplate.push({
              type: 'chat',
              rangeEnd: 'end',
              rangeStart: 0,
            })
            break
          }
          case 'worldInfoBefore': {
            pr.promptTemplate.push({
              type: 'lorebook',
            })
            break
          }
          case 'worldInfoAfter': {
            break
          }
          case 'charDescription': {
            pr.promptTemplate.push({
              type: 'description',
            })
            break
          }
          case 'personaDescription': {
            pr.promptTemplate.push({
              type: 'persona',
            })
            break
          }
          default: {
            pr.promptTemplate.push({
              type: 'plain',
              type2: 'normal',
              text: p.content ?? '',
              role: p.role ?? 'system',
            })
          }
        }
      }
    }
    if (pre?.assistant_prefill) {
      pr.promptTemplate.push({
        type: 'postEverything',
      })
      pr.promptTemplate.push({
        type: 'plain',
        type2: 'main',
        text: `{{#if {{prefill_supported}}}}${pre?.assistant_prefill}{{/if}}`,
        role: 'bot',
      })
    }
    pr.name = 'Imported ST Preset'
    addImportedPromptPreset(pr)
    return
  }
  pre.name ??= 'Imported'
  if (!Array.isArray(db.botPresets)) {
    db.botPresets = []
  }
  addImportedPromptPreset(pre)
}
