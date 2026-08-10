import type { Chat, character } from '../../storage/database.svelte'
import { withTrustedResourceWrite } from '../../server/resourceWriteGuard.svelte'
import { runTrigger } from '../triggers'
import { resolveStablePostGenerationChat, type StablePostGenerationChatTarget } from './stableTarget'

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
  withTrustedResourceWrite(() => {
    const resolution = resolveStablePostGenerationChat(target)
    if (!resolution) return
    const updatedChat = runCurrentChatFunction(resolution.chat)
    resolution.character.chats[resolution.chatIndex] = updatedChat
    chat = updatedChat
  })
  if (!resolveStablePostGenerationChat(target)) {
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
