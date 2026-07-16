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
import {
  dispatchCharacterOwnedDurableBatch,
  toMessageSnapshot,
  type CharacterOwnedDurableBatchResult,
} from '../chatCommands'
import { resolveActiveChatGenerationSettings } from '../activeChatGenerationSettings'
import type { ChatGenerationRequiredSidebarToggle } from '../chatGenerationSettings'
import { canUseServerCommands, replaceTailMessagesCommand, updateCharacterCommand } from '../server/commands'
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
  persistence: Promise<CharacterOwnedDurableBatchResult>
}

interface SendRollbackSnapshot {
  characterId: string | undefined
  characterIndex: number
  chatId: string | undefined
  chatIndex: number
  lastInteraction: number | undefined
  attemptedLastInteraction: number
  messageIds?: Array<{
    previous: string | undefined
    attempted: string
  }>
}

function currentSendRollbackSnapshot(input: {
  characterIndex: number
  character: character
  chatIndex: number
  attemptedLastInteraction: number
  previousLastInteraction: number | undefined
  messagesBeforeBackfill?: Message[]
}): SendRollbackSnapshot {
  const chat = input.character.chats?.[input.chatIndex]
  return {
    characterId: input.character.chaId,
    characterIndex: input.characterIndex,
    chatId: chat?.id,
    chatIndex: input.chatIndex,
    lastInteraction: input.previousLastInteraction,
    attemptedLastInteraction: input.attemptedLastInteraction,
    ...(input.messagesBeforeBackfill
      ? {
          messageIds: input.messagesBeforeBackfill.flatMap((message, index) => {
            const attempted = chat?.message[index]?.chatId
            return message.chatId == null && typeof attempted === 'string' && attempted.length > 0
              ? [{ previous: message.chatId, attempted }]
              : []
          }),
        }
      : {}),
  }
}

function restoreLastInteraction(snapshot: SendRollbackSnapshot): void {
  withTrustedResourceWrite(() => {
    const character = locateSendSnapshotCharacter(snapshot)
    if (!character) return
    if (character.lastInteraction === snapshot.attemptedLastInteraction) {
      character.lastInteraction = snapshot.lastInteraction
    }
  })
}

function restoreBackfilledMessageIds(snapshot: SendRollbackSnapshot): void {
  if (!snapshot.messageIds?.length) return
  withTrustedResourceWrite(() => {
    const character = locateSendSnapshotCharacter(snapshot)
    if (!character) return
    const chatIndex = locateSendSnapshotChatIndex(character, snapshot)
    if (chatIndex < 0) return
    const messages = character.chats[chatIndex].message
    for (const messageId of snapshot.messageIds) {
      const message = messages.find((candidate) => candidate.chatId === messageId.attempted)
      if (message) message.chatId = messageId.previous
    }
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
 * `promptInfoInsideChat`), and tokenizer creation. The optimistic context is
 * returned synchronously together with the exact durable maintenance promise.
 * Reattach callers disable maintenance so they only reconstruct render context.
 *
 * The coordinator handles the closures (`throwError`,
 * `runCurrentChatFunction`, etc.) and the `doingChat` lifecycle around
 * this helper.
 */
export function setupSendChatContext(args: {
  chatProcessIndex: number
  chatAdditonalTokens?: number
  writeMaintenance?: boolean
}): SendChatContextResult {
  const { chatProcessIndex, chatAdditonalTokens: argChatAdditonalTokens, writeMaintenance = true } = args
  const serverBacked = canUseServerCommands()

  if (writeMaintenance && !serverBacked && chatProcessIndex === -1 && getDatabase().presetChain) {
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

  if (writeMaintenance && !serverBacked) {
    getDatabase().statics.messages += 1
  }
  const selectedChar = get(selectedCharID)
  const lastInteraction = Date.now()
  let persistence: Promise<CharacterOwnedDurableBatchResult> = Promise.resolve({
    status: 'ok',
    acceptedCount: 0,
  })

  if (writeMaintenance && serverBacked) {
    const steps: Parameters<typeof dispatchCharacterOwnedDurableBatch>[1][number][] = []
    let rollbackSnapshot: SendRollbackSnapshot | null = null
    let characterId: string | undefined

    withTrustedResourceWrite(() => {
      const nowChatroom = getDatabase().characters[selectedChar]
      characterId = nowChatroom.chaId
      const selectedChat = nowChatroom.chatPage
      const selectedChatRecord = nowChatroom.chats[selectedChat]
      const hasUnloadedMessages = selectedChatRecord.message.some(isServerChatMessagePlaceholder)
      const needsMessageIdBackfill = !hasUnloadedMessages && selectedChatRecord.message.some((v) => v.chatId == null)
      const backfillTail =
        needsMessageIdBackfill && selectedChatRecord.id ? messageIdBackfillTail(selectedChatRecord.message) : null
      const previousLastInteraction = nowChatroom.lastInteraction
      const messagesBeforeBackfill = needsMessageIdBackfill
        ? selectedChatRecord.message.map((message) => ({ ...message }))
        : undefined

      nowChatroom.lastInteraction = lastInteraction
      if (needsMessageIdBackfill) {
        selectedChatRecord.message = selectedChatRecord.message.map((message) => {
          message.chatId = message.chatId ?? v4()
          return message
        })
      }

      rollbackSnapshot = currentSendRollbackSnapshot({
        characterIndex: selectedChar,
        character: nowChatroom,
        chatIndex: selectedChat,
        attemptedLastInteraction: lastInteraction,
        previousLastInteraction,
        messagesBeforeBackfill,
      })

      if (characterId) {
        const pathCharacterId = characterId
        steps.push({
          method: 'PATCH',
          path: `/characters/${encodeURIComponent(pathCharacterId)}`,
          body: { patch: { lastInteraction } },
          command: (baseRevision, frozenBody) =>
            updateCharacterCommand({
              baseRevision,
              characterId: pathCharacterId,
              patch: frozenBody.patch as { lastInteraction: number },
            }),
          rollback: () => {
            if (rollbackSnapshot) restoreLastInteraction(rollbackSnapshot)
            if (!backfillTail && rollbackSnapshot) restoreBackfilledMessageIds(rollbackSnapshot)
          },
        })
      }

      if (selectedChatRecord.id && backfillTail) {
        const chatId = selectedChatRecord.id
        const optimisticChatBodyProjectionEpoch = captureChatBodyProjectionEpoch(chatId)
        steps.push({
          method: 'POST',
          path: `/chats/${encodeURIComponent(chatId)}/messages/tail`,
          body: {
            afterMessageId: backfillTail.afterMessageId,
            messages: selectedChatRecord.message.slice(backfillTail.startIndex).map(toMessageSnapshot),
          },
          command: (baseRevision, frozenBody) =>
            replaceTailMessagesCommand({
              baseRevision,
              chatId,
              afterMessageId: frozenBody.afterMessageId as string,
              messages: frozenBody.messages as ReturnType<typeof toMessageSnapshot>[],
              optimisticChatBodyProjectionEpoch,
            }),
          rollback: () => {
            if (rollbackSnapshot) restoreBackfilledMessageIds(rollbackSnapshot)
          },
        })
      }
    })

    if (!characterId) {
      if (rollbackSnapshot) {
        restoreLastInteraction(rollbackSnapshot)
        restoreBackfilledMessageIds(rollbackSnapshot)
      }
      persistence = Promise.resolve({
        status: 'failure',
        acceptedCount: 0,
        failure: { status: 'error', error: 'Missing character mutation owner', reason: 'invalid-request' },
      })
    } else if (steps.length > 0) {
      persistence = dispatchCharacterOwnedDurableBatch(characterId, steps)
    }
  } else if (writeMaintenance && !serverBacked) {
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
    persistence,
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
