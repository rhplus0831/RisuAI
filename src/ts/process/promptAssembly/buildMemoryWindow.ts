import { language } from '../../../lang'
import { canUseServerCommands } from '../../server/commands'
import {
  applyChatMetadataOwnerPatch,
  charactersResourceState,
  getChatMetadataOwnerSnapshot,
  getCharacterResourceOwner,
  restoreChatMetadataOwnerSnapshot,
} from '../../server/resourceState.svelte'
import { currentChatScopedSnapshot, dispatchUpdateChatScoped } from '../../chatCommands'
import { getDatabase, type Chat, type character } from '../../storage/database.svelte'
import type { ChatTokenizer } from '../../tokenizer'
import type { OpenAIChat } from '../index.svelte'
import { hypaMemoryV3 } from '../memory/hypav3'
import type { PromptItem } from '../prompt'

export interface BuildMemoryWindowArgs {
  chats: OpenAIChat[]
  currentTokens: number
  maxContextTokens: number
  currentChat: Chat
  /** Always the selected character from the client database at the call site. */
  nowChatroom: character
  tokenizer: ChatTokenizer
  selectedChar: number
  selectedChat: number
  memoryCardUsed: boolean
  promptTemplate: PromptItem[] | null
  /** Mutated: `lastChat` and `chats` slots are written into. */
  unformated: { lastChat: OpenAIChat[]; chats: OpenAIChat[] }
  /** Mutated: stage1/stage2 durations and stage2Start are written into. */
  stageTimings: {
    stage1Start: number
    stage1Duration: number
    stage2Start: number
    stage2Duration: number
  }
  /**
   * Reports user-visible errors. Called for HypaV3 errors and the fallback
   * "too much tokens" condition; the helper returns `stopSending: true`
   * immediately after.
   */
  throwError: (msg: string) => void
  /**
   * Callback for chatProcessStage transitions. Invoked twice on the HypaV3
   * happy path (2 then 1); never invoked on the fallback budget-trim path.
   */
  setProcessStage: (stage: number) => void
}

export type BuildMemoryWindowResult =
  | { stopSending: true }
  | {
      stopSending: false
      chats: OpenAIChat[]
      currentTokens: number
      currentChat: Chat
      memories: OpenAIChat[]
    }

/**
 * Apply the long-term memory window to an assembled history:
 *
 *   - If HypaV3 is enabled on the chatroom, hand off to `hypaMemoryV3`,
 *     persisting summaries back into the client database and the supplied `currentChat`.
 *     A HypaV3 error short-circuits with `stopSending: true` after a final
 *     summary writeback.
 *   - Otherwise, drop the oldest messages until the budget is met. If the
 *     budget cannot be satisfied without losing the only remaining message,
 *     return `stopSending: true`. The lowest surviving `memo` is recorded on
 *     `currentChat.lastMemory`.
 *
 * Then split memory cards out of the history: `supaMemory`/`hypaMemory`
 * entries are either captured into the returned `memories` array (when a
 * memory card is used by the template) or wrapped with
 * `<Previous Conversation>…</Previous Conversation>`. All other rows are
 * marked `removable: true`. The trailing chat is promoted to
 * `unformated.lastChat` when no prompt template is in use.
 */
export async function buildMemoryWindow(args: BuildMemoryWindowArgs): Promise<BuildMemoryWindowResult> {
  const {
    nowChatroom,
    tokenizer,
    selectedChar,
    selectedChat,
    memoryCardUsed,
    promptTemplate,
    unformated,
    stageTimings,
    throwError,
    setProcessStage,
    maxContextTokens,
  } = args
  let chats = args.chats
  let currentTokens = args.currentTokens
  let currentChat = args.currentChat

  if (nowChatroom.supaMemory && getDatabase().hypaV3) {
    stageTimings.stage1Duration = Date.now() - stageTimings.stage1Start
    setProcessStage(2)
    stageTimings.stage2Start = Date.now()
    const sp = await hypaMemoryV3(chats, currentTokens, maxContextTokens, currentChat, nowChatroom, tokenizer)
    if (sp.error) {
      if (sp.memory) {
        writeLegacyHypaV3Memory(currentChat, selectedChar, selectedChat, sp.memory)
      }
      throwError(sp.error)
      return { stopSending: true }
    }
    chats = sp.chats
    currentTokens = sp.currentTokens
    if (sp.memory) {
      writeLegacyHypaV3Memory(currentChat, selectedChar, selectedChat, sp.memory)
    }
    if (!canUseServerCommands()) {
      currentChat = getDatabase().characters[selectedChar].chats[selectedChat]
    }
    stageTimings.stage2Duration = Date.now() - stageTimings.stage2Start
    setProcessStage(1)
  } else {
    stageTimings.stage1Duration = Date.now() - stageTimings.stage1Start
    while (currentTokens > maxContextTokens) {
      if (chats.length <= 1) {
        throwError(language.errors.toomuchtoken + '\n\nRequired Tokens: ' + currentTokens)
        return { stopSending: true }
      }

      currentTokens -= await tokenizer.tokenizeChat(chats[0])
      chats.splice(0, 1)
    }
    const lastMemory = chats[0].memo
    if (canUseServerCommands() && currentChat.id) {
      const previous = currentChatScopedSnapshot({ selectedChar, selectedChat })
      if (charactersResourceState.status === 'ready' && previous.characterId && previous.chatId === currentChat.id) {
        const ownerSnapshot = getChatMetadataOwnerSnapshot(previous.characterId, currentChat.id)
        if (ownerSnapshot && applyChatMetadataOwnerPatch(previous.characterId, currentChat.id, { lastMemory })) {
          dispatchUpdateChatScoped(currentChat.id, { lastMemory }, previous, (snapshot) => {
            if (!snapshot.characterId) return
            restoreChatMetadataOwnerSnapshot({
              characterId: snapshot.characterId,
              chatId: snapshot.chatId,
              metadata: snapshot.metadata,
              attempted: snapshot.attempted,
            })
          })
          const owner = getCharacterResourceOwner(previous.characterId)
          const ownerChats = owner?.chats?.filter((candidate) => candidate.id === currentChat.id) ?? []
          currentChat = ownerChats.length === 1 ? ownerChats[0] : { ...currentChat, lastMemory }
        } else {
          currentChat = { ...currentChat, lastMemory }
        }
      } else if (previous.chatId === currentChat.id && previous.chat) {
        // Pre-extraction compatibility path: aggregate state is authoritative
        // until the resource owner projection is ready.
        currentChat = getDatabase().characters[selectedChar].chats[selectedChat]
        currentChat.lastMemory = lastMemory
        dispatchUpdateChatScoped(currentChat.id, { lastMemory }, previous)
      } else {
        currentChat = { ...currentChat, lastMemory }
      }
    } else if (canUseServerCommands()) {
      currentChat = { ...currentChat, lastMemory }
    } else {
      currentChat.lastMemory = lastMemory
    }
  }

  const memories: OpenAIChat[] = []

  if (!promptTemplate) {
    unformated.lastChat.push(chats[chats.length - 1])
    chats.splice(chats.length - 1, 1)
  }

  unformated.chats = chats
    .map((v) => {
      if (v.memo !== 'supaMemory' && v.memo !== 'hypaMemory') {
        v.removable = true
      } else if (memoryCardUsed) {
        memories.push(v)
        return {
          role: 'system',
          content: '',
        } as OpenAIChat
      } else {
        v.content = `<Previous Conversation>${v.content}</Previous Conversation>`
      }
      return v
    })
    .filter((v) => {
      return v.content.trim() !== '' || (v.multimodals && v.multimodals.length > 0)
    })

  return { stopSending: false, chats, currentTokens, currentChat, memories }
}

function writeLegacyHypaV3Memory(
  currentChat: Chat,
  selectedChar: number,
  selectedChat: number,
  memory: Chat['hypaV3Data'],
): void {
  if (canUseServerCommands()) return
  currentChat.hypaV3Data = memory
  getDatabase().characters[selectedChar].chats[selectedChat].hypaV3Data = memory
}
