import { runServerCommand, updateMessageCommand } from '../server/commands'
import { captureChatBodyProjectionEpoch } from '../server/resourceState.svelte'

export interface ServerBackedInlayFinalization {
  chatId: string
  messageId: string
  generationId: string
  expectedData: string
  finalData: string
}

export async function finalizeServerBackedInlayMessage(input: ServerBackedInlayFinalization): Promise<boolean> {
  const dispatch = () =>
    runServerCommand({
      command: (baseRevision) =>
        updateMessageCommand({
          baseRevision,
          messageId: input.messageId,
          patch: { data: input.finalData },
          expectedData: input.expectedData,
          expectedChatId: input.chatId,
          expectedGenerationId: input.generationId,
          optimisticChatId: input.chatId,
          optimisticChatBodyProjectionEpoch: captureChatBodyProjectionEpoch(input.chatId),
        }),
    })

  let result = await dispatch()
  if (result.status === 'conflict') {
    result = await dispatch()
  }
  return result.status === 'ok'
}
