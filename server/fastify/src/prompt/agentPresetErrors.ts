import type { AgentPresetStepPhase } from '@risuai/shared-core/agent-preset-records'

export type AgentPresetStepFailureKind =
  | 'dependency_skipped'
  | 'model_not_ready'
  | 'timeout'
  | 'provider_error'
  | 'invalid_json_output'
  | 'empty_output'

export type AgentPresetStepFailurePolicyOutcome =
  | 'optional_failure'
  | 'required_failure'
  | 'fallback_text'
  | 'stop_generation'

export interface AgentPresetGenerationErrorBody {
  error: 'agent_preset_generation_failed'
  message: string
  statusCode: number
  phase?: AgentPresetStepPhase
  presetId?: string
  presetName?: string
  stepId?: string
  stepName?: string
  outputKey?: string
  failureKind?: AgentPresetStepFailureKind | 'final_output_cbs'
  failurePolicyOutcome?: AgentPresetStepFailurePolicyOutcome
  diagnostics?: unknown
}

export class AgentPresetGenerationError extends Error {
  readonly statusCode: number
  readonly body: AgentPresetGenerationErrorBody

  constructor(message: string, body: Omit<AgentPresetGenerationErrorBody, 'error' | 'message' | 'statusCode'> = {}) {
    const statusCode = 422
    super(message)
    this.name = 'AgentPresetGenerationError'
    this.statusCode = statusCode
    this.body = {
      error: 'agent_preset_generation_failed',
      message,
      statusCode,
      ...body,
    }
  }
}

export function isAgentPresetGenerationError(error: unknown): error is AgentPresetGenerationError {
  return error instanceof AgentPresetGenerationError
}
