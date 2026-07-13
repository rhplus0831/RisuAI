import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { DatabaseSync } from 'node:sqlite'
import type { AuthState } from '../auth.js'
import { getSchemaState } from '../db.js'
import {
  COMMAND_EVENT_CATALOG,
  PRESET_COLLECTION_WITH_POINTER_RESOURCE,
  PRESET_POINTER_RESOURCE,
  REVISION_ONLY_RESOURCE,
  SETTINGS_WITH_HYPA_V3_PRESETS_RESOURCE,
  type CommandEvent,
  type CommandEventOrigin,
  type CommandEventSink,
} from '../commands/events.js'
import {
  applyCharacterSelectionCommandMutation,
  applyJsonCommandMutation,
  applyMessageFreeJsonCommandMutation,
  applyTargetedCommandMutation,
  readBaseRevision,
  TARGETED_MUTATION_PATHS,
} from '../commands/mutations.js'
import { readActiveWriterSessionId } from '../activeWriter.js'
import { maskProviderSecrets, resolveMaskedProviderSecretPlaceholders } from '../providerSecrets.js'
import {
  normalizeLegacyFallbackModels,
  normalizeLegacySeperateModels,
  normalizeModelRoleOverrides,
} from '../../../../src/ts/model/modelRoles.js'
import {
  ModelProfileRecordValidationError,
  normalizeModelRuntimeDefaults,
  normalizeModelProfiles,
  normalizeModelRoleProfiles,
  readModelProfiles,
  readModelRuntimeDefaults,
  readModelRoleProfiles,
} from '../../../../src/ts/model/modelProfileRecords.js'
import { normalizeChatGenerationTogglePresets } from '../../../../src/ts/chatGenerationTogglePresetRecords.js'
import { normalizeAgentPresets } from '../../../../src/ts/agentPresetRecords.js'
import {
  createPromptItemRecord,
  ensurePromptTemplateCollection,
  readPromptItemId,
  readPromptSettingsPatch,
  requirePromptItemIndex,
  validateFullPromptItemIdList,
} from '../commands/prompts.js'
import {
  createPersonaRecord,
  ensureDatabaseObject as ensurePersonaDatabaseObject,
  ensurePersonaCollection,
  findPersonaIndex,
  mirrorLegacyProfile,
  readOptionalBoolean as readPersonaOptionalBoolean,
  readPersonaId,
  readPersonaPatch,
  requirePersonaIndex,
  saveSelectedPersonaSnapshot,
  selectedPersonaId,
  validateFullPersonaIdList,
} from '../commands/personas.js'
import {
  applyPreset,
  createPresetRecord,
  ensureDatabaseObject,
  ensurePresetCollection,
  findPresetIndex,
  normalizePresetAgentSettings,
  readJsonObject,
  readOptionalBoolean,
  readOptionalString,
  readPresetPatch,
  readPresetId,
  requirePresetIndex,
  saveCurrentPresetSnapshot,
  selectedPresetId,
  validateFullPresetIdList,
} from '../commands/presets.js'
import {
  applyModelPreset,
  applyPromptPreset,
  createModelPresetRecord,
  createPromptPresetRecord,
  ensureDatabaseObject as ensureSplitPresetDatabaseObject,
  ensureModelPresetCollection,
  ensurePromptPresetCollection,
  extractLegacyBotPreset,
  findModelPresetIndex,
  findPromptPresetIndex,
  promptPresetAppliesPromptTemplate,
  readModelPresetId,
  readModelPresetPatch,
  readPromptPresetId,
  readPromptPresetPatch,
  requireModelPresetIndex,
  requirePromptPresetIndex,
  resolveModelPresetMaskedSecrets,
  selectedModelPresetId,
  selectedPromptPresetId,
  validateFullModelPresetIdList,
  validateFullPromptPresetIdList,
  type LegacyBotPresetExtractionMode,
} from '../commands/splitPresets.js'
import {
  createTranslatorPresetRecord,
  ensureDatabaseObject as ensureTranslatorPresetDatabaseObject,
  ensureTranslatorPresetCollection,
  findTranslatorPresetIndex,
  readOptionalBoolean as readTranslatorPresetOptionalBoolean,
  readTranslatorPresetId,
  readTranslatorPresetPatch,
  requireTranslatorPresetIndex,
  selectedTranslatorPresetId,
  syncSelectedTranslatorPresetToLegacyFields,
} from '../commands/translatorPresets.js'
import {
  createLoadoutRecord,
  ensureDatabaseObject as ensureLoadoutDatabaseObject,
  ensureLoadoutCollection,
  findLoadoutIndex,
  readLoadoutId,
  readLoadoutPatch,
  readOptionalBoolean as readLoadoutOptionalBoolean,
  readOptionalCharacterId,
  readOptionalTimestamp,
  requireLoadoutIndex,
} from '../commands/loadouts.js'
import {
  type CharacterRecord,
  buildPatchedCharacterCollectionRow,
  createCharacterRecord,
  ensureCharacterCollection,
  ensureDatabaseObject as ensureCharacterDatabaseObject,
  findCharacterIndex,
  readCharacterId,
  readCharacterOrder,
  readCharacterPatch,
  requireCharacterIndex,
  selectedCharacterId,
  validateCharacterOrderAssetRefs,
  validateFullCharacterOrder,
} from '../commands/characters.js'
import {
  chatFolderIdExists,
  chatIdExists,
  createChatFolderRecord,
  createChatRecord,
  ensureCharacterChatFolders,
  ensureCharacterChats,
  normalizeAllCharacterChats,
  readChatFolderId,
  readChatFolderIdList,
  readChatFolderPatch,
  readChatGenerationSettingsSave,
  readChatId,
  readChatIdList,
  readChatPatch,
  readChatScriptstateDeleteKeys,
  readChatScriptstatePatch,
  readOptionalBoolean as readChatOptionalBoolean,
  readOptionalFolderByChatId,
  requireChatFolderIndex,
  requireChatLocation,
  selectChat,
  selectedChatId,
  validateChatScriptstateCommand,
  validateFullChatFolderOrder,
  validateFullChatOrder,
} from '../commands/chats.js'
import {
  createMessageRecord,
  readGenerationResult,
  readMessageId,
  readMessagePatch,
  readReplacementMessages,
  readTruncateAfterMessageId,
  type MessageRecord,
  validateUniqueMessageIds,
} from '../commands/messages.js'
import {
  deleteLorebookEntryById,
  ensureGlobalLorebookCollection,
  normalizeSelectedCharacterLorebooks,
  normalizeSelectedChatLorebooks,
  readCharacterId as readLorebookCharacterId,
  readChatId as readLorebookChatId,
  readGlobalLorebookPatch,
  readLorebookId,
  readLorebookIdList,
  readModuleId,
  reorderLorebookEntriesById,
  requireGlobalLorebookIndex,
  requireModule,
  upsertLorebookEntryById,
  validateFullLorebookOrder,
  validateGlobalLorebookCreate,
  validateLorebookEntries,
  validateLorebookEntryForId,
  type ModuleRecord as LorebookModuleRecord,
} from '../commands/lorebooks.js'
import {
  readCharacterScriptParent,
  readScriptDefinitions,
  readTriggerDefinitions,
} from '../commands/scriptDefinitions.js'
import {
  createModuleRecord,
  ensureEnabledModules,
  ensureModuleCommandDatabase,
  ensureModuleRecords,
  findCharacterForModuleCommand,
  readCharacterId as readModuleCharacterId,
  readModuleEnabled,
  readModuleId as readCommandModuleId,
  readModuleIdList,
  readModulePatch,
  removeModuleReferences,
  requireModuleIndex,
  validateCharacterModuleLinks,
  validateFullModuleOrder,
  validateNormalModuleLinks,
} from '../commands/modules.js'
import {
  convertLegacyModelProfilesCommand,
  createAndBindModelProfileCommand,
  createModelProfileCommand,
  deleteModelProfileCommand,
  duplicateModelProfileCommand,
  updateModelProfileCommand,
  updateModelRoleProfilesCommand,
  updateModelRuntimeDefaultsCommand,
} from '../commands/modelProfiles.js'
import {
  createAgentPresetCommand,
  createAgentPresetStepCommand,
  deleteAgentPresetCommand,
  deleteAgentPresetStepCommand,
  duplicateAgentPresetCommand,
  duplicateAgentPresetStepCommand,
  reorderAgentPresetsCommand,
  reorderAgentPresetStepsCommand,
  setAgentPresetDefaultCommand,
  updateAgentPresetCommand,
  updateAgentPresetStepCommand,
} from '../commands/agentPresets.js'
import {
  createPluginRecord,
  ensurePluginCommandDatabase,
  ensurePluginRecords,
  readPluginEnabled,
  readPluginId,
  readPluginIdList,
  readPluginPatch,
  readPluginProvider,
  requirePluginIndex,
  validateFullPluginOrder,
} from '../commands/plugins.js'
import {
  ensurePluginCustomStorage,
  ensurePluginStorageDatabase,
  readPluginStorageBulkPatch,
  readPluginStorageKey,
  readPluginStorageValue,
} from '../commands/pluginStorage.js'
import { validateOptionalServerAssetRef } from '../commands/assets.js'
import { requireAuth } from '../http.js'
import type { ChatGenerationSettings } from '../../../../src/ts/chatGenerationSettings.js'
import {
  activeMessageIdExistsOutsideChat,
  activeMessageIdExists,
  addAlternateMessage,
  appendChatMessage,
  clearAlternateMessages,
  deleteActiveMessageById,
  deleteChatHypaV3,
  deleteChatMessages,
  getChatMessages,
  replaceActiveChatMessages,
  resolveActiveMessageLocationById,
  setChatHypaV3,
  truncateActiveChatMessages,
  updateActiveMessageById,
  writeGenerationChatMessage,
} from '../messageStore.js'
import {
  deleteCharacterChatRow,
  deleteCharacterRow,
  deletePluginStorageKey,
  EntityNotFoundError,
  extractSettings,
  initializeDefaultDatabase,
  insertCharacterChatRow,
  loadPersistedForChatMutation,
  loadSettingsFromSqlite,
  replacePluginStorage,
  RevisionMismatchError,
  ValidationError,
  writeCharacterChatRows,
  writePluginStorageKey,
  writePromptTemplateRow,
  writePromptTemplatesTable,
  writeSettingsOnly,
  writeSingleCharacterRow,
  writeSingleChatRow,
  writeSingleChatRowExact,
  writeSingleCollectionRow,
  writeSingleCollectionTable,
} from '../repository.js'
import { createDetachedAbort } from '../requestAbort.js'
import { translateRawMessageData, type RawMessageTranslation } from '../translation/rawMessageTranslation.js'
import type { MessageTranslationJobRegistry } from '../messageTranslationJobs.js'

function commandEventOrigin(req: FastifyRequest): CommandEventOrigin | undefined {
  const writerSessionId = readActiveWriterSessionId(req)
  return writerSessionId ? { writerSessionId } : undefined
}

function commandMutationContext(req: FastifyRequest, eventSink: CommandEventSink) {
  const origin = commandEventOrigin(req)
  return origin ? { eventSink, eventOrigin: origin } : { eventSink }
}

function emitCommandEventForRequest(req: FastifyRequest, eventSink: CommandEventSink, event: CommandEvent): void {
  const origin = commandEventOrigin(req)
  eventSink.emit(origin ? { ...event, origin } : event)
}

function readLiveMessageSource(
  db: DatabaseSync,
  messageId: string,
): {
  chatId: string
  data: string
} {
  const resolved = resolveActiveMessageLocationById(db, messageId)
  if (resolved.ok === false) {
    if (resolved.reason === 'ambiguous') {
      throw new ValidationError(`Ambiguous message id: ${messageId}`)
    }
    throw new EntityNotFoundError(`Message not found: ${messageId}`)
  }
  const data = resolved.location.message.data
  if (typeof data !== 'string') {
    throw new ValidationError(`Message data for ${messageId} must be a string`)
  }
  return {
    chatId: resolved.location.chatId,
    data,
  }
}

/** Coerce a value to an array for a collection-table write (mirrors the broad
 *  path, which treats a non-array collection field as empty). */
function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : []
}

function readGlobalLorebookCommandTarget(database: unknown): {
  target: Record<string, unknown>
  lorebooks: ReturnType<typeof ensureGlobalLorebookCollection>
} {
  const target = readJsonObject(database, 'database')
  // Global lorebook commands persist only the global collection/settings; child
  // lorebook repair would be validate-only here, so leave it to broad import paths.
  const lorebooks = ensureGlobalLorebookCollection(target)
  return { target, lorebooks }
}

function readScriptDefinitionCommandTarget(database: unknown): Record<string, unknown> {
  // Incoming script/trigger payloads are strictly validated before mutation.
  // The corpus-wide script-definition repair is validate-only for these routes.
  return readJsonObject(database, 'database')
}

function readModuleCollectionCommandTarget(database: unknown): {
  target: Record<string, unknown>
  modules: LorebookModuleRecord[]
} {
  const target = readJsonObject(database, 'database')
  const modules = Array.isArray(target.modules)
    ? (target.modules.map((candidate, index) =>
        readJsonObject(candidate, `module[${index}]`),
      ) as LorebookModuleRecord[])
    : []
  target.modules = modules
  return { target, modules }
}

function characterOrderIncludes(order: readonly unknown[], characterId: string): boolean {
  return order.some((entry) => {
    if (entry === characterId) return true
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false
    const data = (entry as Record<string, unknown>).data
    return Array.isArray(data) && data.includes(characterId)
  })
}

function characterOrderWithout(order: readonly unknown[], characterId: string): unknown[] {
  const next: unknown[] = []
  for (const entry of order) {
    if (entry === characterId) continue
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      next.push(entry)
      continue
    }
    const folder = entry as Record<string, unknown>
    const data = Array.isArray(folder.data) ? folder.data.filter((id) => id !== characterId) : folder.data
    if (Array.isArray(data) && data.length === 0) continue
    next.push({ ...folder, data })
  }
  return next
}

function updateCharacterOrderForPatchedRow(
  target: Record<string, unknown>,
  characterId: string,
  character: Record<string, unknown>,
): void {
  const currentOrder = Array.isArray(target.characterOrder) ? target.characterOrder : []
  const active = !character.trashTime && characterId !== '§temp'
  if (!active) {
    target.characterOrder = characterOrderWithout(currentOrder, characterId)
    return
  }
  target.characterOrder = characterOrderIncludes(currentOrder, characterId)
    ? currentOrder
    : [...currentOrder, characterId]
}

function applySelectedPromptPresetAfterModelPreset(target: Record<string, unknown>): void {
  const promptPresets = ensurePromptPresetCollection(target)
  const promptPresetIndex = Number.isInteger(target.promptPresetsId as number) ? (target.promptPresetsId as number) : -1
  const promptPreset = promptPresetIndex >= 0 ? promptPresets[promptPresetIndex] : undefined
  if (promptPreset) {
    applyPromptPreset(target, promptPreset)
  }
}

/** The shared narrow write for every translator-preset route: a full
 *  `translator_presets` rewrite plus an unconditional `settings` write.
 *  `ensureTranslatorPresetCollection` reassigns the whole array and re-syncs the
 *  `translatorPrompt` / `translatorMaxResponse` / `translatorPresetId` settings
 *  scalars on every call, so both writes are faithful (not over-broad) for create,
 *  patch, delete, and select alike. */
function writeTranslatorPresetMutation(
  db: DatabaseSync,
  target: Record<string, unknown>,
  presets: readonly unknown[],
): void {
  writeSingleCollectionTable(db, 'translatorPresets', presets)
  writeSettingsOnly(db, extractSettings(target))
}

/** The shared narrow write for every loadouts route: a full `loadouts` rewrite
 *  (`ensureLoadoutCollection` reassigns the whole array by design, so even a
 *  field edit is a faithful one-table rewrite) plus a `settings` write only when
 *  `lastLoadedLoadoutName` actually moved (touch sets it; the rest leave it). */
function writeLoadoutMutation(
  db: DatabaseSync,
  target: Record<string, unknown>,
  loadouts: readonly unknown[],
  beforeLastLoaded: unknown,
): void {
  writeSingleCollectionTable(db, 'loadouts', loadouts)
  if (target.lastLoadedLoadoutName !== beforeLastLoaded) {
    writeSettingsOnly(db, extractSettings(target))
  }
}

/** Full `lore_books` rewrite (create/delete/reorder change the array) plus a
 *  `settings` write only when the `loreBookPage` pointer moved. Child lorebook
 *  repair is intentionally left to broad import/restore normalization. */
function writeLorebookTableMutation(
  db: DatabaseSync,
  target: Record<string, unknown>,
  lorebooks: readonly unknown[],
  beforeLoreBookPage: unknown,
): void {
  writeSingleCollectionTable(db, 'loreBook', lorebooks)
  if (target.loreBookPage !== beforeLoreBookPage) {
    writeSettingsOnly(db, extractSettings(target))
  }
}

function buildChatGenerationSettingsValidationContext(
  target: Record<string, unknown>,
  character: CharacterRecord,
  chat: Record<string, unknown>,
) {
  const characterModuleIds = Array.isArray(character.modules)
    ? character.modules.filter((id): id is string => typeof id === 'string')
    : []
  const chatModuleIds = Array.isArray(chat.modules)
    ? chat.modules.filter((id): id is string => typeof id === 'string')
    : []

  return {
    personas: ensurePersonaCollection(target),
    modelPresets: ensureModelPresetCollection(target),
    promptPresets: ensurePromptPresetCollection(target),
    agentPresets: normalizeAgentPresets(target.agentPresets),
    modules: ensureModuleRecords(target),
    enabledModuleIds: ensureEnabledModules(target),
    characterModuleIds,
    chatModuleIds,
  }
}

function cloneChatGenerationSettings(settings: ChatGenerationSettings | undefined): ChatGenerationSettings | undefined {
  if (!settings) return undefined
  return {
    ...settings,
    ...(settings.sidebarToggles ? { sidebarToggles: { ...settings.sidebarToggles } } : {}),
  }
}

function readOptionalPromptPresetIdFromBody(body: PromptCommandBody): string | undefined {
  return body.promptPresetId === undefined ? undefined : readPromptPresetId(body.promptPresetId, 'promptPresetId')
}

function requireSelectedPromptPresetCommandTarget(
  database: unknown,
  promptPresetId: string,
): {
  preset: ReturnType<typeof ensurePromptPresetCollection>[number]
  index: number
  items: ReturnType<typeof ensurePromptTemplateCollection>
} {
  const target = ensureSplitPresetDatabaseObject(database)
  const presets = ensurePromptPresetCollection(target)
  const index = requirePromptPresetIndex(presets, promptPresetId)
  const selectedId = selectedPromptPresetId(target, presets)
  if (selectedId !== promptPresetId) {
    throw new ValidationError(`Selected prompt preset changed before command reached the server: ${promptPresetId}`)
  }
  const preset = presets[index]
  const items = ensurePromptTemplateCollection(preset)
  return { preset, index, items }
}

const COLLECTION_SCOPED_READS = {
  // Selected model-preset mutations reapply the selected prompt preset's
  // model overrides after the base model fields, so both collections must be
  // resident in the targeted mutation snapshot.
  modelPresets: ['modelPresets', 'promptPresets'],
  promptPresets: ['promptPresets'],
  legacyBotPresetExtraction: ['botPresets', 'modelPresets', 'promptPresets'],
  presets: ['botPresets'],
  personas: ['personas'],
  translatorPresets: ['translatorPresets'],
  loadouts: ['loadouts'],
  lorebooks: ['loreBook'],
  modules: ['modules'],
  plugins: ['plugins'],
} as const

interface RuntimeSettingsCommandBody {
  baseRevision?: unknown
  patch?: unknown
}

interface PresetCommandBody {
  baseRevision?: unknown
  preset?: unknown
  patch?: unknown
  presetId?: unknown
  newPresetId?: unknown
  presetIds?: unknown
  apply?: unknown
  saveCurrent?: unknown
  name?: unknown
}

interface ModelPresetCommandBody {
  baseRevision?: unknown
  preset?: unknown
  patch?: unknown
  modelPresetId?: unknown
  modelPresetIds?: unknown
  selectModelPresetId?: unknown
}

interface PromptPresetCommandBody {
  baseRevision?: unknown
  preset?: unknown
  patch?: unknown
  promptPresetId?: unknown
  promptPresetIds?: unknown
  selectPromptPresetId?: unknown
}

interface LegacyBotPresetCommandBody {
  baseRevision?: unknown
  mode?: unknown
}

interface PromptCommandBody {
  baseRevision?: unknown
  promptItem?: unknown
  patch?: unknown
  itemIds?: unknown
  enabled?: unknown
  promptPresetId?: unknown
}

interface PersonaCommandBody {
  baseRevision?: unknown
  persona?: unknown
  patch?: unknown
  personaId?: unknown
  selectPersonaId?: unknown
  personaIds?: unknown
  mirrorLegacyProfile?: unknown
  saveCurrent?: unknown
}

interface TranslatorPresetCommandBody {
  baseRevision?: unknown
  preset?: unknown
  patch?: unknown
  presetId?: unknown
  selectPresetId?: unknown
  select?: unknown
}

interface LoadoutCommandBody {
  baseRevision?: unknown
  loadout?: unknown
  patch?: unknown
  favorite?: unknown
  lastUsed?: unknown
  characterId?: unknown
}

interface CharacterCommandBody {
  baseRevision?: unknown
  character?: unknown
  patch?: unknown
  characterId?: unknown
  characterIds?: unknown
  characterOrder?: unknown
  lastInteraction?: unknown
}

interface ChatCommandBody {
  baseRevision?: unknown
  chat?: unknown
  generationSettings?: unknown
  patch?: unknown
  deleteKeys?: unknown
  chatIds?: unknown
  folderByChatId?: unknown
  selectedChatId?: unknown
  select?: unknown
  folder?: unknown
  sourcePatch?: unknown
}

interface ChatFolderCommandBody {
  baseRevision?: unknown
  folder?: unknown
  patch?: unknown
  folderIds?: unknown
  selectedChatId?: unknown
}

interface MessageCommandBody {
  baseRevision?: unknown
  message?: unknown
  patch?: unknown
  messages?: unknown
  afterMessageId?: unknown
  preserveRemovedAsAlternates?: unknown
  generationResult?: unknown
}

function readOptionalBooleanFlag(value: unknown, label: string): boolean {
  if (value === undefined || value === null) return false
  if (typeof value !== 'boolean') {
    throw new ValidationError(`${label} must be a boolean when provided`)
  }
  return value
}

interface ScriptDefinitionCommandBody {
  baseRevision?: unknown
  scripts?: unknown
  triggers?: unknown
}

interface ModuleCommandBody {
  baseRevision?: unknown
  module?: unknown
  patch?: unknown
  moduleId?: unknown
  moduleIds?: unknown
  enabled?: unknown
}

interface PluginCommandBody {
  baseRevision?: unknown
  plugin?: unknown
  patch?: unknown
  pluginId?: unknown
  pluginIds?: unknown
  provider?: unknown
  enabled?: unknown
}

interface PluginStorageCommandBody {
  baseRevision?: unknown
  value?: unknown
  values?: unknown
  deleteKeys?: unknown
  clear?: unknown
}

export const SETTINGS_GROUPS = [
  'providers',
  'runtime',
  'display',
  'language',
  'media',
  'memory',
  'advanced',
  'sidebar',
  'account',
] as const

export type SettingsGroup = (typeof SETTINGS_GROUPS)[number]
type SettingValueKind = 'boolean' | 'number' | 'string' | 'stringOrNull' | 'object' | 'array' | 'arrayOrNull' | 'json'

export const SETTINGS_GROUP_KEYS: Record<SettingsGroup, readonly string[]> = {
  providers: [
    'apiType',
    'openAIKey',
    'proxyKey',
    'bias',
    'additionalParams',
    'aiModel',
    'subModel',
    'modelRoles',
    'modelProfiles',
    'modelRoleProfiles',
    'modelRuntimeDefaults',
    'textgenWebUIStreamURL',
    'textgenWebUIBlockingURL',
    'hordeConfig',
    'novelai',
    'claudeAPIKey',
    'openrouterRequestModel',
    'openrouterKey',
    'openrouterMiddleOut',
    'openrouterFallback',
    'openrouterProvider',
    'useInstructPrompt',
    'instructChatTemplate',
    'JinjaTemplate',
    'nanogptKey',
    'nanogptRequestModel',
    'nanogptRequestModelName',
    'nanogptProvider',
    'nanogptSubscriptionState',
    'nanogptUseSubscriptionEndpoint',
    'customProxyRequestModel',
    'customAPIFormat',
    'proxyRequestModel',
    'mancerHeader',
    'reverseProxyOobaMode',
    'reverseProxyOobaArgs',
    'koboldURL',
    'ooba',
    'ainconfig',
    'NAIsettings',
    'NAIadventure',
    'NAIappendName',
    'huggingfaceKey',
    'cohereAPIKey',
    'ollamaURL',
    'ollamaModel',
    'ollamaModelSource',
    'ollamaInputMode',
    'ollamaRequestFormat',
    'ollamaApiKey',
    'ollamaModelName',
    'ollamaCloudModel',
    'ollamaCloudModelName',
    'ollamaThinkingMode',
    'google',
    'mistralKey',
    'claudeAws',
    'claudeCachingExperimental',
    'claudeRetrivalCaching',
    'claude1HourCaching',
    'claudeBatching',
    'vertexPrivateKey',
    'vertexClientEmail',
    'vertexAccessToken',
    'vertexAccessTokenExpires',
    'vertexRegion',
    'OaiCompAPIKeys',
    'authRefreshes',
    'customModels',
    'dynamicModelRegistry',
    'modelTools',
    'currentPluginProvider',
    'forceReplaceUrl',
    'novellistAPI',
    'customTokenizer',
    'echoMessage',
    'echoDelay',
  ],
  runtime: [
    'useStreaming',
    'streamGeminiThoughts',
    'maxContext',
    'maxResponse',
    'generationSeed',
    'temperature',
    'frequencyPenalty',
    'PresensePenalty',
    'top_p',
    'top_k',
    'min_p',
    'top_a',
    'repetition_penalty',
    'thinkingType',
    'deepseekThinkingType',
    'thinkingTokens',
    'adaptiveThinkingEffort',
    'deepseekReasoningEffort',
    'reasoningEffort',
    'verbosity',
    'fallbackModels',
    'doNotChangeFallbackModels',
    'fallbackWhenBlankResponse',
    'seperateModelsForAxModels',
    'seperateModels',
    'doNotChangeSeperateModels',
    'seperateParametersEnabled',
    'seperateParameters',
    'seperateParametersByModel',
    'disableSeperateParameterChangeOnPresetChange',
    'epEnabled',
    'requestRetrys',
    'genTime',
    'requestLocation',
    'localNetworkMode',
    'localNetworkTimeoutSec',
    'usePlainFetch',
    'antiServerOverloads',
    'antiClaudeOverload',
    'autoContinueChat',
    'autoContinueMinTokens',
    'removeIncompleteResponse',
    'localStopStrings',
    'newOAIHandle',
    'googleClaudeTokenizing',
    'automaticCachePoint',
    'chainOfThought',
    'rememberToolUsage',
    'simplifiedToolUse',
    'useAutoSuggestions',
  ],
  display: [
    'theme',
    'guiHTML',
    'waifuWidth',
    'waifuWidth2',
    'textTheme',
    'customTextTheme',
    'font',
    'customFont',
    'zoomsize',
    'lineHeight',
    'iconsize',
    'textAreaSize',
    'textAreaTextSize',
    'sideBarSize',
    'assetWidth',
    'animationSpeed',
    'chatDisplayTailCount',
    'memoryLimitThickness',
    'settingsCloseButtonSize',
    'fullScreen',
    'showMemoryLimit',
    'showFirstMessagePages',
    'hideRealm',
    'hideAllImages',
    'showFolderName',
    'playMessage',
    'playMessageOnTranslateEnd',
    'roundIcons',
    'textScreenColor',
    'textBorder',
    'textScreenRounded',
    'textScreenBorder',
    'showSavingIcon',
    'showPromptComparison',
    'promptDiffPrefs',
    'useChatCopy',
    'useAdditionalAssetsPreview',
    'useLegacyGUI',
    'hideApiKey',
    'unformatQuotes',
    'blockquoteStyling',
    'customQuotes',
    'customQuotesData',
    'menuSideBar',
    'notification',
    'useChatSticker',
    'customCSS',
    'customGUI',
    'colorScheme',
    'colorSchemeName',
    'customBackground',
    'classicMaxWidth',
    'heightMode',
  ],
  language: [
    'language',
    'translator',
    'translatorType',
    'translatorInputLanguage',
    'htmlTranslation',
    'autoTranslate',
    'combineTranslation',
    'legacyTranslation',
    'translateBeforeHTMLFormatting',
    'autoTranslateCachedOnly',
    'useAutoTranslateInput',
    'inputTranslatorPrompt',
    'translatorPrompt',
    'translatorMaxResponse',
    'deeplOptions',
    'deeplXOptions',
    'noWaitForTranslate',
    'translateBeforeHTMLFormatting',
    'showTranslationLoading',
    'useExperimentalGoogleTranslator',
  ],
  media: [
    'sdProvider',
    'webUiUrl',
    'sdSteps',
    'sdCFG',
    'sdConfig',
    'NAIImgUrl',
    'NAIApiKey',
    'NAIImgModel',
    'NAII2I',
    'NAIREF',
    'NAIImgConfig',
    'gptVisionQuality',
    'imageCompression',
    'dynamicAssets',
    'dynamicAssetsEditDisplay',
    'newImageHandlingBeta',
    'legacyMediaFindings',
    'outputImageModal',
    'dallEQuality',
    'stabilityModel',
    'stabilityKey',
    'stabllityStyle',
    'comfyConfig',
    'comfyUiUrl',
    'falToken',
    'falModel',
    'falLora',
    'falLoraName',
    'falLoraScale',
    'ImagenModel',
    'ImagenImageSize',
    'ImagenAspectRatio',
    'ImagenPersonGeneration',
    'openaiCompatImage',
    'wavespeedImage',
    'elevenLabKey',
    'voicevoxUrl',
    'fishSpeechKey',
    'ttsAutoSpeech',
    'emotionProcesser',
  ],
  memory: [
    'supaMemoryKey',
    'hypaV3Key',
    'hypaMemoryKey',
    'voyageApiKey',
    'hypaModel',
    'removePunctuationHypa',
    'hypaV3',
    'hypaV3Settings',
    'hypaV3Presets',
    'hypaV3PresetId',
    'hypaCustomSettings',
    'showMenuHypaMemoryModal',
  ],
  advanced: [
    'loreBookDepth',
    'loreBookToken',
    'additionalPrompt',
    'descriptionPrefix',
    'emotionPrompt2',
    'enableCustomFlags',
    'customFlags',
    'keiServerURL',
    'presetChain',
    'assetMaxDifference',
    'keepSessionAlive',
    'useSayNothing',
    'showUnrecommended',
    'doNotWarnExternalServers',
    'useExperimental',
    'forceProxyAsOpenAI',
    'autofillRequestUrl',
    'allowAllExtentionFiles',
    'coldstorage',
    'enableDevTools',
    'enableScrollToActiveChar',
    'enableLorebookStubs',
    'promptInfoInsideChat',
    'promptTextInfoInsideChat',
    'enableRemoteSaving',
    'realmDirectOpen',
    'returnCSSError',
    'personaNote',
    'globalscript',
    'enableBookmark',
    'useTokenizerCaching',
    'auxModelUnderModelSettings',
    'pluginCompatibilityMode',
    'strictScriptCheck',
    'complexRegexCompatibilityMode',
    'complexRegexInputTimeoutMs',
    'complexRegexOutputTimeoutMs',
    'complexRegexDisplayTimeoutMs',
    'pluginDevelopMode',
    'showDeprecatedTriggerV1',
    'showDeprecatedTriggerV2',
    'checkCorruption',
    'toggleConfirmRecommendedPreset',
    'banCharacterset',
    'bulkEnabling',
    'saveSignatures',
    'inlayErrorResponse',
    'moduleIntergration',
  ],
  sidebar: [
    'askRemoval',
    'swipe',
    'instantRemove',
    'sendWithEnter',
    'fixedChatTextarea',
    'clickToEdit',
    'disableAutoPopupMessageEditor',
    'enableBlockPartialEdit',
    'longPressToPopupEditor',
    'enableDragPartialEdit',
    'botSettingAtStart',
    'showMenuChatList',
    'goCharacterOnImport',
    'sideMenuRerollButton',
    'requestInfoInsideChat',
    'localActivationInGlobalLorebook',
    'autoScrollToNewMessage',
    'alwaysScrollToNewMessage',
    'newMessageButtonStyle',
    'createFolderOnBranch',
    'hamburgerButtonBottom',
    'hotkeys',
    'enableRisuaiProTools',
    'globalChatVariables',
    'lastLoadedLoadoutName',
    'jailbreakToggle',
    'chatGenerationTogglePresets',
    'customSidebarItems',
  ],
  account: ['account', 'didFirstSetup', 'username', 'localNetworkMode', 'localNetworkTimeoutSec'],
}

const BOOLEAN_SETTING_KEYS = new Set([
  'askRemoval',
  'autoContinueChat',
  'autoScrollToNewMessage',
  'autoTranslate',
  'autoTranslateCachedOnly',
  'autofillRequestUrl',
  'automaticCachePoint',
  'blockquoteStyling',
  'botSettingAtStart',
  'bulkEnabling',
  'chainOfThought',
  'checkCorruption',
  'cipherChat',
  'classicMaxWidth',
  'claude1HourCaching',
  'claudeAws',
  'claudeBatching',
  'claudeCachingExperimental',
  'claudeRetrivalCaching',
  'clickToEdit',
  'coldstorage',
  'combineTranslation',
  'createFolderOnBranch',
  'customQuotes',
  'disableAutoPopupMessageEditor',
  'disableSeperateParameterChangeOnPresetChange',
  'doNotChangeFallbackModels',
  'doNotChangeSeperateModels',
  'doNotWarnExternalServers',
  'dynamicAssets',
  'dynamicAssetsEditDisplay',
  'dynamicModelRegistry',
  'epEnabled',
  'enableBlockPartialEdit',
  'enableBookmark',
  'enableCustomFlags',
  'enableDevTools',
  'enableDragPartialEdit',
  'enableLorebookStubs',
  'enableRemoteSaving',
  'enableRisuaiProTools',
  'enableScrollToActiveChar',
  'fallbackWhenBlankResponse',
  'fixedChatTextarea',
  'forceProxyAsOpenAI',
  'fullScreen',
  'goCharacterOnImport',
  'googleClaudeTokenizing',
  'hamburgerButtonBottom',
  'hideAllImages',
  'hideApiKey',
  'hideRealm',
  'htmlTranslation',
  'hypaV3',
  'imageCompression',
  'inlayErrorResponse',
  'instantRemove',
  'jailbreakToggle',
  'legacyMediaFindings',
  'legacyTranslation',
  'localActivationInGlobalLorebook',
  'localNetworkMode',
  'longPressToPopupEditor',
  'NAIadventure',
  'NAIappendName',
  'NAII2I',
  'NAIREF',
  'nanogptUseSubscriptionEndpoint',
  'newImageHandlingBeta',
  'newOAIHandle',
  'noWaitForTranslate',
  'openrouterFallback',
  'openrouterMiddleOut',
  'useInstructPrompt',
  'outputImageModal',
  'personaNote',
  'playMessage',
  'playMessageOnTranslateEnd',
  'pluginCompatibilityMode',
  'pluginDevelopMode',
  'promptInfoInsideChat',
  'promptTextInfoInsideChat',
  'realmDirectOpen',
  'rememberToolUsage',
  'removeIncompleteResponse',
  'removePunctuationHypa',
  'returnCSSError',
  'roundIcons',
  'saveSignatures',
  'seperateModelsForAxModels',
  'seperateParametersByModel',
  'seperateParametersEnabled',
  'showDeprecatedTriggerV1',
  'showDeprecatedTriggerV2',
  'showFirstMessagePages',
  'showFolderName',
  'showMemoryLimit',
  'showMenuChatList',
  'showMenuHypaMemoryModal',
  'showPromptComparison',
  'showSavingIcon',
  'showTranslationLoading',
  'showUnrecommended',
  'sideMenuRerollButton',
  'simplifiedToolUse',
  'strictJsonSchema',
  'streamGeminiThoughts',
  'strictScriptCheck',
  'swipe',
  'textBorder',
  'textScreenRounded',
  'toggleConfirmRecommendedPreset',
  'translateBeforeHTMLFormatting',
  'ttsAutoSpeech',
  'unformatQuotes',
  'useAdditionalAssetsPreview',
  'useAutoSuggestions',
  'useAutoTranslateInput',
  'useChatCopy',
  'useChatSticker',
  'useExperimental',
  'useExperimentalGoogleTranslator',
  'useLegacyGUI',
  'usePlainFetch',
  'useSayNothing',
  'useStreaming',
  'useTokenizerCaching',
])

const NUMBER_SETTING_KEYS = new Set([
  'animationSpeed',
  'assetMaxDifference',
  'assetWidth',
  'autoContinueMinTokens',
  'chatDisplayTailCount',
  'complexRegexInputTimeoutMs',
  'complexRegexOutputTimeoutMs',
  'complexRegexDisplayTimeoutMs',
  'customAPIFormat',
  'echoDelay',
  'falLoraScale',
  'frequencyPenalty',
  'genTime',
  'generationSeed',
  'iconsize',
  'lineHeight',
  'localNetworkTimeoutSec',
  'loreBookDepth',
  'loreBookToken',
  'maxContext',
  'maxResponse',
  'memoryLimitThickness',
  'ollamaRequestFormat',
  'PresensePenalty',
  'reasoningEffort',
  'repetition_penalty',
  'requestRetrys',
  'sdCFG',
  'sdSteps',
  'settingsCloseButtonSize',
  'sideBarSize',
  'temperature',
  'textAreaSize',
  'textAreaTextSize',
  'thinkingTokens',
  'top_a',
  'top_k',
  'top_p',
  'translatorMaxResponse',
  'verbosity',
  'vertexAccessTokenExpires',
  'waifuWidth',
  'waifuWidth2',
  'zoomsize',
])

const STRING_SETTING_KEYS = new Set([
  'additionalPrompt',
  'adaptiveThinkingEffort',
  'apiType',
  'autoSuggestPrompt',
  'autoSuggestPrefix',
  'claudeAPIKey',
  'cohereAPIKey',
  'complexRegexCompatibilityMode',
  'customBackground',
  'customCSS',
  'customFont',
  'customGUI',
  'customProxyRequestModel',
  'customTokenizer',
  'dallEQuality',
  'deepseekReasoningEffort',
  'deepseekThinkingType',
  'descriptionPrefix',
  'echoMessage',
  'emotionProcesser',
  'emotionPrompt2',
  'falLora',
  'falLoraName',
  'falModel',
  'falToken',
  'fishSpeechKey',
  'font',
  'forceReplaceUrl',
  'gptVisionQuality',
  'guiHTML',
  'heightMode',
  'hordeModel',
  'huggingfaceKey',
  'hypaMemoryKey',
  'hypaModel',
  'hypaV3Key',
  'ImagenAspectRatio',
  'ImagenImageSize',
  'ImagenModel',
  'ImagenPersonGeneration',
  'inputTranslatorPrompt',
  'instructChatTemplate',
  'JinjaTemplate',
  'keepSessionAlive',
  'keiServerURL',
  'koboldURL',
  'language',
  'lastLoadedLoadoutName',
  'mancerHeader',
  'mistralKey',
  'nanogptKey',
  'nanogptProvider',
  'nanogptRequestModel',
  'nanogptRequestModelName',
  'nanogptSubscriptionState',
  'NAIApiKey',
  'NAIImgModel',
  'NAIImgUrl',
  'newMessageButtonStyle',
  'novellistAPI',
  'ollamaApiKey',
  'ollamaCloudModel',
  'ollamaCloudModelName',
  'ollamaInputMode',
  'ollamaModel',
  'ollamaModelName',
  'ollamaModelSource',
  'ollamaThinkingMode',
  'openAIKey',
  'openrouterKey',
  'openrouterRequestModel',
  'presetChain',
  'proxyKey',
  'proxyRequestModel',
  'requestLocation',
  'sdProvider',
  'stabllityStyle',
  'stabilityKey',
  'stabilityModel',
  'systemRoleReplacement',
  'textgenWebUIBlockingURL',
  'textgenWebUIStreamURL',
  'textTheme',
  'theme',
  'thinkingType',
  'translator',
  'translatorInputLanguage',
  'translatorPrompt',
  'translatorType',
  'vertexAccessToken',
  'vertexClientEmail',
  'vertexPrivateKey',
  'vertexRegion',
  'voicevoxUrl',
  'voyageApiKey',
  'webUiUrl',
  'username',
])

const ARRAY_SETTING_KEYS = new Set([
  'additionalParams',
  'authRefreshes',
  'banCharacterset',
  'bias',
  'customFlags',
  'customQuotesData',
  'customModels',
  'chatGenerationTogglePresets',
  'customSidebarItems',
  'globalscript',
  'hotkeys',
  'modelProfiles',
  'modelTools',
  'hypaV3Presets',
])

const ARRAY_OR_NULL_SETTING_KEYS = new Set(['localStopStrings'])

const STRING_OR_NULL_SETTING_KEYS = new Set(['textScreenBorder', 'textScreenColor'])

const OBJECT_SETTING_KEYS = new Set([
  'account',
  'ainconfig',
  'colorScheme',
  'comfyConfig',
  'customTextTheme',
  'deeplOptions',
  'deeplXOptions',
  'google',
  'globalChatVariables',
  'hordeConfig',
  'hypaCustomSettings',
  'hypaV3Settings',
  'fallbackModels',
  'modelRuntimeDefaults',
  'modelRoleProfiles',
  'modelRoles',
  'NAIImgConfig',
  'NAIsettings',
  'novelai',
  'OaiCompAPIKeys',
  'ooba',
  'openaiCompatImage',
  'openrouterProvider',
  'reverseProxyOobaArgs',
  'sdConfig',
  'seperateModels',
  'seperateParameters',
  'wavespeedImage',
])

const SETTINGS_GROUP_KEY_SETS = Object.fromEntries(
  Object.entries(SETTINGS_GROUP_KEYS).map(([group, keys]) => [group, new Set(keys)]),
) as Record<SettingsGroup, Set<string>>

export function registerCommandRoutes(
  app: FastifyInstance,
  db: DatabaseSync,
  authState: AuthState,
  dataDir: string,
  eventSink: CommandEventSink,
  messageTranslationJobs?: MessageTranslationJobRegistry,
): void {
  // First-run seed: a fresh server starts with `database: null`, which every
  // command path rejects (they require an existing object). The server creates
  // its default database here once before any ordinary command runs. Idempotent
  // and clobber-safe — a no-op when a database already exists, so it can never
  // overwrite real data.
  app.post('/api/v1/commands/state/initialize', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
        throw new ValidationError('request body must be an object')
      }
      const body = req.body as { database?: unknown }
      if (Object.prototype.hasOwnProperty.call(body, 'database')) {
        throw new ValidationError('database payload is no longer accepted for state initialization')
      }
      const result = initializeDefaultDatabase(db, dataDir)
      if (!result.initialized) {
        // Already initialized: report the live revision so the client can sync
        // its cursor; no write happened, so no event is emitted.
        return { revision: result.revision, initialized: false }
      }
      if (!result.event) {
        throw new Error('state initialization did not produce a command event')
      }
      emitCommandEventForRequest(req, eventSink, result.event)
      return { revision: result.revision, initialized: true, event: result.event }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.patch('/api/v1/commands/settings/:group', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const group = readSettingsGroup((req.params as { group?: unknown }).group)
      const body = (req.body ?? {}) as RuntimeSettingsCommandBody
      const baseRevision = readBaseRevision(body)
      const patch = readSettingsGroupPatch(group, body.patch)
      const writesHypaV3Presets = Object.prototype.hasOwnProperty.call(patch, 'hypaV3Presets')
      validateSettingsAssetRefs(db, patch)
      const result = applyTargetedCommandMutation({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.settings,
        settingsScopedRead: true,
        mutate(database, innerDb) {
          applySettingsPatch(database, patch)
          writeSettingsOnly(innerDb, extractSettings(database as Record<string, unknown>))
          // The `memory` group's `hypaV3Presets` is a collection field, not a
          // settings scalar, so co-write only that one collection table when the
          // patch carries it; every other settings group is settings-only.
          if (writesHypaV3Presets) {
            writeSingleCollectionTable(
              innerDb,
              'hypaV3Presets',
              (database as Record<string, unknown>).hypaV3Presets as readonly unknown[],
            )
          }
          const target = database as Record<string, unknown>
          const settings = Object.fromEntries(Object.keys(patch).map((key) => [key, target[key]]))
          return {
            event: {
              ...COMMAND_EVENT_CATALOG.settingsUpdated,
              ...(writesHypaV3Presets ? { resource: SETTINGS_WITH_HYPA_V3_PRESETS_RESOURCE } : {}),
              id: group,
            },
            extra: {
              // Return only the keys this command touched. The client can use
              // this canonical, secret-masked patch to acknowledge its
              // optimistic write without downloading the complete group.
              settings: maskProviderSecrets(settings),
            },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.post('/api/v1/commands/model-profiles', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const body = req.body ?? {}
      const baseRevision = readBaseRevision(body)
      const result = createModelProfileCommand({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        body,
      })
      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.post('/api/v1/commands/model-profiles/create-and-bind', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const body = req.body ?? {}
      const baseRevision = readBaseRevision(body)
      const result = createAndBindModelProfileCommand({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        body,
      })
      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.post('/api/v1/commands/model-profiles/convert-legacy', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const body = req.body ?? {}
      const baseRevision = readBaseRevision(body)
      const result = convertLegacyModelProfilesCommand({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        body,
      })
      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.patch('/api/v1/commands/model-profiles/:profileId', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const body = req.body ?? {}
      const baseRevision = readBaseRevision(body)
      const result = updateModelProfileCommand({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        body,
        profileId: (req.params as { profileId?: unknown }).profileId as string,
      })
      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.post('/api/v1/commands/model-profiles/:profileId/duplicate', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const body = req.body ?? {}
      const baseRevision = readBaseRevision(body)
      const result = duplicateModelProfileCommand({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        body,
        profileId: (req.params as { profileId?: unknown }).profileId as string,
      })
      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.delete('/api/v1/commands/model-profiles/:profileId', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const body = req.body ?? {}
      const baseRevision = readBaseRevision(body)
      const result = deleteModelProfileCommand({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        body,
        profileId: (req.params as { profileId?: unknown }).profileId as string,
      })
      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.put('/api/v1/commands/model-role-profiles', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const body = req.body ?? {}
      const baseRevision = readBaseRevision(body)
      const result = updateModelRoleProfilesCommand({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        body,
      })
      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.put('/api/v1/commands/model-runtime-defaults', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const body = req.body ?? {}
      const baseRevision = readBaseRevision(body)
      const result = updateModelRuntimeDefaultsCommand({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        body,
      })
      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.post('/api/v1/commands/agent-presets', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const body = req.body ?? {}
      const baseRevision = readBaseRevision(body)
      const result = createAgentPresetCommand({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        body,
      })
      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.patch('/api/v1/commands/agent-presets/:presetId', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const body = req.body ?? {}
      const baseRevision = readBaseRevision(body)
      const result = updateAgentPresetCommand({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        body,
        presetId: (req.params as { presetId?: unknown }).presetId as string,
      })
      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.delete('/api/v1/commands/agent-presets/:presetId', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const body = req.body ?? {}
      const baseRevision = readBaseRevision(body)
      const result = deleteAgentPresetCommand({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        body,
        presetId: (req.params as { presetId?: unknown }).presetId as string,
      })
      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.post('/api/v1/commands/agent-presets/:presetId/duplicate', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const body = req.body ?? {}
      const baseRevision = readBaseRevision(body)
      const result = duplicateAgentPresetCommand({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        body,
        presetId: (req.params as { presetId?: unknown }).presetId as string,
      })
      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.post('/api/v1/commands/agent-presets/reorder', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const body = req.body ?? {}
      const baseRevision = readBaseRevision(body)
      const result = reorderAgentPresetsCommand({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        body,
      })
      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.post('/api/v1/commands/agent-presets/default', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const body = req.body ?? {}
      const baseRevision = readBaseRevision(body)
      const result = setAgentPresetDefaultCommand({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        body,
      })
      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.post('/api/v1/commands/agent-presets/:presetId/steps', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const body = req.body ?? {}
      const baseRevision = readBaseRevision(body)
      const result = createAgentPresetStepCommand({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        body,
        presetId: (req.params as { presetId?: unknown }).presetId as string,
      })
      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.patch('/api/v1/commands/agent-presets/:presetId/steps/:stepId', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const body = req.body ?? {}
      const baseRevision = readBaseRevision(body)
      const params = req.params as { presetId?: unknown; stepId?: unknown }
      const result = updateAgentPresetStepCommand({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        body,
        presetId: params.presetId as string,
        stepId: params.stepId as string,
      })
      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.delete('/api/v1/commands/agent-presets/:presetId/steps/:stepId', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const body = req.body ?? {}
      const baseRevision = readBaseRevision(body)
      const params = req.params as { presetId?: unknown; stepId?: unknown }
      const result = deleteAgentPresetStepCommand({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        body,
        presetId: params.presetId as string,
        stepId: params.stepId as string,
      })
      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.post('/api/v1/commands/agent-presets/:presetId/steps/:stepId/duplicate', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const body = req.body ?? {}
      const baseRevision = readBaseRevision(body)
      const params = req.params as { presetId?: unknown; stepId?: unknown }
      const result = duplicateAgentPresetStepCommand({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        body,
        presetId: params.presetId as string,
        stepId: params.stepId as string,
      })
      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.post('/api/v1/commands/agent-presets/:presetId/steps/reorder', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const body = req.body ?? {}
      const baseRevision = readBaseRevision(body)
      const result = reorderAgentPresetStepsCommand({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        body,
        presetId: (req.params as { presetId?: unknown }).presetId as string,
      })
      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.post('/api/v1/commands/presets', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const body = (req.body ?? {}) as PresetCommandBody
      const baseRevision = readBaseRevision(body)
      const preset = createPresetRecord(readJsonObject(body.preset, 'preset'), 'New Preset', {
        assetDb: db,
      })
      const result = applyTargetedCommandMutation<{ presetId: string }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.collection,
        collectionScopedRead: COLLECTION_SCOPED_READS.presets,
        mutate(database, innerDb) {
          const target = ensureDatabaseObject(database)
          const presets = ensurePresetCollection(target)
          if (findPresetIndex(presets, preset.id) !== -1) {
            throw new ValidationError(`Duplicate preset id: ${preset.id}`)
          }
          presets.push(preset)
          // Append does not move the selected pointer, so the one collection
          // table is the only write.
          writeSingleCollectionTable(innerDb, 'botPresets', presets)
          return {
            event: { ...COMMAND_EVENT_CATALOG.presetCreated, id: preset.id },
            extra: { presetId: preset.id },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.patch('/api/v1/commands/presets/:presetId', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const presetId = readPresetId((req.params as { presetId?: unknown }).presetId)
      const body = (req.body ?? {}) as PresetCommandBody
      const baseRevision = readBaseRevision(body)
      const patch = readPresetPatch(readJsonObject(body.patch, 'patch'), { assetDb: db })
      if (Object.prototype.hasOwnProperty.call(patch, 'id') && patch.id !== presetId) {
        throw new ValidationError('patch.id must match presetId')
      }
      const result = applyTargetedCommandMutation<{ presetId: string }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.collection,
        collectionScopedRead: COLLECTION_SCOPED_READS.presets,
        mutate(database, innerDb) {
          const target = ensureDatabaseObject(database)
          const presets = ensurePresetCollection(target)
          const index = requirePresetIndex(presets, presetId)
          presets[index] = {
            ...presets[index],
            ...patch,
            id: presetId,
          }
          normalizePresetAgentSettings(presets[index])
          writeSingleCollectionRow(innerDb, 'botPresets', index, presets[index])
          return {
            event: { ...COMMAND_EVENT_CATALOG.presetUpdated, id: presetId },
            extra: { presetId },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.delete('/api/v1/commands/presets/:presetId', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const presetId = readPresetId((req.params as { presetId?: unknown }).presetId)
      const body = (req.body ?? {}) as PresetCommandBody
      const baseRevision = readBaseRevision(body)
      const selectPresetId = body.presetId === undefined ? undefined : readPresetId(body.presetId, 'presetId')
      const apply = readOptionalBoolean(body.apply, 'apply', false)
      const saveCurrent = readOptionalBoolean(body.saveCurrent, 'saveCurrent', false)
      const result = applyTargetedCommandMutation<{
        presetId: string
        selectedPresetId: string | null
      }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.collection,
        collectionScopedRead: COLLECTION_SCOPED_READS.presets,
        mutate(database, innerDb) {
          const target = ensureDatabaseObject(database)
          const presets = ensurePresetCollection(target)
          if (presets.length <= 1) {
            throw new ValidationError('Cannot delete the only preset')
          }
          const beforeSelected = target.botPresetsId
          const currentSelectedId = selectedPresetId(target, presets)
          if (saveCurrent) {
            saveCurrentPresetSnapshot(target, presets)
          }
          const deletedIndex = requirePresetIndex(presets, presetId)
          const deletedWasSelected = currentSelectedId === presetId
          presets.splice(deletedIndex, 1)

          let nextSelectedId = selectPresetId
          if (!nextSelectedId && deletedWasSelected) {
            nextSelectedId = presets[0]?.id
          } else if (!nextSelectedId) {
            nextSelectedId = currentSelectedId ?? presets[0]?.id
          }

          const selectedIndex = nextSelectedId ? requirePresetIndex(presets, nextSelectedId) : -1
          target.botPresetsId = selectedIndex
          let applied = false
          if (apply && selectedIndex >= 0) {
            applyPreset(target, presets[selectedIndex])
            applied = true
          }

          // The splice shifts positions, so the preset table is always rewritten.
          writeSingleCollectionTable(innerDb, 'botPresets', presets)
          if (applied || target.botPresetsId !== beforeSelected) {
            writeSettingsOnly(innerDb, extractSettings(target))
          }
          const pointerChanged = target.botPresetsId !== beforeSelected

          return {
            event: {
              ...COMMAND_EVENT_CATALOG.presetDeleted,
              ...(!applied
                ? {
                    resource: pointerChanged ? PRESET_COLLECTION_WITH_POINTER_RESOURCE : 'presetCollection',
                  }
                : {}),
              id: presetId,
              ...(saveCurrent && currentSelectedId && currentSelectedId !== presetId
                ? { parentId: currentSelectedId }
                : {}),
            },
            extra: {
              presetId,
              selectedPresetId: selectedIndex >= 0 ? presets[selectedIndex].id : null,
            },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.post('/api/v1/commands/presets/:presetId/copy', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const presetId = readPresetId((req.params as { presetId?: unknown }).presetId)
      const body = (req.body ?? {}) as PresetCommandBody
      const baseRevision = readBaseRevision(body)
      const newPresetId = readPresetId(body.newPresetId, 'newPresetId')
      const name = readOptionalString(body.name, 'name')
      const saveCurrent = readOptionalBoolean(body.saveCurrent, 'saveCurrent', false)
      const result = applyTargetedCommandMutation<{ presetId: string; sourcePresetId: string }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.collection,
        collectionScopedRead: COLLECTION_SCOPED_READS.presets,
        mutate(database, innerDb) {
          const target = ensureDatabaseObject(database)
          const presets = ensurePresetCollection(target)
          const savedPresetId = saveCurrent ? selectedPresetId(target, presets) : null
          if (saveCurrent) {
            saveCurrentPresetSnapshot(target, presets)
          }
          const index = requirePresetIndex(presets, presetId)
          if (findPresetIndex(presets, newPresetId) !== -1) {
            throw new ValidationError(`Duplicate preset id: ${newPresetId}`)
          }
          const copy = {
            ...presets[index],
            id: newPresetId,
            name: name ?? `${presets[index].name ?? 'Preset'} Copy`,
          }
          presets.push(copy)
          // Copy (and the optional save-current snapshot) only touches the
          // preset collection; the selected pointer is unchanged.
          writeSingleCollectionTable(innerDb, 'botPresets', presets)
          return {
            event: {
              ...COMMAND_EVENT_CATALOG.presetCopied,
              id: copy.id,
              ...(savedPresetId ? { parentId: savedPresetId } : {}),
            },
            extra: { presetId: copy.id, sourcePresetId: presetId },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.post('/api/v1/commands/presets/select', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const body = (req.body ?? {}) as PresetCommandBody
      const baseRevision = readBaseRevision(body)
      const presetId = readPresetId(body.presetId, 'presetId')
      const apply = readOptionalBoolean(body.apply, 'apply', true)
      const saveCurrent = readOptionalBoolean(body.saveCurrent, 'saveCurrent', true)
      const result = applyTargetedCommandMutation<{ presetId: string }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.collection,
        collectionScopedRead: COLLECTION_SCOPED_READS.presets,
        mutate(database, innerDb) {
          const target = ensureDatabaseObject(database)
          const presets = ensurePresetCollection(target)
          const beforeSelected = target.botPresetsId
          const previousSelectedId = selectedPresetId(target, presets)
          if (saveCurrent) {
            saveCurrentPresetSnapshot(target, presets)
          }
          const index = requirePresetIndex(presets, presetId)
          target.botPresetsId = index
          let applied = false
          if (apply) {
            applyPreset(target, presets[index])
            applied = true
          }
          // The preset table is rewritten only when save-current snapshotted the
          // outgoing preset into it; the pointer + applied scalars live in settings.
          if (saveCurrent) {
            writeSingleCollectionTable(innerDb, 'botPresets', presets)
          }
          if (applied || target.botPresetsId !== beforeSelected) {
            writeSettingsOnly(innerDb, extractSettings(target))
          }
          const pointerChanged = target.botPresetsId !== beforeSelected
          return {
            event: {
              ...COMMAND_EVENT_CATALOG.presetSelected,
              ...(!applied
                ? {
                    resource: saveCurrent
                      ? pointerChanged
                        ? PRESET_COLLECTION_WITH_POINTER_RESOURCE
                        : 'presetCollection'
                      : pointerChanged
                        ? PRESET_POINTER_RESOURCE
                        : REVISION_ONLY_RESOURCE,
                  }
                : {}),
              id: presetId,
              ...(saveCurrent && previousSelectedId ? { parentId: previousSelectedId } : {}),
            },
            extra: { presetId },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.post('/api/v1/commands/presets/import', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const body = (req.body ?? {}) as PresetCommandBody
      const baseRevision = readBaseRevision(body)
      const preset = createPresetRecord(readJsonObject(body.preset, 'preset'), 'Imported', {
        assetDb: db,
      })
      const result = applyTargetedCommandMutation<{ presetId: string }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.collection,
        collectionScopedRead: COLLECTION_SCOPED_READS.presets,
        mutate(database, innerDb) {
          const target = ensureDatabaseObject(database)
          const presets = ensurePresetCollection(target)
          if (findPresetIndex(presets, preset.id) !== -1) {
            throw new ValidationError(`Duplicate preset id: ${preset.id}`)
          }
          presets.push(preset)
          writeSingleCollectionTable(innerDb, 'botPresets', presets)
          return {
            event: { ...COMMAND_EVENT_CATALOG.presetImported, id: preset.id },
            extra: { presetId: preset.id },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.post('/api/v1/commands/presets/reorder', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const body = (req.body ?? {}) as PresetCommandBody
      const baseRevision = readBaseRevision(body)
      if (!Array.isArray(body.presetIds)) {
        throw new ValidationError('presetIds must be an array')
      }
      const presetIds = body.presetIds
      const result = applyTargetedCommandMutation<{ selectedPresetId: string | null }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.collection,
        collectionScopedRead: COLLECTION_SCOPED_READS.presets,
        mutate(database, innerDb) {
          const target = ensureDatabaseObject(database)
          const presets = ensurePresetCollection(target)
          const beforeSelected = target.botPresetsId
          const currentSelectedId = selectedPresetId(target, presets)
          validateFullPresetIdList(presets, presetIds)
          const byId = new Map(presets.map((preset) => [preset.id, preset]))
          const reordered = presetIds.map((id) => byId.get(id)!)
          target.botPresets = reordered
          target.botPresetsId = currentSelectedId
            ? requirePresetIndex(reordered, currentSelectedId)
            : reordered.length > 0
              ? 0
              : -1
          writeSingleCollectionTable(innerDb, 'botPresets', reordered)
          // `botPresetsId` is a settings scalar; co-write settings only when the
          // reorder moved the selected preset to a new index.
          if (target.botPresetsId !== beforeSelected) {
            writeSettingsOnly(innerDb, extractSettings(target))
          }
          return {
            event: {
              ...COMMAND_EVENT_CATALOG.presetReordered,
              ...(target.botPresetsId !== beforeSelected ? { resource: PRESET_COLLECTION_WITH_POINTER_RESOURCE } : {}),
            },
            extra: { selectedPresetId: selectedPresetId(target, reordered) },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.post('/api/v1/commands/model-presets', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const body = (req.body ?? {}) as ModelPresetCommandBody
      const baseRevision = readBaseRevision(body)
      const preset = createModelPresetRecord(readJsonObject(body.preset, 'preset'), 'New Model Preset')
      const result = applyTargetedCommandMutation<{ modelPresetId: string }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.collection,
        collectionScopedRead: COLLECTION_SCOPED_READS.modelPresets,
        mutate(database, innerDb) {
          const target = ensureSplitPresetDatabaseObject(database)
          const presets = ensureModelPresetCollection(target)
          if (findModelPresetIndex(presets, preset.id) !== -1) {
            throw new ValidationError(`Duplicate model preset id: ${preset.id}`)
          }
          presets.push(resolveModelPresetMaskedSecrets(undefined, preset) as typeof preset)
          writeSingleCollectionTable(innerDb, 'modelPresets', presets)
          return {
            event: { ...COMMAND_EVENT_CATALOG.modelPresetCreated, id: preset.id },
            extra: { modelPresetId: preset.id },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.patch('/api/v1/commands/model-presets/:modelPresetId', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const modelPresetId = readModelPresetId((req.params as { modelPresetId?: unknown }).modelPresetId)
      const body = (req.body ?? {}) as ModelPresetCommandBody
      const baseRevision = readBaseRevision(body)
      const patch = readModelPresetPatch(readJsonObject(body.patch, 'patch'))
      if (Object.prototype.hasOwnProperty.call(patch, 'id') && patch.id !== modelPresetId) {
        throw new ValidationError('patch.id must match modelPresetId')
      }
      const result = applyTargetedCommandMutation<{ modelPresetId: string }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.collection,
        collectionScopedRead: COLLECTION_SCOPED_READS.modelPresets,
        mutate(database, innerDb) {
          const target = ensureSplitPresetDatabaseObject(database)
          const presets = ensureModelPresetCollection(target)
          const index = requireModelPresetIndex(presets, modelPresetId)
          const resolvedPatch = resolveModelPresetMaskedSecrets(presets[index], patch)
          presets[index] = {
            ...presets[index],
            ...resolvedPatch,
            id: modelPresetId,
          }
          writeSingleCollectionRow(innerDb, 'modelPresets', index, presets[index])
          if (target.modelPresetsId === index) {
            applyModelPreset(target, presets[index])
            applySelectedPromptPresetAfterModelPreset(target)
            writeSettingsOnly(innerDb, extractSettings(target))
          }
          return {
            event: { ...COMMAND_EVENT_CATALOG.modelPresetUpdated, id: modelPresetId },
            extra: { modelPresetId },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.delete('/api/v1/commands/model-presets/:modelPresetId', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const modelPresetId = readModelPresetId((req.params as { modelPresetId?: unknown }).modelPresetId)
      const body = (req.body ?? {}) as ModelPresetCommandBody
      const baseRevision = readBaseRevision(body)
      const selectModelPresetId =
        body.modelPresetId === undefined ? undefined : readModelPresetId(body.modelPresetId, 'modelPresetId')
      const result = applyTargetedCommandMutation<{
        modelPresetId: string
        selectedModelPresetId: string | null
      }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.collection,
        collectionScopedRead: COLLECTION_SCOPED_READS.modelPresets,
        mutate(database, innerDb) {
          const target = ensureSplitPresetDatabaseObject(database)
          const presets = ensureModelPresetCollection(target)
          if (presets.length <= 1) {
            throw new ValidationError('Cannot delete the only model preset')
          }
          const beforeSelected = target.modelPresetsId
          const deletedIndex = requireModelPresetIndex(presets, modelPresetId)
          const currentSelectedId = selectedModelPresetId(target, presets)
          const deletedWasSelected = currentSelectedId === modelPresetId
          presets.splice(deletedIndex, 1)
          const nextSelectedId =
            selectModelPresetId ?? (deletedWasSelected ? presets[0]?.id : (currentSelectedId ?? presets[0]?.id))
          const nextSelectedIndex = nextSelectedId ? requireModelPresetIndex(presets, nextSelectedId) : -1
          target.modelPresetsId = nextSelectedIndex
          if (nextSelectedIndex >= 0) {
            applyModelPreset(target, presets[nextSelectedIndex])
            applySelectedPromptPresetAfterModelPreset(target)
          }
          writeSingleCollectionTable(innerDb, 'modelPresets', presets)
          if (target.modelPresetsId !== beforeSelected || deletedWasSelected) {
            writeSettingsOnly(innerDb, extractSettings(target))
          }
          return {
            event: { ...COMMAND_EVENT_CATALOG.modelPresetDeleted, id: modelPresetId },
            extra: {
              modelPresetId,
              selectedModelPresetId: selectedModelPresetId(target, presets),
            },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.post('/api/v1/commands/model-presets/select', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const body = (req.body ?? {}) as ModelPresetCommandBody
      const baseRevision = readBaseRevision(body)
      const modelPresetId = readModelPresetId(body.modelPresetId, 'modelPresetId')
      const result = applyTargetedCommandMutation<{ modelPresetId: string }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.collection,
        collectionScopedRead: COLLECTION_SCOPED_READS.modelPresets,
        mutate(database, innerDb) {
          const target = ensureSplitPresetDatabaseObject(database)
          const presets = ensureModelPresetCollection(target)
          const beforeSelected = target.modelPresetsId
          const nextSelectedIndex = requireModelPresetIndex(presets, modelPresetId)
          target.modelPresetsId = nextSelectedIndex
          applyModelPreset(target, presets[nextSelectedIndex])
          applySelectedPromptPresetAfterModelPreset(target)
          if (target.modelPresetsId !== beforeSelected) {
            writeSettingsOnly(innerDb, extractSettings(target))
          }
          return {
            event: { ...COMMAND_EVENT_CATALOG.modelPresetSelected, id: modelPresetId },
            extra: { modelPresetId },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.post('/api/v1/commands/model-presets/import', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const body = (req.body ?? {}) as ModelPresetCommandBody
      const baseRevision = readBaseRevision(body)
      const preset = createModelPresetRecord(readJsonObject(body.preset, 'preset'), 'Imported Model')
      const result = applyTargetedCommandMutation<{ modelPresetId: string }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.collection,
        collectionScopedRead: COLLECTION_SCOPED_READS.modelPresets,
        mutate(database, innerDb) {
          const target = ensureSplitPresetDatabaseObject(database)
          const presets = ensureModelPresetCollection(target)
          if (findModelPresetIndex(presets, preset.id) !== -1) {
            throw new ValidationError(`Duplicate model preset id: ${preset.id}`)
          }
          presets.push(resolveModelPresetMaskedSecrets(undefined, preset) as typeof preset)
          writeSingleCollectionTable(innerDb, 'modelPresets', presets)
          return {
            event: { ...COMMAND_EVENT_CATALOG.modelPresetImported, id: preset.id },
            extra: { modelPresetId: preset.id },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.post('/api/v1/commands/model-presets/reorder', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const body = (req.body ?? {}) as ModelPresetCommandBody
      const baseRevision = readBaseRevision(body)
      if (!Array.isArray(body.modelPresetIds)) {
        throw new ValidationError('modelPresetIds must be an array')
      }
      const modelPresetIds = body.modelPresetIds
      const result = applyTargetedCommandMutation<{ selectedModelPresetId: string | null }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.collection,
        collectionScopedRead: COLLECTION_SCOPED_READS.modelPresets,
        mutate(database, innerDb) {
          const target = ensureSplitPresetDatabaseObject(database)
          const presets = ensureModelPresetCollection(target)
          const beforeSelected = target.modelPresetsId
          const currentSelectedId = selectedModelPresetId(target, presets)
          validateFullModelPresetIdList(presets, modelPresetIds)
          const byId = new Map(presets.map((preset) => [preset.id, preset]))
          const reordered = modelPresetIds.map((id) => byId.get(id as string)!)
          target.modelPresets = reordered
          target.modelPresetsId = currentSelectedId
            ? requireModelPresetIndex(reordered, currentSelectedId)
            : reordered.length > 0
              ? 0
              : -1
          writeSingleCollectionTable(innerDb, 'modelPresets', reordered)
          if (target.modelPresetsId !== beforeSelected) {
            writeSettingsOnly(innerDb, extractSettings(target))
          }
          return {
            event: COMMAND_EVENT_CATALOG.modelPresetReordered,
            extra: { selectedModelPresetId: selectedModelPresetId(target, reordered) },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.post('/api/v1/commands/prompt-presets', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const body = (req.body ?? {}) as PromptPresetCommandBody
      const baseRevision = readBaseRevision(body)
      const preset = createPromptPresetRecord(readJsonObject(body.preset, 'preset'), 'New Prompt Preset')
      const result = applyTargetedCommandMutation<{ promptPresetId: string }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.collection,
        collectionScopedRead: COLLECTION_SCOPED_READS.promptPresets,
        mutate(database, innerDb) {
          const target = ensureSplitPresetDatabaseObject(database)
          const presets = ensurePromptPresetCollection(target)
          if (findPromptPresetIndex(presets, preset.id) !== -1) {
            throw new ValidationError(`Duplicate prompt preset id: ${preset.id}`)
          }
          presets.push(preset)
          writeSingleCollectionTable(innerDb, 'promptPresets', presets)
          return {
            event: { ...COMMAND_EVENT_CATALOG.promptPresetCreated, id: preset.id },
            extra: { promptPresetId: preset.id },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.patch('/api/v1/commands/prompt-presets/:promptPresetId', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const promptPresetId = readPromptPresetId((req.params as { promptPresetId?: unknown }).promptPresetId)
      const body = (req.body ?? {}) as PromptPresetCommandBody
      const baseRevision = readBaseRevision(body)
      const patch = readPromptPresetPatch(readJsonObject(body.patch, 'patch'))
      if (Object.prototype.hasOwnProperty.call(patch, 'id') && patch.id !== promptPresetId) {
        throw new ValidationError('patch.id must match promptPresetId')
      }
      const result = applyTargetedCommandMutation<{ promptPresetId: string }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.collection,
        collectionScopedRead: COLLECTION_SCOPED_READS.promptPresets,
        mutate(database, innerDb) {
          const target = ensureSplitPresetDatabaseObject(database)
          const presets = ensurePromptPresetCollection(target)
          const index = requirePromptPresetIndex(presets, promptPresetId)
          presets[index] = {
            ...presets[index],
            ...patch,
            id: promptPresetId,
          }
          writeSingleCollectionRow(innerDb, 'promptPresets', index, presets[index])
          if (target.promptPresetsId === index) {
            applyPromptPreset(target, presets[index])
            if (promptPresetAppliesPromptTemplate(presets[index])) {
              writePromptTemplatesTable(innerDb, asArray(target.promptTemplate))
            }
            writeSettingsOnly(innerDb, extractSettings(target))
          }
          return {
            event: { ...COMMAND_EVENT_CATALOG.promptPresetUpdated, id: promptPresetId },
            extra: { promptPresetId },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.delete('/api/v1/commands/prompt-presets/:promptPresetId', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const promptPresetId = readPromptPresetId((req.params as { promptPresetId?: unknown }).promptPresetId)
      const body = (req.body ?? {}) as PromptPresetCommandBody
      const baseRevision = readBaseRevision(body)
      const selectPromptPresetId =
        body.promptPresetId === undefined ? undefined : readPromptPresetId(body.promptPresetId, 'promptPresetId')
      const result = applyTargetedCommandMutation<{
        promptPresetId: string
        selectedPromptPresetId: string | null
      }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.collection,
        collectionScopedRead: COLLECTION_SCOPED_READS.promptPresets,
        mutate(database, innerDb) {
          const target = ensureSplitPresetDatabaseObject(database)
          const presets = ensurePromptPresetCollection(target)
          if (presets.length <= 1) {
            throw new ValidationError('Cannot delete the only prompt preset')
          }
          const beforeSelected = target.promptPresetsId
          const deletedIndex = requirePromptPresetIndex(presets, promptPresetId)
          const currentSelectedId = selectedPromptPresetId(target, presets)
          const deletedWasSelected = currentSelectedId === promptPresetId
          presets.splice(deletedIndex, 1)
          const nextSelectedId =
            selectPromptPresetId ?? (deletedWasSelected ? presets[0]?.id : (currentSelectedId ?? presets[0]?.id))
          const nextSelectedIndex = nextSelectedId ? requirePromptPresetIndex(presets, nextSelectedId) : -1
          target.promptPresetsId = nextSelectedIndex
          if (nextSelectedIndex >= 0) {
            applyPromptPreset(target, presets[nextSelectedIndex])
            if (promptPresetAppliesPromptTemplate(presets[nextSelectedIndex])) {
              writePromptTemplatesTable(innerDb, asArray(target.promptTemplate))
            }
          }
          writeSingleCollectionTable(innerDb, 'promptPresets', presets)
          if (target.promptPresetsId !== beforeSelected || deletedWasSelected) {
            writeSettingsOnly(innerDb, extractSettings(target))
          }
          return {
            event: { ...COMMAND_EVENT_CATALOG.promptPresetDeleted, id: promptPresetId },
            extra: {
              promptPresetId,
              selectedPromptPresetId: selectedPromptPresetId(target, presets),
            },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.post('/api/v1/commands/prompt-presets/select', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const body = (req.body ?? {}) as PromptPresetCommandBody
      const baseRevision = readBaseRevision(body)
      const promptPresetId = readPromptPresetId(body.promptPresetId, 'promptPresetId')
      const result = applyTargetedCommandMutation<{ promptPresetId: string }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.collection,
        collectionScopedRead: COLLECTION_SCOPED_READS.promptPresets,
        mutate(database, innerDb) {
          const target = ensureSplitPresetDatabaseObject(database)
          const presets = ensurePromptPresetCollection(target)
          const beforeSelected = target.promptPresetsId
          const nextSelectedIndex = requirePromptPresetIndex(presets, promptPresetId)
          target.promptPresetsId = nextSelectedIndex
          applyPromptPreset(target, presets[nextSelectedIndex])
          if (promptPresetAppliesPromptTemplate(presets[nextSelectedIndex])) {
            writePromptTemplatesTable(innerDb, asArray(target.promptTemplate))
          }
          if (target.promptPresetsId !== beforeSelected) {
            writeSettingsOnly(innerDb, extractSettings(target))
          }
          return {
            event: { ...COMMAND_EVENT_CATALOG.promptPresetSelected, id: promptPresetId },
            extra: { promptPresetId },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.post('/api/v1/commands/prompt-presets/import', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const body = (req.body ?? {}) as PromptPresetCommandBody
      const baseRevision = readBaseRevision(body)
      const preset = createPromptPresetRecord(readJsonObject(body.preset, 'preset'), 'Imported Prompt')
      const result = applyTargetedCommandMutation<{ promptPresetId: string }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.collection,
        collectionScopedRead: COLLECTION_SCOPED_READS.promptPresets,
        mutate(database, innerDb) {
          const target = ensureSplitPresetDatabaseObject(database)
          const presets = ensurePromptPresetCollection(target)
          if (findPromptPresetIndex(presets, preset.id) !== -1) {
            throw new ValidationError(`Duplicate prompt preset id: ${preset.id}`)
          }
          presets.push(preset)
          writeSingleCollectionTable(innerDb, 'promptPresets', presets)
          return {
            event: { ...COMMAND_EVENT_CATALOG.promptPresetImported, id: preset.id },
            extra: { promptPresetId: preset.id },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.post('/api/v1/commands/prompt-presets/reorder', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const body = (req.body ?? {}) as PromptPresetCommandBody
      const baseRevision = readBaseRevision(body)
      if (!Array.isArray(body.promptPresetIds)) {
        throw new ValidationError('promptPresetIds must be an array')
      }
      const promptPresetIds = body.promptPresetIds
      const result = applyTargetedCommandMutation<{ selectedPromptPresetId: string | null }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.collection,
        collectionScopedRead: COLLECTION_SCOPED_READS.promptPresets,
        mutate(database, innerDb) {
          const target = ensureSplitPresetDatabaseObject(database)
          const presets = ensurePromptPresetCollection(target)
          const beforeSelected = target.promptPresetsId
          const currentSelectedId = selectedPromptPresetId(target, presets)
          validateFullPromptPresetIdList(presets, promptPresetIds)
          const byId = new Map(presets.map((preset) => [preset.id, preset]))
          const reordered = promptPresetIds.map((id) => byId.get(id as string)!)
          target.promptPresets = reordered
          target.promptPresetsId = currentSelectedId
            ? requirePromptPresetIndex(reordered, currentSelectedId)
            : reordered.length > 0
              ? 0
              : -1
          writeSingleCollectionTable(innerDb, 'promptPresets', reordered)
          if (target.promptPresetsId !== beforeSelected) {
            writeSettingsOnly(innerDb, extractSettings(target))
          }
          return {
            event: COMMAND_EVENT_CATALOG.promptPresetReordered,
            extra: { selectedPromptPresetId: selectedPromptPresetId(target, reordered) },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.post('/api/v1/commands/legacy-bot-presets/:presetId/extract', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const presetId = readPresetId((req.params as { presetId?: unknown }).presetId)
      const body = (req.body ?? {}) as LegacyBotPresetCommandBody
      const baseRevision = readBaseRevision(body)
      const mode = readLegacyBotPresetExtractionMode(body.mode)
      const result = applyTargetedCommandMutation<{
        legacyPresetId: string
        modelPresetId?: string
        promptPresetId?: string
        reusedModelPreset?: boolean
      }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.collection,
        collectionScopedRead: COLLECTION_SCOPED_READS.legacyBotPresetExtraction,
        mutate(database, innerDb) {
          const target = ensureSplitPresetDatabaseObject(database)
          const extraction = extractLegacyBotPreset(target, presetId, mode)
          writeSingleCollectionTable(innerDb, 'botPresets', asArray(target.botPresets))
          writeSingleCollectionTable(innerDb, 'modelPresets', asArray(target.modelPresets))
          writeSingleCollectionTable(innerDb, 'promptPresets', asArray(target.promptPresets))
          writeSettingsOnly(innerDb, extractSettings(target))
          return {
            event: { ...COMMAND_EVENT_CATALOG.legacyBotPresetExtracted, id: presetId },
            extra: extraction,
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.patch('/api/v1/commands/prompt-settings', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const body = (req.body ?? {}) as PromptCommandBody
      const baseRevision = readBaseRevision(body)
      const patch = readPromptSettingsPatch(body.patch)
      const result = applyTargetedCommandMutation({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.settings,
        settingsScopedRead: true,
        mutate(database, innerDb) {
          applySettingsPatch(database, patch)
          writeSettingsOnly(innerDb, extractSettings(database as Record<string, unknown>))
          return {
            event: COMMAND_EVENT_CATALOG.promptSettingsUpdated,
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.post('/api/v1/commands/prompt-items', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const body = (req.body ?? {}) as PromptCommandBody
      const baseRevision = readBaseRevision(body)
      const promptPresetId = readOptionalPromptPresetIdFromBody(body)
      const promptItem = createPromptItemRecord(body.promptItem)
      const result = applyTargetedCommandMutation<{ itemId: string }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.collection,
        collectionScopedRead: promptPresetId ? COLLECTION_SCOPED_READS.promptPresets : undefined,
        mutate(database, innerDb) {
          const scoped = promptPresetId ? requireSelectedPromptPresetCommandTarget(database, promptPresetId) : undefined
          const items = scoped ? scoped.items : ensurePromptTemplateCollection(ensureDatabaseObject(database))
          if (items.some((item) => item.id === promptItem.id)) {
            throw new ValidationError(`Duplicate prompt item id: ${promptItem.id}`)
          }
          items.push(promptItem)
          if (scoped) {
            writeSingleCollectionRow(innerDb, 'promptPresets', scoped.index, scoped.preset)
          } else {
            writePromptTemplatesTable(innerDb, items)
          }
          return {
            event: {
              ...COMMAND_EVENT_CATALOG.promptItemCreated,
              id: promptItem.id,
              ...(promptPresetId ? { parentId: promptPresetId } : {}),
            },
            extra: { itemId: promptItem.id },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.patch('/api/v1/commands/prompt-items/:itemId', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const itemId = readPromptItemId((req.params as { itemId?: unknown }).itemId)
      const body = (req.body ?? {}) as PromptCommandBody
      const baseRevision = readBaseRevision(body)
      const promptPresetId = readOptionalPromptPresetIdFromBody(body)
      const patch = createPromptItemRecord({ ...readJsonObject(body.patch, 'patch'), id: itemId })
      const result = applyTargetedCommandMutation<{ itemId: string }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.collection,
        collectionScopedRead: promptPresetId ? COLLECTION_SCOPED_READS.promptPresets : undefined,
        mutate(database, innerDb) {
          const scoped = promptPresetId ? requireSelectedPromptPresetCommandTarget(database, promptPresetId) : undefined
          const items = scoped ? scoped.items : ensurePromptTemplateCollection(ensureDatabaseObject(database))
          const index = requirePromptItemIndex(items, itemId)
          items[index] = {
            ...items[index],
            ...patch,
            id: itemId,
          }
          if (scoped) {
            writeSingleCollectionRow(innerDb, 'promptPresets', scoped.index, scoped.preset)
          } else {
            writePromptTemplateRow(innerDb, index, items[index])
          }
          return {
            event: {
              ...COMMAND_EVENT_CATALOG.promptItemUpdated,
              id: itemId,
              ...(promptPresetId ? { parentId: promptPresetId } : {}),
            },
            extra: { itemId },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.delete('/api/v1/commands/prompt-items/:itemId', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const itemId = readPromptItemId((req.params as { itemId?: unknown }).itemId)
      const body = (req.body ?? {}) as PromptCommandBody
      const baseRevision = readBaseRevision(body)
      const promptPresetId = readOptionalPromptPresetIdFromBody(body)
      const result = applyTargetedCommandMutation<{ itemId: string }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.collection,
        collectionScopedRead: promptPresetId ? COLLECTION_SCOPED_READS.promptPresets : undefined,
        mutate(database, innerDb) {
          const scoped = promptPresetId ? requireSelectedPromptPresetCommandTarget(database, promptPresetId) : undefined
          const items = scoped ? scoped.items : ensurePromptTemplateCollection(ensureDatabaseObject(database))
          const index = requirePromptItemIndex(items, itemId)
          items.splice(index, 1)
          if (scoped) {
            writeSingleCollectionRow(innerDb, 'promptPresets', scoped.index, scoped.preset)
          } else {
            writePromptTemplatesTable(innerDb, items)
          }
          return {
            event: {
              ...COMMAND_EVENT_CATALOG.promptItemDeleted,
              id: itemId,
              ...(promptPresetId ? { parentId: promptPresetId } : {}),
            },
            extra: { itemId },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.post('/api/v1/commands/prompt-items/enable', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const body = (req.body ?? {}) as PromptCommandBody
      const baseRevision = readBaseRevision(body)
      if (typeof body.enabled !== 'boolean') {
        throw new ValidationError('enabled must be a boolean')
      }
      const enabled = body.enabled
      const promptPresetId = readOptionalPromptPresetIdFromBody(body)
      const result = applyTargetedCommandMutation<{ enabled: boolean }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.collection,
        collectionScopedRead: promptPresetId ? COLLECTION_SCOPED_READS.promptPresets : undefined,
        mutate(database, innerDb) {
          const scoped = promptPresetId ? requireSelectedPromptPresetCommandTarget(database, promptPresetId) : undefined
          if (scoped) {
            if (enabled) {
              ensurePromptTemplateCollection(scoped.preset)
            } else {
              delete scoped.preset.promptTemplate
            }
            writeSingleCollectionRow(innerDb, 'promptPresets', scoped.index, scoped.preset)
          } else {
            const target = ensureDatabaseObject(database)
            // enable toggles whether the prompt-items collection exists at all:
            // enabling ensures the array, disabling clears it. Either way it is a
            // single-table write — the `prompt_templates` rows, never another table.
            if (enabled) {
              const items = ensurePromptTemplateCollection(target)
              writePromptTemplatesTable(innerDb, items)
            } else {
              delete target.promptTemplate
              writePromptTemplatesTable(innerDb, [])
            }
          }
          return {
            event: {
              ...COMMAND_EVENT_CATALOG.promptItemsEnabled,
              ...(promptPresetId ? { parentId: promptPresetId } : {}),
            },
            extra: { enabled },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.post('/api/v1/commands/prompt-items/reorder', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const body = (req.body ?? {}) as PromptCommandBody
      const baseRevision = readBaseRevision(body)
      if (!Array.isArray(body.itemIds)) {
        throw new ValidationError('itemIds must be an array')
      }
      const itemIds = body.itemIds
      const promptPresetId = readOptionalPromptPresetIdFromBody(body)
      const result = applyTargetedCommandMutation({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.collection,
        collectionScopedRead: promptPresetId ? COLLECTION_SCOPED_READS.promptPresets : undefined,
        mutate(database, innerDb) {
          const scoped = promptPresetId ? requireSelectedPromptPresetCommandTarget(database, promptPresetId) : undefined
          const target = ensureDatabaseObject(database)
          const items = scoped ? scoped.items : ensurePromptTemplateCollection(target)
          validateFullPromptItemIdList(items, itemIds)
          const byId = new Map(items.map((item) => [item.id, item]))
          const reordered = itemIds.map((id) => byId.get(id)!)
          if (scoped) {
            scoped.preset.promptTemplate = reordered
            writeSingleCollectionRow(innerDb, 'promptPresets', scoped.index, scoped.preset)
          } else {
            target.promptTemplate = reordered
            writePromptTemplatesTable(innerDb, reordered)
          }
          return {
            event: {
              ...COMMAND_EVENT_CATALOG.promptItemReordered,
              ...(promptPresetId ? { parentId: promptPresetId } : {}),
            },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.post('/api/v1/commands/personas', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const body = (req.body ?? {}) as PersonaCommandBody
      const baseRevision = readBaseRevision(body)
      const persona = createPersonaRecord(body.persona, { assetDb: db })
      const mirror = readPersonaOptionalBoolean(body.mirrorLegacyProfile, 'mirrorLegacyProfile', false)
      const result = applyTargetedCommandMutation<{ personaId: string }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.collection,
        collectionScopedRead: COLLECTION_SCOPED_READS.personas,
        mutate(database, innerDb) {
          const target = ensurePersonaDatabaseObject(database)
          const personas = ensurePersonaCollection(target)
          if (findPersonaIndex(personas, persona.id) !== -1) {
            throw new ValidationError(`Duplicate persona id: ${persona.id}`)
          }
          personas.push(persona)
          writeSingleCollectionTable(innerDb, 'personas', personas)
          // Mirroring moves the selected pointer + the 4 legacy profile scalars,
          // all settings; co-write settings only when the request mirrors.
          if (mirror) {
            target.selectedPersona = personas.length - 1
            mirrorLegacyProfile(target, persona)
            writeSettingsOnly(innerDb, extractSettings(target))
          }
          return {
            event: { ...COMMAND_EVENT_CATALOG.personaCreated, id: persona.id },
            extra: { personaId: persona.id },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.patch('/api/v1/commands/personas/:personaId', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const personaId = readPersonaId((req.params as { personaId?: unknown }).personaId)
      const body = (req.body ?? {}) as PersonaCommandBody
      const baseRevision = readBaseRevision(body)
      const patch = readPersonaPatch(body.patch, { assetDb: db })
      const mirror = readPersonaOptionalBoolean(body.mirrorLegacyProfile, 'mirrorLegacyProfile', false)
      if (Object.prototype.hasOwnProperty.call(patch, 'id') && patch.id !== personaId) {
        throw new ValidationError('patch.id must match personaId')
      }
      const result = applyTargetedCommandMutation<{ personaId: string }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.collection,
        collectionScopedRead: COLLECTION_SCOPED_READS.personas,
        mutate(database, innerDb) {
          const target = ensurePersonaDatabaseObject(database)
          const personas = ensurePersonaCollection(target)
          const index = requirePersonaIndex(personas, personaId)
          personas[index] = {
            ...personas[index],
            ...patch,
            id: personaId,
          }
          writeSingleCollectionRow(innerDb, 'personas', index, personas[index])
          // Editing the selected persona with mirroring refreshes the legacy
          // profile scalars; co-write settings only then.
          if (mirror && target.selectedPersona === index) {
            mirrorLegacyProfile(target, personas[index])
            writeSettingsOnly(innerDb, extractSettings(target))
          }
          return {
            event: { ...COMMAND_EVENT_CATALOG.personaUpdated, id: personaId },
            extra: { personaId },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.delete('/api/v1/commands/personas/:personaId', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const personaId = readPersonaId((req.params as { personaId?: unknown }).personaId)
      const body = (req.body ?? {}) as PersonaCommandBody
      const baseRevision = readBaseRevision(body)
      const selectPersonaId =
        body.selectPersonaId === undefined ? undefined : readPersonaId(body.selectPersonaId, 'selectPersonaId')
      const mirror = readPersonaOptionalBoolean(body.mirrorLegacyProfile, 'mirrorLegacyProfile', true)
      const saveCurrent = readPersonaOptionalBoolean(body.saveCurrent, 'saveCurrent', false)
      const result = applyTargetedCommandMutation<{
        personaId: string
        selectedPersonaId: string | null
      }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.collection,
        collectionScopedRead: COLLECTION_SCOPED_READS.personas,
        mutate(database, innerDb) {
          const target = ensurePersonaDatabaseObject(database)
          const personas = ensurePersonaCollection(target)
          if (personas.length <= 1) {
            throw new ValidationError('Cannot delete the only persona')
          }
          const beforeSelected = target.selectedPersona
          if (saveCurrent) {
            saveSelectedPersonaSnapshot(target, personas)
          }
          const deletedIndex = requirePersonaIndex(personas, personaId)
          const currentSelectedId = selectedPersonaId(target, personas)
          const deletedWasSelected = currentSelectedId === personaId
          personas.splice(deletedIndex, 1)

          let nextSelectedId = selectPersonaId
          if (!nextSelectedId && deletedWasSelected) {
            nextSelectedId = personas[0]?.id
          } else if (!nextSelectedId) {
            nextSelectedId = currentSelectedId ?? personas[0]?.id
          }

          const selectedIndex = nextSelectedId ? requirePersonaIndex(personas, nextSelectedId) : -1
          target.selectedPersona = selectedIndex
          let mirrored = false
          if (mirror && selectedIndex >= 0) {
            mirrorLegacyProfile(target, personas[selectedIndex])
            mirrored = true
          }

          // The splice shifts positions, so the persona table is always rewritten.
          writeSingleCollectionTable(innerDb, 'personas', personas)
          // `selectedPersona` + the mirror scalars are settings; co-write settings
          // when the pointer moved or mirroring rewrote the legacy profile.
          if (mirrored || target.selectedPersona !== beforeSelected) {
            writeSettingsOnly(innerDb, extractSettings(target))
          }

          return {
            event: { ...COMMAND_EVENT_CATALOG.personaDeleted, id: personaId },
            extra: {
              personaId,
              selectedPersonaId: selectedIndex >= 0 ? personas[selectedIndex].id : null,
            },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.post('/api/v1/commands/personas/select', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const body = (req.body ?? {}) as PersonaCommandBody
      const baseRevision = readBaseRevision(body)
      const personaId = readPersonaId(body.personaId, 'personaId')
      const mirror = readPersonaOptionalBoolean(body.mirrorLegacyProfile, 'mirrorLegacyProfile', true)
      const saveCurrent = readPersonaOptionalBoolean(body.saveCurrent, 'saveCurrent', true)
      const result = applyTargetedCommandMutation<{ personaId: string }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.collection,
        collectionScopedRead: COLLECTION_SCOPED_READS.personas,
        mutate(database, innerDb) {
          const target = ensurePersonaDatabaseObject(database)
          const personas = ensurePersonaCollection(target)
          const beforeSelected = target.selectedPersona
          if (saveCurrent) {
            saveSelectedPersonaSnapshot(target, personas)
          }
          const index = requirePersonaIndex(personas, personaId)
          target.selectedPersona = index
          let mirrored = false
          if (mirror) {
            mirrorLegacyProfile(target, personas[index])
            mirrored = true
          }
          // The persona table is rewritten only when save-current snapshotted the
          // outgoing persona into it; the pointer + mirror scalars live in settings.
          if (saveCurrent) {
            writeSingleCollectionTable(innerDb, 'personas', personas)
          }
          if (mirrored || target.selectedPersona !== beforeSelected) {
            writeSettingsOnly(innerDb, extractSettings(target))
          }
          return {
            event: { ...COMMAND_EVENT_CATALOG.personaSelected, id: personaId },
            extra: { personaId },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.post('/api/v1/commands/personas/reorder', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const body = (req.body ?? {}) as PersonaCommandBody
      const baseRevision = readBaseRevision(body)
      if (!Array.isArray(body.personaIds)) {
        throw new ValidationError('personaIds must be an array')
      }
      const personaIds = body.personaIds
      const result = applyTargetedCommandMutation<{ selectedPersonaId: string | null }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.collection,
        collectionScopedRead: COLLECTION_SCOPED_READS.personas,
        mutate(database, innerDb) {
          const target = ensurePersonaDatabaseObject(database)
          const personas = ensurePersonaCollection(target)
          const beforeSelected = target.selectedPersona
          const currentSelectedId = selectedPersonaId(target, personas)
          validateFullPersonaIdList(personas, personaIds)
          const byId = new Map(personas.map((persona) => [persona.id, persona]))
          const reordered = personaIds.map((id) => byId.get(id)!)
          target.personas = reordered
          target.selectedPersona = currentSelectedId
            ? requirePersonaIndex(reordered, currentSelectedId)
            : reordered.length > 0
              ? 0
              : -1
          writeSingleCollectionTable(innerDb, 'personas', reordered)
          // `selectedPersona` is a settings scalar; co-write settings only when
          // the reorder moved the selected persona to a new index.
          if (target.selectedPersona !== beforeSelected) {
            writeSettingsOnly(innerDb, extractSettings(target))
          }
          return {
            event: COMMAND_EVENT_CATALOG.personaReordered,
            extra: { selectedPersonaId: selectedPersonaId(target, reordered) },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.post('/api/v1/commands/translator-presets', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const body = (req.body ?? {}) as TranslatorPresetCommandBody
      const baseRevision = readBaseRevision(body)
      const preset = createTranslatorPresetRecord(body.preset)
      const select = readTranslatorPresetOptionalBoolean(body.select, 'select', false)
      const result = applyTargetedCommandMutation<{ presetId: string }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.collection,
        collectionScopedRead: COLLECTION_SCOPED_READS.translatorPresets,
        mutate(database, innerDb) {
          const target = ensureTranslatorPresetDatabaseObject(database)
          const presets = ensureTranslatorPresetCollection(target)
          if (findTranslatorPresetIndex(presets, preset.id) !== -1) {
            throw new ValidationError(`Duplicate translator preset id: ${preset.id}`)
          }
          presets.push(preset)
          if (select) {
            target.translatorPresetId = presets.length - 1
            syncSelectedTranslatorPresetToLegacyFields(target, presets)
          }
          writeTranslatorPresetMutation(innerDb, target, presets)
          return {
            event: { ...COMMAND_EVENT_CATALOG.translatorPresetCreated, id: preset.id },
            extra: { presetId: preset.id },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.patch('/api/v1/commands/translator-presets/:presetId', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const presetId = readTranslatorPresetId((req.params as { presetId?: unknown }).presetId, 'presetId')
      const body = (req.body ?? {}) as TranslatorPresetCommandBody
      const baseRevision = readBaseRevision(body)
      const patch = readTranslatorPresetPatch(body.patch)
      if (Object.prototype.hasOwnProperty.call(patch, 'id') && patch.id !== presetId) {
        throw new ValidationError('patch.id must match presetId')
      }
      const result = applyTargetedCommandMutation<{ presetId: string }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.collection,
        collectionScopedRead: COLLECTION_SCOPED_READS.translatorPresets,
        mutate(database, innerDb) {
          const target = ensureTranslatorPresetDatabaseObject(database)
          const presets = ensureTranslatorPresetCollection(target)
          const index = requireTranslatorPresetIndex(presets, presetId)
          presets[index] = {
            ...presets[index],
            ...patch,
            id: presetId,
          }
          if (target.translatorPresetId === index) {
            syncSelectedTranslatorPresetToLegacyFields(target, presets)
          }
          writeTranslatorPresetMutation(innerDb, target, presets)
          return {
            event: { ...COMMAND_EVENT_CATALOG.translatorPresetUpdated, id: presetId },
            extra: { presetId },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.delete('/api/v1/commands/translator-presets/:presetId', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const presetId = readTranslatorPresetId((req.params as { presetId?: unknown }).presetId, 'presetId')
      const body = (req.body ?? {}) as TranslatorPresetCommandBody
      const baseRevision = readBaseRevision(body)
      const selectPresetId =
        body.selectPresetId === undefined ? undefined : readTranslatorPresetId(body.selectPresetId, 'selectPresetId')
      const result = applyTargetedCommandMutation<{
        presetId: string
        selectedPresetId: string | null
      }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.collection,
        collectionScopedRead: COLLECTION_SCOPED_READS.translatorPresets,
        mutate(database, innerDb) {
          const target = ensureTranslatorPresetDatabaseObject(database)
          const presets = ensureTranslatorPresetCollection(target)
          if (presets.length <= 1) {
            throw new ValidationError('Cannot delete the only translator preset')
          }
          const deletedIndex = requireTranslatorPresetIndex(presets, presetId)
          const currentSelectedId = selectedTranslatorPresetId(target, presets)
          const deletedWasSelected = currentSelectedId === presetId
          presets.splice(deletedIndex, 1)

          let nextSelectedId = selectPresetId
          if (!nextSelectedId && deletedWasSelected) {
            nextSelectedId = presets[0]?.id
          } else if (!nextSelectedId) {
            nextSelectedId = currentSelectedId ?? presets[0]?.id
          }

          const selectedIndex = nextSelectedId ? requireTranslatorPresetIndex(presets, nextSelectedId) : 0
          target.translatorPresetId = selectedIndex
          syncSelectedTranslatorPresetToLegacyFields(target, presets)
          writeTranslatorPresetMutation(innerDb, target, presets)

          return {
            event: { ...COMMAND_EVENT_CATALOG.translatorPresetDeleted, id: presetId },
            extra: {
              presetId,
              selectedPresetId: selectedTranslatorPresetId(target, presets),
            },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.post('/api/v1/commands/translator-presets/select', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const body = (req.body ?? {}) as TranslatorPresetCommandBody
      const baseRevision = readBaseRevision(body)
      const presetId = readTranslatorPresetId(body.presetId, 'presetId')
      const result = applyTargetedCommandMutation<{ presetId: string }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.collection,
        collectionScopedRead: COLLECTION_SCOPED_READS.translatorPresets,
        mutate(database, innerDb) {
          const target = ensureTranslatorPresetDatabaseObject(database)
          const presets = ensureTranslatorPresetCollection(target)
          const index = requireTranslatorPresetIndex(presets, presetId)
          target.translatorPresetId = index
          syncSelectedTranslatorPresetToLegacyFields(target, presets)
          writeTranslatorPresetMutation(innerDb, target, presets)
          return {
            event: { ...COMMAND_EVENT_CATALOG.translatorPresetSelected, id: presetId },
            extra: { presetId },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.post('/api/v1/commands/loadouts', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const body = (req.body ?? {}) as LoadoutCommandBody
      const baseRevision = readBaseRevision(body)
      const loadout = createLoadoutRecord(body.loadout)
      const result = applyTargetedCommandMutation<{ loadoutId: string }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.collection,
        collectionScopedRead: COLLECTION_SCOPED_READS.loadouts,
        mutate(database, innerDb) {
          const target = ensureLoadoutDatabaseObject(database)
          const loadouts = ensureLoadoutCollection(target)
          const beforeLastLoaded = target.lastLoadedLoadoutName
          if (findLoadoutIndex(loadouts, loadout.id) !== -1) {
            throw new ValidationError(`Duplicate loadout id: ${loadout.id}`)
          }
          loadouts.push(loadout)
          writeLoadoutMutation(innerDb, target, loadouts, beforeLastLoaded)
          return {
            event: { ...COMMAND_EVENT_CATALOG.loadoutCreated, id: loadout.id },
            extra: { loadoutId: loadout.id },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.patch('/api/v1/commands/loadouts/:loadoutId', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const loadoutId = readLoadoutId((req.params as { loadoutId?: unknown }).loadoutId)
      const body = (req.body ?? {}) as LoadoutCommandBody
      const baseRevision = readBaseRevision(body)
      const patch = readLoadoutPatch(body.patch)
      if (Object.prototype.hasOwnProperty.call(patch, 'id') && patch.id !== loadoutId) {
        throw new ValidationError('patch.id must match loadoutId')
      }
      const result = applyTargetedCommandMutation<{ loadoutId: string }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.collection,
        collectionScopedRead: COLLECTION_SCOPED_READS.loadouts,
        mutate(database, innerDb) {
          const target = ensureLoadoutDatabaseObject(database)
          const loadouts = ensureLoadoutCollection(target)
          const beforeLastLoaded = target.lastLoadedLoadoutName
          const index = requireLoadoutIndex(loadouts, loadoutId)
          loadouts[index] = {
            ...loadouts[index],
            ...patch,
            id: loadoutId,
          }
          writeLoadoutMutation(innerDb, target, loadouts, beforeLastLoaded)
          return {
            event: { ...COMMAND_EVENT_CATALOG.loadoutUpdated, id: loadoutId },
            extra: { loadoutId },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.delete('/api/v1/commands/loadouts/:loadoutId', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const loadoutId = readLoadoutId((req.params as { loadoutId?: unknown }).loadoutId)
      const body = (req.body ?? {}) as LoadoutCommandBody
      const baseRevision = readBaseRevision(body)
      const result = applyTargetedCommandMutation<{ loadoutId: string }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.collection,
        collectionScopedRead: COLLECTION_SCOPED_READS.loadouts,
        mutate(database, innerDb) {
          const target = ensureLoadoutDatabaseObject(database)
          const loadouts = ensureLoadoutCollection(target)
          const beforeLastLoaded = target.lastLoadedLoadoutName
          const index = requireLoadoutIndex(loadouts, loadoutId)
          loadouts.splice(index, 1)
          writeLoadoutMutation(innerDb, target, loadouts, beforeLastLoaded)
          return {
            event: { ...COMMAND_EVENT_CATALOG.loadoutDeleted, id: loadoutId },
            extra: { loadoutId },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.post('/api/v1/commands/loadouts/:loadoutId/favorite', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const loadoutId = readLoadoutId((req.params as { loadoutId?: unknown }).loadoutId)
      const body = (req.body ?? {}) as LoadoutCommandBody
      const baseRevision = readBaseRevision(body)
      const favorite = readLoadoutOptionalBoolean(body.favorite, 'favorite', true)
      const result = applyTargetedCommandMutation<{ loadoutId: string }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.collection,
        collectionScopedRead: COLLECTION_SCOPED_READS.loadouts,
        mutate(database, innerDb) {
          const target = ensureLoadoutDatabaseObject(database)
          const loadouts = ensureLoadoutCollection(target)
          const beforeLastLoaded = target.lastLoadedLoadoutName
          const index = requireLoadoutIndex(loadouts, loadoutId)
          loadouts[index].favorite = favorite
          writeLoadoutMutation(innerDb, target, loadouts, beforeLastLoaded)
          return {
            event: { ...COMMAND_EVENT_CATALOG.loadoutFavorited, id: loadoutId },
            extra: { loadoutId },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.post('/api/v1/commands/loadouts/:loadoutId/touch', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const loadoutId = readLoadoutId((req.params as { loadoutId?: unknown }).loadoutId)
      const body = (req.body ?? {}) as LoadoutCommandBody
      const baseRevision = readBaseRevision(body)
      const lastUsed = readOptionalTimestamp(body.lastUsed, 'lastUsed')
      const characterId = readOptionalCharacterId(body.characterId)
      const result = applyTargetedCommandMutation<{ loadoutId: string }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.collection,
        collectionScopedRead: COLLECTION_SCOPED_READS.loadouts,
        mutate(database, innerDb) {
          const target = ensureLoadoutDatabaseObject(database)
          const loadouts = ensureLoadoutCollection(target)
          const beforeLastLoaded = target.lastLoadedLoadoutName
          const index = requireLoadoutIndex(loadouts, loadoutId)
          const loadout = loadouts[index]
          loadout.lastUsed = lastUsed
          if (characterId && !loadout.characterIds.includes(characterId)) {
            loadout.characterIds.push(characterId)
          }
          target.lastLoadedLoadoutName = loadout.name
          writeLoadoutMutation(innerDb, target, loadouts, beforeLastLoaded)
          return {
            event: { ...COMMAND_EVENT_CATALOG.loadoutTouched, id: loadoutId },
            extra: { loadoutId },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.post('/api/v1/commands/characters', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const body = (req.body ?? {}) as CharacterCommandBody
      const baseRevision = readBaseRevision(body)
      const character = createCharacterRecord(body.character, { assetDb: db })
      const result = applyMessageFreeJsonCommandMutation<{
        characterId: string
        selectedCharacterId: string | null
      }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutate(database) {
          const target = ensureCharacterDatabaseObject(database)
          const characters = ensureCharacterCollection(target)
          if (findCharacterIndex(characters, character.chaId) !== -1) {
            throw new ValidationError(`Duplicate character id: ${character.chaId}`)
          }
          characters.push(character)
          const normalizedCharacters = ensureCharacterCollection(target)
          return {
            event: { ...COMMAND_EVENT_CATALOG.characterCreated, id: character.chaId },
            extra: {
              characterId: character.chaId,
              selectedCharacterId: selectedCharacterId(target, normalizedCharacters),
            },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.post('/api/v1/commands/characters/create-and-select', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const body = (req.body ?? {}) as CharacterCommandBody
      const baseRevision = readBaseRevision(body)
      const character = createCharacterRecord(body.character, { assetDb: db })
      const lastInteraction = readSelectionLastInteraction(body.lastInteraction)
      character.lastInteraction = lastInteraction
      const result = applyMessageFreeJsonCommandMutation<{
        characterId: string
        selectedCharacterId: string | null
      }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutate(database) {
          const target = ensureCharacterDatabaseObject(database)
          const characters = ensureCharacterCollection(target)
          if (findCharacterIndex(characters, character.chaId) !== -1) {
            throw new ValidationError(`Duplicate character id: ${character.chaId}`)
          }
          characters.push(character)
          const normalizedCharacters = ensureCharacterCollection(target)
          target.currentChar = requireCharacterIndex(normalizedCharacters, character.chaId)
          return {
            event: { ...COMMAND_EVENT_CATALOG.characterCreatedAndSelected, id: character.chaId },
            extra: {
              characterId: character.chaId,
              selectedCharacterId: selectedCharacterId(target, normalizedCharacters),
            },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.patch('/api/v1/commands/characters/:characterId', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const characterId = readCharacterId((req.params as { characterId?: unknown }).characterId)
      const body = (req.body ?? {}) as CharacterCommandBody
      const baseRevision = readBaseRevision(body)
      const patch = readCharacterPatch(body.patch, { assetDb: db })
      const result = applyTargetedCommandMutation<{ characterId: string }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.characterRow,
        characterScopedRead: { characterId },
        mutate(database, innerDb) {
          const target = ensureCharacterDatabaseObject(database)
          const characters = Array.isArray(target.characters) ? target.characters : []
          const index = characters.findIndex(
            (character) =>
              !!character &&
              typeof character === 'object' &&
              !Array.isArray(character) &&
              (character as Record<string, unknown>).chaId === characterId,
          )
          if (index === -1) {
            throw new EntityNotFoundError(`Character not found: ${characterId}`)
          }
          const patched = buildPatchedCharacterCollectionRow(characters[index], patch, characterId, index)
          characters[index] = patched
          writeSingleCharacterRow(innerDb, characterId, patched)
          const updatesTrashState = Object.prototype.hasOwnProperty.call(patch, 'trashTime')
          if (updatesTrashState) {
            updateCharacterOrderForPatchedRow(target, characterId, patched)
            writeSettingsOnly(innerDb, extractSettings(target))
          }
          return {
            event: {
              ...(updatesTrashState
                ? COMMAND_EVENT_CATALOG.characterTrashUpdated
                : COMMAND_EVENT_CATALOG.characterUpdated),
              id: characterId,
            },
            extra: { characterId },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.delete('/api/v1/commands/characters/:characterId', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const characterId = readCharacterId((req.params as { characterId?: unknown }).characterId)
      const body = (req.body ?? {}) as CharacterCommandBody
      const baseRevision = readBaseRevision(body)
      const result = applyTargetedCommandMutation<{
        characterId: string
        selectedCharacterId: string | null
      }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.characterRow,
        // Character deletion does not hydrate messages; it removes character,
        // chat, message, and hypa rows directly, then persists settings pointers.
        // Sibling character-row repairs mutate the clone only and are discarded.
        mutate(database, innerDb) {
          const target = ensureCharacterDatabaseObject(database)
          const characters = ensureCharacterCollection(target)
          const index = requireCharacterIndex(characters, characterId)
          const character = characters[index]
          const removedChatIds = ensureCharacterChats(character).map((chat) => chat.id)
          characters.splice(index, 1)
          ensureCharacterCollection(target)
          // The chats.character_id ON DELETE CASCADE removes the chat rows with
          // the character row; no explicit chats DELETE needed.
          deleteCharacterRow(innerDb, characterId)
          for (const chatId of removedChatIds) {
            deleteChatMessages(innerDb, chatId)
            deleteChatHypaV3(innerDb, chatId)
          }
          writeSettingsOnly(innerDb, extractSettings(target))
          return {
            event: { ...COMMAND_EVENT_CATALOG.characterDeleted, id: characterId },
            extra: {
              characterId,
              selectedCharacterId: selectedCharacterId(target, characters),
            },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.post('/api/v1/commands/characters/select', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const body = (req.body ?? {}) as CharacterCommandBody
      const baseRevision = readBaseRevision(body)
      const characterId = readCharacterId(body.characterId)
      const lastInteraction = readSelectionLastInteraction(body.lastInteraction)
      const result = applyCharacterSelectionCommandMutation({
        db,
        baseRevision,
        characterId,
        lastInteraction,
        ...commandMutationContext(req, eventSink),
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.post('/api/v1/commands/characters/reorder', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const body = (req.body ?? {}) as CharacterCommandBody
      const baseRevision = readBaseRevision(body)
      const order =
        body.characterOrder !== undefined
          ? readCharacterOrder(body.characterOrder)
          : readCharacterOrder(body.characterIds)
      validateCharacterOrderAssetRefs(db, order)
      const result = applyTargetedCommandMutation<{ selectedCharacterId: string | null }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.settings,
        mutate(database, innerDb) {
          const target = ensureCharacterDatabaseObject(database)
          const characters = ensureCharacterCollection(target)
          validateFullCharacterOrder(characters, order)
          // `characterOrder` is a settings scalar; reorder edits presentation
          // order, not `characters` table positions. The `ensureCharacterCollection`
          // repair on sibling rows is validate-only and is not persisted.
          target.characterOrder = order
          writeSettingsOnly(innerDb, extractSettings(target))
          return {
            event: COMMAND_EVENT_CATALOG.characterReordered,
            extra: { selectedCharacterId: selectedCharacterId(target, characters) },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.post('/api/v1/commands/characters/:characterId/chats', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const characterId = readCharacterId((req.params as { characterId?: unknown }).characterId)
      const body = (req.body ?? {}) as ChatCommandBody
      const baseRevision = readBaseRevision(body)
      const chat = createChatRecord(body.chat)
      const chatMessages = readReplacementMessages(chat.message)
      chat.message = chatMessages
      const selectCreated = readChatOptionalBoolean(body.select, 'select') ?? true
      const result = applyTargetedCommandMutation<{
        chatId: string
        selectedChatId: string | null
        generationSettings: object | null
      }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.characterRow,
        mutate(database, innerDb) {
          const target = ensureModuleCommandDatabase(database)
          const characters = normalizeAllCharacterChats(target)
          const modules = ensureModuleRecords(target)
          const character = characters[requireCharacterIndex(characters, characterId)]
          const previousSelectedChatId = selectedChatId(character)
          const chats = ensureCharacterChats(character)
          if (chatIdExists(characters, chat.id)) {
            throw new ValidationError(`Duplicate chat id: ${chat.id}`)
          }
          for (const message of chatMessages) {
            if (activeMessageIdExists(innerDb, message.chatId as string)) {
              throw new ValidationError(`Duplicate message id: ${message.chatId}`)
            }
          }
          if (chat.modules) {
            validateNormalModuleLinks(modules, chat.modules, 'chat.modules')
          }
          if (chat.folderId) {
            const folders = ensureCharacterChatFolders(character)
            if (!folders.some((folder) => folder.id === chat.folderId)) {
              throw new ValidationError(`Unknown chat folder id: ${chat.folderId}`)
            }
          }
          if (Object.prototype.hasOwnProperty.call(chat, 'generationSettings')) {
            chat.generationSettings = readChatGenerationSettingsSave(
              chat.generationSettings,
              buildChatGenerationSettingsValidationContext(target, character, chat),
            )
          }
          chats.unshift(chat)
          if (selectCreated) {
            character.chatPage = 0
          } else if (previousSelectedChatId) {
            selectChat(character, previousSelectedChatId)
          } else {
            ensureCharacterChats(character)
          }
          writeCharacterChatRows(innerDb, characterId, character.chats as Record<string, unknown>[])
          insertCharacterChatRow(innerDb, characterId, 0, chat as Record<string, unknown>)
          replaceActiveChatMessages(innerDb, chat.id, chatMessages)
          setChatHypaV3(innerDb, chat.id, chat.hypaV3Data)
          writeSingleCharacterRow(innerDb, characterId, character)
          return {
            event: {
              ...(chatMessages.length > 0
                ? COMMAND_EVENT_CATALOG.chatCreatedWithTranscript
                : COMMAND_EVENT_CATALOG.chatCreated),
              id: chat.id,
              parentId: characterId,
            },
            extra: {
              chatId: chat.id,
              selectedChatId: selectedChatId(character),
              generationSettings: chat.generationSettings ?? null,
            },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.patch('/api/v1/commands/chats/:chatId', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const chatId = readChatId((req.params as { chatId?: unknown }).chatId)
      const body = (req.body ?? {}) as ChatCommandBody
      const baseRevision = readBaseRevision(body)
      const selectUpdated = readChatOptionalBoolean(body.select, 'select') ?? false
      const patch = readChatPatch(body.patch, { allowEmpty: selectUpdated })
      const hasModulePatch = Object.prototype.hasOwnProperty.call(patch, 'modules')
      const result = applyTargetedCommandMutation<{
        chatId: string
        selectedChatId: string | null
      }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.chatRow,
        ...(hasModulePatch ? {} : { chatScopedRead: { chatId } }),
        mutate(database, innerDb) {
          const target = hasModulePatch
            ? ensureModuleCommandDatabase(database)
            : ensureCharacterDatabaseObject(database)
          const characters = normalizeAllCharacterChats(target)
          const { character, chatIndex } = requireChatLocation(characters, chatId)
          if (hasModulePatch) {
            const modules = ensureModuleRecords(target)
            validateNormalModuleLinks(modules, patch.modules as string[], 'patch.modules')
          }
          if (patch.folderId) {
            const folders = ensureCharacterChatFolders(character)
            if (!folders.some((folder) => folder.id === patch.folderId)) {
              throw new ValidationError(`Unknown chat folder id: ${patch.folderId}`)
            }
          }
          const chats = ensureCharacterChats(character)
          chats[chatIndex] = {
            ...chats[chatIndex],
            ...patch,
            id: chatId,
          }
          writeSingleChatRow(innerDb, chatId, chats[chatIndex])
          // The parent character row is rewritten only when `select:true` moves
          // its `chatPage` pointer.
          if (selectUpdated) {
            character.chatPage = chatIndex
            writeSingleCharacterRow(innerDb, character.chaId as string, character)
          }
          return {
            event: { ...COMMAND_EVENT_CATALOG.chatUpdated, id: chatId, parentId: character.chaId },
            extra: { chatId, selectedChatId: selectedChatId(character) },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.put('/api/v1/commands/chats/:chatId/generation-settings', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const chatId = readChatId((req.params as { chatId?: unknown }).chatId)
      const body = (req.body ?? {}) as ChatCommandBody
      const baseRevision = readBaseRevision(body)
      const result = applyTargetedCommandMutation<{
        chatId: string
        characterId: string
        generationSettings: ChatGenerationSettings
      }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.chatRow,
        mutate(database, innerDb) {
          const target = ensureModuleCommandDatabase(database)
          const characters = normalizeAllCharacterChats(target)
          const { character, chat } = requireChatLocation(characters, chatId)
          chat.generationSettings = readChatGenerationSettingsSave(
            body.generationSettings,
            buildChatGenerationSettingsValidationContext(target, character, chat),
          )
          writeSingleChatRow(innerDb, chatId, chat)
          return {
            event: { ...COMMAND_EVENT_CATALOG.chatUpdated, id: chatId, parentId: character.chaId },
            extra: {
              chatId,
              characterId: character.chaId,
              // Return the value that was actually persisted. Validation can
              // prune stale sidebar-toggle keys, so echoing the request would
              // not be an authoritative command acknowledgement.
              generationSettings: chat.generationSettings,
            },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.delete('/api/v1/commands/chats/:chatId', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const chatId = readChatId((req.params as { chatId?: unknown }).chatId)
      const body = (req.body ?? {}) as ChatCommandBody
      const baseRevision = readBaseRevision(body)
      const result = applyTargetedCommandMutation<{
        chatId: string
        selectedChatId: string | null
      }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.characterRow,
        // Chat deletion works on metadata only; orphan message/hypa rows are
        // removed with targeted deletes. Global sibling id de-dup mutates the
        // clone only and is discarded.
        mutate(database, innerDb) {
          const characters = normalizeAllCharacterChats(database)
          const { character, chatIndex } = requireChatLocation(characters, chatId)
          const chats = ensureCharacterChats(character)
          if (chats.length <= 1) {
            throw new ValidationError('Cannot delete the only chat for a character')
          }
          chats.splice(chatIndex, 1)
          ensureCharacterChats(character)
          const characterId = character.chaId as string
          deleteCharacterChatRow(innerDb, chatId, characterId)
          writeCharacterChatRows(innerDb, characterId, chats as Record<string, unknown>[])
          writeSingleCharacterRow(innerDb, characterId, character)
          deleteChatMessages(innerDb, chatId)
          deleteChatHypaV3(innerDb, chatId)
          return {
            event: { ...COMMAND_EVENT_CATALOG.chatDeleted, id: chatId, parentId: character.chaId },
            extra: { chatId, selectedChatId: selectedChatId(character) },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.post('/api/v1/commands/chats/:chatId/fork', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const sourceChatId = readChatId((req.params as { chatId?: unknown }).chatId)
      const body = (req.body ?? {}) as ChatCommandBody
      const baseRevision = readBaseRevision(body)
      const forkedChat = createChatRecord(body.chat)
      const forkedMessages = readReplacementMessages(forkedChat.message)
      forkedChat.message = forkedMessages
      const sourcePatch = body.sourcePatch === undefined ? {} : readChatPatch(body.sourcePatch, { allowEmpty: true })
      const folder = body.folder === undefined ? null : createChatFolderRecord(body.folder)
      const selectFork = readChatOptionalBoolean(body.select, 'select') ?? true
      const result = applyTargetedCommandMutation<{
        chatId: string
        sourceChatId: string
        selectedChatId: string | null
        generationSettings: object | null
      }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.characterRow,
        mutate(database, innerDb) {
          const target = ensureModuleCommandDatabase(database)
          const characters = normalizeAllCharacterChats(target)
          const modules = ensureModuleRecords(target)
          const { character, chatIndex } = requireChatLocation(characters, sourceChatId)
          const previousSelectedChatId = selectedChatId(character)
          const chats = ensureCharacterChats(character)
          const folders = ensureCharacterChatFolders(character)
          if (folder) {
            if (chatFolderIdExists(characters, folder.id)) {
              throw new ValidationError(`Duplicate chat folder id: ${folder.id}`)
            }
            folders.unshift(folder)
          }
          if (sourcePatch.folderId) {
            if (!folders.some((existing) => existing.id === sourcePatch.folderId)) {
              throw new ValidationError(`Unknown chat folder id: ${sourcePatch.folderId}`)
            }
          }
          if (sourcePatch.modules) {
            validateNormalModuleLinks(modules, sourcePatch.modules as string[], 'sourcePatch.modules')
          }
          const inheritedGenerationSettings = cloneChatGenerationSettings(chats[chatIndex].generationSettings)
          chats[chatIndex] = {
            ...chats[chatIndex],
            ...sourcePatch,
            id: sourceChatId,
          }

          const nextChat = forkedChat
          if (chatIdExists(characters, nextChat.id)) {
            throw new ValidationError(`Duplicate chat id: ${nextChat.id}`)
          }
          // Message-id uniqueness is checked directly against the message store
          // with a targeted query; the fork path does not hydrate unrelated messages.
          for (const message of forkedMessages) {
            if (activeMessageIdExists(innerDb, message.chatId as string)) {
              throw new ValidationError(`Duplicate message id: ${message.chatId}`)
            }
          }
          if (nextChat.modules) {
            validateNormalModuleLinks(modules, nextChat.modules, 'chat.modules')
          }
          if (nextChat.folderId && !folders.some((existing) => existing.id === nextChat.folderId)) {
            throw new ValidationError(`Unknown chat folder id: ${nextChat.folderId}`)
          }
          if (Object.prototype.hasOwnProperty.call(nextChat, 'generationSettings')) {
            nextChat.generationSettings = readChatGenerationSettingsSave(
              nextChat.generationSettings,
              buildChatGenerationSettingsValidationContext(target, character, nextChat),
            )
          } else if (inheritedGenerationSettings) {
            nextChat.generationSettings = inheritedGenerationSettings
          }
          chats.unshift(nextChat)
          if (selectFork) {
            character.chatPage = 0
          } else if (previousSelectedChatId) {
            selectChat(character, previousSelectedChatId)
          } else {
            ensureCharacterChats(character)
          }
          // Surgical fork persistence, scoped to the source character: re-stamp
          // its existing chat-row positions (source chat's `sourcePatch` rides
          // along) — the `unshift`ed new chat is a no-op UPDATE until it is
          // INSERTed at position 0 — then persist the forked chat's messages to
          // the message store and write the character row (`chatPage`/folder).
          // Existing chats' messages are untouched (UPDATE, not DELETE+reINSERT).
          const characterId = character.chaId as string
          writeCharacterChatRows(innerDb, characterId, character.chats as Record<string, unknown>[])
          insertCharacterChatRow(innerDb, characterId, 0, nextChat as Record<string, unknown>)
          replaceActiveChatMessages(innerDb, nextChat.id, forkedMessages)
          setChatHypaV3(innerDb, nextChat.id, nextChat.hypaV3Data)
          writeSingleCharacterRow(innerDb, characterId, character)
          return {
            event: {
              ...(forkedMessages.length > 0
                ? COMMAND_EVENT_CATALOG.chatForkedWithTranscript
                : COMMAND_EVENT_CATALOG.chatForked),
              id: nextChat.id,
              parentId: character.chaId,
            },
            extra: {
              chatId: nextChat.id,
              sourceChatId,
              selectedChatId: selectedChatId(character),
              generationSettings: nextChat.generationSettings ?? null,
            },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.post('/api/v1/commands/characters/:characterId/chats/reorder', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const characterId = readCharacterId((req.params as { characterId?: unknown }).characterId)
      const body = (req.body ?? {}) as ChatCommandBody
      const baseRevision = readBaseRevision(body)
      const chatIds = readChatIdList(body.chatIds)
      const folderByChatId = readOptionalFolderByChatId(body.folderByChatId)
      const selectedId =
        body.selectedChatId === undefined ? undefined : readChatId(body.selectedChatId, 'selectedChatId')
      const result = applyTargetedCommandMutation<{ selectedChatId: string | null }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.characterRow,
        mutate(database, innerDb) {
          const characters = normalizeAllCharacterChats(database)
          const character = characters[requireCharacterIndex(characters, characterId)]
          validateFullChatOrder(character, chatIds, folderByChatId)
          const chats = ensureCharacterChats(character)
          const chatById = new Map(chats.map((chat) => [chat.id, chat]))
          character.chats = chatIds.map((chatId) => {
            const chat = chatById.get(chatId)!
            if (Object.prototype.hasOwnProperty.call(folderByChatId, chatId)) {
              chat.folderId = folderByChatId[chatId]
            }
            return chat
          })
          if (selectedId) {
            selectChat(character, selectedId)
          } else {
            ensureCharacterChats(character)
          }
          // Reorder shifts only this character's chat-row positions (+ folderId
          // where folderByChatId moved a chat); the character row carries the
          // `chatPage` pointer. No other character or collection is touched.
          writeCharacterChatRows(innerDb, characterId, character.chats as Record<string, unknown>[])
          writeSingleCharacterRow(innerDb, characterId, character)
          return {
            event: { ...COMMAND_EVENT_CATALOG.chatReordered, parentId: characterId },
            extra: { selectedChatId: selectedChatId(character) },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.post('/api/v1/commands/characters/:characterId/chat-folders', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const characterId = readCharacterId((req.params as { characterId?: unknown }).characterId)
      const body = (req.body ?? {}) as ChatFolderCommandBody
      const baseRevision = readBaseRevision(body)
      const folder = createChatFolderRecord(body.folder)
      const result = applyTargetedCommandMutation<{ folderId: string }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.characterRow,
        mutate(database, innerDb) {
          const characters = normalizeAllCharacterChats(database)
          const character = characters[requireCharacterIndex(characters, characterId)]
          const folders = ensureCharacterChatFolders(character)
          if (chatFolderIdExists(characters, folder.id)) {
            throw new ValidationError(`Duplicate chat folder id: ${folder.id}`)
          }
          // `chatFolders` lives in the character row; sibling-character chat
          // normalization is validate-only.
          folders.unshift(folder)
          writeSingleCharacterRow(innerDb, characterId, character)
          return {
            event: {
              ...COMMAND_EVENT_CATALOG.chatFolderCreated,
              id: folder.id,
              parentId: characterId,
            },
            extra: { folderId: folder.id },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.patch('/api/v1/commands/chat-folders/:folderId', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const folderId = readChatFolderId((req.params as { folderId?: unknown }).folderId)
      const body = (req.body ?? {}) as ChatFolderCommandBody
      const baseRevision = readBaseRevision(body)
      const patch = readChatFolderPatch(body.patch)
      const result = applyTargetedCommandMutation<{ folderId: string }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.characterRow,
        mutate(database, innerDb) {
          const characters = normalizeAllCharacterChats(database)
          const { character, folderIndex } = requireChatFolderIndex(characters, folderId)
          const folders = ensureCharacterChatFolders(character)
          folders[folderIndex] = {
            ...folders[folderIndex],
            ...patch,
            id: folderId,
          }
          writeSingleCharacterRow(innerDb, character.chaId as string, character)
          return {
            event: {
              ...COMMAND_EVENT_CATALOG.chatFolderUpdated,
              id: folderId,
              parentId: character.chaId,
            },
            extra: { folderId },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.delete('/api/v1/commands/chat-folders/:folderId', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const folderId = readChatFolderId((req.params as { folderId?: unknown }).folderId)
      const body = (req.body ?? {}) as ChatFolderCommandBody
      const baseRevision = readBaseRevision(body)
      const result = applyTargetedCommandMutation<{ folderId: string }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.characterRow,
        mutate(database, innerDb) {
          const characters = normalizeAllCharacterChats(database)
          const { character, folderIndex } = requireChatFolderIndex(characters, folderId)
          const folders = ensureCharacterChatFolders(character)
          folders.splice(folderIndex, 1)
          // The folder lives on the character row (`chatFolders`); deleting it
          // re-homes only the chat rows whose `folderId` pointed at it. Iterate
          // the already-normalized `character.chats` directly: calling
          // `ensureCharacterChats` again here would itself null the now-orphaned
          // `folderId` before this comparison could see it.
          const reHomed: Record<string, unknown>[] = []
          for (const chat of character.chats as Record<string, unknown>[]) {
            if (chat.folderId === folderId) {
              chat.folderId = null
              reHomed.push(chat)
            }
          }
          writeSingleCharacterRow(innerDb, character.chaId as string, character)
          for (const chat of reHomed) {
            writeSingleChatRow(innerDb, chat.id as string, chat)
          }
          return {
            event: {
              ...COMMAND_EVENT_CATALOG.chatFolderDeleted,
              id: folderId,
              parentId: character.chaId,
            },
            extra: { folderId },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.post('/api/v1/commands/characters/:characterId/chat-folders/reorder', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const characterId = readCharacterId((req.params as { characterId?: unknown }).characterId)
      const body = (req.body ?? {}) as ChatFolderCommandBody
      const baseRevision = readBaseRevision(body)
      const folderIds = readChatFolderIdList(body.folderIds)
      const selectedId =
        body.selectedChatId === undefined ? undefined : readChatId(body.selectedChatId, 'selectedChatId')
      const result = applyTargetedCommandMutation<{ selectedChatId: string | null }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.characterRow,
        mutate(database, innerDb) {
          const characters = normalizeAllCharacterChats(database)
          const character = characters[requireCharacterIndex(characters, characterId)]
          validateFullChatFolderOrder(character, folderIds)
          const folders = ensureCharacterChatFolders(character)
          const folderById = new Map(folders.map((folder) => [folder.id, folder]))
          // `chatFolders` and `chatPage` (via selectChat) live in the character
          // row; reordering folders touches no chat row.
          character.chatFolders = folderIds.map((folderId) => folderById.get(folderId)!)
          if (selectedId) {
            selectChat(character, selectedId)
          }
          writeSingleCharacterRow(innerDb, characterId, character)
          return {
            event: { ...COMMAND_EVENT_CATALOG.chatFolderReordered, parentId: characterId },
            extra: { selectedChatId: selectedChatId(character) },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.patch('/api/v1/commands/chats/:chatId/scriptstate', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const chatId = readChatId((req.params as { chatId?: unknown }).chatId)
      const body = (req.body ?? {}) as ChatCommandBody
      const baseRevision = readBaseRevision(body)
      const patch = readChatScriptstatePatch(body.patch)
      const deleteKeys = readChatScriptstateDeleteKeys(body.deleteKeys)
      validateChatScriptstateCommand(patch, deleteKeys)
      const result = applyTargetedCommandMutation<{ chatId: string }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.chatRow,
        // This callback only locates + rewrites the one chat row.
        chatScopedRead: { chatId },
        mutate(database, innerDb) {
          const characters = normalizeAllCharacterChats(database)
          const { character, chat } = requireChatLocation(characters, chatId)
          // This path updates only the chat row's `scriptstate`; sibling chat
          // normalization is validate-only.
          chat.scriptstate ??= {}
          for (const key of deleteKeys) {
            delete chat.scriptstate[key]
          }
          Object.assign(chat.scriptstate, patch)
          if (Object.keys(chat.scriptstate).length === 0) {
            delete chat.scriptstate
          }
          writeSingleChatRow(innerDb, chatId, chat)
          return {
            event: {
              ...COMMAND_EVENT_CATALOG.chatScriptstateUpdated,
              id: chatId,
              parentId: character.chaId,
            },
            extra: { chatId },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.post('/api/v1/commands/chats/:chatId/messages', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const chatId = readChatId((req.params as { chatId?: unknown }).chatId)
      const body = (req.body ?? {}) as MessageCommandBody
      const baseRevision = readBaseRevision(body)
      const message = createMessageRecord(body.message)
      const result = applyTargetedCommandMutation<{ chatId: string; messageId: string }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: 'targeted-message',
        // Chat is located for validation only; writes go to the message store.
        chatScopedRead: { chatId },
        mutate(database, targetDb) {
          const characters = normalizeAllCharacterChats(database)
          requireChatLocation(characters, chatId)
          if (activeMessageIdExists(targetDb, message.chatId)) {
            throw new ValidationError(`Duplicate message id: ${message.chatId}`)
          }
          appendChatMessage(targetDb, chatId, message)
          return {
            event: {
              ...COMMAND_EVENT_CATALOG.messageAppended,
              id: message.chatId,
              parentId: chatId,
            },
            extra: { chatId, messageId: message.chatId },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.patch('/api/v1/commands/messages/:messageId', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const messageId = readMessageId((req.params as { messageId?: unknown }).messageId)
      const body = (req.body ?? {}) as MessageCommandBody
      const baseRevision = readBaseRevision(body)
      const patch = readMessagePatch(body.patch)
      const result = applyTargetedCommandMutation<{ chatId: string; messageId: string }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: 'targeted-message',
        // The loader resolves the parent chat from the message id;
        // a missing message falls back broad and the callback throws as before.
        chatScopedRead: { messageId },
        mutate(database, targetDb) {
          const characters = normalizeAllCharacterChats(database)
          const resolved = resolveActiveMessageLocationById(targetDb, messageId)
          if (resolved.ok === false) {
            if (resolved.reason === 'ambiguous') {
              throw new ValidationError(`Ambiguous message id: ${messageId}`)
            }
            throw new EntityNotFoundError(`Message not found: ${messageId}`)
          }
          const { location } = resolved
          requireChatLocation(characters, location.chatId)
          const updated = updateActiveMessageById(targetDb, messageId, patch)
          if (updated.ok === false) {
            if (updated.reason === 'ambiguous') {
              throw new ValidationError(`Ambiguous message id: ${messageId}`)
            }
            throw new EntityNotFoundError(`Message not found: ${messageId}`)
          }
          return {
            event: {
              ...COMMAND_EVENT_CATALOG.messageUpdated,
              id: messageId,
              parentId: updated.chatId,
            },
            extra: { chatId: updated.chatId, messageId },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.post('/api/v1/commands/messages/:messageId/translate', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    // Translation is a server-side command mutation and should finish even if
    // the browser tab that started it disconnects before the provider returns.
    const { signal, cleanup } = createDetachedAbort()
    let clearActiveTranslation: (() => void) | undefined
    try {
      const messageId = readMessageId((req.params as { messageId?: unknown }).messageId)
      const body = (req.body ?? {}) as MessageCommandBody
      // Keep validating the command envelope, but translation uses the message
      // text itself as its concurrency precondition. Holding the global
      // revision across a provider request would block or conflict with every
      // unrelated edit made while translation is running.
      readBaseRevision(body)
      const source = readLiveMessageSource(db, messageId)
      clearActiveTranslation = messageTranslationJobs?.register({ chatId: source.chatId, messageId })
      const settings = loadSettingsFromSqlite(db)
      if (settings === null) {
        throw new ValidationError('database is not initialized')
      }

      const persisted = loadPersistedForChatMutation(db, dataDir, { messageId })
      const characters = normalizeAllCharacterChats(persisted.database)
      const { character } = requireChatLocation(characters, source.chatId)
      const translation = await translateRawMessageData({
        settings,
        character,
        text: source.data,
        signal,
      })

      const result = applyTargetedCommandMutation<{
        chatId: string
        messageId: string
        translation: RawMessageTranslation
      }>({
        db,
        dataDir,
        // No await occurs between this read and the synchronous transaction.
        // Rebase onto the current domain revision, then reject only if the
        // target message disappeared or its source text changed below.
        baseRevision: getSchemaState(db).revision,
        ...commandMutationContext(req, eventSink),
        mutationPath: 'targeted-message',
        chatScopedRead: { messageId },
        mutate(database, targetDb) {
          const characters = normalizeAllCharacterChats(database)
          const resolved = resolveActiveMessageLocationById(targetDb, messageId)
          if (resolved.ok === false) {
            if (resolved.reason === 'ambiguous') {
              throw new ValidationError(`Ambiguous message id: ${messageId}`)
            }
            throw new EntityNotFoundError(`Message not found: ${messageId}`)
          }
          const { location } = resolved
          requireChatLocation(characters, location.chatId)
          if (location.message.data !== source.data) {
            throw new ValidationError(`Message changed before translation could be saved: ${messageId}`)
          }
          const updated = updateActiveMessageById(targetDb, messageId, { translation })
          if (updated.ok === false) {
            if (updated.reason === 'ambiguous') {
              throw new ValidationError(`Ambiguous message id: ${messageId}`)
            }
            throw new EntityNotFoundError(`Message not found: ${messageId}`)
          }
          return {
            event: {
              ...COMMAND_EVENT_CATALOG.messageUpdated,
              id: messageId,
              parentId: updated.chatId,
            },
            extra: { chatId: updated.chatId, messageId, translation },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      if (
        err instanceof RevisionMismatchError ||
        err instanceof ValidationError ||
        err instanceof EntityNotFoundError
      ) {
        return sendCommandError(reply, err)
      }
      const message = err instanceof Error && err.message.length > 0 ? err.message : String(err)
      return sendCommandError(reply, new ValidationError(message || 'Message translation failed'))
    } finally {
      clearActiveTranslation?.()
      cleanup()
    }
  })

  app.delete('/api/v1/commands/messages/:messageId', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const messageId = readMessageId((req.params as { messageId?: unknown }).messageId)
      const body = (req.body ?? {}) as MessageCommandBody
      const baseRevision = readBaseRevision(body)
      const result = applyTargetedCommandMutation<{ chatId: string; messageId: string }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: 'targeted-message',
        // Same message-id-resolved scoped read as the PATCH route.
        chatScopedRead: { messageId },
        mutate(database, targetDb) {
          const characters = normalizeAllCharacterChats(database)
          const resolved = resolveActiveMessageLocationById(targetDb, messageId)
          if (resolved.ok === false) {
            if (resolved.reason === 'ambiguous') {
              throw new ValidationError(`Ambiguous message id: ${messageId}`)
            }
            throw new EntityNotFoundError(`Message not found: ${messageId}`)
          }
          const { location } = resolved
          requireChatLocation(characters, location.chatId)
          const deleted = deleteActiveMessageById(targetDb, messageId)
          if (deleted.ok === false) {
            if (deleted.reason === 'ambiguous') {
              throw new ValidationError(`Ambiguous message id: ${messageId}`)
            }
            throw new EntityNotFoundError(`Message not found: ${messageId}`)
          }
          return {
            event: {
              ...COMMAND_EVENT_CATALOG.messageDeleted,
              id: messageId,
              parentId: deleted.chatId,
            },
            extra: { chatId: deleted.chatId, messageId },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.post('/api/v1/commands/chats/:chatId/messages/truncate', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const chatId = readChatId((req.params as { chatId?: unknown }).chatId)
      const body = (req.body ?? {}) as MessageCommandBody
      const baseRevision = readBaseRevision(body)
      const afterMessageId = readTruncateAfterMessageId(body.afterMessageId)
      const preserveRemovedAsAlternates = readOptionalBooleanFlag(
        body.preserveRemovedAsAlternates,
        'preserveRemovedAsAlternates',
      )
      const result = applyTargetedCommandMutation<{
        chatId: string
        afterMessageId: string | null
        removedCount: number
      }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: 'targeted-message',
        // Chat is located for validation only; truncate hits the message store.
        chatScopedRead: { chatId },
        mutate(database, targetDb) {
          const characters = normalizeAllCharacterChats(database)
          requireChatLocation(characters, chatId)
          const removedAlternates: unknown[] = []
          if (preserveRemovedAsAlternates) {
            const base = getChatMessages(targetDb, chatId)
            const keepCount =
              afterMessageId === null ? 0 : base.findIndex((message) => message.chatId === afterMessageId) + 1
            if (afterMessageId !== null && keepCount === 0) {
              throw new EntityNotFoundError(`Message not found for chat ${chatId}: ${afterMessageId}`)
            }
            removedAlternates.push(...base.slice(keepCount).filter((message) => message.role === 'char'))
          }
          const truncated = truncateActiveChatMessages(targetDb, chatId, afterMessageId)
          if (truncated.ok === false) {
            throw new EntityNotFoundError(`Message not found for chat ${chatId}: ${truncated.afterMessageId}`)
          }
          for (const message of removedAlternates) {
            addAlternateMessage(targetDb, chatId, message)
          }
          return {
            event: { ...COMMAND_EVENT_CATALOG.messageTruncated, parentId: chatId },
            extra: { chatId, afterMessageId, removedCount: truncated.removedCount },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.post('/api/v1/commands/chats/:chatId/messages/tail', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const chatId = readChatId((req.params as { chatId?: unknown }).chatId)
      const body = (req.body ?? {}) as MessageCommandBody
      const baseRevision = readBaseRevision(body)
      const afterMessageId = readTruncateAfterMessageId(body.afterMessageId)
      const replacement = readReplacementMessages(body.messages)
      const result = applyTargetedCommandMutation<{
        chatId: string
        afterMessageId: string | null
        messageIds: string[]
        replacedCount: number
      }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: 'targeted-message',
        // Chat is located for validation only; replacement hits the message store.
        chatScopedRead: { chatId },
        mutate(database, targetDb) {
          const characters = normalizeAllCharacterChats(database)
          requireChatLocation(characters, chatId)
          const base = getChatMessages(targetDb, chatId)
          const keepCount =
            afterMessageId === null ? 0 : base.findIndex((message) => message.chatId === afterMessageId) + 1
          if (afterMessageId !== null && keepCount === 0) {
            throw new EntityNotFoundError(`Message not found for chat ${chatId}: ${afterMessageId}`)
          }
          const next = [...base.slice(0, keepCount), ...replacement]
          validateUniqueMessageIds(next as MessageRecord[])
          for (const message of replacement) {
            if (activeMessageIdExistsOutsideChat(targetDb, message.chatId, chatId)) {
              throw new ValidationError(`Duplicate message id: ${message.chatId}`)
            }
          }
          replaceActiveChatMessages(targetDb, chatId, next)
          return {
            event: { ...COMMAND_EVENT_CATALOG.messagesReplaced, parentId: chatId },
            extra: {
              chatId,
              afterMessageId,
              messageIds: replacement.map((message) => message.chatId),
              replacedCount: base.length - keepCount,
            },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.put('/api/v1/commands/chats/:chatId/messages', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const chatId = readChatId((req.params as { chatId?: unknown }).chatId)
      const body = (req.body ?? {}) as MessageCommandBody
      const baseRevision = readBaseRevision(body)
      const replacement = readReplacementMessages(body.messages)
      const result = applyTargetedCommandMutation<{ chatId: string }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: 'targeted-message',
        // Chat is located for validation only; replacement hits the message store.
        chatScopedRead: { chatId },
        mutate(database, targetDb) {
          const characters = normalizeAllCharacterChats(database)
          requireChatLocation(characters, chatId)
          validateUniqueMessageIds(replacement)
          for (const message of replacement) {
            if (activeMessageIdExistsOutsideChat(targetDb, message.chatId, chatId)) {
              throw new ValidationError(`Duplicate message id: ${message.chatId}`)
            }
          }
          replaceActiveChatMessages(targetDb, chatId, replacement)
          return {
            event: { ...COMMAND_EVENT_CATALOG.messagesReplaced, parentId: chatId },
            extra: { chatId },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.post('/api/v1/commands/chats/:chatId/generation-result', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const chatId = readChatId((req.params as { chatId?: unknown }).chatId)
      const body = (req.body ?? {}) as MessageCommandBody
      const baseRevision = readBaseRevision(body)
      const generationResult = readGenerationResult(body.generationResult)
      const result = applyTargetedCommandMutation<{ chatId: string; messageId: string }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: 'targeted-generation',
        // Chat is located for validation only; persistence hits the message store.
        chatScopedRead: { chatId },
        mutate(database, targetDb) {
          const characters = normalizeAllCharacterChats(database)
          requireChatLocation(characters, chatId)
          const write = writeGenerationChatMessage(
            targetDb,
            chatId,
            generationResult.message,
            generationResult.targetMessageId,
          )
          if (write.ok === false) {
            switch (write.reason) {
              case 'missing-target':
                throw new EntityNotFoundError(`Message not found for chat ${chatId}: ${write.targetMessageId}`)
              case 'duplicate':
                throw new ValidationError(`Duplicate message id: ${write.messageId}`)
            }
          }
          if (generationResult.targetMessageId) {
            if (write.displaced) addAlternateMessage(targetDb, chatId, write.displaced)
            addAlternateMessage(targetDb, chatId, generationResult.message)
          } else {
            clearAlternateMessages(targetDb, chatId)
          }
          return {
            event: {
              ...COMMAND_EVENT_CATALOG.generationPersisted,
              id: write.messageId,
              parentId: chatId,
            },
            extra: { chatId, messageId: write.messageId },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.post('/api/v1/commands/lorebooks', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const body = (req.body ?? {}) as { baseRevision?: unknown; lorebook?: unknown }
      const baseRevision = readBaseRevision(body)
      // Validate-only constructor rejects missing entry ids rather than minting them.
      const lorebook = validateGlobalLorebookCreate(body.lorebook)
      const result = applyTargetedCommandMutation<{ lorebookId: string }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.collection,
        collectionScopedRead: COLLECTION_SCOPED_READS.lorebooks,
        mutate(database, innerDb) {
          const { target, lorebooks } = readGlobalLorebookCommandTarget(database)
          const beforeLoreBookPage = target.loreBookPage
          if (lorebooks.some((candidate) => candidate.id === lorebook.id)) {
            throw new ValidationError(`Duplicate lorebook id: ${lorebook.id}`)
          }
          lorebooks.push(lorebook)
          // The global lorebook collection rewrite is faithful; child lorebook
          // repair remains a broad import/restore concern.
          writeLorebookTableMutation(innerDb, target, lorebooks, beforeLoreBookPage)
          return {
            event: { ...COMMAND_EVENT_CATALOG.lorebookCreated, id: lorebook.id },
            extra: { lorebookId: lorebook.id },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.patch('/api/v1/commands/lorebooks/:lorebookId', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const lorebookId = readLorebookId((req.params as { lorebookId?: unknown }).lorebookId)
      const body = (req.body ?? {}) as { baseRevision?: unknown; patch?: unknown }
      const baseRevision = readBaseRevision(body)
      const patch = readGlobalLorebookPatch(body.patch)
      const result = applyTargetedCommandMutation<{ lorebookId: string }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.collection,
        collectionScopedRead: COLLECTION_SCOPED_READS.lorebooks,
        mutate(database, innerDb) {
          const { lorebooks } = readGlobalLorebookCommandTarget(database)
          const index = requireGlobalLorebookIndex(lorebooks, lorebookId)
          Object.assign(lorebooks[index], patch)
          // The clean case: one lorebook's metadata, no pointer move, no child
          // repair persisted — a single-row UPDATE.
          writeSingleCollectionRow(innerDb, 'loreBook', index, lorebooks[index])
          return {
            event: { ...COMMAND_EVENT_CATALOG.lorebookUpdated, id: lorebookId },
            extra: { lorebookId },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.delete('/api/v1/commands/lorebooks/:lorebookId', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const lorebookId = readLorebookId((req.params as { lorebookId?: unknown }).lorebookId)
      const body = (req.body ?? {}) as { baseRevision?: unknown }
      const baseRevision = readBaseRevision(body)
      const result = applyTargetedCommandMutation<{ lorebookId: string }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.collection,
        collectionScopedRead: COLLECTION_SCOPED_READS.lorebooks,
        mutate(database, innerDb) {
          const { target, lorebooks } = readGlobalLorebookCommandTarget(database)
          const beforeLoreBookPage = target.loreBookPage
          const index = requireGlobalLorebookIndex(lorebooks, lorebookId)
          if (lorebooks.length === 1) {
            throw new ValidationError('Cannot delete the last lorebook')
          }
          lorebooks.splice(index, 1)
          target.loreBookPage = 0
          writeLorebookTableMutation(innerDb, target, lorebooks, beforeLoreBookPage)
          return {
            event: { ...COMMAND_EVENT_CATALOG.lorebookDeleted, id: lorebookId },
            extra: { lorebookId },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.post('/api/v1/commands/lorebooks/reorder', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const body = (req.body ?? {}) as { baseRevision?: unknown; lorebookIds?: unknown }
      const baseRevision = readBaseRevision(body)
      const lorebookIds = readLorebookIdList(body.lorebookIds)
      const result = applyTargetedCommandMutation<{ selectedLorebookId: string | null }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.collection,
        collectionScopedRead: COLLECTION_SCOPED_READS.lorebooks,
        mutate(database, innerDb) {
          const { target, lorebooks } = readGlobalLorebookCommandTarget(database)
          const beforeLoreBookPage = target.loreBookPage
          validateFullLorebookOrder(lorebooks, lorebookIds)
          const byId = new Map(lorebooks.map((lorebook) => [lorebook.id, lorebook]))
          const reordered = lorebookIds.map((id) => byId.get(id))
          target.loreBook = reordered
          const currentPage = Number.isInteger(target.loreBookPage as number) ? (target.loreBookPage as number) : 0
          const selectedLorebookId = lorebooks[currentPage]?.id ?? null
          target.loreBookPage = Math.max(
            0,
            lorebookIds.findIndex((id) => id === selectedLorebookId),
          )
          writeLorebookTableMutation(innerDb, target, reordered, beforeLoreBookPage)
          return {
            event: { ...COMMAND_EVENT_CATALOG.lorebookReordered },
            extra: { selectedLorebookId },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.post('/api/v1/commands/lorebooks/:lorebookId/select', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const lorebookId = readLorebookId((req.params as { lorebookId?: unknown }).lorebookId)
      const body = (req.body ?? {}) as { baseRevision?: unknown }
      const baseRevision = readBaseRevision(body)
      const result = applyTargetedCommandMutation<{ selectedLorebookId: string }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.settings,
        collectionScopedRead: COLLECTION_SCOPED_READS.lorebooks,
        mutate(database, innerDb) {
          const { target, lorebooks } = readGlobalLorebookCommandTarget(database)
          const index = requireGlobalLorebookIndex(lorebooks, lorebookId)
          // `loreBookPage` is a settings scalar; child lorebook repair remains
          // a broad import/restore concern.
          target.loreBookPage = index
          writeSettingsOnly(innerDb, extractSettings(target))
          return {
            event: { ...COMMAND_EVENT_CATALOG.lorebookSelected, id: lorebookId },
            extra: { selectedLorebookId: lorebookId },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.put('/api/v1/commands/lorebooks/:lorebookId/entries', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const lorebookId = readLorebookId((req.params as { lorebookId?: unknown }).lorebookId)
      const body = (req.body ?? {}) as { baseRevision?: unknown; entries?: unknown }
      const baseRevision = readBaseRevision(body)
      const entries = validateLorebookEntries(body.entries)
      const result = applyTargetedCommandMutation<{ lorebookId: string }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.collection,
        collectionScopedRead: COLLECTION_SCOPED_READS.lorebooks,
        mutate(database, innerDb) {
          const { lorebooks } = readGlobalLorebookCommandTarget(database)
          const index = requireGlobalLorebookIndex(lorebooks, lorebookId)
          lorebooks[index].data = entries
          // Replacing one lorebook's entries: no pointer move, no child repair
          // persisted — a single-row UPDATE.
          writeSingleCollectionRow(innerDb, 'loreBook', index, lorebooks[index])
          return {
            event: { ...COMMAND_EVENT_CATALOG.lorebookEntriesReplaced, id: lorebookId },
            extra: { lorebookId },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.put('/api/v1/commands/lorebooks/:lorebookId/entries/:entryId', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const params = req.params as { lorebookId?: unknown; entryId?: unknown }
      const lorebookId = readLorebookId(params.lorebookId)
      const entryId = readLorebookId(params.entryId, 'entryId')
      const body = (req.body ?? {}) as { baseRevision?: unknown; entry?: unknown }
      const baseRevision = readBaseRevision(body)
      const entry = validateLorebookEntryForId(body.entry, entryId)
      const result = applyTargetedCommandMutation<{
        lorebookId: string
        entryId: string
        entryIndex: number
        created: boolean
      }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.collection,
        collectionScopedRead: COLLECTION_SCOPED_READS.lorebooks,
        mutate(database, innerDb) {
          const { lorebooks } = readGlobalLorebookCommandTarget(database)
          const index = requireGlobalLorebookIndex(lorebooks, lorebookId)
          const upserted = upsertLorebookEntryById(lorebooks[index].data, entryId, entry)
          writeSingleCollectionRow(innerDb, 'loreBook', index, lorebooks[index])
          return {
            event: { ...COMMAND_EVENT_CATALOG.lorebookEntriesReplaced, id: lorebookId },
            extra: { lorebookId, entryId, entryIndex: upserted.index, created: upserted.created },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.delete('/api/v1/commands/lorebooks/:lorebookId/entries/:entryId', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const params = req.params as { lorebookId?: unknown; entryId?: unknown }
      const lorebookId = readLorebookId(params.lorebookId)
      const entryId = readLorebookId(params.entryId, 'entryId')
      const body = (req.body ?? {}) as { baseRevision?: unknown }
      const baseRevision = readBaseRevision(body)
      const result = applyTargetedCommandMutation<{
        lorebookId: string
        entryId: string
        entryIndex: number
      }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.collection,
        collectionScopedRead: COLLECTION_SCOPED_READS.lorebooks,
        mutate(database, innerDb) {
          const { lorebooks } = readGlobalLorebookCommandTarget(database)
          const index = requireGlobalLorebookIndex(lorebooks, lorebookId)
          const deleted = deleteLorebookEntryById(lorebooks[index].data, entryId)
          writeSingleCollectionRow(innerDb, 'loreBook', index, lorebooks[index])
          return {
            event: { ...COMMAND_EVENT_CATALOG.lorebookEntriesReplaced, id: lorebookId },
            extra: { lorebookId, entryId, entryIndex: deleted.index },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.post('/api/v1/commands/lorebooks/:lorebookId/entries/reorder', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const lorebookId = readLorebookId((req.params as { lorebookId?: unknown }).lorebookId)
      const body = (req.body ?? {}) as { baseRevision?: unknown; entryIds?: unknown }
      const baseRevision = readBaseRevision(body)
      const entryIds = readLorebookIdList(body.entryIds, 'entryIds')
      const result = applyTargetedCommandMutation<{ lorebookId: string }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.collection,
        collectionScopedRead: COLLECTION_SCOPED_READS.lorebooks,
        mutate(database, innerDb) {
          const { lorebooks } = readGlobalLorebookCommandTarget(database)
          const index = requireGlobalLorebookIndex(lorebooks, lorebookId)
          reorderLorebookEntriesById(lorebooks[index].data, entryIds)
          writeSingleCollectionRow(innerDb, 'loreBook', index, lorebooks[index])
          return {
            event: { ...COMMAND_EVENT_CATALOG.lorebookEntriesReplaced, id: lorebookId },
            extra: { lorebookId },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.put('/api/v1/commands/characters/:characterId/lorebooks', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const characterId = readLorebookCharacterId((req.params as { characterId?: unknown }).characterId)
      const body = (req.body ?? {}) as { baseRevision?: unknown; entries?: unknown }
      const baseRevision = readBaseRevision(body)
      const entries = validateLorebookEntries(body.entries)
      const result = applyTargetedCommandMutation<{ characterId: string }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.characterRow,
        characterScopedRead: { characterId, exactCharacterRow: true },
        mutate(database, innerDb) {
          const { character } = normalizeSelectedCharacterLorebooks(database, characterId)
          // Repair and replace only the owned lorebook field; sibling character
          // fields are loaded and written without normalization.
          character.globalLore = entries
          writeSingleCharacterRow(innerDb, characterId, character)
          return {
            // `globalLore` lives in one character row; a foreign refresh ships
            // only that character via the per-character `characterLorebook`
            // resource (not the broad global `lorebook` re-ship).
            event: {
              ...COMMAND_EVENT_CATALOG.lorebookEntriesReplaced,
              id: characterId,
              resource: 'characterLorebook',
            },
            extra: { characterId },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.put('/api/v1/commands/characters/:characterId/lorebooks/entries/:entryId', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const params = req.params as { characterId?: unknown; entryId?: unknown }
      const characterId = readLorebookCharacterId(params.characterId)
      const entryId = readLorebookId(params.entryId, 'entryId')
      const body = (req.body ?? {}) as { baseRevision?: unknown; entry?: unknown }
      const baseRevision = readBaseRevision(body)
      const entry = validateLorebookEntryForId(body.entry, entryId)
      const result = applyTargetedCommandMutation<{
        characterId: string
        entryId: string
        entryIndex: number
        created: boolean
      }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.characterRow,
        characterScopedRead: { characterId, exactCharacterRow: true },
        mutate(database, innerDb) {
          const { character, entries } = normalizeSelectedCharacterLorebooks(database, characterId)
          const upserted = upsertLorebookEntryById(entries, entryId, entry)
          writeSingleCharacterRow(innerDb, characterId, character)
          return {
            event: {
              ...COMMAND_EVENT_CATALOG.lorebookEntriesReplaced,
              id: characterId,
              resource: 'characterLorebook',
            },
            extra: { characterId, entryId, entryIndex: upserted.index, created: upserted.created },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.delete('/api/v1/commands/characters/:characterId/lorebooks/entries/:entryId', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const params = req.params as { characterId?: unknown; entryId?: unknown }
      const characterId = readLorebookCharacterId(params.characterId)
      const entryId = readLorebookId(params.entryId, 'entryId')
      const body = (req.body ?? {}) as { baseRevision?: unknown }
      const baseRevision = readBaseRevision(body)
      const result = applyTargetedCommandMutation<{
        characterId: string
        entryId: string
        entryIndex: number
      }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.characterRow,
        characterScopedRead: { characterId, exactCharacterRow: true },
        mutate(database, innerDb) {
          const { character, entries } = normalizeSelectedCharacterLorebooks(database, characterId)
          const deleted = deleteLorebookEntryById(entries, entryId)
          writeSingleCharacterRow(innerDb, characterId, character)
          return {
            event: {
              ...COMMAND_EVENT_CATALOG.lorebookEntriesReplaced,
              id: characterId,
              resource: 'characterLorebook',
            },
            extra: { characterId, entryId, entryIndex: deleted.index },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.post('/api/v1/commands/characters/:characterId/lorebooks/entries/reorder', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const characterId = readLorebookCharacterId((req.params as { characterId?: unknown }).characterId)
      const body = (req.body ?? {}) as { baseRevision?: unknown; entryIds?: unknown }
      const baseRevision = readBaseRevision(body)
      const entryIds = readLorebookIdList(body.entryIds, 'entryIds')
      const result = applyTargetedCommandMutation<{ characterId: string }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.characterRow,
        characterScopedRead: { characterId, exactCharacterRow: true },
        mutate(database, innerDb) {
          const { character, entries } = normalizeSelectedCharacterLorebooks(database, characterId)
          reorderLorebookEntriesById(entries, entryIds)
          writeSingleCharacterRow(innerDb, characterId, character)
          return {
            event: {
              ...COMMAND_EVENT_CATALOG.lorebookEntriesReplaced,
              id: characterId,
              resource: 'characterLorebook',
            },
            extra: { characterId },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.put('/api/v1/commands/chats/:chatId/lorebooks', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const chatId = readLorebookChatId((req.params as { chatId?: unknown }).chatId)
      const body = (req.body ?? {}) as { baseRevision?: unknown; entries?: unknown }
      const baseRevision = readBaseRevision(body)
      const entries = validateLorebookEntries(body.entries)
      const result = applyTargetedCommandMutation<{ chatId: string }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.chatRow,
        chatScopedRead: { chatId, exactChatRow: true },
        mutate(database, innerDb) {
          const { chat, parentId } = normalizeSelectedChatLorebooks(database, chatId)
          // Repair and replace only the owned lorebook field; sibling chat
          // fields are loaded and written without normalization.
          chat.localLore = entries
          writeSingleChatRowExact(innerDb, chatId, chat)
          return {
            // `localLore` lives in one chat row, so refresh only its parent
            // character instead of the broad global lorebook projection.
            event: {
              ...COMMAND_EVENT_CATALOG.lorebookEntriesReplaced,
              id: chatId,
              parentId,
              resource: 'characterRow',
            },
            extra: { chatId },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.put('/api/v1/commands/chats/:chatId/lorebooks/entries/:entryId', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const params = req.params as { chatId?: unknown; entryId?: unknown }
      const chatId = readLorebookChatId(params.chatId)
      const entryId = readLorebookId(params.entryId, 'entryId')
      const body = (req.body ?? {}) as { baseRevision?: unknown; entry?: unknown }
      const baseRevision = readBaseRevision(body)
      const entry = validateLorebookEntryForId(body.entry, entryId)
      const result = applyTargetedCommandMutation<{
        chatId: string
        entryId: string
        entryIndex: number
        created: boolean
      }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.chatRow,
        chatScopedRead: { chatId, exactChatRow: true },
        mutate(database, innerDb) {
          const { chat, parentId } = normalizeSelectedChatLorebooks(database, chatId)
          const upserted = upsertLorebookEntryById(chat.localLore, entryId, entry)
          writeSingleChatRowExact(innerDb, chatId, chat)
          return {
            event: {
              ...COMMAND_EVENT_CATALOG.lorebookEntriesReplaced,
              id: chatId,
              parentId,
              resource: 'characterRow',
            },
            extra: { chatId, entryId, entryIndex: upserted.index, created: upserted.created },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.delete('/api/v1/commands/chats/:chatId/lorebooks/entries/:entryId', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const params = req.params as { chatId?: unknown; entryId?: unknown }
      const chatId = readLorebookChatId(params.chatId)
      const entryId = readLorebookId(params.entryId, 'entryId')
      const body = (req.body ?? {}) as { baseRevision?: unknown }
      const baseRevision = readBaseRevision(body)
      const result = applyTargetedCommandMutation<{
        chatId: string
        entryId: string
        entryIndex: number
      }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.chatRow,
        chatScopedRead: { chatId, exactChatRow: true },
        mutate(database, innerDb) {
          const { chat, parentId } = normalizeSelectedChatLorebooks(database, chatId)
          const deleted = deleteLorebookEntryById(chat.localLore, entryId)
          writeSingleChatRowExact(innerDb, chatId, chat)
          return {
            event: {
              ...COMMAND_EVENT_CATALOG.lorebookEntriesReplaced,
              id: chatId,
              parentId,
              resource: 'characterRow',
            },
            extra: { chatId, entryId, entryIndex: deleted.index },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.post('/api/v1/commands/chats/:chatId/lorebooks/entries/reorder', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const chatId = readLorebookChatId((req.params as { chatId?: unknown }).chatId)
      const body = (req.body ?? {}) as { baseRevision?: unknown; entryIds?: unknown }
      const baseRevision = readBaseRevision(body)
      const entryIds = readLorebookIdList(body.entryIds, 'entryIds')
      const result = applyTargetedCommandMutation<{ chatId: string }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.chatRow,
        chatScopedRead: { chatId, exactChatRow: true },
        mutate(database, innerDb) {
          const { chat, parentId } = normalizeSelectedChatLorebooks(database, chatId)
          reorderLorebookEntriesById(chat.localLore, entryIds)
          writeSingleChatRowExact(innerDb, chatId, chat)
          return {
            event: {
              ...COMMAND_EVENT_CATALOG.lorebookEntriesReplaced,
              id: chatId,
              parentId,
              resource: 'characterRow',
            },
            extra: { chatId },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.post('/api/v1/commands/modules', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const body = (req.body ?? {}) as ModuleCommandBody
      const baseRevision = readBaseRevision(body)
      const module = createModuleRecord(body.module, 'module', {}, { assetDb: db })
      const result = applyTargetedCommandMutation<{ moduleId: string }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.collection,
        mutate(database, innerDb) {
          const target = ensureModuleCommandDatabase(database)
          const modules = ensureModuleRecords(target)
          if (modules.some((candidate) => candidate.id === module.id)) {
            throw new ValidationError(`Module already exists: ${module.id}`)
          }
          modules.push(module)
          writeSingleCollectionTable(innerDb, 'modules', modules)
          return {
            event: { ...COMMAND_EVENT_CATALOG.moduleCreated, id: module.id },
            extra: { moduleId: module.id },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.patch('/api/v1/commands/modules/:moduleId', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const moduleId = readCommandModuleId((req.params as { moduleId?: unknown }).moduleId)
      const body = (req.body ?? {}) as ModuleCommandBody
      const baseRevision = readBaseRevision(body)
      const patch = readModulePatch(body.patch, { assetDb: db })
      const result = applyTargetedCommandMutation<{ moduleId: string }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.collection,
        mutate(database, innerDb) {
          const target = ensureModuleCommandDatabase(database)
          const modules = ensureModuleRecords(target)
          const index = requireModuleIndex(modules, moduleId)
          for (const [key, value] of Object.entries(patch)) {
            if (value === null) {
              delete modules[index][key]
            } else {
              modules[index][key] = value
            }
          }
          writeSingleCollectionRow(innerDb, 'modules', index, modules[index])
          return {
            event: { ...COMMAND_EVENT_CATALOG.moduleUpdated, id: moduleId },
            extra: { moduleId },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.delete('/api/v1/commands/modules/:moduleId', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const moduleId = readCommandModuleId((req.params as { moduleId?: unknown }).moduleId)
      const body = (req.body ?? {}) as ModuleCommandBody
      const baseRevision = readBaseRevision(body)
      const result = applyMessageFreeJsonCommandMutation<{ moduleId: string }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutate(database) {
          const target = ensureModuleCommandDatabase(database)
          const modules = ensureModuleRecords(target)
          const index = requireModuleIndex(modules, moduleId)
          modules.splice(index, 1)
          removeModuleReferences(target, moduleId)
          return {
            event: { ...COMMAND_EVENT_CATALOG.moduleDeleted, id: moduleId },
            extra: { moduleId },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.post('/api/v1/commands/modules/enable', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const body = (req.body ?? {}) as ModuleCommandBody
      const baseRevision = readBaseRevision(body)
      const moduleId = readCommandModuleId(body.moduleId)
      const enabled = readModuleEnabled(body.enabled)
      const result = applyTargetedCommandMutation<{ moduleId: string; enabled: boolean }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.settings,
        mutate(database, innerDb) {
          const target = ensureModuleCommandDatabase(database)
          requireModuleIndex(ensureModuleRecords(target), moduleId)
          const enabledModules = new Set(ensureEnabledModules(target))
          if (enabled) {
            enabledModules.add(moduleId)
          } else {
            enabledModules.delete(moduleId)
          }
          // `enabledModules` is a settings scalar; the event carries the narrow
          // `moduleEnabled` resource so a foreign refresh ships only it.
          target.enabledModules = Array.from(enabledModules)
          writeSettingsOnly(innerDb, extractSettings(target))
          return {
            event: { ...COMMAND_EVENT_CATALOG.moduleEnabled, id: moduleId },
            extra: { moduleId, enabled },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.post('/api/v1/commands/modules/reorder', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const body = (req.body ?? {}) as ModuleCommandBody
      const baseRevision = readBaseRevision(body)
      const moduleIds = readModuleIdList(body.moduleIds)
      const result = applyTargetedCommandMutation({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.collection,
        mutate(database, innerDb) {
          const target = ensureModuleCommandDatabase(database)
          const modules = ensureModuleRecords(target)
          validateFullModuleOrder(modules, moduleIds)
          const byId = new Map(modules.map((module) => [module.id, module]))
          const reordered = moduleIds.map((id) => byId.get(id))
          target.modules = reordered
          writeSingleCollectionTable(innerDb, 'modules', reordered)
          return {
            event: { ...COMMAND_EVENT_CATALOG.moduleReordered },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.post('/api/v1/commands/characters/:characterId/modules/reorder', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const characterId = readModuleCharacterId((req.params as { characterId?: unknown }).characterId)
      const body = (req.body ?? {}) as ModuleCommandBody
      const baseRevision = readBaseRevision(body)
      const moduleIds = readModuleIdList(body.moduleIds)
      const result = applyTargetedCommandMutation<{ characterId: string }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.characterRow,
        mutate(database, innerDb) {
          const target = ensureModuleCommandDatabase(database)
          const modules = ensureModuleRecords(target)
          const character = findCharacterForModuleCommand(target, characterId)
          validateCharacterModuleLinks(modules, moduleIds)
          // The only persistent change is `character.modules` (the character
          // row); the `ensureModuleRecords` collection repair is validate-only
          // so the `modules` table is not rewritten.
          character.modules = moduleIds
          writeSingleCharacterRow(innerDb, characterId, character)
          return {
            event: {
              ...COMMAND_EVENT_CATALOG.characterModulesReordered,
              id: characterId,
            },
            extra: { characterId },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.post('/api/v1/commands/plugins', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const body = (req.body ?? {}) as PluginCommandBody
      const baseRevision = readBaseRevision(body)
      const plugin = createPluginRecord(body.plugin)
      const result = applyTargetedCommandMutation<{ pluginId: string }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.collection,
        collectionScopedRead: COLLECTION_SCOPED_READS.plugins,
        mutate(database, innerDb) {
          const target = ensurePluginCommandDatabase(database)
          const plugins = ensurePluginRecords(target)
          if (plugins.some((candidate) => candidate.name === plugin.name)) {
            throw new ValidationError(`Plugin already exists: ${plugin.name}`)
          }
          plugins.push(plugin)
          writeSingleCollectionTable(innerDb, 'plugins', plugins)
          return {
            event: { ...COMMAND_EVENT_CATALOG.pluginCreated, id: plugin.name },
            extra: { pluginId: plugin.name },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.patch('/api/v1/commands/plugins/:pluginId', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const pluginId = readPluginId((req.params as { pluginId?: unknown }).pluginId)
      const body = (req.body ?? {}) as PluginCommandBody
      const baseRevision = readBaseRevision(body)
      const patch = readPluginPatch(body.patch)
      const result = applyTargetedCommandMutation<{ pluginId: string }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.collection,
        collectionScopedRead: COLLECTION_SCOPED_READS.plugins,
        mutate(database, innerDb) {
          const target = ensurePluginCommandDatabase(database)
          const plugins = ensurePluginRecords(target)
          const index = requirePluginIndex(plugins, pluginId)
          for (const [key, value] of Object.entries(patch)) {
            if (value === null) {
              delete plugins[index][key]
            } else {
              plugins[index][key] = value
            }
          }
          writeSingleCollectionRow(innerDb, 'plugins', index, plugins[index])
          return {
            event: { ...COMMAND_EVENT_CATALOG.pluginUpdated, id: pluginId },
            extra: { pluginId },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.delete('/api/v1/commands/plugins/:pluginId', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const pluginId = readPluginId((req.params as { pluginId?: unknown }).pluginId)
      const body = (req.body ?? {}) as PluginCommandBody
      const baseRevision = readBaseRevision(body)
      const result = applyTargetedCommandMutation<{ pluginId: string }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.collection,
        collectionScopedRead: COLLECTION_SCOPED_READS.plugins,
        mutate(database, innerDb) {
          const target = ensurePluginCommandDatabase(database)
          const plugins = ensurePluginRecords(target)
          const index = requirePluginIndex(plugins, pluginId)
          plugins.splice(index, 1)
          // The deleted plugin shifts later positions, so rewrite the one table.
          writeSingleCollectionTable(innerDb, 'plugins', plugins)
          // `currentPluginProvider` is a settings scalar; co-write settings only
          // when deleting the active provider clears the pointer.
          const clearsProvider = target.currentPluginProvider === pluginId
          if (clearsProvider) {
            target.currentPluginProvider = ''
            writeSettingsOnly(innerDb, extractSettings(target))
          }
          return {
            event: {
              ...COMMAND_EVENT_CATALOG.pluginDeleted,
              // Clearing the active provider is the sole plugin-record command
              // that also changes settings. Keep authoritative reconciliation
              // for both affected slices without reading unrelated settings.
              ...(clearsProvider ? { resource: 'pluginCollectionWithProvider' } : {}),
              id: pluginId,
            },
            extra: { pluginId },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.post('/api/v1/commands/plugins/:pluginId/enable', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const pluginId = readPluginId((req.params as { pluginId?: unknown }).pluginId)
      const body = (req.body ?? {}) as PluginCommandBody
      const baseRevision = readBaseRevision(body)
      const enabled = readPluginEnabled(body.enabled)
      const result = applyTargetedCommandMutation<{ pluginId: string; enabled: boolean }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.collection,
        collectionScopedRead: COLLECTION_SCOPED_READS.plugins,
        mutate(database, innerDb) {
          const target = ensurePluginCommandDatabase(database)
          const plugins = ensurePluginRecords(target)
          const index = requirePluginIndex(plugins, pluginId)
          plugins[index].enabled = enabled
          writeSingleCollectionRow(innerDb, 'plugins', index, plugins[index])
          return {
            event: { ...COMMAND_EVENT_CATALOG.pluginEnabled, id: pluginId },
            extra: { pluginId, enabled },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.post('/api/v1/commands/plugins/provider', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const body = (req.body ?? {}) as PluginCommandBody
      const baseRevision = readBaseRevision(body)
      const provider = readPluginProvider(body.provider)
      const result = applyTargetedCommandMutation<{ provider: string }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.settings,
        settingsScopedRead: true,
        mutate(database, innerDb) {
          const target = ensurePluginCommandDatabase(database)
          target.currentPluginProvider = provider
          writeSettingsOnly(innerDb, extractSettings(target))
          return {
            event: { ...COMMAND_EVENT_CATALOG.pluginProviderSelected, id: provider },
            extra: { provider },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.post('/api/v1/commands/plugins/reorder', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const body = (req.body ?? {}) as PluginCommandBody
      const baseRevision = readBaseRevision(body)
      const pluginIds = readPluginIdList(body.pluginIds)
      const result = applyTargetedCommandMutation({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.collection,
        collectionScopedRead: COLLECTION_SCOPED_READS.plugins,
        mutate(database, innerDb) {
          const target = ensurePluginCommandDatabase(database)
          const plugins = ensurePluginRecords(target)
          validateFullPluginOrder(plugins, pluginIds)
          const byId = new Map(plugins.map((plugin) => [plugin.name, plugin]))
          const reordered = pluginIds.map((id) => byId.get(id))
          target.plugins = reordered
          writeSingleCollectionTable(innerDb, 'plugins', reordered)
          return {
            event: { ...COMMAND_EVENT_CATALOG.pluginReordered },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.put('/api/v1/commands/plugin-storage/:key', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const key = readPluginStorageKey((req.params as { key?: unknown }).key)
      const body = (req.body ?? {}) as PluginStorageCommandBody
      const baseRevision = readBaseRevision(body)
      const value = readPluginStorageValue(body.value)
      const result = applyTargetedCommandMutation<{ key: string }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.pluginStorage,
        skipDatabaseLoad: true,
        mutate(_database, innerDb) {
          writePluginStorageKey(innerDb, key, value)
          return {
            event: { ...COMMAND_EVENT_CATALOG.pluginStorageUpdated, id: key },
            extra: { key },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.delete('/api/v1/commands/plugin-storage/:key', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const key = readPluginStorageKey((req.params as { key?: unknown }).key)
      const body = (req.body ?? {}) as PluginStorageCommandBody
      const baseRevision = readBaseRevision(body)
      const result = applyTargetedCommandMutation<{ key: string }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.pluginStorage,
        skipDatabaseLoad: true,
        mutate(_database, innerDb) {
          deletePluginStorageKey(innerDb, key)
          return {
            event: { ...COMMAND_EVENT_CATALOG.pluginStorageDeleted, id: key },
            extra: { key },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.post('/api/v1/commands/plugin-storage/bulk', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const body = (req.body ?? {}) as PluginStorageCommandBody
      const baseRevision = readBaseRevision(body)
      const patch = readPluginStorageBulkPatch(body)
      const result = applyTargetedCommandMutation({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.pluginStorage,
        mutate(database, innerDb) {
          const target = ensurePluginStorageDatabase(database)
          const storage = patch.clear ? {} : { ...ensurePluginCustomStorage(target) }
          for (const key of patch.deleteKeys) {
            delete storage[key]
          }
          for (const [key, value] of Object.entries(patch.values)) {
            storage[key] = value
          }
          replacePluginStorage(innerDb, storage)
          return {
            event: { ...COMMAND_EVENT_CATALOG.pluginStorageBulkUpdated },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.put('/api/v1/commands/modules/:moduleId/lorebooks', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const moduleId = readModuleId((req.params as { moduleId?: unknown }).moduleId)
      const body = (req.body ?? {}) as { baseRevision?: unknown; entries?: unknown }
      const baseRevision = readBaseRevision(body)
      const entries = validateLorebookEntries(body.entries)
      const result = applyTargetedCommandMutation<{ moduleId: string }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.collection,
        mutate(database, innerDb) {
          const { modules } = readModuleCollectionCommandTarget(database)
          const module = requireModule(modules, moduleId)
          module.lorebook = entries
          // One module's lorebook is a single-row edit; the in-memory child
          // lorebook repairs across characters/chats are dropped to validate-only.
          writeSingleCollectionRow(innerDb, 'modules', modules.indexOf(module), module)
          return {
            // Only the `modules` table is written, so a foreign refresh ships
            // just `modules` via the module-scoped resource (not the broad
            // global `lorebook` re-ship).
            event: {
              ...COMMAND_EVENT_CATALOG.lorebookEntriesReplaced,
              id: moduleId,
              resource: 'moduleUpdated',
            },
            extra: { moduleId },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.put('/api/v1/commands/modules/:moduleId/lorebooks/entries/:entryId', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const params = req.params as { moduleId?: unknown; entryId?: unknown }
      const moduleId = readModuleId(params.moduleId)
      const entryId = readLorebookId(params.entryId, 'entryId')
      const body = (req.body ?? {}) as { baseRevision?: unknown; entry?: unknown }
      const baseRevision = readBaseRevision(body)
      const entry = validateLorebookEntryForId(body.entry, entryId)
      const result = applyTargetedCommandMutation<{
        moduleId: string
        entryId: string
        entryIndex: number
        created: boolean
      }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.collection,
        mutate(database, innerDb) {
          const { modules } = readModuleCollectionCommandTarget(database)
          const module = requireModule(modules, moduleId)
          module.lorebook ??= []
          const upserted = upsertLorebookEntryById(module.lorebook, entryId, entry)
          writeSingleCollectionRow(innerDb, 'modules', modules.indexOf(module), module)
          return {
            event: {
              ...COMMAND_EVENT_CATALOG.lorebookEntriesReplaced,
              id: moduleId,
              resource: 'moduleUpdated',
            },
            extra: { moduleId, entryId, entryIndex: upserted.index, created: upserted.created },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.delete('/api/v1/commands/modules/:moduleId/lorebooks/entries/:entryId', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const params = req.params as { moduleId?: unknown; entryId?: unknown }
      const moduleId = readModuleId(params.moduleId)
      const entryId = readLorebookId(params.entryId, 'entryId')
      const body = (req.body ?? {}) as { baseRevision?: unknown }
      const baseRevision = readBaseRevision(body)
      const result = applyTargetedCommandMutation<{
        moduleId: string
        entryId: string
        entryIndex: number
      }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.collection,
        mutate(database, innerDb) {
          const { modules } = readModuleCollectionCommandTarget(database)
          const module = requireModule(modules, moduleId)
          module.lorebook ??= []
          const deleted = deleteLorebookEntryById(module.lorebook, entryId)
          writeSingleCollectionRow(innerDb, 'modules', modules.indexOf(module), module)
          return {
            event: {
              ...COMMAND_EVENT_CATALOG.lorebookEntriesReplaced,
              id: moduleId,
              resource: 'moduleUpdated',
            },
            extra: { moduleId, entryId, entryIndex: deleted.index },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.post('/api/v1/commands/modules/:moduleId/lorebooks/entries/reorder', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const moduleId = readModuleId((req.params as { moduleId?: unknown }).moduleId)
      const body = (req.body ?? {}) as { baseRevision?: unknown; entryIds?: unknown }
      const baseRevision = readBaseRevision(body)
      const entryIds = readLorebookIdList(body.entryIds, 'entryIds')
      const result = applyTargetedCommandMutation<{ moduleId: string }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.collection,
        mutate(database, innerDb) {
          const { modules } = readModuleCollectionCommandTarget(database)
          const module = requireModule(modules, moduleId)
          module.lorebook ??= []
          reorderLorebookEntriesById(module.lorebook, entryIds)
          writeSingleCollectionRow(innerDb, 'modules', modules.indexOf(module), module)
          return {
            event: {
              ...COMMAND_EVENT_CATALOG.lorebookEntriesReplaced,
              id: moduleId,
              resource: 'moduleUpdated',
            },
            extra: { moduleId },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.put('/api/v1/commands/characters/:characterId/scripts', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const characterId = readCharacterId((req.params as { characterId?: unknown }).characterId)
      const body = (req.body ?? {}) as ScriptDefinitionCommandBody
      const baseRevision = readBaseRevision(body)
      const scripts = readScriptDefinitions(body.scripts)
      const result = applyTargetedCommandMutation<{ characterId: string }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.characterRow,
        characterScopedRead: { characterId, exactCharacterRow: true },
        mutate(database, innerDb) {
          const target = readScriptDefinitionCommandTarget(database)
          const character = readCharacterScriptParent(target, characterId)
          character.customscript = scripts
          writeSingleCharacterRow(innerDb, characterId, character)
          return {
            event: { ...COMMAND_EVENT_CATALOG.scriptDefinitionsReplaced, id: characterId },
            extra: { characterId },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.put('/api/v1/commands/characters/:characterId/triggers', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const characterId = readCharacterId((req.params as { characterId?: unknown }).characterId)
      const body = (req.body ?? {}) as ScriptDefinitionCommandBody
      const baseRevision = readBaseRevision(body)
      const triggers = readTriggerDefinitions(body.triggers)
      const result = applyTargetedCommandMutation<{ characterId: string }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.characterRow,
        characterScopedRead: { characterId, exactCharacterRow: true },
        mutate(database, innerDb) {
          const target = readScriptDefinitionCommandTarget(database)
          const character = readCharacterScriptParent(target, characterId)
          character.triggerscript = triggers
          writeSingleCharacterRow(innerDb, characterId, character)
          return {
            event: { ...COMMAND_EVENT_CATALOG.triggerDefinitionsReplaced, id: characterId },
            extra: { characterId },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.put('/api/v1/commands/modules/:moduleId/scripts', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const moduleId = readModuleId((req.params as { moduleId?: unknown }).moduleId)
      const body = (req.body ?? {}) as ScriptDefinitionCommandBody
      const baseRevision = readBaseRevision(body)
      const scripts = readScriptDefinitions(body.scripts)
      const result = applyTargetedCommandMutation<{ moduleId: string }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.collection,
        collectionScopedRead: COLLECTION_SCOPED_READS.modules,
        mutate(database, innerDb) {
          const { modules } = readModuleCollectionCommandTarget(database)
          const module = requireModule(modules, moduleId)
          module.regex = scripts
          // Module script updates rewrite only the `modules` table; corpus-wide
          // character repairs are validate-only.
          writeSingleCollectionRow(innerDb, 'modules', modules.indexOf(module), module)
          return {
            // Only the `modules` table is rewritten, so emit a module-scoped
            // resource shipping `modules`.
            event: {
              ...COMMAND_EVENT_CATALOG.scriptDefinitionsReplaced,
              id: moduleId,
              resource: 'moduleScriptDefinition',
            },
            extra: { moduleId },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.put('/api/v1/commands/modules/:moduleId/triggers', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const moduleId = readModuleId((req.params as { moduleId?: unknown }).moduleId)
      const body = (req.body ?? {}) as ScriptDefinitionCommandBody
      const baseRevision = readBaseRevision(body)
      const triggers = readTriggerDefinitions(body.triggers)
      const result = applyTargetedCommandMutation<{ moduleId: string }>({
        db,
        dataDir,
        baseRevision,
        ...commandMutationContext(req, eventSink),
        mutationPath: TARGETED_MUTATION_PATHS.collection,
        collectionScopedRead: COLLECTION_SCOPED_READS.modules,
        mutate(database, innerDb) {
          const { modules } = readModuleCollectionCommandTarget(database)
          const module = requireModule(modules, moduleId)
          module.trigger = triggers
          // Module trigger updates rewrite only the `modules` table; corpus-wide
          // character repairs are validate-only.
          writeSingleCollectionRow(innerDb, 'modules', modules.indexOf(module), module)
          return {
            // Only the `modules` table is rewritten, so emit a module-scoped
            // resource shipping `modules`.
            event: {
              ...COMMAND_EVENT_CATALOG.triggerDefinitionsReplaced,
              id: moduleId,
              resource: 'moduleTriggerDefinition',
            },
            extra: { moduleId },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })
}

function readSettingsGroup(group: unknown): SettingsGroup {
  if (typeof group !== 'string' || !SETTINGS_GROUPS.includes(group as SettingsGroup)) {
    throw new ValidationError(`Unsupported settings group: ${String(group)}`)
  }
  return group as SettingsGroup
}

function readSettingsGroupPatch(group: SettingsGroup, patch: unknown): Record<string, unknown> {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new ValidationError('patch must be an object')
  }

  const entries = Object.entries(patch as Record<string, unknown>)
  if (entries.length === 0) {
    throw new ValidationError('patch must include at least one setting')
  }

  const sanitized: Record<string, unknown> = {}
  for (const [key, value] of entries) {
    if (!SETTINGS_GROUP_KEY_SETS[group].has(key)) {
      throw new ValidationError(`Unsupported ${group} setting: ${key}`)
    }
    validateSettingValue(key, value)
    sanitized[key] = sanitizeSettingValue(key, value)
  }

  return sanitized
}

function validateSettingValue(key: string, value: unknown): void {
  if (key === 'complexRegexCompatibilityMode' && value !== 'strict' && value !== 'worker') {
    throw new ValidationError('complexRegexCompatibilityMode must be strict or worker')
  }
  if (
    ['complexRegexInputTimeoutMs', 'complexRegexOutputTimeoutMs', 'complexRegexDisplayTimeoutMs'].includes(key) &&
    (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
  ) {
    throw new ValidationError(`${key} must be a non-negative finite number`)
  }
  const kind = settingValueKind(key)
  if (kind === 'json') {
    validateJsonValue(key, value)
    return
  }
  if (kind === 'boolean' && typeof value !== 'boolean') {
    throw new ValidationError(`${key} must be a boolean`)
  }
  if (kind === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) {
    throw new ValidationError(`${key} must be a finite number`)
  }
  if (kind === 'string' && typeof value !== 'string') {
    throw new ValidationError(`${key} must be a string`)
  }
  if (kind === 'stringOrNull' && value !== null && typeof value !== 'string') {
    throw new ValidationError(`${key} must be a string or null`)
  }
  if (kind === 'object' && (!value || typeof value !== 'object' || Array.isArray(value))) {
    throw new ValidationError(`${key} must be an object`)
  }
  if (kind === 'array' && !Array.isArray(value)) {
    throw new ValidationError(`${key} must be an array`)
  }
  if (kind === 'arrayOrNull' && value !== null && !Array.isArray(value)) {
    throw new ValidationError(`${key} must be an array or null`)
  }
  validateJsonValue(key, value)
}

function sanitizeSettingValue(key: string, value: unknown): unknown {
  if (key === 'modelProfiles') {
    return readSettingsModelProfiles(value)
  }
  if (key === 'modelRoleProfiles') {
    return readSettingsModelRoleProfiles(value)
  }
  if (key === 'modelRuntimeDefaults') {
    return readSettingsModelRuntimeDefaults(value)
  }
  if (key === 'customSidebarItems') {
    return readCustomSidebarItems(value)
  }
  if (key === 'chatGenerationTogglePresets') {
    return normalizeChatGenerationTogglePresets(value)
  }
  if (key === 'keepSessionAlive') {
    return readKeepSessionAlive(value)
  }
  return value
}

function readKeepSessionAlive(value: unknown): 'off' | 'sound' {
  if (value === 'pip') return 'sound'
  if (value === 'off' || value === 'sound') return value
  throw new ValidationError('keepSessionAlive must be off or sound')
}

function readSettingsModelProfiles(value: unknown): unknown {
  try {
    return readModelProfiles(value)
  } catch (error) {
    throwModelProfileValidationError(error)
  }
}

function readSettingsModelRoleProfiles(value: unknown): unknown {
  try {
    return readModelRoleProfiles(value)
  } catch (error) {
    throwModelProfileValidationError(error)
  }
}

function readSettingsModelRuntimeDefaults(value: unknown): unknown {
  try {
    return readModelRuntimeDefaults(value)
  } catch (error) {
    throwModelProfileValidationError(error)
  }
}

function throwModelProfileValidationError(error: unknown): never {
  if (error instanceof ModelProfileRecordValidationError) {
    throw new ValidationError(error.message)
  }
  throw error
}

const CUSTOM_SIDEBAR_ITEM_TYPES = new Set(['model', 'databaseKey', 'loadout', 'setting'])

function readCustomSidebarItems(value: unknown): Array<{
  id: string
  type: string
  subType: string
  label: string
}> {
  if (!Array.isArray(value)) {
    throw new ValidationError('customSidebarItems must be an array')
  }

  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new ValidationError(`customSidebarItems[${index}] must be an object`)
    }
    const record = item as Record<string, unknown>
    if (typeof record.id !== 'string' || record.id.trim() === '') {
      throw new ValidationError(`customSidebarItems[${index}].id must be a non-empty string`)
    }
    if (typeof record.type !== 'string' || !CUSTOM_SIDEBAR_ITEM_TYPES.has(record.type)) {
      throw new ValidationError(`customSidebarItems[${index}].type is unsupported`)
    }
    if (typeof record.subType !== 'string') {
      throw new ValidationError(`customSidebarItems[${index}].subType must be a string`)
    }
    if (record.type === 'setting' && record.subType.trim() === '') {
      throw new ValidationError(`customSidebarItems[${index}].subType must be a non-empty string for setting items`)
    }
    if (typeof record.label !== 'string') {
      throw new ValidationError(`customSidebarItems[${index}].label must be a string`)
    }

    return {
      id: record.id,
      type: record.type,
      subType: record.subType,
      label: record.label,
    }
  })
}

function readSelectionLastInteraction(value: unknown): number {
  if (value === undefined) return Date.now()
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ValidationError('lastInteraction must be a finite number')
  }
  return value
}

function readLegacyBotPresetExtractionMode(value: unknown): LegacyBotPresetExtractionMode {
  if (value === 'all' || value === 'model' || value === 'prompt') return value
  throw new ValidationError('mode must be one of all, model, or prompt')
}

function validateSettingsAssetRefs(db: DatabaseSync, patch: Record<string, unknown>): void {
  if ('customBackground' in patch) {
    validateOptionalServerAssetRef(db, patch.customBackground, 'customBackground')
  }
}

function settingValueKind(key: string): SettingValueKind {
  if (BOOLEAN_SETTING_KEYS.has(key)) return 'boolean'
  if (NUMBER_SETTING_KEYS.has(key)) return 'number'
  if (STRING_SETTING_KEYS.has(key)) return 'string'
  if (STRING_OR_NULL_SETTING_KEYS.has(key)) return 'stringOrNull'
  if (OBJECT_SETTING_KEYS.has(key)) return 'object'
  if (ARRAY_SETTING_KEYS.has(key)) return 'array'
  if (ARRAY_OR_NULL_SETTING_KEYS.has(key)) return 'arrayOrNull'
  return 'json'
}

function validateJsonValue(key: string, value: unknown): void {
  try {
    JSON.stringify(value)
  } catch {
    throw new ValidationError(`${key} must be JSON-serializable`)
  }
  if (value === undefined) {
    throw new ValidationError(`${key} must be JSON-serializable`)
  }
}

function applySettingsPatch(database: unknown, patch: Record<string, unknown>): void {
  if (!database || typeof database !== 'object' || Array.isArray(database)) {
    throw new ValidationError('database must be an object before settings commands can run')
  }

  const target = database as Record<string, unknown>
  const resolvedPatch = resolveMaskedProviderSecretPlaceholders(database, patch)
  for (const [key, value] of Object.entries(resolvedPatch)) {
    target[key] = normalizeSettingsPatchValue(key, value)
  }
}

function normalizeSettingsPatchValue(key: string, value: unknown): unknown {
  if (key === 'modelRoles') return normalizeModelRoleOverrides(value)
  if (key === 'modelProfiles') return normalizeModelProfiles(value)
  if (key === 'modelRoleProfiles') return normalizeModelRoleProfiles(value)
  if (key === 'modelRuntimeDefaults') return normalizeModelRuntimeDefaults(value)
  if (key === 'seperateModels') return normalizeLegacySeperateModels(value)
  if (key === 'fallbackModels') return normalizeLegacyFallbackModels(value)
  if (key === 'seperateParameters') return normalizeSeperateParametersValue(value)
  return value
}

function normalizeSeperateParametersValue(value: unknown): Record<string, unknown> {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
  return {
    memory: recordOrBlank(source.memory),
    emotion: recordOrBlank(source.emotion),
    translate: recordOrBlank(source.translate),
    otherAx: recordOrBlank(source.otherAx),
    scriptMain: recordOrBlank(source.scriptMain),
    scriptAux: recordOrBlank(source.scriptAux),
    overrides: recordOrBlank(source.overrides),
  }
}

function recordOrBlank(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function sendCommandError(reply: FastifyReply, err: unknown): { error: string; currentRevision?: number } {
  if (err instanceof RevisionMismatchError) {
    reply.code(409)
    return { error: 'revision_conflict', currentRevision: err.currentRevision }
  }
  if (err instanceof ValidationError) {
    reply.code(400)
    return { error: err.message }
  }
  if (err instanceof EntityNotFoundError) {
    reply.code(404)
    return { error: err.message }
  }
  throw err
}
