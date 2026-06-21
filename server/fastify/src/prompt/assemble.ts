import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { performance } from 'node:perf_hooks'
import type { Chat, Database, Message, character } from '../../../../src/ts/storage/database.svelte'
import type { CbsCallbackMemo } from '../../../../src/ts/cbs'
import type { PromptItem } from '../../../../src/ts/process/prompt'
import type { OpenAIChat } from '../../../../src/ts/process/index.svelte'
import { EntityNotFoundError } from '../repository.js'
import {
  normalizeHypaV3Settings,
  planStandardHypaV3Memory,
  type HypaV3Settings,
  type HypaV3SummaryRef,
} from '../memoryPlanner.js'
import { planHypaV3ChunkJobs } from '../memoryChunkPlanner.js'
import {
  buildFormatOrder,
  createStableCardRenderCache,
  normalizeTemplate,
  renderFinalPrompt,
  type FormatOrderKey,
  type StableCardRenderCache,
  type UnformatedPromptSlots,
} from './templates.js'
import {
  buildAuthorNote,
  buildCotInstruction,
  buildDescription,
  buildInlayViewInstruction,
  buildPersona,
} from './staticSections.js'
import { buildPlainPromptSections } from './plainSections.js'
import {
  activateLorebook,
  activateLorebookAsync,
  buildLorebookContext,
  type LoreEntryActive,
  type LorebookActivationReport,
} from './lorebook.js'
import { preflightTemplateTokens } from './preflight.js'
import {
  applyDepthPrompts,
  buildHistoryWindow,
  NO_ASSETS,
  type AssetLookup,
  type EditProcessHook,
  type PreparedDepthPrompt,
} from './history.js'
import { buildAssetLookup, type ResolveStoredAsset } from './assetLookup.js'
import { buildPromptAssetTable, type PromptAssetTable } from './promptAssets.js'
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
import { runTrigger, type TriggerRunContext, type TriggerRunResult } from './triggers.js'
import { createTriggerVarEngine, type TriggerVarEngine } from './triggerVars.js'
import {
  createLuaExecBudget,
  runLuaEditTrigger,
  runServerLua,
  throwServerLuaFailure,
  type LuaExecBudget,
  type ServerLuaEditTriggerContext,
} from './luaRuntime.js'
import { processScriptAsync } from './scripts.js'
import { getActiveModules, getModuleTriggers } from './modules.js'
import { parseKeyValue } from '../../../../src/ts/util/parseKeyValue'
import { expandVariables, type ExpandContext } from './variables.js'
import type { PromptEvent } from './sseEvents.js'
import type { MemorySelectionInput } from '../memorySelectionService.js'
import {
  cleanupOrphanedMemoryWithSummarySnapshot,
  loadMemorySummarySnapshot,
  type CleanupOrphanedMemoryResult,
  type EnqueueMemoryJobInput,
  type MemoryJob,
  type MemorySummary,
  type MemorySummarySnapshot,
} from '../memoryRepository.js'
import { tokenize, tokenizeChat } from './tokens.js'
import { tokenizeHypaV3PrefixChat } from './prefixTokenMemo.js'
import { tokenizerOptionsFromDb } from './tokenizerConfig.js'
import { isRisuChatParserFixedPoint } from './parserFixedPoint.js'
import { bumpAssemblyCbsHistoryGeneration, createAssemblyCbsCallbackMemo } from './cbsCallbackMemo.js'
import { buildEffectiveGenerationConfig } from './effectiveGenerationConfig.js'

/**
 * Root prompt assembly entry point.
 *
 * The assembler resolves the persisted database, selected character, and chat;
 * builds the template slots and expansion context; fills static/plain sections;
 * activates lorebooks; runs token preflight; builds history rows;
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
  recordAssemblyStageTiming?: (stage: PromptAssemblyStage, durationMs: number) => void
  /**
   * Resolve a stored-asset reference (sha256 id or `assets/<id>.<ext>` path) to
   * prompt multimodal bytes. The route binds this to the on-disk assets store;
   * absent, asset and inlay prompts drop their bytes.
   */
  resolveStoredAsset?: ResolveStoredAsset
  /**
   * Originating-request (or durable-job) abort signal, threaded into the Lua
   * runtime so a disconnect/cancel stops in-flight hook work.
   */
  signal?: AbortSignal
}

export type PromptAssemblyStage =
  | 'scope_resolution'
  | 'submit_transforms'
  | 'static_plain_slots'
  | 'lorebook_preflight'
  | 'history_bias'
  | 'memory_bridge'
  | 'final_render'
  | 'budget'

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
  loadoutId?: string
  mode: 'send' | 'continue' | 'preview' | 'preview_prompt' | 'regenerate'
  regenerateMessageId?: string
  userMessage?: string
  resetMessages?: boolean
  expectedRevision?: number
  /** Legacy compatibility only; Fastify inlay bytes should live in `/assets`. */
  inlayAssets?: unknown[]
  /** Legacy browser-local inlay id -> server asset id aliases. */
  inlayAssetRefs?: unknown[]
}

export type AssembleMutationSource =
  | 'user_message'
  | 'regenerate'
  | 'run_var'
  | 'history_normalize'
  | 'start_trigger'
  | 'input_trigger'
  | 'editinput'
  | 'output_trigger'

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

const MESSAGE_MUTATION_FIRST_CHANGED_INDEX = Symbol('messageMutationFirstChangedIndex')

type MessageMutationWithFirstChangedIndex = AssembleMessageMutation & {
  [MESSAGE_MUTATION_FIRST_CHANGED_INDEX]?: number
}

export interface AssemblyMessageFullTranscriptCloneCounts {
  initialMessages: number
  messageReplacement: number
  submitTranscript: number
  restoration: number
  postGenerationCheckpoint: number
}

export interface AssemblyMessageCaptureInstrumentation {
  fullTranscriptClones: AssemblyMessageFullTranscriptCloneCounts
  fullTranscriptStringifies: number
  rowStringifies: number
  messageReplacementComparisons: number
  messageReplacementCaptures: Partial<Record<Exclude<AssembleMutationSource, 'user_message'>, number>>
}

const assemblyMessageCaptureInstrumentation: AssemblyMessageCaptureInstrumentation = {
  fullTranscriptClones: {
    initialMessages: 0,
    messageReplacement: 0,
    submitTranscript: 0,
    restoration: 0,
    postGenerationCheckpoint: 0,
  },
  fullTranscriptStringifies: 0,
  rowStringifies: 0,
  messageReplacementComparisons: 0,
  messageReplacementCaptures: {},
}

export function resetAssemblyMessageCaptureInstrumentation(): void {
  assemblyMessageCaptureInstrumentation.fullTranscriptClones.initialMessages = 0
  assemblyMessageCaptureInstrumentation.fullTranscriptClones.messageReplacement = 0
  assemblyMessageCaptureInstrumentation.fullTranscriptClones.submitTranscript = 0
  assemblyMessageCaptureInstrumentation.fullTranscriptClones.restoration = 0
  assemblyMessageCaptureInstrumentation.fullTranscriptClones.postGenerationCheckpoint = 0
  assemblyMessageCaptureInstrumentation.fullTranscriptStringifies = 0
  assemblyMessageCaptureInstrumentation.rowStringifies = 0
  assemblyMessageCaptureInstrumentation.messageReplacementComparisons = 0
  assemblyMessageCaptureInstrumentation.messageReplacementCaptures = {}
}

export function getAssemblyMessageCaptureInstrumentation(): AssemblyMessageCaptureInstrumentation {
  return {
    fullTranscriptClones: { ...assemblyMessageCaptureInstrumentation.fullTranscriptClones },
    fullTranscriptStringifies: assemblyMessageCaptureInstrumentation.fullTranscriptStringifies,
    rowStringifies: assemblyMessageCaptureInstrumentation.rowStringifies,
    messageReplacementComparisons: assemblyMessageCaptureInstrumentation.messageReplacementComparisons,
    messageReplacementCaptures: {
      ...assemblyMessageCaptureInstrumentation.messageReplacementCaptures,
    },
  }
}

function recordFullTranscriptClone(reason: keyof AssemblyMessageFullTranscriptCloneCounts): void {
  assemblyMessageCaptureInstrumentation.fullTranscriptClones[reason]++
}

function recordMessageReplacementCapture(source: Exclude<AssembleMutationSource, 'user_message'>): void {
  assemblyMessageCaptureInstrumentation.messageReplacementCaptures[source] =
    (assemblyMessageCaptureInstrumentation.messageReplacementCaptures[source] ?? 0) + 1
}

export function getMessageMutationFirstChangedIndex(mutation: AssembleMessageMutation): number | undefined {
  return (mutation as MessageMutationWithFirstChangedIndex)[MESSAGE_MUTATION_FIRST_CHANGED_INDEX]
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

export type AssembleAbortReason = 'trigger_stop' | 'history_context_overflow' | 'overflow'

/**
 * The full assembler output. `prompt` is the `prompt` SSE event payload; the
 * remaining fields carry dispatch-only data. On an abort (`stopSending`) the
 * mutation contract still rides along so the route can persist chat-var writes
 * made before the abort.
 */
export interface AssembleResult {
  /** A start trigger or context-budget failure aborted the send. */
  stopSending: boolean
  /** Why the send aborted, when `stopSending` is true. */
  abortReason?: AssembleAbortReason
  /** The `prompt` SSE event payload (messages + promptInfo + lore report). */
  prompt?: Omit<PromptEvent, 'type'>
  /** The budgeted flat prompt (full `OpenAIChat` rows) for dispatch. */
  formated?: OpenAIChat[]
  /** Final input token count from `finalizeRequestBudget`. */
  inputTokens?: number
  /** Clamped response budget from `finalizeRequestBudget`. */
  outputTokens?: number
  /** Server-owned chat and variable mutations produced during assembly. */
  mutations?: AssembleMutationPayload
  /** Browser-visible state from before the server-owned mutations replay. */
  restoration?: AssembleRestorationPayload
  /**
   * Submit-time transcript (after the input trigger + `editinput` rewrite,
   * before the run-var / history passes) the route persists when
   * {@link submitTranscriptChanged} is set. The browser sends the *raw* user
   * text for a server-backed send and defers the transform to the server, so this
   * is the authoritative post-`editinput` transcript the route writes. Route-only
   * (not on the SSE wire).
   */
  submitMessages?: Message[]
  /**
   * True when the submit-time input trigger rewrote the transcript or `editinput`
   * transformed the user message — i.e. the route must persist {@link
   * submitMessages}. Stays false for a plain send (no input trigger / editinput),
   * so the route leaves message persistence to the browser exactly as before.
   */
  submitTranscriptChanged?: boolean
  /**
   * Internal assembler state, exposed **route-only** (never on the SSE wire) so
   * the route can run {@link runServerPostGeneration} over the
   * just-generated assistant text after provider dispatch — it reuses the same
   * chat clone, expansion context, var-engine coordinates, and persisted
   * scriptstate baseline assembly built. Present only on the dispatch-ready
   * success path (omitted for `stopSending`, which never dispatches).
   */
  state?: AssemblyState
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
  /** Per-assembly opt-in CBS callback memo for expensive history/lore callbacks. */
  cbsCallbackMemo: CbsCallbackMemo
  unformated: UnformatedPromptSlots
  promptTemplate: PromptItem[] | null
  usingPromptTemplate: boolean
  /** Per-assembly cache for template cards stable across token preflight and final render. */
  stableCardCache: StableCardRenderCache
  formatOrder: FormatOrderKey[]
  /** `input.mode === 'continue'`; drives the `[Continue the last response]` marker. */
  isContinue: boolean
  /** Abort signal from `AssembleDeps.signal`, handed to every Lua run. */
  signal?: AbortSignal
  /**
   * Aggregate Lua exec budget shared by every hook phase of this request
   * (input/output triggers, editinput/editRequest/editoutput), so
   * a card stacking runaway hooks cannot stall assembly indefinitely.
   */
  luaExecBudget?: LuaExecBudget
  /** Recorded identity only; live assembly config comes from chat.generationSettings. */
  modelPresetId?: string
  promptPresetId?: string
  loadoutId?: string
  // --- Lorebook placement + token preflight (set by `fillLorebookSlots`) ---
  /** The lorebook activation report (entries that fired + why). */
  report?: LorebookActivationReport
  /** `{{position::}}` resolver shared by the template / render walkers. */
  positionParser?: (text: string, loc: string) => string
  /** Depth-positioned lore the history splicer consumes. */
  depthPrompts?: LoreEntryActive[]
  /**
   * Depth prompt bodies expanded during history token preflight and reused
   * during the final post-memory splice.
   */
  preparedDepthPrompts?: PreparedDepthPrompt[]
  /** Running token estimate: `maxResponse + 50 + preflight.addedTokens`. */
  currentTokens?: number
  /** From `preflightTemplateTokens`: the template contains a `memory` card. */
  memoryCardUsed?: boolean
  /** From `preflightTemplateTokens`: the template contains a `cache` card. */
  hasCachePoint?: boolean
  // --- History window (set by `fillHistoryAndBias`) ---
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
  recordAssemblyStageTiming?: (stage: PromptAssemblyStage, durationMs: number) => void
  promptMemoryRows?: OpenAIChat[]
  // --- Final render + budget (set by `renderAndBudget`) ---
  /** The budgeted flat prompt for dispatch. */
  formated?: OpenAIChat[]
  /** Template-path prompt-info rows (`renderFinalPrompt.promptText`). */
  promptText?: OpenAIChat[]
  /** Final input token count from `finalizeRequestBudget`. */
  inputTokens?: number
  /** Clamped response budget from `finalizeRequestBudget`. */
  outputTokens?: number
  /** Why the send aborted, when `stopSending` is true. */
  abortReason?: AssembleAbortReason
  // --- Typed mutation handoff (set while assembling) ---
  initialMessages?: Message[]
  messageMutationCheckpoint?: Message[]
  initialScriptstate?: Record<string, string | number | boolean>
  /** The submit-time input trigger rewrote the transcript. */
  inputTriggerRewroteTranscript?: boolean
  /** `editinput` transformed the submitted user message. */
  editInputTransformed?: boolean
  /** Post-`editinput` submit transcript snapshot before run-var processing. */
  submitMessages?: Message[]
  messageMutations?: AssembleMessageMutation[]
  additionalSystemPromptMutations?: AssembleAdditionalSystemPromptMutation[]
  memoryDatabase?: DatabaseSync | null
  promptMemoryQueryVectors?: MemorySelectionInput['queryVectors']
  enqueuePromptMemoryFollowUpJob?: (job: EnqueueMemoryJobInput) => MemoryJob
  /**
   * The non-empty asset lookup the history walk resolves inlay / asset bytes
   * through. Built lazily for the history stage from the route's store resolver
   * plus optional legacy inlay id aliases; falls back to `NO_ASSETS` when unset.
   */
  assetLookup?: AssetLookup
  /** Char + module asset rows shared by `assetLookup` and the history walk. */
  promptAssetTable?: PromptAssetTable
  resolveStoredAsset?: ResolveStoredAsset
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

  const effective = buildEffectiveGenerationConfig({
    database,
    currentChar,
    currentChat,
    selectedCharID,
    chatPage,
  })

  return {
    database: effective.database,
    currentChar: effective.currentChar,
    currentChat: effective.currentChat,
    selectedCharID,
    chatPage,
  }
}

/**
 * Build the `AssemblyState`: resolve scope, construct the shared
 * `ExpandContext` + empty slots, and run the pure template helpers.
 */
export function beginAssembly(input: AssembleInput, deps: AssembleDeps): AssemblyState {
  const { database, currentChar, currentChat, selectedCharID, chatPage } = resolveScope(input, deps)

  const cbsCallbackMemo = createAssemblyCbsCallbackMemo()
  const luaExecBudget = createLuaExecBudget()
  const ctx: ExpandContext = {
    database,
    selectedCharID,
    chatPage,
    signal: deps.signal,
    luaExecBudget,
    cbsCallbackMemo,
  }
  const unformated = createEmptyUnformatedSlots()

  const { promptTemplate, usingPromptTemplate } = normalizeTemplate(database, currentChar)
  const formatOrder = buildFormatOrder(database)
  const stableCardCache = createStableCardRenderCache()
  const initialMessages = cloneMessages(currentChat.message ?? [], 'initialMessages')

  return {
    input,
    database,
    currentChar,
    currentChat,
    selectedCharID,
    chatPage,
    ctx,
    cbsCallbackMemo,
    unformated,
    promptTemplate,
    usingPromptTemplate,
    stableCardCache,
    formatOrder,
    signal: deps.signal,
    luaExecBudget,
    isContinue: input.mode === 'continue',
    modelPresetId: currentChat.generationSettings?.modelPresetId,
    promptPresetId: currentChat.generationSettings?.promptPresetId,
    loadoutId: input.loadoutId,
    initialMessages,
    messageMutationCheckpoint: initialMessages,
    initialScriptstate: cloneScriptstate(currentChat.scriptstate),
    messageMutations: [],
    additionalSystemPromptMutations: [],
    memoryDatabase: deps.loadMemoryDatabase?.() ?? null,
    promptMemoryQueryVectors: deps.loadPromptMemoryQueryVectors?.() ?? [],
    enqueuePromptMemoryFollowUpJob: deps.enqueuePromptMemoryFollowUpJob,
    resolveStoredAsset: deps.resolveStoredAsset,
  }
}

function cloneMessages(
  messages: readonly Message[] | undefined,
  reason: keyof AssemblyMessageFullTranscriptCloneCounts,
): Message[] {
  recordFullTranscriptClone(reason)
  return structuredClone(messages ?? []) as Message[]
}

function cloneScriptstate(scriptstate: Chat['scriptstate'] | undefined): Record<string, string | number | boolean> {
  return structuredClone(scriptstate ?? {}) as Record<string, string | number | boolean>
}

function scriptstateEqual(
  a: Record<string, string | number | boolean>,
  b: Record<string, string | number | boolean>,
): boolean {
  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  if (aKeys.length !== bKeys.length) return false
  for (const key of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false
    if (a[key] !== b[key]) return false
  }
  return true
}

function currentPersistedScriptstateSnapshot(state: AssemblyState): Record<string, string | number | boolean> {
  return cloneScriptstate(currentPersistedChat(state)?.scriptstate)
}

function persistedScriptstateChangedSince(
  state: AssemblyState,
  before: Record<string, string | number | boolean>,
): boolean {
  return !scriptstateEqual(before, currentPersistedScriptstateSnapshot(state))
}

function equalMessageRows(a: Message, b: Message): boolean {
  if (a === b) return true
  assemblyMessageCaptureInstrumentation.rowStringifies += 2
  return JSON.stringify(a) === JSON.stringify(b)
}

function firstChangedMessageIndex(before: readonly Message[], after: readonly Message[]): number | undefined {
  const shared = Math.min(before.length, after.length)
  let index = 0
  while (index < shared && equalMessageRows(before[index], after[index])) index++
  if (index === before.length && index === after.length) return undefined
  return index
}

function markFirstChangedIndex(mutation: AssembleMessageMutation, firstChangedIndex: number): AssembleMessageMutation {
  Object.defineProperty(mutation, MESSAGE_MUTATION_FIRST_CHANGED_INDEX, {
    value: firstChangedIndex,
    enumerable: false,
  })
  return mutation
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

function foldStableCardCacheVars(state: AssemblyState): void {
  if (!state.stableCardCache.dirty) return
  state.varChanged = true
  syncWorkingScriptstate(state)
}

function bumpHistoryCallbackMemo(state: Pick<AssemblyState, 'cbsCallbackMemo'>): void {
  bumpAssemblyCbsHistoryGeneration(state.cbsCallbackMemo)
}

function captureMessageReplacement(
  state: AssemblyState,
  source: Exclude<AssembleMutationSource, 'user_message'>,
): void {
  const before = state.messageMutationCheckpoint ?? []
  const afterRows = state.currentChat.message ?? []
  assemblyMessageCaptureInstrumentation.messageReplacementComparisons++
  const firstChangedIndex = firstChangedMessageIndex(before, afterRows)
  if (firstChangedIndex === undefined) return

  const after = cloneMessages(afterRows, 'messageReplacement')

  state.messageMutations?.push(
    markFirstChangedIndex(
      {
        type: 'replace_all',
        source,
        beforeLength: before.length,
        afterLength: after.length,
        messages: after,
      },
      firstChangedIndex,
    ),
  )
  recordMessageReplacementCapture(source)
  state.messageMutationCheckpoint = after
  bumpHistoryCallbackMemo(state)
}

function setMessageMutationCheckpointRow(state: AssemblyState, index: number, message: Message): void {
  const checkpoint = state.messageMutationCheckpoint ?? []
  const next = checkpoint.slice()
  next[index] = message
  state.messageMutationCheckpoint = next
}

function appendUserMessageRow(state: AssemblyState): void {
  const userMessage = state.input.userMessage
  if (state.input.mode !== 'send' || typeof userMessage !== 'string') return

  const messages = (state.currentChat.message ??= [])
  const lastIndex = messages.length - 1
  const lastMessage = messages[lastIndex]
  if (lastMessage?.role === 'user' && lastMessage.data === userMessage && (lastMessage.name ?? null) === null) {
    const message = {
      ...structuredClone(lastMessage),
      chatId: lastMessage.chatId ?? randomUUID(),
      time: lastMessage.time ?? Date.now(),
      name: null as unknown as undefined,
    } as Message
    messages[lastIndex] = message
    const checkpointMessage = structuredClone(message) as Message
    state.messageMutations?.push({
      type: 'append',
      source: 'user_message',
      index: lastIndex,
      message: checkpointMessage,
    })
    setMessageMutationCheckpointRow(state, lastIndex, checkpointMessage)
    bumpHistoryCallbackMemo(state)
    return
  }

  const message = {
    role: 'user',
    data: userMessage,
    time: Date.now(),
    chatId: randomUUID(),
    name: null as unknown as undefined,
  } as Message
  const index = messages.length
  messages.push(message)
  const checkpointMessage = structuredClone(message) as Message
  state.messageMutations?.push({
    type: 'append',
    source: 'user_message',
    index,
    message: checkpointMessage,
  })
  setMessageMutationCheckpointRow(state, index, checkpointMessage)
  bumpHistoryCallbackMemo(state)
}

/**
 * Submit-time **input trigger**, ported from the browser chat-screen submit
 * handler. It runs over the transcript **without the new user message**, so when
 * the loaded transcript already ends with the new user text we exclude that last
 * row for the trigger run and let {@link appendUserMessageRow} re-add it.
 *
 * The trigger's `triggerlua` effects run on the server Lua VM via the injected
 * `runLua` seam ({@link runServerLua}, mode `'input'` → the Lua `onInput`),
 * `lowLevelAccess` inherited from the trigger. Var writes propagate through the
 * trigger's `createTriggerVarEngine` onto the db chat scriptstate, so the route's
 * chat-var delta picks them up exactly like a `'start'` trigger's.
 *
 * To preserve byte-parity for the overwhelming trigger-less case (every existing
 * fixture), the rewritten transcript is adopted **only when the trigger actually
 * changed it**; otherwise the loaded transcript is left untouched so
 * `appendUserMessageRow`'s dedup path is unchanged.
 */
async function runInputTrigger(state: AssemblyState): Promise<void> {
  if (state.input.mode !== 'send') return
  const { currentChar } = state
  const db = state.database

  const rawUserMessage = state.input.userMessage
  const messages = state.currentChat.message ?? []
  const lastIndex = messages.length - 1
  const lastMessage = messages[lastIndex]
  const lastIsNewUser =
    typeof rawUserMessage === 'string' &&
    lastMessage?.role === 'user' &&
    lastMessage.data === rawUserMessage &&
    (lastMessage.name ?? null) === null
  const priorMessages = lastIsNewUser ? messages.slice(0, lastIndex) : messages.slice()

  const triggerCtx: TriggerRunContext = {
    modules: getActiveModules(db, currentChar, state.currentChat),
    model: db.aiModel,
    database: db,
    selectedCharID: state.selectedCharID,
    chatPage: state.chatPage,
    signal: state.signal,
    runLua: async ({ code, mode, lowLevelAccess, chat, varEngine }) => {
      const result = await runServerLua(
        { code, mode, lowLevelAccess },
        {
          chat,
          database: db,
          selectedCharID: state.selectedCharID,
          chatPage: state.chatPage,
          varEngine,
          char: currentChar,
          model: db.aiModel,
          signal: state.signal,
          execBudget: state.luaExecBudget,
        },
      )
      throwServerLuaFailure(result, `Lua ${mode} trigger failed`)
      // The host fns mutate `chat` in place (its `.message` array is reassigned by
      // cutChat/setFullChat etc.), so the same reference carries the edits back.
      return { chat, stopSending: result.stopSending }
    },
  }

  const result = await runTrigger(triggerCtx, currentChar, 'input', {
    chat: { ...state.currentChat, message: priorMessages },
  })
  if (!result) return

  // Var writes already propagated to the db chat scriptstate; fold the flag so
  // the route persists the delta.
  state.varChanged = !!state.varChanged || result.varChanged
  syncWorkingScriptstate(state)

  // Adopt the rewritten transcript only on a real change (parity-preserving for
  // trigger-less chars). The user message — excluded above — is re-added by
  // `appendUserMessageRow`, mirroring the browser's `cha.push(...)` after the
  // trigger.
  const rewritten = result.chat.message ?? []
  if (firstChangedMessageIndex(priorMessages, rewritten) !== undefined) {
    state.currentChat = result.chat
    state.inputTriggerRewroteTranscript = true
    captureMessageReplacement(state, 'input_trigger')
  }
}

/**
 * Submit-time **`editinput`** transform of the just-appended user message,
 * ported from the browser's `processScript(char, messageInput, 'editinput')`
 * (`DefaultChatScreen.svelte:240` → `scripts.ts::processScriptFull`). Mirrors
 * `processScriptFull`'s order for the user text: the Lua `editInput` hook
 * (`runLuaEditTrigger(char,'editinput',…)`) → CBS expansion (the
 * `risuChatParser` at `scripts.ts:160`) → the regex `editinput` scripts
 * ({@link processScript}). `chatID` is `-1` (submit-time; the SPA default).
 *
 * The transform applies in place to the last (user) row that
 * `appendUserMessageRow` produced, whose `.data` is still the raw submitted text.
 * Lua var writes during the hook fold into the chat-var delta the same way the
 * `editRequest` hook's do. A no-op transform leaves the row (and the mutation
 * stream) untouched.
 */
async function applyEditInput(state: AssemblyState): Promise<void> {
  if (state.input.mode !== 'send') return
  const rawUserMessage = state.input.userMessage
  if (typeof rawUserMessage !== 'string') return

  const messages = state.currentChat.message ?? []
  const lastMessage = messages[messages.length - 1]
  // Only the freshly-submitted user row (still carrying the raw text) is edited.
  if (lastMessage?.role !== 'user' || (lastMessage.name ?? null) !== null || lastMessage.data !== rawUserMessage) {
    return
  }

  const { editCtx, varEngine } = buildLuaEditTriggerContext(state)
  let text = await runLuaEditTrigger(state.currentChar, 'editinput', rawUserMessage, { index: -1 }, editCtx)
  text = expandVariables(text, { ...state.ctx, chara: state.currentChar }).text
  text = await processScriptAsync(state.ctx, state.currentChar, text, 'editinput', {}, -1, state.currentChat)

  if (varEngine.varChanged) {
    state.varChanged = true
    syncWorkingScriptstate(state)
  }

  if (text === rawUserMessage) return
  lastMessage.data = text
  state.editInputTransformed = true
  captureMessageReplacement(state, 'editinput')
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
    throw new EntityNotFoundError(`regenerate target must be an assistant message: ${regenerateMessageId}`)
  }
  if (targetIndex !== messages.length - 1) {
    throw new EntityNotFoundError(`regenerate target must be the latest assistant message: ${regenerateMessageId}`)
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

export { isRisuChatParserFixedPoint as isRunVarParserFixedPoint } from './parserFixedPoint.js'

export function applyCurrentChatRunVars(
  state: AssemblyState,
  options: {
    captureMessageMutation?: boolean
    expandVariablesForRunVar?: typeof expandVariables
  } = {},
): void {
  const expandRunVar = options.expandVariablesForRunVar ?? expandVariables
  let beforeScriptstate: Record<string, string | number | boolean> | undefined
  let chatVarDirty = false
  let messageDirty = false
  const messages = (state.currentChat.message ??= [])
  // Invariant across the loop the expand context never varies per
  // row, so build it once instead of re-spreading per message.
  const expandCtx: ExpandContext = { ...state.ctx, chara: state.currentChar, runVar: true }
  for (const message of messages) {
    const original = message.data
    const text = message.data ?? ''
    if (isRisuChatParserFixedPoint(text)) {
      // Skip the O(length) parse for marker-free prose; keep the historical
      // `undefined -> ''` coercion the full pass performed.
      message.data = text
      messageDirty ||= original !== text
      continue
    }
    beforeScriptstate ??= currentPersistedScriptstateSnapshot(state)
    const result = expandRunVar(text, expandCtx)
    message.data = result.text
    messageDirty ||= original !== result.text
    chatVarDirty ||= result.dirty
  }
  if (chatVarDirty) {
    state.varChanged = true
    syncWorkingScriptstate(state)
    if (!messageDirty && beforeScriptstate && persistedScriptstateChangedSince(state, beforeScriptstate)) {
      bumpHistoryCallbackMemo(state)
    }
  }
  if (messageDirty) {
    if (options.captureMessageMutation === false) {
      bumpHistoryCallbackMemo(state)
    } else {
      captureMessageReplacement(state, 'run_var')
    }
  }
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

export function buildRestorationPayload(state: AssemblyState): AssembleRestorationPayload {
  const scriptstate = structuredClone(state.initialScriptstate ?? {})
  return {
    chatId: state.input.chatId,
    characterId: state.input.characterId,
    selectedCharID: state.selectedCharID,
    chatPage: state.chatPage,
    messages: state.initialMessages ?? [],
    scriptstate: Object.keys(scriptstate).length > 0 ? scriptstate : undefined,
  }
}

/**
 * Snapshot the submit-time transcript right after the input trigger + `editinput`
 * rewrite, before `applyCurrentChatRunVars`. The route persists this when
 * {@link submitTranscriptChanged}.
 */
function captureSubmitTranscript(state: AssemblyState): void {
  if (!submitTranscriptChanged(state)) return
  state.submitMessages = cloneMessages(state.currentChat.message ?? [], 'submitTranscript')
}

/**
 * The route owns the post-`editinput` transcript write only when a submit hook
 * changed the transcript. Plain sends leave message persistence to the browser.
 */
function submitTranscriptChanged(state: AssemblyState): boolean {
  return !!state.inputTriggerRewroteTranscript || !!state.editInputTransformed
}

/**
 * Fill the static/plain slots on the `AssemblyState`, mutating
 * `state.unformated` in place. Mirrors `index.svelte.ts:192-204`:
 *   - plain sections (`main` / `jailbreak` / `globalNote`) only on the
 *     non-utility, non-template path,
 *   - `authorNote`, the chain-of-thought into `postEverything`,
 *     `description`, `personaPrompt`, and the image-gen / emotion view
 *     instruction into `postEverything` always.
 *
 * Sync — every leaf is sync. `buildInlayViewInstruction` mirrors the SPA's
 * push at `sendChatPromptAssembly.ts:114` (after the chain-of-thought row, so
 * `postEverything` stays ordered `[cot, inlayView, …promptend]`).
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
  unformated.postEverything.push(...buildInlayViewInstruction(currentChar))
}

/**
 * Activate the lorebook, distribute the activated entries into the slots, build
 * the `positionParser` + `depthPrompts`, and run the
 * template-wide token preflight. Mirrors `index.svelte.ts:206-225`.
 *
 * Runs after `fillStaticSlots` so the `before_desc` / `after_desc`
 * placement sees the static description row and the preflight tokenizes
 * the now-full slots. Mutates the lorebook fields on `state`.
 */
function applyLorebookReport(
  state: AssemblyState,
  report: LorebookActivationReport,
  stickyChatVarDirty: boolean,
): void {
  const { ctx, currentChar, unformated, promptTemplate, usingPromptTemplate } = state
  const db = state.database
  if (stickyChatVarDirty) {
    state.varChanged = true
    syncWorkingScriptstate(state)
    bumpHistoryCallbackMemo(state)
  }

  const { positionParser, depthPrompts } = buildLorebookContext(ctx, currentChar, report, unformated)

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
    stableCardCache: state.stableCardCache,
  })
  currentTokens += preflight.addedTokens
  foldStableCardCacheVars(state)

  state.report = report
  state.positionParser = positionParser
  state.depthPrompts = depthPrompts
  state.currentTokens = currentTokens
  state.memoryCardUsed = preflight.memoryCardUsed
  state.hasCachePoint = preflight.hasCachePoint
}

export function fillLorebookSlots(state: AssemblyState): void {
  const { currentChar, currentChat } = state
  const db = state.database
  let stickyChatVarDirty = false

  const report = activateLorebook({
    database: db,
    currentChar,
    currentChat,
    model: db.aiModel,
    writeChatVar: (key, value) => {
      const persisted = currentPersistedChat(state)
      if (!persisted) return
      persisted.scriptstate ??= {}
      const stateKey = '$' + key
      if (persisted.scriptstate[stateKey] === value) return
      persisted.scriptstate[stateKey] = value
      stickyChatVarDirty = true
    },
  })

  applyLorebookReport(state, report, stickyChatVarDirty)
}

export async function fillLorebookSlotsAsync(state: AssemblyState): Promise<void> {
  const { currentChar, currentChat } = state
  const db = state.database
  let stickyChatVarDirty = false

  const report = await activateLorebookAsync({
    database: db,
    currentChar,
    currentChat,
    model: db.aiModel,
    writeChatVar: (key, value) => {
      const persisted = currentPersistedChat(state)
      if (!persisted) return
      persisted.scriptstate ??= {}
      const stateKey = '$' + key
      if (persisted.scriptstate[stateKey] === value) return
      persisted.scriptstate[stateKey] = value
      stickyChatVarDirty = true
    },
  })

  applyLorebookReport(state, report, stickyChatVarDirty)
}

/**
 * Run the async history window,
 * mutating `state` in place. Mirrors `index.svelte.ts:227-241` (history)
 * and related history-side effects. Runs after `fillLorebookSlots` so `state.report`
 * feeds the depth-prompt token preflight inside `buildHistoryWindow`.
 *
 * The start trigger inside `buildHistoryWindow` may mutate the chat, so
 * its results (`currentChat` / `triggerResult` / `varChanged`) are
 * threaded back regardless of outcome — the route persists when
 * `varChanged` is true. On `stopSending` the function short-circuits
 * (matching the SPA's `return false` at `:236-238`): the history rows are
 * incomplete, so they are not captured.
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
  const promptAssetTable =
    state.promptAssetTable ??
    state.assetLookup?.assetTable ??
    buildPromptAssetTable({
      database: db,
      currentChar,
      currentChat: state.currentChat,
    })
  state.promptAssetTable = promptAssetTable
  state.assetLookup ??= buildAssetLookup({
    database: db,
    currentChar,
    currentChat: state.currentChat,
    inlayAssets: state.input.inlayAssets,
    inlayAssetRefs: state.input.inlayAssetRefs,
    resolveStoredAsset: state.resolveStoredAsset,
    assetTable: promptAssetTable,
  })

  // Lua `editprocess` wires each first-message / per-message body through the
  // runtime, mirroring the SPA's leading `runLuaEditTrigger`. It is a browser
  // no-op, so this is identity at parity; routing it through the runtime keeps the
  // server faithful if the browser's behavior ever changes. No `varChanged` fold
  // is needed (unlike `buildLuaEditRequest`) precisely because the no-op never
  // writes vars.
  const { editCtx } = buildLuaEditTriggerContext(state)
  const editProcess: EditProcessHook = (content, index) =>
    runLuaEditTrigger(state.currentChar, 'editprocess', content, { index }, editCtx)

  const history = await buildHistoryWindow(
    ctx,
    currentChar,
    state.currentChat,
    usingPromptTemplate,
    state.assetLookup ?? NO_ASSETS,
    state.report,
    editProcess,
    promptAssetTable,
  )

  // The start trigger may have mutated the chat and chat-vars even when
  // it asks to abort, so thread these out before the `stopSending` gate.
  state.currentChat = history.currentChat
  state.triggerResult = history.triggerResult
  state.varChanged = !!state.varChanged || history.varChanged
  syncWorkingScriptstate(state)

  if (history.stopSending === true) {
    state.stopSending = true
    state.abortReason = 'trigger_stop'
    captureMessageReplacement(state, 'start_trigger')
    return
  }
  state.stopSending = false

  state.currentTokens = (state.currentTokens ?? 0) + history.addedTokens
  state.historyMessages = history.messages
  state.preparedDepthPrompts = history.preparedDepthPrompts
  if (history.triggerResult) {
    captureMessageReplacement(state, 'start_trigger')
  }

  // The server dispatch path currently has no provider-level logit-bias
  // contract, so assembly intentionally does not compute or emit bias rows.
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
    state.abortReason = 'history_context_overflow'
    state.inputTokens = state.currentTokens
    return
  }

  state.currentChat = mem.currentChat
  state.memories = mem.memories
  // The SPA root re-tokenizes the rendered prompt, but the post-trim estimate is
  // the honest value for `info` telemetry, so keep it on the state.
  state.currentTokens = mem.currentTokens

  // Lorebook depth-prompt splice (SPA `:275-283`). `applyDepthPrompts`
  // already resolves `{{position::}}` + expands + applies the
  // depth/reverse_depth index math (excluding `depth === 0`, which the
  // template/postEverything path owns).
  if (state.report) {
    applyDepthPrompts(unformated.chats, ctx, currentChar, state.report, state.preparedDepthPrompts)
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
  const { settings } = normalizeHypaV3Settings(
    resolveHypaV3PresetSettings(state.database) as Partial<HypaV3Settings> | null | undefined,
  )
  const chatId = state.currentChat.id ?? state.input.chatId
  const embeddingModel = resolvePromptMemoryEmbeddingModel(state.database)
  const planning = planPromptMemoryChunksForAssembly({
    state,
    memoryDb,
    chatId,
    enabled,
    settings,
  })
  state.promptMemoryChunkPlanningDiagnostics = planning.diagnostics
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
    summarySnapshot: planning.summarySnapshot,
    getSummaryTokenCost: createPromptMemorySummaryTokenCost(state.database),
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

function createPromptMemorySummaryTokenCost(db: Database): (summary: MemorySummary) => number {
  const { encoding } = tokenizerOptionsFromDb(db)
  const fallbackTokenCache = new Map<string, number>()

  return (summary) => {
    if (Number.isFinite(summary.tokens) && summary.tokens > 0) {
      return summary.tokens
    }
    const cached = fallbackTokenCache.get(summary.id)
    if (cached !== undefined) return cached
    const tokens = tokenize(summary.text, encoding)
    fallbackTokenCache.set(summary.id, tokens)
    return tokens
  }
}

function planPromptMemoryChunksForAssembly(input: {
  state: AssemblyState
  memoryDb: DatabaseSync
  chatId: string
  enabled: boolean
  settings: ReturnType<typeof normalizeHypaV3Settings>['settings']
}): { diagnostics: PromptMemoryChunkPlanningDiagnostics; summarySnapshot?: MemorySummarySnapshot } {
  const diagnostics = emptyPromptMemoryChunkPlanningDiagnostics()
  if (!input.enabled) return { diagnostics }

  diagnostics.attempted = true
  let summarySnapshot: MemorySummarySnapshot | undefined
  try {
    const chats = input.state.historyMessages ?? []
    const currentChatMemos = chats.map((chat) => chat.memo).filter(isNonEmptyString)
    summarySnapshot = loadMemorySummarySnapshot(input.memoryDb, { chatId: input.chatId })
    if (!input.settings.preserveOrphanedMemory && currentChatMemos.length > 0) {
      const cleaned = cleanupOrphanedMemoryWithSummarySnapshot(input.memoryDb, {
        chatId: input.chatId,
        currentChatMemos,
        preserveOrphanedMemory: input.settings.preserveOrphanedMemory,
        summarySnapshot,
      })
      diagnostics.cleanup = cleaned.cleanup
      summarySnapshot = cleaned.summarySnapshot
    }

    const summaries = summarySnapshot.summaries.filter((summary) => summary.model === input.settings.summarizationModel)
    const { encoding, options } = tokenizerOptionsFromDb(input.state.database)
    const plan = planStandardHypaV3Memory({
      chats,
      currentTokens: input.state.currentTokens ?? 0,
      maxContextTokens: input.state.database.maxContext ?? 0,
      maxResponseTokens: input.state.database.maxResponse ?? 0,
      settings: input.settings,
      summaries: summaries.map(summaryToHypaV3Ref),
      tokenizeChat: (chat) => tokenizeChat(chat, encoding, options),
      tokenizeSummarizedPrefixChat: (chat) => tokenizeHypaV3PrefixChat(chat, encoding, options),
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
  return { diagnostics, summarySnapshot }
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
  return state.memoryDatabase !== null && state.database.hypaV3 === true && state.currentChar.supaMemory === true
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
 * Shared construction of the VM-backed edit-trigger context the `editRequest`
 * (render) and `editprocess` (history) hooks both run against. The var engine is
 * bound to the working chat + persisted db coordinates so any Lua
 * `setChatVar`/`setState` during a hook flows into the same `chat.scriptstate`
 * the route's chat-var delta reads (`buildChatVarMutations` →
 * `persistAssemblyChatVars`) — picked up for free, exactly like a `'start'`
 * trigger's writes. The caller reads `varEngine.varChanged` to fold the hook's
 * writes into the assembly state. Privileged host fns stay gated off — edit-hook
 * triggers run `lowLevelAccess: false`.
 */
function buildLuaEditTriggerContext(state: AssemblyState): {
  editCtx: ServerLuaEditTriggerContext
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
    signal: state.signal,
    execBudget: state.luaExecBudget,
    moduleTriggers: getModuleTriggers(getActiveModules(db, state.currentChar, state.currentChat)),
  }
  return { editCtx, varEngine }
}

/**
 * Build the VM-backed Lua `editRequest` hook the final render applies over
 * `formated` and the prompt-info capture, mirroring the browser's
 * `runLuaEditTrigger(char, 'editRequest', formated)`.
 *
 * Supplied unconditionally for byte-parity with the browser (which always calls
 * `runLuaEditTrigger`); when the character + active modules declare no
 * `triggerlua` effect the hook is a no-op and no Lua engine boots
 * (`runLuaEditTrigger` only executes `triggerlua` effects). The returned engine
 * (see {@link buildLuaEditTriggerContext}) lets the caller fold the hook's
 * `varChanged` into the assembly state.
 */
function buildLuaEditRequest(state: AssemblyState): {
  editRequest: (rows: OpenAIChat[]) => Promise<OpenAIChat[]>
  varEngine: TriggerVarEngine
  persistedScriptstateChanged: () => boolean
} {
  const { editCtx, varEngine } = buildLuaEditTriggerContext(state)
  let persistedScriptstateChanged = false
  return {
    editRequest: async (rows) => {
      const beforeScriptstate = currentPersistedScriptstateSnapshot(state)
      const result = await runLuaEditTrigger(state.currentChar, 'editRequest', rows, undefined, editCtx)
      persistedScriptstateChanged ||= persistedScriptstateChangedSince(state, beforeScriptstate)
      return result
    },
    varEngine,
    persistedScriptstateChanged: () => persistedScriptstateChanged,
  }
}

/**
 * Render the now-complete slots into the flat prompt and run the budget recheck,
 * mutating `state` in place. Mirrors
 * `index.svelte.ts:306-345`:
 *   - `renderFinalPrompt` over `state.formatOrder` (which already has
 *     `postEverything` appended by `buildFormatOrder`, so it is **not**
 *     re-pushed here), `state.memories`, and `state.positionParser`,
 *     with the `isContinue` marker, and the VM-backed Lua `editRequest`
 *     hook ({@link buildLuaEditRequest}) over both `formated` and the
 *     prompt-info capture, mirroring the browser's `runLuaEditTrigger`;
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
  const render = await measureAssemblyStageAsync(state, 'final_render', () =>
    renderFinalPrompt({
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
      stableCardCache: state.stableCardCache,
    }),
  )
  state.promptText = render.promptText
  foldStableCardCacheVars(state)
  // A Lua `editRequest` hook may have written chat vars; fold its writes into
  // the assembly state so the route persists them (the var engine already wrote
  // through to the db chat scriptstate the delta reads).
  if (lua.varEngine.varChanged) {
    state.varChanged = true
    syncWorkingScriptstate(state)
    if (lua.persistedScriptstateChanged()) {
      bumpHistoryCallbackMemo(state)
    }
  }

  const budget = measureAssemblyStage(state, 'budget', () =>
    finalizeRequestBudget({
      db,
      formated: render.formated,
      maxContextTokens: db.maxContext ?? 0,
      maxResponse: db.maxResponse ?? 0,
    }),
  )
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

function nowMs(): number {
  return performance.now()
}

function roundedDurationMs(startMs: number): number {
  return Math.round((performance.now() - startMs) * 100) / 100
}

function recordAssemblyStageTiming(
  state: Pick<AssemblyState, 'recordAssemblyStageTiming'>,
  stage: PromptAssemblyStage,
  startMs: number,
): void {
  state.recordAssemblyStageTiming?.(stage, roundedDurationMs(startMs))
}

function measureAssemblyStage<T>(
  state: Pick<AssemblyState, 'recordAssemblyStageTiming'>,
  stage: PromptAssemblyStage,
  run: () => T,
): T {
  if (!state.recordAssemblyStageTiming) return run()
  const startedAt = nowMs()
  try {
    return run()
  } finally {
    recordAssemblyStageTiming(state, stage, startedAt)
  }
}

async function measureAssemblyStageAsync<T>(
  state: Pick<AssemblyState, 'recordAssemblyStageTiming'>,
  stage: PromptAssemblyStage,
  run: () => Promise<T>,
): Promise<T> {
  if (!state.recordAssemblyStageTiming) return run()
  const startedAt = nowMs()
  try {
    return await run()
  } finally {
    recordAssemblyStageTiming(state, stage, startedAt)
  }
}

/**
 * Assemble the full prompt payload. Bad request IDs throw `EntityNotFoundError`;
 * a start trigger or budget overflow returns `{ stopSending: true }` rather
 * than throwing.
 */
export async function assemblePrompt(input: AssembleInput, deps: AssembleDeps): Promise<AssembleResult> {
  const state = measureAssemblyStage(
    { recordAssemblyStageTiming: deps.recordAssemblyStageTiming },
    'scope_resolution',
    () => beginAssembly(input, deps),
  )
  state.recordAssemblyStageTiming = deps.recordAssemblyStageTiming
  await measureAssemblyStageAsync(state, 'submit_transforms', async () => {
    prepareRegenerateTranscript(state)
    // The submit-time input trigger runs before the user message is appended;
    // `editinput` then rewrites that user row. This mirrors the browser
    // chat-screen submit handler while the server receives the raw user text.
    await runInputTrigger(state)
    appendUserMessageRow(state)
    await applyEditInput(state)
    captureSubmitTranscript(state)
    applyCurrentChatRunVars(state)
  })
  measureAssemblyStage(state, 'static_plain_slots', () => fillStaticSlots(state))
  await measureAssemblyStageAsync(state, 'lorebook_preflight', () => fillLorebookSlotsAsync(state))
  await measureAssemblyStageAsync(state, 'history_bias', () => fillHistoryAndBias(state))
  measureAssemblyStage(state, 'memory_bridge', () => fillMemoryAndPostHistory(state))
  await renderAndBudget(state)

  if (state.stopSending) {
    return {
      stopSending: true,
      abortReason: state.abortReason ?? 'trigger_stop',
      inputTokens: state.inputTokens,
      mutations: buildMutationPayload(state),
      restoration: buildRestorationPayload(state),
      submitMessages: state.submitMessages,
      submitTranscriptChanged: submitTranscriptChanged(state),
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
      // Carry the full rows on the wire so preview clients can inspect the
      // dispatch payload, not just the lossy `messages` projection.
      formated,
    },
    formated,
    inputTokens: state.inputTokens,
    outputTokens: state.outputTokens,
    mutations: buildMutationPayload(state),
    restoration: buildRestorationPayload(state),
    submitMessages: state.submitMessages,
    submitTranscriptChanged: submitTranscriptChanged(state),
    // Hand the assembler state to the route so post-generation processing can
    // reuse this exact chat/var context after provider dispatch.
    state,
  }
}

// Server post-generation pass.
//
// After the provider produces the completion text, the server runs `editoutput`,
// the pre-trigger run-var pass, and the `'output'` trigger. It derives the
// `chat.scriptstate` delta and final assistant text, and reports whether the
// output trigger requested a resend.
//
// The route persists the scriptstate delta through `persistAssemblyMutations`;
// the final text rides back on the `done` frame. This pass derives against the
// post-assembly scriptstate baseline and never emits a transcript write for the
// appended assistant row.

/** Route inputs for {@link runServerPostGeneration}. */
export interface ServerPostGenerationInput {
  /** The raw provider completion text (pre-`editoutput`). */
  completionText: string
  /** The assistant message id (`generationId`) used to key persistence. */
  generationId: string
  /** `createGenerationInfo` output, stamped onto the appended assistant row. */
  generationInfo?: Record<string, unknown>
  /** Assembled prompt-info, stamped onto the appended assistant row. */
  promptInfo?: Record<string, unknown>
}

/** Result of {@link runServerPostGeneration}. */
export interface ServerPostGenerationResult {
  /** The `editoutput`'d + run-var'd assistant text (server-owned final text). */
  finalText: string
  /** True when `editoutput` / run-var changed the text vs the reformatted completion. */
  textChanged: boolean
  /** The post-gen delta (scriptstate + any output-trigger message surgery). */
  mutations: AssembleMutationPayload
  /** The output trigger requested a resend (`sendAIprompt`). Browser re-issues it. */
  resendChat: boolean
  /** A durable chat-var write occurred; the route persists when true. */
  changed: boolean
}

/** `reformatContent` (`index.svelte.ts:91`) is `.trim()`; mirror it server-side. */
function reformatCompletion(text: string): string {
  return text.trim()
}

/**
 * The `editoutput` transform of the completion text, mirroring
 * `processScriptFull(…, 'editoutput', msgIndex)` (`scripts.ts:121-160`): the Lua
 * `editOutput` hook → CBS expansion → the regex `editoutput` scripts. Identical in
 * shape to `applyEditInput`. pluginV2 stays permanent-unsupported, so its arm is
 * intentionally absent. Lua var writes fold into the chat-var delta.
 */
async function applyEditOutput(state: AssemblyState, text: string, msgIndex: number): Promise<string> {
  const { editCtx, varEngine } = buildLuaEditTriggerContext(state)
  let out = await runLuaEditTrigger(state.currentChar, 'editoutput', text, { index: msgIndex }, editCtx)
  out = expandVariables(out, { ...state.ctx, chara: state.currentChar }).text
  out = await processScriptAsync(state.ctx, state.currentChar, out, 'editoutput', {}, msgIndex, state.currentChat)
  if (varEngine.varChanged) {
    state.varChanged = true
    syncWorkingScriptstate(state)
  }
  return out
}

/**
 * Append (send / regenerate) or extend (continue) the assistant row carrying the
 * `editoutput`'d text, mirroring `consumeStreamResponse` / `applyNonStreamResponse`.
 * For `continue` the trailing assistant row is rewritten in place (keeping its
 * id/metadata so B2's `targetMessageId` replace lands); otherwise a fresh row is
 * pushed with the generation metadata so B2 finds it by `chatId === generationId`.
 */
function appendAssistantRow(
  state: AssemblyState,
  editedText: string,
  input: ServerPostGenerationInput,
  isContinue: boolean,
  continueIndex: number,
): void {
  const messages = (state.currentChat.message ??= [])
  if (isContinue && messages[continueIndex]?.role === 'char') {
    messages[continueIndex] = { ...messages[continueIndex], data: editedText }
    bumpHistoryCallbackMemo(state)
    return
  }
  messages.push({
    role: 'char',
    data: editedText,
    saying: state.currentChar.chaId,
    time: Date.now(),
    chatId: input.generationId,
    ...(input.generationInfo ? { generationInfo: input.generationInfo } : {}),
    ...(input.promptInfo ? { promptInfo: input.promptInfo } : {}),
  } as Message)
  bumpHistoryCallbackMemo(state)
}

/**
 * The `'output'` trigger over the post-generation transcript, mirroring
 * `applyOutputTrigger` (`postGeneration/outputTrigger.ts:29`) and reusing the
 * input-trigger wiring (the Lua VM seam, the var-engine writethrough).
 * `setvar`/`v2SetVar` arms fold into the chat-var delta; a transcript rewrite is
 * captured as an `output_trigger` message mutation (surfaced for the projection,
 * not persisted here). Returns the trigger's resend request (`sendAIprompt`).
 */
async function runOutputTrigger(state: AssemblyState): Promise<boolean> {
  const { currentChar } = state
  const db = state.database
  const triggerCtx: TriggerRunContext = {
    modules: getActiveModules(db, currentChar, state.currentChat),
    model: db.aiModel,
    database: db,
    selectedCharID: state.selectedCharID,
    chatPage: state.chatPage,
    signal: state.signal,
    runLua: async ({ code, mode, lowLevelAccess, chat, varEngine }) => {
      const result = await runServerLua(
        { code, mode, lowLevelAccess },
        {
          chat,
          database: db,
          selectedCharID: state.selectedCharID,
          chatPage: state.chatPage,
          varEngine,
          char: currentChar,
          model: db.aiModel,
          signal: state.signal,
          execBudget: state.luaExecBudget,
        },
      )
      throwServerLuaFailure(result, `Lua ${mode} trigger failed`)
      return { chat, stopSending: result.stopSending }
    },
  }

  const result = await runTrigger(triggerCtx, currentChar, 'output', { chat: state.currentChat })
  if (!result) return false

  state.varChanged = !!state.varChanged || result.varChanged
  syncWorkingScriptstate(state)
  state.currentChat = result.chat
  // No-op when the trigger left the transcript untouched.
  captureMessageReplacement(state, 'output_trigger')
  return !!result.sendAIprompt
}

/** Read the assistant text back after run-var + the output trigger may have run. */
function assistantTextAfterPass(
  state: AssemblyState,
  input: ServerPostGenerationInput,
  isContinue: boolean,
  continueIndex: number,
  fallback: string,
): string {
  const messages = state.currentChat.message ?? []
  if (isContinue) {
    return messages[continueIndex]?.data ?? fallback
  }
  const byId = messages.find((message) => message.chatId === input.generationId)
  return byId?.data ?? messages.at(-1)?.data ?? fallback
}

/**
 * Run the server post-generation pass over the provider's completion text. Reuses
 * the assembler state from {@link assemblePrompt} (handed back on `AssembleResult.state`).
 * See the section header above for the full contract.
 */
export async function runServerPostGeneration(
  state: AssemblyState,
  input: ServerPostGenerationInput,
): Promise<ServerPostGenerationResult> {
  const isContinue = state.input.mode === 'continue'
  const messages = (state.currentChat.message ??= [])
  const continueIndex = messages.length - 1
  const continueBase =
    isContinue && messages[continueIndex]?.role === 'char' ? (messages[continueIndex].data ?? '') : ''
  const editIndex = isContinue ? continueIndex : messages.length

  // Baseline the post-gen delta against the post-assembly scriptstate (the route
  // already persisted the assembly-time delta), and clear the assembly-time
  // mutation accumulators so the payload carries only post-gen writes.
  state.initialScriptstate = cloneScriptstate(currentPersistedChat(state)?.scriptstate)
  state.varChanged = false
  state.messageMutations = []
  state.additionalSystemPromptMutations = []

  const reformatted = reformatCompletion(continueBase + input.completionText)
  const editedText = await applyEditOutput(state, reformatted, editIndex)

  appendAssistantRow(state, editedText, input, isContinue, continueIndex)

  // The run-var pass rewrites the assistant body (stripping `{{setvar}}` etc.); that
  // rewrite is the *final text*, surfaced on `done`, not a transcript mutation.
  // Re-baseline once after the pass so any later output-trigger edit is isolated.
  applyCurrentChatRunVars(state, { captureMessageMutation: false })
  state.messageMutations = []
  state.messageMutationCheckpoint = cloneMessages(state.currentChat.message ?? [], 'postGenerationCheckpoint')

  const resendChat = await runOutputTrigger(state)

  const finalText = assistantTextAfterPass(state, input, isContinue, continueIndex, editedText)
  const mutations = buildMutationPayload(state)
  const changed = mutations.varChanged || mutations.chatVarMutations.length > 0

  return {
    finalText,
    textChanged: finalText !== reformatted,
    mutations,
    resendChat,
    changed,
  }
}
