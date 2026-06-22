import { randomUUID } from 'node:crypto'

export interface ActiveMessageTranslation {
  chatId: string
  messageId: string
}

interface ActiveMessageTranslationEntry extends ActiveMessageTranslation {
  token: string
}

/**
 * Server-side raw message translations are detached from the browser request so
 * they can finish after a refresh. This registry is the transient bootstrap
 * projection that lets a returning browser keep the row in its busy state.
 */
export class MessageTranslationJobRegistry {
  private readonly activeByMessage = new Map<string, ActiveMessageTranslationEntry>()

  register(input: ActiveMessageTranslation): () => void {
    const token = randomUUID()
    this.activeByMessage.set(input.messageId, { ...input, token })
    return () => {
      if (this.activeByMessage.get(input.messageId)?.token === token) {
        this.activeByMessage.delete(input.messageId)
      }
    }
  }

  activeTranslations(): ActiveMessageTranslation[] {
    return [...this.activeByMessage.values()].map(({ chatId, messageId }) => ({ chatId, messageId }))
  }
}
