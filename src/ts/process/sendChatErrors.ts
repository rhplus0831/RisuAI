import { get } from 'svelte/store'
import { selectedCharID } from '../stores.svelte'
import { alertError } from '../alert'
import { mutateChatWithScopedCommand } from '../chatCommands'
import { getDatabase, type character, type Message, type MessageGenerationInfo } from '../storage/database.svelte'

export interface SendChatErrorContext {
  selectedChar: number
  selectedChat: number
  currentChar: character | undefined
  generationInfo: MessageGenerationInfo | undefined
}

export function reportSendChatError(error: string, ctx: SendChatErrorContext): void {
  if (!getDatabase().inlayErrorResponse) {
    alertError(error)
    return
  }

  try {
    const db = getDatabase()

    const sc = ctx.selectedChar >= 0 ? ctx.selectedChar : get(selectedCharID)
    const charRoom = db.characters?.[sc]
    if (!charRoom) {
      alertError(error)
      return
    }
    const st = ctx.selectedChat >= 0 ? ctx.selectedChat : charRoom.chatPage
    const chatRoom = charRoom.chats?.[st]
    if (!chatRoom || !Array.isArray(chatRoom.message)) {
      alertError(error)
      return
    }

    const suffix = `\n\`\`\`risuerror\n${error}\n\`\`\``
    const applied = mutateChatWithScopedCommand(
      (chat) => {
        const messages = chat.message
        const last = messages[messages.length - 1]

        if (last?.role === 'char') {
          last.data += suffix
          return
        }

        const m: Message = {
          role: 'char',
          data: `\`\`\`risuerror\n${error}\n\`\`\``,
          time: Date.now(),
        }
        if (ctx.currentChar?.chaId) {
          m.saying = ctx.currentChar.chaId
        }
        if (ctx.generationInfo) {
          m.generationInfo = ctx.generationInfo
        }
        messages.push(m)
      },
      { selectedChar: sc, selectedChat: st },
    )
    if (!applied) {
      alertError(error)
    }
    return
  } catch (e) {
    console.error(e)
    alertError(error)
    return
  }
}
