import type {
  Chat,
  Database,
  character,
} from '../../../../src/ts/storage/database.svelte'
import type { PromptItem } from '../../../../src/ts/process/prompt'
import type { OpenAIChat } from '../../../../src/ts/process/index.svelte'
import { EntityNotFoundError } from '../repository.js'
import {
  buildFormatOrder,
  normalizeTemplate,
  type FormatOrderKey,
  type UnformatedPromptSlots,
} from './templates.js'
import {
  buildAuthorNote,
  buildCotInstruction,
  buildDescription,
  buildPersona,
} from './staticSections.js'
import { buildPlainPromptSections } from './plainSections.js'
import {
  activateLorebook,
  buildLorebookContext,
  type LoreEntryActive,
  type LorebookActivationReport,
} from './lorebook.js'
import { preflightTemplateTokens } from './preflight.js'
import { applyDepthPrompts, buildHistoryWindow, NO_ASSETS } from './history.js'
import { buildMemoryWindow } from './memory.js'
import type { TriggerRunResult } from './triggers.js'
import { expandVariables, type ExpandContext } from './variables.js'
import type { PromptEvent } from './sseEvents.js'

/**
 * Phase 7 Tier 3 root assembly entry point.
 *
 * 7-11a — state/context loader + assembler contract:
 *   - resolve the persisted `Database` (and selected character / chat)
 *     through an explicit `AssembleDeps` seam, never a storage global,
 *   - build the empty `UnformatedPromptSlots` and the `ExpandContext`
 *     that every downstream slot builder reuses,
 *   - run the two pure template helpers (`normalizeTemplate`,
 *     `buildFormatOrder`),
 *   - return the `AssemblyState` that later 7-11 slices extend
 *     (`beginAssembly`).
 *
 * 7-11b — static/plain slot fill (`fillStaticSlots`): wire the landed
 * leaves into `state.unformated`, mirroring `index.svelte.ts:192-204` —
 * plain sections (`main` / `jailbreak` / `globalNote`) on the
 * non-utility, non-template path, then `authorNote`, the
 * chain-of-thought into `postEverything`, `description`, and
 * `personaPrompt`.
 *
 * 7-11c — lorebook placement + token preflight (`fillLorebookSlots`):
 * `activateLorebook`, distribute the activated entries via
 * `buildLorebookContext` (`lorebook` / `description` / `postEverything`),
 * build the `positionParser` + `depthPrompts`, and run
 * `preflightTemplateTokens`, recording `report` / `positionParser` /
 * `depthPrompts` / `currentTokens` / `memoryCardUsed` / `hasCachePoint`
 * on the state.
 *
 * 7-11d — history window + bias rows (`fillHistoryAndBias`): run the
 * async `buildHistoryWindow` with the 7-11c `report`, thread the
 * start-trigger mutations (`currentChat` / `triggerResult` /
 * `varChanged`), honor `stopSending`, fold `addedTokens` into
 * `currentTokens`, capture `historyMessages`, and collect the
 * unescaped + variable-expanded `biases`. Mirrors
 * `index.svelte.ts:227-273`. The history rows are only captured here —
 * the 7-11e memory window is what fills `unformated.chats`.
 *
 * 7-11e — memory bridge + post-history slot mutations
 * (`fillMemoryAndPostHistory`): run the non-Hypa `buildMemoryWindow`
 * (`memory.ts`) over `historyMessages` to fill `unformated.chats` (+
 * `lastChat` promotion) and `state.memories`, honor `stopSending`, then
 * splice the lorebook depth prompts (`applyDepthPrompts`) and place the
 * start trigger's `additonalSysPrompt` rows. Mirrors
 * `index.svelte.ts:243-304`. Hypa V3 summary creation stays Phase 8.
 *
 * Deferred to later 7-11 slices: the `renderFinalPrompt` call + final
 * budget pruning + prompt payload (7-11f), and the route wiring /
 * preview shortcut / SSE telemetry (7-11g/h/i).
 * `buildInlayViewInstruction` (image-gen) and inlay asset lookup
 * (`NO_ASSETS`) stay deferred. `assemblePrompt` therefore still throws
 * past scope resolution.
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
  // --- 7-11c: lorebook placement + token preflight (set by `fillLorebookSlots`) ---
  /** The lorebook activation report (entries that fired + why). */
  report?: LorebookActivationReport
  /** `{{position::}}` resolver shared by the template / render walkers. */
  positionParser?: (text: string, loc: string) => string
  /** Depth-positioned lore the history splicer consumes (7-11e). */
  depthPrompts?: LoreEntryActive[]
  /** Running token estimate: `maxResponse + 50 + preflight.addedTokens`. */
  currentTokens?: number
  /** From `preflightTemplateTokens`: the template contains a `memory` card. */
  memoryCardUsed?: boolean
  /** From `preflightTemplateTokens`: the template contains a `cache` card. */
  hasCachePoint?: boolean
  // --- 7-11d: history window + bias rows (set by `fillHistoryAndBias`) ---
  /**
   * The flattened history rows from `buildHistoryWindow`. Captured here
   * only; the 7-11e memory window is what pushes them into
   * `unformated.chats` (SPA `index.svelte.ts:243-263`).
   */
  historyMessages?: OpenAIChat[]
  /**
   * The start-trigger result threaded out of the history walk. 7-11e
   * merges `triggerResult.additonalSysPrompt` into the slots
   * (`index.svelte.ts:285-304`); `null` when no triggers ran.
   */
  triggerResult?: TriggerRunResult | null
  /**
   * The start trigger asked to abort the send. The assemble root aborts
   * later (7-11f); mirrors the SPA's `history.stopSending` early return
   * (`index.svelte.ts:236-238`).
   */
  stopSending?: boolean
  /**
   * A start-trigger `setvar` mutated chat state; the route persists the
   * database when true (7-11g).
   */
  varChanged?: boolean
  /** Bias rows: `db.bias ∪ char.bias`, unescaped + variable-expanded. */
  biases?: [string, number][]
  // --- 7-11e: memory bridge (set by `fillMemoryAndPostHistory`) ---
  /**
   * Memory-card rows split out of the history by the memory window. Fed
   * to `renderFinalPrompt` (7-11f). Empty until Phase 8 wires Hypa V3,
   * since no current server history row carries a memory memo.
   */
  memories?: OpenAIChat[]
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

/**
 * 7-11b — fill the static/plain slots on the `AssemblyState`, mutating
 * `state.unformated` in place. Mirrors `index.svelte.ts:192-204`:
 *   - plain sections (`main` / `jailbreak` / `globalNote`) only on the
 *     non-utility, non-template path,
 *   - `authorNote`, the chain-of-thought into `postEverything`,
 *     `description`, and `personaPrompt` always.
 *
 * Sync — every leaf is sync. `buildInlayViewInstruction` (`:204`) stays
 * deferred (image-gen / `newGenData`).
 */
export function fillStaticSlots(state: AssemblyState): void {
  const { ctx, currentChar, currentChat, unformated, promptTemplate, usingPromptTemplate } = state

  if (!currentChar.utilityBot && !promptTemplate) {
    const sections = buildPlainPromptSections(ctx, currentChar)
    unformated.main.push(...sections.main)
    unformated.jailbreak.push(...sections.jailbreak)
    unformated.globalNote.push(...sections.globalNote)
  }

  unformated.authorNote.push(...buildAuthorNote(ctx, currentChat))
  unformated.postEverything.push(...buildCotInstruction(ctx, usingPromptTemplate))
  unformated.description.push(...buildDescription(ctx, currentChar))
  unformated.personaPrompt.push(...buildPersona(ctx))
}

/**
 * 7-11c — activate the lorebook, distribute the activated entries into
 * the slots, build the `positionParser` + `depthPrompts`, and run the
 * template-wide token preflight. Mirrors `index.svelte.ts:206-225`.
 *
 * Runs after `fillStaticSlots` so the `before_desc` / `after_desc`
 * placement sees the static description row and the preflight tokenizes
 * the now-full slots. Sets the 7-11c fields on `state`.
 */
export function fillLorebookSlots(state: AssemblyState): void {
  const { ctx, currentChar, currentChat, unformated, promptTemplate, usingPromptTemplate } = state
  const db = state.database

  const report = activateLorebook({
    database: db,
    currentChar,
    currentChat,
    model: db.aiModel,
  })

  const { positionParser, depthPrompts } = buildLorebookContext(
    ctx,
    currentChar,
    report,
    unformated,
  )

  // SPA `:210-213`: seed with the max response budget plus a small
  // headroom for unexpected error overhead.
  let currentTokens = (db.maxResponse ?? 0) + 50
  const preflight = preflightTemplateTokens({
    ctx,
    currentChar,
    unformated,
    promptTemplate,
    usingPromptTemplate,
    report,
  })
  currentTokens += preflight.addedTokens

  state.report = report
  state.positionParser = positionParser
  state.depthPrompts = depthPrompts
  state.currentTokens = currentTokens
  state.memoryCardUsed = preflight.memoryCardUsed
  state.hasCachePoint = preflight.hasCachePoint
}

/**
 * 7-11d — run the async history window and collect the bias rows,
 * mutating `state` in place. Mirrors `index.svelte.ts:227-241` (history)
 * and `:265-273` (bias). Runs after `fillLorebookSlots` so `state.report`
 * feeds the depth-prompt token preflight inside `buildHistoryWindow`.
 *
 * The start trigger inside `buildHistoryWindow` may mutate the chat, so
 * its results (`currentChat` / `triggerResult` / `varChanged`) are
 * threaded back regardless of outcome — the route persists when
 * `varChanged` is true. On `stopSending` the function short-circuits
 * (matching the SPA's `return false` at `:236-238`): the history rows are
 * incomplete, so they are not captured and the bias rows are skipped.
 *
 * Boundary: the history rows are only *captured* on `state.historyMessages`
 * here. The 7-11e memory window is what pushes them into
 * `unformated.chats` (`buildMemoryWindow`, `index.svelte.ts:243-263`).
 * Inlay/multimodal asset lookup stays browser-side for now (`NO_ASSETS`).
 */
export async function fillHistoryAndBias(state: AssemblyState): Promise<void> {
  const { ctx, currentChar, usingPromptTemplate } = state
  const db = state.database

  const history = await buildHistoryWindow(
    ctx,
    currentChar,
    state.currentChat,
    usingPromptTemplate,
    NO_ASSETS,
    state.report,
  )

  // The start trigger may have mutated the chat and chat-vars even when
  // it asks to abort, so thread these out before the `stopSending` gate.
  state.currentChat = history.currentChat
  state.triggerResult = history.triggerResult
  state.varChanged = history.varChanged

  if (history.stopSending === true) {
    state.stopSending = true
    return
  }
  state.stopSending = false

  state.currentTokens = (state.currentTokens ?? 0) + history.addedTokens
  state.historyMessages = history.messages

  // Bias rows (SPA `index.svelte.ts:265-273`): merge the global + per-
  // character bias lists, unescape `\n` / `\r` / `\\`, then variable-
  // expand each key against the current character while keeping its
  // numeric weight.
  const biasSource = (db.bias ?? []).concat(currentChar.bias ?? [])
  state.biases = biasSource.map(([key, weight]): [string, number] => [
    expandVariables(
      key.replaceAll('\\n', '\n').replaceAll('\\r', '\r').replaceAll('\\\\', '\\'),
      { ...ctx, chara: currentChar },
    ).text,
    weight,
  ])
}

/**
 * 7-11e — bridge the captured history into `unformated.chats` through the
 * non-Hypa memory window, then apply the post-history slot mutations.
 * Mirrors `index.svelte.ts:243-304`:
 *   - `buildMemoryWindow` (memory.ts) trims the oldest rows under
 *     `db.maxContext`, promotes the trailing chat to `lastChat` (no
 *     template), splits memory cards into `state.memories`, and marks the
 *     rest `removable`; `stopSending` short-circuits the rest;
 *   - `applyDepthPrompts` (history.ts, 7-7e) splices the lorebook depth
 *     prompts into `unformated.chats` (`:275-283`);
 *   - the start trigger's `additonalSysPrompt` is placed into
 *     `postEverything` / `lastChat` (`:285-304`).
 *
 * Sync — the non-Hypa window and every post-history mutation are sync.
 * Phase 8 makes this async when Hypa V3 summary creation lands. Runs
 * after `fillHistoryAndBias`, so a prior `stopSending` short-circuits.
 */
export function fillMemoryAndPostHistory(state: AssemblyState): void {
  if (state.stopSending) return

  const { ctx, currentChar, unformated } = state
  const db = state.database

  const mem = buildMemoryWindow({
    chats: state.historyMessages ?? [],
    currentTokens: state.currentTokens ?? 0,
    maxContextTokens: db.maxContext ?? 0,
    currentChat: state.currentChat,
    memoryCardUsed: !!state.memoryCardUsed,
    promptTemplate: state.promptTemplate,
    unformated,
    db,
  })

  if (mem.stopSending === true) {
    state.stopSending = true
    return
  }

  state.currentChat = mem.currentChat
  state.memories = mem.memories
  // The SPA root does not read `currentTokens` back (7-11f re-tokenizes
  // the rendered prompt), but the post-trim estimate is the honest value
  // for the 7-11i `info` telemetry, so keep it on the state.
  state.currentTokens = mem.currentTokens

  // Lorebook depth-prompt splice (SPA `:275-283`). `applyDepthPrompts`
  // already resolves `{{position::}}` + expands + applies the
  // depth/reverse_depth index math (excluding `depth === 0`, which the
  // template/postEverything path owns).
  if (state.report) {
    applyDepthPrompts(unformated.chats, ctx, currentChar, state.report)
  }

  // Start-trigger `additonalSysPrompt` placement (SPA `:285-304`).
  const triggerResult = state.triggerResult
  if (triggerResult) {
    const sys = triggerResult.additonalSysPrompt
    if (sys.promptend) {
      unformated.postEverything.push({ role: 'system', content: sys.promptend })
    }
    if (sys.historyend) {
      unformated.lastChat.push({ role: 'system', content: sys.historyend })
    }
    if (sys.start) {
      unformated.lastChat.unshift({ role: 'system', content: sys.start })
    }
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
