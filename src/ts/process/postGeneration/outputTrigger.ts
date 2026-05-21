import type { Chat, character } from '../../storage/database.svelte'
import { DBState } from '../../stores.svelte'
import { runTrigger } from '../triggers'

export interface ApplyOutputTriggerOptions {
  currentChar: character
  selectedChar: number
  selectedChat: number
  runCurrentChatFunction: (chat: Chat) => Chat
}

export interface ApplyOutputTriggerResult {
  chat: Chat
  triggerChat: Chat | null
  resendChat: boolean
}

export async function applyOutputTrigger(
  opts: ApplyOutputTriggerOptions,
): Promise<ApplyOutputTriggerResult> {
  const { currentChar, selectedChar, selectedChat, runCurrentChatFunction } = opts
  DBState.db.characters[selectedChar].chats[selectedChat] = runCurrentChatFunction(
    DBState.db.characters[selectedChar].chats[selectedChat],
  )
  const chat = DBState.db.characters[selectedChar].chats[selectedChat]
  const triggerResult = await runTrigger(currentChar, 'output', { chat })
  return {
    chat,
    triggerChat: triggerResult && triggerResult.chat ? triggerResult.chat : null,
    resendChat: !!(triggerResult && triggerResult.sendAIprompt),
  }
}
