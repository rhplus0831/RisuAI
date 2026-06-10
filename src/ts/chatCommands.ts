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
  type ServerCommandTransportOptions,
} from './server/commands'
import { withTrustedServerProjectionWrite } from './server/projectionWriteGuard.svelte'
import { isServerChatMessagePlaceholder } from './server/chatMessagePlaceholders'
import { DBState, reloadGuiDisplay, selectedCharID } from './stores.svelte'
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
    const existingIndex = chat.id
      ? character.chats.findIndex((candidate) => candidate.id === chat.id)
      : -1
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

// Scalar chat-selection rollback (stability/perf plan, Phase 1 H2). Selecting a
// chat only flips the owning character's `chatPage` and dispatches an
// empty-patch select command, so its rollback never needs the heavy
// `ChatStateSnapshot` (a synchronous JSON clone of every character with all
// hydrated chat histories — the same class of UI stall the scalar
// `CharacterSelectionSnapshot` removed from character select). `selectedCharID`
// is captured to locate the row on restore, not to restore the store: chat
// select never mutates the character selection, and re-writing it could
// clobber a concurrent character switch. The full-collection snapshot stays
// for genuine restructures (create/delete/reorder/fork).
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
    const liveChatIndex =
      liveCharacter?.chats?.findIndex((candidate) => candidate.id === chatId) ?? -1
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

export interface MutateChatScopedOptions {
  selectedChar?: number
  selectedChat?: number
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

type ChatRowMetadataRollback = (snapshot: ChatRowMetadataSnapshot) => void

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
// A thrown/rejected step is treated as a failure too (L36): it is surfaced and
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

// Scalar-rollback variant of `dispatchUpdateChat` for chat selection (H2): the
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
  const commandPatch = sanitizeChatPatch(patch)
  if (Object.keys(commandPatch).length === 0) return
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
    () => rollbackRowMetadata(rollback),
    options,
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
  if (factories.length > 0)
    runChatCommandSequence(factories, () => restoreChatScopedState(previous))
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
  await dispatchCompatibleChatUpdateScopedAsync(
    previousChat,
    cloneJsonValue(nextChat) as Chat,
    scopedRollback,
  )
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
  options: ServerCommandTransportOptions = {},
): void {
  runChatCommand(
    (baseRevision) =>
      updateChatFolderCommand(
        {
          baseRevision,
          folderId,
          patch,
        },
        options.signal,
        options.keepalive,
      ),
    () => restoreChatFolderRowMetadata(rollback),
    options,
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
  input: string | Message,
): Promise<AppendCurrentChatUserMessageResult> {
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
    const chat =
      chatIndex >= 0 ? character.chats[chatIndex] : character.chats[character.chatPage ?? 0]
    if (!chat?.message) return
    const messageIndex = chat.message.findIndex((message) => message.chatId === input.messageId)
    if (messageIndex >= 0) {
      chat.message.splice(messageIndex, 1)
    }
  })
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
  if (hasServerChatMessagePlaceholders(messages)) {
    console.warn('Skipped replaceMessagesCommand for a partially hydrated chat transcript.')
    return
  }
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

function hasServerChatMessagePlaceholders(messages: readonly Message[]): boolean {
  return messages.some(isServerChatMessagePlaceholder)
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
  dispatchPatchChatScriptstateWith(chatId, patch, deleteKeys, () =>
    restoreChatScriptstate(previous),
  )
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

// Author-note write (`v2SetAuthorNote`) with a scriptstate-scoped rollback. The
// note is a chat-row scalar, so the command is a chat update, but the rollback
// reuses the pass's `ChatScriptstateSnapshot` (which also restores `note`).
export function dispatchUpdateChatNoteScoped(
  chatId: string,
  note: string,
  previous: ChatScriptstateSnapshot,
): void {
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
      const patchValue =
        currentSnapshotJson === JSON_UNDEFINED_SNAPSHOT ? undefined : cloneJsonValue(currentValue)
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
    Object.prototype.propertyIsEnumerable.call(record, key) &&
    snapshotJson(record[key]) !== JSON_UNDEFINED_SNAPSHOT
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
