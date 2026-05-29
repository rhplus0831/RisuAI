import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { Chat, Database, Message, character } from '../../../../src/ts/storage/database.svelte'
import type { PromptItem } from '../../../../src/ts/process/prompt'
import type { OpenAIChat } from '../../../../src/ts/process/index.svelte'
import { EntityNotFoundError } from '../repository.js'
import {
  normalizeHypaV3Settings,
  planStandardHypaV3Memory,
  type HypaV3SummaryRef,
} from '../memoryPlanner.js'
import { planHypaV3ChunkJobs } from '../memoryChunkPlanner.js'
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
import { applyDepthPrompts, buildHistoryWindow, NO_ASSETS, type AssetLookup } from './history.js'
import { buildAssetLookup, type ResolveStoredAssetImage } from './assetLookup.js'
import { buildMemoryWindow } from './memory.js'
import {
  assemblePromptMemoryRows,
  selectPromptMemory,
  type PromptMemoryAdapterDiagnostics,
  type PromptMemoryRowAssemblyDiagnostics,
} from './memoryAdapter.js'
import {
  emptyPromptMemoryFollowUpDiagnostics,
  enqueuePromptMemoryFollowUps,
  type PromptMemoryFollowUpDiagnostics,
} from './memoryFollowups.js'
import { finalizeRequestBudget } from './budgetFinalize.js'
import type { TriggerRunResult } from './triggers.js'
import { createTriggerVarEngine, type TriggerVarEngine } from './triggerVars.js'
import { runLuaEditTrigger, type ServerLuaEditTriggerContext } from './luaRuntime.js'
import { getActiveModules, getModuleTriggers } from './modules.js'
import { parseKeyValue } from '../../../../src/ts/util/parseKeyValue'
import { expandVariables, type ExpandContext } from './variables.js'
import type { PromptEvent } from './sseEvents.js'
import type { MemorySelectionInput } from '../memorySelectionService.js'
import {
  cleanupOrphanedMemory,
  listMemorySummaries,
  type CleanupOrphanedMemoryResult,
  type EnqueueMemoryJobInput,
  type MemoryJob,
  type MemorySummary,
} from '../memoryRepository.js'
import { tokenizeChat } from './tokens.js'
import { tokenizerOptionsFromDb } from './tokenizerConfig.js'

/**
 * Root prompt assembly entry point.
 *
 * The assembler resolves the persisted database, selected character, and chat;
 * builds the template slots and expansion context; fills static/plain sections;
 * activates lorebooks; runs token preflight; builds history and bias rows;
 * bridges history through memory; applies depth prompts and start-trigger
 * system prompts; renders the final prompt; and performs the final budget trim.
 * It returns either a dispatch-ready `AssembleResult` or a structured
 * `stopSending` result for trigger/budget aborts.
 */

/**
 * The explicit dependency surface the assembler loads state through. Routes
 * bind this to persisted storage; tests inject fixtures. Keeping it a seam
 * means the assembler never imports storage globals.
 */
export interface AssembleDeps {
  loadDatabase(): Database | null
  loadMemoryDatabase?(): DatabaseSync | null
  loadPromptMemoryQueryVectors?(): MemorySelectionInput['queryVectors']
  enqueuePromptMemoryFollowUpJob?: (job: EnqueueMemoryJobInput) => MemoryJob
  /**
   * Slice 3a: resolve a stored-asset reference (sha256 id or `assets/<id>.<ext>`
   * path) to image bytes for `{{asset_prompt::}}` / the char icon. The route
   * binds this to the on-disk assets store; absent, asset prompts drop their
   * bytes (the pre-3a behavior). Inlay bytes ride the request `inlayAssets`, not
   * this resolver.
   */
  resolveStoredAssetImage?: ResolveStoredAssetImage
}

export interface PromptMemoryChunkPlanningDiagnostics {
  attempted: boolean
  chunksCreated: number
  jobsCreated: number
  plannedWindows: number
  cleanup: CleanupOrphanedMemoryResult
  plannerWarnings: string[]
  plannerErrors: string[]
  errors: string[]
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
  | 'regenerate'
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

export interface AssembleRestorationPayload {
  chatId: string
  characterId: string
  selectedCharID: number
  chatPage: number
  messages: Message[]
  scriptstate?: Record<string, string | number | boolean>
}

/**
 * The full assembler output. `prompt` is the `prompt` SSE event payload; the
 * remaining fields carry dispatch-only data. On an abort (`stopSending`) the
 * mutation contract still rides along so the route can persist chat-var writes
 * made before the abort.
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
  /** Logit-bias rows for dispatch. */
  biases?: [string, number][]
  /** Final input token count from `finalizeRequestBudget`. */
  inputTokens?: number
  /** Clamped response budget from `finalizeRequestBudget`. */
  outputTokens?: number
  /** Server-owned chat and variable mutations produced during assembly. */
  mutations?: AssembleMutationPayload
  /** Browser-visible state from before the server-owned mutations replay. */
  restoration?: AssembleRestorationPayload
}

/**
 * The internal assembler state threaded through the assembly steps.
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
  /** Recorded identity only; applying a non-active preset/loadout happens elsewhere. */
  presetId?: string
  loadoutId?: string
  // --- Lorebook placement + token preflight (set by `fillLorebookSlots`) ---
  /** The lorebook activation report (entries that fired + why). */
  report?: LorebookActivationReport
  /** `{{position::}}` resolver shared by the template / render walkers. */
  positionParser?: (text: string, loc: string) => string
  /** Depth-positioned lore the history splicer consumes. */
  depthPrompts?: LoreEntryActive[]
  /** Running token estimate: `maxResponse + 50 + preflight.addedTokens`. */
  currentTokens?: number
  /** From `preflightTemplateTokens`: the template contains a `memory` card. */
  memoryCardUsed?: boolean
  /** From `preflightTemplateTokens`: the template contains a `cache` card. */
  hasCachePoint?: boolean
  // --- History window + bias rows (set by `fillHistoryAndBias`) ---
  /**
   * The flattened history rows from `buildHistoryWindow`. Captured here only;
   * the memory window pushes them into `unformated.chats`.
   */
  historyMessages?: OpenAIChat[]
  /**
   * The start-trigger result threaded out of the history walk. Later assembly
   * merges `triggerResult.additonalSysPrompt` into the slots; `null` when no
   * triggers ran.
   */
  triggerResult?: TriggerRunResult | null
  /**
   * The start trigger asked to abort the send. Mirrors the SPA's
   * `history.stopSending` early return (`index.svelte.ts:236-238`).
   */
  stopSending?: boolean
  /**
   * A run-var expansion or start-trigger `setvar` mutated chat state; the route
   * persists the database when true.
   */
  varChanged?: boolean
  /** Bias rows: `db.bias ∪ char.bias`, unescaped + variable-expanded. */
  biases?: [string, number][]
  // --- Memory bridge (set by `fillMemoryAndPostHistory`) ---
  /**
   * Memory-card rows split out of the history by the memory window and fed to
   * `renderFinalPrompt`.
   */
  memories?: OpenAIChat[]
  promptMemoryChunkPlanningDiagnostics?: PromptMemoryChunkPlanningDiagnostics
  promptMemorySelectionDiagnostics?: PromptMemoryAdapterDiagnostics
  promptMemoryRowAssemblyDiagnostics?: PromptMemoryRowAssemblyDiagnostics
  promptMemoryFollowUpDiagnostics?: PromptMemoryFollowUpDiagnostics
  promptMemoryRows?: OpenAIChat[]
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
  // --- Typed mutation handoff (set while assembling) ---
  initialMessages?: Message[]
  messageMutationCheckpoint?: Message[]
  initialScriptstate?: Record<string, string | number | boolean>
  messageMutations?: AssembleMessageMutation[]
  additionalSystemPromptMutations?: AssembleAdditionalSystemPromptMutation[]
  memoryDatabase?: DatabaseSync | null
  promptMemoryQueryVectors?: MemorySelectionInput['queryVectors']
  enqueuePromptMemoryFollowUpJob?: (job: EnqueueMemoryJobInput) => MemoryJob
  /**
   * The non-empty asset lookup the history walk resolves inlay / asset bytes
   * through. Built in `beginAssembly` from the request `inlayAssets` + the
   * route's store resolver; falls back to `NO_ASSETS` when unset.
   */
  assetLookup?: AssetLookup
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
    initialMessages: cloneMessages(currentChat.message ?? []),
    messageMutationCheckpoint: cloneMessages(currentChat.message ?? []),
    initialScriptstate: cloneScriptstate(currentChat.scriptstate),
    messageMutations: [],
    additionalSystemPromptMutations: [],
    memoryDatabase: deps.loadMemoryDatabase?.() ?? null,
    promptMemoryQueryVectors: deps.loadPromptMemoryQueryVectors?.() ?? [],
    enqueuePromptMemoryFollowUpJob: deps.enqueuePromptMemoryFollowUpJob,
    assetLookup: buildAssetLookup({
      database,
      currentChar,
      currentChat,
      inlayAssets: input.inlayAssets,
      resolveStoredAssetImage: deps.resolveStoredAssetImage,
    }),
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

  const messages = (state.currentChat.message ??= [])
  const lastIndex = messages.length - 1
  const lastMessage = messages[lastIndex]
  if (
    lastMessage?.role === 'user' &&
    lastMessage.data === userMessage &&
    (lastMessage.name ?? null) === null
  ) {
    const message = {
      ...structuredClone(lastMessage),
      chatId: lastMessage.chatId ?? randomUUID(),
      time: lastMessage.time ?? Date.now(),
      name: null,
    } as Message
    messages[lastIndex] = message
    state.messageMutations?.push({
      type: 'append',
      source: 'user_message',
      index: lastIndex,
      message: structuredClone(message),
    })
    state.messageMutationCheckpoint = cloneMessages(messages)
    return
  }

  const message = {
    role: 'user',
    data: userMessage,
    time: Date.now(),
    chatId: randomUUID(),
    name: null,
  } as Message
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

function prepareRegenerateTranscript(state: AssemblyState): void {
  if (state.input.mode !== 'regenerate') return

  const regenerateMessageId = state.input.regenerateMessageId
  if (typeof regenerateMessageId !== 'string' || regenerateMessageId.length === 0) {
    throw new EntityNotFoundError('regenerate message not found')
  }

  const messages = (state.currentChat.message ??= [])
  const targetIndex = messages.findIndex((message) => message.chatId === regenerateMessageId)
  if (targetIndex === -1) {
    const lastMessage = messages.at(-1)
    if (lastMessage?.role === 'user') {
      return
    }
    throw new EntityNotFoundError(`regenerate message not found: ${regenerateMessageId}`)
  }

  const target = messages[targetIndex]
  if (target.role === 'user') {
    throw new EntityNotFoundError(
      `regenerate target must be an assistant message: ${regenerateMessageId}`,
    )
  }
  if (targetIndex !== messages.length - 1) {
    throw new EntityNotFoundError(
      `regenerate target must be the latest assistant message: ${regenerateMessageId}`,
    )
  }

  const saying = target.saying
  let sayingQuota = 2
  while (messages.length > 0 && messages.at(-1)?.role !== 'user') {
    const last = messages.at(-1)
    if (last?.saying === saying) {
      sayingQuota -= 1
      if (sayingQuota === 0) {
        break
      }
    }
    messages.pop()
  }
  captureMessageReplacement(state, 'regenerate')
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

function buildRestorationPayload(state: AssemblyState): AssembleRestorationPayload {
  const scriptstate = structuredClone(state.initialScriptstate ?? {})
  return {
    chatId: state.input.chatId,
    characterId: state.input.characterId,
    selectedCharID: state.selectedCharID,
    chatPage: state.chatPage,
    messages: cloneMessages(state.initialMessages ?? []),
    scriptstate: Object.keys(scriptstate).length > 0 ? scriptstate : undefined,
  }
}

/**
 * Fill the static/plain slots on the `AssemblyState`, mutating
 * `state.unformated` in place. Mirrors `index.svelte.ts:192-204`:
 *   - plain sections (`main` / `jailbreak` / `globalNote`) only on the
 *     non-utility, non-template path,
 *   - `authorNote`, the chain-of-thought into `postEverything`,
 *     `description`, and `personaPrompt` always.
 *
 * Sync — every leaf is sync. `buildInlayViewInstruction` (`:204`) is not part
 * of this server path.
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
 * Run the async history window and collect the bias rows,
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
 * Boundary: the history rows are only captured on `state.historyMessages` here.
 * The memory window pushes them into `unformated.chats`
 * (`buildMemoryWindow`, `index.svelte.ts:243-263`). Inlay/asset bytes resolve
 * through `state.assetLookup`, falling back to `NO_ASSETS` only when no resolver
 * is bound.
 */
export async function fillHistoryAndBias(state: AssemblyState): Promise<void> {
  const { ctx, currentChar, usingPromptTemplate } = state
  const db = state.database

  const history = await buildHistoryWindow(
    ctx,
    currentChar,
    state.currentChat,
    usingPromptTemplate,
    state.assetLookup ?? NO_ASSETS,
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
 * Bridge the captured history into `unformated.chats` through the
 * non-Hypa memory window, then apply the post-history slot mutations.
 * Mirrors `index.svelte.ts:243-304`:
 *   - `buildMemoryWindow` (memory.ts) trims the oldest rows under
 *     `db.maxContext`, promotes the trailing chat to `lastChat` (no
 *     template), splits memory cards into `state.memories`, and marks the
 *     rest `removable`; `stopSending` short-circuits the rest;
 *   - `applyDepthPrompts` splices the lorebook depth prompts into
 *     `unformated.chats` (`:275-283`);
 *   - the start trigger's `additonalSysPrompt` is placed into
 *     `postEverything` / `lastChat` (`:285-304`).
 *
 * Sync — the non-Hypa window and every post-history mutation are sync. Runs
 * after `fillHistoryAndBias`, so a prior `stopSending` short-circuits.
 */
export function fillMemoryAndPostHistory(state: AssemblyState): void {
  if (state.stopSending) return

  const { ctx, currentChar, unformated } = state
  const db = state.database
  const promptMemoryRows = buildPromptMemoryRowsForAssembly(state)

  const mem = buildMemoryWindow({
    chats: [...promptMemoryRows, ...(state.historyMessages ?? [])],
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

function buildPromptMemoryRowsForAssembly(state: AssemblyState): OpenAIChat[] {
  const memoryDb = state.memoryDatabase
  if (!memoryDb) {
    state.promptMemoryRows = []
    state.promptMemoryChunkPlanningDiagnostics = emptyPromptMemoryChunkPlanningDiagnostics()
    state.promptMemoryFollowUpDiagnostics = emptyPromptMemoryFollowUpDiagnostics()
    return []
  }
  const enabled = shouldSelectPromptMemory(state)
  const { settings } = normalizeHypaV3Settings(resolveHypaV3PresetSettings(state.database))
  const chatId = state.currentChat.id ?? state.input.chatId
  const embeddingModel = resolvePromptMemoryEmbeddingModel(state.database)
  state.promptMemoryChunkPlanningDiagnostics = planPromptMemoryChunksForAssembly({
    state,
    memoryDb,
    chatId,
    enabled,
    settings,
  })
  const selection = selectPromptMemory({
    db: memoryDb,
    enabled,
    chatId,
    summaryModel: settings.summarizationModel,
    embeddingModel,
    queryVectors: state.promptMemoryQueryVectors ?? [],
    availableTokens: Math.floor((state.database.maxContext ?? 0) * settings.memoryTokensRatio),
    settings: {
      recentMemoryRatio: settings.recentMemoryRatio,
      similarMemoryRatio: settings.similarMemoryRatio,
    },
  })
  state.promptMemorySelectionDiagnostics = selection.diagnostics

  const assembled = assemblePromptMemoryRows(selection)
  state.promptMemoryRowAssemblyDiagnostics = assembled.diagnostics
  state.promptMemoryFollowUpDiagnostics = enqueuePromptMemoryFollowUps({
    db: memoryDb,
    chatId,
    summaryModel: settings.summarizationModel,
    embeddingModel,
    diagnostics: selection.diagnostics.missingMemory,
    enqueueJob: state.enqueuePromptMemoryFollowUpJob,
  })
  state.promptMemoryRows = assembled.rows
  return assembled.rows
}

function planPromptMemoryChunksForAssembly(input: {
  state: AssemblyState
  memoryDb: DatabaseSync
  chatId: string
  enabled: boolean
  settings: ReturnType<typeof normalizeHypaV3Settings>['settings']
}): PromptMemoryChunkPlanningDiagnostics {
  const diagnostics = emptyPromptMemoryChunkPlanningDiagnostics()
  if (!input.enabled) return diagnostics

  diagnostics.attempted = true
  try {
    const chats = input.state.historyMessages ?? []
    const currentChatMemos = chats.map((chat) => chat.memo).filter(isNonEmptyString)
    if (!input.settings.preserveOrphanedMemory && currentChatMemos.length > 0) {
      diagnostics.cleanup = cleanupOrphanedMemory(input.memoryDb, {
        chatId: input.chatId,
        currentChatMemos,
        preserveOrphanedMemory: input.settings.preserveOrphanedMemory,
      })
    }

    const summaries = listMemorySummaries(input.memoryDb, {
      chatId: input.chatId,
      model: input.settings.summarizationModel,
    })
    const { encoding, options } = tokenizerOptionsFromDb(input.state.database)
    const plan = planStandardHypaV3Memory({
      chats,
      currentTokens: input.state.currentTokens ?? 0,
      maxContextTokens: input.state.database.maxContext ?? 0,
      maxResponseTokens: input.state.database.maxResponse ?? 0,
      settings: input.settings,
      summaries: summaries.map(summaryToHypaV3Ref),
      tokenizeChat: (chat) => tokenizeChat(chat, encoding, options),
    })
    diagnostics.plannerWarnings.push(...plan.warnings.map((warning) => warning.message))
    diagnostics.plannerErrors.push(...plan.errors.map((error) => error.message))

    const planned = planHypaV3ChunkJobs({
      db: input.memoryDb,
      chatId: input.chatId,
      chats,
      plan,
      model: input.settings.summarizationModel,
    })
    diagnostics.plannedWindows = planned.planned.length
    diagnostics.chunksCreated = planned.chunksCreated
    diagnostics.jobsCreated = planned.jobsCreated
  } catch (error) {
    diagnostics.errors.push(errorMessage(error, 'failed to plan Hypa V3 memory chunks'))
  }
  return diagnostics
}

function emptyPromptMemoryChunkPlanningDiagnostics(): PromptMemoryChunkPlanningDiagnostics {
  return {
    attempted: false,
    chunksCreated: 0,
    jobsCreated: 0,
    plannedWindows: 0,
    cleanup: { summariesDeleted: 0, chunksDeleted: 0 },
    plannerWarnings: [],
    plannerErrors: [],
    errors: [],
  }
}

function summaryToHypaV3Ref(summary: MemorySummary): HypaV3SummaryRef {
  return { chatMemos: readSummaryChatMemos(summary) ?? [] }
}

function readSummaryChatMemos(summary: MemorySummary): string[] | null {
  if (!isRecord(summary.metadata)) return null
  const chatMemos = summary.metadata.chatMemos
  if (!Array.isArray(chatMemos)) return null
  if (!chatMemos.every((memo): memo is string => typeof memo === 'string')) return null
  return chatMemos
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.length > 0) return error.message
  if (typeof error === 'string' && error.length > 0) return error
  return fallback
}

function shouldSelectPromptMemory(state: AssemblyState): boolean {
  return (
    state.memoryDatabase !== null &&
    state.database.hypaV3 === true &&
    state.currentChar.supaMemory === true
  )
}

function resolveHypaV3PresetSettings(database: Database): unknown {
  const presetId = typeof database.hypaV3PresetId === 'number' ? database.hypaV3PresetId : 0
  const preset = database.hypaV3Presets?.[presetId]
  if (preset && typeof preset === 'object' && 'settings' in preset) {
    return preset.settings
  }
  return database.hypaV3Settings
}

function resolvePromptMemoryEmbeddingModel(database: Database): string {
  if (database.hypaModel === 'custom') return 'custom'
  return database.hypaModel || 'MiniLM'
}

/**
 * Slice 3b sub-slice 2 — build the VM-backed Lua `editRequest` hook the final
 * render applies over `formated` and the prompt-info capture, mirroring the
 * browser's `renderFinalPrompt.ts:384`
 * `runLuaEditTrigger(char, 'editRequest', formated)`.
 *
 * The hook's var engine is a `createTriggerVarEngine` bound to the working chat
 * and the persisted db chat coordinates, so Lua `setChatVar`/`setState` writes
 * during the hook flow into the same `chat.scriptstate` the route's chat-var
 * delta reads (`buildChatVarMutations` → `persistAssemblyChatVars`) — picked up
 * for free, exactly like a `'start'` trigger's writes. The returned engine lets
 * the caller fold the hook's `varChanged` into the assembly state.
 *
 * Supplied unconditionally for byte-parity with the browser (which always calls
 * `runLuaEditTrigger`); when the character + active modules declare no
 * `triggerlua` effect the hook is a no-op and no Lua engine boots
 * (`runLuaEditTrigger` only executes `triggerlua` effects). Privileged host fns
 * stay gated off — edit-hook triggers run `lowLevelAccess: false`.
 */
function buildLuaEditRequest(state: AssemblyState): {
  editRequest: (rows: OpenAIChat[]) => Promise<OpenAIChat[]>
  varEngine: TriggerVarEngine
} {
  const db = state.database
  const varEngine = createTriggerVarEngine({
    chat: state.currentChat,
    database: db,
    selectedCharID: state.selectedCharID,
    chatPage: state.chatPage,
    defaultVariables: parseKeyValue(state.currentChar.defaultVariables ?? '').concat(
      parseKeyValue(db.templateDefaultVariables ?? ''),
    ),
  })
  const editCtx: ServerLuaEditTriggerContext = {
    chat: state.currentChat,
    database: db,
    selectedCharID: state.selectedCharID,
    chatPage: state.chatPage,
    varEngine,
    model: db.aiModel,
    moduleTriggers: getModuleTriggers(getActiveModules(db, state.currentChar, state.currentChat)),
  }
  return {
    editRequest: (rows) =>
      runLuaEditTrigger(state.currentChar, 'editRequest', rows, undefined, editCtx),
    varEngine,
  }
}

/**
 * 7-11f — render the now-complete slots into the flat prompt and run the
 * budget recheck, mutating `state` in place. Mirrors
 * `index.svelte.ts:306-345`:
 *   - `renderFinalPrompt` over `state.formatOrder` (which already has
 *     `postEverything` appended by `buildFormatOrder`, so it is **not**
 *     re-pushed here), `state.memories`, and `state.positionParser`,
 *     with the `isContinue` marker, and the VM-backed Lua `editRequest`
 *     hook ({@link buildLuaEditRequest}) over both `formated` and the
 *     prompt-info capture (slice 3b sub-slice 2; mirrors the browser's
 *     `renderFinalPrompt.ts:384` `runLuaEditTrigger`);
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

  const lua = buildLuaEditRequest(state)
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
    editRequest: lua.editRequest,
  })
  state.promptText = render.promptText
  // A Lua `editRequest` hook may have written chat vars; fold its writes into
  // the assembly state so the route persists them (the var engine already wrote
  // through to the db chat scriptstate the delta reads).
  if (lua.varEngine.varChanged) {
    state.varChanged = true
    syncWorkingScriptstate(state)
  }

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
 * Assemble the full prompt payload. Bad request IDs throw `EntityNotFoundError`;
 * a start trigger or budget overflow returns `{ stopSending: true }` rather
 * than throwing.
 */
export async function assemblePrompt(
  input: AssembleInput,
  deps: AssembleDeps,
): Promise<AssembleResult> {
  const state = beginAssembly(input, deps)
  prepareRegenerateTranscript(state)
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
      restoration: buildRestorationPayload(state),
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
    restoration: buildRestorationPayload(state),
  }
}
