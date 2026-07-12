import { getDatabase, type Chat, type character } from '../../storage/database.svelte'
import { withTrustedServerProjectionWrite } from '../../server/projectionWriteGuard.svelte'
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

export async function applyOutputTrigger(opts: ApplyOutputTriggerOptions): Promise<ApplyOutputTriggerResult> {
  const { currentChar, selectedChar, selectedChat, runCurrentChatFunction } = opts
  withTrustedServerProjectionWrite(() => {
    getDatabase().characters[selectedChar].chats[selectedChat] = runCurrentChatFunction(
      getDatabase().characters[selectedChar].chats[selectedChat],
    )
  })
  const chat = getDatabase().characters[selectedChar].chats[selectedChat]
  const triggerResult = await runTrigger(currentChar, 'output', { chat })
  return {
    chat,
    triggerChat: triggerResult && triggerResult.chat ? triggerResult.chat : null,
    resendChat: !!(triggerResult && triggerResult.sendAIprompt),
  }
}
