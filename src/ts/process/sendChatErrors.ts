import { alertError } from '../alert'
import { mutateChatWithScopedCommand } from '../chatCommands'
import { getDatabase, type Message, type MessageGenerationInfo } from '../storage/database.svelte'
import {
  resolveStablePostGenerationChat,
  resolveStablePostGenerationMessage,
  stablePostGenerationMessageTarget,
  type StablePostGenerationChatTarget,
} from './postGeneration/stableTarget'

export interface SendChatErrorContext {
  target: StablePostGenerationChatTarget | null
  messageId?: string
  generationInfo: MessageGenerationInfo | undefined
}

export function reportSendChatError(error: string, ctx: SendChatErrorContext): void {
  if (!getDatabase().inlayErrorResponse) {
    alertError(error)
    return
  }

  try {
    const resolution = resolveStablePostGenerationChat(ctx.target)
    if (!resolution || !Array.isArray(resolution.chat.message)) {
      alertError(error)
      return
    }
    const messageTarget = stablePostGenerationMessageTarget(ctx.target?.characterId, ctx.target?.chatId, ctx.messageId)
    if (messageTarget) {
      const messageResolution = resolveStablePostGenerationMessage(messageTarget)
      if (messageResolution?.message.role !== 'char') {
        alertError(error)
        return
      }
    }

    const suffix = `\n\`\`\`risuerror\n${error}\n\`\`\``
    let wroteTarget = false
    const applied = mutateChatWithScopedCommand(
      (chat, character) => {
        if (character.chaId !== ctx.target?.characterId || chat.id !== ctx.target.chatId) return
        const messages = chat.message
        if (messageTarget) {
          const targetMessage = messages.find((message) => message.chatId === messageTarget.messageId)
          if (targetMessage?.role !== 'char') return
          targetMessage.data += suffix
          wroteTarget = true
          return
        }

        const m: Message = {
          role: 'char',
          data: `\`\`\`risuerror\n${error}\n\`\`\``,
          time: Date.now(),
        }
        m.saying = resolution.character.chaId
        if (ctx.generationInfo) {
          m.generationInfo = ctx.generationInfo
        }
        messages.push(m)
        wroteTarget = true
      },
      { selectedChar: resolution.characterIndex, selectedChat: resolution.chatIndex },
    )
    if (!applied || !wroteTarget) {
      alertError(error)
    }
    return
  } catch (e) {
    console.error(e)
    alertError(error)
    return
  }
}
