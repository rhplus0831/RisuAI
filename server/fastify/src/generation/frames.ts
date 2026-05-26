export interface CompletionStreamFrame {
  kind: 'token' | 'done' | 'error'
  content?: string
  finishReason?: 'stop' | 'length' | 'content_filter' | 'tool_calls' | string
  error?: string
  status?: number
  code?: string
}

export interface CompletionResult {
  type: 'success' | 'fail'
  result: string
  model?: string
  aborted?: boolean
}
