export interface CompletionStreamFrame {
  kind: 'token' | 'done' | 'error'
  content?: string
  finishReason?: 'stop' | 'length' | 'content_filter' | 'tool_calls' | string
  error?: string
  status?: number
  statusText?: string
  code?: string
}

export interface CompletionResult {
  type: 'success' | 'fail'
  result: string
  model?: string
  status?: number
  statusText?: string
  code?: string
  aborted?: boolean
}
