import type { ServerToolCall } from '../../../../src/ts/process/request/serverToolProtocol.js'

export interface CompletionStreamFrame {
  kind: 'token' | 'done' | 'error'
  content?: string
  finishReason?: 'stop' | 'length' | 'content_filter' | 'tool_calls' | string
  error?: string
  status?: number
  statusText?: string
  code?: string
  reason?: string
  alternates?: string[]
  toolCalls?: ServerToolCall[]
}

export interface CompletionResult {
  type: 'success' | 'fail'
  result: string
  model?: string
  status?: number
  statusText?: string
  code?: string
  aborted?: boolean
  alternates?: string[]
  toolCalls?: ServerToolCall[]
}
