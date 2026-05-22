export interface CompletionStreamFrame {
  kind: 'token' | 'done'
  content?: string
  finishReason?: 'stop' | 'length' | 'content_filter' | 'tool_calls' | string
}

export interface CompletionResult {
  type: 'success' | 'fail'
  result: string
  model?: string
  aborted?: boolean
}
