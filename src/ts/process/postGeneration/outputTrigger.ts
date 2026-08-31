import type { Chat, character } from '../../storage/database.svelte'
import { getChatMessageOwnerState } from '../../server/chatMessageHydration.svelte'
import { runTrigger } from '../triggers'
import {
  mutateStablePostGenerationChat,
  resolveStablePostGenerationChat,
  type StablePostGenerationChatTarget,
} from './stableTarget'

export interface ApplyOutputTriggerOptions {
  currentChar: character
  currentChat: Chat
  target: StablePostGenerationChatTarget | null
  runCurrentChatFunction: (chat: Chat) => Chat
}

export interface ApplyOutputTriggerResult {
  chat: Chat
  triggerChat: Chat | null
  resendChat: boolean
}

export async function applyOutputTrigger(opts: ApplyOutputTriggerOptions): Promise<ApplyOutputTriggerResult> {
  const { currentChar, currentChat, target, runCurrentChatFunction } = opts
  let chat = currentChat
  const applied = mutateStablePostGenerationChat(target, (ownerChat, character) => {
    const messages = ownerChat.id ? getChatMessageOwnerState(ownerChat.id)?.messages : undefined
    if (!messages) return false
    const updatedChat = runCurrentChatFunction({ ...ownerChat, message: messages })
    const chatIndex = character.chats.indexOf(ownerChat)
    if (chatIndex < 0 || updatedChat.id !== ownerChat.id) return false
    character.chats[chatIndex] = updatedChat
    chat = updatedChat
    return true
  })
  if (!applied || !resolveStablePostGenerationChat(target)) {
    return { chat, triggerChat: null, resendChat: false }
  }
  const triggerResult = await runTrigger(currentChar, 'output', { chat })
  if (!resolveStablePostGenerationChat(target)) {
    return { chat, triggerChat: null, resendChat: false }
  }
  return {
    chat,
    triggerChat: triggerResult && triggerResult.chat ? triggerResult.chat : null,
    resendChat: !!(triggerResult && triggerResult.sendAIprompt),
  }
}
