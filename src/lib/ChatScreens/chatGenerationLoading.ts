export type ChatGenerationLoadingStage = 0 | 1 | 2 | 3 | 4

export type ChatGenerationLoadingLanguageKey =
  | 'chatGenerationStageStarting'
  | 'chatGenerationStagePreparingPrompt'
  | 'chatGenerationStageCheckingMemory'
  | 'chatGenerationStageWaitingForModel'
  | 'chatGenerationStageFinalizing'

const STAGE_LABEL_KEYS: Record<ChatGenerationLoadingStage, ChatGenerationLoadingLanguageKey> = {
  0: 'chatGenerationStageStarting',
  1: 'chatGenerationStagePreparingPrompt',
  2: 'chatGenerationStageCheckingMemory',
  3: 'chatGenerationStageWaitingForModel',
  4: 'chatGenerationStageFinalizing',
}

const STAGE_PROGRESS: Record<ChatGenerationLoadingStage, number> = {
  0: 12,
  1: 28,
  2: 48,
  3: 72,
  4: 92,
}

export function normalizeChatGenerationLoadingStage(stage: unknown): ChatGenerationLoadingStage {
  return stage === 1 || stage === 2 || stage === 3 || stage === 4 ? stage : 0
}

export function getChatGenerationLoadingLanguageKey(stage: unknown): ChatGenerationLoadingLanguageKey {
  return STAGE_LABEL_KEYS[normalizeChatGenerationLoadingStage(stage)]
}

export function getChatGenerationLoadingProgress(stage: unknown): number {
  return STAGE_PROGRESS[normalizeChatGenerationLoadingStage(stage)]
}
