import { alertError } from '../alert'
import { ensureMessageId } from '../chatCommands'
import { settingsResourceState } from '../server/resourceState.svelte'
import type { Message, MessageGenerationInfo } from '../storage/database.svelte'
import {
  mutateStablePostGenerationChat,
  mutateStablePostGenerationMessage,
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
  if (
    settingsResourceState.status === 'error' ||
    settingsResourceState.groupStatuses.advanced !== 'ready' ||
    settingsResourceState.value.inlayErrorResponse !== true
  ) {
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
    const applied = messageTarget
      ? mutateStablePostGenerationMessage(messageTarget, (message) => {
          if (message.role !== 'char') return
          message.data += suffix
        })
      : mutateStablePostGenerationChat(ctx.target, (chat) => {
          const message: Message = {
            role: 'char',
            data: `\`\`\`risuerror\n${error}\n\`\`\``,
            time: Date.now(),
            saying: resolution.character.chaId,
            ...(ctx.generationInfo ? { generationInfo: ctx.generationInfo } : {}),
          }
          ensureMessageId(message)
          chat.message.push(message)
        })
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
