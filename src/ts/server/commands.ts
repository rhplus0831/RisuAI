import { getNodeServerProxyAuth } from '../storage/fastifyStorage'
import type { ChatGenerationSettings } from '../chatGenerationSettings'
import {
  AGENT_PRESET_SCHEMA_VERSION,
  normalizeAgentPresets,
  validateAgentPresetRecord,
  validateAgentPresetStepRecord,
  type AgentPresetRecord,
  type AgentPresetStepRecord,
} from '../agentPresetRecords'
import type { MessageTranslation } from '../storage/database.svelte'
import type { ModelRole } from '../model/modelRoles'
import type {
  ModelProfileRecord,
  ModelProfileRecordRuntimeOptions,
  ModelRoleProfileBinding,
} from '../model/modelProfileRecords'
import type { ScriptDefinitionCollectionMutation } from './scriptDefinitionMutations'
import { activeWriterSessionHeader, handleActiveWriterStaleResponse } from './activeWriterSession'
import { isCanonicalLoadout } from './loadoutCanonical'
import { SERVER_SETTINGS_GROUP_BY_KEY, type SettingsGroup } from './settingsGroups'
import {
  captureDestructiveRefreshEpoch,
  hasDestructiveRefreshEpochChanged,
  runRollbackUnlessDestructiveRefreshChanged,
} from './staleStateGuards'

const COMMAND_ENDPOINT = '/api/v1/commands'
const BOOTSTRAP_ENDPOINT = '/api/v1/bootstrap'

export {
  SERVER_SETTINGS_GROUP_BY_KEY,
  SERVER_SETTINGS_KEYS_BY_GROUP,
  SETTINGS_GROUPS,
  isSettingsGroup,
  type SettingsGroup,
} from './settingsGroups'

export interface CommandEvent {
  type: string
  revision: number
  resource: string
  id?: string
  parentId?: string
  origin?: {
    writerSessionId: string
  }
}

export interface ChatGenerationSettingsLocalEffect {
  kind: 'chatGenerationSettings'
  chatId: string
  characterId: string
  attemptedGenerationSettings: ChatGenerationSettings
  generationSettings: ChatGenerationSettings
}

export interface CharacterPatchLocalEffect {
  kind: 'characterPatch'
  characterId: string
  patch: CharacterSnapshot
}

export interface CharacterSelectionLocalEffect {
  kind: 'characterSelection'
  characterId: string
  lastInteraction: number
}

export interface CharacterCollectionMutationLocalEffect {
  kind: 'characterCollectionMutation'
  operation: 'create' | 'createAndSelect' | 'delete'
  characterId: string
  selectedCharacterId: string | null
}

export interface ChatPatchLocalEffect {
  kind: 'chatPatch'
  characterId: string
  chatId: string
  patch: ChatSnapshot
  select: boolean
}

export interface ChatStructureMutationLocalEffect {
  kind: 'chatStructureMutation'
  operation: 'create' | 'delete' | 'fork' | 'reorder' | 'folderCreate' | 'folderDelete' | 'folderReorder'
  characterId: string
  targetId?: string
  attemptedIds?: string[]
  attemptedGenerationSettings?: ChatGenerationSettings | null
  generationSettings?: ChatGenerationSettings | null
  optimisticEpoch: number
  optimisticRowEpoch: number
}

export interface SettingsPatchLocalEffect {
  kind: 'settingsPatch'
  group: SettingsGroup
  attemptedPatch: SettingsPatch
  settings: SettingsPatch
  settingsProjectionEpoch?: number
}

export interface PluginStorageLocalEffect {
  kind: 'pluginStorage'
  operation: 'put' | 'delete' | 'bulk'
  key?: string
}

export interface PluginCollectionMutationLocalEffect {
  kind: 'pluginCollectionMutation'
  operation: 'create' | 'update' | 'delete' | 'enable' | 'reorder'
  pluginId?: string
  pluginIds?: string[]
}

export interface PluginProviderLocalEffect {
  kind: 'pluginProvider'
  provider: string
}

export interface ModuleCollectionMutationLocalEffect {
  kind: 'moduleCollectionMutation'
  operation: 'create' | 'update' | 'reorder' | 'lorebooks' | 'scripts' | 'triggers'
  moduleId?: string
  moduleIds?: string[]
  collectionProjectionEpoch?: number
}

export interface ModuleEnabledLocalEffect {
  kind: 'moduleEnabled'
  moduleId: string
  enabled: boolean
}

export type PromptItemMutationOperation = 'create' | 'update' | 'delete' | 'reorder' | 'enable'

export type PromptTemplateOwnerStateSnapshot = { enabled: true; items: PromptItemSnapshot[] } | { enabled: false }

/**
 * Client-only proof captured around one optimistic prompt-item write. It is
 * deliberately omitted from the command request body.
 */
export interface PromptItemOptimisticAcknowledgement {
  collectionProjectionEpoch: number
  ownerProjectionEpoch: number
  ownerState: PromptTemplateOwnerStateSnapshot
}

export interface PromptItemMutationLocalEffect {
  kind: 'promptItemMutation'
  operation: PromptItemMutationOperation
  promptPresetId: string | null
  itemId?: string
  itemIds?: string[]
  enabled?: boolean
  collectionProjectionEpoch: number
  ownerProjectionEpoch: number
  ownerState: PromptTemplateOwnerStateSnapshot
}

export interface SplitPresetPatchOptimisticAcknowledgement {
  collectionProjectionEpoch: number
  settingsProjectionEpoch: number
  selectedPresetId: string | null
  selectedPromptPresetId?: string | null
  attemptedSettings: Record<string, unknown>
  selectedProjectionExpected: boolean
  ownerProjectionExpected?: boolean
  promptOwnerProjectionEpoch?: number
  promptOwnerRevision?: number
}

export interface SplitPresetPatchLocalEffect {
  kind: 'splitPresetPatch'
  presetKind: 'model' | 'prompt'
  presetId: string
  attemptedPatch: Record<string, unknown>
  preset: Record<string, unknown>
  attemptedSettings: Record<string, unknown>
  settings: Record<string, unknown>
  selectedProjectionApplied: boolean
  ownerProjectionApplied: boolean
  collectionProjectionEpoch: number
  settingsProjectionEpoch: number
  selectedPresetId: string | null
  selectedPromptPresetId?: string | null
  promptOwnerProjectionEpoch?: number
  promptOwnerRevision?: number
}

export type JsonFieldState = { present: false } | { present: true; value: unknown }

/** Client-only proof captured after one optimistic Agent Preset field PATCH. */
export interface AgentPresetPatchOptimisticAcknowledgement {
  settingsProjectionEpoch: number
  attemptedFields: Record<string, JsonFieldState>
}

export interface AgentPresetPatchLocalEffect {
  kind: 'agentPresetPatch'
  presetId: string
  settingsProjectionEpoch: number
  fields: Record<
    string,
    {
      attempted: JsonFieldState
      canonical: JsonFieldState
    }
  >
  updatedAt: number
}

export interface AgentPresetStepPatchLocalEffect {
  kind: 'agentPresetStepPatch'
  presetId: string
  stepId: string
  settingsProjectionEpoch: number
  fields: Record<
    string,
    {
      attempted: JsonFieldState
      canonical: JsonFieldState
    }
  >
  updatedAt: number
}

/** Client-only proof captured after one optimistic legacy-preset PATCH. */
export interface LegacyPresetPatchOptimisticAcknowledgement {
  collectionProjectionEpoch: number
  attemptedFields: Record<string, JsonFieldState>
}

export interface LegacyPresetPatchLocalEffect {
  kind: 'legacyPresetPatch'
  presetId: string
  collectionProjectionEpoch: number
  fields: Record<
    string,
    {
      attempted: JsonFieldState
      canonical: JsonFieldState
    }
  >
}

export interface PersonaLegacyProfileProjection {
  username: string
  userIcon: string
  personaPrompt: string
  userNote: string
}

/** Client-only proof captured after one optimistic persona PATCH. */
export interface PersonaPatchOptimisticAcknowledgement {
  collectionProjectionEpoch: number
  settingsProjectionEpoch: number
  attemptedPersona: PersonaSnapshot & { id: string }
  attemptedLegacyProfile: PersonaLegacyProfileProjection
  legacyProfileProjectionExpected: boolean
}

export interface PersonaPatchLocalEffect {
  kind: 'personaPatch'
  personaId: string
  collectionProjectionEpoch: number
  settingsProjectionEpoch: number
  attemptedPatch: PersonaSnapshot
  attemptedPersona: PersonaSnapshot & { id: string }
  attemptedLegacyProfile: PersonaLegacyProfileProjection
  legacyProfileProjectionApplied: boolean
}

/** Client-only proof captured after one optimistic translator-preset PATCH. */
export interface TranslatorPresetPatchOptimisticAcknowledgement {
  collectionProjectionEpoch: number
  languageSettingsProjectionEpoch: number
  selectedPresetId: string
  attemptedPreset: TranslatorPresetSnapshot & { id: string }
}

export interface TranslatorPresetPatchLocalEffect {
  kind: 'translatorPresetPatch'
  presetId: string
  collectionProjectionEpoch: number
  languageSettingsProjectionEpoch: number
  selectedPresetId: string
  attemptedPatch: TranslatorPresetSnapshot
  attemptedPreset: TranslatorPresetSnapshot & { id: string }
}

export interface LorebookMutationLocalEffect {
  kind: 'lorebookMutation'
  scope: 'global' | 'character' | 'chat'
  operation: 'replace' | 'upsert' | 'delete' | 'reorder'
  lorebookId?: string
  characterId?: string
  chatId?: string
  collectionProjectionEpoch?: number
  characterRowProjectionEpoch?: number
  characterLorebookProjectionEpoch?: number
}

export interface GlobalLorebookMutationLocalEffect {
  kind: 'globalLorebookMutation'
  operation: 'create' | 'update' | 'delete' | 'reorder' | 'select'
  lorebookId?: string
  lorebookIds?: string[]
  selectedLorebookId?: string | null
  collectionProjectionEpoch?: number
  pageProjectionEpoch?: number
}

export interface LoadoutMutationLocalEffect {
  kind: 'loadoutMutation'
  operation: 'create' | 'delete' | 'favorite' | 'touch'
  loadoutId: string
  loadoutsProjectionEpoch: number
  settingsProjectionEpoch?: number
  loadedName?: string
}

export interface CharacterDefinitionMutationLocalEffect {
  kind: 'characterDefinitionMutation'
  operation: 'scripts' | 'triggers'
  characterId: string
  optimisticRowEpoch: number
}

export interface MessageTranslationLocalEffect {
  kind: 'messageTranslation'
  chatId: string
  messageId: string
  translation: MessageTranslation
}

export interface MessageMutationLocalEffect {
  kind: 'messageMutation'
  operation: 'append' | 'update' | 'delete' | 'truncate' | 'replaceTail' | 'replaceAll'
  chatId: string
  messageId?: string
}

export interface CharacterRowMutationLocalEffect {
  kind: 'characterRowMutation'
  operation: 'chatFolderUpdate' | 'chatScriptstate'
  characterId: string
  targetId: string
}

export interface CharacterOrderLocalEffect {
  kind: 'characterOrder'
  attemptedOrder: CharacterOrderEntry[]
}

export type ServerCommandLocalEffect =
  | ChatGenerationSettingsLocalEffect
  | CharacterPatchLocalEffect
  | CharacterSelectionLocalEffect
  | CharacterCollectionMutationLocalEffect
  | ChatPatchLocalEffect
  | ChatStructureMutationLocalEffect
  | SettingsPatchLocalEffect
  | PluginStorageLocalEffect
  | PluginCollectionMutationLocalEffect
  | PluginProviderLocalEffect
  | ModuleCollectionMutationLocalEffect
  | ModuleEnabledLocalEffect
  | PromptItemMutationLocalEffect
  | SplitPresetPatchLocalEffect
  | LegacyPresetPatchLocalEffect
  | AgentPresetPatchLocalEffect
  | AgentPresetStepPatchLocalEffect
  | PersonaPatchLocalEffect
  | TranslatorPresetPatchLocalEffect
  | GlobalLorebookMutationLocalEffect
  | LorebookMutationLocalEffect
  | LoadoutMutationLocalEffect
  | CharacterDefinitionMutationLocalEffect
  | MessageTranslationLocalEffect
  | MessageMutationLocalEffect
  | CharacterRowMutationLocalEffect
  | CharacterOrderLocalEffect

export type ServerCommandResult<T extends Record<string, unknown> = {}> =
  | ({ status: 'ok'; revision: number; event: CommandEvent } & T)
  | { status: 'conflict'; currentRevision: number }
  | { status: 'error'; error: string }
  | { status: 'unavailable' }

export type SettingsPatch = Record<string, unknown>

export type RuntimeSettingsPatch = SettingsPatch

export interface PatchRuntimeSettingsInput {
  baseRevision: number
  patch: RuntimeSettingsPatch
}

export interface PatchSettingsGroupInput {
  group: SettingsGroup
  baseRevision: number
  patch: SettingsPatch
  acknowledgeOptimistic?: boolean
  optimisticProjectionEpoch?: number
}

export interface PatchServerBackedSettingsInput {
  patch: SettingsPatch
  rollback?: () => void
  signal?: AbortSignal | null
  keepalive?: boolean
}

export type PresetSnapshot = Record<string, unknown> & {
  id?: string
  name?: string
}

export type PromptItemSnapshot = Record<string, unknown> & {
  id?: string
  type?: string
}

export type PersonaSnapshot = Record<string, unknown> & {
  id?: string
  name?: string
  displayName?: string
  icon?: string
  personaPrompt?: string
  note?: string
  largePortrait?: boolean
}

export type TranslatorPresetSnapshot = Record<string, unknown> & {
  id?: string
  name?: string
  prompt?: string
  maxResponse?: number
}

export type LoadoutSnapshot = Record<string, unknown> & {
  id?: string
  name?: string
  lastUsed?: number
  favorite?: boolean
  characterIds?: string[]
  modules?: string[]
  globalVariables?: Record<string, string>
  presetName?: string
  modelPresetId?: string
  modelPresetName?: string
  promptPresetId?: string
  promptPresetName?: string
  agentPresetId?: string
  agentPresetName?: string
  personaId?: string
}

export type CharacterSnapshot = Record<string, unknown> & {
  chaId?: string
  name?: string
  displayName?: string
  trashTime?: number | null
}

export type CharacterOrderEntry =
  | string
  | (Record<string, unknown> & {
      id: string
      name?: string
      color?: string
      data: string[]
      imgFile?: string | null
      img?: string
    })

export type ChatSnapshot = Record<string, unknown> & {
  id?: string
  message?: unknown[]
  note?: string
  name?: string
  localLore?: unknown[]
  generationSettings?: ChatGenerationSettings
  folderId?: string | null
  bindedPersona?: string
  bookmarks?: string[]
  bookmarkNames?: Record<string, string>
  modules?: string[]
}

export type LorebookEntrySnapshot = Record<string, unknown> & {
  id?: string
  key?: string
  secondkey?: string
  insertorder?: number
  comment?: string
  content?: string
  mode?: string
  alwaysActive?: boolean
  selective?: boolean
  folder?: string
}

export type GlobalLorebookSnapshot = Record<string, unknown> & {
  id?: string
  name?: string
  data?: LorebookEntrySnapshot[]
}

export type ModuleSnapshot = Record<string, unknown> & {
  id?: string
  name?: string
  description?: string
  namespace?: string
  lowLevelAccess?: boolean
  hideIcon?: boolean
  backgroundEmbedding?: string
  customModuleToggle?: string
  cjs?: string
}

export type PluginSnapshot = Record<string, unknown> & {
  name?: string
  script?: string
  arguments?: Record<string, 'int' | 'string' | string[]>
  realArg?: Record<string, string | number>
  customLink?: Array<{ link: string; hoverText?: string }>
  argMeta?: Record<string, Record<string, string>>
  version?: 1 | 2 | '2.1' | '3.0'
  displayName?: string
  versionOfPlugin?: string
  updateURL?: string
  enabled?: boolean
  allowedIPC?: string[]
}

export type ScriptDefinitionSnapshot = Record<string, unknown> & {
  id?: string
  comment?: string
  in?: string
  out?: string
  type?: string
  flag?: string
  ableFlag?: boolean
}

export type TriggerDefinitionSnapshot = Record<string, unknown> & {
  id?: string
  comment?: string
  type?: string
  conditions?: unknown[]
  effect?: unknown[]
}

export type ChatScriptstateValue = string | number | boolean
export type ChatScriptstatePatch = Record<string, ChatScriptstateValue>

export type ChatFolderSnapshot = Record<string, unknown> & {
  id?: string
  name?: string
  color?: string
  folded?: boolean
}

export type MessageSnapshot = Record<string, unknown> & {
  role?: 'user' | 'char'
  data?: string
  chatId?: string
  translation?: MessageTranslation | null
}

export interface PresetCommandInput {
  baseRevision: number
}

export interface CreatePresetCommandInput extends PresetCommandInput {
  preset: PresetSnapshot
}

export interface UpdatePresetCommandInput extends PresetCommandInput {
  presetId: string
  patch: PresetSnapshot
  optimisticAcknowledgement?: LegacyPresetPatchOptimisticAcknowledgement
}

export interface DeletePresetCommandInput extends PresetCommandInput {
  presetId: string
  selectPresetId?: string
  apply?: boolean
  saveCurrent?: boolean
}

export interface CopyPresetCommandInput extends PresetCommandInput {
  presetId: string
  newPresetId: string
  name?: string
  saveCurrent?: boolean
}

export interface SelectPresetCommandInput extends PresetCommandInput {
  presetId: string
  apply?: boolean
  saveCurrent?: boolean
}

export interface ImportPresetCommandInput extends PresetCommandInput {
  preset: PresetSnapshot
}

export interface ReorderPresetsCommandInput extends PresetCommandInput {
  presetIds: string[]
}

export type ModelPresetSnapshot = Record<string, unknown>
export type PromptPresetSnapshot = Record<string, unknown>
export type AgentPresetSnapshot = Partial<AgentPresetRecord> & Record<string, unknown>
export type AgentPresetStepSnapshot = Partial<AgentPresetStepRecord> & Record<string, unknown>

export interface ModelPresetCommandInput {
  baseRevision: number
}

export interface CreateModelPresetCommandInput extends ModelPresetCommandInput {
  preset: ModelPresetSnapshot
}

export interface UpdateModelPresetCommandInput extends ModelPresetCommandInput {
  modelPresetId: string
  patch: ModelPresetSnapshot
  optimisticAcknowledgement?: SplitPresetPatchOptimisticAcknowledgement
}

export interface DeleteModelPresetCommandInput extends ModelPresetCommandInput {
  modelPresetId: string
  selectModelPresetId?: string
}

export interface SelectModelPresetCommandInput extends ModelPresetCommandInput {
  modelPresetId: string
}

export interface ImportModelPresetCommandInput extends ModelPresetCommandInput {
  preset: ModelPresetSnapshot
}

export interface ReorderModelPresetsCommandInput extends ModelPresetCommandInput {
  modelPresetIds: string[]
}

export interface PromptPresetCommandInput {
  baseRevision: number
}

export interface CreatePromptPresetCommandInput extends PromptPresetCommandInput {
  preset: PromptPresetSnapshot
}

export interface UpdatePromptPresetCommandInput extends PromptPresetCommandInput {
  promptPresetId: string
  patch: PromptPresetSnapshot
  optimisticAcknowledgement?: SplitPresetPatchOptimisticAcknowledgement
}

export interface DeletePromptPresetCommandInput extends PromptPresetCommandInput {
  promptPresetId: string
  selectPromptPresetId?: string
}

export interface SelectPromptPresetCommandInput extends PromptPresetCommandInput {
  promptPresetId: string
}

export interface ImportPromptPresetCommandInput extends PromptPresetCommandInput {
  preset: PromptPresetSnapshot
}

export interface ReorderPromptPresetsCommandInput extends PromptPresetCommandInput {
  promptPresetIds: string[]
}

export interface AgentPresetCommandInput {
  baseRevision: number
}

export interface CreateAgentPresetCommandInput extends AgentPresetCommandInput {
  preset: AgentPresetSnapshot
}

export interface UpdateAgentPresetCommandInput extends AgentPresetCommandInput {
  presetId: string
  patch: AgentPresetSnapshot
  optimisticAcknowledgement?: AgentPresetPatchOptimisticAcknowledgement
}

export interface DuplicateAgentPresetCommandInput extends AgentPresetCommandInput {
  presetId: string
  name?: string
}

export interface DeleteAgentPresetCommandInput extends AgentPresetCommandInput {
  presetId: string
}

export interface ReorderAgentPresetsCommandInput extends AgentPresetCommandInput {
  presetIds: string[]
}

export interface SetAgentPresetDefaultCommandInput extends AgentPresetCommandInput {
  agentPresetId: string | null
}

export interface CreateAgentPresetStepCommandInput extends AgentPresetCommandInput {
  presetId: string
  step: AgentPresetStepSnapshot
}

export interface UpdateAgentPresetStepCommandInput extends AgentPresetCommandInput {
  presetId: string
  stepId: string
  patch: AgentPresetStepSnapshot
  optimisticAcknowledgement?: AgentPresetPatchOptimisticAcknowledgement
}

export interface DuplicateAgentPresetStepCommandInput extends AgentPresetCommandInput {
  presetId: string
  stepId: string
  name?: string
}

export interface DeleteAgentPresetStepCommandInput extends AgentPresetCommandInput {
  presetId: string
  stepId: string
}

export interface ReorderAgentPresetStepsCommandInput extends AgentPresetCommandInput {
  presetId: string
  stepIds: string[]
}

export type ModelProfileSnapshot = Omit<ModelProfileRecord, 'id'> & {
  id?: string
}

export type ModelRuntimeDefaultsSnapshot = ModelProfileRecordRuntimeOptions

export interface ModelProfileCommandInput {
  baseRevision: number
}

export interface CreateModelProfileCommandInput extends ModelProfileCommandInput {
  profile: ModelProfileSnapshot
}

export interface UpdateModelProfileCommandInput extends ModelProfileCommandInput {
  profileId: string
  profile: ModelProfileSnapshot
}

export interface DuplicateModelProfileCommandInput extends ModelProfileCommandInput {
  profileId: string
  name?: string
  includeSecrets?: boolean
}

export interface DeleteModelProfileCommandInput extends ModelProfileCommandInput {
  profileId: string
  reassignments: Partial<Record<ModelRole, ModelRoleProfileBinding>>
}

export interface UpdateModelRoleProfilesCommandInput extends ModelProfileCommandInput {
  bindings: Partial<Record<ModelRole, ModelRoleProfileBinding>>
}

export interface CreateAndBindModelProfileCommandInput extends ModelProfileCommandInput {
  role: ModelRole
  profile: ModelProfileSnapshot
}

export interface UpdateModelRuntimeDefaultsCommandInput extends ModelProfileCommandInput {
  runtimeDefaults: ModelRuntimeDefaultsSnapshot
}

export interface ConvertLegacyModelProfilesCommandInput extends ModelProfileCommandInput {}

export interface ExtractLegacyBotPresetCommandInput {
  baseRevision: number
  presetId: string
  mode: 'all' | 'model' | 'prompt'
}

export interface PatchPromptSettingsCommandInput {
  baseRevision: number
  patch: SettingsPatch
  acknowledgeOptimistic?: boolean
  optimisticProjectionEpoch?: number
}

interface PromptItemOptimisticCommandInput {
  optimisticAcknowledgement?: PromptItemOptimisticAcknowledgement
}

export interface CreatePromptItemCommandInput extends PromptItemOptimisticCommandInput {
  baseRevision: number
  promptPresetId?: string
  promptItem: PromptItemSnapshot
}

export interface UpdatePromptItemCommandInput extends PromptItemOptimisticCommandInput {
  baseRevision: number
  promptPresetId?: string
  itemId: string
  patch: PromptItemSnapshot
  deleteKeys?: string[]
}

export interface DeletePromptItemCommandInput extends PromptItemOptimisticCommandInput {
  baseRevision: number
  promptPresetId?: string
  itemId: string
}

export interface ReorderPromptItemsCommandInput extends PromptItemOptimisticCommandInput {
  baseRevision: number
  promptPresetId?: string
  itemIds: string[]
}

export interface EnablePromptItemsCommandInput extends PromptItemOptimisticCommandInput {
  baseRevision: number
  promptPresetId?: string
  enabled: boolean
}

export interface PersonaCommandInput {
  baseRevision: number
}

export interface CreatePersonaCommandInput extends PersonaCommandInput {
  persona: PersonaSnapshot
  mirrorLegacyProfile?: boolean
}

export interface UpdatePersonaCommandInput extends PersonaCommandInput {
  personaId: string
  patch: PersonaSnapshot
  mirrorLegacyProfile?: boolean
  optimisticAcknowledgement?: PersonaPatchOptimisticAcknowledgement
}

export interface DeletePersonaCommandInput extends PersonaCommandInput {
  personaId: string
  selectPersonaId?: string
  mirrorLegacyProfile?: boolean
  saveCurrent?: boolean
}

export interface SelectPersonaCommandInput extends PersonaCommandInput {
  personaId: string
  mirrorLegacyProfile?: boolean
  saveCurrent?: boolean
}

export interface ReorderPersonasCommandInput extends PersonaCommandInput {
  personaIds: string[]
}

export interface TranslatorPresetCommandInput {
  baseRevision: number
}

export interface CreateTranslatorPresetCommandInput extends TranslatorPresetCommandInput {
  preset: TranslatorPresetSnapshot
  select?: boolean
}

export interface UpdateTranslatorPresetCommandInput extends TranslatorPresetCommandInput {
  presetId: string
  patch: TranslatorPresetSnapshot
  optimisticAcknowledgement?: TranslatorPresetPatchOptimisticAcknowledgement
}

export interface DeleteTranslatorPresetCommandInput extends TranslatorPresetCommandInput {
  presetId: string
  selectPresetId?: string
}

export interface SelectTranslatorPresetCommandInput extends TranslatorPresetCommandInput {
  presetId: string
}

export interface LoadoutCommandInput {
  baseRevision: number
}

export interface CreateLoadoutCommandInput extends LoadoutCommandInput {
  loadout: LoadoutSnapshot
  acknowledgeOptimistic?: boolean
  loadoutsProjectionEpoch?: number
}

export interface UpdateLoadoutCommandInput extends LoadoutCommandInput {
  loadoutId: string
  patch: LoadoutSnapshot
}

export interface DeleteLoadoutCommandInput extends LoadoutCommandInput {
  loadoutId: string
  acknowledgeOptimistic?: boolean
  loadoutsProjectionEpoch?: number
}

export interface FavoriteLoadoutCommandInput extends LoadoutCommandInput {
  loadoutId: string
  favorite: boolean
  acknowledgeOptimistic?: boolean
  loadoutsProjectionEpoch?: number
}

export interface TouchLoadoutCommandInput extends LoadoutCommandInput {
  loadoutId: string
  lastUsed?: number
  characterId?: string
  acknowledgeOptimistic?: boolean
  loadoutsProjectionEpoch?: number
  settingsProjectionEpoch?: number
  loadedName?: string
}

export interface CharacterCommandInput {
  baseRevision: number
}

export interface CreateCharacterCommandInput extends CharacterCommandInput {
  character: CharacterSnapshot
}

export interface CreateAndSelectCharacterCommandInput extends CreateCharacterCommandInput {
  lastInteraction?: number
}

export interface UpdateCharacterCommandInput extends CharacterCommandInput {
  characterId: string
  patch: CharacterSnapshot
}

export interface DeleteCharacterCommandInput extends CharacterCommandInput {
  characterId: string
}

export interface SelectCharacterCommandInput extends CharacterCommandInput {
  characterId: string
  lastInteraction?: number
}

export interface ReorderCharactersCommandInput extends CharacterCommandInput {
  characterOrder: CharacterOrderEntry[]
}

export interface ChatCommandInput {
  baseRevision: number
  optimisticEpoch?: number
  optimisticRowEpoch?: number
}

export interface CreateChatCommandInput extends ChatCommandInput {
  characterId: string
  chat: ChatSnapshot
  select?: boolean
  acknowledgeOptimistic?: boolean
}

export interface UpdateChatCommandInput extends ChatCommandInput {
  chatId: string
  patch: ChatSnapshot
  select?: boolean
}

export interface SaveChatGenerationSettingsCommandInput extends ChatCommandInput {
  chatId: string
  generationSettings: ChatGenerationSettings
}

export interface DeleteChatCommandInput extends ChatCommandInput {
  chatId: string
  acknowledgeOptimistic?: boolean
}

export interface ForkChatCommandInput extends ChatCommandInput {
  chatId: string
  chat: ChatSnapshot
  sourcePatch?: ChatSnapshot
  folder?: ChatFolderSnapshot
  select?: boolean
  acknowledgeOptimistic?: boolean
}

export interface ReorderChatsCommandInput extends ChatCommandInput {
  characterId: string
  chatIds: string[]
  folderByChatId?: Record<string, string | null>
  selectedChatId?: string
  acknowledgeOptimistic?: boolean
}

export interface CreateChatFolderCommandInput extends ChatCommandInput {
  characterId: string
  folder: ChatFolderSnapshot
  acknowledgeOptimistic?: boolean
}

export interface UpdateChatFolderCommandInput extends ChatCommandInput {
  folderId: string
  patch: ChatFolderSnapshot
}

export interface DeleteChatFolderCommandInput extends ChatCommandInput {
  folderId: string
  acknowledgeOptimistic?: boolean
}

export interface ReorderChatFoldersCommandInput extends ChatCommandInput {
  characterId: string
  folderIds: string[]
  selectedChatId?: string
  acknowledgeOptimistic?: boolean
}

export interface PatchChatScriptstateCommandInput extends ChatCommandInput {
  chatId: string
  patch: ChatScriptstatePatch
  deleteKeys?: string[]
}

export interface LorebookCommandInput {
  baseRevision: number
}

interface TopLevelGlobalLorebookOptimisticMutationInput {
  acknowledgeOptimistic?: boolean
  optimisticCollectionEpoch?: number
  optimisticPageEpoch?: number
  optimisticSelectedLorebookId?: string | null
}

export interface CreateGlobalLorebookCommandInput
  extends LorebookCommandInput, TopLevelGlobalLorebookOptimisticMutationInput {
  lorebook: GlobalLorebookSnapshot
}

export interface UpdateGlobalLorebookCommandInput
  extends LorebookCommandInput, TopLevelGlobalLorebookOptimisticMutationInput {
  lorebookId: string
  patch: Pick<GlobalLorebookSnapshot, 'name'>
}

export interface DeleteGlobalLorebookCommandInput
  extends LorebookCommandInput, TopLevelGlobalLorebookOptimisticMutationInput {
  lorebookId: string
}

export interface ReorderGlobalLorebooksCommandInput
  extends LorebookCommandInput, TopLevelGlobalLorebookOptimisticMutationInput {
  lorebookIds: string[]
}

export interface SelectGlobalLorebookCommandInput
  extends LorebookCommandInput, TopLevelGlobalLorebookOptimisticMutationInput {
  lorebookId: string
}

interface GlobalLorebookOptimisticMutationInput {
  acknowledgeOptimistic?: boolean
  optimisticEntries?: LorebookEntrySnapshot[]
  optimisticCollectionEpoch?: number
  optimisticEntryIndex?: number
  optimisticEntryCreated?: boolean
}

interface CharacterLorebookOptimisticMutationInput {
  acknowledgeOptimistic?: boolean
  optimisticEntries?: LorebookEntrySnapshot[]
  optimisticRowEpoch?: number
  optimisticLorebookEpoch?: number
  optimisticEntryIndex?: number
  optimisticEntryCreated?: boolean
}

interface ChatLorebookOptimisticMutationInput {
  acknowledgeOptimistic?: boolean
  optimisticEntries?: LorebookEntrySnapshot[]
  optimisticCharacterId?: string
  optimisticRowEpoch?: number
  optimisticEntryIndex?: number
  optimisticEntryCreated?: boolean
}

export interface ReplaceGlobalLorebookEntriesCommandInput
  extends LorebookCommandInput, GlobalLorebookOptimisticMutationInput {
  lorebookId: string
  entries: LorebookEntrySnapshot[]
}

export interface UpsertGlobalLorebookEntryCommandInput
  extends LorebookCommandInput, GlobalLorebookOptimisticMutationInput {
  lorebookId: string
  entryId: string
  entry: LorebookEntrySnapshot
}

export interface DeleteGlobalLorebookEntryCommandInput
  extends LorebookCommandInput, GlobalLorebookOptimisticMutationInput {
  lorebookId: string
  entryId: string
}

export interface ReorderGlobalLorebookEntriesCommandInput
  extends LorebookCommandInput, GlobalLorebookOptimisticMutationInput {
  lorebookId: string
  entryIds: string[]
}

export interface ReplaceCharacterLorebooksCommandInput
  extends LorebookCommandInput, CharacterLorebookOptimisticMutationInput {
  characterId: string
  entries: LorebookEntrySnapshot[]
}

export interface UpsertCharacterLorebookEntryCommandInput
  extends LorebookCommandInput, CharacterLorebookOptimisticMutationInput {
  characterId: string
  entryId: string
  entry: LorebookEntrySnapshot
}

export interface DeleteCharacterLorebookEntryCommandInput
  extends LorebookCommandInput, CharacterLorebookOptimisticMutationInput {
  characterId: string
  entryId: string
}

export interface ReorderCharacterLorebookEntriesCommandInput
  extends LorebookCommandInput, CharacterLorebookOptimisticMutationInput {
  characterId: string
  entryIds: string[]
}

export interface ReplaceChatLorebooksCommandInput extends LorebookCommandInput, ChatLorebookOptimisticMutationInput {
  chatId: string
  entries: LorebookEntrySnapshot[]
}

export interface UpsertChatLorebookEntryCommandInput extends LorebookCommandInput, ChatLorebookOptimisticMutationInput {
  chatId: string
  entryId: string
  entry: LorebookEntrySnapshot
}

export interface DeleteChatLorebookEntryCommandInput extends LorebookCommandInput, ChatLorebookOptimisticMutationInput {
  chatId: string
  entryId: string
}

export interface ReorderChatLorebookEntriesCommandInput
  extends LorebookCommandInput, ChatLorebookOptimisticMutationInput {
  chatId: string
  entryIds: string[]
}

export interface ReplaceModuleLorebooksCommandInput extends LorebookCommandInput {
  moduleId: string
  entries: LorebookEntrySnapshot[]
}

export interface UpsertModuleLorebookEntryCommandInput extends LorebookCommandInput {
  moduleId: string
  entryId: string
  entry: LorebookEntrySnapshot
}

export interface DeleteModuleLorebookEntryCommandInput extends LorebookCommandInput {
  moduleId: string
  entryId: string
}

export interface ReorderModuleLorebookEntriesCommandInput extends LorebookCommandInput {
  moduleId: string
  entryIds: string[]
}

export interface ScriptDefinitionCommandInput {
  baseRevision: number
}

export interface ReplaceCharacterScriptsCommandInput extends ScriptDefinitionCommandInput {
  characterId: string
  scripts: ScriptDefinitionSnapshot[]
  optimisticRowEpoch?: number
}

export interface MutateCharacterScriptsCommandInput extends ScriptDefinitionCommandInput {
  characterId: string
  mutation: ScriptDefinitionCollectionMutation
  expectedScripts: ScriptDefinitionSnapshot[]
  optimisticRowEpoch?: number
}

export interface ReplaceCharacterTriggersCommandInput extends ScriptDefinitionCommandInput {
  characterId: string
  triggers: TriggerDefinitionSnapshot[]
  optimisticRowEpoch?: number
}

export interface MutateCharacterTriggersCommandInput extends ScriptDefinitionCommandInput {
  characterId: string
  mutation: ScriptDefinitionCollectionMutation
  expectedTriggers: TriggerDefinitionSnapshot[]
  optimisticRowEpoch?: number
}

export interface ReplaceModuleScriptsCommandInput extends ScriptDefinitionCommandInput {
  moduleId: string
  scripts: ScriptDefinitionSnapshot[]
  optimisticCollectionEpoch?: number
}

export interface MutateModuleScriptsCommandInput extends ScriptDefinitionCommandInput {
  moduleId: string
  mutation: ScriptDefinitionCollectionMutation
  expectedScripts: ScriptDefinitionSnapshot[]
  optimisticCollectionEpoch?: number
}

export interface ReplaceModuleTriggersCommandInput extends ScriptDefinitionCommandInput {
  moduleId: string
  triggers: TriggerDefinitionSnapshot[]
  optimisticCollectionEpoch?: number
}

export interface MutateModuleTriggersCommandInput extends ScriptDefinitionCommandInput {
  moduleId: string
  mutation: ScriptDefinitionCollectionMutation
  expectedTriggers: TriggerDefinitionSnapshot[]
  optimisticCollectionEpoch?: number
}

export interface ModuleCommandInput {
  baseRevision: number
}

export interface CreateModuleCommandInput extends ModuleCommandInput {
  module: ModuleSnapshot
}

export interface UpdateModuleCommandInput extends ModuleCommandInput {
  moduleId: string
  patch: ModuleSnapshot
}

export interface DeleteModuleCommandInput extends ModuleCommandInput {
  moduleId: string
}

export interface EnableModuleCommandInput extends ModuleCommandInput {
  moduleId: string
  enabled: boolean
}

export interface ReorderModulesCommandInput extends ModuleCommandInput {
  moduleIds: string[]
}

export interface ReorderCharacterModulesCommandInput extends ModuleCommandInput {
  characterId: string
  moduleIds: string[]
}

export interface PluginCommandInput {
  baseRevision: number
}

export interface CreatePluginCommandInput extends PluginCommandInput {
  plugin: PluginSnapshot
}

export interface UpdatePluginCommandInput extends PluginCommandInput {
  pluginId: string
  patch: PluginSnapshot
}

export interface DeletePluginCommandInput extends PluginCommandInput {
  pluginId: string
}

export interface EnablePluginCommandInput extends PluginCommandInput {
  pluginId: string
  enabled: boolean
}

export interface SelectPluginProviderCommandInput extends PluginCommandInput {
  provider: string
}

export interface ReorderPluginsCommandInput extends PluginCommandInput {
  pluginIds: string[]
}

export interface PutPluginStorageCommandInput extends PluginCommandInput {
  key: string
  value: unknown
}

export interface DeletePluginStorageCommandInput extends PluginCommandInput {
  key: string
}

export interface BulkPluginStorageCommandInput extends PluginCommandInput {
  values?: Record<string, unknown>
  deleteKeys?: string[]
  clear?: boolean
}

export interface AppendMessageCommandInput extends ChatCommandInput {
  chatId: string
  message: MessageSnapshot
}

export interface UpdateMessageCommandInput extends ChatCommandInput {
  messageId: string
  patch: MessageSnapshot
}

export interface TranslateMessageCommandInput extends ChatCommandInput {
  messageId: string
}

export interface DeleteMessageCommandInput extends ChatCommandInput {
  messageId: string
}

export interface TruncateMessagesCommandInput extends ChatCommandInput {
  chatId: string
  afterMessageId?: string | null
  preserveRemovedAsAlternates?: boolean
}

export interface ReplaceTailMessagesCommandInput extends ChatCommandInput {
  chatId: string
  afterMessageId?: string | null
  messages: MessageSnapshot[]
}

export interface ReplaceMessagesCommandInput extends ChatCommandInput {
  chatId: string
  messages: MessageSnapshot[]
}

export interface PersistGenerationResultCommandInput extends ChatCommandInput {
  chatId: string
  generationResult: {
    message: MessageSnapshot
    targetMessageId?: string
  }
}

export interface RunServerPresetCommandInput<T extends Record<string, unknown> = {}> {
  command: (baseRevision: number) => Promise<ServerCommandResult<T>>
  rollback?: () => void
  signal?: AbortSignal | null
  keepalive?: boolean
}

export type ServerCommandFactory = (baseRevision: number) => Promise<ServerCommandResult>

export interface ServerCommandTransportOptions {
  signal?: AbortSignal | null
  keepalive?: boolean
}

let cachedServerCommandRevision: number | null = null
// The command/base-revision cursor may move ahead of the browser projection:
// conflicts and server-owned mutations tell us the latest server revision
// without proving that its resource state was applied locally. SSE replay,
// gap detection, and already-applied skips must therefore use this separate
// resource cursor instead of `cachedServerCommandRevision`.
let appliedServerResourceRevision: number | null = null
type ServerCommandSuccessReconciler = (
  event: CommandEvent,
  coalescedEvents: readonly CommandEvent[],
  localEffects: ReadonlyMap<number, ServerCommandLocalEffect>,
) => Promise<void> | void
type ServerCommandLocalEffectAppliedListener = (event: CommandEvent, localEffect: ServerCommandLocalEffect) => void

interface ServerCommandReconciliationBatch {
  pendingEvents: Map<number, CommandEvent>
  pendingLocalEffects: Map<number, ServerCommandLocalEffect>
  completion: Promise<void>
  resolveCompletion: () => void
  flushScheduled: boolean
  flushing: boolean
}

interface DirectServerCommandReconciliation {
  matches: (event: CommandEvent) => boolean
  pendingEvents: Map<number, CommandEvent>
}

let serverCommandSuccessReconciler: ServerCommandSuccessReconciler | null = null
const serverCommandLocalEffectAppliedListeners = new Set<ServerCommandLocalEffectAppliedListener>()
// Every command domain shares one server revision. Keep high-level mutations in
// one client queue so two unrelated optimistic edits cannot both dispatch with
// the same base revision and make the later edit roll back with a self-conflict.
let serverCommandExecutionTail: Promise<void> = Promise.resolve()
let queuedServerCommandExecutionCount = 0
let activeServerCommandReconciliationBatch: ServerCommandReconciliationBatch | null = null
const directServerCommandReconciliations = new Set<DirectServerCommandReconciliation>()

function enqueueServerCommandExecution<T>(task: () => Promise<T>): Promise<T> {
  const batch = getOrCreateServerCommandReconciliationBatch()
  queuedServerCommandExecutionCount += 1

  const execution = serverCommandExecutionTail.then(task)
  const settledExecution = execution.then(
    (value) => {
      finishServerCommandExecution(batch)
      return value
    },
    (error) => {
      finishServerCommandExecution(batch)
      throw error
    },
  )
  serverCommandExecutionTail = settledExecution.then(
    () => undefined,
    () => undefined,
  )
  return settledExecution.then(
    async (value) => {
      await batch.completion
      return value
    },
    async (error) => {
      await batch.completion
      throw error
    },
  )
}

function getOrCreateServerCommandReconciliationBatch(): ServerCommandReconciliationBatch {
  if (activeServerCommandReconciliationBatch) return activeServerCommandReconciliationBatch

  let resolveCompletion!: () => void
  const completion = new Promise<void>((resolve) => {
    resolveCompletion = resolve
  })
  activeServerCommandReconciliationBatch = {
    pendingEvents: new Map(),
    pendingLocalEffects: new Map(),
    completion,
    resolveCompletion,
    flushScheduled: false,
    flushing: false,
  }
  return activeServerCommandReconciliationBatch
}

function finishServerCommandExecution(batch: ServerCommandReconciliationBatch): void {
  queuedServerCommandExecutionCount = Math.max(0, queuedServerCommandExecutionCount - 1)
  if (queuedServerCommandExecutionCount === 0) scheduleServerCommandReconciliationFlush(batch)
}

function scheduleServerCommandReconciliationFlush(batch: ServerCommandReconciliationBatch): void {
  if (
    activeServerCommandReconciliationBatch !== batch ||
    batch.flushScheduled ||
    batch.flushing ||
    queuedServerCommandExecutionCount > 0
  ) {
    return
  }
  batch.flushScheduled = true
  queueMicrotask(() => {
    batch.flushScheduled = false
    void flushServerCommandReconciliationBatch(batch)
  })
}

async function flushServerCommandReconciliationBatch(batch: ServerCommandReconciliationBatch): Promise<void> {
  if (activeServerCommandReconciliationBatch !== batch || batch.flushing || queuedServerCommandExecutionCount > 0) {
    return
  }

  batch.flushing = true
  try {
    while (activeServerCommandReconciliationBatch === batch && queuedServerCommandExecutionCount === 0) {
      const coalescedEvents = Array.from(batch.pendingEvents.values()).sort(
        (left, right) => left.revision - right.revision,
      )
      const latestEvent = coalescedEvents.at(-1)
      if (!latestEvent) {
        completeServerCommandReconciliationBatch(batch)
        return
      }

      // Reconcile accepted revisions together so bootstrap can apply safe
      // contiguous local effects and issue at most one authoritative refresh
      // for the remaining invalidations.
      const localEffects = new Map<number, ServerCommandLocalEffect>()
      for (const coalescedEvent of coalescedEvents) {
        const effect = batch.pendingLocalEffects.get(coalescedEvent.revision)
        if (effect) localEffects.set(coalescedEvent.revision, effect)
      }
      await reconcileServerCommandSuccessEvents(latestEvent, coalescedEvents, localEffects)
      for (const revision of batch.pendingEvents.keys()) {
        if (revision <= latestEvent.revision) {
          batch.pendingEvents.delete(revision)
          batch.pendingLocalEffects.delete(revision)
        }
      }
    }
  } finally {
    batch.flushing = false
    if (activeServerCommandReconciliationBatch === batch && queuedServerCommandExecutionCount === 0) {
      if (batch.pendingEvents.size === 0) {
        completeServerCommandReconciliationBatch(batch)
      } else {
        scheduleServerCommandReconciliationFlush(batch)
      }
    }
  }
}

function completeServerCommandReconciliationBatch(batch: ServerCommandReconciliationBatch): void {
  if (activeServerCommandReconciliationBatch !== batch) return
  activeServerCommandReconciliationBatch = null
  batch.resolveCompletion()
}

function recordDeferredServerCommandSuccessEvent(
  batch: ServerCommandReconciliationBatch,
  event: CommandEvent,
  localEffect?: ServerCommandLocalEffect,
): void {
  batch.pendingEvents.set(event.revision, event)
  // The SSE own echo can arrive before the command response. Upgrade the
  // already-recorded event when the response later supplies its authoritative
  // local effect, and never let the duplicate executeServerCommand notify drop it.
  if (localEffect) batch.pendingLocalEffects.set(event.revision, localEffect)
}

export function deferOwnServerCommandReconciliation(
  event: CommandEvent,
  localEffect?: ServerCommandLocalEffect,
): boolean {
  const batch = activeServerCommandReconciliationBatch
  if (batch) {
    recordDeferredServerCommandSuccessEvent(batch, event, localEffect)
    return true
  }

  let deferred = false
  for (const direct of directServerCommandReconciliations) {
    if (!direct.matches(event)) continue
    direct.pendingEvents.set(event.revision, event)
    deferred = true
  }
  return deferred
}

function beginDirectServerCommandReconciliation(
  matches: (event: CommandEvent) => boolean,
): DirectServerCommandReconciliation {
  const direct = { matches, pendingEvents: new Map<number, CommandEvent>() }
  directServerCommandReconciliations.add(direct)
  return direct
}

async function finishDirectServerCommandReconciliation(
  direct: DirectServerCommandReconciliation | null,
  confirmedEvent: CommandEvent | null,
): Promise<void> {
  if (!direct) return
  directServerCommandReconciliations.delete(direct)
  await releaseDirectServerCommandEvents(direct, confirmedEvent)
}

async function releaseDirectServerCommandEvents(
  direct: DirectServerCommandReconciliation,
  confirmedEvent: CommandEvent | null,
  reactivate = false,
  beforeConfirmedOnly = false,
): Promise<void> {
  const pendingEvents = Array.from(direct.pendingEvents.values())
    .filter(
      (event) =>
        confirmedEvent === null ||
        (event.revision !== confirmedEvent.revision &&
          (!beforeConfirmedOnly || event.revision < confirmedEvent.revision)),
    )
    .sort((left, right) => left.revision - right.revision)
  for (const event of pendingEvents) direct.pendingEvents.delete(event.revision)
  const releasedEvents = pendingEvents.filter((event) => !deferOwnServerCommandReconciliation(event))
  if (reactivate) directServerCommandReconciliations.add(direct)
  const latestEvent = releasedEvents.at(-1)
  if (!latestEvent) return
  await reconcileServerCommandSuccessEvents(latestEvent, releasedEvents)
}

/**
 * Buffer matching own SSE echoes while a mutation outside the ordinary command
 * transport is waiting for and applying its authoritative response. The scope
 * remains active until response reconciliation finishes, so an echo arriving
 * during the resulting resource read cannot launch a duplicate read.
 *
 * Matching events that are not the confirmed response event are released back
 * through the normal reconciliation path. This keeps overlapping operations
 * and failed requests from swallowing unrelated own events.
 */
export async function withDirectServerCommandEventReconciliation<T>(
  matches: (event: CommandEvent) => boolean,
  operation: (reconcileResponseEvent: (event: CommandEvent) => Promise<void>) => Promise<T>,
): Promise<T> {
  const direct = beginDirectServerCommandReconciliation(matches)
  let confirmedEvent: CommandEvent | null = null
  try {
    return await operation(async (event) => {
      confirmedEvent = event
      // The Realm transport cannot know its new character id before parsing
      // the response, so its provisional matcher is intentionally broader.
      // Drain any unmatched earlier events first to preserve revision order.
      directServerCommandReconciliations.delete(direct)
      await releaseDirectServerCommandEvents(direct, confirmedEvent, true, true)
      await notifyServerCommandSuccessReconciler(event, true)
    })
  } finally {
    await finishDirectServerCommandReconciliation(direct, confirmedEvent)
  }
}

export function canUseServerCommands(): boolean {
  return true
}

export function settingsGroupForKey(key: string): SettingsGroup | null {
  return SERVER_SETTINGS_GROUP_BY_KEY[key] ?? null
}

export function setCachedServerCommandRevision(revision: number): void {
  if (
    Number.isInteger(revision) &&
    revision >= 0 &&
    (cachedServerCommandRevision === null || revision > cachedServerCommandRevision)
  ) {
    cachedServerCommandRevision = revision
  }
}

export function clearCachedServerCommandRevision(): void {
  cachedServerCommandRevision = null
}

export function setAppliedServerResourceRevision(revision: number): void {
  if (
    Number.isInteger(revision) &&
    revision >= 0 &&
    (appliedServerResourceRevision === null || revision > appliedServerResourceRevision)
  ) {
    appliedServerResourceRevision = revision
  }
}

export function clearAppliedServerResourceRevision(): void {
  appliedServerResourceRevision = null
}

export function peekAppliedServerResourceRevision(): number | null {
  return appliedServerResourceRevision
}

export function setServerCommandSuccessReconciler(reconciler: ServerCommandSuccessReconciler | null): void {
  serverCommandSuccessReconciler = reconciler
}

/**
 * Observe only local effects that passed every event/projection fence and were
 * actually applied. This is intentionally distinct from an HTTP 2xx receipt:
 * callers can safely settle optimistic dirty markers without weakening the
 * authoritative fallback path for malformed or stale acknowledgements.
 */
export function subscribeServerCommandLocalEffectApplied(
  listener: ServerCommandLocalEffectAppliedListener,
): () => void {
  serverCommandLocalEffectAppliedListeners.add(listener)
  return () => serverCommandLocalEffectAppliedListeners.delete(listener)
}

export function notifyServerCommandLocalEffectApplied(
  event: CommandEvent,
  localEffect: ServerCommandLocalEffect,
): void {
  for (const listener of serverCommandLocalEffectAppliedListeners) {
    try {
      listener(event, localEffect)
    } catch (error) {
      console.warn('Server command local-effect listener failed', error)
    }
  }
}

/**
 * Returns the latest server revision known to this client without issuing a
 * fetch. Commands use it as their base revision, and hydration uses it to reject
 * stale responses. It does not prove that the matching projection was applied.
 */
export function peekCachedServerCommandRevision(): number | null {
  return cachedServerCommandRevision
}

export async function getServerCommandBaseRevision(
  signal?: AbortSignal | null,
  keepalive = false,
): Promise<number | null> {
  if (!canUseServerCommands()) return null
  if (cachedServerCommandRevision !== null) return cachedServerCommandRevision

  const auth = await getNodeServerProxyAuth()
  let response: Response
  try {
    const init: RequestInit = {
      method: 'GET',
      signal: signal ?? undefined,
      headers: {
        'risu-auth': auth,
      },
    }
    if (keepalive) init.keepalive = true
    response = await fetch(BOOTSTRAP_ENDPOINT, init)
  } catch {
    return null
  }

  if (!response.ok) return null

  try {
    const body = (await response.json()) as { revision?: unknown }
    if (Number.isInteger(body.revision) && (body.revision as number) >= 0) {
      cachedServerCommandRevision = body.revision as number
      return cachedServerCommandRevision
    }
  } catch {
    return null
  }

  return null
}

export async function patchRuntimeSettings(
  input: PatchRuntimeSettingsInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult> {
  return patchSettingsGroup(
    {
      group: 'runtime',
      ...input,
    },
    signal,
  )
}

export async function patchSettingsGroup(
  input: PatchSettingsGroupInput,
  signal?: AbortSignal | null,
  keepalive = false,
): Promise<ServerCommandResult> {
  return requestCommandJson(`/settings/${encodeURIComponent(input.group)}`, {
    method: 'PATCH',
    body: {
      baseRevision: input.baseRevision,
      patch: input.patch,
    },
    signal,
    keepalive,
    readLocalEffect:
      input.acknowledgeOptimistic === false
        ? undefined
        : (body, event) =>
            readSettingsPatchLocalEffect(body, event, input.group, input.patch, input.optimisticProjectionEpoch),
  })
}

/**
 * First-run seed: ask a fresh server (whose persisted `database` is still
 * `null`) to create its default database. Must run before any other command,
 * which all require an existing database object. The server guards this
 * idempotently — it only writes when no database exists yet, so calling it
 * against an already-initialized server is a harmless no-op (`initialized: false`).
 */
export async function initializeServerDatabase(
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ initialized: boolean }>> {
  return requestCommandJson('/state/initialize', {
    method: 'POST',
    body: {},
    signal,
  })
}

export async function patchServerBackedSettings(input: PatchServerBackedSettingsInput): Promise<ServerCommandResult> {
  if (!canUseServerCommands()) return { status: 'unavailable' }

  const grouped = groupSettingsPatch(input.patch)
  if (grouped.length === 0) return { status: 'unavailable' }

  const rollbackEpoch = captureDestructiveRefreshEpoch()
  return enqueueServerCommandExecution(() => executeServerBackedSettingsPatch(input, grouped, rollbackEpoch))
}

async function executeServerBackedSettingsPatch(
  input: PatchServerBackedSettingsInput,
  grouped: Array<[SettingsGroup, SettingsPatch]>,
  rollbackEpoch: number,
): Promise<ServerCommandResult> {
  let lastResult: ServerCommandResult = { status: 'unavailable' }
  for (const [group, patch] of grouped) {
    const baseRevision = await getServerCommandBaseRevision(input.signal, input.keepalive)
    if (baseRevision === null) {
      runRollbackUnlessDestructiveRefreshChanged(input.rollback, rollbackEpoch)
      return { status: 'error', error: 'Unable to read server command revision' }
    }

    const result = await patchSettingsGroup({ group, baseRevision, patch }, input.signal, input.keepalive)

    if (result.status !== 'ok') {
      runRollbackUnlessDestructiveRefreshChanged(input.rollback, rollbackEpoch)
      return result
    }
    lastResult = result
  }

  return lastResult
}

export async function createPresetCommand(
  input: CreatePresetCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ presetId: string }>> {
  return requestCommandJson('/presets', {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      preset: input.preset,
    },
    signal,
  })
}

export async function updatePresetCommand(
  input: UpdatePresetCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ presetId: string }>> {
  return requestCommandJson(`/presets/${encodeURIComponent(input.presetId)}`, {
    method: 'PATCH',
    body: {
      baseRevision: input.baseRevision,
      patch: input.patch,
    },
    signal,
    readLocalEffect: (body, event) =>
      readLegacyPresetPatchLocalEffect(body, event, {
        presetId: input.presetId,
        attemptedPatch: input.patch,
        acknowledgement: input.optimisticAcknowledgement,
      }),
  })
}

export async function deletePresetCommand(
  input: DeletePresetCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ presetId: string; selectedPresetId: string | null }>> {
  return requestCommandJson(`/presets/${encodeURIComponent(input.presetId)}`, {
    method: 'DELETE',
    body: {
      baseRevision: input.baseRevision,
      presetId: input.selectPresetId,
      apply: input.apply,
      saveCurrent: input.saveCurrent,
    },
    signal,
  })
}

export async function copyPresetCommand(
  input: CopyPresetCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ presetId: string; sourcePresetId: string }>> {
  return requestCommandJson(`/presets/${encodeURIComponent(input.presetId)}/copy`, {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      newPresetId: input.newPresetId,
      name: input.name,
      saveCurrent: input.saveCurrent,
    },
    signal,
  })
}

export async function selectPresetCommand(
  input: SelectPresetCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ presetId: string }>> {
  return requestCommandJson('/presets/select', {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      presetId: input.presetId,
      apply: input.apply,
      saveCurrent: input.saveCurrent,
    },
    signal,
  })
}

export async function importPresetCommand(
  input: ImportPresetCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ presetId: string }>> {
  return requestCommandJson('/presets/import', {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      preset: input.preset,
    },
    signal,
  })
}

export async function reorderPresetsCommand(
  input: ReorderPresetsCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ selectedPresetId: string | null }>> {
  return requestCommandJson('/presets/reorder', {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      presetIds: input.presetIds,
    },
    signal,
  })
}

export async function createModelPresetCommand(
  input: CreateModelPresetCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ modelPresetId: string }>> {
  return requestCommandJson('/model-presets', {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      preset: input.preset,
    },
    signal,
  })
}

export async function updateModelPresetCommand(
  input: UpdateModelPresetCommandInput,
  signal?: AbortSignal | null,
  keepalive = false,
): Promise<ServerCommandResult<{ modelPresetId: string }>> {
  return requestCommandJson(`/model-presets/${encodeURIComponent(input.modelPresetId)}`, {
    method: 'PATCH',
    body: {
      baseRevision: input.baseRevision,
      patch: input.patch,
    },
    signal,
    keepalive,
    readLocalEffect: (body, event) =>
      readSplitPresetPatchLocalEffect(body, event, {
        presetKind: 'model',
        presetId: input.modelPresetId,
        attemptedPatch: input.patch,
        acknowledgement: input.optimisticAcknowledgement,
      }),
  })
}

export async function deleteModelPresetCommand(
  input: DeleteModelPresetCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ modelPresetId: string; selectedModelPresetId: string | null }>> {
  return requestCommandJson(`/model-presets/${encodeURIComponent(input.modelPresetId)}`, {
    method: 'DELETE',
    body: {
      baseRevision: input.baseRevision,
      modelPresetId: input.selectModelPresetId,
    },
    signal,
  })
}

export async function selectModelPresetCommand(
  input: SelectModelPresetCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ modelPresetId: string }>> {
  return requestCommandJson('/model-presets/select', {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      modelPresetId: input.modelPresetId,
    },
    signal,
  })
}

export async function importModelPresetCommand(
  input: ImportModelPresetCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ modelPresetId: string }>> {
  return requestCommandJson('/model-presets/import', {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      preset: input.preset,
    },
    signal,
  })
}

export async function reorderModelPresetsCommand(
  input: ReorderModelPresetsCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ selectedModelPresetId: string | null }>> {
  return requestCommandJson('/model-presets/reorder', {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      modelPresetIds: input.modelPresetIds,
    },
    signal,
  })
}

export async function createPromptPresetCommand(
  input: CreatePromptPresetCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ promptPresetId: string }>> {
  return requestCommandJson('/prompt-presets', {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      preset: input.preset,
    },
    signal,
  })
}

export async function updatePromptPresetCommand(
  input: UpdatePromptPresetCommandInput,
  signal?: AbortSignal | null,
  keepalive = false,
): Promise<ServerCommandResult<{ promptPresetId: string }>> {
  return requestCommandJson(`/prompt-presets/${encodeURIComponent(input.promptPresetId)}`, {
    method: 'PATCH',
    body: {
      baseRevision: input.baseRevision,
      patch: input.patch,
    },
    signal,
    keepalive,
    readLocalEffect: (body, event) =>
      readSplitPresetPatchLocalEffect(body, event, {
        presetKind: 'prompt',
        presetId: input.promptPresetId,
        attemptedPatch: input.patch,
        acknowledgement: input.optimisticAcknowledgement,
      }),
  })
}

export async function deletePromptPresetCommand(
  input: DeletePromptPresetCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ promptPresetId: string; selectedPromptPresetId: string | null }>> {
  return requestCommandJson(`/prompt-presets/${encodeURIComponent(input.promptPresetId)}`, {
    method: 'DELETE',
    body: {
      baseRevision: input.baseRevision,
      promptPresetId: input.selectPromptPresetId,
    },
    signal,
  })
}

export async function selectPromptPresetCommand(
  input: SelectPromptPresetCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ promptPresetId: string }>> {
  return requestCommandJson('/prompt-presets/select', {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      promptPresetId: input.promptPresetId,
    },
    signal,
  })
}

export async function importPromptPresetCommand(
  input: ImportPromptPresetCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ promptPresetId: string }>> {
  return requestCommandJson('/prompt-presets/import', {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      preset: input.preset,
    },
    signal,
  })
}

export async function reorderPromptPresetsCommand(
  input: ReorderPromptPresetsCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ selectedPromptPresetId: string | null }>> {
  return requestCommandJson('/prompt-presets/reorder', {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      promptPresetIds: input.promptPresetIds,
    },
    signal,
  })
}

export async function createAgentPresetCommand(
  input: CreateAgentPresetCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ presetId: string }>> {
  return requestCommandJson('/agent-presets', {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      preset: input.preset,
    },
    signal,
  })
}

export async function updateAgentPresetCommand(
  input: UpdateAgentPresetCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ presetId: string }>> {
  return requestCommandJson(`/agent-presets/${encodeURIComponent(input.presetId)}`, {
    method: 'PATCH',
    body: {
      baseRevision: input.baseRevision,
      patch: input.patch,
    },
    signal,
    readLocalEffect: input.optimisticAcknowledgement
      ? (body, event) =>
          readAgentPresetPatchLocalEffect(body, event, {
            kind: 'preset',
            presetId: input.presetId,
            attemptedPatch: input.patch,
            acknowledgement: input.optimisticAcknowledgement!,
          })
      : undefined,
  })
}

export async function duplicateAgentPresetCommand(
  input: DuplicateAgentPresetCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ presetId: string; sourcePresetId: string }>> {
  return requestCommandJson(`/agent-presets/${encodeURIComponent(input.presetId)}/duplicate`, {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      name: input.name,
    },
    signal,
  })
}

export async function deleteAgentPresetCommand(
  input: DeleteAgentPresetCommandInput,
  signal?: AbortSignal | null,
): Promise<
  ServerCommandResult<{
    presetId: string
    clearedDefault: boolean
    clearedChatCount: number
    clearedLoadoutCount: number
  }>
> {
  return requestCommandJson(`/agent-presets/${encodeURIComponent(input.presetId)}`, {
    method: 'DELETE',
    body: {
      baseRevision: input.baseRevision,
    },
    signal,
  })
}

export async function reorderAgentPresetsCommand(
  input: ReorderAgentPresetsCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ agentPresetDefaultId: string | null }>> {
  return requestCommandJson('/agent-presets/reorder', {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      presetIds: input.presetIds,
    },
    signal,
  })
}

export async function setAgentPresetDefaultCommand(
  input: SetAgentPresetDefaultCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ agentPresetDefaultId: string | null }>> {
  return requestCommandJson('/agent-presets/default', {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      agentPresetId: input.agentPresetId,
    },
    signal,
  })
}

export async function createAgentPresetStepCommand(
  input: CreateAgentPresetStepCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ presetId: string; stepId: string }>> {
  return requestCommandJson(`/agent-presets/${encodeURIComponent(input.presetId)}/steps`, {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      step: input.step,
    },
    signal,
  })
}

export async function updateAgentPresetStepCommand(
  input: UpdateAgentPresetStepCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ presetId: string; stepId: string }>> {
  return requestCommandJson(
    `/agent-presets/${encodeURIComponent(input.presetId)}/steps/${encodeURIComponent(input.stepId)}`,
    {
      method: 'PATCH',
      body: {
        baseRevision: input.baseRevision,
        patch: input.patch,
      },
      signal,
      readLocalEffect: input.optimisticAcknowledgement
        ? (body, event) =>
            readAgentPresetPatchLocalEffect(body, event, {
              kind: 'step',
              presetId: input.presetId,
              stepId: input.stepId,
              attemptedPatch: input.patch,
              acknowledgement: input.optimisticAcknowledgement!,
            })
        : undefined,
    },
  )
}

export async function duplicateAgentPresetStepCommand(
  input: DuplicateAgentPresetStepCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ presetId: string; stepId: string; sourceStepId: string }>> {
  return requestCommandJson(
    `/agent-presets/${encodeURIComponent(input.presetId)}/steps/${encodeURIComponent(input.stepId)}/duplicate`,
    {
      method: 'POST',
      body: {
        baseRevision: input.baseRevision,
        name: input.name,
      },
      signal,
    },
  )
}

export async function deleteAgentPresetStepCommand(
  input: DeleteAgentPresetStepCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ presetId: string; stepId: string }>> {
  return requestCommandJson(
    `/agent-presets/${encodeURIComponent(input.presetId)}/steps/${encodeURIComponent(input.stepId)}`,
    {
      method: 'DELETE',
      body: {
        baseRevision: input.baseRevision,
      },
      signal,
    },
  )
}

export async function reorderAgentPresetStepsCommand(
  input: ReorderAgentPresetStepsCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ presetId: string }>> {
  return requestCommandJson(`/agent-presets/${encodeURIComponent(input.presetId)}/steps/reorder`, {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      stepIds: input.stepIds,
    },
    signal,
  })
}

export async function createModelProfileCommand(
  input: CreateModelProfileCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ profileId: string }>> {
  return requestCommandJson('/model-profiles', {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      profile: input.profile,
    },
    signal,
  })
}

export async function updateModelProfileCommand(
  input: UpdateModelProfileCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ profileId: string }>> {
  return requestCommandJson(`/model-profiles/${encodeURIComponent(input.profileId)}`, {
    method: 'PATCH',
    body: {
      baseRevision: input.baseRevision,
      profile: input.profile,
    },
    signal,
  })
}

export async function duplicateModelProfileCommand(
  input: DuplicateModelProfileCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ profileId: string; sourceProfileId: string }>> {
  return requestCommandJson(`/model-profiles/${encodeURIComponent(input.profileId)}/duplicate`, {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      name: input.name,
      includeSecrets: input.includeSecrets,
    },
    signal,
  })
}

export async function deleteModelProfileCommand(
  input: DeleteModelProfileCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ profileId: string; reassignedRoles: ModelRole[] }>> {
  return requestCommandJson(`/model-profiles/${encodeURIComponent(input.profileId)}`, {
    method: 'DELETE',
    body: {
      baseRevision: input.baseRevision,
      reassignments: input.reassignments,
    },
    signal,
  })
}

export async function updateModelRoleProfilesCommand(
  input: UpdateModelRoleProfilesCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ roles: ModelRole[] }>> {
  return requestCommandJson('/model-role-profiles', {
    method: 'PUT',
    body: {
      baseRevision: input.baseRevision,
      bindings: input.bindings,
    },
    signal,
  })
}

export async function createAndBindModelProfileCommand(
  input: CreateAndBindModelProfileCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ profileId: string; role: ModelRole }>> {
  return requestCommandJson('/model-profiles/create-and-bind', {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      role: input.role,
      profile: input.profile,
    },
    signal,
  })
}

export async function updateModelRuntimeDefaultsCommand(
  input: UpdateModelRuntimeDefaultsCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult> {
  return requestCommandJson('/model-runtime-defaults', {
    method: 'PUT',
    body: {
      baseRevision: input.baseRevision,
      runtimeDefaults: input.runtimeDefaults,
    },
    signal,
  })
}

export async function convertLegacyModelProfilesCommand(
  input: ConvertLegacyModelProfilesCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ profileIdsByRole: Record<ModelRole, string>; convertedRoles: ModelRole[] }>> {
  return requestCommandJson('/model-profiles/convert-legacy', {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
    },
    signal,
  })
}

export async function extractLegacyBotPresetCommand(
  input: ExtractLegacyBotPresetCommandInput,
  signal?: AbortSignal | null,
): Promise<
  ServerCommandResult<{
    legacyPresetId: string
    modelPresetId?: string
    promptPresetId?: string
    reusedModelPreset?: boolean
  }>
> {
  return requestCommandJson(`/legacy-bot-presets/${encodeURIComponent(input.presetId)}/extract`, {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      mode: input.mode,
    },
    signal,
  })
}

export async function patchPromptSettingsCommand(
  input: PatchPromptSettingsCommandInput,
  signal?: AbortSignal | null,
  keepalive = false,
): Promise<ServerCommandResult> {
  return patchSettingsGroup(
    {
      group: 'prompt',
      baseRevision: input.baseRevision,
      patch: input.patch,
      acknowledgeOptimistic: input.acknowledgeOptimistic === true,
      optimisticProjectionEpoch: input.optimisticProjectionEpoch,
    },
    signal,
    keepalive,
  )
}

export async function createPromptItemCommand(
  input: CreatePromptItemCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ itemId: string }>> {
  return requestCommandJson('/prompt-items', {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      ...(input.promptPresetId ? { promptPresetId: input.promptPresetId } : {}),
      promptItem: input.promptItem,
    },
    signal,
    readLocalEffect: (body, event) =>
      readPromptItemMutationLocalEffect(body, event, {
        operation: 'create',
        promptPresetId: input.promptPresetId,
        itemId: input.promptItem.id,
        promptItem: input.promptItem,
        acknowledgement: input.optimisticAcknowledgement,
      }),
  })
}

export async function updatePromptItemCommand(
  input: UpdatePromptItemCommandInput,
  signal?: AbortSignal | null,
  keepalive = false,
): Promise<ServerCommandResult<{ itemId: string }>> {
  return requestCommandJson(`/prompt-items/${encodeURIComponent(input.itemId)}`, {
    method: 'PATCH',
    body: {
      baseRevision: input.baseRevision,
      ...(input.promptPresetId ? { promptPresetId: input.promptPresetId } : {}),
      patch: input.patch,
      ...(input.deleteKeys?.length ? { deleteKeys: input.deleteKeys } : {}),
    },
    signal,
    keepalive,
    readLocalEffect: (body, event) =>
      readPromptItemMutationLocalEffect(body, event, {
        operation: 'update',
        promptPresetId: input.promptPresetId,
        itemId: input.itemId,
        patch: input.patch,
        deleteKeys: input.deleteKeys,
        acknowledgement: input.optimisticAcknowledgement,
      }),
  })
}

export async function deletePromptItemCommand(
  input: DeletePromptItemCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ itemId: string }>> {
  return requestCommandJson(`/prompt-items/${encodeURIComponent(input.itemId)}`, {
    method: 'DELETE',
    body: {
      baseRevision: input.baseRevision,
      ...(input.promptPresetId ? { promptPresetId: input.promptPresetId } : {}),
    },
    signal,
    readLocalEffect: (body, event) =>
      readPromptItemMutationLocalEffect(body, event, {
        operation: 'delete',
        promptPresetId: input.promptPresetId,
        itemId: input.itemId,
        acknowledgement: input.optimisticAcknowledgement,
      }),
  })
}

export async function reorderPromptItemsCommand(
  input: ReorderPromptItemsCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult> {
  return requestCommandJson('/prompt-items/reorder', {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      ...(input.promptPresetId ? { promptPresetId: input.promptPresetId } : {}),
      itemIds: input.itemIds,
    },
    signal,
    readLocalEffect: (body, event) =>
      readPromptItemMutationLocalEffect(body, event, {
        operation: 'reorder',
        promptPresetId: input.promptPresetId,
        itemIds: input.itemIds,
        acknowledgement: input.optimisticAcknowledgement,
      }),
  })
}

export async function enablePromptItemsCommand(
  input: EnablePromptItemsCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ enabled: boolean }>> {
  return requestCommandJson('/prompt-items/enable', {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      ...(input.promptPresetId ? { promptPresetId: input.promptPresetId } : {}),
      enabled: input.enabled,
    },
    signal,
    readLocalEffect: (body, event) =>
      readPromptItemMutationLocalEffect(body, event, {
        operation: 'enable',
        promptPresetId: input.promptPresetId,
        enabled: input.enabled,
        acknowledgement: input.optimisticAcknowledgement,
      }),
  })
}

export async function createPersonaCommand(
  input: CreatePersonaCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ personaId: string }>> {
  return requestCommandJson('/personas', {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      persona: input.persona,
      mirrorLegacyProfile: input.mirrorLegacyProfile,
    },
    signal,
  })
}

export async function updatePersonaCommand(
  input: UpdatePersonaCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ personaId: string }>> {
  return requestCommandJson(`/personas/${encodeURIComponent(input.personaId)}`, {
    method: 'PATCH',
    body: {
      baseRevision: input.baseRevision,
      patch: input.patch,
      mirrorLegacyProfile: input.mirrorLegacyProfile,
    },
    signal,
    readLocalEffect: (body, event) =>
      readPersonaPatchLocalEffect(body, event, {
        personaId: input.personaId,
        attemptedPatch: input.patch,
        mirrorLegacyProfile: input.mirrorLegacyProfile === true,
        acknowledgement: input.optimisticAcknowledgement,
      }),
  })
}

export async function deletePersonaCommand(
  input: DeletePersonaCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ personaId: string; selectedPersonaId: string | null }>> {
  return requestCommandJson(`/personas/${encodeURIComponent(input.personaId)}`, {
    method: 'DELETE',
    body: {
      baseRevision: input.baseRevision,
      selectPersonaId: input.selectPersonaId,
      mirrorLegacyProfile: input.mirrorLegacyProfile,
      saveCurrent: input.saveCurrent,
    },
    signal,
  })
}

export async function selectPersonaCommand(
  input: SelectPersonaCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ personaId: string }>> {
  return requestCommandJson('/personas/select', {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      personaId: input.personaId,
      mirrorLegacyProfile: input.mirrorLegacyProfile,
      saveCurrent: input.saveCurrent,
    },
    signal,
  })
}

export async function reorderPersonasCommand(
  input: ReorderPersonasCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ selectedPersonaId: string | null }>> {
  return requestCommandJson('/personas/reorder', {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      personaIds: input.personaIds,
    },
    signal,
  })
}

export async function createTranslatorPresetCommand(
  input: CreateTranslatorPresetCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ presetId: string }>> {
  return requestCommandJson('/translator-presets', {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      preset: input.preset,
      select: input.select,
    },
    signal,
  })
}

export async function updateTranslatorPresetCommand(
  input: UpdateTranslatorPresetCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ presetId: string; acknowledgedKeys: string[]; selectedPresetId: string | null }>> {
  return requestCommandJson(`/translator-presets/${encodeURIComponent(input.presetId)}`, {
    method: 'PATCH',
    body: {
      baseRevision: input.baseRevision,
      patch: input.patch,
    },
    signal,
    readLocalEffect: input.optimisticAcknowledgement
      ? (body, event) =>
          readTranslatorPresetPatchLocalEffect(body, event, {
            presetId: input.presetId,
            attemptedPatch: input.patch,
            acknowledgement: input.optimisticAcknowledgement,
          })
      : undefined,
  })
}

export async function deleteTranslatorPresetCommand(
  input: DeleteTranslatorPresetCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ presetId: string; selectedPresetId: string | null }>> {
  return requestCommandJson(`/translator-presets/${encodeURIComponent(input.presetId)}`, {
    method: 'DELETE',
    body: {
      baseRevision: input.baseRevision,
      selectPresetId: input.selectPresetId,
    },
    signal,
  })
}

export async function selectTranslatorPresetCommand(
  input: SelectTranslatorPresetCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ presetId: string }>> {
  return requestCommandJson('/translator-presets/select', {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      presetId: input.presetId,
    },
    signal,
  })
}

export async function createLoadoutCommand(
  input: CreateLoadoutCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ loadoutId: string }>> {
  return requestCommandJson('/loadouts', {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      loadout: input.loadout,
    },
    signal,
    readLocalEffect: input.acknowledgeOptimistic
      ? (body, event) =>
          readLoadoutMutationLocalEffect(body, event, {
            operation: 'create',
            expectedLoadoutId: input.loadout.id,
            expectedLoadout: input.loadout,
            loadoutsProjectionEpoch: input.loadoutsProjectionEpoch,
          })
      : undefined,
  })
}

export async function updateLoadoutCommand(
  input: UpdateLoadoutCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ loadoutId: string }>> {
  return requestCommandJson(`/loadouts/${encodeURIComponent(input.loadoutId)}`, {
    method: 'PATCH',
    body: {
      baseRevision: input.baseRevision,
      patch: input.patch,
    },
    signal,
  })
}

export async function deleteLoadoutCommand(
  input: DeleteLoadoutCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ loadoutId: string }>> {
  return requestCommandJson(`/loadouts/${encodeURIComponent(input.loadoutId)}`, {
    method: 'DELETE',
    body: {
      baseRevision: input.baseRevision,
    },
    signal,
    readLocalEffect: input.acknowledgeOptimistic
      ? (body, event) =>
          readLoadoutMutationLocalEffect(body, event, {
            operation: 'delete',
            expectedLoadoutId: input.loadoutId,
            loadoutsProjectionEpoch: input.loadoutsProjectionEpoch,
          })
      : undefined,
  })
}

export async function favoriteLoadoutCommand(
  input: FavoriteLoadoutCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ loadoutId: string }>> {
  return requestCommandJson(`/loadouts/${encodeURIComponent(input.loadoutId)}/favorite`, {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      favorite: input.favorite,
    },
    signal,
    readLocalEffect: input.acknowledgeOptimistic
      ? (body, event) =>
          readLoadoutMutationLocalEffect(body, event, {
            operation: 'favorite',
            expectedLoadoutId: input.loadoutId,
            expectedFavorite: input.favorite,
            loadoutsProjectionEpoch: input.loadoutsProjectionEpoch,
          })
      : undefined,
  })
}

export async function touchLoadoutCommand(
  input: TouchLoadoutCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ loadoutId: string }>> {
  return requestCommandJson(`/loadouts/${encodeURIComponent(input.loadoutId)}/touch`, {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      lastUsed: input.lastUsed,
      characterId: input.characterId,
    },
    signal,
    readLocalEffect: input.acknowledgeOptimistic
      ? (body, event) =>
          readLoadoutMutationLocalEffect(body, event, {
            operation: 'touch',
            expectedLoadoutId: input.loadoutId,
            expectedLastUsed: input.lastUsed,
            expectedCharacterId: input.characterId,
            loadoutsProjectionEpoch: input.loadoutsProjectionEpoch,
            settingsProjectionEpoch: input.settingsProjectionEpoch,
            loadedName: input.loadedName,
          })
      : undefined,
  })
}

export async function createCharacterCommand(
  input: CreateCharacterCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ characterId: string; selectedCharacterId: string | null }>> {
  return requestCommandJson('/characters', {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      character: characterCreatePayload(input.character),
    },
    signal,
    readLocalEffect: (body, event) =>
      readCharacterCollectionMutationLocalEffect(body, event, 'create', input.character.chaId),
  })
}

export async function createAndSelectCharacterCommand(
  input: CreateAndSelectCharacterCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ characterId: string; selectedCharacterId: string | null }>> {
  return requestCommandJson('/characters/create-and-select', {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      character: characterCreatePayload(input.character),
      lastInteraction: input.lastInteraction,
    },
    signal,
    readLocalEffect: (body, event) =>
      readCharacterCollectionMutationLocalEffect(body, event, 'createAndSelect', input.character.chaId),
  })
}

function characterCreatePayload(character: CharacterSnapshot): CharacterSnapshot {
  const payload = { ...character }
  delete payload.chats
  return payload
}

export async function updateCharacterCommand(
  input: UpdateCharacterCommandInput,
  signal?: AbortSignal | null,
  keepalive = false,
): Promise<ServerCommandResult<{ characterId: string }>> {
  return requestCommandJson(`/characters/${encodeURIComponent(input.characterId)}`, {
    method: 'PATCH',
    body: {
      baseRevision: input.baseRevision,
      patch: input.patch,
    },
    signal,
    keepalive,
    readLocalEffect: (body, event) => readCharacterPatchLocalEffect(body, event, input.characterId, input.patch),
  })
}

export async function deleteCharacterCommand(
  input: DeleteCharacterCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ characterId: string; selectedCharacterId: string | null }>> {
  return requestCommandJson(`/characters/${encodeURIComponent(input.characterId)}`, {
    method: 'DELETE',
    body: {
      baseRevision: input.baseRevision,
    },
    signal,
    readLocalEffect: (body, event) =>
      readCharacterCollectionMutationLocalEffect(body, event, 'delete', input.characterId),
  })
}

export async function selectCharacterCommand(
  input: SelectCharacterCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ characterId: string }>> {
  return requestCommandJson('/characters/select', {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      characterId: input.characterId,
      lastInteraction: input.lastInteraction,
    },
    signal,
    readLocalEffect: (body, event) =>
      readCharacterSelectionLocalEffect(body, event, input.characterId, input.lastInteraction),
  })
}

export async function reorderCharactersCommand(
  input: ReorderCharactersCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ selectedCharacterId: string | null }>> {
  return requestCommandJson('/characters/reorder', {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      characterOrder: input.characterOrder,
    },
    signal,
    readLocalEffect: (_body, event) => readCharacterOrderLocalEffect(event, input.characterOrder),
  })
}

export async function createChatCommand(
  input: CreateChatCommandInput,
  signal?: AbortSignal | null,
): Promise<
  ServerCommandResult<{
    chatId: string
    selectedChatId: string | null
    generationSettings: ChatGenerationSettings | null
  }>
> {
  return requestCommandJson(`/characters/${encodeURIComponent(input.characterId)}/chats`, {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      chat: input.chat,
      select: input.select,
    },
    signal,
    readLocalEffect:
      input.acknowledgeOptimistic && isCanonicalOptimisticChatSnapshot(input.chat)
        ? (body, event) =>
            readChatStructureMutationLocalEffect(body, event, {
              operation: 'create',
              expectedCharacterId: input.characterId,
              expectedTargetId: input.chat.id,
              expectedChat: input.chat,
              expectedOptimisticEpoch: input.optimisticEpoch,
              expectedOptimisticRowEpoch: input.optimisticRowEpoch,
            })
        : undefined,
  })
}

export async function updateChatCommand(
  input: UpdateChatCommandInput,
  signal?: AbortSignal | null,
  keepalive = false,
): Promise<ServerCommandResult<{ chatId: string; selectedChatId: string | null }>> {
  return requestCommandJson(`/chats/${encodeURIComponent(input.chatId)}`, {
    method: 'PATCH',
    body: {
      baseRevision: input.baseRevision,
      patch: input.patch,
      select: input.select,
    },
    signal,
    keepalive,
    readLocalEffect: (body, event) => readChatPatchLocalEffect(body, event, input),
  })
}

export async function saveChatGenerationSettingsCommand(
  input: SaveChatGenerationSettingsCommandInput,
  signal?: AbortSignal | null,
  keepalive = false,
): Promise<
  ServerCommandResult<{
    chatId: string
    characterId: string
    generationSettings: ChatGenerationSettings
  }>
> {
  return requestCommandJson(`/chats/${encodeURIComponent(input.chatId)}/generation-settings`, {
    method: 'PUT',
    body: {
      baseRevision: input.baseRevision,
      generationSettings: input.generationSettings,
    },
    signal,
    keepalive,
    readLocalEffect: (body) => readChatGenerationSettingsLocalEffect(body, input.generationSettings),
  })
}

export async function deleteChatCommand(
  input: DeleteChatCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ chatId: string; selectedChatId: string | null }>> {
  return requestCommandJson(`/chats/${encodeURIComponent(input.chatId)}`, {
    method: 'DELETE',
    body: {
      baseRevision: input.baseRevision,
    },
    signal,
    readLocalEffect: input.acknowledgeOptimistic
      ? (body, event) =>
          readChatStructureMutationLocalEffect(body, event, {
            operation: 'delete',
            expectedTargetId: input.chatId,
            expectedOptimisticEpoch: input.optimisticEpoch,
            expectedOptimisticRowEpoch: input.optimisticRowEpoch,
          })
      : undefined,
  })
}

export async function forkChatCommand(
  input: ForkChatCommandInput,
  signal?: AbortSignal | null,
): Promise<
  ServerCommandResult<{
    chatId: string
    sourceChatId: string
    selectedChatId: string | null
    generationSettings: ChatGenerationSettings | null
  }>
> {
  return requestCommandJson(`/chats/${encodeURIComponent(input.chatId)}/fork`, {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      chat: input.chat,
      sourcePatch: input.sourcePatch,
      folder: input.folder,
      select: input.select,
    },
    signal,
    readLocalEffect:
      input.acknowledgeOptimistic &&
      isCanonicalOptimisticChatSnapshot(input.chat) &&
      (input.folder === undefined || isCanonicalOptimisticChatFolderSnapshot(input.folder))
        ? (body, event) =>
            readChatStructureMutationLocalEffect(body, event, {
              operation: 'fork',
              expectedTargetId: input.chat.id,
              expectedSourceChatId: input.chatId,
              expectedChat: input.chat,
              expectedOptimisticEpoch: input.optimisticEpoch,
              expectedOptimisticRowEpoch: input.optimisticRowEpoch,
            })
        : undefined,
  })
}

export async function reorderChatsCommand(
  input: ReorderChatsCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ selectedChatId: string | null }>> {
  return requestCommandJson(`/characters/${encodeURIComponent(input.characterId)}/chats/reorder`, {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      chatIds: input.chatIds,
      folderByChatId: input.folderByChatId,
      selectedChatId: input.selectedChatId,
    },
    signal,
    readLocalEffect: input.acknowledgeOptimistic
      ? (body, event) =>
          readChatStructureMutationLocalEffect(body, event, {
            operation: 'reorder',
            expectedCharacterId: input.characterId,
            expectedIds: input.chatIds,
            expectedOptimisticEpoch: input.optimisticEpoch,
            expectedOptimisticRowEpoch: input.optimisticRowEpoch,
          })
      : undefined,
  })
}

export async function createChatFolderCommand(
  input: CreateChatFolderCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ folderId: string }>> {
  return requestCommandJson(`/characters/${encodeURIComponent(input.characterId)}/chat-folders`, {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      folder: input.folder,
    },
    signal,
    readLocalEffect:
      input.acknowledgeOptimistic && isCanonicalOptimisticChatFolderSnapshot(input.folder)
        ? (body, event) =>
            readChatStructureMutationLocalEffect(body, event, {
              operation: 'folderCreate',
              expectedCharacterId: input.characterId,
              expectedTargetId: input.folder.id,
              expectedOptimisticEpoch: input.optimisticEpoch,
              expectedOptimisticRowEpoch: input.optimisticRowEpoch,
            })
        : undefined,
  })
}

export async function updateChatFolderCommand(
  input: UpdateChatFolderCommandInput,
  signal?: AbortSignal | null,
  keepalive = false,
): Promise<ServerCommandResult<{ folderId: string }>> {
  return requestCommandJson(`/chat-folders/${encodeURIComponent(input.folderId)}`, {
    method: 'PATCH',
    body: {
      baseRevision: input.baseRevision,
      patch: input.patch,
    },
    signal,
    keepalive,
    readLocalEffect: (body, event) =>
      readCharacterRowMutationLocalEffect(body, event, 'chatFolderUpdate', input.folderId),
  })
}

export async function deleteChatFolderCommand(
  input: DeleteChatFolderCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ folderId: string }>> {
  return requestCommandJson(`/chat-folders/${encodeURIComponent(input.folderId)}`, {
    method: 'DELETE',
    body: {
      baseRevision: input.baseRevision,
    },
    signal,
    readLocalEffect: input.acknowledgeOptimistic
      ? (body, event) =>
          readChatStructureMutationLocalEffect(body, event, {
            operation: 'folderDelete',
            expectedTargetId: input.folderId,
            expectedOptimisticEpoch: input.optimisticEpoch,
            expectedOptimisticRowEpoch: input.optimisticRowEpoch,
          })
      : undefined,
  })
}

export async function reorderChatFoldersCommand(
  input: ReorderChatFoldersCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ selectedChatId: string | null }>> {
  return requestCommandJson(`/characters/${encodeURIComponent(input.characterId)}/chat-folders/reorder`, {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      folderIds: input.folderIds,
      selectedChatId: input.selectedChatId,
    },
    signal,
    readLocalEffect: input.acknowledgeOptimistic
      ? (body, event) =>
          readChatStructureMutationLocalEffect(body, event, {
            operation: 'folderReorder',
            expectedCharacterId: input.characterId,
            expectedIds: input.folderIds,
            expectedOptimisticEpoch: input.optimisticEpoch,
            expectedOptimisticRowEpoch: input.optimisticRowEpoch,
          })
      : undefined,
  })
}

export async function patchChatScriptstateCommand(
  input: PatchChatScriptstateCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ chatId: string }>> {
  return requestCommandJson(`/chats/${encodeURIComponent(input.chatId)}/scriptstate`, {
    method: 'PATCH',
    body: {
      baseRevision: input.baseRevision,
      patch: input.patch,
      deleteKeys: input.deleteKeys,
    },
    signal,
    readLocalEffect: (body, event) => readCharacterRowMutationLocalEffect(body, event, 'chatScriptstate', input.chatId),
  })
}

export async function createGlobalLorebookCommand(
  input: CreateGlobalLorebookCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ lorebookId: string }>> {
  return requestCommandJson('/lorebooks', {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      lorebook: input.lorebook,
    },
    signal,
    readLocalEffect: input.acknowledgeOptimistic
      ? (body, event) =>
          readGlobalLorebookMutationLocalEffect(body, event, {
            operation: 'create',
            expectedLorebook: input.lorebook,
            collectionProjectionEpoch: input.optimisticCollectionEpoch,
          })
      : undefined,
  })
}

export async function updateGlobalLorebookCommand(
  input: UpdateGlobalLorebookCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ lorebookId: string }>> {
  return requestCommandJson(`/lorebooks/${encodeURIComponent(input.lorebookId)}`, {
    method: 'PATCH',
    body: {
      baseRevision: input.baseRevision,
      patch: input.patch,
    },
    signal,
    readLocalEffect: input.acknowledgeOptimistic
      ? (body, event) =>
          readGlobalLorebookMutationLocalEffect(body, event, {
            operation: 'update',
            expectedLorebookId: input.lorebookId,
            expectedPatch: input.patch,
            collectionProjectionEpoch: input.optimisticCollectionEpoch,
          })
      : undefined,
  })
}

export async function deleteGlobalLorebookCommand(
  input: DeleteGlobalLorebookCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ lorebookId: string }>> {
  return requestCommandJson(`/lorebooks/${encodeURIComponent(input.lorebookId)}`, {
    method: 'DELETE',
    body: {
      baseRevision: input.baseRevision,
    },
    signal,
    readLocalEffect: input.acknowledgeOptimistic
      ? (body, event) =>
          readGlobalLorebookMutationLocalEffect(body, event, {
            operation: 'delete',
            expectedLorebookId: input.lorebookId,
            collectionProjectionEpoch: input.optimisticCollectionEpoch,
            pageProjectionEpoch: input.optimisticPageEpoch,
          })
      : undefined,
  })
}

export async function reorderGlobalLorebooksCommand(
  input: ReorderGlobalLorebooksCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ selectedLorebookId: string | null }>> {
  return requestCommandJson('/lorebooks/reorder', {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      lorebookIds: input.lorebookIds,
    },
    signal,
    readLocalEffect: input.acknowledgeOptimistic
      ? (body, event) =>
          readGlobalLorebookMutationLocalEffect(body, event, {
            operation: 'reorder',
            expectedLorebookIds: input.lorebookIds,
            expectedSelectedLorebookId: input.optimisticSelectedLorebookId,
            collectionProjectionEpoch: input.optimisticCollectionEpoch,
            pageProjectionEpoch: input.optimisticPageEpoch,
          })
      : undefined,
  })
}

export async function selectGlobalLorebookCommand(
  input: SelectGlobalLorebookCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ selectedLorebookId: string }>> {
  return requestCommandJson(`/lorebooks/${encodeURIComponent(input.lorebookId)}/select`, {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
    },
    signal,
    readLocalEffect: input.acknowledgeOptimistic
      ? (body, event) =>
          readGlobalLorebookMutationLocalEffect(body, event, {
            operation: 'select',
            expectedLorebookId: input.lorebookId,
            expectedSelectedLorebookId: input.lorebookId,
            pageProjectionEpoch: input.optimisticPageEpoch,
          })
      : undefined,
  })
}

export async function replaceGlobalLorebookEntriesCommand(
  input: ReplaceGlobalLorebookEntriesCommandInput,
  signal?: AbortSignal | null,
  keepalive = false,
): Promise<ServerCommandResult<{ lorebookId: string }>> {
  return requestCommandJson(`/lorebooks/${encodeURIComponent(input.lorebookId)}/entries`, {
    method: 'PUT',
    body: {
      baseRevision: input.baseRevision,
      entries: input.entries,
    },
    signal,
    keepalive,
    readLocalEffect: input.acknowledgeOptimistic
      ? (body, event) =>
          readLorebookMutationLocalEffect(body, event, {
            scope: 'global',
            operation: 'replace',
            expectedTargetId: input.lorebookId,
            expectedEntries: input.entries,
            optimisticEntries: input.optimisticEntries,
            collectionProjectionEpoch: input.optimisticCollectionEpoch,
          })
      : undefined,
  })
}

export async function upsertGlobalLorebookEntryCommand(
  input: UpsertGlobalLorebookEntryCommandInput,
  signal?: AbortSignal | null,
  keepalive = false,
): Promise<ServerCommandResult<{ lorebookId: string; entryId: string; entryIndex: number; created: boolean }>> {
  return requestCommandJson(
    `/lorebooks/${encodeURIComponent(input.lorebookId)}/entries/${encodeURIComponent(input.entryId)}`,
    {
      method: 'PUT',
      body: {
        baseRevision: input.baseRevision,
        entry: input.entry,
      },
      signal,
      keepalive,
      readLocalEffect: input.acknowledgeOptimistic
        ? (body, event) =>
            readLorebookMutationLocalEffect(body, event, {
              scope: 'global',
              operation: 'upsert',
              expectedTargetId: input.lorebookId,
              expectedEntryId: input.entryId,
              expectedEntry: input.entry,
              expectedEntryIndex: input.optimisticEntryIndex,
              expectedEntryCreated: input.optimisticEntryCreated,
              optimisticEntries: input.optimisticEntries,
              collectionProjectionEpoch: input.optimisticCollectionEpoch,
            })
        : undefined,
    },
  )
}

export async function deleteGlobalLorebookEntryCommand(
  input: DeleteGlobalLorebookEntryCommandInput,
  signal?: AbortSignal | null,
  keepalive = false,
): Promise<ServerCommandResult<{ lorebookId: string; entryId: string; entryIndex: number }>> {
  return requestCommandJson(
    `/lorebooks/${encodeURIComponent(input.lorebookId)}/entries/${encodeURIComponent(input.entryId)}`,
    {
      method: 'DELETE',
      body: {
        baseRevision: input.baseRevision,
      },
      signal,
      keepalive,
      readLocalEffect: input.acknowledgeOptimistic
        ? (body, event) =>
            readLorebookMutationLocalEffect(body, event, {
              scope: 'global',
              operation: 'delete',
              expectedTargetId: input.lorebookId,
              expectedEntryId: input.entryId,
              expectedEntryIndex: input.optimisticEntryIndex,
              optimisticEntries: input.optimisticEntries,
              collectionProjectionEpoch: input.optimisticCollectionEpoch,
            })
        : undefined,
    },
  )
}

export async function reorderGlobalLorebookEntriesCommand(
  input: ReorderGlobalLorebookEntriesCommandInput,
  signal?: AbortSignal | null,
  keepalive = false,
): Promise<ServerCommandResult<{ lorebookId: string }>> {
  return requestCommandJson(`/lorebooks/${encodeURIComponent(input.lorebookId)}/entries/reorder`, {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      entryIds: input.entryIds,
    },
    signal,
    keepalive,
    readLocalEffect: input.acknowledgeOptimistic
      ? (body, event) =>
          readLorebookMutationLocalEffect(body, event, {
            scope: 'global',
            operation: 'reorder',
            expectedTargetId: input.lorebookId,
            expectedEntryIds: input.entryIds,
            optimisticEntries: input.optimisticEntries,
            collectionProjectionEpoch: input.optimisticCollectionEpoch,
          })
      : undefined,
  })
}

export async function replaceCharacterLorebooksCommand(
  input: ReplaceCharacterLorebooksCommandInput,
  signal?: AbortSignal | null,
  keepalive = false,
): Promise<ServerCommandResult<{ characterId: string }>> {
  return requestCommandJson(`/characters/${encodeURIComponent(input.characterId)}/lorebooks`, {
    method: 'PUT',
    body: {
      baseRevision: input.baseRevision,
      entries: input.entries,
    },
    signal,
    keepalive,
    readLocalEffect: input.acknowledgeOptimistic
      ? (body, event) =>
          readLorebookMutationLocalEffect(body, event, {
            scope: 'character',
            operation: 'replace',
            expectedTargetId: input.characterId,
            expectedEntries: input.entries,
            optimisticEntries: input.optimisticEntries,
            characterRowProjectionEpoch: input.optimisticRowEpoch,
            characterLorebookProjectionEpoch: input.optimisticLorebookEpoch,
          })
      : undefined,
  })
}

export async function upsertCharacterLorebookEntryCommand(
  input: UpsertCharacterLorebookEntryCommandInput,
  signal?: AbortSignal | null,
  keepalive = false,
): Promise<ServerCommandResult<{ characterId: string; entryId: string; entryIndex: number; created: boolean }>> {
  return requestCommandJson(
    `/characters/${encodeURIComponent(input.characterId)}/lorebooks/entries/${encodeURIComponent(input.entryId)}`,
    {
      method: 'PUT',
      body: {
        baseRevision: input.baseRevision,
        entry: input.entry,
      },
      signal,
      keepalive,
      readLocalEffect: input.acknowledgeOptimistic
        ? (body, event) =>
            readLorebookMutationLocalEffect(body, event, {
              scope: 'character',
              operation: 'upsert',
              expectedTargetId: input.characterId,
              expectedEntryId: input.entryId,
              expectedEntry: input.entry,
              expectedEntryIndex: input.optimisticEntryIndex,
              expectedEntryCreated: input.optimisticEntryCreated,
              optimisticEntries: input.optimisticEntries,
              characterRowProjectionEpoch: input.optimisticRowEpoch,
              characterLorebookProjectionEpoch: input.optimisticLorebookEpoch,
            })
        : undefined,
    },
  )
}

export async function deleteCharacterLorebookEntryCommand(
  input: DeleteCharacterLorebookEntryCommandInput,
  signal?: AbortSignal | null,
  keepalive = false,
): Promise<ServerCommandResult<{ characterId: string; entryId: string; entryIndex: number }>> {
  return requestCommandJson(
    `/characters/${encodeURIComponent(input.characterId)}/lorebooks/entries/${encodeURIComponent(input.entryId)}`,
    {
      method: 'DELETE',
      body: {
        baseRevision: input.baseRevision,
      },
      signal,
      keepalive,
      readLocalEffect: input.acknowledgeOptimistic
        ? (body, event) =>
            readLorebookMutationLocalEffect(body, event, {
              scope: 'character',
              operation: 'delete',
              expectedTargetId: input.characterId,
              expectedEntryId: input.entryId,
              expectedEntryIndex: input.optimisticEntryIndex,
              optimisticEntries: input.optimisticEntries,
              characterRowProjectionEpoch: input.optimisticRowEpoch,
              characterLorebookProjectionEpoch: input.optimisticLorebookEpoch,
            })
        : undefined,
    },
  )
}

export async function reorderCharacterLorebookEntriesCommand(
  input: ReorderCharacterLorebookEntriesCommandInput,
  signal?: AbortSignal | null,
  keepalive = false,
): Promise<ServerCommandResult<{ characterId: string }>> {
  return requestCommandJson(`/characters/${encodeURIComponent(input.characterId)}/lorebooks/entries/reorder`, {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      entryIds: input.entryIds,
    },
    signal,
    keepalive,
    readLocalEffect: input.acknowledgeOptimistic
      ? (body, event) =>
          readLorebookMutationLocalEffect(body, event, {
            scope: 'character',
            operation: 'reorder',
            expectedTargetId: input.characterId,
            expectedEntryIds: input.entryIds,
            optimisticEntries: input.optimisticEntries,
            characterRowProjectionEpoch: input.optimisticRowEpoch,
            characterLorebookProjectionEpoch: input.optimisticLorebookEpoch,
          })
      : undefined,
  })
}

export async function replaceChatLorebooksCommand(
  input: ReplaceChatLorebooksCommandInput,
  signal?: AbortSignal | null,
  keepalive = false,
): Promise<ServerCommandResult<{ chatId: string }>> {
  return requestCommandJson(`/chats/${encodeURIComponent(input.chatId)}/lorebooks`, {
    method: 'PUT',
    body: {
      baseRevision: input.baseRevision,
      entries: input.entries,
    },
    signal,
    keepalive,
    readLocalEffect: input.acknowledgeOptimistic
      ? (body, event) =>
          readLorebookMutationLocalEffect(body, event, {
            scope: 'chat',
            operation: 'replace',
            expectedTargetId: input.chatId,
            expectedEntries: input.entries,
            optimisticEntries: input.optimisticEntries,
            expectedCharacterId: input.optimisticCharacterId,
            characterRowProjectionEpoch: input.optimisticRowEpoch,
          })
      : undefined,
  })
}

export async function upsertChatLorebookEntryCommand(
  input: UpsertChatLorebookEntryCommandInput,
  signal?: AbortSignal | null,
  keepalive = false,
): Promise<ServerCommandResult<{ chatId: string; entryId: string; entryIndex: number; created: boolean }>> {
  return requestCommandJson(
    `/chats/${encodeURIComponent(input.chatId)}/lorebooks/entries/${encodeURIComponent(input.entryId)}`,
    {
      method: 'PUT',
      body: {
        baseRevision: input.baseRevision,
        entry: input.entry,
      },
      signal,
      keepalive,
      readLocalEffect: input.acknowledgeOptimistic
        ? (body, event) =>
            readLorebookMutationLocalEffect(body, event, {
              scope: 'chat',
              operation: 'upsert',
              expectedTargetId: input.chatId,
              expectedEntryId: input.entryId,
              expectedEntry: input.entry,
              expectedEntryIndex: input.optimisticEntryIndex,
              expectedEntryCreated: input.optimisticEntryCreated,
              optimisticEntries: input.optimisticEntries,
              expectedCharacterId: input.optimisticCharacterId,
              characterRowProjectionEpoch: input.optimisticRowEpoch,
            })
        : undefined,
    },
  )
}

export async function deleteChatLorebookEntryCommand(
  input: DeleteChatLorebookEntryCommandInput,
  signal?: AbortSignal | null,
  keepalive = false,
): Promise<ServerCommandResult<{ chatId: string; entryId: string; entryIndex: number }>> {
  return requestCommandJson(
    `/chats/${encodeURIComponent(input.chatId)}/lorebooks/entries/${encodeURIComponent(input.entryId)}`,
    {
      method: 'DELETE',
      body: {
        baseRevision: input.baseRevision,
      },
      signal,
      keepalive,
      readLocalEffect: input.acknowledgeOptimistic
        ? (body, event) =>
            readLorebookMutationLocalEffect(body, event, {
              scope: 'chat',
              operation: 'delete',
              expectedTargetId: input.chatId,
              expectedEntryId: input.entryId,
              expectedEntryIndex: input.optimisticEntryIndex,
              optimisticEntries: input.optimisticEntries,
              expectedCharacterId: input.optimisticCharacterId,
              characterRowProjectionEpoch: input.optimisticRowEpoch,
            })
        : undefined,
    },
  )
}

export async function reorderChatLorebookEntriesCommand(
  input: ReorderChatLorebookEntriesCommandInput,
  signal?: AbortSignal | null,
  keepalive = false,
): Promise<ServerCommandResult<{ chatId: string }>> {
  return requestCommandJson(`/chats/${encodeURIComponent(input.chatId)}/lorebooks/entries/reorder`, {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      entryIds: input.entryIds,
    },
    signal,
    keepalive,
    readLocalEffect: input.acknowledgeOptimistic
      ? (body, event) =>
          readLorebookMutationLocalEffect(body, event, {
            scope: 'chat',
            operation: 'reorder',
            expectedTargetId: input.chatId,
            expectedEntryIds: input.entryIds,
            optimisticEntries: input.optimisticEntries,
            expectedCharacterId: input.optimisticCharacterId,
            characterRowProjectionEpoch: input.optimisticRowEpoch,
          })
      : undefined,
  })
}

export async function replaceModuleLorebooksCommand(
  input: ReplaceModuleLorebooksCommandInput,
  signal?: AbortSignal | null,
  keepalive = false,
  acknowledgeOptimistic = false,
): Promise<ServerCommandResult<{ moduleId: string }>> {
  return requestCommandJson(`/modules/${encodeURIComponent(input.moduleId)}/lorebooks`, {
    method: 'PUT',
    body: {
      baseRevision: input.baseRevision,
      entries: input.entries,
    },
    signal,
    keepalive,
    readLocalEffect: acknowledgeOptimistic
      ? (body, event) =>
          readModuleCollectionMutationLocalEffect(body, event, {
            operation: 'lorebooks',
            expectedModuleId: input.moduleId,
            hasCanonicalPayload: isCanonicalLorebookEntryArray(input.entries),
          })
      : undefined,
  })
}

export async function upsertModuleLorebookEntryCommand(
  input: UpsertModuleLorebookEntryCommandInput,
  signal?: AbortSignal | null,
  keepalive = false,
  acknowledgeOptimistic = false,
): Promise<ServerCommandResult<{ moduleId: string; entryId: string; entryIndex: number; created: boolean }>> {
  return requestCommandJson(
    `/modules/${encodeURIComponent(input.moduleId)}/lorebooks/entries/${encodeURIComponent(input.entryId)}`,
    {
      method: 'PUT',
      body: {
        baseRevision: input.baseRevision,
        entry: input.entry,
      },
      signal,
      keepalive,
      readLocalEffect: acknowledgeOptimistic
        ? (body, event) =>
            readModuleCollectionMutationLocalEffect(body, event, {
              operation: 'lorebooks',
              expectedModuleId: input.moduleId,
              expectedEntryId: input.entryId,
              entryResult: 'upsert',
              hasCanonicalPayload: isCanonicalLorebookEntry(input.entry),
            })
        : undefined,
    },
  )
}

export async function deleteModuleLorebookEntryCommand(
  input: DeleteModuleLorebookEntryCommandInput,
  signal?: AbortSignal | null,
  keepalive = false,
  acknowledgeOptimistic = false,
): Promise<ServerCommandResult<{ moduleId: string; entryId: string; entryIndex: number }>> {
  return requestCommandJson(
    `/modules/${encodeURIComponent(input.moduleId)}/lorebooks/entries/${encodeURIComponent(input.entryId)}`,
    {
      method: 'DELETE',
      body: {
        baseRevision: input.baseRevision,
      },
      signal,
      keepalive,
      readLocalEffect: acknowledgeOptimistic
        ? (body, event) =>
            readModuleCollectionMutationLocalEffect(body, event, {
              operation: 'lorebooks',
              expectedModuleId: input.moduleId,
              expectedEntryId: input.entryId,
              entryResult: 'delete',
            })
        : undefined,
    },
  )
}

export async function reorderModuleLorebookEntriesCommand(
  input: ReorderModuleLorebookEntriesCommandInput,
  signal?: AbortSignal | null,
  keepalive = false,
  acknowledgeOptimistic = false,
): Promise<ServerCommandResult<{ moduleId: string }>> {
  return requestCommandJson(`/modules/${encodeURIComponent(input.moduleId)}/lorebooks/entries/reorder`, {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      entryIds: input.entryIds,
    },
    signal,
    keepalive,
    readLocalEffect: acknowledgeOptimistic
      ? (body, event) =>
          readModuleCollectionMutationLocalEffect(body, event, {
            operation: 'lorebooks',
            expectedModuleId: input.moduleId,
            hasCanonicalPayload: isUniqueStringArray(input.entryIds),
          })
      : undefined,
  })
}

export async function replaceCharacterScriptsCommand(
  input: ReplaceCharacterScriptsCommandInput,
  signal?: AbortSignal | null,
  keepalive = false,
  acknowledgeOptimistic = false,
): Promise<ServerCommandResult<{ characterId: string }>> {
  return requestCommandJson(`/characters/${encodeURIComponent(input.characterId)}/scripts`, {
    method: 'PUT',
    body: {
      baseRevision: input.baseRevision,
      scripts: input.scripts,
    },
    signal,
    keepalive,
    readLocalEffect: acknowledgeOptimistic
      ? (body, event) =>
          readCharacterDefinitionMutationLocalEffect(body, event, {
            operation: 'scripts',
            expectedCharacterId: input.characterId,
            expectedDefinitions: input.scripts,
            optimisticRowEpoch: input.optimisticRowEpoch,
          })
      : undefined,
  })
}

export async function mutateCharacterScriptsCommand(
  input: MutateCharacterScriptsCommandInput,
  signal?: AbortSignal | null,
  keepalive = false,
  acknowledgeOptimistic = false,
): Promise<ServerCommandResult<{ characterId: string }>> {
  return requestCommandJson(`/characters/${encodeURIComponent(input.characterId)}/scripts`, {
    method: 'PATCH',
    body: {
      baseRevision: input.baseRevision,
      mutation: input.mutation,
    },
    signal,
    keepalive,
    readLocalEffect: acknowledgeOptimistic
      ? (body, event) =>
          readCharacterDefinitionMutationLocalEffect(body, event, {
            operation: 'scripts',
            expectedCharacterId: input.characterId,
            expectedDefinitions: input.expectedScripts,
            optimisticRowEpoch: input.optimisticRowEpoch,
          })
      : undefined,
  })
}

export async function replaceCharacterTriggersCommand(
  input: ReplaceCharacterTriggersCommandInput,
  signal?: AbortSignal | null,
  keepalive = false,
  acknowledgeOptimistic = false,
): Promise<ServerCommandResult<{ characterId: string }>> {
  return requestCommandJson(`/characters/${encodeURIComponent(input.characterId)}/triggers`, {
    method: 'PUT',
    body: {
      baseRevision: input.baseRevision,
      triggers: input.triggers,
    },
    signal,
    keepalive,
    readLocalEffect: acknowledgeOptimistic
      ? (body, event) =>
          readCharacterDefinitionMutationLocalEffect(body, event, {
            operation: 'triggers',
            expectedCharacterId: input.characterId,
            expectedDefinitions: input.triggers,
            optimisticRowEpoch: input.optimisticRowEpoch,
          })
      : undefined,
  })
}

export async function mutateCharacterTriggersCommand(
  input: MutateCharacterTriggersCommandInput,
  signal?: AbortSignal | null,
  keepalive = false,
  acknowledgeOptimistic = false,
): Promise<ServerCommandResult<{ characterId: string }>> {
  return requestCommandJson(`/characters/${encodeURIComponent(input.characterId)}/triggers`, {
    method: 'PATCH',
    body: {
      baseRevision: input.baseRevision,
      mutation: input.mutation,
    },
    signal,
    keepalive,
    readLocalEffect: acknowledgeOptimistic
      ? (body, event) =>
          readCharacterDefinitionMutationLocalEffect(body, event, {
            operation: 'triggers',
            expectedCharacterId: input.characterId,
            expectedDefinitions: input.expectedTriggers,
            optimisticRowEpoch: input.optimisticRowEpoch,
          })
      : undefined,
  })
}

export async function replaceModuleScriptsCommand(
  input: ReplaceModuleScriptsCommandInput,
  signal?: AbortSignal | null,
  keepalive = false,
  acknowledgeOptimistic = false,
): Promise<ServerCommandResult<{ moduleId: string }>> {
  return requestCommandJson(`/modules/${encodeURIComponent(input.moduleId)}/scripts`, {
    method: 'PUT',
    body: {
      baseRevision: input.baseRevision,
      scripts: input.scripts,
    },
    signal,
    keepalive,
    readLocalEffect: acknowledgeOptimistic
      ? (body, event) =>
          readModuleCollectionMutationLocalEffect(body, event, {
            operation: 'scripts',
            expectedModuleId: input.moduleId,
            hasCanonicalPayload: isUniqueDefinitionArray(input.scripts),
            collectionProjectionEpoch: input.optimisticCollectionEpoch,
          })
      : undefined,
  })
}

export async function mutateModuleScriptsCommand(
  input: MutateModuleScriptsCommandInput,
  signal?: AbortSignal | null,
  keepalive = false,
  acknowledgeOptimistic = false,
): Promise<ServerCommandResult<{ moduleId: string }>> {
  return requestCommandJson(`/modules/${encodeURIComponent(input.moduleId)}/scripts`, {
    method: 'PATCH',
    body: {
      baseRevision: input.baseRevision,
      mutation: input.mutation,
    },
    signal,
    keepalive,
    readLocalEffect: acknowledgeOptimistic
      ? (body, event) =>
          readModuleCollectionMutationLocalEffect(body, event, {
            operation: 'scripts',
            expectedModuleId: input.moduleId,
            hasCanonicalPayload: isUniqueDefinitionArray(input.expectedScripts),
            collectionProjectionEpoch: input.optimisticCollectionEpoch,
          })
      : undefined,
  })
}

export async function replaceModuleTriggersCommand(
  input: ReplaceModuleTriggersCommandInput,
  signal?: AbortSignal | null,
  keepalive = false,
  acknowledgeOptimistic = false,
): Promise<ServerCommandResult<{ moduleId: string }>> {
  return requestCommandJson(`/modules/${encodeURIComponent(input.moduleId)}/triggers`, {
    method: 'PUT',
    body: {
      baseRevision: input.baseRevision,
      triggers: input.triggers,
    },
    signal,
    keepalive,
    readLocalEffect: acknowledgeOptimistic
      ? (body, event) =>
          readModuleCollectionMutationLocalEffect(body, event, {
            operation: 'triggers',
            expectedModuleId: input.moduleId,
            hasCanonicalPayload: isUniqueDefinitionArray(input.triggers),
            collectionProjectionEpoch: input.optimisticCollectionEpoch,
          })
      : undefined,
  })
}

export async function mutateModuleTriggersCommand(
  input: MutateModuleTriggersCommandInput,
  signal?: AbortSignal | null,
  keepalive = false,
  acknowledgeOptimistic = false,
): Promise<ServerCommandResult<{ moduleId: string }>> {
  return requestCommandJson(`/modules/${encodeURIComponent(input.moduleId)}/triggers`, {
    method: 'PATCH',
    body: {
      baseRevision: input.baseRevision,
      mutation: input.mutation,
    },
    signal,
    keepalive,
    readLocalEffect: acknowledgeOptimistic
      ? (body, event) =>
          readModuleCollectionMutationLocalEffect(body, event, {
            operation: 'triggers',
            expectedModuleId: input.moduleId,
            hasCanonicalPayload: isUniqueDefinitionArray(input.expectedTriggers),
            collectionProjectionEpoch: input.optimisticCollectionEpoch,
          })
      : undefined,
  })
}

export async function createModuleCommand(
  input: CreateModuleCommandInput,
  signal?: AbortSignal | null,
  acknowledgeOptimistic = false,
): Promise<ServerCommandResult<{ moduleId: string }>> {
  return requestCommandJson('/modules', {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      module: input.module,
    },
    signal,
    readLocalEffect: acknowledgeOptimistic
      ? (body, event) =>
          readModuleCollectionMutationLocalEffect(body, event, {
            operation: 'create',
            expectedModuleId: input.module.id,
            hasCanonicalPayload: isCanonicalModuleCreate(input.module),
          })
      : undefined,
  })
}

export async function updateModuleCommand(
  input: UpdateModuleCommandInput,
  signal?: AbortSignal | null,
  acknowledgeOptimistic = false,
): Promise<ServerCommandResult<{ moduleId: string }>> {
  return requestCommandJson(`/modules/${encodeURIComponent(input.moduleId)}`, {
    method: 'PATCH',
    body: {
      baseRevision: input.baseRevision,
      patch: input.patch,
    },
    signal,
    readLocalEffect: acknowledgeOptimistic
      ? (body, event) =>
          readModuleCollectionMutationLocalEffect(body, event, {
            operation: 'update',
            expectedModuleId: input.moduleId,
            hasCanonicalPayload: Object.keys(input.patch).length > 0,
          })
      : undefined,
  })
}

export async function deleteModuleCommand(
  input: DeleteModuleCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ moduleId: string }>> {
  return requestCommandJson(`/modules/${encodeURIComponent(input.moduleId)}`, {
    method: 'DELETE',
    body: {
      baseRevision: input.baseRevision,
    },
    signal,
  })
}

export async function enableModuleCommand(
  input: EnableModuleCommandInput,
  signal?: AbortSignal | null,
  acknowledgeOptimistic = false,
): Promise<ServerCommandResult<{ moduleId: string; enabled: boolean }>> {
  return requestCommandJson('/modules/enable', {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      moduleId: input.moduleId,
      enabled: input.enabled,
    },
    signal,
    readLocalEffect: acknowledgeOptimistic
      ? (body, event) => readModuleEnabledLocalEffect(body, event, input.moduleId, input.enabled)
      : undefined,
  })
}

export async function reorderModulesCommand(
  input: ReorderModulesCommandInput,
  signal?: AbortSignal | null,
  acknowledgeOptimistic = false,
): Promise<ServerCommandResult> {
  return requestCommandJson('/modules/reorder', {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      moduleIds: input.moduleIds,
    },
    signal,
    readLocalEffect: acknowledgeOptimistic
      ? (body, event) =>
          readModuleCollectionMutationLocalEffect(body, event, {
            operation: 'reorder',
            expectedModuleIds: input.moduleIds,
          })
      : undefined,
  })
}

export async function reorderCharacterModulesCommand(
  input: ReorderCharacterModulesCommandInput,
  signal?: AbortSignal | null,
  acknowledgeOptimistic = false,
): Promise<ServerCommandResult<{ characterId: string }>> {
  return requestCommandJson(`/characters/${encodeURIComponent(input.characterId)}/modules/reorder`, {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      moduleIds: input.moduleIds,
    },
    signal,
    readLocalEffect: acknowledgeOptimistic
      ? (body, event) =>
          event.type === 'character.modules.reordered' && event.parentId === undefined
            ? readCharacterPatchLocalEffect(body, event, input.characterId, { modules: input.moduleIds })
            : undefined
      : undefined,
  })
}

export async function createPluginCommand(
  input: CreatePluginCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ pluginId: string }>> {
  return requestCommandJson('/plugins', {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      plugin: input.plugin,
    },
    signal,
    readLocalEffect: (body, event) =>
      readPluginCollectionMutationLocalEffect(body, event, {
        operation: 'create',
        expectedPluginId: input.plugin.name,
      }),
  })
}

export async function updatePluginCommand(
  input: UpdatePluginCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ pluginId: string }>> {
  return requestCommandJson(`/plugins/${encodeURIComponent(input.pluginId)}`, {
    method: 'PATCH',
    body: {
      baseRevision: input.baseRevision,
      patch: input.patch,
    },
    signal,
    readLocalEffect: (body, event) =>
      readPluginCollectionMutationLocalEffect(body, event, {
        operation: 'update',
        expectedPluginId: input.pluginId,
        hasMutation: Object.keys(input.patch).length > 0,
      }),
  })
}

export async function deletePluginCommand(
  input: DeletePluginCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ pluginId: string }>> {
  return requestCommandJson(`/plugins/${encodeURIComponent(input.pluginId)}`, {
    method: 'DELETE',
    body: {
      baseRevision: input.baseRevision,
    },
    signal,
    readLocalEffect: (body, event) =>
      readPluginCollectionMutationLocalEffect(body, event, {
        operation: 'delete',
        expectedPluginId: input.pluginId,
      }),
  })
}

export async function enablePluginCommand(
  input: EnablePluginCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ pluginId: string; enabled: boolean }>> {
  return requestCommandJson(`/plugins/${encodeURIComponent(input.pluginId)}/enable`, {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      enabled: input.enabled,
    },
    signal,
    readLocalEffect: (body, event) =>
      readPluginCollectionMutationLocalEffect(body, event, {
        operation: 'enable',
        expectedPluginId: input.pluginId,
        expectedEnabled: input.enabled,
      }),
  })
}

export async function selectPluginProviderCommand(
  input: SelectPluginProviderCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ provider: string }>> {
  return requestCommandJson('/plugins/provider', {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      provider: input.provider,
    },
    signal,
    readLocalEffect: (body, event) => readPluginProviderLocalEffect(body, event, input.provider),
  })
}

export async function reorderPluginsCommand(
  input: ReorderPluginsCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult> {
  return requestCommandJson('/plugins/reorder', {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      pluginIds: input.pluginIds,
    },
    signal,
    readLocalEffect: (body, event) =>
      readPluginCollectionMutationLocalEffect(body, event, {
        operation: 'reorder',
        expectedPluginIds: input.pluginIds,
      }),
  })
}

export async function putPluginStorageCommand(
  input: PutPluginStorageCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ key: string }>> {
  return requestCommandJson(`/plugin-storage/${encodeURIComponent(input.key)}`, {
    method: 'PUT',
    body: {
      baseRevision: input.baseRevision,
      value: input.value,
    },
    signal,
    readLocalEffect: (body, event) => readPluginStorageLocalEffect(body, event, 'put', input.key),
  })
}

export async function deletePluginStorageCommand(
  input: DeletePluginStorageCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ key: string }>> {
  return requestCommandJson(`/plugin-storage/${encodeURIComponent(input.key)}`, {
    method: 'DELETE',
    body: {
      baseRevision: input.baseRevision,
    },
    signal,
    readLocalEffect: (body, event) => readPluginStorageLocalEffect(body, event, 'delete', input.key),
  })
}

export async function bulkPluginStorageCommand(
  input: BulkPluginStorageCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult> {
  return requestCommandJson('/plugin-storage/bulk', {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      values: input.values ?? {},
      deleteKeys: input.deleteKeys ?? [],
      clear: input.clear ?? false,
    },
    signal,
    readLocalEffect: (body, event) => readPluginStorageLocalEffect(body, event, 'bulk'),
  })
}

export async function appendMessageCommand(
  input: AppendMessageCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ chatId: string; messageId: string }>> {
  return requestCommandJson(`/chats/${encodeURIComponent(input.chatId)}/messages`, {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      message: input.message,
    },
    signal,
    readLocalEffect: (body, event) =>
      readMessageMutationLocalEffect(body, event, {
        operation: 'append',
        expectedChatId: input.chatId,
        expectedMessageId: input.message.chatId,
      }),
  })
}

export async function updateMessageCommand(
  input: UpdateMessageCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ chatId: string; messageId: string }>> {
  return requestCommandJson(`/messages/${encodeURIComponent(input.messageId)}`, {
    method: 'PATCH',
    body: {
      baseRevision: input.baseRevision,
      patch: input.patch,
    },
    signal,
    readLocalEffect: (body, event) =>
      readMessageMutationLocalEffect(body, event, {
        operation: 'update',
        expectedMessageId: input.messageId,
      }),
  })
}

export async function translateMessageCommand(
  input: TranslateMessageCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ chatId: string; messageId: string; translation: MessageTranslation }>> {
  return requestCommandJson(`/messages/${encodeURIComponent(input.messageId)}/translate`, {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
    },
    signal,
    // Raw translation deliberately runs outside the global mutation queue;
    // reconcile its accepted response even if unrelated queued edits exist.
    reconcileImmediately: true,
    readLocalEffect: (body, event) => readMessageTranslationLocalEffect(body, event, input.messageId),
    deferOwnEventUntilResponse: (event) =>
      event.type === 'message.updated' && event.resource === 'message' && event.id === input.messageId,
  })
}

export async function deleteMessageCommand(
  input: DeleteMessageCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ chatId: string; messageId: string }>> {
  return requestCommandJson(`/messages/${encodeURIComponent(input.messageId)}`, {
    method: 'DELETE',
    body: {
      baseRevision: input.baseRevision,
    },
    signal,
    readLocalEffect: (body, event) =>
      readMessageMutationLocalEffect(body, event, {
        operation: 'delete',
        expectedMessageId: input.messageId,
      }),
  })
}

export async function truncateMessagesCommand(
  input: TruncateMessagesCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ chatId: string; afterMessageId: string | null; removedCount: number }>> {
  return requestCommandJson(`/chats/${encodeURIComponent(input.chatId)}/messages/truncate`, {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      afterMessageId: input.afterMessageId ?? null,
      ...(input.preserveRemovedAsAlternates ? { preserveRemovedAsAlternates: true } : {}),
    },
    signal,
    readLocalEffect: (body, event) =>
      readMessageMutationLocalEffect(body, event, {
        operation: 'truncate',
        expectedChatId: input.chatId,
        expectedAfterMessageId: input.afterMessageId ?? null,
      }),
  })
}

export async function replaceTailMessagesCommand(
  input: ReplaceTailMessagesCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ chatId: string; afterMessageId: string | null; replacedCount: number }>> {
  return requestCommandJson(`/chats/${encodeURIComponent(input.chatId)}/messages/tail`, {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      afterMessageId: input.afterMessageId ?? null,
      messages: input.messages,
    },
    signal,
    readLocalEffect: (body, event) =>
      readMessageMutationLocalEffect(body, event, {
        operation: 'replaceTail',
        expectedChatId: input.chatId,
        expectedAfterMessageId: input.afterMessageId ?? null,
        expectedMessageIds: input.messages.map((message) => message.chatId),
      }),
  })
}

export async function replaceMessagesCommand(
  input: ReplaceMessagesCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ chatId: string }>> {
  return requestCommandJson(`/chats/${encodeURIComponent(input.chatId)}/messages`, {
    method: 'PUT',
    body: {
      baseRevision: input.baseRevision,
      messages: input.messages,
    },
    signal,
    readLocalEffect: (body, event) =>
      readMessageMutationLocalEffect(body, event, {
        operation: 'replaceAll',
        expectedChatId: input.chatId,
        expectedMessageIds: input.messages.map((message) => message.chatId),
      }),
  })
}

export async function persistGenerationResultCommand(
  input: PersistGenerationResultCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ chatId: string; messageId: string }>> {
  return requestCommandJson(`/chats/${encodeURIComponent(input.chatId)}/generation-result`, {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      generationResult: input.generationResult,
    },
    signal,
  })
}

export async function runServerPresetCommand<T extends Record<string, unknown> = {}>(
  input: RunServerPresetCommandInput<T>,
): Promise<ServerCommandResult<T>> {
  return runServerCommand(input)
}

export async function runServerCommand<T extends Record<string, unknown> = {}>(
  input: RunServerPresetCommandInput<T>,
): Promise<ServerCommandResult<T>> {
  if (!canUseServerCommands()) return { status: 'unavailable' }

  const rollbackEpoch = captureDestructiveRefreshEpoch()
  return enqueueServerCommandExecution(() => executeServerCommand(input, rollbackEpoch))
}

/**
 * Run a multi-resource optimistic mutation as one queue unit. Every accepted
 * response advances the shared revision cursor before the next factory runs,
 * while response events remain deferred until the whole sequence finishes.
 * This prevents unrelated queued commands from interleaving between steps and
 * lets bootstrap reconcile the accumulated events once.
 *
 * A failure rolls back inside the queue task, before its accepted earlier
 * events are flushed through reconciliation. `null` means every step was
 * accepted (or there was no work to dispatch); otherwise the first failure is
 * returned and later factories are skipped.
 */
export async function runServerCommandSequence(
  commands: readonly ServerCommandFactory[],
  rollback?: () => void,
): Promise<ServerCommandResult | null> {
  if (!canUseServerCommands() || commands.length === 0) return null

  const rollbackEpoch = captureDestructiveRefreshEpoch()
  return enqueueServerCommandExecution(() => executeServerCommandSequence(commands, rollback, rollbackEpoch))
}

async function executeServerCommandSequence(
  commands: readonly ServerCommandFactory[],
  rollback: (() => void) | undefined,
  rollbackEpoch: number,
): Promise<ServerCommandResult | null> {
  for (const command of commands) {
    // The sequence owns rollback so it runs exactly once for the first failed
    // step. executeServerCommand still normalizes thrown factories to an error
    // result and defers every accepted event into this sequence's active batch.
    const result = await executeServerCommand({ command }, rollbackEpoch)
    if (result.status === 'ok') continue

    runRollbackUnlessDestructiveRefreshChanged(rollback, rollbackEpoch)
    return result
  }
  return null
}

async function executeServerCommand<T extends Record<string, unknown>>(
  input: RunServerPresetCommandInput<T>,
  rollbackEpoch: number,
): Promise<ServerCommandResult<T>> {
  let result: ServerCommandResult<T>
  try {
    const baseRevision = await getServerCommandBaseRevision(input.signal, input.keepalive)
    if (baseRevision === null) {
      runRollbackUnlessDestructiveRefreshChanged(input.rollback, rollbackEpoch)
      return { status: 'error', error: 'Unable to read server command revision' }
    }

    result = await input.command(baseRevision)
  } catch (error) {
    // A command-factory rejection must roll back and surface as an error result.
    // Without this, the fire-and-forget runners (`void runServerCommand(...)`)
    // swallowed the rejection and the optimistic write silently diverged from
    // the server.
    console.error('Server command factory rejected:', error)
    runRollbackUnlessDestructiveRefreshChanged(input.rollback, rollbackEpoch)
    const message = error instanceof Error ? error.message : String(error)
    return { status: 'error', error: `Command factory rejected: ${message}` }
  }

  if (result.status !== 'ok') {
    runRollbackUnlessDestructiveRefreshChanged(input.rollback, rollbackEpoch)
  } else {
    // requestCommandJson already advances this cursor, but custom command
    // factories are also supported. Trust their accepted revision so the next
    // queued factory does not reuse a stale baseRevision.
    setCachedServerCommandRevision(result.revision)
    await notifyServerCommandSuccessReconciler(result.event)
  }
  return result
}

function groupSettingsPatch(patch: SettingsPatch): Array<[SettingsGroup, SettingsPatch]> {
  const groups = new Map<SettingsGroup, SettingsPatch>()
  for (const [key, value] of Object.entries(patch)) {
    const group = settingsGroupForKey(key)
    if (!group || value === undefined) continue
    const groupPatch = groups.get(group) ?? {}
    groupPatch[key] = value
    groups.set(group, groupPatch)
  }
  return Array.from(groups.entries())
}

async function requestCommandJson<T extends Record<string, unknown> = {}>(
  path: string,
  init: {
    method: string
    body: unknown
    signal?: AbortSignal | null
    keepalive?: boolean
    reconcileImmediately?: boolean
    readLocalEffect?: (body: unknown, event: CommandEvent) => ServerCommandLocalEffect | undefined
    deferOwnEventUntilResponse?: (event: CommandEvent) => boolean
  },
): Promise<ServerCommandResult<T>> {
  if (!canUseServerCommands()) return { status: 'unavailable' }

  const auth = await getNodeServerProxyAuth()
  const directReconciliation = init.deferOwnEventUntilResponse
    ? beginDirectServerCommandReconciliation(init.deferOwnEventUntilResponse)
    : null
  let confirmedEvent: CommandEvent | null = null
  try {
    let response: Response
    try {
      const requestInit: RequestInit = {
        method: init.method,
        signal: init.signal ?? undefined,
        headers: {
          'content-type': 'application/json',
          'risu-auth': auth,
          ...activeWriterSessionHeader(),
        },
        body: JSON.stringify(init.body),
      }
      if (init.keepalive) requestInit.keepalive = true
      response = await fetch(`${COMMAND_ENDPOINT}${path}`, requestInit)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { status: 'error', error: `Network error: ${message}` }
    }

    let body: unknown = null
    try {
      body = await response.json()
    } catch {
      // Non-JSON command errors are reported by HTTP status below.
    }

    if (response.status === 409) {
      const currentRevision = readCurrentRevision(body)
      if (currentRevision !== null) setCachedServerCommandRevision(currentRevision)
      return currentRevision === null
        ? { status: 'error', error: errorMessageFromBody(body, 'HTTP 409') }
        : { status: 'conflict', currentRevision }
    }

    if (handleActiveWriterStaleResponse(response)) {
      return { status: 'error', error: errorMessageFromBody(body, 'HTTP 423') }
    }

    if (!response.ok) {
      return {
        status: 'error',
        error: errorMessageFromBody(body, `HTTP ${response.status}`),
      }
    }

    if (body && typeof body === 'object') {
      const revision = (body as { revision?: unknown }).revision
      if (Number.isInteger(revision) && (revision as number) >= 0) {
        setCachedServerCommandRevision(revision as number)
      }
      const event = readCommandEvent(body)
      if (event) {
        const localEffect = init.readLocalEffect?.(body, event)
        await notifyServerCommandSuccessReconciler(event, init.reconcileImmediately, localEffect)
        confirmedEvent = event
      }
    }

    return { status: 'ok', ...(body as { revision: number; event: CommandEvent } & T) }
  } finally {
    await finishDirectServerCommandReconciliation(directReconciliation, confirmedEvent)
  }
}

async function notifyServerCommandSuccessReconciler(
  event: CommandEvent | null | undefined,
  reconcileImmediately = false,
  localEffect?: ServerCommandLocalEffect,
): Promise<void> {
  // Some compatibility command factories return a minimal `{ status: 'ok' }`
  // result. They have no authoritative event to reconcile.
  if (!event) return
  if (!reconcileImmediately && deferOwnServerCommandReconciliation(event, localEffect)) return
  await reconcileServerCommandSuccessEvents(
    event,
    [event],
    localEffect ? new Map([[event.revision, localEffect]]) : new Map(),
  )
}

async function reconcileServerCommandSuccessEvents(
  event: CommandEvent,
  coalescedEvents: readonly CommandEvent[],
  localEffects: ReadonlyMap<number, ServerCommandLocalEffect> = new Map(),
): Promise<void> {
  try {
    await serverCommandSuccessReconciler?.(event, coalescedEvents, localEffects)
  } catch (error) {
    console.warn('Server command projection reconcile failed', error)
  }
}

function readChatGenerationSettingsLocalEffect(
  body: unknown,
  attemptedGenerationSettings: ChatGenerationSettings,
): ChatGenerationSettingsLocalEffect | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined
  const record = body as Record<string, unknown>
  if (typeof record.chatId !== 'string' || record.chatId.trim() === '') return undefined
  if (typeof record.characterId !== 'string' || record.characterId.trim() === '') return undefined
  if (
    !record.generationSettings ||
    typeof record.generationSettings !== 'object' ||
    Array.isArray(record.generationSettings)
  ) {
    return undefined
  }
  return {
    kind: 'chatGenerationSettings',
    chatId: record.chatId,
    characterId: record.characterId,
    attemptedGenerationSettings: cloneJsonValue(attemptedGenerationSettings),
    generationSettings: cloneJsonValue(record.generationSettings as ChatGenerationSettings),
  }
}

function readSettingsPatchLocalEffect(
  body: unknown,
  event: CommandEvent,
  group: SettingsGroup,
  attemptedPatch: SettingsPatch,
  optimisticProjectionEpoch?: unknown,
): SettingsPatchLocalEffect | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined
  const record = body as Record<string, unknown>
  if (record.revision !== event.revision) return undefined
  if (
    (group === 'prompt' && !isProjectionEpoch(optimisticProjectionEpoch)) ||
    (optimisticProjectionEpoch !== undefined && !isProjectionEpoch(optimisticProjectionEpoch))
  ) {
    return undefined
  }
  const settingsProjectionEpoch =
    optimisticProjectionEpoch === undefined ? undefined : (optimisticProjectionEpoch as number)
  const acknowledgedKeys = record.acknowledgedKeys
  const overrides = record.settings
  if (!isUniqueStringArray(acknowledgedKeys)) return undefined
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) return undefined

  const attemptedKeys = Object.keys(attemptedPatch).sort()
  const sortedAcknowledgedKeys = [...acknowledgedKeys].sort()
  if (attemptedKeys.length === 0 || !isJsonValueEqual(attemptedKeys, sortedAcknowledgedKeys)) return undefined
  if (attemptedKeys.some((key) => SERVER_SETTINGS_GROUP_BY_KEY[key] !== group)) return undefined
  if (attemptedKeys.some((key) => !isJsonValue(attemptedPatch[key]))) return undefined

  const writesHypaV3Presets = Object.prototype.hasOwnProperty.call(attemptedPatch, 'hypaV3Presets')
  const expectedResource = writesHypaV3Presets ? 'settingsWithHypaV3Presets' : 'settings'
  if (
    event.type !== 'settings.updated' ||
    event.resource !== expectedResource ||
    event.id !== group ||
    event.parentId !== undefined
  ) {
    return undefined
  }

  const acknowledgedKeySet = new Set(acknowledgedKeys)
  const canonicalSettings = cloneJsonValue(attemptedPatch)
  for (const [key, value] of Object.entries(overrides)) {
    if (!acknowledgedKeySet.has(key) || !isJsonValue(value)) return undefined
    canonicalSettings[key] = cloneJsonValue(value)
  }

  return {
    kind: 'settingsPatch',
    group,
    attemptedPatch: cloneJsonValue(attemptedPatch),
    settings: canonicalSettings,
    ...(settingsProjectionEpoch === undefined ? {} : { settingsProjectionEpoch }),
  }
}

function readLegacyPresetPatchLocalEffect(
  body: unknown,
  event: CommandEvent,
  input: {
    presetId: string
    attemptedPatch: Record<string, unknown>
    acknowledgement?: LegacyPresetPatchOptimisticAcknowledgement
  },
): LegacyPresetPatchLocalEffect | undefined {
  const acknowledgement = input.acknowledgement
  if (!acknowledgement || !body || typeof body !== 'object' || Array.isArray(body)) return undefined
  const record = body as Record<string, unknown>
  if (
    record.revision !== event.revision ||
    record.presetId !== input.presetId ||
    event.type !== 'preset.updated' ||
    event.resource !== 'presetRow' ||
    event.id !== input.presetId ||
    event.parentId !== undefined ||
    !isProjectionEpoch(acknowledgement.collectionProjectionEpoch) ||
    !isPlainJsonRecord(acknowledgement.attemptedFields)
  ) {
    return undefined
  }

  const acknowledgedKeys = record.acknowledgedKeys
  const canonicalValues = record.canonicalValues
  const canonicalDeletedKeys = record.canonicalDeletedKeys
  if (
    !isUniqueStringArray(acknowledgedKeys) ||
    !isPlainJsonRecord(canonicalValues) ||
    !isUniqueStringArray(canonicalDeletedKeys)
  ) {
    return undefined
  }

  const attemptedKeys = Object.keys(input.attemptedPatch).sort()
  if (
    attemptedKeys.length === 0 ||
    !isJsonValueEqual(attemptedKeys, [...acknowledgedKeys].sort()) ||
    attemptedKeys.some((key) => !nonEmptyString(key) || !isJsonValue(input.attemptedPatch[key]))
  ) {
    return undefined
  }

  const attemptedFields: Record<string, JsonFieldState> = {}
  for (const [key, state] of Object.entries(acknowledgement.attemptedFields)) {
    if (!nonEmptyString(key) || key === 'id') return undefined
    const parsedState = readJsonFieldState(state)
    if (!parsedState) return undefined
    attemptedFields[key] = parsedState
  }
  const expectedAttemptedFieldKeys = [
    ...new Set([...attemptedKeys.filter((key) => key !== 'id'), 'agentPresets', 'agentPresetDefaultId']),
  ].sort()
  if (!isJsonValueEqual(Object.keys(attemptedFields).sort(), expectedAttemptedFieldKeys)) {
    return undefined
  }

  const canonicalValueKeys = Object.keys(canonicalValues)
  const canonicalDeletedKeySet = new Set(canonicalDeletedKeys)
  const canonicalKeys = [...canonicalValueKeys, ...canonicalDeletedKeys]
  if (
    canonicalKeys.some(
      (key) => !nonEmptyString(key) || key === 'id' || !Object.prototype.hasOwnProperty.call(attemptedFields, key),
    ) ||
    canonicalValueKeys.some((key) => canonicalDeletedKeySet.has(key) || !isJsonValue(canonicalValues[key]))
  ) {
    return undefined
  }

  const fields: LegacyPresetPatchLocalEffect['fields'] = {}
  for (const key of canonicalValueKeys) {
    fields[key] = {
      attempted: cloneJsonValue(attemptedFields[key]),
      canonical: { present: true, value: cloneJsonValue(canonicalValues[key]) },
    }
  }
  for (const key of canonicalDeletedKeys) {
    fields[key] = {
      attempted: cloneJsonValue(attemptedFields[key]),
      canonical: { present: false },
    }
  }

  return {
    kind: 'legacyPresetPatch',
    presetId: input.presetId,
    collectionProjectionEpoch: acknowledgement.collectionProjectionEpoch,
    fields,
  }
}

function readPersonaPatchLocalEffect(
  body: unknown,
  event: CommandEvent,
  input: {
    personaId: string
    attemptedPatch: PersonaSnapshot
    mirrorLegacyProfile: boolean
    acknowledgement?: PersonaPatchOptimisticAcknowledgement
  },
): PersonaPatchLocalEffect | undefined {
  const acknowledgement = input.acknowledgement
  if (!acknowledgement || !body || typeof body !== 'object' || Array.isArray(body)) return undefined
  const record = body as Record<string, unknown>
  if (
    record.revision !== event.revision ||
    record.personaId !== input.personaId ||
    event.type !== 'persona.updated' ||
    event.resource !== 'persona' ||
    event.id !== input.personaId ||
    event.parentId !== undefined ||
    !isProjectionEpoch(acknowledgement.collectionProjectionEpoch) ||
    !isProjectionEpoch(acknowledgement.settingsProjectionEpoch) ||
    typeof acknowledgement.legacyProfileProjectionExpected !== 'boolean' ||
    (!input.mirrorLegacyProfile && acknowledgement.legacyProfileProjectionExpected) ||
    typeof record.legacyProfileProjectionApplied !== 'boolean' ||
    record.legacyProfileProjectionApplied !== acknowledgement.legacyProfileProjectionExpected
  ) {
    return undefined
  }

  const acknowledgedKeys = record.acknowledgedKeys
  const attemptedKeys = Object.keys(input.attemptedPatch).sort()
  if (
    !isUniqueStringArray(acknowledgedKeys) ||
    attemptedKeys.length === 0 ||
    !isJsonValueEqual(attemptedKeys, [...acknowledgedKeys].sort()) ||
    attemptedKeys.some((key) => !isJsonValue(input.attemptedPatch[key]))
  ) {
    return undefined
  }

  const attemptedPersona = acknowledgement.attemptedPersona
  if (
    !isPlainJsonRecord(attemptedPersona) ||
    !isJsonValue(attemptedPersona) ||
    attemptedPersona.id !== input.personaId ||
    attemptedKeys.some(
      (key) =>
        !Object.prototype.hasOwnProperty.call(attemptedPersona, key) ||
        !isJsonValueEqual(attemptedPersona[key], input.attemptedPatch[key]),
    )
  ) {
    return undefined
  }

  const attemptedLegacyProfile = acknowledgement.attemptedLegacyProfile
  const legacyKeys: Array<keyof PersonaLegacyProfileProjection> = ['username', 'userIcon', 'personaPrompt', 'userNote']
  if (
    !isPlainJsonRecord(attemptedLegacyProfile) ||
    !isJsonValueEqual(Object.keys(attemptedLegacyProfile).sort(), [...legacyKeys].sort()) ||
    legacyKeys.some((key) => typeof attemptedLegacyProfile[key] !== 'string')
  ) {
    return undefined
  }

  if (acknowledgement.legacyProfileProjectionExpected) {
    const expectedLegacyProfile: PersonaLegacyProfileProjection = {
      username: typeof attemptedPersona.name === 'string' ? attemptedPersona.name : '',
      userIcon: typeof attemptedPersona.icon === 'string' ? attemptedPersona.icon : '',
      personaPrompt: typeof attemptedPersona.personaPrompt === 'string' ? attemptedPersona.personaPrompt : '',
      userNote: typeof attemptedPersona.note === 'string' ? attemptedPersona.note : '',
    }
    if (legacyKeys.some((key) => attemptedLegacyProfile[key] !== expectedLegacyProfile[key])) return undefined
  }

  return {
    kind: 'personaPatch',
    personaId: input.personaId,
    collectionProjectionEpoch: acknowledgement.collectionProjectionEpoch,
    settingsProjectionEpoch: acknowledgement.settingsProjectionEpoch,
    attemptedPatch: cloneJsonValue(input.attemptedPatch),
    attemptedPersona: cloneJsonValue(attemptedPersona as PersonaSnapshot & { id: string }),
    attemptedLegacyProfile: cloneJsonValue(attemptedLegacyProfile as PersonaLegacyProfileProjection),
    legacyProfileProjectionApplied: record.legacyProfileProjectionApplied,
  }
}

function readTranslatorPresetPatchLocalEffect(
  body: unknown,
  event: CommandEvent,
  input: {
    presetId: string
    attemptedPatch: TranslatorPresetSnapshot
    acknowledgement: TranslatorPresetPatchOptimisticAcknowledgement
  },
): TranslatorPresetPatchLocalEffect | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined
  const record = body as Record<string, unknown>
  const acknowledgement = input.acknowledgement
  if (
    record.revision !== event.revision ||
    record.presetId !== input.presetId ||
    event.type !== 'translatorPreset.updated' ||
    event.resource !== 'translatorPreset' ||
    event.id !== input.presetId ||
    event.parentId !== undefined ||
    !isProjectionEpoch(acknowledgement.collectionProjectionEpoch) ||
    !isProjectionEpoch(acknowledgement.languageSettingsProjectionEpoch) ||
    !nonEmptyString(acknowledgement.selectedPresetId) ||
    record.selectedPresetId !== acknowledgement.selectedPresetId
  ) {
    return undefined
  }

  const acknowledgedKeys = record.acknowledgedKeys
  const attemptedKeys = Object.keys(input.attemptedPatch).sort()
  const allowedKeys = new Set(['name', 'prompt', 'maxResponse'])
  if (
    !isUniqueStringArray(acknowledgedKeys) ||
    attemptedKeys.length === 0 ||
    !isJsonValueEqual(attemptedKeys, [...acknowledgedKeys].sort()) ||
    attemptedKeys.some((key) => !allowedKeys.has(key) || !isJsonValue(input.attemptedPatch[key]))
  ) {
    return undefined
  }

  const attemptedPreset = acknowledgement.attemptedPreset
  if (
    !isCanonicalTranslatorPreset(attemptedPreset) ||
    attemptedPreset.id !== input.presetId ||
    attemptedKeys.some((key) => !isJsonValueEqual(attemptedPreset[key], input.attemptedPatch[key]))
  ) {
    return undefined
  }

  return {
    kind: 'translatorPresetPatch',
    presetId: input.presetId,
    collectionProjectionEpoch: acknowledgement.collectionProjectionEpoch,
    languageSettingsProjectionEpoch: acknowledgement.languageSettingsProjectionEpoch,
    selectedPresetId: acknowledgement.selectedPresetId,
    attemptedPatch: cloneJsonValue(input.attemptedPatch),
    attemptedPreset: cloneJsonValue(attemptedPreset),
  }
}

function readAgentPresetPatchLocalEffect(
  body: unknown,
  event: CommandEvent,
  input: {
    presetId: string
    attemptedPatch: Record<string, unknown>
    acknowledgement: AgentPresetPatchOptimisticAcknowledgement
  } & ({ kind: 'preset' } | { kind: 'step'; stepId: string }),
): AgentPresetPatchLocalEffect | AgentPresetStepPatchLocalEffect | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined
  const record = body as Record<string, unknown>
  const expectedType = input.kind === 'preset' ? 'agentPreset.updated' : 'agentPreset.step.updated'
  const expectedId = input.kind === 'preset' ? input.presetId : input.stepId
  const expectedParentId = input.kind === 'preset' ? undefined : input.presetId
  if (
    record.revision !== event.revision ||
    record.presetId !== input.presetId ||
    (input.kind === 'step' && record.stepId !== input.stepId) ||
    event.type !== expectedType ||
    event.resource !== 'agentPreset' ||
    event.id !== expectedId ||
    event.parentId !== expectedParentId ||
    !isProjectionEpoch(input.acknowledgement.settingsProjectionEpoch) ||
    !isPlainJsonRecord(input.acknowledgement.attemptedFields)
  ) {
    return undefined
  }

  const allowedKeys =
    input.kind === 'preset'
      ? new Set(['name', 'description', 'enabled', 'maxConcurrency'])
      : new Set([
          'name',
          'enabled',
          'phase',
          'dependencies',
          'instruction',
          'model',
          'runtime',
          'inputScopes',
          'outputKey',
          'outputFormat',
          'destination',
          'failurePolicy',
        ])
  const attemptedKeys = Object.keys(input.attemptedPatch).sort()
  if (
    attemptedKeys.length === 0 ||
    attemptedKeys.some((key) => !allowedKeys.has(key) || !isJsonValue(input.attemptedPatch[key])) ||
    !isJsonValueEqual(Object.keys(input.acknowledgement.attemptedFields).sort(), attemptedKeys)
  ) {
    return undefined
  }

  const attemptedFields: Record<string, JsonFieldState> = {}
  for (const key of attemptedKeys) {
    const state = readJsonFieldState(input.acknowledgement.attemptedFields[key])
    if (!state?.present || !isJsonValueEqual(state.value, input.attemptedPatch[key])) return undefined
    attemptedFields[key] = state
  }

  const acknowledgedKeys = record.acknowledgedKeys
  const canonicalValues = record.canonicalValues
  const canonicalDeletedKeys = record.canonicalDeletedKeys
  const updatedAt = record.updatedAt
  if (
    !isUniqueStringArray(acknowledgedKeys) ||
    !isJsonValueEqual([...acknowledgedKeys].sort(), attemptedKeys) ||
    !isPlainJsonRecord(canonicalValues) ||
    !isUniqueStringArray(canonicalDeletedKeys) ||
    typeof updatedAt !== 'number' ||
    !Number.isFinite(updatedAt) ||
    updatedAt < 0
  ) {
    return undefined
  }

  const canonicalValueKeys = Object.keys(canonicalValues)
  const canonicalDeletedKeySet = new Set(canonicalDeletedKeys)
  const canonicalKeys = [...canonicalValueKeys, ...canonicalDeletedKeys].sort()
  if (
    !isJsonValueEqual(canonicalKeys, attemptedKeys) ||
    canonicalValueKeys.some(
      (key) => !allowedKeys.has(key) || canonicalDeletedKeySet.has(key) || !isJsonValue(canonicalValues[key]),
    ) ||
    canonicalDeletedKeys.some(
      (key) => !allowedKeys.has(key) || (input.kind === 'preset' && key !== 'description' && key !== 'maxConcurrency'),
    ) ||
    (input.kind === 'step' && canonicalDeletedKeys.length > 0)
  ) {
    return undefined
  }
  if (!isCanonicalAgentPresetPatchReceipt(input.kind, canonicalValues)) return undefined

  const fields: AgentPresetPatchLocalEffect['fields'] = {}
  for (const key of canonicalValueKeys) {
    fields[key] = {
      attempted: cloneJsonValue(attemptedFields[key]),
      canonical: { present: true, value: cloneJsonValue(canonicalValues[key]) },
    }
  }
  for (const key of canonicalDeletedKeys) {
    fields[key] = {
      attempted: cloneJsonValue(attemptedFields[key]),
      canonical: { present: false },
    }
  }

  const common = {
    presetId: input.presetId,
    settingsProjectionEpoch: input.acknowledgement.settingsProjectionEpoch,
    fields,
    updatedAt,
  }
  return input.kind === 'preset'
    ? { kind: 'agentPresetPatch', ...common }
    : { kind: 'agentPresetStepPatch', stepId: input.stepId, ...common }
}

function isCanonicalAgentPresetPatchReceipt(
  kind: 'preset' | 'step',
  canonicalValues: Record<string, unknown>,
): boolean {
  if (kind === 'preset') {
    const candidate = {
      id: '__receipt_preset__',
      name: 'Receipt Preset',
      enabled: true,
      version: AGENT_PRESET_SCHEMA_VERSION,
      steps: [],
      ...cloneJsonValue(canonicalValues),
    }
    const normalized = normalizeAgentPresets([candidate])[0]
    return (
      !!normalized &&
      validateAgentPresetRecord(normalized).length === 0 &&
      canonicalFieldsMatchNormalizedRecord(canonicalValues, normalized as unknown as Record<string, unknown>)
    )
  }

  const canonicalPhase = canonicalValues.phase
  const phase =
    canonicalPhase === 'afterMain' ||
    (!Object.hasOwn(canonicalValues, 'phase') && canonicalValues.destination === 'finalOutput')
      ? 'afterMain'
      : 'beforeMain'
  const step = {
    id: '__receipt_step__',
    name: 'Receipt Step',
    enabled: true,
    phase,
    dependencies: [],
    instruction: '',
    model: { mode: 'inheritMain' },
    runtime: {},
    inputScopes: [],
    outputKey: 'receipt_step',
    outputFormat: 'text',
    destination: phase === 'afterMain' ? 'intermediate' : 'promptOutput',
    failurePolicy: { mode: 'required' },
    ...cloneJsonValue(canonicalValues),
  }
  const normalized = normalizeAgentPresets([
    {
      id: '__receipt_preset__',
      name: 'Receipt Preset',
      enabled: true,
      version: AGENT_PRESET_SCHEMA_VERSION,
      steps: [step],
    },
  ])[0]?.steps[0]
  return (
    !!normalized &&
    validateAgentPresetStepRecord(normalized).length === 0 &&
    canonicalFieldsMatchNormalizedRecord(canonicalValues, normalized as unknown as Record<string, unknown>)
  )
}

function canonicalFieldsMatchNormalizedRecord(
  canonicalValues: Record<string, unknown>,
  normalized: Record<string, unknown>,
): boolean {
  return Object.entries(canonicalValues).every(
    ([key, value]) => Object.hasOwn(normalized, key) && isJsonValueEqual(normalized[key], value),
  )
}

function isCanonicalTranslatorPreset(value: unknown): value is TranslatorPresetSnapshot & { id: string } {
  if (!isPlainJsonRecord(value)) return false
  const record = value as Record<string, unknown>
  return (
    isJsonValueEqual(Object.keys(record).sort(), ['id', 'maxResponse', 'name', 'prompt']) &&
    nonEmptyString(record.id) &&
    typeof record.name === 'string' &&
    typeof record.prompt === 'string' &&
    typeof record.maxResponse === 'number' &&
    Number.isFinite(record.maxResponse)
  )
}

function readSplitPresetPatchLocalEffect(
  body: unknown,
  event: CommandEvent,
  input: {
    presetKind: 'model' | 'prompt'
    presetId: string
    attemptedPatch: Record<string, unknown>
    acknowledgement?: SplitPresetPatchOptimisticAcknowledgement
  },
): SplitPresetPatchLocalEffect | undefined {
  const acknowledgement = input.acknowledgement
  if (!acknowledgement || !body || typeof body !== 'object' || Array.isArray(body)) return undefined
  const record = body as Record<string, unknown>
  const expectedType = input.presetKind === 'model' ? 'modelPreset.updated' : 'promptPreset.updated'
  const expectedResource = input.presetKind === 'model' ? 'modelPreset' : 'promptPreset'
  if (
    record.revision !== event.revision ||
    event.type !== expectedType ||
    event.resource !== expectedResource ||
    event.id !== input.presetId ||
    event.parentId !== undefined ||
    record[`${input.presetKind}PresetId`] !== input.presetId ||
    !isProjectionEpoch(acknowledgement.collectionProjectionEpoch) ||
    !isProjectionEpoch(acknowledgement.settingsProjectionEpoch)
  ) {
    return undefined
  }

  const acknowledgedKeys = record.acknowledgedKeys
  const presetOverrides = record.preset
  const settingsOverrides = record.settings
  if (
    !isUniqueStringArray(acknowledgedKeys) ||
    !presetOverrides ||
    typeof presetOverrides !== 'object' ||
    Array.isArray(presetOverrides) ||
    !settingsOverrides ||
    typeof settingsOverrides !== 'object' ||
    Array.isArray(settingsOverrides) ||
    typeof record.selectedProjectionApplied !== 'boolean' ||
    typeof record.ownerProjectionApplied !== 'boolean'
  ) {
    return undefined
  }

  const attemptedKeys = Object.keys(input.attemptedPatch).sort()
  if (
    attemptedKeys.length === 0 ||
    !isJsonValueEqual(attemptedKeys, [...acknowledgedKeys].sort()) ||
    attemptedKeys.some((key) => !isJsonValue(input.attemptedPatch[key])) ||
    Object.values(acknowledgement.attemptedSettings).some((value) => !isJsonValue(value)) ||
    record.selectedProjectionApplied !== acknowledgement.selectedProjectionExpected ||
    record.ownerProjectionApplied !== (acknowledgement.ownerProjectionExpected ?? false)
  ) {
    return undefined
  }

  const acknowledgedKeySet = new Set(acknowledgedKeys)
  const attemptedSettingsKeySet = new Set(Object.keys(acknowledgement.attemptedSettings))
  const preset = cloneJsonValue(input.attemptedPatch)
  for (const [key, value] of Object.entries(presetOverrides as Record<string, unknown>)) {
    if (!acknowledgedKeySet.has(key) || !isJsonValue(value)) return undefined
    preset[key] = cloneJsonValue(value)
  }
  const settings = cloneJsonValue(acknowledgement.attemptedSettings)
  for (const [key, value] of Object.entries(settingsOverrides as Record<string, unknown>)) {
    if (!attemptedSettingsKeySet.has(key) || !isJsonValue(value)) return undefined
    settings[key] = cloneJsonValue(value)
  }

  if (input.presetKind === 'model') {
    const selectedPromptPresetId = record.selectedPromptPresetId
    const expectedPromptPresetId = acknowledgement.selectedProjectionExpected
      ? (acknowledgement.selectedPromptPresetId ?? null)
      : null
    if (selectedPromptPresetId !== expectedPromptPresetId || record.ownerProjectionApplied !== false) return undefined
  } else if (record.selectedPromptPresetId !== undefined) {
    return undefined
  }

  const ownerExpected = acknowledgement.ownerProjectionExpected === true
  if (
    ownerExpected &&
    (!isProjectionEpoch(acknowledgement.promptOwnerProjectionEpoch) ||
      !isProjectionEpoch(acknowledgement.promptOwnerRevision))
  ) {
    return undefined
  }

  return {
    kind: 'splitPresetPatch',
    presetKind: input.presetKind,
    presetId: input.presetId,
    attemptedPatch: cloneJsonValue(input.attemptedPatch),
    preset,
    attemptedSettings: cloneJsonValue(acknowledgement.attemptedSettings),
    settings,
    selectedProjectionApplied: record.selectedProjectionApplied,
    ownerProjectionApplied: record.ownerProjectionApplied,
    collectionProjectionEpoch: acknowledgement.collectionProjectionEpoch,
    settingsProjectionEpoch: acknowledgement.settingsProjectionEpoch,
    selectedPresetId: acknowledgement.selectedPresetId,
    ...(input.presetKind === 'model' ? { selectedPromptPresetId: acknowledgement.selectedPromptPresetId ?? null } : {}),
    ...(ownerExpected
      ? {
          promptOwnerProjectionEpoch: acknowledgement.promptOwnerProjectionEpoch,
          promptOwnerRevision: acknowledgement.promptOwnerRevision,
        }
      : {}),
  }
}

interface ReadPromptItemMutationLocalEffectOptions {
  operation: PromptItemMutationOperation
  promptPresetId?: unknown
  itemId?: unknown
  itemIds?: unknown
  promptItem?: unknown
  patch?: unknown
  deleteKeys?: unknown
  enabled?: unknown
  acknowledgement?: PromptItemOptimisticAcknowledgement
}

function readPromptItemMutationLocalEffect(
  body: unknown,
  event: CommandEvent,
  options: ReadPromptItemMutationLocalEffectOptions,
): PromptItemMutationLocalEffect | undefined {
  const acknowledgement = options.acknowledgement
  if (!acknowledgement || !body || typeof body !== 'object' || Array.isArray(body)) return undefined
  let promptPresetId: string | null = null
  if (options.promptPresetId !== undefined) {
    if (!nonEmptyString(options.promptPresetId)) return undefined
    promptPresetId = options.promptPresetId
  }
  if (
    !isProjectionEpoch(acknowledgement.collectionProjectionEpoch) ||
    !isProjectionEpoch(acknowledgement.ownerProjectionEpoch) ||
    !isCanonicalPromptTemplateOwnerState(acknowledgement.ownerState)
  ) {
    return undefined
  }

  const expectedType = {
    create: 'prompt.item.created',
    update: 'prompt.item.updated',
    delete: 'prompt.item.deleted',
    reorder: 'prompt.item.reordered',
    enable: 'prompt.item.enabled',
  }[options.operation]
  const record = body as Record<string, unknown>
  if (
    record.revision !== event.revision ||
    event.type !== expectedType ||
    event.resource !== 'promptItem' ||
    event.parentId !== (promptPresetId ?? undefined)
  ) {
    return undefined
  }

  const ownerItems = acknowledgement.ownerState.enabled ? acknowledgement.ownerState.items : null
  const baseEffect = {
    kind: 'promptItemMutation' as const,
    operation: options.operation,
    promptPresetId,
    collectionProjectionEpoch: acknowledgement.collectionProjectionEpoch,
    ownerProjectionEpoch: acknowledgement.ownerProjectionEpoch,
    ownerState: cloneJsonValue(acknowledgement.ownerState),
  }

  if (options.operation === 'create') {
    if (
      !nonEmptyString(options.itemId) ||
      !isCanonicalPromptItem(options.promptItem) ||
      options.promptItem.id !== options.itemId ||
      record.itemId !== options.itemId ||
      event.id !== options.itemId ||
      !ownerItems
    ) {
      return undefined
    }
    const finalItem = ownerItems.find((item) => item.id === options.itemId)
    if (!finalItem || !isJsonValueEqual(finalItem, options.promptItem)) return undefined
    return { ...baseEffect, itemId: options.itemId }
  }

  if (options.operation === 'update') {
    if (
      !nonEmptyString(options.itemId) ||
      !isCanonicalPromptItemPatch(options.patch, options.deleteKeys) ||
      record.itemId !== options.itemId ||
      event.id !== options.itemId ||
      !ownerItems
    ) {
      return undefined
    }
    const finalItem = ownerItems.find((item) => item.id === options.itemId)
    if (!finalItem || !promptItemMatchesSparseUpdate(finalItem, options.patch, options.deleteKeys)) return undefined
    return { ...baseEffect, itemId: options.itemId }
  }

  if (options.operation === 'delete') {
    if (
      !nonEmptyString(options.itemId) ||
      record.itemId !== options.itemId ||
      event.id !== options.itemId ||
      !ownerItems ||
      ownerItems.some((item) => item.id === options.itemId)
    ) {
      return undefined
    }
    return { ...baseEffect, itemId: options.itemId }
  }

  if (options.operation === 'reorder') {
    if (
      event.id !== undefined ||
      !isUniqueStringArray(options.itemIds) ||
      !ownerItems ||
      !isJsonValueEqual(
        ownerItems.map((item) => item.id),
        options.itemIds,
      )
    ) {
      return undefined
    }
    return { ...baseEffect, itemIds: [...options.itemIds] }
  }

  if (
    event.id !== undefined ||
    typeof options.enabled !== 'boolean' ||
    typeof record.enabled !== 'boolean' ||
    record.enabled !== options.enabled ||
    acknowledgement.ownerState.enabled !== options.enabled
  ) {
    return undefined
  }
  return { ...baseEffect, enabled: options.enabled }
}

function isCanonicalPromptTemplateOwnerState(value: unknown): value is PromptTemplateOwnerStateSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  if (record.enabled === false) {
    return Object.keys(record).length === 1
  }
  return record.enabled === true && Object.keys(record).length === 2 && isCanonicalPromptItemArray(record.items)
}

function isCanonicalPromptItemArray(value: unknown): value is PromptItemSnapshot[] {
  if (!Array.isArray(value)) return false
  const seen = new Set<string>()
  for (const item of value) {
    if (!isCanonicalPromptItem(item) || seen.has(item.id)) return false
    seen.add(item.id)
  }
  return true
}

function isCanonicalPromptItem(value: unknown): value is PromptItemSnapshot & { id: string } {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    isJsonValue(value) &&
    nonEmptyString((value as PromptItemSnapshot).id)
  )
}

function isCanonicalPromptItemPatch(patch: unknown, deleteKeys: unknown): patch is PromptItemSnapshot {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || !isJsonValue(patch)) return false
  const patchKeys = Object.keys(patch)
  const normalizedDeleteKeys = deleteKeys === undefined ? [] : deleteKeys
  if (
    !isUniqueStringArray(normalizedDeleteKeys) ||
    patchKeys.some((key) => key.trim() === '' || key === 'id') ||
    normalizedDeleteKeys.some((key) => key === 'id' || Object.prototype.hasOwnProperty.call(patch, key))
  ) {
    return false
  }
  return patchKeys.length > 0 || normalizedDeleteKeys.length > 0
}

function promptItemMatchesSparseUpdate(finalItem: PromptItemSnapshot, patch: unknown, deleteKeys: unknown): boolean {
  const patchRecord = patch as Record<string, unknown>
  for (const [key, value] of Object.entries(patchRecord)) {
    if (!isJsonValueEqual(finalItem[key], value)) return false
  }
  for (const key of (deleteKeys === undefined ? [] : deleteKeys) as string[]) {
    if (Object.prototype.hasOwnProperty.call(finalItem, key)) return false
  }
  return true
}

function readPluginStorageLocalEffect(
  body: unknown,
  event: CommandEvent,
  operation: PluginStorageLocalEffect['operation'],
  expectedKey?: string,
): PluginStorageLocalEffect | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined
  if (event.resource !== 'pluginStorage') return undefined

  const expectedType =
    operation === 'put'
      ? 'pluginStorage.updated'
      : operation === 'delete'
        ? 'pluginStorage.deleted'
        : 'pluginStorage.bulkUpdated'
  if (event.type !== expectedType) return undefined

  if (operation === 'bulk') {
    if (event.id !== undefined) return undefined
    return { kind: 'pluginStorage', operation }
  }

  const key = (body as Record<string, unknown>).key
  if (key !== expectedKey || event.id !== expectedKey) return undefined
  return { kind: 'pluginStorage', operation, key: expectedKey }
}

interface ReadPluginCollectionMutationLocalEffectOptions {
  operation: PluginCollectionMutationLocalEffect['operation']
  expectedPluginId?: unknown
  expectedPluginIds?: unknown
  expectedEnabled?: boolean
  hasMutation?: boolean
}

function readPluginCollectionMutationLocalEffect(
  body: unknown,
  event: CommandEvent,
  options: ReadPluginCollectionMutationLocalEffectOptions,
): PluginCollectionMutationLocalEffect | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined
  if (event.resource !== 'pluginCollection') return undefined

  const expectedType =
    options.operation === 'create'
      ? 'plugin.created'
      : options.operation === 'update'
        ? 'plugin.updated'
        : options.operation === 'delete'
          ? 'plugin.deleted'
          : options.operation === 'enable'
            ? 'plugin.enabled'
            : 'plugin.reordered'
  if (event.type !== expectedType) return undefined

  if (options.operation === 'reorder') {
    if (event.id !== undefined || !isUniqueStringArray(options.expectedPluginIds)) return undefined
    return {
      kind: 'pluginCollectionMutation',
      operation: options.operation,
      pluginIds: [...options.expectedPluginIds],
    }
  }

  if (!nonEmptyString(options.expectedPluginId)) return undefined
  const record = body as Record<string, unknown>
  if (record.pluginId !== options.expectedPluginId || event.id !== options.expectedPluginId) return undefined
  if (options.operation === 'update' && options.hasMutation !== true) return undefined
  if (options.operation === 'enable' && record.enabled !== options.expectedEnabled) return undefined
  return {
    kind: 'pluginCollectionMutation',
    operation: options.operation,
    pluginId: options.expectedPluginId,
  }
}

function readPluginProviderLocalEffect(
  body: unknown,
  event: CommandEvent,
  expectedProvider: string,
): PluginProviderLocalEffect | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined
  if (!nonEmptyString(expectedProvider) && expectedProvider !== '') return undefined
  if (
    event.type !== 'plugin.provider.selected' ||
    event.resource !== 'pluginProvider' ||
    event.id !== expectedProvider ||
    (body as Record<string, unknown>).provider !== expectedProvider
  ) {
    return undefined
  }
  return { kind: 'pluginProvider', provider: expectedProvider }
}

interface ReadGlobalLorebookMutationLocalEffectOptions {
  operation: GlobalLorebookMutationLocalEffect['operation']
  expectedLorebook?: unknown
  expectedLorebookId?: unknown
  expectedLorebookIds?: unknown
  expectedPatch?: unknown
  expectedSelectedLorebookId?: unknown
  collectionProjectionEpoch?: unknown
  pageProjectionEpoch?: unknown
}

function readGlobalLorebookMutationLocalEffect(
  body: unknown,
  event: CommandEvent,
  options: ReadGlobalLorebookMutationLocalEffectOptions,
): GlobalLorebookMutationLocalEffect | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined

  const expectedType =
    options.operation === 'create'
      ? 'lorebook.created'
      : options.operation === 'update'
        ? 'lorebook.updated'
        : options.operation === 'delete'
          ? 'lorebook.deleted'
          : options.operation === 'reorder'
            ? 'lorebook.reordered'
            : 'lorebook.selected'
  if (event.type !== expectedType || event.resource !== 'globalLorebook' || event.parentId !== undefined) {
    return undefined
  }

  const record = body as Record<string, unknown>
  if (options.operation === 'create') {
    if (!isCanonicalGlobalLorebookCreate(options.expectedLorebook)) return undefined
    const lorebook = options.expectedLorebook as GlobalLorebookSnapshot
    if (
      record.lorebookId !== lorebook.id ||
      event.id !== lorebook.id ||
      !isProjectionEpoch(options.collectionProjectionEpoch)
    ) {
      return undefined
    }
    return {
      kind: 'globalLorebookMutation',
      operation: options.operation,
      lorebookId: lorebook.id,
      collectionProjectionEpoch: options.collectionProjectionEpoch,
    }
  }

  if (options.operation === 'update') {
    if (
      !nonEmptyString(options.expectedLorebookId) ||
      !isCanonicalGlobalLorebookNamePatch(options.expectedPatch) ||
      record.lorebookId !== options.expectedLorebookId ||
      event.id !== options.expectedLorebookId ||
      !isProjectionEpoch(options.collectionProjectionEpoch)
    ) {
      return undefined
    }
    return {
      kind: 'globalLorebookMutation',
      operation: options.operation,
      lorebookId: options.expectedLorebookId,
      collectionProjectionEpoch: options.collectionProjectionEpoch,
    }
  }

  if (options.operation === 'delete') {
    if (
      !nonEmptyString(options.expectedLorebookId) ||
      record.lorebookId !== options.expectedLorebookId ||
      event.id !== options.expectedLorebookId ||
      !isProjectionEpoch(options.collectionProjectionEpoch) ||
      !isProjectionEpoch(options.pageProjectionEpoch)
    ) {
      return undefined
    }
    return {
      kind: 'globalLorebookMutation',
      operation: options.operation,
      lorebookId: options.expectedLorebookId,
      collectionProjectionEpoch: options.collectionProjectionEpoch,
      pageProjectionEpoch: options.pageProjectionEpoch,
    }
  }

  if (options.operation === 'reorder') {
    if (
      event.id !== undefined ||
      !isUniqueStringArray(options.expectedLorebookIds) ||
      !isNullableNonEmptyString(options.expectedSelectedLorebookId) ||
      (options.expectedSelectedLorebookId !== null &&
        !options.expectedLorebookIds.includes(options.expectedSelectedLorebookId)) ||
      record.selectedLorebookId !== options.expectedSelectedLorebookId ||
      !isProjectionEpoch(options.collectionProjectionEpoch) ||
      !isProjectionEpoch(options.pageProjectionEpoch)
    ) {
      return undefined
    }
    return {
      kind: 'globalLorebookMutation',
      operation: options.operation,
      lorebookIds: [...options.expectedLorebookIds],
      selectedLorebookId: options.expectedSelectedLorebookId,
      collectionProjectionEpoch: options.collectionProjectionEpoch,
      pageProjectionEpoch: options.pageProjectionEpoch,
    }
  }

  if (
    !nonEmptyString(options.expectedLorebookId) ||
    options.expectedSelectedLorebookId !== options.expectedLorebookId ||
    record.selectedLorebookId !== options.expectedLorebookId ||
    event.id !== options.expectedLorebookId ||
    !isProjectionEpoch(options.pageProjectionEpoch)
  ) {
    return undefined
  }
  return {
    kind: 'globalLorebookMutation',
    operation: options.operation,
    lorebookId: options.expectedLorebookId,
    selectedLorebookId: options.expectedLorebookId,
    pageProjectionEpoch: options.pageProjectionEpoch,
  }
}

interface ReadLorebookMutationLocalEffectOptions {
  scope: LorebookMutationLocalEffect['scope']
  operation: LorebookMutationLocalEffect['operation']
  expectedTargetId: unknown
  expectedCharacterId?: unknown
  expectedEntries?: unknown
  expectedEntryId?: unknown
  expectedEntry?: unknown
  expectedEntryIndex?: unknown
  expectedEntryCreated?: unknown
  expectedEntryIds?: unknown
  optimisticEntries?: unknown
  collectionProjectionEpoch?: unknown
  characterRowProjectionEpoch?: unknown
  characterLorebookProjectionEpoch?: unknown
}

function readLorebookMutationLocalEffect(
  body: unknown,
  event: CommandEvent,
  options: ReadLorebookMutationLocalEffectOptions,
): LorebookMutationLocalEffect | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined
  if (!nonEmptyString(options.expectedTargetId)) return undefined
  if (!isCanonicalLorebookEntryArray(options.optimisticEntries)) return undefined

  const optimisticEntries = options.optimisticEntries as LorebookEntrySnapshot[]
  const optimisticIds = optimisticEntries.map((entry) => entry.id as string)
  if (options.operation === 'replace') {
    if (
      !isCanonicalLorebookEntryArray(options.expectedEntries) ||
      !isJsonValueEqual(options.expectedEntries, optimisticEntries)
    ) {
      return undefined
    }
  } else if (options.operation === 'upsert') {
    if (
      !nonEmptyString(options.expectedEntryId) ||
      !isCanonicalLorebookEntry(options.expectedEntry) ||
      (options.expectedEntry as LorebookEntrySnapshot).id !== options.expectedEntryId ||
      !Number.isInteger(options.expectedEntryIndex) ||
      (options.expectedEntryIndex as number) < 0 ||
      typeof options.expectedEntryCreated !== 'boolean'
    ) {
      return undefined
    }
    const optimisticMatches = optimisticEntries.filter((entry) => entry.id === options.expectedEntryId)
    if (
      optimisticMatches.length !== 1 ||
      !isJsonValueEqual(optimisticMatches[0], options.expectedEntry) ||
      optimisticEntries.findIndex((entry) => entry.id === options.expectedEntryId) !== options.expectedEntryIndex
    ) {
      return undefined
    }
  } else if (options.operation === 'delete') {
    if (
      !nonEmptyString(options.expectedEntryId) ||
      !Number.isInteger(options.expectedEntryIndex) ||
      (options.expectedEntryIndex as number) < 0 ||
      optimisticEntries.some((entry) => entry.id === options.expectedEntryId)
    ) {
      return undefined
    }
  } else if (
    !isUniqueStringArray(options.expectedEntryIds) ||
    !isJsonValueEqual(options.expectedEntryIds, optimisticIds)
  ) {
    return undefined
  }

  const record = body as Record<string, unknown>
  const targetResponseKey =
    options.scope === 'global' ? 'lorebookId' : options.scope === 'character' ? 'characterId' : 'chatId'
  const expectedResource =
    options.scope === 'global' ? 'globalLorebook' : options.scope === 'character' ? 'characterLorebook' : 'characterRow'
  if (
    event.type !== 'lorebook.entries.replaced' ||
    event.resource !== expectedResource ||
    event.id !== options.expectedTargetId ||
    record[targetResponseKey] !== options.expectedTargetId
  ) {
    return undefined
  }

  if (options.scope === 'chat') {
    if (!nonEmptyString(options.expectedCharacterId) || event.parentId !== options.expectedCharacterId) {
      return undefined
    }
  } else if (event.parentId !== undefined) {
    return undefined
  }

  if (options.operation === 'upsert' || options.operation === 'delete') {
    if (
      record.entryId !== options.expectedEntryId ||
      record.entryIndex !== options.expectedEntryIndex ||
      (options.operation === 'upsert' ? record.created !== options.expectedEntryCreated : record.created !== undefined)
    ) {
      return undefined
    }
  }

  if (options.scope === 'global') {
    if (!isProjectionEpoch(options.collectionProjectionEpoch)) return undefined
    return {
      kind: 'lorebookMutation',
      scope: options.scope,
      operation: options.operation,
      lorebookId: options.expectedTargetId,
      collectionProjectionEpoch: options.collectionProjectionEpoch,
    }
  }

  if (!isProjectionEpoch(options.characterRowProjectionEpoch)) return undefined
  if (options.scope === 'character') {
    if (!isProjectionEpoch(options.characterLorebookProjectionEpoch)) return undefined
    return {
      kind: 'lorebookMutation',
      scope: options.scope,
      operation: options.operation,
      characterId: options.expectedTargetId,
      characterRowProjectionEpoch: options.characterRowProjectionEpoch,
      characterLorebookProjectionEpoch: options.characterLorebookProjectionEpoch,
    }
  }

  return {
    kind: 'lorebookMutation',
    scope: options.scope,
    operation: options.operation,
    characterId: options.expectedCharacterId as string,
    chatId: options.expectedTargetId,
    characterRowProjectionEpoch: options.characterRowProjectionEpoch,
  }
}

interface ReadModuleCollectionMutationLocalEffectOptions {
  operation: ModuleCollectionMutationLocalEffect['operation']
  expectedModuleId?: unknown
  expectedModuleIds?: unknown
  expectedEntryId?: unknown
  entryResult?: 'upsert' | 'delete'
  hasCanonicalPayload?: boolean
  collectionProjectionEpoch?: unknown
}

function readModuleCollectionMutationLocalEffect(
  body: unknown,
  event: CommandEvent,
  options: ReadModuleCollectionMutationLocalEffectOptions,
): ModuleCollectionMutationLocalEffect | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined
  if (options.hasCanonicalPayload === false) return undefined

  const expectedType =
    options.operation === 'create'
      ? 'module.created'
      : options.operation === 'update'
        ? 'module.updated'
        : options.operation === 'reorder'
          ? 'module.reordered'
          : options.operation === 'lorebooks'
            ? 'lorebook.entries.replaced'
            : options.operation === 'scripts'
              ? 'scriptDefinitions.replaced'
              : 'triggerDefinitions.replaced'
  const expectedResource =
    options.operation === 'create'
      ? 'moduleCreated'
      : options.operation === 'reorder'
        ? 'moduleReordered'
        : options.operation === 'scripts'
          ? 'moduleScriptDefinition'
          : options.operation === 'triggers'
            ? 'moduleTriggerDefinition'
            : 'moduleUpdated'
  if (event.type !== expectedType || event.resource !== expectedResource || event.parentId !== undefined) {
    return undefined
  }

  const record = body as Record<string, unknown>
  if (record.revision !== event.revision) return undefined

  if (options.operation === 'reorder') {
    if (event.id !== undefined || !isUniqueStringArray(options.expectedModuleIds)) return undefined
    return {
      kind: 'moduleCollectionMutation',
      operation: options.operation,
      moduleIds: [...options.expectedModuleIds],
    }
  }

  if (!nonEmptyString(options.expectedModuleId)) return undefined
  if (record.moduleId !== options.expectedModuleId || event.id !== options.expectedModuleId) return undefined
  if (options.expectedEntryId !== undefined) {
    if (
      !nonEmptyString(options.expectedEntryId) ||
      record.entryId !== options.expectedEntryId ||
      !Number.isInteger(record.entryIndex) ||
      (record.entryIndex as number) < 0 ||
      (options.entryResult === 'upsert'
        ? typeof record.created !== 'boolean'
        : options.entryResult === 'delete'
          ? record.created !== undefined
          : false)
    ) {
      return undefined
    }
  }
  const definitionOperation = options.operation === 'scripts' || options.operation === 'triggers'
  if (definitionOperation && !isProjectionEpoch(options.collectionProjectionEpoch)) return undefined

  return {
    kind: 'moduleCollectionMutation',
    operation: options.operation,
    moduleId: options.expectedModuleId,
    ...(definitionOperation ? { collectionProjectionEpoch: options.collectionProjectionEpoch as number } : {}),
  }
}

function readModuleEnabledLocalEffect(
  body: unknown,
  event: CommandEvent,
  expectedModuleId: unknown,
  expectedEnabled: unknown,
): ModuleEnabledLocalEffect | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined
  if (!nonEmptyString(expectedModuleId) || typeof expectedEnabled !== 'boolean') return undefined
  const record = body as Record<string, unknown>
  if (
    event.type !== 'module.enabled' ||
    event.resource !== 'moduleEnabled' ||
    event.id !== expectedModuleId ||
    event.parentId !== undefined ||
    record.moduleId !== expectedModuleId ||
    record.enabled !== expectedEnabled
  ) {
    return undefined
  }
  return { kind: 'moduleEnabled', moduleId: expectedModuleId, enabled: expectedEnabled }
}

interface ReadLoadoutMutationLocalEffectOptions {
  operation: LoadoutMutationLocalEffect['operation']
  expectedLoadoutId: unknown
  expectedLoadout?: unknown
  expectedFavorite?: unknown
  expectedLastUsed?: unknown
  expectedCharacterId?: unknown
  loadoutsProjectionEpoch?: unknown
  settingsProjectionEpoch?: unknown
  loadedName?: unknown
}

function readLoadoutMutationLocalEffect(
  body: unknown,
  event: CommandEvent,
  options: ReadLoadoutMutationLocalEffectOptions,
): LoadoutMutationLocalEffect | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined
  if (!nonEmptyString(options.expectedLoadoutId)) return undefined
  if (!isProjectionEpoch(options.loadoutsProjectionEpoch)) return undefined
  const expectedType = {
    create: 'loadout.created',
    delete: 'loadout.deleted',
    favorite: 'loadout.favorited',
    touch: 'loadout.touched',
  }[options.operation]
  if (
    event.type !== expectedType ||
    event.resource !== 'loadout' ||
    event.id !== options.expectedLoadoutId ||
    event.parentId !== undefined ||
    (body as Record<string, unknown>).loadoutId !== options.expectedLoadoutId
  ) {
    return undefined
  }

  if (options.operation === 'create') {
    if (!isCanonicalLoadout(options.expectedLoadout) || options.expectedLoadout.id !== options.expectedLoadoutId) {
      return undefined
    }
    return {
      kind: 'loadoutMutation',
      operation: 'create',
      loadoutId: options.expectedLoadoutId,
      loadoutsProjectionEpoch: options.loadoutsProjectionEpoch,
    }
  }

  if (options.operation === 'delete') {
    return {
      kind: 'loadoutMutation',
      operation: 'delete',
      loadoutId: options.expectedLoadoutId,
      loadoutsProjectionEpoch: options.loadoutsProjectionEpoch,
    }
  }

  if (options.operation === 'favorite') {
    if (typeof options.expectedFavorite !== 'boolean') return undefined
    return {
      kind: 'loadoutMutation',
      operation: 'favorite',
      loadoutId: options.expectedLoadoutId,
      loadoutsProjectionEpoch: options.loadoutsProjectionEpoch,
    }
  }

  if (
    typeof options.expectedLastUsed !== 'number' ||
    !Number.isFinite(options.expectedLastUsed) ||
    (options.expectedCharacterId !== undefined && !nonEmptyString(options.expectedCharacterId)) ||
    !isProjectionEpoch(options.settingsProjectionEpoch) ||
    !nonEmptyString(options.loadedName)
  ) {
    return undefined
  }
  return {
    kind: 'loadoutMutation',
    operation: 'touch',
    loadoutId: options.expectedLoadoutId,
    loadoutsProjectionEpoch: options.loadoutsProjectionEpoch,
    settingsProjectionEpoch: options.settingsProjectionEpoch,
    loadedName: options.loadedName,
  }
}

function isProjectionEpoch(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0
}

function isCanonicalGlobalLorebookCreate(value: unknown): value is GlobalLorebookSnapshot & {
  id: string
  name: string
  data: LorebookEntrySnapshot[]
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as GlobalLorebookSnapshot
  return nonEmptyString(record.id) && nonEmptyString(record.name) && isCanonicalLorebookEntryArray(record.data)
}

function isCanonicalGlobalLorebookNamePatch(value: unknown): value is Pick<GlobalLorebookSnapshot, 'name'> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return Object.keys(record).length === 1 && nonEmptyString(record.name)
}

function isNullableNonEmptyString(value: unknown): value is string | null {
  return value === null || nonEmptyString(value)
}

function isCanonicalModuleCreate(value: ModuleSnapshot): boolean {
  return (
    nonEmptyString(value.id) &&
    typeof value.name === 'string' &&
    value.name.trim() !== '' &&
    typeof value.description === 'string'
  )
}

function readCharacterDefinitionMutationLocalEffect(
  body: unknown,
  event: CommandEvent,
  options: {
    operation: CharacterDefinitionMutationLocalEffect['operation']
    expectedCharacterId: unknown
    expectedDefinitions: unknown
    optimisticRowEpoch: unknown
  },
): CharacterDefinitionMutationLocalEffect | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined
  if (
    !nonEmptyString(options.expectedCharacterId) ||
    !isUniqueDefinitionArray(options.expectedDefinitions) ||
    !isProjectionEpoch(options.optimisticRowEpoch)
  ) {
    return undefined
  }
  const expectedType = options.operation === 'scripts' ? 'scriptDefinitions.replaced' : 'triggerDefinitions.replaced'
  const record = body as Record<string, unknown>
  if (
    record.revision !== event.revision ||
    event.type !== expectedType ||
    event.resource !== 'characterRow' ||
    event.id !== options.expectedCharacterId ||
    event.parentId !== undefined ||
    record.characterId !== options.expectedCharacterId
  ) {
    return undefined
  }
  return {
    kind: 'characterDefinitionMutation',
    operation: options.operation,
    characterId: options.expectedCharacterId,
    optimisticRowEpoch: options.optimisticRowEpoch,
  }
}

function isUniqueDefinitionArray(value: unknown): boolean {
  if (!Array.isArray(value)) return false
  const ids: string[] = []
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false
    const id = (candidate as Record<string, unknown>).id
    if (!nonEmptyString(id)) return false
    ids.push(id)
  }
  return new Set(ids).size === ids.length
}

function isCanonicalLorebookEntryArray(value: unknown): boolean {
  if (!Array.isArray(value) || !value.every(isCanonicalLorebookEntry)) return false
  const ids = value.map((entry) => (entry as Record<string, unknown>).id as string)
  return new Set(ids).size === ids.length
}

function isCanonicalLorebookEntry(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return (
    nonEmptyString(record.id) &&
    typeof record.key === 'string' &&
    typeof record.secondkey === 'string' &&
    typeof record.insertorder === 'number' &&
    Number.isFinite(record.insertorder) &&
    typeof record.comment === 'string' &&
    typeof record.content === 'string' &&
    typeof record.mode === 'string' &&
    typeof record.alwaysActive === 'boolean' &&
    typeof record.selective === 'boolean' &&
    (record.folder === undefined || typeof record.folder === 'string')
  )
}

function readMessageTranslationLocalEffect(
  body: unknown,
  event: CommandEvent,
  expectedMessageId: string,
): MessageTranslationLocalEffect | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined
  const record = body as Record<string, unknown>
  const chatId = record.chatId
  const messageId = record.messageId
  if (typeof chatId !== 'string' || chatId.trim() === '') return undefined
  if (messageId !== expectedMessageId) return undefined
  if (
    event.type !== 'message.updated' ||
    event.resource !== 'message' ||
    event.id !== messageId ||
    event.parentId !== chatId
  ) {
    return undefined
  }
  if (!isMessageTranslation(record.translation)) return undefined
  return {
    kind: 'messageTranslation',
    chatId,
    messageId,
    translation: cloneJsonValue(record.translation),
  }
}

function isMessageTranslation(value: unknown): value is MessageTranslation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return (
    record.source === 'raw' &&
    typeof record.text === 'string' &&
    typeof record.sourceHash === 'string' &&
    typeof record.targetLanguage === 'string' &&
    typeof record.inputLanguage === 'string' &&
    (record.translatorType === 'google' ||
      record.translatorType === 'deepl' ||
      record.translatorType === 'deeplX' ||
      record.translatorType === 'llm') &&
    typeof record.settingsHash === 'string' &&
    typeof record.updatedAt === 'number' &&
    Number.isFinite(record.updatedAt)
  )
}

interface ReadMessageMutationLocalEffectOptions {
  operation: MessageMutationLocalEffect['operation']
  expectedChatId?: string
  expectedMessageId?: string
  expectedAfterMessageId?: string | null
  expectedMessageIds?: Array<string | undefined>
}

function readMessageMutationLocalEffect(
  body: unknown,
  event: CommandEvent,
  options: ReadMessageMutationLocalEffectOptions,
): MessageMutationLocalEffect | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined
  const record = body as Record<string, unknown>
  const chatId = record.chatId
  if (typeof chatId !== 'string' || chatId.trim() === '') return undefined
  if (options.expectedChatId !== undefined && chatId !== options.expectedChatId) return undefined
  if (event.resource !== 'message' || event.parentId !== chatId) return undefined

  const expectedType =
    options.operation === 'append'
      ? 'message.appended'
      : options.operation === 'update'
        ? 'message.updated'
        : options.operation === 'delete'
          ? 'message.deleted'
          : options.operation === 'truncate'
            ? 'message.truncated'
            : 'messages.replaced'
  if (event.type !== expectedType) return undefined

  if (options.operation === 'append' || options.operation === 'update' || options.operation === 'delete') {
    const messageId = record.messageId
    if (
      typeof options.expectedMessageId !== 'string' ||
      options.expectedMessageId.trim() === '' ||
      messageId !== options.expectedMessageId ||
      event.id !== options.expectedMessageId
    ) {
      return undefined
    }
    return { kind: 'messageMutation', operation: options.operation, chatId, messageId }
  }

  if (event.id !== undefined) return undefined
  if (options.operation === 'truncate' || options.operation === 'replaceTail') {
    if (record.afterMessageId !== options.expectedAfterMessageId) return undefined
    if (!Number.isInteger(record.replacedCount ?? record.removedCount)) return undefined
  }
  if (options.operation === 'replaceTail') {
    if (!isUniqueStringArray(options.expectedMessageIds)) return undefined
  }
  if (options.operation === 'replaceAll' && !isNonEmptyStringArray(options.expectedMessageIds, true)) return undefined
  return { kind: 'messageMutation', operation: options.operation, chatId }
}

function readCharacterRowMutationLocalEffect(
  body: unknown,
  event: CommandEvent,
  operation: CharacterRowMutationLocalEffect['operation'],
  expectedTargetId: string,
): CharacterRowMutationLocalEffect | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined
  const responseKey = operation === 'chatFolderUpdate' ? 'folderId' : 'chatId'
  if ((body as Record<string, unknown>)[responseKey] !== expectedTargetId) return undefined
  const expectedType = operation === 'chatFolderUpdate' ? 'chatFolder.updated' : 'chat.scriptstate.updated'
  if (
    event.type !== expectedType ||
    event.resource !== 'characterRow' ||
    event.id !== expectedTargetId ||
    typeof event.parentId !== 'string' ||
    event.parentId.trim() === ''
  ) {
    return undefined
  }
  return {
    kind: 'characterRowMutation',
    operation,
    characterId: event.parentId,
    targetId: expectedTargetId,
  }
}

interface ReadChatStructureMutationLocalEffectOptions {
  operation: ChatStructureMutationLocalEffect['operation']
  expectedCharacterId?: unknown
  expectedTargetId?: unknown
  expectedSourceChatId?: unknown
  expectedIds?: unknown
  expectedChat?: ChatSnapshot
  expectedOptimisticEpoch?: unknown
  expectedOptimisticRowEpoch?: unknown
}

function readChatStructureMutationLocalEffect(
  body: unknown,
  event: CommandEvent,
  options: ReadChatStructureMutationLocalEffectOptions,
): ChatStructureMutationLocalEffect | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined
  if (
    !Number.isInteger(options.expectedOptimisticEpoch) ||
    hasDestructiveRefreshEpochChanged(options.expectedOptimisticEpoch as number)
  ) {
    return undefined
  }
  if (!Number.isInteger(options.expectedOptimisticRowEpoch)) return undefined
  if (!nonEmptyString(event.parentId)) return undefined
  if (options.expectedCharacterId !== undefined && event.parentId !== options.expectedCharacterId) return undefined

  const expectedType =
    options.operation === 'create'
      ? 'chat.created'
      : options.operation === 'delete'
        ? 'chat.deleted'
        : options.operation === 'fork'
          ? 'chat.forked'
          : options.operation === 'reorder'
            ? 'chat.reordered'
            : options.operation === 'folderCreate'
              ? 'chatFolder.created'
              : options.operation === 'folderDelete'
                ? 'chatFolder.deleted'
                : 'chatFolder.reordered'
  const allowsTranscriptResource = options.operation === 'create' || options.operation === 'fork'
  if (
    event.type !== expectedType ||
    (event.resource !== 'characterRow' && !(allowsTranscriptResource && event.resource === 'chatTranscript'))
  ) {
    return undefined
  }

  if (options.operation === 'reorder' || options.operation === 'folderReorder') {
    if (event.id !== undefined || !isUniqueStringArray(options.expectedIds)) return undefined
    return {
      kind: 'chatStructureMutation',
      operation: options.operation,
      characterId: event.parentId,
      attemptedIds: [...options.expectedIds],
      optimisticEpoch: options.expectedOptimisticEpoch as number,
      optimisticRowEpoch: options.expectedOptimisticRowEpoch as number,
    }
  }

  if (!nonEmptyString(options.expectedTargetId) || event.id !== options.expectedTargetId) return undefined
  const record = body as Record<string, unknown>
  const responseKey =
    options.operation === 'folderCreate' || options.operation === 'folderDelete' ? 'folderId' : 'chatId'
  if (record[responseKey] !== options.expectedTargetId) return undefined
  if (
    options.operation === 'fork' &&
    (!nonEmptyString(options.expectedSourceChatId) || record.sourceChatId !== options.expectedSourceChatId)
  ) {
    return undefined
  }

  if (options.operation === 'create' || options.operation === 'fork') {
    if (!options.expectedChat || !Object.prototype.hasOwnProperty.call(record, 'generationSettings')) {
      return undefined
    }
    const canonicalGenerationSettings = record.generationSettings
    if (
      canonicalGenerationSettings !== null &&
      (!canonicalGenerationSettings ||
        typeof canonicalGenerationSettings !== 'object' ||
        Array.isArray(canonicalGenerationSettings))
    ) {
      return undefined
    }
    return {
      kind: 'chatStructureMutation',
      operation: options.operation,
      characterId: event.parentId,
      targetId: options.expectedTargetId,
      attemptedGenerationSettings: cloneJsonValue(options.expectedChat.generationSettings ?? null),
      generationSettings: cloneJsonValue(canonicalGenerationSettings as ChatGenerationSettings | null),
      optimisticEpoch: options.expectedOptimisticEpoch as number,
      optimisticRowEpoch: options.expectedOptimisticRowEpoch as number,
    }
  }

  return {
    kind: 'chatStructureMutation',
    operation: options.operation,
    characterId: event.parentId,
    targetId: options.expectedTargetId,
    optimisticEpoch: options.expectedOptimisticEpoch as number,
    optimisticRowEpoch: options.expectedOptimisticRowEpoch as number,
  }
}

function isCanonicalOptimisticChatSnapshot(chat: ChatSnapshot): boolean {
  return (
    nonEmptyString(chat.id) &&
    Array.isArray(chat.message) &&
    typeof chat.note === 'string' &&
    typeof chat.name === 'string' &&
    chat.name.trim() !== '' &&
    Array.isArray(chat.localLore)
  )
}

function isCanonicalOptimisticChatFolderSnapshot(folder: ChatFolderSnapshot): boolean {
  return nonEmptyString(folder.id) && typeof folder.folded === 'boolean'
}

function readCharacterOrderLocalEffect(
  event: CommandEvent,
  attemptedOrder: CharacterOrderEntry[],
): CharacterOrderLocalEffect | undefined {
  if (event.type !== 'character.reordered' || event.resource !== 'characterOrder' || event.id !== undefined) {
    return undefined
  }
  if (!Array.isArray(attemptedOrder)) return undefined
  return { kind: 'characterOrder', attemptedOrder: cloneJsonValue(attemptedOrder) }
}

function isNonEmptyStringArray(value: unknown, allowEmpty = false): value is string[] {
  return (
    Array.isArray(value) &&
    (allowEmpty || value.length > 0) &&
    value.every((entry) => typeof entry === 'string' && entry.trim() !== '')
  )
}

function isUniqueStringArray(value: unknown): value is string[] {
  return isNonEmptyStringArray(value, true) && new Set(value).size === value.length
}

function isPlainJsonRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function readJsonFieldState(value: unknown): JsonFieldState | null {
  if (!isPlainJsonRecord(value) || typeof value.present !== 'boolean') return null
  const keys = Object.keys(value).sort()
  if (!value.present) return isJsonValueEqual(keys, ['present']) ? { present: false } : null
  if (!isJsonValueEqual(keys, ['present', 'value']) || !isJsonValue(value.value)) return null
  return { present: true, value: cloneJsonValue(value.value) }
}

function isJsonValue(value: unknown, ancestors = new Set<object>()): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (!value || typeof value !== 'object') return false
  if (ancestors.has(value)) return false

  const prototype = Object.getPrototypeOf(value)
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) return false

  ancestors.add(value)
  let valid = true
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, index) || !isJsonValue(value[index], ancestors)) {
        valid = false
        break
      }
    }
  } else {
    valid = Object.values(value).every((entry) => isJsonValue(entry, ancestors))
  }
  ancestors.delete(value)
  return valid
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

function readCharacterCollectionMutationLocalEffect(
  body: unknown,
  event: CommandEvent,
  operation: CharacterCollectionMutationLocalEffect['operation'],
  expectedCharacterId: unknown,
): CharacterCollectionMutationLocalEffect | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined
  if (!nonEmptyString(expectedCharacterId)) return undefined

  const record = body as Record<string, unknown>
  const characterId = record.characterId
  if (!nonEmptyString(characterId) || characterId !== expectedCharacterId) return undefined
  let selectedCharacterId: string | null
  if (record.selectedCharacterId === null) {
    selectedCharacterId = null
  } else if (nonEmptyString(record.selectedCharacterId)) {
    selectedCharacterId = record.selectedCharacterId
  } else {
    return undefined
  }

  const expectedType =
    operation === 'create'
      ? 'character.created'
      : operation === 'createAndSelect'
        ? 'character.createdAndSelected'
        : 'character.deleted'
  if (
    event.type !== expectedType ||
    event.resource !== 'character' ||
    event.id !== characterId ||
    event.parentId !== undefined
  ) {
    return undefined
  }
  if (operation === 'createAndSelect' ? selectedCharacterId !== characterId : selectedCharacterId === characterId) {
    return undefined
  }

  return {
    kind: 'characterCollectionMutation',
    operation,
    characterId,
    selectedCharacterId,
  }
}

function readCharacterPatchLocalEffect(
  body: unknown,
  event: CommandEvent,
  expectedCharacterId: string,
  patch: CharacterSnapshot,
): CharacterPatchLocalEffect | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined
  const characterId = (body as Record<string, unknown>).characterId
  if (characterId !== expectedCharacterId) return undefined
  if (event.resource !== 'characterRow' || event.id !== characterId) return undefined
  if (Object.keys(patch).length === 0) return undefined
  return {
    kind: 'characterPatch',
    characterId,
    patch: cloneJsonValue(patch),
  }
}

function readCharacterSelectionLocalEffect(
  body: unknown,
  event: CommandEvent,
  expectedCharacterId: string,
  lastInteraction: number | undefined,
): CharacterSelectionLocalEffect | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined
  const characterId = (body as Record<string, unknown>).characterId
  if (characterId !== expectedCharacterId) return undefined
  if (event.resource !== 'characterSelection' || event.id !== characterId) return undefined
  if (typeof lastInteraction !== 'number' || !Number.isFinite(lastInteraction)) return undefined
  return {
    kind: 'characterSelection',
    characterId,
    lastInteraction,
  }
}

function readChatPatchLocalEffect(
  body: unknown,
  event: CommandEvent,
  input: UpdateChatCommandInput,
): ChatPatchLocalEffect | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined
  const chatId = (body as Record<string, unknown>).chatId
  if (chatId !== input.chatId) return undefined
  if (event.resource !== 'characterRow' || event.id !== chatId) return undefined
  if (typeof event.parentId !== 'string' || event.parentId.trim() === '') return undefined
  const select = input.select === true
  if (Object.keys(input.patch).length === 0 && !select) return undefined
  return {
    kind: 'chatPatch',
    characterId: event.parentId,
    chatId,
    patch: cloneJsonValue(input.patch),
    select,
  }
}

function cloneJsonValue<T>(value: T): T {
  if (value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}

function isJsonValueEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function readCommandEvent(body: unknown): CommandEvent | null {
  if (!body || typeof body !== 'object') return null
  const event = (body as { event?: unknown }).event
  if (!event || typeof event !== 'object') return null
  const record = event as Record<string, unknown>
  if (typeof record.type !== 'string') return null
  if (!Number.isInteger(record.revision) || (record.revision as number) < 0) return null
  if (typeof record.resource !== 'string') return null
  const parsed: CommandEvent = {
    type: record.type,
    revision: record.revision as number,
    resource: record.resource,
  }
  if (typeof record.id === 'string') parsed.id = record.id
  if (typeof record.parentId === 'string') parsed.parentId = record.parentId
  if (record.origin && typeof record.origin === 'object') {
    const writerSessionId = (record.origin as { writerSessionId?: unknown }).writerSessionId
    if (typeof writerSessionId === 'string') {
      parsed.origin = { writerSessionId }
    }
  }
  return parsed
}

function readCurrentRevision(body: unknown): number | null {
  if (!body || typeof body !== 'object') return null
  const currentRevision = (body as { currentRevision?: unknown }).currentRevision
  return Number.isInteger(currentRevision) ? (currentRevision as number) : null
}

function errorMessageFromBody(body: unknown, fallback: string): string {
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>
    if (typeof record.error === 'string') return record.error
    if (typeof record.reason === 'string') return record.reason
  }
  return fallback
}
