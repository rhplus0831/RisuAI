import type { ProviderGenerationSettings } from './prompt/serverTypes.js'

/** BardWiki provider work consumes selected provider settings and optional display names. */
export type BardWikiGenerationDatabase = ProviderGenerationSettings

/** Narrow prompt row shape authored by BardWiki server code. */
export interface BardWikiChatRow {
  role: 'system' | 'user' | 'assistant' | 'function'
  content: string
  memo?: string
  removable?: boolean
}
