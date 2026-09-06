import type { FastifyReply } from 'fastify'
import type { PromptChatEvent } from '@risuai/protocol/generation-sse'

export {
  PROMPT_CHAT_EVENT_TYPES,
  PromptChatEventSchema,
  isPromptChatEvent,
  isPromptChatEventType,
  type AgentPresetProgressEvent,
  type DoneEvent,
  type ErrorEvent,
  type GenerationPersistenceDisposition,
  type InfoEvent,
  type JobAcceptedEvent,
  type LineageEnvelope,
  type MessagePatchEvent,
  type PostGenerationFrame,
  type PostGenerationLuaProgressEvent,
  type PostGenerationProgressEvent,
  type PostGenerationTranslationFrame,
  type PostGenerationTranslationProgressEvent,
  type PromptChatEvent,
  type PromptChatEventType,
  type PromptChatStage,
  type PromptEvent,
  type ReplayGapEvent,
  type SideEffectEvent,
  type StageEvent,
  type TokenEvent,
  type WarningEvent,
} from '@risuai/protocol/generation-sse'

/** Serialize a shared chat event into its named SSE frame. */
export function formatPromptChatFrame(event: PromptChatEvent): string {
  const { type, ...rest } = event
  return `event: ${type}\ndata: ${JSON.stringify(rest)}\n\n`
}

/** Fastify-specific response writer kept outside the transport-neutral package. */
export function writePromptChatEvent(reply: FastifyReply, event: PromptChatEvent): void {
  reply.raw.write(formatPromptChatFrame(event))
}
