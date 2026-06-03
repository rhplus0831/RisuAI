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
    const character = locateSnapshotCharacter(snapshot.characterId, snapshot.selectedCharID)
    if (!character?.chats) return
    const index = locateChatIndex(character, snapshot.chatId)
    if (index < 0) return
    character.chats[index] = cloneJsonValue(snapshot.chat) as Chat
  })
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
  if (includeNote) snapshot.note = chat?.note
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

function locateSnapshotCharacter(
  characterId: string | undefined,
  fallbackIndex: number,
): character | undefined {
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
}

export function restoreChatRowMetadata(snapshot: ChatRowMetadataSnapshot): void {
  withTrustedServerProjectionWrite(() => {
    const character = locateSnapshotCharacter(snapshot.characterId, snapshot.selectedCharID)
    const chat = character?.chats?.find((candidate) => candidate.id === snapshot.chatId)
    if (!chat) return
    const row = chat as unknown as Record<string, unknown>
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
}

export function restoreChatFolderRowMetadata(snapshot: ChatFolderRowMetadataSnapshot): void {
  withTrustedServerProjectionWrite(() => {
    const character = locateSnapshotCharacter(snapshot.characterId, snapshot.selectedCharID)
    const folder = character?.chatFolders?.find((candidate) => candidate.id === snapshot.folderId)
    if (!folder) return
    folder.name = snapshot.metadata.name as string | undefined
    folder.color = snapshot.metadata.color as string | undefined
    folder.folded = (snapshot.metadata.folded as boolean | undefined) ?? false
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

// Exported so other modules can serialize multi-resource command fan-out
// against a shared optimistic snapshot. Each command runs sequentially; if
// one fails (including conflict), the rollback is invoked once and the rest
// are skipped. Without this, sibling `runServerCommand` calls all read the
// same cached `baseRevision` and the later ones 409 after the first succeeds.
export function runOptimisticCommandSequence(
  commands: Array<(baseRevision: number) => Promise<ServerCommandResult>>,
  rollback: () => void,
): void {
  if (!canUseServerCommands() || commands.length === 0) return
  void (async () => {
    for (const command of commands) {
      const result = await runServerCommand({ command })
      if (result.status !== 'ok') {
        rollback()
        return
      }
    }
  })()
}

function runChatCommandSequence(
  commands: Array<(baseRevision: number) => Promise<ServerCommandResult>>,
  rollback: () => void,
): void {
  runOptimisticCommandSequence(commands, rollback)
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

// Narrow-rollback variant of `dispatchUpdateChat` for the chat-metadata watcher.
// Identical command, but the rollback restores one chat row's scalar metadata
// instead of cloning the whole characters array.
export function dispatchUpdateChatRow(
  chatId: string,
  patch: ChatSnapshot,
  rollback: ChatRowMetadataSnapshot,
): void {
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
    () => restoreChatRowMetadata(rollback),
  )
}

// Chat-scoped-rollback variant of `dispatchUpdateChat` for paths that mutate the
// active chat row alongside its message history (e.g. bookmark toggles): a failed
// command restores that one chat row, not the whole characters array.
export function dispatchUpdateChatScoped(
  chatId: string,
  patch: ChatSnapshot,
  previous: ChatScopedSnapshot,
): void {
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

    if (snapshotJson(previousChat.message ?? []) !== snapshotJson(nextChat.message ?? [])) {
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
    chat: Chat
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
        chat: toChatSnapshot(input.chat),
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
  runChatCommand(
    (baseRevision) =>
      reorderChatsCommand({
        baseRevision,
        characterId,
        chatIds: cloneJsonValue(chatIds),
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

// Narrow-rollback variant of `dispatchUpdateChatFolder` for the chat-metadata
// watcher. The rollback restores one folder row's scalar metadata instead of the
// whole characters array.
export function dispatchUpdateChatFolderRow(
  folderId: string,
  patch: ChatFolderSnapshot,
  rollback: ChatFolderRowMetadataSnapshot,
): void {
  runChatCommand(
    (baseRevision) =>
      updateChatFolderCommand({
        baseRevision,
        folderId,
        patch,
      }),
    () => restoreChatFolderRowMetadata(rollback),
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
  runChatCommand(
    (baseRevision) =>
      reorderChatFoldersCommand({
        baseRevision,
        characterId,
        folderIds: cloneJsonValue(folderIds),
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

export async function appendCurrentChatUserMessageForSend(
  data: string,
): Promise<AppendCurrentChatUserMessageResult> {
  const selectedChar = get(selectedCharID)
  const previous = currentChatScopedSnapshot()
  const message: Message = {
    role: 'user',
    data,
    time: Date.now(),
  }
  const messageId = ensureMessageId(message)
  let chatId: string | undefined
  let applied = false

  withTrustedServerProjectionWrite(() => {
    const character = DBState.db.characters?.[selectedChar]
    const chat = character?.chats?.[character.chatPage]
    if (!chat) return
    chat.message ??= []
    chat.message.push(cloneJsonValue(message))
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
    restoreChatScopedState(previous)
    return { status: 'error', error: 'The current chat has no server id.' }
  }

  const result = await runServerCommand({
    command: (baseRevision) =>
      appendMessageCommand({
        baseRevision,
        chatId,
        message: toMessageSnapshot(message),
      }),
    rollback: () => restoreChatScopedState(previous),
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

// Each message-dispatch helper has a `*With(... rollback)` core plus a broad
// (`ChatStateSnapshot`) and a chat-scoped (`ChatScopedSnapshot`) export. The
// scoped variants restore only the active chat row on failure; the broad ones
// remain for the reroll/swipe path (narrowed separately) and any caller that
// still holds a whole-collection snapshot.
function dispatchUpdateMessageWith(
  messageId: string,
  patch: MessageSnapshot,
  rollback: () => void,
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
    rollback,
  )
}

export function dispatchUpdateMessage(
  messageId: string,
  patch: MessageSnapshot,
  previous: ChatStateSnapshot,
): void {
  dispatchUpdateMessageWith(messageId, patch, () => restoreChatState(previous))
}

export function dispatchUpdateMessageScoped(
  messageId: string,
  patch: MessageSnapshot,
  previous: ChatScopedSnapshot,
): void {
  dispatchUpdateMessageWith(messageId, patch, () => restoreChatScopedState(previous))
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
  dispatchDeleteMessageWith(messageId, () => restoreChatScopedState(previous))
}

function dispatchTruncateMessagesWith(
  chatId: string,
  afterMessageId: string | null,
  rollback: () => void,
): void {
  runMessageCommand(
    (baseRevision) =>
      truncateMessagesCommand({
        baseRevision,
        chatId,
        afterMessageId,
      }),
    rollback,
  )
}

export function dispatchTruncateMessages(
  chatId: string,
  afterMessageId: string | null,
  previous: ChatStateSnapshot,
): void {
  dispatchTruncateMessagesWith(chatId, afterMessageId, () => restoreChatState(previous))
}

export function dispatchTruncateMessagesScoped(
  chatId: string,
  afterMessageId: string | null,
  previous: ChatScopedSnapshot,
): void {
  dispatchTruncateMessagesWith(chatId, afterMessageId, () => restoreChatScopedState(previous))
}

function dispatchReplaceMessagesWith(
  chatId: string,
  messages: Message[],
  rollback: () => void,
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
    rollback,
  )
}

export function dispatchReplaceMessages(
  chatId: string,
  messages: Message[],
  previous: ChatStateSnapshot,
): void {
  dispatchReplaceMessagesWith(chatId, messages, () => restoreChatState(previous))
}

export function dispatchReplaceMessagesScoped(
  chatId: string,
  messages: Message[],
  previous: ChatScopedSnapshot,
): void {
  dispatchReplaceMessagesWith(chatId, messages, () => restoreChatScopedState(previous))
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
