import { runServerCommand, updateMessageCommand } from '../server/commands'
import { getChatTranscriptOwnerState } from '../server/chatTranscriptOwner'

export interface ServerBackedInlayFinalization {
  chatId: string
  messageId: string
  generationId: string
  expectedData: string
  finalData: string
}

export async function finalizeServerBackedInlayMessage(input: ServerBackedInlayFinalization): Promise<boolean> {
  const dispatch = () => {
    const owner = getChatTranscriptOwnerState(input.chatId)
    const matches = owner?.messages.filter((message) => message.chatId === input.messageId) ?? []
    const message = matches.length === 1 ? matches[0] : undefined
    if (!owner || !message || message.generationInfo?.generationId !== input.generationId) {
      return null
    }
    return runServerCommand({
      command: (baseRevision) =>
        updateMessageCommand({
          baseRevision,
          messageId: input.messageId,
          patch: { data: input.finalData },
          expectedData: input.expectedData,
          expectedChatId: input.chatId,
          expectedGenerationId: input.generationId,
          optimisticChatId: input.chatId,
          optimisticChatBodyProjectionEpoch: owner.projectionEpoch,
        }),
    })
  }

  let result = await dispatch()
  if (result?.status === 'conflict') {
    result = await dispatch()
  }
  return result?.status === 'ok'
}
