import { get } from 'svelte/store'
import {
  canUseServerCommands,
  appendMessageCommand,
  createChatCommand,
  createChatFolderCommand,
  deleteChatCommand,
  deleteChatFolderCommand,
  deleteMessageCommand,
  forkChatCommand,
  patchChatScriptstateCommand,
  reorderChatFoldersCommand,
  reorderChatsCommand,
  replaceTailMessagesCommand,
  replaceMessagesCommand,
  runServerCommand,
  saveChatGenerationSettingsCommand,
  truncateMessagesCommand,
  updateChatCommand,
  updateChatFolderCommand,
  updateMessageCommand,
  type ChatFolderSnapshot,
  type ChatScriptstatePatch,
  type ChatScriptstateValue,
  type ChatSnapshot,
  type MessageSnapshot,
  type ServerCommandResult,
  type ServerCommandTransportOptions,
} from './server/commands'
import { withTrustedServerProjectionWrite } from './server/projectionWriteGuard.svelte'
import { isServerChatMessagePlaceholder } from './server/chatMessagePlaceholders'
import { applyAttemptedFieldRollback, applyAttemptedKeyedListRollback } from './server/staleStateGuards'
import { DBState, reloadGuiDisplay, selectedCharID } from './stores.svelte'
import type { Chat, ChatFolder, Message, character } from './storage/database.svelte'
import type { ChatGenerationSettings } from './chatGenerationSettings'
import { v4 } from 'uuid'

export interface ChatStateSnapshot {
  characters: character[]
  selectedCharID: number
}

export type AppendCurrentChatUserMessageResult =
  | { status: 'ok'; messageId: string }
  | { status: 'error'; error: string }

export const CHAT_PATCH_ALLOWED_KEYS = new Set([
  'name',
  'note',
  'sdData',
  'lastMemory',
  'suggestMessages',
  'bindedPersona',
  'fmIndex',
  'folderId',
  'lastDate',
  'bookmarks',
  'bookmarkNames',
  'modules',
])

export const MESSAGE_PATCH_ALLOWED_KEYS = new Set([
  'role',
  'data',
  'saying',
  'time',
  'promptInfo',
  'name',
  'otherUser',
  'disabled',
  'isComment',
])

export const CHAT_FOLDER_PATCH_ALLOWED_KEYS = new Set(['name', 'color', 'folded'])

export function cloneJsonValue<T>(value: T): T {
  if (value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}

function freezeJsonValue<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value as Record<string, unknown>)) {
    freezeJsonValue(child)
  }
  return Object.freeze(value) as T
}

export function currentChatStateSnapshot(): ChatStateSnapshot {
  return {
    characters: cloneJsonValue(DBState.db.characters ?? []),
    selectedCharID: get(selectedCharID),
  }
}

export function restoreChatState(snapshot: ChatStateSnapshot): void {
  withTrustedServerProjectionWrite(() => {
    DBState.db.characters = cloneJsonValue(snapshot.characters)
    selectedCharID.set(snapshot.selectedCharID)
    reloadGuiDisplay()
  })
}

export function applyOptimisticCreatedChat(
  characterId: string | undefined,
  chat: Chat,
  snapshot: ChatStateSnapshot,
): boolean {
  let applied = false
  withTrustedServerProjectionWrite(() => {
    const character = locateSnapshotCharacter(characterId, snapshot.selectedCharID)
    if (!character?.chats) return
    const existingIndex = chat.id ? character.chats.findIndex((candidate) => candidate.id === chat.id) : -1
    if (existingIndex >= 0) {
      character.chatPage = existingIndex
      applied = true
      return
    }
    character.chats.unshift(chat)
    character.chatPage = 0
    applied = true
  })
  if (applied) reloadGuiDisplay()
  return applied
}

export interface OptimisticDeletedChatResult {
  applied: boolean
  selectedChatId: string | undefined
}

export function applyOptimisticDeletedChat(
  characterId: string | undefined,
  chatId: string | undefined,
  snapshot: ChatStateSnapshot,
): OptimisticDeletedChatResult {
  const result: OptimisticDeletedChatResult = {
    applied: false,
    selectedChatId: undefined,
  }
  if (!chatId) return result

  withTrustedServerProjectionWrite(() => {
    const character = locateSnapshotCharacter(characterId, snapshot.selectedCharID)
    const chats = character?.chats
    if (!character || !chats || chats.length <= 1) return
    const chatIndex = chats.findIndex((candidate) => candidate.id === chatId)
    if (chatIndex < 0) return

    chats.splice(chatIndex, 1)
    normalizeChatPage(character)
    result.applied = true
    result.selectedChatId = chats[character.chatPage]?.id
  })
  if (result.applied) reloadGuiDisplay()
  return result
}

// Chat selection rollback only restores the owning character's `chatPage`.
// `selectedCharID` locates the row but is not restored, so a concurrent
// character switch is not clobbered.
export interface ChatSelectionSnapshot {
  characterId: string | undefined
  selectedCharID: number
  chatPage: number
}

export function currentChatSelectionSnapshot(): ChatSelectionSnapshot {
  const selectedChar = get(selectedCharID)
  const character = DBState.db.characters?.[selectedChar]
  return {
    characterId: character?.chaId,
    selectedCharID: selectedChar,
    chatPage: character?.chatPage ?? 0,
  }
}

export function restoreChatSelection(snapshot: ChatSelectionSnapshot): void {
  withTrustedServerProjectionWrite(() => {
    const character = locateSnapshotCharacter(snapshot.characterId, snapshot.selectedCharID)
    if (!character) return
    character.chatPage = snapshot.chatPage
  })
}

function applyOptimisticChatSelection(chatId: string, snapshot: ChatSelectionSnapshot): void {
  const character = locateSnapshotCharacter(snapshot.characterId, snapshot.selectedCharID)
  const chatIndex = character?.chats?.findIndex((candidate) => candidate.id === chatId) ?? -1
  if (!character || chatIndex < 0 || character.chatPage === chatIndex) return

  withTrustedServerProjectionWrite(() => {
    const liveCharacter = locateSnapshotCharacter(snapshot.characterId, snapshot.selectedCharID)
    const liveChatIndex = liveCharacter?.chats?.findIndex((candidate) => candidate.id === chatId) ?? -1
    if (!liveCharacter || liveChatIndex < 0) return
    liveCharacter.chatPage = liveChatIndex
  })
}

// Narrow single-chat rollback. Message edit/delete/bookmark/replace/send and
// slash-command message mutation only touch the active chat row, so a rollback
// only needs that one chat — not a JSON clone of every character's whole chat
// history (the heavy `ChatStateSnapshot`). The full-collection snapshot stays
// for genuine restructures (create/delete/reorder/fork chats); this scoped pair
// is reserved for paths that mutate one chat in place.
export interface ChatScopedSnapshot {
  selectedCharID: number
  characterId: string | undefined
  chatId: string | undefined
  chat: Chat | undefined
}

export interface ChatGenerationSettingsSnapshot {
  characterId: string | undefined
  chatId: string
  hadGenerationSettings: boolean
  generationSettings?: ChatGenerationSettings
}

const pendingChatGenerationSettingsSaves = new Map<string, Promise<ServerCommandResult | null>>()

export interface MutateChatScopedOptions {
  selectedChar?: number
  selectedChat?: number
}

export interface SetCurrentChatGreetingIndexOptions extends MutateChatScopedOptions {
  dispatch?: boolean
}

export function currentChatScopedSnapshot(): ChatScopedSnapshot {
  const selectedChar = get(selectedCharID)
  const character = DBState.db.characters?.[selectedChar]
  const chat = character?.chats?.[character.chatPage]
  return {
    selectedCharID: selectedChar,
    characterId: character?.chaId,
    chatId: chat?.id,
    chat: chat ? cloneJsonValue(chat) : undefined,
  }
}

export function restoreChatScopedState(snapshot: ChatScopedSnapshot): void {
  if (!snapshot.chat) return
  withTrustedServerProjectionWrite(() => {
    const chat = locateChatScopedSnapshot(snapshot)
    if (!chat) return
    const character = locateSnapshotCharacter(snapshot.characterId, snapshot.selectedCharID)
    if (!character?.chats) return
    const index = locateChatIndex(character, snapshot.chatId)
    if (index < 0) return
    character.chats[index] = cloneJsonValue(snapshot.chat) as Chat
  })
}

function locateChatScopedSnapshot(snapshot: ChatScopedSnapshot): Chat | undefined {
  const character = locateSnapshotCharacter(snapshot.characterId, snapshot.selectedCharID)
  if (!character?.chats) return undefined
  const index = locateChatIndex(character, snapshot.chatId)
  return index >= 0 ? character.chats[index] : undefined
}

export function currentChatGenerationSettingsSnapshot(chatId: string): ChatGenerationSettingsSnapshot | null {
  const location = locateChatById(chatId)
  if (!location) return null
  const chatRecord = location.chat as unknown as Record<string, unknown>
  return {
    characterId: location.character.chaId,
    chatId,
    hadGenerationSettings: Object.prototype.propertyIsEnumerable.call(chatRecord, 'generationSettings'),
    generationSettings: cloneJsonValue(location.chat.generationSettings),
  }
}

export function restoreChatGenerationSettings(snapshot: ChatGenerationSettingsSnapshot): void {
  withTrustedServerProjectionWrite(() => {
    const location = locateChatById(snapshot.chatId, snapshot.characterId)
    if (!location) return
    const row = location.chat as unknown as Record<string, unknown>
    if (snapshot.hadGenerationSettings) {
      row.generationSettings = cloneJsonValue(snapshot.generationSettings)
    } else {
      delete row.generationSettings
    }
  })
}

export function waitForPendingChatGenerationSettingsSave(
  chatId: string | undefined,
): Promise<ServerCommandResult | null> {
  if (!chatId) return Promise.resolve(null)
  return pendingChatGenerationSettingsSaves.get(chatId) ?? Promise.resolve(null)
}

// Narrow scriptstate rollback. `setVar`/`setChatVar`/`/setvar`/`/addvar` only
// mutate the active chat's `scriptstate` map (and `v2SetAuthorNote` its `note`
// scalar), so the snapshot shallow-clones just that small key/value map plus an
// optional note — never the chat or the characters array.
export interface ChatScriptstateSnapshot {
  chatId: string | undefined
  selectedCharID: number
  scriptstate: { [key: string]: string | number | boolean } | undefined
  note?: string
}

export function currentChatScriptstateSnapshot(includeNote = false): ChatScriptstateSnapshot {
  const selectedChar = get(selectedCharID)
  const character = DBState.db.characters?.[selectedChar]
  const chat = character?.chats?.[character.chatPage]
  const snapshot: ChatScriptstateSnapshot = {
    chatId: chat?.id,
    selectedCharID: selectedChar,
    scriptstate: chat?.scriptstate ? { ...chat.scriptstate } : undefined,
  }
  if (includeNote && chat) snapshot.note = chat.note ?? ''
  return snapshot
}

export function restoreChatScriptstate(snapshot: ChatScriptstateSnapshot): void {
  withTrustedServerProjectionWrite(() => {
    const chat = locateScriptstateChat(snapshot)
    if (!chat) return
    chat.scriptstate = snapshot.scriptstate ? { ...snapshot.scriptstate } : undefined
    if (snapshot.note !== undefined) chat.note = snapshot.note
  })
}

function locateSnapshotCharacter(characterId: string | undefined, fallbackIndex: number): character | undefined {
  if (characterId) {
    const byId = DBState.db.characters?.find((candidate) => candidate.chaId === characterId)
    if (byId) return byId
  }
  return DBState.db.characters?.[fallbackIndex]
}

function locateChatIndex(character: character, chatId: string | undefined): number {
  // Prefer a stable id so a stale index can never clobber the wrong chat. Only
  // fall back to the active `chatPage` when the chat carried no id at all.
  if (chatId) {
    return character.chats?.findIndex((candidate) => candidate.id === chatId) ?? -1
  }
  const page = character.chatPage ?? 0
  return page >= 0 && page < (character.chats?.length ?? 0) ? page : -1
}

function normalizeChatPage(character: character): void {
  const chatsLength = character.chats?.length ?? 0
  if (!Number.isInteger(character.chatPage)) {
    character.chatPage = chatsLength > 0 ? 0 : -1
  }
  if (character.chatPage >= chatsLength) {
    character.chatPage = chatsLength > 0 ? chatsLength - 1 : -1
  }
  if (character.chatPage < -1) {
    character.chatPage = chatsLength > 0 ? 0 : -1
  }
}

function locateScriptstateChat(snapshot: ChatScriptstateSnapshot): Chat | undefined {
  if (snapshot.chatId) {
    for (const character of DBState.db.characters ?? []) {
      const chat = character.chats?.find((candidate) => candidate.id === snapshot.chatId)
      if (chat) return chat
    }
  }
  const character = DBState.db.characters?.[snapshot.selectedCharID]
  return character?.chats?.[character.chatPage]
}

function locateChatById(chatId: string, preferredCharacterId?: string): { character: character; chat: Chat } | null {
  if (preferredCharacterId) {
    const character = DBState.db.characters?.find((candidate) => candidate.chaId === preferredCharacterId)
    const chat = character?.chats?.find((candidate) => candidate.id === chatId)
    if (character && chat) return { character, chat }
  }

  for (const character of DBState.db.characters ?? []) {
    const chat = character.chats?.find((candidate) => candidate.id === chatId)
    if (chat) return { character, chat }
  }
  return null
}

// Narrow chat-metadata-row rollback for the server-backed chat-metadata watcher.
// The watcher pushes only the small allowed scalar keys
// (`CHAT_PATCH_ALLOWED_KEYS`) of one chat row to the server, so its rollback only
// needs that one row's scalar metadata — not a JSON clone of every character's
// whole chat history (the heavy `ChatStateSnapshot`). `metadata` is exactly the
// scalar baseline the watcher already diffs, so restoring it re-writes only those
// scalars on the located chat and leaves message history, `localLore`,
// `scriptstate`, and every other chat/character row untouched.
export interface ChatRowMetadataSnapshot {
  selectedCharID: number
  characterId: string | undefined
  chatId: string
  metadata: ChatSnapshot
  attempted?: ChatSnapshot
}

type ChatRowMetadataRollback = (snapshot: ChatRowMetadataSnapshot) => void

export function restoreChatRowMetadata(snapshot: ChatRowMetadataSnapshot): void {
  withTrustedServerProjectionWrite(() => {
    const character = locateSnapshotCharacter(snapshot.characterId, snapshot.selectedCharID)
    const chat = character?.chats?.find((candidate) => candidate.id === snapshot.chatId)
    if (!chat) return
    const row = chat as unknown as Record<string, unknown>
    if (snapshot.attempted) {
      applyAttemptedFieldRollback({
        target: row,
        previous: snapshot.metadata as Record<string, unknown>,
        attempted: snapshot.attempted as Record<string, unknown>,
        keys: CHAT_PATCH_ALLOWED_KEYS,
        deleteMissingPrevious: true,
      })
      return
    }
    for (const key of CHAT_PATCH_ALLOWED_KEYS) {
      if (key in snapshot.metadata) {
        row[key] = cloneJsonValue(snapshot.metadata[key])
      } else {
        // The optimistic change added this allowed key; remove it so the failed
        // command does not leave a stray scalar behind.
        delete row[key]
      }
    }
  })
}

export interface ChatFolderRowMetadataSnapshot {
  selectedCharID: number
  characterId: string | undefined
  folderId: string
  metadata: ChatFolderSnapshot
  attempted?: ChatFolderSnapshot
}

export function restoreChatFolderRowMetadata(snapshot: ChatFolderRowMetadataSnapshot): void {
  withTrustedServerProjectionWrite(() => {
    const character = locateSnapshotCharacter(snapshot.characterId, snapshot.selectedCharID)
    const folder = character?.chatFolders?.find((candidate) => candidate.id === snapshot.folderId)
    if (!folder) return
    if (snapshot.attempted) {
      applyAttemptedFieldRollback({
        target: folder as unknown as Record<string, unknown>,
        previous: snapshot.metadata as Record<string, unknown>,
        attempted: snapshot.attempted as Record<string, unknown>,
        keys: CHAT_FOLDER_PATCH_ALLOWED_KEYS,
        deleteMissingPrevious: true,
      })
      return
    }
    folder.name = snapshot.metadata.name as string | undefined
    folder.color = snapshot.metadata.color as string | undefined
    folder.folded = (snapshot.metadata.folded as boolean | undefined) ?? false
  })
}

interface ChatFolderLocation {
  character: character
  folder: ChatFolder
  folderIndex: number
}

interface ChatFolderDeleteRollback {
  selectedCharID: number
  characterId: string | undefined
  folderId: string
  folder: ChatFolder
  previousIndex: number
  affectedChats: Array<{
    chatId: string
    previousFolderId: string | null | undefined
    attemptedFolderId: string | null | undefined
  }>
}

interface ChatLocation {
  character: character
  chat: Chat
  chatIndex: number
}

interface ChatCreateRollback {
  selectedCharID: number
  characterId: string | undefined
  chatId: string
  previousChat: Chat | null
  attemptedChat: Chat
  previousSelectedChatId: string | undefined
  attemptedSelectedChatId: string | undefined
}

interface ChatImportedCreateRollback {
  selectedCharID: number
  characterId: string | undefined
  attemptedIndex: number
  attemptedChat: Chat
  previousSelectedChatId: string | undefined
}

interface ChatCreatedFolderRollback {
  selectedCharID: number
  characterId: string | undefined
  folderId: string
  attemptedFolder: ChatFolder
}

interface ChatDeleteRollback {
  selectedCharID: number
  characterId: string | undefined
  chatId: string
  chat: Chat
  previousIndex: number
  previousSelectedChatId: string | undefined
  attemptedSelectedChatId: string | undefined
}

interface ChatForkRollback {
  createdChat: ChatCreateRollback | null
  sourcePatch: ChatRowMetadataSnapshot | null
  createdFolder: ChatCreatedFolderRollback | null
}

interface ChatImportBatchRollbackStep<TRollback> {
  rollback: TRollback | null
  accepted: boolean
}

interface ChatImportBatchRollback {
  folders: Array<ChatImportBatchRollbackStep<ChatCreatedFolderRollback>>
  chats: Array<ChatImportBatchRollbackStep<ChatImportedCreateRollback>>
}

interface ChatFolderAssignmentRollback {
  previous: string | null | undefined
  previousHadValue: boolean
}

interface ChatReorderRollback {
  selectedCharID: number
  characterId: string | undefined
  previousIds: string[]
  previousFolderByChatId: Record<string, ChatFolderAssignmentRollback>
  attemptedIds: string[]
  attemptedFolderByChatId: Record<string, string | null>
}

function locateSnapshotCharacterInState(
  snapshot: ChatStateSnapshot,
  characterId: string | undefined,
): character | undefined {
  if (characterId) {
    const byId = snapshot.characters?.find((candidate) => candidate.chaId === characterId)
    if (byId) return byId
  }
  return snapshot.characters?.[snapshot.selectedCharID]
}

function selectedChatIdForCharacter(character: character | undefined): string | undefined {
  if (!character?.chats) return undefined
  return character.chats[character.chatPage]?.id
}

function selectChatById(character: character, chatId: string | undefined): boolean {
  if (!chatId) return false
  const index = character.chats?.findIndex((chat) => chat.id === chatId) ?? -1
  if (index < 0) return false
  character.chatPage = index
  return true
}

function preserveOrRestoreChatSelection(
  character: character,
  preferredSelectedChatId: string | undefined,
  fallbackSelectedChatId: string | undefined,
): void {
  if (selectChatById(character, preferredSelectedChatId)) return
  if (selectChatById(character, fallbackSelectedChatId)) return
  normalizeChatPage(character)
}

function locateChatInState(snapshot: ChatStateSnapshot, chatId: string): ChatLocation | null {
  for (const character of snapshot.characters ?? []) {
    const chatIndex = character.chats?.findIndex((candidate) => candidate.id === chatId) ?? -1
    if (chatIndex >= 0) {
      return {
        character,
        chat: character.chats[chatIndex],
        chatIndex,
      }
    }
  }
  return null
}

function locateChatFolderInState(snapshot: ChatStateSnapshot, folderId: string): ChatFolderLocation | null {
  for (const character of snapshot.characters ?? []) {
    const folderIndex = character.chatFolders?.findIndex((candidate) => candidate.id === folderId) ?? -1
    if (folderIndex >= 0) {
      return {
        character,
        folder: character.chatFolders[folderIndex],
        folderIndex,
      }
    }
  }
  return null
}

function chatCreateRollbackFromState(
  characterId: string,
  attemptedChat: Chat,
  previous: ChatStateSnapshot,
  select: boolean,
): ChatCreateRollback | null {
  if (!attemptedChat.id) return null
  const previousCharacter = locateSnapshotCharacterInState(previous, characterId)
  const previousChat = previousCharacter?.chats?.find((candidate) => candidate.id === attemptedChat.id)
  const previousChatSnapshot = previousChat ? cloneJsonValue(previousChat) : null
  return {
    selectedCharID: previous.selectedCharID,
    characterId,
    chatId: attemptedChat.id,
    previousChat: previousChatSnapshot,
    attemptedChat: previousChatSnapshot ?? cloneJsonValue(attemptedChat),
    previousSelectedChatId: selectedChatIdForCharacter(previousCharacter),
    attemptedSelectedChatId: select ? attemptedChat.id : undefined,
  }
}

function importedChatCreateRollbackFromState(
  characterId: string,
  attemptedChat: Chat,
  previous: ChatStateSnapshot,
  usedIndexes: Set<number>,
): ChatImportedCreateRollback | null {
  const character = locateSnapshotCharacter(characterId, previous.selectedCharID)
  const attemptedSnapshot = snapshotJson(attemptedChat)
  const attemptedIndex =
    character?.chats?.findIndex((candidate, index) => {
      if (usedIndexes.has(index)) return false
      return snapshotJson(candidate) === attemptedSnapshot
    }) ?? -1
  if (attemptedIndex < 0) return null

  usedIndexes.add(attemptedIndex)
  const previousCharacter = locateSnapshotCharacterInState(previous, characterId)
  return {
    selectedCharID: previous.selectedCharID,
    characterId,
    attemptedIndex,
    attemptedChat: cloneJsonValue(attemptedChat),
    previousSelectedChatId: selectedChatIdForCharacter(previousCharacter),
  }
}

function restoreCreatedChatAttempt(rollback: ChatCreateRollback | null): void {
  if (!rollback) return
  withTrustedServerProjectionWrite(() => {
    const character = locateSnapshotCharacter(rollback.characterId, rollback.selectedCharID)
    const chats = character?.chats
    if (!character || !chats) return

    const liveSelectedChatId = selectedChatIdForCharacter(character)
    const rolledBack = applyAttemptedKeyedListRollback<Chat, string>({
      list: chats,
      entries: [
        {
          key: rollback.chatId,
          previous: rollback.previousChat,
          attempted: rollback.attemptedChat,
        },
      ],
      getKey: (chat) => chat?.id,
    })
    if (rolledBack.length === 0) return
    character.chats = chats

    const preferredSelectedChatId =
      liveSelectedChatId === rollback.attemptedSelectedChatId ? rollback.previousSelectedChatId : liveSelectedChatId
    preserveOrRestoreChatSelection(character, preferredSelectedChatId, liveSelectedChatId)
  })
}

function restoreImportedCreatedChatAttempt(rollback: ChatImportedCreateRollback | null): void {
  if (!rollback) return
  withTrustedServerProjectionWrite(() => {
    const character = locateSnapshotCharacter(rollback.characterId, rollback.selectedCharID)
    const chats = character?.chats
    if (!character || !chats) return

    const liveChat = chats[rollback.attemptedIndex]
    if (snapshotJson(liveChat) !== snapshotJson(rollback.attemptedChat)) return

    const liveSelectedChatId = selectedChatIdForCharacter(character)
    chats.splice(rollback.attemptedIndex, 1)
    character.chats = chats
    preserveOrRestoreChatSelection(character, liveSelectedChatId, rollback.previousSelectedChatId)
  })
}

function chatMetadataRollbackFromPatch(
  chatId: string,
  patch: ChatSnapshot | undefined,
  previous: ChatStateSnapshot,
): ChatRowMetadataSnapshot | null {
  if (!patch || Object.keys(patch).length === 0) return null
  const location = locateChatInState(previous, chatId)
  if (!location) return null

  const previousRow = location.chat as unknown as Record<string, unknown>
  const metadata: ChatSnapshot = {}
  const attempted: ChatSnapshot = {}
  for (const key of CHAT_PATCH_ALLOWED_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(patch, key)) continue
    if (Object.prototype.hasOwnProperty.call(previousRow, key)) {
      metadata[key] = cloneJsonValue(previousRow[key])
    }
    attempted[key] = cloneJsonValue(patch[key])
  }
  if (Object.keys(attempted).length === 0) return null

  return {
    selectedCharID: previous.selectedCharID,
    characterId: location.character.chaId,
    chatId,
    metadata,
    attempted,
  }
}

function chatFolderMetadataRollbackFromPatch(
  folderId: string,
  patch: ChatFolderSnapshot,
  previous: ChatStateSnapshot,
): ChatFolderRowMetadataSnapshot | null {
  const location = locateChatFolderInState(previous, folderId)
  if (!location) return null

  const previousRow = location.folder as unknown as Record<string, unknown>
  const metadata: ChatFolderSnapshot = {}
  const attempted: ChatFolderSnapshot = {}
  for (const key of CHAT_FOLDER_PATCH_ALLOWED_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(patch, key)) continue
    if (Object.prototype.hasOwnProperty.call(previousRow, key)) {
      metadata[key] = cloneJsonValue(previousRow[key])
    }
    attempted[key] = cloneJsonValue(patch[key])
  }
  if (Object.keys(attempted).length === 0) return null

  return {
    selectedCharID: previous.selectedCharID,
    characterId: location.character.chaId,
    folderId,
    metadata,
    attempted,
  }
}

function restoreCreatedChatFolderAttempt(characterId: string, folder: ChatFolder, previous: ChatStateSnapshot): void {
  if (!folder.id) return
  const attempted = cloneJsonValue(folder)
  withTrustedServerProjectionWrite(() => {
    const character = locateSnapshotCharacter(characterId, previous.selectedCharID)
    const folders = character?.chatFolders
    if (!folders) return

    const rolledBack = applyAttemptedKeyedListRollback<ChatFolder, string>({
      list: folders,
      entries: [
        {
          key: folder.id,
          previous: null,
          attempted,
        },
      ],
      getKey: (candidate) => candidate?.id,
    })
    if (rolledBack.length > 0) character.chatFolders = folders
  })
}

function chatCreatedFolderRollbackFromState(
  characterId: string | undefined,
  folder: ChatFolder | undefined,
  previous: ChatStateSnapshot,
): ChatCreatedFolderRollback | null {
  if (!folder?.id) return null
  const previousCharacter = locateSnapshotCharacterInState(previous, characterId)
  if (previousCharacter?.chatFolders?.some((candidate) => candidate.id === folder.id)) return null
  return {
    selectedCharID: previous.selectedCharID,
    characterId,
    folderId: folder.id,
    attemptedFolder: cloneJsonValue(folder),
  }
}

function restoreCreatedChatFolderAttemptIfUnreferenced(rollback: ChatCreatedFolderRollback | null): void {
  if (!rollback) return
  withTrustedServerProjectionWrite(() => {
    const character = locateSnapshotCharacter(rollback.characterId, rollback.selectedCharID)
    const folders = character?.chatFolders
    if (!character || !folders) return
    if (character.chats?.some((chat) => chat.folderId === rollback.folderId)) return

    const rolledBack = applyAttemptedKeyedListRollback<ChatFolder, string>({
      list: folders,
      entries: [
        {
          key: rollback.folderId,
          previous: null,
          attempted: rollback.attemptedFolder,
        },
      ],
      getKey: (candidate) => candidate?.id,
    })
    if (rolledBack.length > 0) character.chatFolders = folders
  })
}

function chatForkRollbackFromState(
  sourceChatId: string,
  previous: ChatStateSnapshot,
  input: {
    chat: Chat
    sourcePatch?: ChatSnapshot
    folder?: ChatFolder
    select?: boolean
  },
): ChatForkRollback | null {
  const sourceLocation = locateChatInState(previous, sourceChatId)
  if (!sourceLocation) return null
  const characterId = sourceLocation.character.chaId
  return {
    createdChat: chatCreateRollbackFromState(characterId, input.chat, previous, input.select !== false),
    sourcePatch: chatMetadataRollbackFromPatch(sourceChatId, input.sourcePatch, previous),
    createdFolder: chatCreatedFolderRollbackFromState(characterId, input.folder, previous),
  }
}

function restoreForkChatAttempt(rollback: ChatForkRollback | null): void {
  if (!rollback) return
  restoreCreatedChatAttempt(rollback.createdChat)
  if (rollback.sourcePatch) restoreChatRowMetadata(rollback.sourcePatch)
  restoreCreatedChatFolderAttemptIfUnreferenced(rollback.createdFolder)
}

function restoreImportedChatBatchAttempt(rollback: ChatImportBatchRollback): void {
  for (let index = rollback.chats.length - 1; index >= 0; index -= 1) {
    const step = rollback.chats[index]
    if (!step.accepted) restoreImportedCreatedChatAttempt(step.rollback)
  }
  for (const step of rollback.folders) {
    if (!step.accepted) restoreCreatedChatFolderAttemptIfUnreferenced(step.rollback)
  }
}

function chatDeleteRollbackFromState(chatId: string, previous: ChatStateSnapshot): ChatDeleteRollback | null {
  const location = locateChatInState(previous, chatId)
  if (!location) return null

  return {
    selectedCharID: previous.selectedCharID,
    characterId: location.character.chaId,
    chatId,
    chat: cloneJsonValue(location.chat),
    previousIndex: location.chatIndex,
    previousSelectedChatId: selectedChatIdForCharacter(location.character),
    attemptedSelectedChatId: selectedChatIdForCharacter(
      locateSnapshotCharacter(location.character.chaId, previous.selectedCharID),
    ),
  }
}

function restoreDeletedChatAttempt(rollback: ChatDeleteRollback | null): void {
  if (!rollback) return
  withTrustedServerProjectionWrite(() => {
    const character = locateSnapshotCharacter(rollback.characterId, rollback.selectedCharID)
    const chats = character?.chats
    if (!character || !chats) return

    const liveSelectedChatId = selectedChatIdForCharacter(character)
    const rolledBack = applyAttemptedKeyedListRollback<Chat, string>({
      list: chats,
      entries: [
        {
          key: rollback.chatId,
          previous: rollback.chat,
          attempted: null,
          previousIndex: rollback.previousIndex,
        },
      ],
      getKey: (chat) => chat?.id,
    })
    if (rolledBack.length > 0) character.chats = chats

    const preferredSelectedChatId =
      liveSelectedChatId === rollback.attemptedSelectedChatId ? rollback.previousSelectedChatId : liveSelectedChatId
    preserveOrRestoreChatSelection(character, preferredSelectedChatId, liveSelectedChatId)
  })
}

function currentChatFolderIdForChat(
  characterId: string | undefined,
  selectedCharId: number,
  chatId: string,
): string | null | undefined {
  const character = locateSnapshotCharacter(characterId, selectedCharId)
  return character?.chats?.find((chat) => chat.id === chatId)?.folderId
}

function chatFolderDeleteRollbackFromState(
  folderId: string,
  previous: ChatStateSnapshot,
): ChatFolderDeleteRollback | null {
  const location = locateChatFolderInState(previous, folderId)
  if (!location) return null

  const affectedChats = (location.character.chats ?? [])
    .filter((chat) => chat.id && chat.folderId === folderId)
    .map((chat) => ({
      chatId: chat.id as string,
      previousFolderId: chat.folderId,
      attemptedFolderId: currentChatFolderIdForChat(
        location.character.chaId,
        previous.selectedCharID,
        chat.id as string,
      ),
    }))

  return {
    selectedCharID: previous.selectedCharID,
    characterId: location.character.chaId,
    folderId,
    folder: cloneJsonValue(location.folder),
    previousIndex: location.folderIndex,
    affectedChats,
  }
}

function restoreDeletedChatFolderAttempt(rollback: ChatFolderDeleteRollback | null): void {
  if (!rollback) return
  withTrustedServerProjectionWrite(() => {
    const character = locateSnapshotCharacter(rollback.characterId, rollback.selectedCharID)
    const folders = character?.chatFolders
    if (!character || !folders) return

    const rolledBack = applyAttemptedKeyedListRollback<ChatFolder, string>({
      list: folders,
      entries: [
        {
          key: rollback.folderId,
          previous: rollback.folder,
          attempted: null,
          previousIndex: rollback.previousIndex,
        },
      ],
      getKey: (folder) => folder?.id,
    })
    if (rolledBack.length > 0) character.chatFolders = folders

    for (const chatRollback of rollback.affectedChats) {
      const chat = character.chats?.find((candidate) => candidate.id === chatRollback.chatId)
      if (!chat) continue
      applyAttemptedFieldRollback({
        target: chat as unknown as Record<string, unknown>,
        previous: { folderId: chatRollback.previousFolderId },
        attempted: { folderId: chatRollback.attemptedFolderId },
        keys: ['folderId'],
      })
    }
  })
}

function chatFolderIds(folders: readonly ChatFolder[] | undefined): string[] {
  return (folders ?? []).map((folder) => folder.id)
}

function chatRowIds(chats: readonly Chat[] | undefined): string[] {
  return (chats ?? []).map((chat) => chat.id).filter(Boolean) as string[]
}

function stringArraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function chatFolderAssignmentValue(chat: Chat): string | null {
  return chat.folderId ?? null
}

function chatReorderRollbackFromState(
  characterId: string,
  chatIds: string[],
  folderByChatId: Record<string, string | null>,
  previous: ChatStateSnapshot,
): ChatReorderRollback | null {
  const previousCharacter = locateSnapshotCharacterInState(previous, characterId)
  if (!previousCharacter?.chats) return null

  const previousFolderByChatId: Record<string, ChatFolderAssignmentRollback> = {}
  for (const chat of previousCharacter.chats) {
    if (!chat.id) continue
    previousFolderByChatId[chat.id] = {
      previous: cloneJsonValue(chat.folderId),
      previousHadValue: Object.prototype.hasOwnProperty.call(chat, 'folderId'),
    }
  }

  return {
    selectedCharID: previous.selectedCharID,
    characterId,
    previousIds: chatRowIds(previousCharacter.chats),
    previousFolderByChatId,
    attemptedIds: cloneJsonValue(chatIds),
    attemptedFolderByChatId: cloneJsonValue(folderByChatId),
  }
}

function liveChatFolderAssignmentsMatch(
  chats: readonly Chat[],
  attemptedFolderByChatId: Record<string, string | null>,
): boolean {
  for (const chat of chats) {
    if (!chat.id) return false
    if (chatFolderAssignmentValue(chat) !== (attemptedFolderByChatId[chat.id] ?? null)) return false
  }
  return true
}

function restoreChatOrderAttempt(rollback: ChatReorderRollback | null): void {
  if (!rollback) return
  withTrustedServerProjectionWrite(() => {
    const character = locateSnapshotCharacter(rollback.characterId, rollback.selectedCharID)
    const chats = character?.chats
    if (!character || !chats) return
    if (!stringArraysEqual(chatRowIds(chats), rollback.attemptedIds)) return
    if (!liveChatFolderAssignmentsMatch(chats, rollback.attemptedFolderByChatId)) return

    const selectedBeforeRollback = selectedChatIdForCharacter(character)
    const liveChatsById = new Map(chats.map((chat) => [chat.id, chat]))
    const restored = rollback.previousIds.map((id) => liveChatsById.get(id))
    if (restored.some((chat) => !chat)) return

    for (const chat of restored) {
      if (!chat?.id) continue
      const folderRollback = rollback.previousFolderByChatId[chat.id]
      if (!folderRollback) continue
      if (folderRollback.previousHadValue) {
        chat.folderId = cloneJsonValue(folderRollback.previous)
      } else {
        delete (chat as unknown as Record<string, unknown>).folderId
      }
    }
    character.chats = restored as Chat[]
    preserveOrRestoreChatSelection(character, selectedBeforeRollback, undefined)
  })
}

function restoreChatFolderOrderAttempt(
  characterId: string,
  previousIds: string[],
  attemptedIds: string[],
  previous: ChatStateSnapshot,
): void {
  withTrustedServerProjectionWrite(() => {
    const character = locateSnapshotCharacter(characterId, previous.selectedCharID)
    const folders = character?.chatFolders
    if (!character || !folders) return
    if (!stringArraysEqual(chatFolderIds(folders), attemptedIds)) return

    const liveFoldersById = new Map(folders.map((folder) => [folder.id, folder]))
    const restored = previousIds.map((id) => liveFoldersById.get(id))
    if (restored.some((folder) => !folder)) return

    character.chatFolders = restored as ChatFolder[]
  })
}

export function runChatCommand<T extends Record<string, unknown>>(
  command: (baseRevision: number) => Promise<ServerCommandResult<T>>,
  rollback: () => void,
  options: ServerCommandTransportOptions = {},
): void {
  if (!canUseServerCommands()) return
  void runServerCommand({ command, rollback, ...options })
}

export function runMessageCommand<T extends Record<string, unknown>>(
  command: (baseRevision: number) => Promise<ServerCommandResult<T>>,
  rollback: () => void,
): void {
  runChatCommand(command, rollback)
}

// Exported so other modules can serialize multi-resource command fan-out
// against a shared optimistic snapshot. Each command runs sequentially; if
// one fails (including conflict), the rollback is invoked once and the rest
// are skipped. Without this, sibling `runServerCommand` calls all read the
// same cached `baseRevision` and the later ones 409 after the first succeeds.
// A thrown/rejected step is treated as a failure too: it is surfaced and
// rolled back instead of escaping the fire-and-forget `void` as an unhandled
// rejection that left the optimistic write silently diverged.
export function runOptimisticCommandSequence(
  commands: Array<(baseRevision: number) => Promise<ServerCommandResult>>,
  rollback: () => void,
): void {
  if (!canUseServerCommands() || commands.length === 0) return
  void (async () => {
    let failed = false
    try {
      for (const command of commands) {
        const result = await runServerCommand({ command })
        if (result.status !== 'ok') {
          failed = true
          break
        }
      }
    } catch (error) {
      console.error('Optimistic command sequence rejected:', error)
      failed = true
    }
    if (failed) rollback()
  })()
}

export async function runOptimisticCommandSequenceAsync(
  commands: Array<(baseRevision: number) => Promise<ServerCommandResult>>,
  rollback: () => void,
): Promise<ServerCommandResult | null> {
  if (!canUseServerCommands() || commands.length === 0) return null
  for (const command of commands) {
    const result = await runServerCommand({ command })
    if (result.status !== 'ok') {
      rollback()
      return result
    }
  }
  return null
}

function runChatCommandSequence(
  commands: Array<(baseRevision: number) => Promise<ServerCommandResult>>,
  rollback: () => void,
): void {
  runOptimisticCommandSequence(commands, rollback)
}

export function dispatchCreateChat(characterId: string, chat: Chat, previous: ChatStateSnapshot, select = true): void {
  const attemptedChat = cloneJsonValue(chat)
  const rollback = chatCreateRollbackFromState(characterId, attemptedChat, previous, select)
  runChatCommand(
    (baseRevision) =>
      createChatCommand({
        baseRevision,
        characterId,
        chat: toChatSnapshot(attemptedChat),
        select,
      }),
    () => restoreCreatedChatAttempt(rollback),
  )
}

export function dispatchCreateImportedChats(
  characterId: string | undefined,
  folders: ChatFolder[],
  chats: Chat[],
  previous: ChatStateSnapshot,
): void {
  if (!characterId) return

  const attemptedFolders = folders.map((folder) => cloneJsonValue(folder))
  const attemptedChats = chats.map((chat) => cloneJsonValue(chat))
  const usedImportedChatIndexes = new Set<number>()
  const folderSteps: ChatImportBatchRollback['folders'] = attemptedFolders.map((folder) => ({
    rollback: chatCreatedFolderRollbackFromState(characterId, folder, previous),
    accepted: false,
  }))
  const chatSteps: ChatImportBatchRollback['chats'] = attemptedChats.map((chat) => ({
    rollback: importedChatCreateRollbackFromState(characterId, chat, previous, usedImportedChatIndexes),
    accepted: false,
  }))

  const factories: Array<(baseRevision: number) => Promise<ServerCommandResult>> = [
    ...attemptedFolders.map((folder, index) => async (baseRevision: number) => {
      const result = await createChatFolderCommand({
        baseRevision,
        characterId,
        folder: toChatFolderSnapshot(folder),
      })
      if (result.status === 'ok') folderSteps[index].accepted = true
      return result
    }),
    ...attemptedChats.map((chat, index) => async (baseRevision: number) => {
      const result = await createChatCommand({
        baseRevision,
        characterId,
        chat: toChatSnapshot(chat),
        select: false,
      })
      if (result.status === 'ok') chatSteps[index].accepted = true
      return result
    }),
  ]

  runOptimisticCommandSequence(factories, () =>
    restoreImportedChatBatchAttempt({ folders: folderSteps, chats: chatSteps }),
  )
}

export function dispatchUpdateChat(
  chatId: string,
  patch: ChatSnapshot,
  previous: ChatStateSnapshot,
  select = false,
): void {
  const commandPatch = sanitizeFrozenChatPatch(patch)
  if (Object.keys(commandPatch).length === 0 && !select) return
  const rollback = chatMetadataRollbackFromPatch(chatId, commandPatch, previous)
  runChatCommand(
    (baseRevision) =>
      updateChatCommand({
        baseRevision,
        chatId,
        patch: commandPatch,
        select,
      }),
    () => {
      if (rollback) restoreChatRowMetadata(rollback)
    },
  )
}

// Scalar-rollback variant of `dispatchUpdateChat` for chat selection: the
// same empty-patch select command, with the local optimistic write limited to the
// owning character's `chatPage` instead of cloning the whole characters array.
export function dispatchSelectChat(chatId: string, previous: ChatSelectionSnapshot): void {
  if (!canUseServerCommands()) return
  applyOptimisticChatSelection(chatId, previous)
  runChatCommand(
    (baseRevision) =>
      updateChatCommand({
        baseRevision,
        chatId,
        patch: {},
        select: true,
      }),
    () => restoreChatSelection(previous),
  )
}

// Narrow-rollback variant of `dispatchUpdateChat` for the chat-metadata watcher.
// Identical command, but the rollback restores one chat row's scalar metadata
// instead of cloning the whole characters array.
export function dispatchUpdateChatRow(
  chatId: string,
  patch: ChatSnapshot,
  rollback: ChatRowMetadataSnapshot,
  options: ServerCommandTransportOptions = {},
  rollbackRowMetadata: ChatRowMetadataRollback = restoreChatRowMetadata,
): void {
  const commandPatch = sanitizeFrozenChatPatch(patch)
  if (Object.keys(commandPatch).length === 0) return
  const rollbackSnapshot: ChatRowMetadataSnapshot = {
    ...rollback,
    attempted: commandPatch,
  }
  runChatCommand(
    (baseRevision) =>
      updateChatCommand(
        {
          baseRevision,
          chatId,
          patch: commandPatch,
          select: false,
        },
        options.signal,
        options.keepalive,
      ),
    () => rollbackRowMetadata(rollbackSnapshot),
    options,
  )
}

// Chat-scoped-rollback variant of `dispatchUpdateChat` for paths that mutate the
// active chat row alongside its message history (e.g. bookmark toggles): a failed
// command restores that one chat row, not the whole characters array.
export function dispatchUpdateChatScoped(chatId: string, patch: ChatSnapshot, previous: ChatScopedSnapshot): void {
  const commandPatch = sanitizeChatPatch(patch)
  if (Object.keys(commandPatch).length === 0) return
  runChatCommand(
    (baseRevision) =>
      updateChatCommand({
        baseRevision,
        chatId,
        patch: commandPatch,
        select: false,
      }),
    () => restoreChatScopedState(previous),
  )
}

export function setCurrentChatGreetingIndex(
  fmIndex: number,
  options: SetCurrentChatGreetingIndexOptions = {},
): boolean {
  const selectedChar = options.selectedChar ?? get(selectedCharID)
  const character = DBState.db.characters?.[selectedChar]
  if (!character?.chats) return false
  const selectedChat = options.selectedChat ?? character.chatPage
  const chat = character.chats?.[selectedChat]
  if (!chat) return false
  const chatId = chat.id

  const shouldDispatch = options.dispatch !== false
  const previous = shouldDispatch && chatId ? currentChatStateSnapshot() : null
  let applied = false
  withTrustedServerProjectionWrite(() => {
    const liveCharacter = DBState.db.characters?.[selectedChar]
    const liveChat = liveCharacter?.chats?.[selectedChat]
    if (!liveChat || (chatId && liveChat.id !== chatId)) return
    liveChat.fmIndex = fmIndex
    applied = true
  })
  if (!applied) return false

  if (chatId && previous) {
    dispatchUpdateChat(chatId, { fmIndex }, previous)
  }
  return true
}

export function dispatchSaveChatGenerationSettings(
  chatId: string,
  generationSettings: ChatGenerationSettings,
  options: ServerCommandTransportOptions = {},
): boolean {
  const rollback = currentChatGenerationSettingsSnapshot(chatId)
  if (!rollback) return false
  const commandSettings = cloneJsonValue(generationSettings)

  let applied = false
  withTrustedServerProjectionWrite(() => {
    const location = locateChatById(chatId, rollback.characterId)
    if (!location) return
    location.chat.generationSettings = cloneJsonValue(commandSettings)
    applied = true
  })
  if (!applied) return false

  if (canUseServerCommands()) {
    const savePromise = enqueueChatGenerationSettingsSave(chatId, () =>
      runServerCommand({
        command: (baseRevision) =>
          saveChatGenerationSettingsCommand(
            {
              baseRevision,
              chatId,
              generationSettings: commandSettings,
            },
            options.signal,
            options.keepalive,
          ),
        rollback: () => restoreChatGenerationSettings(rollback),
        ...options,
      }),
    )
    void savePromise
  }
  return true
}

function enqueueChatGenerationSettingsSave(
  chatId: string,
  run: () => Promise<ServerCommandResult>,
): Promise<ServerCommandResult | null> {
  const previous = pendingChatGenerationSettingsSaves.get(chatId) ?? Promise.resolve(null)
  const next = previous
    .catch(() => null)
    .then(() => run())
    .finally(() => {
      if (pendingChatGenerationSettingsSaves.get(chatId) === next) {
        pendingChatGenerationSettingsSaves.delete(chatId)
      }
    })
  pendingChatGenerationSettingsSaves.set(chatId, next)
  return next
}

export function dispatchCompatibleChatUpdate(
  previousChat: Chat | undefined,
  nextChat: Chat | undefined,
  previous: ChatStateSnapshot,
): void {
  const factories = buildCompatibleChatUpdateFactories(previousChat, nextChat)
  if (factories.length > 0) runChatCommandSequence(factories, () => restoreChatState(previous))
}

// Narrow-rollback variant of `dispatchCompatibleChatUpdate` for the slash-command
// message mutation path. Same per-resource factories, but a failed sequence
// restores only the one active chat row instead of the whole characters array.
export function dispatchCompatibleChatUpdateScoped(
  previousChat: Chat | undefined,
  nextChat: Chat | undefined,
  previous: ChatScopedSnapshot,
): void {
  const factories = buildCompatibleChatUpdateFactories(previousChat, nextChat)
  if (factories.length > 0) runChatCommandSequence(factories, () => restoreChatScopedState(previous))
}

export async function dispatchCompatibleChatUpdateScopedAsync(
  previousChat: Chat | undefined,
  nextChat: Chat | undefined,
  previous: ChatScopedSnapshot,
): Promise<ServerCommandResult | null> {
  const factories = buildCompatibleChatUpdateFactories(previousChat, nextChat)
  return runOptimisticCommandSequenceAsync(factories, () => restoreChatScopedState(previous))
}

export function mutateChatWithScopedCommand(
  mutate: (chat: Chat, character: character) => void,
  options: MutateChatScopedOptions = {},
): boolean {
  const selectedChar = options.selectedChar ?? get(selectedCharID)
  const character = DBState.db.characters?.[selectedChar]
  if (!character?.chats) return false
  const selectedChat = options.selectedChat ?? character.chatPage
  const chat = character.chats?.[selectedChat]
  if (!chat) return false

  const previousChat = cloneJsonValue(chat) as Chat
  const scopedRollback: ChatScopedSnapshot = {
    selectedCharID: selectedChar,
    characterId: character.chaId,
    chatId: previousChat.id,
    chat: previousChat,
  }

  let applied = false
  withTrustedServerProjectionWrite(() => {
    const liveCharacter = DBState.db.characters?.[selectedChar]
    const liveChat = liveCharacter?.chats?.[selectedChat]
    if (!liveCharacter || !liveChat) return
    mutate(liveChat, liveCharacter)
    applied = true
  })
  if (!applied) return false

  const nextChat = DBState.db.characters?.[selectedChar]?.chats?.[selectedChat]
  if (!nextChat) return false
  dispatchCompatibleChatUpdateScoped(previousChat, cloneJsonValue(nextChat) as Chat, scopedRollback)
  return true
}

export async function mutateChatWithScopedCommandAsync(
  mutate: (chat: Chat, character: character) => void,
  options: MutateChatScopedOptions = {},
): Promise<boolean> {
  const selectedChar = options.selectedChar ?? get(selectedCharID)
  const character = DBState.db.characters?.[selectedChar]
  if (!character?.chats) return false
  const selectedChat = options.selectedChat ?? character.chatPage
  const chat = character.chats?.[selectedChat]
  if (!chat) return false

  const previousChat = cloneJsonValue(chat) as Chat
  const scopedRollback: ChatScopedSnapshot = {
    selectedCharID: selectedChar,
    characterId: character.chaId,
    chatId: previousChat.id,
    chat: previousChat,
  }

  let applied = false
  withTrustedServerProjectionWrite(() => {
    const liveCharacter = DBState.db.characters?.[selectedChar]
    const liveChat = liveCharacter?.chats?.[selectedChat]
    if (!liveCharacter || !liveChat) return
    mutate(liveChat, liveCharacter)
    applied = true
  })
  if (!applied) return false

  const nextChat = DBState.db.characters?.[selectedChar]?.chats?.[selectedChat]
  if (!nextChat) return false
  await dispatchCompatibleChatUpdateScopedAsync(previousChat, cloneJsonValue(nextChat) as Chat, scopedRollback)
  return true
}

// Factory-list form of dispatchCompatibleChatUpdate so the V3 plugin API can
// route through runOptimisticCommandSequence instead of a fire-and-forget
// dispatch. Returns the factories array and a rollback closure.
export function prepareCompatibleChatUpdate(
  previousChat: Chat | undefined,
  nextChat: Chat | undefined,
  previous: ChatStateSnapshot,
): {
  factories: Array<(baseRevision: number) => Promise<ServerCommandResult>>
  rollback: () => void
} {
  return {
    factories: buildCompatibleChatUpdateFactories(previousChat, nextChat),
    rollback: () => restoreChatState(previous),
  }
}

// Build the per-resource command factories for a compatible chat update. Shared
// by the broad and chat-scoped dispatch variants and the V3 plugin path; the
// rollback strategy is the caller's choice.
function buildCompatibleChatUpdateFactories(
  previousChat: Chat | undefined,
  nextChat: Chat | undefined,
): Array<(baseRevision: number) => Promise<ServerCommandResult>> {
  const factories: Array<(baseRevision: number) => Promise<ServerCommandResult>> = []
  const chatId = nextChat?.id ?? previousChat?.id
  if (chatId && previousChat && nextChat) {
    const metadataPatch = changedChatMetadata(previousChat, nextChat)
    if (Object.keys(metadataPatch).length > 0) {
      factories.push((baseRevision) =>
        updateChatCommand({
          baseRevision,
          chatId,
          patch: sanitizeChatPatch(metadataPatch),
          select: false,
        }),
      )
    }

    if (
      snapshotJson(previousChat.message ?? []) !== snapshotJson(nextChat.message ?? []) &&
      !hasServerChatMessagePlaceholders(nextChat.message ?? [])
    ) {
      for (const message of nextChat.message ?? []) {
        ensureMessageId(message)
      }
      const messages = (nextChat.message ?? []).map(toMessageSnapshot)
      factories.push((baseRevision) =>
        replaceMessagesCommand({
          baseRevision,
          chatId,
          messages,
        }),
      )
    }

    const scriptstatePatch = changedScriptstatePatch(previousChat.scriptstate, nextChat.scriptstate)
    if (Object.keys(scriptstatePatch.patch).length > 0 || scriptstatePatch.deleteKeys.length > 0) {
      factories.push((baseRevision) =>
        patchChatScriptstateCommand({
          baseRevision,
          chatId,
          patch: sanitizeScriptstatePatch(scriptstatePatch.patch),
          deleteKeys: scriptstatePatch.deleteKeys.filter((key) => key.length > 0),
        }),
      )
    }
  }
  return factories
}

export function dispatchDeleteChat(chatId: string, previous: ChatStateSnapshot): void {
  const rollback = chatDeleteRollbackFromState(chatId, previous)
  runChatCommand(
    (baseRevision) =>
      deleteChatCommand({
        baseRevision,
        chatId,
      }),
    () => restoreDeletedChatAttempt(rollback),
  )
}

export function dispatchForkChat(
  sourceChatId: string,
  previous: ChatStateSnapshot,
  input: {
    chat: Chat
    sourcePatch?: ChatSnapshot
    folder?: ChatFolder
    select?: boolean
  },
): void {
  const attemptedChat = cloneJsonValue(input.chat)
  const attemptedSourcePatch = input.sourcePatch ? sanitizeFrozenChatPatch(input.sourcePatch) : undefined
  const attemptedFolder = input.folder ? cloneJsonValue(input.folder) : undefined
  const rollback = chatForkRollbackFromState(sourceChatId, previous, {
    chat: attemptedChat,
    sourcePatch: attemptedSourcePatch,
    folder: attemptedFolder,
    select: input.select,
  })
  runChatCommand(
    (baseRevision) =>
      forkChatCommand({
        baseRevision,
        chatId: sourceChatId,
        chat: toChatSnapshot(attemptedChat),
        sourcePatch: attemptedSourcePatch,
        folder: attemptedFolder ? toChatFolderSnapshot(attemptedFolder) : undefined,
        select: input.select,
      }),
    () => restoreForkChatAttempt(rollback),
  )
}

export function dispatchReorderChats(characterId: string, previous: ChatStateSnapshot, selectedChatId?: string): void {
  const character = DBState.db.characters.find((candidate) => candidate.chaId === characterId)
  if (!character) return
  const folderByChatId: Record<string, string | null> = {}
  for (const chat of character.chats) {
    if (!chat.id) continue
    folderByChatId[chat.id] = chat.folderId ?? null
  }
  dispatchReorderChatsByIds(
    characterId,
    character.chats.map((chat) => chat.id).filter(Boolean) as string[],
    folderByChatId,
    previous,
    selectedChatId,
  )
}

export function dispatchReorderChatsByIds(
  characterId: string,
  chatIds: string[],
  folderByChatId: Record<string, string | null>,
  previous: ChatStateSnapshot,
  selectedChatId?: string,
): void {
  const rollback = chatReorderRollbackFromState(characterId, chatIds, folderByChatId, previous)
  const attemptedIds = rollback?.attemptedIds ?? cloneJsonValue(chatIds)
  const attemptedFolderByChatId = rollback?.attemptedFolderByChatId ?? cloneJsonValue(folderByChatId)
  runChatCommand(
    (baseRevision) =>
      reorderChatsCommand({
        baseRevision,
        characterId,
        chatIds: attemptedIds,
        folderByChatId: attemptedFolderByChatId,
        selectedChatId,
      }),
    () => restoreChatOrderAttempt(rollback),
  )
}

export function dispatchReorderChatFoldersAndChatsByIds(
  characterId: string,
  folderIds: string[],
  chatIds: string[],
  folderByChatId: Record<string, string | null>,
  previous: ChatStateSnapshot,
  selectedChatId?: string,
): void {
  const attemptedFolderIds = cloneJsonValue(folderIds)
  const attemptedChatIds = cloneJsonValue(chatIds)
  const attemptedFolderByChatId = cloneJsonValue(folderByChatId)
  const previousCharacter = locateSnapshotCharacterInState(previous, characterId)
  const previousFolderIds = previousCharacter ? chatFolderIds(previousCharacter.chatFolders) : null
  const chatRollback = chatReorderRollbackFromState(characterId, attemptedChatIds, attemptedFolderByChatId, previous)
  let folderAccepted = false

  runOptimisticCommandSequence(
    [
      async (baseRevision) => {
        const result = await reorderChatFoldersCommand({
          baseRevision,
          characterId,
          folderIds: attemptedFolderIds,
          selectedChatId,
        })
        if (result.status === 'ok') folderAccepted = true
        return result
      },
      (baseRevision) =>
        reorderChatsCommand({
          baseRevision,
          characterId,
          chatIds: attemptedChatIds,
          folderByChatId: attemptedFolderByChatId,
          selectedChatId,
        }),
    ],
    () => {
      if (!folderAccepted && previousFolderIds) {
        restoreChatFolderOrderAttempt(characterId, previousFolderIds, attemptedFolderIds, previous)
      }
      restoreChatOrderAttempt(chatRollback)
    },
  )
}

export function dispatchCreateChatFolder(characterId: string, folder: ChatFolder, previous: ChatStateSnapshot): void {
  const attemptedFolder = cloneJsonValue(folder)
  runChatCommand(
    (baseRevision) =>
      createChatFolderCommand({
        baseRevision,
        characterId,
        folder: toChatFolderSnapshot(folder),
      }),
    () => restoreCreatedChatFolderAttempt(characterId, attemptedFolder, previous),
  )
}

export function dispatchUpdateChatFolder(
  folderId: string,
  patch: ChatFolderSnapshot,
  previous: ChatStateSnapshot,
): void {
  const rollback = chatFolderMetadataRollbackFromPatch(folderId, patch, previous)
  const attemptedPatch = cloneJsonValue(patch)
  runChatCommand(
    (baseRevision) =>
      updateChatFolderCommand({
        baseRevision,
        folderId,
        patch: attemptedPatch,
      }),
    () => {
      if (rollback) restoreChatFolderRowMetadata(rollback)
    },
  )
}

// Narrow-rollback variant of `dispatchUpdateChatFolder` for the chat-metadata
// watcher. The rollback restores one folder row's scalar metadata instead of the
// whole characters array.
export function dispatchUpdateChatFolderRow(
  folderId: string,
  patch: ChatFolderSnapshot,
  rollback: ChatFolderRowMetadataSnapshot,
  options: ServerCommandTransportOptions = {},
): void {
  const attemptedPatch = cloneJsonValue(patch)
  const attemptedRollback =
    Object.keys(attemptedPatch).length > 0 || rollback.attempted
      ? {
          ...rollback,
          attempted: { ...(rollback.attempted ?? {}), ...attemptedPatch },
        }
      : rollback
  runChatCommand(
    (baseRevision) =>
      updateChatFolderCommand(
        {
          baseRevision,
          folderId,
          patch: attemptedPatch,
        },
        options.signal,
        options.keepalive,
      ),
    () => restoreChatFolderRowMetadata(attemptedRollback),
    options,
  )
}

export function dispatchDeleteChatFolder(folderId: string, previous: ChatStateSnapshot): void {
  const rollback = chatFolderDeleteRollbackFromState(folderId, previous)
  runChatCommand(
    (baseRevision) =>
      deleteChatFolderCommand({
        baseRevision,
        folderId,
      }),
    () => restoreDeletedChatFolderAttempt(rollback),
  )
}

export function dispatchReorderChatFolders(
  characterId: string,
  previous: ChatStateSnapshot,
  selectedChatId?: string,
): void {
  const character = DBState.db.characters.find((candidate) => candidate.chaId === characterId)
  if (!character) return
  dispatchReorderChatFoldersByIds(
    characterId,
    character.chatFolders.map((folder) => folder.id),
    previous,
    selectedChatId,
  )
}

export function dispatchReorderChatFoldersByIds(
  characterId: string,
  folderIds: string[],
  previous: ChatStateSnapshot,
  selectedChatId?: string,
): void {
  const previousCharacter = locateSnapshotCharacterInState(previous, characterId)
  const previousIds = previousCharacter ? chatFolderIds(previousCharacter.chatFolders) : null
  const attemptedIds = cloneJsonValue(folderIds)
  runChatCommand(
    (baseRevision) =>
      reorderChatFoldersCommand({
        baseRevision,
        characterId,
        folderIds: attemptedIds,
        selectedChatId,
      }),
    () => {
      if (previousIds) restoreChatFolderOrderAttempt(characterId, previousIds, attemptedIds, previous)
    },
  )
}

export function toChatSnapshot(chat: Chat): ChatSnapshot {
  return cloneJsonValue(chat) as unknown as ChatSnapshot
}

export function toChatFolderSnapshot(folder: ChatFolder): ChatFolderSnapshot {
  return cloneJsonValue(folder) as unknown as ChatFolderSnapshot
}

export function dispatchAppendMessage(chatId: string, message: Message, previous: ChatStateSnapshot): void {
  ensureMessageId(message)
  runMessageCommand(
    (baseRevision) =>
      appendMessageCommand({
        baseRevision,
        chatId,
        message: toMessageSnapshot(message),
      }),
    () => restoreChatState(previous),
  )
}

export function appendCurrentChatEmptyCharMessage(): void {
  const previous = currentChatScopedSnapshot()
  const selectedChar = get(selectedCharID)
  const currentCharacter = DBState.db.characters?.[selectedChar]
  const currentChatRecord = currentCharacter?.chats?.[currentCharacter.chatPage]
  if (!currentChatRecord) return

  const nextMessages = cloneJsonValue(currentChatRecord.message ?? [])
  nextMessages.push({
    role: 'char',
    data: '',
  })
  for (const message of nextMessages) {
    if (!isServerChatMessagePlaceholder(message)) {
      ensureMessageId(message)
    }
  }

  withTrustedServerProjectionWrite(() => {
    const liveCharacter = DBState.db.characters?.[selectedChar]
    const liveChat = liveCharacter?.chats?.[liveCharacter.chatPage]
    if (liveChat && (!currentChatRecord.id || liveChat.id === currentChatRecord.id)) {
      liveChat.message = cloneJsonValue(nextMessages)
    }
  })

  if (currentChatRecord.id) {
    dispatchReplaceMessagesScoped(currentChatRecord.id, nextMessages, previous)
  }
}

export async function appendCurrentChatUserMessageForSend(
  input: string | Message,
): Promise<AppendCurrentChatUserMessageResult> {
  const readiness = await import('./activeChatGenerationSettings').then((module) =>
    module.guardActiveChatGenerationSettingsForSend(),
  )
  if (readiness.status === 'error') {
    return { status: 'error', error: readiness.error }
  }

  const selectedChar = get(selectedCharID)
  const message: Message =
    typeof input === 'string'
      ? {
          role: 'user',
          data: input,
          time: Date.now(),
        }
      : input
  const messageId = ensureMessageId(message)
  let chatId: string | undefined
  let characterId: string | undefined
  let applied = false

  withTrustedServerProjectionWrite(() => {
    const character = DBState.db.characters?.[selectedChar]
    const chat = character?.chats?.[character.chatPage]
    if (!chat) return
    chat.message ??= []
    chat.message.push(message)
    characterId = character.chaId
    chatId = chat.id
    applied = true
  })

  if (!applied) {
    return { status: 'error', error: 'No current chat is selected.' }
  }

  if (!canUseServerCommands()) {
    return { status: 'ok', messageId }
  }

  if (!chatId) {
    removeOptimisticCurrentChatMessage({
      selectedCharID: selectedChar,
      characterId,
      chatId,
      messageId,
    })
    return { status: 'error', error: 'The current chat has no server id.' }
  }

  const rollbackAppend = () =>
    removeOptimisticCurrentChatMessage({
      selectedCharID: selectedChar,
      characterId,
      chatId,
      messageId,
    })

  const result = await runServerCommand({
    command: (baseRevision) =>
      appendMessageCommand({
        baseRevision,
        chatId,
        message: toMessageSnapshot(message),
      }),
    rollback: rollbackAppend,
  })

  if (result.status === 'ok') {
    return { status: 'ok', messageId: result.messageId ?? messageId }
  }
  if (result.status === 'conflict') {
    return { status: 'error', error: `Server revision conflict (${result.currentRevision}).` }
  }
  if (result.status === 'unavailable') {
    return { status: 'error', error: 'Server commands are unavailable.' }
  }
  return { status: 'error', error: result.error }
}

function removeOptimisticCurrentChatMessage(input: {
  selectedCharID: number
  characterId: string | undefined
  chatId: string | undefined
  messageId: string
}): void {
  withTrustedServerProjectionWrite(() => {
    const character = locateSnapshotCharacter(input.characterId, input.selectedCharID)
    if (!character?.chats) return
    const chatIndex = locateChatIndex(character, input.chatId)
    if (chatIndex < 0 && input.chatId !== undefined) return
    const chat = chatIndex >= 0 ? character.chats[chatIndex] : character.chats[character.chatPage ?? 0]
    if (!chat?.message) return
    const messageIndex = chat.message.findIndex((message) => message.chatId === input.messageId)
    if (messageIndex >= 0) {
      chat.message.splice(messageIndex, 1)
    }
  })
}

function restoreScopedMessagePatchAttempt(
  previous: ChatScopedSnapshot,
  messageId: string,
  attemptedPatch: MessageSnapshot,
): void {
  if (!previous.chat) return
  withTrustedServerProjectionWrite(() => {
    const liveChat = locateChatScopedSnapshot(previous)
    const liveMessages = liveChat?.message
    if (!liveMessages) return

    const liveMessageIndex = findMessageIndexById(liveMessages, messageId)
    if (liveMessageIndex < 0) return

    const previousMessages = previous.chat?.message ?? []
    const previousMessageById = previousMessages.find((message) => message.chatId === messageId)
    const previousMessageAtLiveIndex = previousMessages[liveMessageIndex]
    const previousMessage =
      previousMessageById ?? (previousMessageAtLiveIndex?.chatId ? undefined : previousMessageAtLiveIndex)
    if (!previousMessage) return

    applyAttemptedFieldRollback({
      target: liveMessages[liveMessageIndex] as unknown as Record<string, unknown>,
      previous: previousMessage as unknown as Record<string, unknown>,
      attempted: attemptedPatch as Record<string, unknown>,
      keys: MESSAGE_PATCH_ALLOWED_KEYS,
      deleteMissingPrevious: true,
    })
  })
}

function restoreScopedMessageListAttempt(previous: ChatScopedSnapshot, attemptedMessages: Message[] | null): void {
  if (!previous.chat || !attemptedMessages) return
  const previousMessages = cloneJsonValue(previous.chat.message ?? [])
  withTrustedServerProjectionWrite(() => {
    const liveChat = locateChatScopedSnapshot(previous)
    if (!liveChat) return
    if (snapshotJson(liveChat.message ?? []) !== snapshotJson(attemptedMessages)) return
    liveChat.message = previousMessages
  })
}

function attemptedMessagesAfterDelete(previous: ChatScopedSnapshot, messageId: string): Message[] | null {
  const messages = cloneJsonValue(previous.chat?.message ?? [])
  const index = findMessageIndexById(messages, messageId)
  if (index < 0) return null
  messages.splice(index, 1)
  return messages
}

function attemptedMessagesAfterTruncate(previous: ChatScopedSnapshot, afterMessageId: string | null): Message[] | null {
  const messages = cloneJsonValue(previous.chat?.message ?? [])
  if (afterMessageId === null) return []
  const index = findMessageIndexById(messages, afterMessageId)
  if (index < 0) return null
  return messages.slice(0, index + 1)
}

function attemptedMessagesAfterReplaceTail(
  previous: ChatScopedSnapshot,
  afterMessageId: string | null,
  messages: Message[],
): Message[] | null {
  const previousMessages = cloneJsonValue(previous.chat?.message ?? [])
  if (afterMessageId === null) return cloneJsonValue(messages)
  const index = findMessageIndexById(previousMessages, afterMessageId)
  if (index < 0) return null
  return previousMessages.slice(0, index + 1).concat(cloneJsonValue(messages))
}

function findMessageIndexById(messages: readonly Message[], messageId: string): number {
  return messages.findIndex((message) => message.chatId === messageId)
}

// Each message-dispatch helper has a `*With(... rollback)` core plus a broad
// (`ChatStateSnapshot`) and a chat-scoped (`ChatScopedSnapshot`) export. The
// scoped variants restore only the active chat row on failure; the broad ones
// remain for callers that still hold a whole-collection snapshot.
function dispatchSanitizedUpdateMessageWith(
  messageId: string,
  commandPatch: MessageSnapshot,
  rollback: () => void,
): void {
  if (Object.keys(commandPatch).length === 0) return
  runMessageCommand(
    (baseRevision) =>
      updateMessageCommand({
        baseRevision,
        messageId,
        patch: commandPatch,
      }),
    rollback,
  )
}

function dispatchUpdateMessageWith(messageId: string, patch: MessageSnapshot, rollback: () => void): void {
  dispatchSanitizedUpdateMessageWith(messageId, sanitizeMessagePatch(patch), rollback)
}

export function dispatchUpdateMessage(messageId: string, patch: MessageSnapshot, previous: ChatStateSnapshot): void {
  dispatchUpdateMessageWith(messageId, patch, () => restoreChatState(previous))
}

export function dispatchUpdateMessageScoped(
  messageId: string,
  patch: MessageSnapshot,
  previous: ChatScopedSnapshot,
): void {
  const commandPatch = sanitizeMessagePatch(patch)
  dispatchSanitizedUpdateMessageWith(messageId, commandPatch, () =>
    restoreScopedMessagePatchAttempt(previous, messageId, commandPatch),
  )
}

function dispatchDeleteMessageWith(messageId: string, rollback: () => void): void {
  runMessageCommand(
    (baseRevision) =>
      deleteMessageCommand({
        baseRevision,
        messageId,
      }),
    rollback,
  )
}

export function dispatchDeleteMessage(messageId: string, previous: ChatStateSnapshot): void {
  dispatchDeleteMessageWith(messageId, () => restoreChatState(previous))
}

export function dispatchDeleteMessageScoped(messageId: string, previous: ChatScopedSnapshot): void {
  const attemptedMessages = attemptedMessagesAfterDelete(previous, messageId)
  dispatchDeleteMessageWith(messageId, () => restoreScopedMessageListAttempt(previous, attemptedMessages))
}

interface TruncateMessagesOptions {
  preserveRemovedAsAlternates?: boolean
}

function dispatchTruncateMessagesWith(
  chatId: string,
  afterMessageId: string | null,
  rollback: () => void,
  options: TruncateMessagesOptions = {},
): Promise<ServerCommandResult | null> {
  if (!canUseServerCommands()) return Promise.resolve(null)
  return runServerCommand({
    command: (baseRevision) =>
      truncateMessagesCommand({
        baseRevision,
        chatId,
        afterMessageId,
        preserveRemovedAsAlternates: options.preserveRemovedAsAlternates,
      }),
    rollback,
  })
}

export function dispatchTruncateMessages(
  chatId: string,
  afterMessageId: string | null,
  previous: ChatStateSnapshot,
  options: TruncateMessagesOptions = {},
): Promise<ServerCommandResult | null> {
  return dispatchTruncateMessagesWith(chatId, afterMessageId, () => restoreChatState(previous), options)
}

export function dispatchTruncateMessagesScoped(
  chatId: string,
  afterMessageId: string | null,
  previous: ChatScopedSnapshot,
  options: TruncateMessagesOptions = {},
): Promise<ServerCommandResult | null> {
  const attemptedMessages = attemptedMessagesAfterTruncate(previous, afterMessageId)
  return dispatchTruncateMessagesWith(
    chatId,
    afterMessageId,
    () => restoreScopedMessageListAttempt(previous, attemptedMessages),
    options,
  )
}

function dispatchReplaceTailMessagesWith(
  chatId: string,
  afterMessageId: string | null,
  messages: Message[],
  rollback: () => void,
): void {
  if (!prepareReplaceTailMessages(messages)) return
  runMessageCommand(
    (baseRevision) =>
      replaceTailMessagesCommand({
        baseRevision,
        chatId,
        afterMessageId,
        messages: messages.map(toMessageSnapshot),
      }),
    rollback,
  )
}

export function dispatchReplaceTailMessages(
  chatId: string,
  afterMessageId: string | null,
  messages: Message[],
  previous: ChatStateSnapshot,
): void {
  dispatchReplaceTailMessagesWith(chatId, afterMessageId, messages, () => restoreChatState(previous))
}

export function dispatchReplaceTailMessagesScoped(
  chatId: string,
  afterMessageId: string | null,
  messages: Message[],
  previous: ChatScopedSnapshot,
): void {
  if (!prepareReplaceTailMessages(messages)) return
  const attemptedMessages = attemptedMessagesAfterReplaceTail(previous, afterMessageId, messages)
  runMessageCommand(
    (baseRevision) =>
      replaceTailMessagesCommand({
        baseRevision,
        chatId,
        afterMessageId,
        messages: messages.map(toMessageSnapshot),
      }),
    () => restoreScopedMessageListAttempt(previous, attemptedMessages),
  )
}

function dispatchReplaceMessagesWith(chatId: string, messages: Message[], rollback: () => void): void {
  if (!prepareReplaceMessages(messages)) return
  runMessageCommand(
    (baseRevision) =>
      replaceMessagesCommand({
        baseRevision,
        chatId,
        messages: messages.map(toMessageSnapshot),
      }),
    rollback,
  )
}

function hasServerChatMessagePlaceholders(messages: readonly Message[]): boolean {
  return messages.some(isServerChatMessagePlaceholder)
}

export function dispatchReplaceMessages(chatId: string, messages: Message[], previous: ChatStateSnapshot): void {
  dispatchReplaceMessagesWith(chatId, messages, () => restoreChatState(previous))
}

export function dispatchReplaceMessagesScoped(chatId: string, messages: Message[], previous: ChatScopedSnapshot): void {
  if (!prepareReplaceMessages(messages)) return
  const attemptedMessages = cloneJsonValue(messages)
  runMessageCommand(
    (baseRevision) =>
      replaceMessagesCommand({
        baseRevision,
        chatId,
        messages: messages.map(toMessageSnapshot),
      }),
    () => restoreScopedMessageListAttempt(previous, attemptedMessages),
  )
}

function prepareReplaceTailMessages(messages: Message[]): boolean {
  if (hasServerChatMessagePlaceholders(messages)) {
    console.warn('Skipped replaceTailMessagesCommand for a partially hydrated chat transcript tail.')
    return false
  }
  for (const message of messages) {
    ensureMessageId(message)
  }
  return true
}

function prepareReplaceMessages(messages: Message[]): boolean {
  if (hasServerChatMessagePlaceholders(messages)) {
    console.warn('Skipped replaceMessagesCommand for a partially hydrated chat transcript.')
    return false
  }
  for (const message of messages) {
    ensureMessageId(message)
  }
  return true
}

function dispatchPatchChatScriptstateWith(
  chatId: string,
  patch: ChatScriptstatePatch,
  deleteKeys: string[],
  rollback: () => void,
): void {
  const commandPatch = sanitizeScriptstatePatch(patch)
  const commandDeleteKeys = deleteKeys.filter((key) => key.length > 0)
  if (Object.keys(commandPatch).length === 0 && commandDeleteKeys.length === 0) return
  runChatCommand(
    (baseRevision) =>
      patchChatScriptstateCommand({
        baseRevision,
        chatId,
        patch: commandPatch,
        deleteKeys: commandDeleteKeys,
      }),
    rollback,
  )
}

export function dispatchPatchChatScriptstate(
  chatId: string,
  patch: ChatScriptstatePatch,
  deleteKeys: string[],
  previous: ChatStateSnapshot,
): void {
  dispatchPatchChatScriptstateWith(chatId, patch, deleteKeys, () => restoreChatState(previous))
}

// Scriptstate-scoped rollback variant for single-key var writes (`setVar`,
// `setChatVar`, `/setvar`, `/addvar`): a failed patch restores only the active
// chat's `scriptstate` map (and optional `note`), never the whole array.
export function dispatchPatchChatScriptstateScoped(
  chatId: string,
  patch: ChatScriptstatePatch,
  deleteKeys: string[],
  previous: ChatScriptstateSnapshot,
): void {
  dispatchPatchChatScriptstateWith(chatId, patch, deleteKeys, () => restoreChatScriptstate(previous))
}

export function dispatchCurrentChatScriptstatePatch(
  patch: ChatScriptstatePatch,
  deleteKeys: string[] = [],
  previous: ChatScriptstateSnapshot = currentChatScriptstateSnapshot(),
): void {
  const chatId = currentSelectedChatId()
  if (!chatId) return
  dispatchPatchChatScriptstateScoped(chatId, patch, deleteKeys, previous)
}

export function setChatScriptstateValue(chatId: string | undefined, key: string, value: unknown): boolean {
  return patchChatScriptstateValue(chatId, { [key]: value })
}

export function patchChatScriptstateValue(
  chatId: string | undefined,
  patch: Record<string, unknown>,
  deleteKeys: readonly string[] = [],
): boolean {
  if (!chatId) return false

  const commandPatch = sanitizeScriptstatePatch(patch)
  const commandDeleteKeys = sanitizeScriptstateDeleteKeys(deleteKeys)
  if (Object.keys(commandPatch).length === 0 && commandDeleteKeys.length === 0) return false

  const location = locateChatById(chatId)
  if (!location) return false
  if (!wouldChangeScriptstate(location.chat.scriptstate, commandPatch, commandDeleteKeys)) return false

  const previous = currentChatScriptstateSnapshotForChat(chatId)
  if (!previous) return false

  let applied = false
  withTrustedServerProjectionWrite(() => {
    const liveLocation = locateChatById(chatId)
    if (!liveLocation) return
    applyScriptstatePatchToChat(liveLocation.chat, commandPatch, commandDeleteKeys)
    applied = true
  })
  if (!applied) return false

  dispatchPatchChatScriptstateScoped(chatId, commandPatch, commandDeleteKeys, previous)
  return true
}

// Author-note write (`v2SetAuthorNote`) with a scriptstate-scoped rollback. The
// note is a chat-row scalar, so the command is a chat update, but the rollback
// reuses the pass's `ChatScriptstateSnapshot` (which also restores `note`).
export function dispatchUpdateChatNoteScoped(chatId: string, note: string, previous: ChatScriptstateSnapshot): void {
  runChatCommand(
    (baseRevision) =>
      updateChatCommand({
        baseRevision,
        chatId,
        patch: sanitizeChatPatch({ note }),
        select: false,
      }),
    () => restoreChatScriptstate(previous),
  )
}

export function setChatNoteValue(chatId: string | undefined, note: string): boolean {
  if (!chatId) return false

  const location = locateChatById(chatId)
  if (!location) return false
  if ((location.chat.note ?? '') === note) return false

  const previous = currentChatScriptstateSnapshotForChat(chatId, true)
  if (!previous) return false

  let applied = false
  withTrustedServerProjectionWrite(() => {
    const liveLocation = locateChatById(chatId)
    if (!liveLocation) return
    liveLocation.chat.note = note
    applied = true
  })
  if (!applied) return false

  dispatchUpdateChatNoteScoped(chatId, note, previous)
  return true
}

export function currentSelectedChatId(): string | undefined {
  const selectedChar = get(selectedCharID)
  const character = DBState.db.characters?.[selectedChar]
  const chat = character?.chats?.[character.chatPage]
  return chat?.id
}

function currentChatScriptstateSnapshotForChat(chatId: string, includeNote = false): ChatScriptstateSnapshot | null {
  const location = locateChatById(chatId)
  if (!location) return null
  const snapshot: ChatScriptstateSnapshot = {
    chatId,
    selectedCharID: get(selectedCharID),
    scriptstate: location.chat.scriptstate ? { ...location.chat.scriptstate } : undefined,
  }
  if (includeNote) snapshot.note = location.chat.note ?? ''
  return snapshot
}

function sanitizeScriptstateDeleteKeys(deleteKeys: readonly string[]): string[] {
  const sanitized: string[] = []
  const seen = new Set<string>()
  for (const key of deleteKeys) {
    if (key.length === 0 || seen.has(key)) continue
    seen.add(key)
    sanitized.push(key)
  }
  return sanitized
}

function applyScriptstatePatchToChat(
  chat: Chat,
  patch: ChatScriptstatePatch,
  deleteKeys: readonly string[] = [],
): void {
  chat.scriptstate ??= {}
  for (const key of deleteKeys) {
    delete chat.scriptstate[key]
  }
  Object.assign(chat.scriptstate, cloneJsonValue(patch))
  if (Object.keys(chat.scriptstate).length === 0) {
    delete chat.scriptstate
  }
}

function wouldChangeScriptstate(
  scriptstate: Chat['scriptstate'] | undefined,
  patch: ChatScriptstatePatch,
  deleteKeys: readonly string[],
): boolean {
  const current = scriptstate ?? {}
  for (const key of deleteKeys) {
    if (Object.prototype.propertyIsEnumerable.call(current, key)) return true
  }
  for (const [key, value] of Object.entries(patch)) {
    if (snapshotJson(current[key]) !== snapshotJson(value)) return true
  }
  return false
}

export function ensureMessageId(message: Message): string {
  if (!message.chatId) {
    message.chatId = v4()
  }
  return message.chatId
}

export function toMessageSnapshot(message: Message): MessageSnapshot {
  return cloneJsonValue(message) as unknown as MessageSnapshot
}

export function sanitizeChatPatch(patch: ChatSnapshot): ChatSnapshot {
  const sanitized: ChatSnapshot = {}
  for (const [key, value] of Object.entries(patch)) {
    if (!CHAT_PATCH_ALLOWED_KEYS.has(key) || value === undefined) continue
    sanitized[key] = cloneJsonValue(value)
  }
  return sanitized
}

function sanitizeFrozenChatPatch(patch: ChatSnapshot): ChatSnapshot {
  return freezeJsonValue(sanitizeChatPatch(patch))
}

export function sanitizeMessagePatch(patch: MessageSnapshot): MessageSnapshot {
  const sanitized: MessageSnapshot = {}
  for (const [key, value] of Object.entries(patch)) {
    if (!MESSAGE_PATCH_ALLOWED_KEYS.has(key) || value === undefined) continue
    sanitized[key] = cloneJsonValue(value)
  }
  return sanitized
}

export function sanitizeScriptstatePatch(patch: Record<string, unknown>): ChatScriptstatePatch {
  const sanitized: ChatScriptstatePatch = {}
  for (const [key, value] of Object.entries(patch)) {
    if (key.length === 0 || value === undefined) continue
    if (!isScriptstateValue(value)) continue
    sanitized[key] = cloneJsonValue(value)
  }
  return sanitized
}

function isScriptstateValue(value: unknown): value is ChatScriptstateValue {
  return (
    typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))
  )
}

export function changedChatMetadata(previous: Chat, current: Chat): ChatSnapshot {
  const patch: ChatSnapshot = {}
  const previousRecord = (previous ?? {}) as unknown as Record<string, unknown>
  const currentRecord = (current ?? {}) as unknown as Record<string, unknown>
  const orderedKeys = chatMetadataPatchKeyOrder(previousRecord, currentRecord)
  const orderedKeySet = new Set(orderedKeys)
  const changedValues = new Map<string, unknown>()

  // Diff only the server-accepted metadata keys. The old shape deep-cloned the
  // entire chat row before `sanitizeChatPatch` immediately stripped transcript,
  // lorebook, and memory payloads; comparing raw allowed values preserves the
  // JSON patch decision while cloning only values that enter the patch.
  for (const key of CHAT_PATCH_ALLOWED_KEYS) {
    if (!orderedKeySet.has(key)) continue
    const previousValue = sanitizedChatMetadataValue(previousRecord, key)
    const currentValue = sanitizedChatMetadataValue(currentRecord, key)
    const currentSnapshotJson = snapshotJson(currentValue)
    if (snapshotJson(previousValue) !== currentSnapshotJson) {
      const patchValue = currentSnapshotJson === JSON_UNDEFINED_SNAPSHOT ? undefined : cloneJsonValue(currentValue)
      changedValues.set(key, patchValue)
    }
  }

  // Emit changed keys in the same order as the old
  // sanitize(previous)->sanitize(current) key union, so serialized patches stay
  // byte-identical while the expensive comparison remains allowlist-scoped.
  for (const key of orderedKeys) {
    if (changedValues.has(key)) {
      patch[key] = changedValues.get(key)
    }
  }
  return patch
}

function chatMetadataPatchKeyOrder(
  previousRecord: Record<string, unknown>,
  currentRecord: Record<string, unknown>,
): string[] {
  const orderedKeys: string[] = []
  const seen = new Set<string>()
  const appendKeys = (record: Record<string, unknown>) => {
    for (const key of Object.keys(record)) {
      if (seen.has(key) || !CHAT_PATCH_ALLOWED_KEYS.has(key)) continue
      if (!hasSanitizedChatMetadataValue(record, key)) continue
      seen.add(key)
      orderedKeys.push(key)
    }
  }
  appendKeys(previousRecord)
  appendKeys(currentRecord)
  return orderedKeys
}

function sanitizedChatMetadataValue(record: Record<string, unknown>, key: string): unknown {
  return hasSanitizedChatMetadataValue(record, key) ? record[key] : undefined
}

function hasSanitizedChatMetadataValue(record: Record<string, unknown>, key: string): boolean {
  return (
    Object.prototype.propertyIsEnumerable.call(record, key) && snapshotJson(record[key]) !== JSON_UNDEFINED_SNAPSHOT
  )
}

function changedScriptstatePatch(
  previous: Chat['scriptstate'] | undefined,
  current: Chat['scriptstate'] | undefined,
): { patch: ChatScriptstatePatch; deleteKeys: string[] } {
  const patch: ChatScriptstatePatch = {}
  const deleteKeys: string[] = []
  const previousState = previous ?? {}
  const currentState = current ?? {}
  const keys = new Set([...Object.keys(previousState), ...Object.keys(currentState)])
  for (const key of keys) {
    if (!(key in currentState)) {
      deleteKeys.push(key)
      continue
    }
    if (snapshotJson(previousState[key]) !== snapshotJson(currentState[key])) {
      patch[key] = currentState[key]
    }
  }
  return { patch: sanitizeScriptstatePatch(patch), deleteKeys }
}

const JSON_UNDEFINED_SNAPSHOT = '__undefined__'

function snapshotJson(value: unknown): string {
  const snapshot = JSON.stringify(value)
  return snapshot === undefined ? JSON_UNDEFINED_SNAPSHOT : snapshot
}
