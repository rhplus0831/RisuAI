import { get } from 'svelte/store'
import { v4 } from 'uuid'
import { alertToast } from '../alert'
import {
  changeToPreset,
  type MessagePresetInfo,
  type Message,
  type character,
} from '../storage/database.svelte'
import { DBState } from '../stores.svelte'
import { selectedCharID } from '../stores.svelte'
import { ChatTokenizer } from '../tokenizer'
import { parseToggleSyntax } from '../util'
import { runOptimisticCommandSequence, toMessageSnapshot } from '../chatCommands'
import {
  canUseServerCommands,
  replaceMessagesCommand,
  updateCharacterCommand,
  type MessageSnapshot,
  type ServerCommandResult,
} from '../server/commands'
import { withTrustedServerProjectionWrite } from '../server/projectionWriteGuard.svelte'
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
  withTrustedServerProjectionWrite(() => {
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
  const characters = DBState.db.characters
  if (!characters) return undefined
  if (snapshot.characterId) {
    return characters.find((candidate) => candidate.chaId === snapshot.characterId)
  }
  return characters[snapshot.characterIndex]
}

function locateSendSnapshotChatIndex(
  character: character,
  snapshot: SendRollbackSnapshot,
): number {
  if (snapshot.chatId) {
    return character.chats?.findIndex((candidate) => candidate.id === snapshot.chatId) ?? -1
  }
  const index = snapshot.chatIndex
  return index >= 0 && index < (character.chats?.length ?? 0) ? index : -1
}

/**
 * Run the sendChat entry-context setup: optional preset-chain switch on
 * fresh calls, stats counter, character + chat lookup, lastInteraction
 * stamp, chatId backfill, promptInfo seed (gated on
 * `promptInfoInsideChat`), and tokenizer creation. Mutates DBState
 * (`statics.messages`, character `lastInteraction`, message `chatId`)
 * and may call `changeToPreset` as a side effect.
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

  if (chatProcessIndex === -1 && DBState.db.presetChain) {
    const names = DBState.db.presetChain.split(',').map((v) => v.trim())
    const randomSelect = Math.floor(Math.random() * names.length)
    const ele = names[randomSelect]

    const findId = DBState.db.botPresets.findIndex((v) => {
      return v.name === ele
    })

    if (findId === -1) {
      alertToast(`Cannot find preset: ${ele}`)
    } else {
      changeToPreset(findId, true)
    }
  }

  const serverBacked = canUseServerCommands()
  if (!serverBacked) {
    DBState.db.statics.messages += 1
  }
  const selectedChar = get(selectedCharID)
  const lastInteraction = Date.now()

  if (serverBacked) {
    // Serialize the lastInteraction update and the message-id backfill against
    // one optimistic snapshot. The sequencer awaits each response so the next
    // command reads the updated revision.
    const factories: Array<(baseRevision: number) => Promise<ServerCommandResult>> = []
    let rollbackSnapshot: SendRollbackSnapshot | null = null

    withTrustedServerProjectionWrite(() => {
      const nowChatroom = DBState.db.characters[selectedChar]
      const characterId = nowChatroom.chaId
      const selectedChat = nowChatroom.chatPage
      const selectedChatRecord = nowChatroom.chats[selectedChat]
      const needsMessageIdBackfill = selectedChatRecord.message.some((v) => v.chatId == null)

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
        if (selectedChatRecord.id) {
          const chatId = selectedChatRecord.id
          const messages = selectedChatRecord.message.map(toMessageSnapshot)
          factories.push((baseRevision) =>
            replaceMessagesCommand({
              baseRevision,
              chatId,
              messages,
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
    const nowChatroom = DBState.db.characters[selectedChar]
    nowChatroom.lastInteraction = lastInteraction
    const selectedChatRecord = nowChatroom.chats[nowChatroom.chatPage]
    if (selectedChatRecord.message.some((v) => v.chatId == null)) {
      selectedChatRecord.message = selectedChatRecord.message.map((v) => {
        v.chatId = v.chatId ?? v4()
        return v
      })
    }
  }
  const nowChatroom = DBState.db.characters[selectedChar]
  const selectedChat = nowChatroom.chatPage

  let promptInfo: MessagePresetInfo = {}
  if (DBState.db.promptInfoInsideChat) {
    const initialPresetName = DBState.db.botPresets[DBState.db.botPresetsId]?.name ?? ''
    const initialPromptToggles = parseToggleSyntax(
      DBState.db.customPromptTemplateToggle + getModuleToggles(),
    ).flatMap((toggle) => {
      const raw = DBState.db.globalChatVariables[`toggle_${toggle.key}`]
      if (toggle.type === 'select' || toggle.type === 'text') {
        return [{ key: toggle.value, value: toggle.options[raw] }]
      }
      if (raw === '1') {
        return [{ key: toggle.value, value: 'ON' }]
      }
      return []
    })

    promptInfo = {
      promptName: initialPresetName,
      promptToggles: initialPromptToggles,
    }
  }

  let caculatedChatTokens = 0
  if (DBState.db.aiModel.startsWith('gpt')) {
    caculatedChatTokens += 5
  } else {
    caculatedChatTokens += 3
  }

  const chatAdditonalTokens = argChatAdditonalTokens ?? caculatedChatTokens
  const tokenizer = new ChatTokenizer(
    chatAdditonalTokens,
    DBState.db.aiModel.startsWith('gpt') ? 'noName' : 'name',
  )
  const maxContextTokens = DBState.db.maxContext

  return {
    selectedChar,
    selectedChat,
    nowChatroom,
    promptInfo,
    tokenizer,
    maxContextTokens,
  }
}
