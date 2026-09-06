import { chatGenerationPhaseFromProcessStage, type ChatGenerationPhase } from 'src/ts/process/generationActivity.svelte'

export const CHAT_GENERATION_INPUT_HOOK_STAGE = 5

export type ChatGenerationLoadingPhase = ChatGenerationPhase | 'input-hook'

export type ChatGenerationLoadingLanguageKey =
  | 'chatGenerationStageStarting'
  | 'chatGenerationStagePreparingPrompt'
  | 'chatGenerationStageCheckingMemory'
  | 'chatGenerationStageWaitingForModel'
  | 'chatGenerationStageGenerating'
  | 'chatGenerationStageFinalizing'
  | 'chatGenerationStageInputHook'

const PHASE_LABEL_KEYS: Record<ChatGenerationLoadingPhase, ChatGenerationLoadingLanguageKey> = {
  starting: 'chatGenerationStageStarting',
  preparing: 'chatGenerationStagePreparingPrompt',
  'checking-memory': 'chatGenerationStageCheckingMemory',
  'waiting-for-model': 'chatGenerationStageWaitingForModel',
  generating: 'chatGenerationStageGenerating',
  finalizing: 'chatGenerationStageFinalizing',
  'input-hook': 'chatGenerationStageInputHook',
}

export function chatGenerationLoadingPhaseFromStage(stage: unknown): ChatGenerationLoadingPhase {
  if (stage === CHAT_GENERATION_INPUT_HOOK_STAGE) return 'input-hook'
  return chatGenerationPhaseFromProcessStage(stage)
}

export function normalizeChatGenerationLoadingPhase(phase: unknown): ChatGenerationLoadingPhase {
  return typeof phase === 'string' && Object.hasOwn(PHASE_LABEL_KEYS, phase)
    ? (phase as ChatGenerationLoadingPhase)
    : 'starting'
}

export function getChatGenerationLoadingLanguageKey(phase: unknown): ChatGenerationLoadingLanguageKey {
  return PHASE_LABEL_KEYS[normalizeChatGenerationLoadingPhase(phase)]
}

export function getPostGenerationScriptProgress(startedAt: number, now: number, llmCallCount = 0): number {
  const elapsedMs = Math.max(0, now - startedAt)
  const timeProgress = Math.min(62, elapsedMs / 180)
  const callProgress = Math.min(14, Math.max(0, llmCallCount) * 4)
  return Math.min(94, Math.round(18 + timeProgress + callProgress))
}
