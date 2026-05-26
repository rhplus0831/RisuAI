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
  persistGenerationResultCommand,
  reorderChatFoldersCommand,
  reorderChatsCommand,
  replaceMessagesCommand,
  runServerCommand,
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
} from './server/commands'
import { withTrustedServerProjectionWrite } from './server/projectionWriteGuard.svelte'
import { DBState, ReloadGUIPointer, selectedCharID } from './stores.svelte'
import type { Chat, ChatFolder, Message, character } from './storage/database.svelte'
import { v4 } from 'uuid'

export interface ChatStateSnapshot {
  characters: character[]
  selectedCharID: number
}

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

export function cloneJsonValue<T>(value: T): T {
  if (value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
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
    ReloadGUIPointer.set(Math.random())
  })
}

export function runChatCommand<T extends Record<string, unknown>>(
  command: (baseRevision: number) => Promise<ServerCommandResult<T>>,
  rollback: () => void,
): void {
  if (!canUseServerCommands()) return
  void runServerCommand({ command, rollback })
}

export function runMessageCommand<T extends Record<string, unknown>>(
  command: (baseRevision: number) => Promise<ServerCommandResult<T>>,
  rollback: () => void,
): void {
  runChatCommand(command, rollback)
}

export function dispatchCreateChat(
  characterId: string,
  chat: Chat,
  previous: ChatStateSnapshot,
  select = true,
): void {
  runChatCommand(
    (baseRevision) =>
      createChatCommand({
        baseRevision,
        characterId,
        chat: toChatSnapshot(chat),
        select,
      }),
    () => restoreChatState(previous),
  )
}

export function dispatchUpdateChat(
  chatId: string,
  patch: ChatSnapshot,
  previous: ChatStateSnapshot,
  select = false,
): void {
  const commandPatch = sanitizeChatPatch(patch)
  if (Object.keys(commandPatch).length === 0 && !select) return
  runChatCommand(
    (baseRevision) =>
      updateChatCommand({
        baseRevision,
        chatId,
        patch: commandPatch,
        select,
      }),
    () => restoreChatState(previous),
  )
}

export function dispatchCompatibleChatUpdate(
  previousChat: Chat | undefined,
  nextChat: Chat | undefined,
  previous: ChatStateSnapshot,
): void {
  const chatId = nextChat?.id ?? previousChat?.id
  if (!chatId || !previousChat || !nextChat) return

  const metadataPatch = changedChatMetadata(previousChat, nextChat)
  if (Object.keys(metadataPatch).length > 0) {
    dispatchUpdateChat(chatId, metadataPatch, previous)
  }

  if (snapshotJson(previousChat.message ?? []) !== snapshotJson(nextChat.message ?? [])) {
    dispatchReplaceMessages(chatId, nextChat.message ?? [], previous)
  }

  const scriptstatePatch = changedScriptstatePatch(previousChat.scriptstate, nextChat.scriptstate)
  if (Object.keys(scriptstatePatch.patch).length > 0 || scriptstatePatch.deleteKeys.length > 0) {
    dispatchPatchChatScriptstate(
      chatId,
      scriptstatePatch.patch,
      scriptstatePatch.deleteKeys,
      previous,
    )
  }
}

export function dispatchDeleteChat(chatId: string, previous: ChatStateSnapshot): void {
  runChatCommand(
    (baseRevision) =>
      deleteChatCommand({
        baseRevision,
        chatId,
      }),
    () => restoreChatState(previous),
  )
}

export function dispatchForkChat(
  sourceChatId: string,
  previous: ChatStateSnapshot,
  input: {
    chat?: Chat
    sourcePatch?: ChatSnapshot
    folder?: ChatFolder
    select?: boolean
  },
): void {
  runChatCommand(
    (baseRevision) =>
      forkChatCommand({
        baseRevision,
        chatId: sourceChatId,
        chat: input.chat ? toChatSnapshot(input.chat) : undefined,
        sourcePatch: input.sourcePatch ? sanitizeChatPatch(input.sourcePatch) : undefined,
        folder: input.folder ? toChatFolderSnapshot(input.folder) : undefined,
        select: input.select,
      }),
    () => restoreChatState(previous),
  )
}

export function dispatchReorderChats(
  characterId: string,
  previous: ChatStateSnapshot,
  selectedChatId?: string,
): void {
  const character = DBState.db.characters.find((candidate) => candidate.chaId === characterId)
  if (!character) return
  const folderByChatId: Record<string, string | null> = {}
  for (const chat of character.chats) {
    if (!chat.id) continue
    folderByChatId[chat.id] = chat.folderId ?? null
  }
  runChatCommand(
    (baseRevision) =>
      reorderChatsCommand({
        baseRevision,
        characterId,
        chatIds: character.chats.map((chat) => chat.id).filter(Boolean) as string[],
        folderByChatId,
        selectedChatId,
      }),
    () => restoreChatState(previous),
  )
}

export function dispatchCreateChatFolder(
  characterId: string,
  folder: ChatFolder,
  previous: ChatStateSnapshot,
): void {
  runChatCommand(
    (baseRevision) =>
      createChatFolderCommand({
        baseRevision,
        characterId,
        folder: toChatFolderSnapshot(folder),
      }),
    () => restoreChatState(previous),
  )
}

export function dispatchUpdateChatFolder(
  folderId: string,
  patch: ChatFolderSnapshot,
  previous: ChatStateSnapshot,
): void {
  runChatCommand(
    (baseRevision) =>
      updateChatFolderCommand({
        baseRevision,
        folderId,
        patch,
      }),
    () => restoreChatState(previous),
  )
}

export function dispatchDeleteChatFolder(folderId: string, previous: ChatStateSnapshot): void {
  runChatCommand(
    (baseRevision) =>
      deleteChatFolderCommand({
        baseRevision,
        folderId,
      }),
    () => restoreChatState(previous),
  )
}

export function dispatchReorderChatFolders(
  characterId: string,
  previous: ChatStateSnapshot,
  selectedChatId?: string,
): void {
  const character = DBState.db.characters.find((candidate) => candidate.chaId === characterId)
  if (!character) return
  runChatCommand(
    (baseRevision) =>
      reorderChatFoldersCommand({
        baseRevision,
        characterId,
        folderIds: character.chatFolders.map((folder) => folder.id),
        selectedChatId,
      }),
    () => restoreChatState(previous),
  )
}

export function toChatSnapshot(chat: Chat): ChatSnapshot {
  return cloneJsonValue(chat) as unknown as ChatSnapshot
}

export function toChatFolderSnapshot(folder: ChatFolder): ChatFolderSnapshot {
  return cloneJsonValue(folder) as unknown as ChatFolderSnapshot
}

export function dispatchAppendMessage(
  chatId: string,
  message: Message,
  previous: ChatStateSnapshot,
): void {
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

export function dispatchUpdateMessage(
  messageId: string,
  patch: MessageSnapshot,
  previous: ChatStateSnapshot,
): void {
  const commandPatch = sanitizeMessagePatch(patch)
  if (Object.keys(commandPatch).length === 0) return
  runMessageCommand(
    (baseRevision) =>
      updateMessageCommand({
        baseRevision,
        messageId,
        patch: commandPatch,
      }),
    () => restoreChatState(previous),
  )
}

export function dispatchDeleteMessage(messageId: string, previous: ChatStateSnapshot): void {
  runMessageCommand(
    (baseRevision) =>
      deleteMessageCommand({
        baseRevision,
        messageId,
      }),
    () => restoreChatState(previous),
  )
}

export function dispatchTruncateMessages(
  chatId: string,
  afterMessageId: string | null,
  previous: ChatStateSnapshot,
): void {
  runMessageCommand(
    (baseRevision) =>
      truncateMessagesCommand({
        baseRevision,
        chatId,
        afterMessageId,
      }),
    () => restoreChatState(previous),
  )
}

export function dispatchReplaceMessages(
  chatId: string,
  messages: Message[],
  previous: ChatStateSnapshot,
): void {
  for (const message of messages) {
    ensureMessageId(message)
  }
  runMessageCommand(
    (baseRevision) =>
      replaceMessagesCommand({
        baseRevision,
        chatId,
        messages: messages.map(toMessageSnapshot),
      }),
    () => restoreChatState(previous),
  )
}

export function dispatchPersistGenerationResult(
  chatId: string,
  message: Message,
  previous: ChatStateSnapshot,
  targetMessageId?: string,
): void {
  ensureMessageId(message)
  runMessageCommand(
    (baseRevision) =>
      persistGenerationResultCommand({
        baseRevision,
        chatId,
        generationResult: {
          message: toMessageSnapshot(message),
          targetMessageId,
        },
      }),
    () => restoreChatState(previous),
  )
}

export function dispatchPatchChatScriptstate(
  chatId: string,
  patch: ChatScriptstatePatch,
  deleteKeys: string[],
  previous: ChatStateSnapshot,
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
    () => restoreChatState(previous),
  )
}

export function dispatchCurrentChatScriptstatePatch(
  patch: ChatScriptstatePatch,
  deleteKeys: string[] = [],
  previous: ChatStateSnapshot = currentChatStateSnapshot(),
): void {
  const chatId = currentSelectedChatId()
  if (!chatId) return
  dispatchPatchChatScriptstate(chatId, patch, deleteKeys, previous)
}

export function currentSelectedChatId(): string | undefined {
  const selectedChar = get(selectedCharID)
  const character = DBState.db.characters?.[selectedChar]
  const chat = character?.chats?.[character.chatPage]
  return chat?.id
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

export function sanitizeMessagePatch(patch: MessageSnapshot): MessageSnapshot {
  const sanitized: MessageSnapshot = {}
  for (const [key, value] of Object.entries(patch)) {
    if (!MESSAGE_PATCH_ALLOWED_KEYS.has(key) || value === undefined) continue
    sanitized[key] = cloneJsonValue(value)
  }
  return sanitized
}

export function sanitizeScriptstatePatch(patch: ChatScriptstatePatch): ChatScriptstatePatch {
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
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  )
}

function changedChatMetadata(previous: Chat, current: Chat): ChatSnapshot {
  const patch: ChatSnapshot = {}
  const previousSnapshot = sanitizeChatPatch(cloneJsonValue(previous) as unknown as ChatSnapshot)
  const currentSnapshot = sanitizeChatPatch(cloneJsonValue(current) as unknown as ChatSnapshot)
  const keys = new Set([...Object.keys(previousSnapshot), ...Object.keys(currentSnapshot)])
  for (const key of keys) {
    if (snapshotJson(previousSnapshot[key]) !== snapshotJson(currentSnapshot[key])) {
      patch[key] = cloneJsonValue(currentSnapshot[key])
    }
  }
  return patch
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

function snapshotJson(value: unknown): string {
  const snapshot = JSON.stringify(value)
  return snapshot === undefined ? '__undefined__' : snapshot
}
