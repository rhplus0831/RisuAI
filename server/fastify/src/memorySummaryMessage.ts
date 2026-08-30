export interface MemorySummaryMultimodal {
  type: 'image' | 'video' | 'audio' | 'signature'
  base64: string
  height?: number
  width?: number
}

/** Prompt-row fields observed by Fastify's memory-summary planning pipeline. */
export interface MemorySummaryMessage {
  role: 'system' | 'user' | 'assistant' | 'function'
  content: string
  memo?: string
  name?: string
  removable?: boolean
  attr?: string[]
  multimodals?: MemorySummaryMultimodal[]
  thoughts?: string[]
  cachePoint?: boolean
}
