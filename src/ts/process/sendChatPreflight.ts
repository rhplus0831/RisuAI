import type { Message } from '../storage/database.svelte'
import {
  resolveServerPromptAssembly,
  type ServerPromptAssemblyInput,
  type ServerPromptAssemblyRoute,
} from './request/serverPromptAssembly'

export interface ChatSendPreflightInput extends ServerPromptAssemblyInput {
  pendingUserMessage?: Message | null
}

/**
 * Run the same prompt-assembly capability gate as sendChat against the turn
 * that would exist after a successful append, without mutating the transcript.
 */
export function preflightChatSendBeforeMutation(input: ChatSendPreflightInput): ServerPromptAssemblyRoute {
  const { pendingUserMessage, ...assemblyInput } = input
  if (!pendingUserMessage) return resolveServerPromptAssembly(assemblyInput)

  return resolveServerPromptAssembly({
    ...assemblyInput,
    currentChat: {
      ...assemblyInput.currentChat,
      message: [...(assemblyInput.currentChat.message ?? []), pendingUserMessage],
    },
  })
}
