import { get } from 'svelte/store'
import { v4 } from 'uuid'
import { alertToast } from '../alert'
import {
  changeToPreset,
  getDatabase,
  type MessagePresetInfo,
  type Message,
  type character,
} from '../storage/database.svelte'
import { selectedCharID } from '../stores.svelte'
import { ChatTokenizer } from '../tokenizer'
import { parseToggleSyntax } from '../util'
import { runOptimisticCommandSequence, toMessageSnapshot } from '../chatCommands'
import { resolveActiveChatGenerationSettings } from '../activeChatGenerationSettings'
import type { ChatGenerationRequiredSidebarToggle } from '../chatGenerationSettings'
import {
  canUseServerCommands,
  replaceTailMessagesCommand,
  updateCharacterCommand,
  type MessageSnapshot,
  type ServerCommandResult,
} from '../server/commands'
import { isServerChatMessagePlaceholder } from '../server/chatMessagePlaceholders'
import { withTrustedResourceWrite } from '../server/resourceWriteGuard.svelte'
import { captureChatBodyProjectionEpoch } from '../server/resourceState.svelte'
import { getModuleToggles } from './modules'

export interface SendChatContextResult {
  selectedChar: number
  selectedChat: number
  nowChatroom: character
  promptInfo: MessagePresetInfo
  tokenizer: ChatTokenizer
  maxContextTokens: number
}

interface SendRollbackSnapshot {
  characterId: string | undefined
  characterIndex: number
  chatId: string | undefined
  chatIndex: number
  lastInteraction: number | undefined
  messages?: MessageSnapshot[]
}

function currentSendRollbackSnapshot(input: {
  characterIndex: number
  character: character
  chatIndex: number
  messages?: Message[]
}): SendRollbackSnapshot {
  const chat = input.character.chats?.[input.chatIndex]
  return {
    characterId: input.character.chaId,
    characterIndex: input.characterIndex,
    chatId: chat?.id,
    chatIndex: input.chatIndex,
    lastInteraction: input.character.lastInteraction,
    ...(input.messages
      ? {
          messages: input.messages.map(toMessageSnapshot),
        }
      : {}),
  }
}

function restoreSendRollbackSnapshot(snapshot: SendRollbackSnapshot): void {
  withTrustedResourceWrite(() => {
    const character = locateSendSnapshotCharacter(snapshot)
    if (!character) return

    character.lastInteraction = snapshot.lastInteraction

    if (!snapshot.messages) return
    const chatIndex = locateSendSnapshotChatIndex(character, snapshot)
    if (chatIndex < 0) return
    character.chats[chatIndex].message = snapshot.messages.map(
      (message) => toMessageSnapshot(message as Message) as unknown as Message,
    )
  })
}

function locateSendSnapshotCharacter(snapshot: SendRollbackSnapshot): character | undefined {
  const characters = getDatabase().characters
  if (!characters) return undefined
  if (snapshot.characterId) {
    return characters.find((candidate) => candidate.chaId === snapshot.characterId)
  }
  return characters[snapshot.characterIndex]
}

function locateSendSnapshotChatIndex(character: character, snapshot: SendRollbackSnapshot): number {
  if (snapshot.chatId) {
    return character.chats?.findIndex((candidate) => candidate.id === snapshot.chatId) ?? -1
  }
  const index = snapshot.chatIndex
  return index >= 0 && index < (character.chats?.length ?? 0) ? index : -1
}

function messageIdBackfillTail(messages: Message[]): { startIndex: number; afterMessageId: string } | null {
  if (messages.some(isServerChatMessagePlaceholder)) return null

  const firstMissingIndex = messages.findIndex((message) => message.chatId == null)
  if (firstMissingIndex <= 0) return null
  if (messages.slice(firstMissingIndex).some((message) => message.chatId != null)) return null

  const afterMessageId = messages[firstMissingIndex - 1]?.chatId
  return typeof afterMessageId === 'string' && afterMessageId.length > 0
    ? { startIndex: firstMissingIndex, afterMessageId }
    : null
}

/**
 * Run the sendChat entry-context setup: retained compatibility-only preset-chain
 * and statistics handling (skipped by the live Fastify runtime), character + chat
 * lookup, lastInteraction stamp, chatId backfill, promptInfo seed (gated on
 * `promptInfoInsideChat`), and tokenizer creation. Mutates client resource state
 * (`statics.messages`, character `lastInteraction`, message `chatId`).
 *
 * The coordinator handles the closures (`throwError`,
 * `runCurrentChatFunction`, etc.) and the `doingChat` lifecycle around
 * this helper.
 */
export function setupSendChatContext(args: {
  chatProcessIndex: number
  chatAdditonalTokens?: number
}): SendChatContextResult {
  const { chatProcessIndex, chatAdditonalTokens: argChatAdditonalTokens } = args
  const serverBacked = canUseServerCommands()

  if (!serverBacked && chatProcessIndex === -1 && getDatabase().presetChain) {
    const names = getDatabase()
      .presetChain.split(',')
      .map((v) => v.trim())
    const randomSelect = Math.floor(Math.random() * names.length)
    const ele = names[randomSelect]

    const findId = getDatabase().botPresets.findIndex((v) => {
      return v.name === ele
    })

    if (findId === -1) {
      alertToast(`Cannot find preset: ${ele}`)
    } else {
      changeToPreset(findId, true)
    }
  }

  if (!serverBacked) {
    getDatabase().statics.messages += 1
  }
  const selectedChar = get(selectedCharID)
  const lastInteraction = Date.now()

  if (serverBacked) {
    // Serialize the lastInteraction update and the message-id backfill against
    // one optimistic snapshot. The sequencer awaits each response so the next
    // command reads the updated revision.
    const factories: Array<(baseRevision: number) => Promise<ServerCommandResult>> = []
    let rollbackSnapshot: SendRollbackSnapshot | null = null

    withTrustedResourceWrite(() => {
      const nowChatroom = getDatabase().characters[selectedChar]
      const characterId = nowChatroom.chaId
      const selectedChat = nowChatroom.chatPage
      const selectedChatRecord = nowChatroom.chats[selectedChat]
      const hasUnloadedMessages = selectedChatRecord.message.some(isServerChatMessagePlaceholder)
      const needsMessageIdBackfill = !hasUnloadedMessages && selectedChatRecord.message.some((v) => v.chatId == null)
      const backfillTail =
        needsMessageIdBackfill && selectedChatRecord.id ? messageIdBackfillTail(selectedChatRecord.message) : null

      if (characterId || needsMessageIdBackfill) {
        rollbackSnapshot = currentSendRollbackSnapshot({
          characterIndex: selectedChar,
          character: nowChatroom,
          chatIndex: selectedChat,
          messages: needsMessageIdBackfill ? selectedChatRecord.message : undefined,
        })
      }

      nowChatroom.lastInteraction = lastInteraction
      if (characterId) {
        factories.push((baseRevision) =>
          updateCharacterCommand({
            baseRevision,
            characterId,
            patch: { lastInteraction },
          }),
        )
      }

      if (needsMessageIdBackfill) {
        selectedChatRecord.message = selectedChatRecord.message.map((v) => {
          v.chatId = v.chatId ?? v4()
          return v
        })
        if (selectedChatRecord.id && backfillTail) {
          const chatId = selectedChatRecord.id
          const messages = selectedChatRecord.message.slice(backfillTail.startIndex).map(toMessageSnapshot)
          const optimisticChatBodyProjectionEpoch = captureChatBodyProjectionEpoch(chatId)
          factories.push((baseRevision) =>
            replaceTailMessagesCommand({
              baseRevision,
              chatId,
              afterMessageId: backfillTail.afterMessageId,
              messages,
              optimisticChatBodyProjectionEpoch,
            }),
          )
        }
      }
    })

    if (factories.length > 0 && rollbackSnapshot) {
      const snapshot = rollbackSnapshot
      runOptimisticCommandSequence(factories, () => restoreSendRollbackSnapshot(snapshot))
    }
  } else {
    const nowChatroom = getDatabase().characters[selectedChar]
    nowChatroom.lastInteraction = lastInteraction
    const selectedChatRecord = nowChatroom.chats[nowChatroom.chatPage]
    if (selectedChatRecord.message.some((v) => v.chatId == null)) {
      selectedChatRecord.message = selectedChatRecord.message.map((v) => {
        v.chatId = v.chatId ?? v4()
        return v
      })
    }
  }
  const nowChatroom = getDatabase().characters[selectedChar]
  const selectedChat = nowChatroom.chatPage

  const promptInfo = createInitialPromptInfo(serverBacked)

  let caculatedChatTokens = 0
  if (getDatabase().aiModel.startsWith('gpt')) {
    caculatedChatTokens += 5
  } else {
    caculatedChatTokens += 3
  }

  const chatAdditonalTokens = argChatAdditonalTokens ?? caculatedChatTokens
  const tokenizer = new ChatTokenizer(chatAdditonalTokens, getDatabase().aiModel.startsWith('gpt') ? 'noName' : 'name')
  const maxContextTokens = getDatabase().maxContext

  return {
    selectedChar,
    selectedChat,
    nowChatroom,
    promptInfo,
    tokenizer,
    maxContextTokens,
  }
}

function createInitialPromptInfo(serverBacked: boolean): MessagePresetInfo {
  if (!getDatabase().promptInfoInsideChat) return {}
  return serverBacked ? createServerBackedPromptInfo() : createLegacyPromptInfo()
}

function createServerBackedPromptInfo(): MessagePresetInfo {
  const activeSettings = resolveActiveChatGenerationSettings()
  return {
    promptName: stringProperty(activeSettings.promptPreset, 'name'),
    promptToggles: activeSettings.requiredSidebarToggles.flatMap((toggle) =>
      formatChatScopedPromptToggle(toggle, activeSettings.settings?.sidebarToggles?.[toggle.key]),
    ),
  }
}

function formatChatScopedPromptToggle(
  toggle: ChatGenerationRequiredSidebarToggle,
  raw: string | undefined,
): { key: string; value: string }[] {
  if (toggle.kind === 'select') {
    if (typeof raw !== 'string') return []
    const optionIndex = Number(raw)
    const selectedOption = Number.isInteger(optionIndex) ? toggle.options[optionIndex] : undefined
    return [{ key: toggle.label, value: selectedOption ?? raw }]
  }
  if (toggle.kind === 'text' || toggle.kind === 'textarea') {
    return typeof raw === 'string' ? [{ key: toggle.label, value: raw }] : []
  }
  if (raw === '1') {
    return [{ key: toggle.label, value: 'ON' }]
  }
  return []
}

function createLegacyPromptInfo(): MessagePresetInfo {
  const db = getDatabase()
  const initialPresetName = db.botPresets[db.botPresetsId]?.name ?? ''
  const initialPromptToggles = parseToggleSyntax(db.customPromptTemplateToggle + getModuleToggles()).flatMap(
    (toggle) => {
      const raw = db.globalChatVariables[`toggle_${toggle.key}`]
      if (toggle.type === 'select' || toggle.type === 'text') {
        return [{ key: toggle.value, value: toggle.options[raw] }]
      }
      if (raw === '1') {
        return [{ key: toggle.value, value: 'ON' }]
      }
      return []
    },
  )

  return {
    promptName: initialPresetName,
    promptToggles: initialPromptToggles,
  }
}

function stringProperty(value: unknown, key: string): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ''
  const raw = (value as Record<string, unknown>)[key]
  return typeof raw === 'string' ? raw : ''
}
