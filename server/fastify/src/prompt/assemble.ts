import type {
  Chat,
  Database,
  character,
} from '../../../../src/ts/storage/database.svelte'
import type { PromptItem } from '../../../../src/ts/process/prompt'
import { EntityNotFoundError } from '../repository.js'
import {
  buildFormatOrder,
  normalizeTemplate,
  type FormatOrderKey,
  type UnformatedPromptSlots,
} from './templates.js'
import type { ExpandContext } from './variables.js'
import type { PromptEvent } from './sseEvents.js'

/**
 * Phase 7 Tier 3 root assembly entry point.
 *
 * 7-11a — state/context loader + assembler contract. This first Tier 3
 * slice is scoped strictly to loading and context shape:
 *   - resolve the persisted `Database` (and selected character / chat)
 *     through an explicit `AssembleDeps` seam, never a storage global,
 *   - build the empty `UnformatedPromptSlots` and the `ExpandContext`
 *     that every downstream slot builder reuses,
 *   - run the two pure template helpers (`normalizeTemplate`,
 *     `buildFormatOrder`),
 *   - return the `AssemblyState` that later 7-11 slices extend.
 *
 * Deferred to later 7-11 slices: static/plain slots (7-11b), lorebook +
 * preflight (7-11c), history + bias (7-11d), the memory-window bridge +
 * depth/additional-system-prompt placement (7-11e), the
 * `renderFinalPrompt` call + final budget pruning + prompt payload
 * (7-11f), and the route wiring / preview shortcut / SSE telemetry
 * (7-11g/h/i). `assemblePrompt` therefore still throws past scope
 * resolution.
 */

/**
 * The explicit dependency surface the assembler loads state through.
 * The route binds `loadDatabase` to `loadPersisted(dataDir).database`
 * (7-11g); tests inject a fixture. Keeping it a seam means the route
 * never imports storage globals into the assembler.
 */
export interface AssembleDeps {
  loadDatabase(): Database | null
}

export interface AssembleInput {
  chatId: string
  characterId: string
  presetId?: string
  loadoutId?: string
  mode: 'send' | 'continue' | 'preview' | 'preview_prompt' | 'regenerate'
  regenerateMessageId?: string
  userMessage?: string
  resetMessages?: boolean
  expectedRevision?: number
  inlayAssets?: unknown[]
}

export type AssembleResult = Omit<PromptEvent, 'type'>

/**
 * The internal assembler state threaded through the 7-11 slices. 7-11a
 * fills the scope (database / character / chat / indices), the
 * `ExpandContext`, the empty slots, and the normalized template +
 * format order; later slices fill `unformated` and add render output.
 */
export interface AssemblyState {
  database: Database
  currentChar: character
  currentChat: Chat
  /** Index into `database.characters`. */
  selectedCharID: number
  /** Index into `currentChar.chats`. */
  chatPage: number
  /** Reused by every downstream slot builder (`buildDescription`, …). */
  ctx: ExpandContext
  unformated: UnformatedPromptSlots
  promptTemplate: PromptItem[] | null
  usingPromptTemplate: boolean
  formatOrder: FormatOrderKey[]
  /** Recorded identity only; applying a non-active preset/loadout is deferred. */
  presetId?: string
  loadoutId?: string
}

/** The 10 canonical slot arrays, all empty. Shared by the assembler and tests. */
export function createEmptyUnformatedSlots(): UnformatedPromptSlots {
  return {
    main: [],
    jailbreak: [],
    chats: [],
    lorebook: [],
    globalNote: [],
    authorNote: [],
    lastChat: [],
    description: [],
    postEverything: [],
    personaPrompt: [],
  }
}

interface ResolvedScope {
  database: Database
  currentChar: character
  currentChat: Chat
  selectedCharID: number
  chatPage: number
}

/**
 * Resolve the persisted database and the selected character / chat from
 * the request IDs. A missing database, or an explicit `characterId` /
 * `chatId` that matches nothing, is a hard `EntityNotFoundError`; the
 * active pointers (`database.currentChar`, `character.chatPage`) resolve
 * normally when an ID points at the active entity.
 */
function resolveScope(input: AssembleInput, deps: AssembleDeps): ResolvedScope {
  const database = deps.loadDatabase()
  if (!database) {
    throw new EntityNotFoundError('database not found')
  }

  const selectedCharID = database.characters.findIndex(
    (c) => c.chaId === input.characterId,
  )
  if (selectedCharID === -1) {
    throw new EntityNotFoundError(`character not found: ${input.characterId}`)
  }
  const currentChar = database.characters[selectedCharID]

  const chatPage = currentChar.chats.findIndex((ch) => ch.id === input.chatId)
  if (chatPage === -1) {
    throw new EntityNotFoundError(`chat not found: ${input.chatId}`)
  }
  const currentChat = currentChar.chats[chatPage]

  return { database, currentChar, currentChat, selectedCharID, chatPage }
}

/**
 * Build the 7-11a `AssemblyState`: resolve scope, construct the shared
 * `ExpandContext` + empty slots, and run the pure template helpers. Sync
 * — none of the 7-11a steps await.
 */
export function beginAssembly(input: AssembleInput, deps: AssembleDeps): AssemblyState {
  const { database, currentChar, currentChat, selectedCharID, chatPage } = resolveScope(
    input,
    deps,
  )

  const ctx: ExpandContext = { database, selectedCharID, chatPage }
  const unformated = createEmptyUnformatedSlots()

  const { promptTemplate, usingPromptTemplate } = normalizeTemplate(database, currentChar)
  const formatOrder = buildFormatOrder(database)

  return {
    database,
    currentChar,
    currentChat,
    selectedCharID,
    chatPage,
    ctx,
    unformated,
    promptTemplate,
    usingPromptTemplate,
    formatOrder,
    presetId: input.presetId,
    loadoutId: input.loadoutId,
  }
}

export async function assemblePrompt(
  input: AssembleInput,
  deps: AssembleDeps,
): Promise<AssembleResult> {
  // 7-11a resolves scope + builds the empty slots/state (surfacing
  // bad-ID errors early). 7-11b–f fill the slots and render; 7-11g wires
  // the route. The tail is not implemented yet.
  beginAssembly(input, deps)
  throw new Error('phase 7-11 prompt assembly not yet implemented beyond 7-11a scope resolution')
}
