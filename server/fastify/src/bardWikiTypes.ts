import type { ChatDispatchDatabase } from './prompt/chatDispatch.js'

/**
 * BardWiki consumes the database through Fastify's provider-dispatch boundary.
 * The dispatch domain remains responsible for removing its browser aggregate
 * dependency in the matching server-consumer slice.
 */
export type BardWikiGenerationDatabase = ChatDispatchDatabase

/** Narrow prompt row shape authored by BardWiki server code. */
export interface BardWikiChatRow {
  role: 'system' | 'user' | 'assistant' | 'function'
  content: string
  memo?: string
  removable?: boolean
}
