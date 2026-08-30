/**
 * Fastify-owned structural views of the legacy application model.
 *
 * These are request and prompt input records, not an application database or
 * persistence authority. Server consumers keep accepting forward-compatible
 * fields, while collection members stay typed so the boundary cannot collapse
 * into an untracked `any` graph.
 */

/**
 * The aggregate settings document is an open compatibility payload. Individual
 * Fastify domains own narrower views; this alias exists only while those
 * settings domains are extracted from the legacy aggregate.
 */
export type FastifyDatabase = any

export interface FastifyChat {
  [key: string]: any
  message: FastifyMessage[]
  note: string
  name: string
  localLore: FastifyLoreBook[]
  id?: string
  generationSettings?: any
}

export interface FastifyMessage {
  [key: string]: any
  role: 'user' | 'char'
  data: string
  chatId?: string
  time?: number
}

export interface FastifyCharacter {
  [key: string]: any
  type?: 'character'
  name: string
  firstMessage: string
  desc: string
  notes: string
  chats: FastifyChat[]
  chatFolders: Array<{ id: string; name?: string; color?: string; folded: boolean }>
  chatPage: number
  viewScreen: 'emotion' | 'none' | 'imggen'
  bias: Array<[string, number]>
  emotionImages: Array<[string, string]>
  globalLore: FastifyLoreBook[]
  chaId: string
  sdData: Array<[string, string]>
  customscript: FastifyCustomScript[]
  utilityBot: boolean
  exampleMessage: string
  creatorNotes: string
  systemPrompt: string
  postHistoryInstructions: string
  alternateGreetings: string[]
  tags: string[]
  creator: string
  characterVersion: string
  personality: string
  scenario: string
  firstMsgIndex: number
  replaceGlobalNote: string
  additionalText: string
  defaultVariables?: string
  triggerscript: import('./triggerDescriptors.js').ServerTriggerScript[]
}

export interface FastifyLoreBook {
  [key: string]: any
  key: string
  secondkey: string
  insertorder: number
  comment: string
  content: string
  mode: 'multiple' | 'constant' | 'normal' | 'child' | 'folder'
  alwaysActive: boolean
  selective: boolean
  agentOnly?: boolean
  extentions?: {
    risu_case_sensitive: boolean
    risu_agent_only?: boolean
  }
}

export interface FastifyCustomScript {
  [key: string]: any
  comment: string
  in: string
  out: string
  type: string
}

export interface FastifyMessagePresetInfo {
  [key: string]: any
}
