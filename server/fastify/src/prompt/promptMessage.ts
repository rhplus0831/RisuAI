export interface PromptMultimodal {
  type: 'image' | 'video' | 'audio' | 'signature'
  base64: string
  height?: number
  width?: number
}

/** Prompt-row fields observed by Fastify prompt and token consumers. */
export interface PromptMessage {
  role: 'system' | 'user' | 'assistant' | 'function'
  content: string
  memo?: string
  name?: string
  removable?: boolean
  attr?: string[]
  multimodals?: PromptMultimodal[]
  thoughts?: string[]
  cachePoint?: boolean
}
