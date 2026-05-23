import { randomUUID } from 'node:crypto'
import type { Chat, Database, Message, character } from '../../../../src/ts/storage/database.svelte'
import type { PromptItem } from '../../../../src/ts/process/prompt'
import type { OpenAIChat } from '../../../../src/ts/process/index.svelte'
import { EntityNotFoundError } from '../repository.js'
import {
  buildFormatOrder,
  normalizeTemplate,
  renderFinalPrompt,
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
import { finalizeRequestBudget } from './budgetFinalize.js'
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
 * 7-11f — final render + budgeted prompt payload (`renderAndBudget` +
 * `assemblePrompt`): `renderFinalPrompt` flattens the slots, then
 * `finalizeRequestBudget` trims `removable` rows under `db.maxContext`
 * and clamps the response budget. `assemblePrompt` chains 7-11a–f and
 * returns the `AssembleResult` (the `prompt` SSE payload + the dispatch
 * metadata), or `{ stopSending: true }` on a trigger/overflow abort.
 * Mirrors `index.svelte.ts:306-345`.
 *
 * Deferred to later 7-11 slices: the route wiring + SSE emission
 * (7-11g), the preview shortcut (7-11h), and the `info` / `message_patch`
 * telemetry (7-11i). Provider dispatch (`dispatchRequest`) is Phase
 * 7-12 / 6 territory; `buildInlayViewInstruction` (image-gen) and inlay
 * asset lookup (`NO_ASSETS`) stay deferred.
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

export type AssembleMutationSource =
  | 'user_message'
  | 'run_var'
  | 'history_normalize'
  | 'start_trigger'

export type ChatVarMutationValue = string | number | boolean | null

export interface AssembleChatVarMutation {
  key: string
  before: ChatVarMutationValue
  after: ChatVarMutationValue
}

export type AssembleMessageMutation =
  | {
      type: 'append'
      source: 'user_message'
      index: number
      message: Message
    }
  | {
      type: 'replace_all'
      source: Exclude<AssembleMutationSource, 'user_message'>
      beforeLength: number
      afterLength: number
      messages: Message[]
    }

export interface AssembleAdditionalSystemPromptMutation {
  type: 'insert_prompt_row'
  source: 'additional_sys_prompt'
  origin: 'start' | 'historyend' | 'promptend'
  slot: 'lastChat' | 'postEverything'
  placement: 'push' | 'unshift'
  row: OpenAIChat
}

export interface AssembleMutationPayload {
  chatId: string
  characterId: string
  selectedCharID: number
  chatPage: number
  varChanged: boolean
  messageMutations: AssembleMessageMutation[]
  chatVarMutations: AssembleChatVarMutation[]
  additionalSystemPrompt: AssembleAdditionalSystemPromptMutation[]
}

/**
 * The full assembler output (7-11f). `prompt` is the `prompt` SSE event
 * payload the route emits (7-11g); the remaining fields carry the data
 * dispatch (Phase 7-12 / 6) needs but the `prompt` event does not. On an
 * abort (`stopSending`) the mutation contract still rides along so the
 * route can persist chat-var writes made before the abort.
 */
export interface AssembleResult {
  /** A start trigger or the budget overflow aborted the send. */
  stopSending: boolean
  /** Why the send aborted, when `stopSending` is true. */
  abortReason?: 'stopSending' | 'overflow'
  /** The `prompt` SSE event payload (messages + promptInfo + lore report). */
  prompt?: Omit<PromptEvent, 'type'>
  /** The budgeted flat prompt (full `OpenAIChat` rows) for dispatch. */
  formated?: OpenAIChat[]
  /** Logit-bias rows for dispatch (7-12). */
  biases?: [string, number][]
  /** Final input token count from `finalizeRequestBudget`. */
  inputTokens?: number
  /** Clamped response budget from `finalizeRequestBudget`. */
  outputTokens?: number
  /** Server-owned chat and variable mutations produced during assembly. */
  mutations?: AssembleMutationPayload
}

/**
 * The internal assembler state threaded through the 7-11 slices. 7-11a
 * fills the scope (database / character / chat / indices), the
 * `ExpandContext`, the empty slots, and the normalized template +
 * format order; later slices fill `unformated` and add render output.
 */
export interface AssemblyState {
  input: AssembleInput
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
  /** `input.mode === 'continue'`; drives the `[Continue the last response]` marker. */
  isContinue: boolean
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
   * A run-var expansion or start-trigger `setvar` mutated chat state; the
   * route persists the database when true (7-12d-i).
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
  // --- 7-11f: final render + budget (set by `renderAndBudget`) ---
  /** The budgeted flat prompt for dispatch. */
  formated?: OpenAIChat[]
  /** Template-path prompt-info rows (`renderFinalPrompt.promptText`). */
  promptText?: OpenAIChat[]
  /** Final input token count from `finalizeRequestBudget`. */
  inputTokens?: number
  /** Clamped response budget from `finalizeRequestBudget`. */
  outputTokens?: number
  /** Set to `'overflow'` when the budget recheck cannot fit the pinned rows. */
  abortReason?: 'stopSending' | 'overflow'
  // --- 7-12d-i: typed mutation handoff (set while assembling) ---
  messageMutationCheckpoint?: Message[]
  initialScriptstate?: Record<string, string | number | boolean>
  messageMutations?: AssembleMessageMutation[]
  additionalSystemPromptMutations?: AssembleAdditionalSystemPromptMutation[]
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

  const selectedCharID = database.characters.findIndex((c) => c.chaId === input.characterId)
  if (selectedCharID === -1) {
    throw new EntityNotFoundError(`character not found: ${input.characterId}`)
  }
  const currentChar = database.characters[selectedCharID]

  const chatPage = currentChar.chats.findIndex((ch) => ch.id === input.chatId)
  if (chatPage === -1) {
    throw new EntityNotFoundError(`chat not found: ${input.chatId}`)
  }
  const currentChat = structuredClone(currentChar.chats[chatPage])

  return { database, currentChar, currentChat, selectedCharID, chatPage }
}

/**
 * Build the 7-11a `AssemblyState`: resolve scope, construct the shared
 * `ExpandContext` + empty slots, and run the pure template helpers. Sync
 * — none of the 7-11a steps await.
 */
export function beginAssembly(input: AssembleInput, deps: AssembleDeps): AssemblyState {
  const { database, currentChar, currentChat, selectedCharID, chatPage } = resolveScope(input, deps)

  const ctx: ExpandContext = { database, selectedCharID, chatPage }
  const unformated = createEmptyUnformatedSlots()

  const { promptTemplate, usingPromptTemplate } = normalizeTemplate(database, currentChar)
  const formatOrder = buildFormatOrder(database)

  return {
    input,
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
    isContinue: input.mode === 'continue',
    presetId: input.presetId,
    loadoutId: input.loadoutId,
    messageMutationCheckpoint: cloneMessages(currentChat.message ?? []),
    initialScriptstate: cloneScriptstate(currentChat.scriptstate),
    messageMutations: [],
    additionalSystemPromptMutations: [],
  }
}

function cloneMessages(messages: Message[] | undefined): Message[] {
  return structuredClone(messages ?? [])
}

function cloneScriptstate(
  scriptstate: Chat['scriptstate'] | undefined,
): Record<string, string | number | boolean> {
  return structuredClone(scriptstate ?? {}) as Record<string, string | number | boolean>
}

function equalJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function valueOrNull(value: string | number | boolean | undefined): ChatVarMutationValue {
  return value === undefined ? null : value
}

function currentPersistedChat(state: AssemblyState): Chat | undefined {
  return state.database.characters?.[state.selectedCharID]?.chats?.[state.chatPage]
}

function syncWorkingScriptstate(state: AssemblyState): void {
  const persisted = currentPersistedChat(state)
  if (persisted) {
    state.currentChat.scriptstate = persisted.scriptstate
  }
}

function captureMessageReplacement(
  state: AssemblyState,
  source: Exclude<AssembleMutationSource, 'user_message'>,
): void {
  const before = state.messageMutationCheckpoint ?? []
  const after = cloneMessages(state.currentChat.message ?? [])
  if (equalJson(before, after)) return

  state.messageMutations?.push({
    type: 'replace_all',
    source,
    beforeLength: before.length,
    afterLength: after.length,
    messages: after,
  })
  state.messageMutationCheckpoint = cloneMessages(after)
}

function appendUserMessageRow(state: AssemblyState): void {
  const userMessage = state.input.userMessage
  if (state.input.mode !== 'send' || typeof userMessage !== 'string') return

  const message = {
    role: 'user',
    data: userMessage,
    time: Date.now(),
    chatId: randomUUID(),
    name: null,
  } as Message
  const messages = (state.currentChat.message ??= [])
  const index = messages.length
  messages.push(message)
  state.messageMutations?.push({
    type: 'append',
    source: 'user_message',
    index,
    message: structuredClone(message),
  })
  state.messageMutationCheckpoint = cloneMessages(messages)
}

function applyCurrentChatRunVars(state: AssemblyState): void {
  let dirty = false
  const messages = (state.currentChat.message ??= [])
  for (const message of messages) {
    const result = expandVariables(message.data ?? '', {
      ...state.ctx,
      chara: state.currentChar,
      runVar: true,
    })
    message.data = result.text
    dirty ||= result.dirty
  }
  if (dirty) {
    state.varChanged = true
    syncWorkingScriptstate(state)
  }
  captureMessageReplacement(state, 'run_var')
}

function buildChatVarMutations(state: AssemblyState): AssembleChatVarMutation[] {
  const before = state.initialScriptstate ?? {}
  const after = cloneScriptstate(currentPersistedChat(state)?.scriptstate)
  const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)])).sort()
  return keys
    .filter((key) => before[key] !== after[key])
    .map((key) => ({
      key,
      before: valueOrNull(before[key]),
      after: valueOrNull(after[key]),
    }))
}

function buildMutationPayload(state: AssemblyState): AssembleMutationPayload {
  return {
    chatId: state.input.chatId,
    characterId: state.input.characterId,
    selectedCharID: state.selectedCharID,
    chatPage: state.chatPage,
    varChanged: !!state.varChanged,
    messageMutations: state.messageMutations ?? [],
    chatVarMutations: buildChatVarMutations(state),
    additionalSystemPrompt: state.additionalSystemPromptMutations ?? [],
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
  state.varChanged = !!state.varChanged || history.varChanged
  syncWorkingScriptstate(state)

  if (history.stopSending === true) {
    state.stopSending = true
    captureMessageReplacement(state, 'start_trigger')
    return
  }
  state.stopSending = false

  state.currentTokens = (state.currentTokens ?? 0) + history.addedTokens
  state.historyMessages = history.messages
  captureMessageReplacement(state, history.triggerResult ? 'start_trigger' : 'history_normalize')

  // Bias rows (SPA `index.svelte.ts:265-273`): merge the global + per-
  // character bias lists, unescape `\n` / `\r` / `\\`, then variable-
  // expand each key against the current character while keeping its
  // numeric weight.
  const biasSource = (db.bias ?? []).concat(currentChar.bias ?? [])
  state.biases = biasSource.map(([key, weight]): [string, number] => [
    expandVariables(key.replaceAll('\\n', '\n').replaceAll('\\r', '\r').replaceAll('\\\\', '\\'), {
      ...ctx,
      chara: currentChar,
    }).text,
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
      const row: OpenAIChat = { role: 'system', content: sys.promptend }
      unformated.postEverything.push(row)
      state.additionalSystemPromptMutations?.push({
        type: 'insert_prompt_row',
        source: 'additional_sys_prompt',
        origin: 'promptend',
        slot: 'postEverything',
        placement: 'push',
        row: structuredClone(row),
      })
    }
    if (sys.historyend) {
      const row: OpenAIChat = { role: 'system', content: sys.historyend }
      unformated.lastChat.push(row)
      state.additionalSystemPromptMutations?.push({
        type: 'insert_prompt_row',
        source: 'additional_sys_prompt',
        origin: 'historyend',
        slot: 'lastChat',
        placement: 'push',
        row: structuredClone(row),
      })
    }
    if (sys.start) {
      const row: OpenAIChat = { role: 'system', content: sys.start }
      unformated.lastChat.unshift(row)
      state.additionalSystemPromptMutations?.push({
        type: 'insert_prompt_row',
        source: 'additional_sys_prompt',
        origin: 'start',
        slot: 'lastChat',
        placement: 'unshift',
        row: structuredClone(row),
      })
    }
  }
}

/**
 * 7-11f — render the now-complete slots into the flat prompt and run the
 * budget recheck, mutating `state` in place. Mirrors
 * `index.svelte.ts:306-345`:
 *   - `renderFinalPrompt` over `state.formatOrder` (which already has
 *     `postEverything` appended by `buildFormatOrder`, so it is **not**
 *     re-pushed here), `state.memories`, and `state.positionParser`,
 *     with the `isContinue` marker; `editRequest` keeps its identity
 *     default (the 7-9e request-state transform / browser Lua stay a
 *     dispatch-time concern);
 *   - `finalizeRequestBudget` re-tokenizes the rendered rows, trims
 *     `removable` rows under `db.maxContext`, and clamps the response
 *     budget. On overflow the send aborts (`stopSending` +
 *     `abortReason = 'overflow'`).
 *
 * Runs after `fillMemoryAndPostHistory`, so a prior `stopSending`
 * short-circuits before any rendering.
 */
export async function renderAndBudget(state: AssemblyState): Promise<void> {
  if (state.stopSending) return

  const { ctx, currentChar, unformated } = state
  const db = state.database

  const render = await renderFinalPrompt({
    ctx,
    currentChar,
    unformated,
    promptTemplate: state.promptTemplate,
    usingPromptTemplate: state.usingPromptTemplate,
    formatOrder: state.formatOrder,
    memories: state.memories,
    positionParser: state.positionParser,
    isContinue: state.isContinue,
  })
  state.promptText = render.promptText

  const budget = finalizeRequestBudget({
    db,
    formated: render.formated,
    maxContextTokens: db.maxContext ?? 0,
    maxResponse: db.maxResponse ?? 0,
  })
  if (!budget.ok) {
    state.stopSending = true
    state.abortReason = 'overflow'
    state.inputTokens = budget.inputTokens
    return
  }

  state.formated = budget.formated
  state.inputTokens = budget.inputTokens
  state.outputTokens = budget.outputTokens
}

/**
 * Phase 7 Tier 3 root: assemble the full prompt payload. Chains the
 * 7-11a–f steps and returns the `AssembleResult`. Bad request IDs throw
 * `EntityNotFoundError` (from `beginAssembly`); a start trigger or a
 * budget overflow returns `{ stopSending: true }` rather than throwing.
 * The route wiring + SSE emission is 7-11g.
 */
export async function assemblePrompt(
  input: AssembleInput,
  deps: AssembleDeps,
): Promise<AssembleResult> {
  const state = beginAssembly(input, deps)
  appendUserMessageRow(state)
  applyCurrentChatRunVars(state)
  fillStaticSlots(state)
  fillLorebookSlots(state)
  await fillHistoryAndBias(state)
  fillMemoryAndPostHistory(state)
  await renderAndBudget(state)

  if (state.stopSending) {
    return {
      stopSending: true,
      abortReason: state.abortReason ?? 'stopSending',
      mutations: buildMutationPayload(state),
    }
  }

  const formated = state.formated ?? []
  return {
    stopSending: false,
    prompt: {
      messages: formated.map((row) => ({ role: row.role, content: row.content })),
      promptInfo: {
        promptText: state.promptText,
        inputTokens: state.inputTokens,
        outputTokens: state.outputTokens,
      },
      lorebookActivation: state.report,
      // 7-12b: carry the full rows + biases on the wire so the browser
      // adapter can drive a preview / dispatch, not just the lossy
      // `messages` projection. Additive to the locked SSE contract.
      formated,
      biases: state.biases,
    },
    formated,
    biases: state.biases,
    inputTokens: state.inputTokens,
    outputTokens: state.outputTokens,
    mutations: buildMutationPayload(state),
  }
}
