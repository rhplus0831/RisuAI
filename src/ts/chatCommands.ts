import { get } from 'svelte/store'
import {
  canUseServerCommands,
  createChatCommand,
  createChatFolderCommand,
  deleteChatCommand,
  deleteChatFolderCommand,
  forkChatCommand,
  reorderChatFoldersCommand,
  reorderChatsCommand,
  runServerCommand,
  updateChatCommand,
  updateChatFolderCommand,
  type ChatFolderSnapshot,
  type ChatSnapshot,
  type ServerCommandResult,
} from './server/commands'
import { DBState, ReloadGUIPointer, selectedCharID } from './stores.svelte'
import type { Chat, ChatFolder, character } from './storage/database.svelte'

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
  DBState.db.characters = cloneJsonValue(snapshot.characters)
  selectedCharID.set(snapshot.selectedCharID)
  ReloadGUIPointer.set(Math.random())
}

export function runChatCommand<T extends Record<string, unknown>>(
  command: (baseRevision: number) => Promise<ServerCommandResult<T>>,
  rollback: () => void,
): void {
  if (!canUseServerCommands()) return
  void runServerCommand({ command, rollback })
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

export function sanitizeChatPatch(patch: ChatSnapshot): ChatSnapshot {
  const sanitized: ChatSnapshot = {}
  for (const [key, value] of Object.entries(patch)) {
    if (!CHAT_PATCH_ALLOWED_KEYS.has(key) || value === undefined) continue
    sanitized[key] = cloneJsonValue(value)
  }
  return sanitized
}
