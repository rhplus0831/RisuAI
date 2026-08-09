import { createHash, randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { EntityNotFoundError, ValidationError } from '../repository.js'
import {
  CHAT_GENERATION_SETTINGS_KEYS,
  CHAT_GENERATION_SETTINGS_FIELD,
  applySparseChatGenerationSettingsUpdate,
  resolveChatGenerationSettingsReadiness,
  serializeChatGenerationSettingsDigestInput,
  type ChatGenerationAgentReference,
  type ChatGenerationAgentPresetReference,
  type ChatGenerationModelPresetReference,
  type ChatGenerationModuleReference,
  type ChatGenerationPersonaReference,
  type ChatGenerationPromptPresetReference,
  type ChatGenerationSettings,
  type SparseChatGenerationSettingsUpdate,
} from '../../../../src/ts/chatGenerationSettings.js'
import { repairStoredChatGenerationSettings } from '../chatGenerationSettingsStorage.js'
import { type CharacterRecord, ensureCharacterCollection, readCharacterId, readJsonObject } from './characters.js'
import { repairCreatedLorebookEntries } from './lorebooks.js'

type JsonRecord = Record<string, unknown>

export interface ChatRecord extends JsonRecord {
  id: string
  message: unknown[]
  note: string
  name: string
  localLore: unknown[]
  scriptstate?: Record<string, string | number | boolean>
  folderId?: string | null
  hypaContextTruncationAcknowledged?: boolean
  selectedDraftHookId?: string
  autoTranslate?: boolean
  autoTranslateBotOnly?: boolean
  bilingualDisplay?: boolean
  bilingualEmphasis?: 'original' | 'translation'
  modules?: string[]
  generationSettings?: ChatGenerationSettings
}

export interface ChatFolderRecord extends JsonRecord {
  id: string
  name?: string
  color?: string
  folded: boolean
}

export interface ChatLocation {
  character: CharacterRecord
  characterIndex: number
  chat: ChatRecord
  chatIndex: number
}

type ChatGenerationPromptPresetWithModuleIntegration = ChatGenerationPromptPresetReference & {
  moduleIntergration?: unknown
}

export interface ChatGenerationSettingsValidationContext {
  personas: readonly ChatGenerationPersonaReference[]
  modelPresets: readonly ChatGenerationModelPresetReference[]
  promptPresets: readonly ChatGenerationPromptPresetWithModuleIntegration[]
  agentPresets?: readonly ChatGenerationAgentPresetReference[]
  agents?: readonly ChatGenerationAgentReference[]
  effectiveAgentPresetId?: string
  modules?: readonly ChatGenerationModuleReference[]
  enabledModuleIds?: readonly string[]
  characterModuleIds?: readonly string[]
  chatModuleIds?: readonly string[]
}

const ALLOWED_CHAT_PATCH_KEYS = new Set([
  'name',
  'note',
  'sdData',
  'lastMemory',
  'hypaContextTruncationAcknowledged',
  'suggestMessages',
  'bindedPersona',
  'fmIndex',
  'selectedDraftHookId',
  'autoTranslate',
  'autoTranslateBotOnly',
  'bilingualDisplay',
  'bilingualEmphasis',
  'folderId',
  'lastDate',
  'bookmarks',
  'bookmarkNames',
  'modules',
])

const ALLOWED_CHAT_FOLDER_PATCH_KEYS = new Set(['name', 'color', 'folded'])
const ALLOWED_CHAT_GENERATION_SETTINGS_KEYS = new Set<string>(CHAT_GENERATION_SETTINGS_KEYS)

export function ensureCharacterChats(character: CharacterRecord): ChatRecord[] {
  if (!Array.isArray(character.chats)) {
    character.chats = []
  }

  const seen = new Set<string>()
  const chats = (character.chats as unknown[]).map((raw, index) => {
    const chat = repairChatRecord(
      {
        message: [],
        note: '',
        name: `New Chat ${index + 1}`,
        localLore: [],
        fmIndex: -1,
        ...readOptionalJsonObject(raw),
      },
      `chat[${index}]`,
    )
    if (seen.has(chat.id)) {
      chat.id = randomUUID()
    }
    seen.add(chat.id)
    return chat
  })
  character.chats = chats

  const folders = ensureCharacterChatFolders(character)
  const folderIds = new Set(folders.map((folder) => folder.id))
  for (const chat of chats) {
    if (chat.folderId !== undefined && chat.folderId !== null && !folderIds.has(chat.folderId)) {
      chat.folderId = null
    }
  }

  normalizeChatPage(character, chats)
  return chats
}

export function ensureCharacterChatFolders(character: CharacterRecord): ChatFolderRecord[] {
  if (!Array.isArray(character.chatFolders)) {
    character.chatFolders = []
  }

  const seen = new Set<string>()
  const folders = (character.chatFolders as unknown[]).map((raw, index) => {
    const folder = repairChatFolderRecord(
      {
        name: `New Folder ${index + 1}`,
        folded: false,
        ...readOptionalJsonObject(raw),
      },
      `chatFolder[${index}]`,
    )
    if (seen.has(folder.id)) {
      folder.id = randomUUID()
    }
    seen.add(folder.id)
    return folder
  })
  character.chatFolders = folders
  return folders
}

export function chatFolderIdExists(characters: readonly CharacterRecord[], folderId: string): boolean {
  return characters.some(
    (character) =>
      Array.isArray(character.chatFolders) &&
      (character.chatFolders as unknown[]).some(
        (folder) =>
          !!folder && typeof folder === 'object' && !Array.isArray(folder) && (folder as JsonRecord).id === folderId,
      ),
  )
}

export function chatIdExists(characters: readonly CharacterRecord[], chatId: string): boolean {
  return characters.some(
    (character) =>
      Array.isArray(character.chats) &&
      (character.chats as unknown[]).some(
        (chat) => !!chat && typeof chat === 'object' && !Array.isArray(chat) && (chat as JsonRecord).id === chatId,
      ),
  )
}

export function createChatRecord(input: unknown, label = 'chat'): ChatRecord {
  const chat = readJsonObject(input, label) as ChatRecord
  chat.id = readChatId(chat.id, `${label}.id`)
  chat.message = Array.isArray(chat.message) ? chat.message : []
  chat.note = typeof chat.note === 'string' ? chat.note : ''
  chat.name = typeof chat.name === 'string' && chat.name.trim() ? chat.name : 'New Chat'
  chat.localLore = repairCreatedLorebookEntries(
    Array.isArray(chat.localLore) ? chat.localLore : [],
    `${label}.localLore`,
  )
  validateChatRecord(chat, label)
  return chat
}

export function createChatFolderRecord(input: unknown, label = 'folder'): ChatFolderRecord {
  const folder = readJsonObject(input, label) as ChatFolderRecord
  folder.id = readChatFolderId(folder.id, `${label}.id`)
  folder.folded = typeof folder.folded === 'boolean' ? folder.folded : false
  validateChatFolderRecord(folder, label)
  return folder
}

function repairChatRecord(input: unknown, label = 'chat'): ChatRecord {
  const chat = readJsonObject(input, label) as ChatRecord
  chat.id = typeof chat.id === 'string' && chat.id.trim() ? chat.id : randomUUID()
  chat.message = Array.isArray(chat.message) ? chat.message : []
  chat.note = typeof chat.note === 'string' ? chat.note : ''
  chat.name = typeof chat.name === 'string' && chat.name.trim() ? chat.name : 'New Chat'
  chat.localLore = Array.isArray(chat.localLore) ? chat.localLore : []
  repairStoredChatGenerationSettings(chat)
  validateChatRecord(chat, label)
  return chat
}

function repairChatFolderRecord(input: unknown, label = 'folder'): ChatFolderRecord {
  const folder = readJsonObject(input, label) as ChatFolderRecord
  folder.id = typeof folder.id === 'string' && folder.id.trim() ? folder.id : randomUUID()
  folder.folded = typeof folder.folded === 'boolean' ? folder.folded : false
  validateChatFolderRecord(folder, label)
  return folder
}

export function readChatId(value: unknown, label = 'chatId'): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ValidationError(`${label} must be a non-empty string`)
  }
  return value
}

export function readChatPatch(input: unknown, options: { allowEmpty?: boolean } = {}): JsonRecord {
  const patch = readJsonObject(input ?? {}, 'patch')
  if (!options.allowEmpty && Object.keys(patch).length === 0) {
    throw new ValidationError('patch must include at least one chat field')
  }
  for (const key of Object.keys(patch)) {
    if (!ALLOWED_CHAT_PATCH_KEYS.has(key)) {
      throw new ValidationError(`patch.${key} is owned by a later command slice`)
    }
  }
  validateChatRecord(patch, 'patch', { partial: true })
  return patch
}

export function readChatFolderPatch(input: unknown): JsonRecord {
  const patch = readJsonObject(input, 'patch')
  if (Object.keys(patch).length === 0) {
    throw new ValidationError('patch must include at least one chat folder field')
  }
  for (const key of Object.keys(patch)) {
    if (!ALLOWED_CHAT_FOLDER_PATCH_KEYS.has(key)) {
      throw new ValidationError(`patch.${key} is not supported for chat folder commands`)
    }
  }
  validateChatFolderRecord(patch, 'patch', { partial: true })
  return patch
}

export function readChatIdList(input: unknown, label = 'chatIds'): string[] {
  if (!Array.isArray(input)) {
    throw new ValidationError(`${label} must be an array`)
  }
  return input.map((id, index) => readChatId(id, `${label}[${index}]`))
}

export function readChatFolderId(value: unknown, label = 'folderId'): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ValidationError(`${label} must be a non-empty string`)
  }
  return value
}

export function readChatFolderIdList(input: unknown, label = 'folderIds'): string[] {
  if (!Array.isArray(input)) {
    throw new ValidationError(`${label} must be an array`)
  }
  return input.map((id, index) => readChatFolderId(id, `${label}[${index}]`))
}

export function readOptionalBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') {
    throw new ValidationError(`${label} must be a boolean`)
  }
  return value
}

export function readOptionalFolderByChatId(value: unknown): Record<string, string | null> {
  if (value === undefined) return {}
  const map = readJsonObject(value, 'folderByChatId')
  const normalized: Record<string, string | null> = {}
  for (const [chatId, folderId] of Object.entries(map)) {
    readChatId(chatId, 'folderByChatId key')
    if (folderId !== null) {
      readChatFolderId(folderId, `folderByChatId.${chatId}`)
    }
    normalized[chatId] = folderId as string | null
  }
  return normalized
}

export function readChatScriptstatePatch(input: unknown): Record<string, string | number | boolean> {
  const patch = readJsonObject(input ?? {}, 'patch')
  for (const [key, value] of Object.entries(patch)) {
    validateScriptstateKey(key, `patch key`)
    validateScriptstateValue(value, `patch.${key}`)
  }
  return patch as Record<string, string | number | boolean>
}

export function readChatScriptstateDeleteKeys(input: unknown): string[] {
  if (input === undefined) return []
  if (!Array.isArray(input)) {
    throw new ValidationError('deleteKeys must be an array')
  }
  return input.map((key, index) => {
    if (typeof key !== 'string') {
      throw new ValidationError(`deleteKeys[${index}] must be a string`)
    }
    validateScriptstateKey(key, `deleteKeys[${index}]`)
    return key
  })
}

export function validateChatScriptstateCommand(
  patch: Record<string, string | number | boolean>,
  deleteKeys: readonly string[],
): void {
  if (Object.keys(patch).length === 0 && deleteKeys.length === 0) {
    throw new ValidationError('scriptstate command must include patch fields or deleteKeys')
  }
  const seenDeleteKeys = new Set<string>()
  for (const key of deleteKeys) {
    if (seenDeleteKeys.has(key)) {
      throw new ValidationError(`Duplicate delete key: ${key}`)
    }
    seenDeleteKeys.add(key)
  }
}

export type ChatGenerationSettingsWrite =
  | {
      mode: 'full'
      requested: ChatGenerationSettings
      canonical: ChatGenerationSettings
    }
  | {
      mode: 'sparse'
      requested: ChatGenerationSettings
      canonical: ChatGenerationSettings
      update: SparseChatGenerationSettingsUpdate
      baseMatches: boolean
    }

export interface ChatGenerationSettingsSparseReceipt {
  certificate: 'chat-generation-settings-sparse-v1'
  patchedKeys: string[]
  deletedKeys: string[]
  sidebarTogglePatchedKeys: string[]
  sidebarToggleDeletedKeys: string[]
  prunedSidebarToggleKeys: string[]
}

export function readChatGenerationSettingsWrite(
  input: unknown,
  current: ChatGenerationSettings | undefined,
  context: ChatGenerationSettingsValidationContext,
): ChatGenerationSettingsWrite {
  const body = readJsonObject(input, 'body')
  const hasFullSettings = hasOwn(body, 'generationSettings')
  const hasSparseFields =
    hasOwn(body, 'patch') ||
    hasOwn(body, 'deleteKeys') ||
    hasOwn(body, 'sidebarToggleDeleteKeys') ||
    hasOwn(body, 'baseGenerationSettingsDigest')
  if (hasFullSettings && hasSparseFields) {
    throw new ValidationError('generationSettings cannot be combined with sparse update fields')
  }

  if (hasFullSettings) {
    const canonical = readChatGenerationSettingsSave(body.generationSettings, context)
    return {
      mode: 'full',
      requested: cloneJsonValue(body.generationSettings as ChatGenerationSettings),
      canonical,
    }
  }

  const unsupportedBodyKey = Object.keys(body).find(
    (key) =>
      key !== 'baseRevision' &&
      key !== 'baseGenerationSettingsDigest' &&
      key !== 'patch' &&
      key !== 'deleteKeys' &&
      key !== 'sidebarToggleDeleteKeys',
  )
  if (unsupportedBodyKey) {
    throw new ValidationError(`Unsupported sparse generation settings field: ${unsupportedBodyKey}`)
  }

  const rawPatch = body.patch === undefined ? {} : readJsonObject(body.patch, 'patch')
  const patch: Partial<ChatGenerationSettings> = {}
  for (const [key, value] of Object.entries(rawPatch)) {
    if (!ALLOWED_CHAT_GENERATION_SETTINGS_KEYS.has(key)) {
      throw new ValidationError(`generationSettings.${key} is not supported`)
    }
    if (key === 'sidebarToggles') {
      patch.sidebarToggles = readSidebarToggleValueMap(value, 'generationSettings.sidebarToggles')
    } else {
      ;(patch as Record<string, unknown>)[key] = cloneJsonValue(value)
    }
  }

  const deleteKeys = readUniqueNonEmptyStringList(body.deleteKeys, 'deleteKeys')
  for (const key of deleteKeys) {
    if (!ALLOWED_CHAT_GENERATION_SETTINGS_KEYS.has(key)) {
      throw new ValidationError(`Unsupported generation settings delete key: ${key}`)
    }
    if (key === 'jailbreakToggle') {
      throw new ValidationError('generationSettings.jailbreakToggle cannot be deleted')
    }
    if (hasOwn(patch, key)) {
      throw new ValidationError(`patch and deleteKeys must not overlap: ${key}`)
    }
  }

  const sidebarToggleDeleteKeys = readUniqueNonEmptyStringList(body.sidebarToggleDeleteKeys, 'sidebarToggleDeleteKeys')
  if (
    deleteKeys.includes('sidebarToggles') &&
    (hasOwn(patch, 'sidebarToggles') || sidebarToggleDeleteKeys.length > 0)
  ) {
    throw new ValidationError('sidebarToggles deletion cannot be combined with nested toggle updates')
  }
  for (const key of sidebarToggleDeleteKeys) {
    if (Object.prototype.hasOwnProperty.call(patch.sidebarToggles ?? {}, key)) {
      throw new ValidationError(`sidebar toggle patch and delete keys must not overlap: ${key}`)
    }
  }
  if (Object.keys(patch).length === 0 && deleteKeys.length === 0 && sidebarToggleDeleteKeys.length === 0) {
    throw new ValidationError('sparse generation settings update must include at least one field')
  }

  if (
    typeof body.baseGenerationSettingsDigest !== 'string' ||
    !/^[a-f0-9]{64}$/.test(body.baseGenerationSettingsDigest)
  ) {
    throw new ValidationError('baseGenerationSettingsDigest must be a SHA-256 hex string')
  }

  const update: SparseChatGenerationSettingsUpdate = {
    patch,
    ...(deleteKeys.length ? { deleteKeys: deleteKeys as SparseChatGenerationSettingsUpdate['deleteKeys'] } : {}),
    ...(sidebarToggleDeleteKeys.length ? { sidebarToggleDeleteKeys } : {}),
  }
  const requested = applySparseChatGenerationSettingsUpdate(current, update)
  return {
    mode: 'sparse',
    requested,
    canonical: readChatGenerationSettingsSave(requested, context),
    update,
    baseMatches:
      body.baseGenerationSettingsDigest ===
      createHash('sha256').update(serializeChatGenerationSettingsDigestInput(current), 'utf8').digest('hex'),
  }
}

export function buildChatGenerationSettingsSparseReceipt(
  write: Extract<ChatGenerationSettingsWrite, { mode: 'sparse' }>,
): ChatGenerationSettingsSparseReceipt | null {
  if (!write.baseMatches) return null
  const prunedSidebarToggleKeys = Object.keys(write.requested.sidebarToggles ?? {}).filter(
    (key) => !Object.prototype.hasOwnProperty.call(write.canonical.sidebarToggles ?? {}, key),
  )
  const reconstructed = cloneJsonValue(write.requested)
  if (reconstructed.sidebarToggles) {
    for (const key of prunedSidebarToggleKeys) delete reconstructed.sidebarToggles[key]
  }
  if (!isDeepStrictEqual(reconstructed, write.canonical)) return null

  return {
    certificate: 'chat-generation-settings-sparse-v1',
    patchedKeys: Object.keys(write.update.patch).sort(),
    deletedKeys: [...(write.update.deleteKeys ?? [])].sort(),
    sidebarTogglePatchedKeys: Object.keys(write.update.patch.sidebarToggles ?? {}).sort(),
    sidebarToggleDeletedKeys: [...(write.update.sidebarToggleDeleteKeys ?? [])].sort(),
    prunedSidebarToggleKeys: prunedSidebarToggleKeys.sort(),
  }
}

export function readChatGenerationSettingsSave(
  input: unknown,
  context: ChatGenerationSettingsValidationContext,
  label = CHAT_GENERATION_SETTINGS_FIELD,
): ChatGenerationSettings {
  const raw = readJsonObject(input, label)
  const normalized: ChatGenerationSettings = {}

  for (const key of Object.keys(raw)) {
    if (
      key !== 'configured' &&
      key !== 'personaId' &&
      key !== 'modelPresetId' &&
      key !== 'modelPresetSelectionSource' &&
      key !== 'promptPresetId' &&
      key !== 'agentPresetId' &&
      key !== 'togglePresetId' &&
      key !== 'jailbreakToggle' &&
      key !== 'sidebarToggles'
    ) {
      throw new ValidationError(`${label}.${key} is not supported`)
    }
  }

  if (hasOwn(raw, 'configured')) {
    if (typeof raw.configured !== 'boolean') {
      throw new ValidationError(`${label}.configured must be a boolean`)
    }
    normalized.configured = raw.configured
  }

  if (hasOwn(raw, 'personaId')) {
    if (typeof raw.personaId !== 'string') {
      throw new ValidationError(`${label}.personaId must be a string`)
    }
    normalized.personaId = raw.personaId
    if (raw.personaId.trim() !== '' && !context.personas.some((persona) => persona.id === raw.personaId)) {
      throw new ValidationError(`Unknown persona id in ${label}.personaId: ${raw.personaId}`)
    }
  }

  if (hasOwn(raw, 'modelPresetId')) {
    if (typeof raw.modelPresetId !== 'string') {
      throw new ValidationError(`${label}.modelPresetId must be a string`)
    }
    normalized.modelPresetId = raw.modelPresetId
    if (raw.modelPresetId.trim() !== '' && !context.modelPresets.some((preset) => preset.id === raw.modelPresetId)) {
      throw new ValidationError(`Unknown model preset id in ${label}.modelPresetId: ${raw.modelPresetId}`)
    }
  }

  if (hasOwn(raw, 'modelPresetSelectionSource')) {
    if (raw.modelPresetSelectionSource !== 'manual' && raw.modelPresetSelectionSource !== 'prompt-recommendation') {
      throw new ValidationError(`${label}.modelPresetSelectionSource must be manual or prompt-recommendation`)
    }
    if (typeof normalized.modelPresetId !== 'string' || normalized.modelPresetId.trim() === '') {
      throw new ValidationError(`${label}.modelPresetSelectionSource requires modelPresetId`)
    }
    normalized.modelPresetSelectionSource = raw.modelPresetSelectionSource
  }

  if (hasOwn(raw, 'promptPresetId')) {
    if (typeof raw.promptPresetId !== 'string') {
      throw new ValidationError(`${label}.promptPresetId must be a string`)
    }
    normalized.promptPresetId = raw.promptPresetId
    if (raw.promptPresetId.trim() !== '' && !context.promptPresets.some((preset) => preset.id === raw.promptPresetId)) {
      throw new ValidationError(`Unknown prompt preset id in ${label}.promptPresetId: ${raw.promptPresetId}`)
    }
  }

  if (hasOwn(raw, 'agentPresetId')) {
    if (typeof raw.agentPresetId !== 'string') {
      throw new ValidationError(`${label}.agentPresetId must be a string`)
    }
    normalized.agentPresetId = raw.agentPresetId
    if (
      raw.agentPresetId.trim() !== '' &&
      context.agentPresets &&
      !context.agentPresets.some((preset) => preset.id === raw.agentPresetId)
    ) {
      throw new ValidationError(`Unknown agent preset id in ${label}.agentPresetId: ${raw.agentPresetId}`)
    }
  }

  if (hasOwn(raw, 'togglePresetId')) {
    if (typeof raw.togglePresetId !== 'string') {
      throw new ValidationError(`${label}.togglePresetId must be a string`)
    }
    normalized.togglePresetId = raw.togglePresetId
  }

  if (!hasOwn(raw, 'jailbreakToggle')) {
    throw new ValidationError(`${label}.jailbreakToggle must be present`)
  }
  if (typeof raw.jailbreakToggle !== 'boolean') {
    throw new ValidationError(`${label}.jailbreakToggle must be a boolean`)
  }
  normalized.jailbreakToggle = raw.jailbreakToggle

  if (hasOwn(raw, 'sidebarToggles')) {
    normalized.sidebarToggles = readSidebarToggleValueMap(raw.sidebarToggles, `${label}.sidebarToggles`)
  }

  const selectedPromptPreset = isNonEmptyString(normalized.promptPresetId)
    ? context.promptPresets.find((preset) => preset.id === normalized.promptPresetId)
    : undefined
  const readiness = resolveChatGenerationSettingsReadiness({
    ...context,
    settings: normalized,
    moduleIntegration: readOptionalStringValue(selectedPromptPreset?.moduleIntergration),
  })
  if (readiness.staleSidebarToggleKeys.length > 0 && normalized.sidebarToggles) {
    const pruned = { ...normalized.sidebarToggles }
    for (const key of readiness.staleSidebarToggleKeys) {
      delete pruned[key]
    }
    normalized.sidebarToggles = pruned
  }

  return normalized
}

export function requireChatLocation(characters: readonly CharacterRecord[], chatId: string): ChatLocation {
  for (let characterIndex = 0; characterIndex < characters.length; characterIndex++) {
    const character = characters[characterIndex]
    const chats = ensureCharacterChats(character)
    const chatIndex = chats.findIndex((chat) => chat.id === chatId)
    if (chatIndex !== -1) {
      return {
        character,
        characterIndex,
        chat: chats[chatIndex],
        chatIndex,
      }
    }
  }
  throw new EntityNotFoundError(`Chat not found: ${chatId}`)
}

export function requireCharacterChat(
  character: CharacterRecord,
  chatId: string,
): { chat: ChatRecord; chatIndex: number } {
  const chats = ensureCharacterChats(character)
  const chatIndex = chats.findIndex((chat) => chat.id === chatId)
  if (chatIndex === -1) {
    throw new EntityNotFoundError(`Chat not found for character ${character.chaId}: ${chatId}`)
  }
  return { chat: chats[chatIndex], chatIndex }
}

export function requireChatFolderIndex(
  characters: readonly CharacterRecord[],
  folderId: string,
): { character: CharacterRecord; characterIndex: number; folderIndex: number } {
  for (let characterIndex = 0; characterIndex < characters.length; characterIndex++) {
    const character = characters[characterIndex]
    const folders = ensureCharacterChatFolders(character)
    const folderIndex = folders.findIndex((folder) => folder.id === folderId)
    if (folderIndex !== -1) {
      ensureCharacterChats(character)
      return { character, characterIndex, folderIndex }
    }
  }
  throw new EntityNotFoundError(`Chat folder not found: ${folderId}`)
}

export function validateFullChatOrder(
  character: CharacterRecord,
  chatIds: readonly string[],
  folderByChatId: Record<string, string | null> = {},
): void {
  const chats = ensureCharacterChats(character)
  const existing = new Set(chats.map((chat) => chat.id))
  const seen = new Set<string>()
  for (const chatId of chatIds) {
    if (!existing.has(chatId)) {
      throw new ValidationError(`Unknown chat id in chatIds: ${chatId}`)
    }
    if (seen.has(chatId)) {
      throw new ValidationError(`Duplicate chat id in chatIds: ${chatId}`)
    }
    seen.add(chatId)
  }
  if (seen.size !== existing.size) {
    throw new ValidationError('chatIds must include every chat for the character')
  }

  const folderIds = new Set(ensureCharacterChatFolders(character).map((folder) => folder.id))
  for (const [chatId, folderId] of Object.entries(folderByChatId)) {
    if (!existing.has(chatId)) {
      throw new ValidationError(`Unknown chat id in folderByChatId: ${chatId}`)
    }
    if (folderId !== null && !folderIds.has(folderId)) {
      throw new ValidationError(`Unknown chat folder id in folderByChatId: ${folderId}`)
    }
  }
}

export function validateFullChatFolderOrder(character: CharacterRecord, folderIds: readonly string[]): void {
  const folders = ensureCharacterChatFolders(character)
  const existing = new Set(folders.map((folder) => folder.id))
  const seen = new Set<string>()
  for (const folderId of folderIds) {
    if (!existing.has(folderId)) {
      throw new ValidationError(`Unknown chat folder id in folderIds: ${folderId}`)
    }
    if (seen.has(folderId)) {
      throw new ValidationError(`Duplicate chat folder id in folderIds: ${folderId}`)
    }
    seen.add(folderId)
  }
  if (seen.size !== existing.size) {
    throw new ValidationError('folderIds must include every chat folder for the character')
  }
}

export function selectedChatId(character: CharacterRecord): string | null {
  const chats = ensureCharacterChats(character)
  const index = Number.isInteger(character.chatPage as number) ? (character.chatPage as number) : -1
  return chats[index]?.id ?? null
}

export function selectChat(character: CharacterRecord, chatId: string): void {
  const { chatIndex } = requireCharacterChat(character, chatId)
  character.chatPage = chatIndex
}

export function normalizeAllCharacterChats(database: unknown): CharacterRecord[] {
  const target = readJsonObject(database, 'database')
  const characters = ensureCharacterCollection(target)
  for (const character of characters) {
    ensureCharacterChats(character)
  }
  normalizeGlobalChatIds(characters)
  normalizeGlobalChatFolderIds(characters)
  return characters
}

function normalizeGlobalChatIds(characters: readonly CharacterRecord[]): void {
  const seen = new Set<string>()
  for (const character of characters) {
    for (const chat of ensureCharacterChats(character)) {
      if (seen.has(chat.id)) {
        do {
          chat.id = randomUUID()
        } while (seen.has(chat.id))
      }
      seen.add(chat.id)
    }
  }
}

function normalizeGlobalChatFolderIds(characters: readonly CharacterRecord[]): void {
  const seen = new Set<string>()
  for (const character of characters) {
    const folders = ensureCharacterChatFolders(character)
    const renamed = new Map<string, string>()
    for (const folder of folders) {
      if (seen.has(folder.id)) {
        const previousId = folder.id
        do {
          folder.id = randomUUID()
        } while (seen.has(folder.id))
        renamed.set(previousId, folder.id)
      }
      seen.add(folder.id)
    }
    if (renamed.size === 0) continue
    for (const chat of character.chats as ChatRecord[]) {
      if (chat.folderId && renamed.has(chat.folderId)) {
        chat.folderId = renamed.get(chat.folderId)!
      }
    }
  }
}

function normalizeChatPage(character: CharacterRecord, chats: readonly ChatRecord[]): void {
  if (!Number.isInteger(character.chatPage as number)) {
    character.chatPage = chats.length > 0 ? 0 : -1
  }
  if ((character.chatPage as number) >= chats.length) {
    character.chatPage = chats.length > 0 ? chats.length - 1 : -1
  }
  if ((character.chatPage as number) < -1) {
    character.chatPage = chats.length > 0 ? 0 : -1
  }
}

function readOptionalJsonObject(value: unknown): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }
  return value as JsonRecord
}

function validateChatRecord(record: JsonRecord, label: string, options: { partial?: boolean } = {}): void {
  if ('id' in record && (typeof record.id !== 'string' || record.id.trim() === '')) {
    throw new ValidationError(`${label}.id must be a non-empty string`)
  }
  if (!options.partial || 'name' in record) {
    if (typeof record.name !== 'string') {
      throw new ValidationError(`${label}.name must be a string`)
    }
  }
  if (!options.partial || 'note' in record) {
    if (typeof record.note !== 'string') {
      throw new ValidationError(`${label}.note must be a string`)
    }
  }
  if (!options.partial || 'message' in record) {
    if (!Array.isArray(record.message)) {
      throw new ValidationError(`${label}.message must be an array`)
    }
  }
  if (!options.partial || 'localLore' in record) {
    if (!Array.isArray(record.localLore)) {
      throw new ValidationError(`${label}.localLore must be an array`)
    }
  }
  if (
    'folderId' in record &&
    record.folderId !== null &&
    record.folderId !== undefined &&
    (typeof record.folderId !== 'string' || record.folderId.trim() === '')
  ) {
    throw new ValidationError(`${label}.folderId must be a non-empty string or null`)
  }
  if ('bindedPersona' in record && typeof record.bindedPersona !== 'string') {
    throw new ValidationError(`${label}.bindedPersona must be a string`)
  }
  if (
    'bookmarks' in record &&
    (!Array.isArray(record.bookmarks) || record.bookmarks.some((id) => typeof id !== 'string' || id.trim() === ''))
  ) {
    throw new ValidationError(`${label}.bookmarks must be an array of message ids`)
  }
  if ('bookmarkNames' in record) {
    validateStringRecord(record.bookmarkNames, `${label}.bookmarkNames`)
  }
  if (
    'modules' in record &&
    (!Array.isArray(record.modules) || record.modules.some((id) => typeof id !== 'string' || id.trim() === ''))
  ) {
    throw new ValidationError(`${label}.modules must be an array of module ids`)
  }
  if (
    'fmIndex' in record &&
    record.fmIndex !== undefined &&
    record.fmIndex !== null &&
    (typeof record.fmIndex !== 'number' || !Number.isFinite(record.fmIndex))
  ) {
    throw new ValidationError(`${label}.fmIndex must be a finite number, null, or undefined`)
  }
  if (
    'selectedDraftHookId' in record &&
    record.selectedDraftHookId !== undefined &&
    record.selectedDraftHookId !== null &&
    (typeof record.selectedDraftHookId !== 'string' || record.selectedDraftHookId.trim() === '')
  ) {
    throw new ValidationError(`${label}.selectedDraftHookId must be a non-empty string, null, or undefined`)
  }
  for (const field of [
    'hypaContextTruncationAcknowledged',
    'autoTranslate',
    'autoTranslateBotOnly',
    'bilingualDisplay',
  ] as const) {
    if (
      field in record &&
      record[field] !== undefined &&
      record[field] !== null &&
      typeof record[field] !== 'boolean'
    ) {
      throw new ValidationError(`${label}.${field} must be a boolean, null, or undefined`)
    }
  }
  if (
    'bilingualEmphasis' in record &&
    record.bilingualEmphasis !== undefined &&
    record.bilingualEmphasis !== null &&
    record.bilingualEmphasis !== 'original' &&
    record.bilingualEmphasis !== 'translation'
  ) {
    throw new ValidationError(`${label}.bilingualEmphasis must be 'original', 'translation', null, or undefined`)
  }
  if (
    'lastDate' in record &&
    record.lastDate !== undefined &&
    record.lastDate !== null &&
    (typeof record.lastDate !== 'number' || !Number.isFinite(record.lastDate))
  ) {
    throw new ValidationError(`${label}.lastDate must be a finite number, null, or undefined`)
  }
}

function validateChatFolderRecord(record: JsonRecord, label: string, options: { partial?: boolean } = {}): void {
  if ('id' in record && (typeof record.id !== 'string' || record.id.trim() === '')) {
    throw new ValidationError(`${label}.id must be a non-empty string`)
  }
  if ('name' in record && typeof record.name !== 'string') {
    throw new ValidationError(`${label}.name must be a string`)
  }
  if ('color' in record && typeof record.color !== 'string') {
    throw new ValidationError(`${label}.color must be a string`)
  }
  if ((!options.partial || 'folded' in record) && typeof record.folded !== 'boolean') {
    throw new ValidationError(`${label}.folded must be a boolean`)
  }
}

function validateStringRecord(value: unknown, label: string): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError(`${label} must be an object`)
  }
  for (const [key, recordValue] of Object.entries(value as JsonRecord)) {
    if (typeof recordValue !== 'string') {
      throw new ValidationError(`${label}.${key} must be a string`)
    }
  }
}

function readSidebarToggleValueMap(value: unknown, label: string): Record<string, string> {
  if (!isJsonRecord(value)) {
    throw new ValidationError(`${label} must be an object`)
  }
  const normalized: Record<string, string> = {}
  for (const [key, toggleValue] of Object.entries(value)) {
    if (key.trim() === '') {
      throw new ValidationError(`${label} key must be a non-empty string`)
    }
    if (typeof toggleValue !== 'string') {
      throw new ValidationError(`${label}.${key} must be a string`)
    }
    normalized[key] = toggleValue
  }
  return normalized
}

function readUniqueNonEmptyStringList(value: unknown, label: string): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new ValidationError(`${label} must be an array`)
  const result = value.map((entry, index) => {
    if (typeof entry !== 'string' || entry.trim() === '') {
      throw new ValidationError(`${label}[${index}] must be a non-empty string`)
    }
    return entry
  })
  if (new Set(result).size !== result.length) {
    throw new ValidationError(`${label} must not contain duplicates`)
  }
  return result
}

function cloneJsonValue<T>(value: T): T {
  if (value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function readOptionalStringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function validateScriptstateKey(key: string, label: string): void {
  if (key.trim() === '') {
    throw new ValidationError(`${label} must be a non-empty string`)
  }
}

function validateScriptstateValue(value: unknown, label: string): void {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
    throw new ValidationError(`${label} must be a string, number, or boolean`)
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new ValidationError(`${label} must be a finite number`)
  }
}
