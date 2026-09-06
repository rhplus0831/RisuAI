import type { ServerToolCall } from '@risuai/protocol/server-tool'

export interface CompletionStreamFrame {
  kind: 'token' | 'done' | 'error'
  content?: string
  finishReason?: 'stop' | 'length' | 'content_filter' | 'tool_calls' | string
  error?: string
  status?: number
  statusText?: string
  code?: string
  reason?: string
  /** Provider-declared terminal failure; retry/fallback policy must stop. */
  nonRetryable?: boolean
  alternates?: string[]
  toolCalls?: ServerToolCall[]
  apiMetadata?: Record<string, unknown>
}

export interface CompletionResult {
  type: 'success' | 'fail'
  result: string
  model?: string
  status?: number
  statusText?: string
  code?: string
  aborted?: boolean
  /** Provider-declared terminal failure; retry/fallback policy must stop. */
  nonRetryable?: boolean
  alternates?: string[]
  toolCalls?: ServerToolCall[]
  apiMetadata?: Record<string, unknown>
}
