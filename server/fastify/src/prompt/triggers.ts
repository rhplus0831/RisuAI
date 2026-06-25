import type { Chat, Database, character } from '../../../../src/ts/storage/database.svelte'
import type { RisuModule } from '../../../../src/ts/process/modules'
import type { additonalSysPrompt, triggerCondition, triggerscript } from '../../../../src/ts/process/triggers'
import { parseKeyValue } from '../../../../src/ts/util/parseKeyValue'
import { getActiveModules, getModuleTriggers } from './modules.js'
import {
  compileBoundedRegex,
  compileBoundedRegexWithCompatibility,
  complexRegexCompatibilityOptions,
  testBoundedRegex,
  testBoundedRegexWithCompatibility,
} from './boundedRegex.js'
import { encodingForModel, tokenize } from './tokens.js'
import { createTriggerVarEngine, type TriggerVarEngine } from './triggerVars.js'
import { applyV2DataEffectAsync } from './triggerDataEffects.js'
import { expandVariables, type ExpandContext } from './variables.js'
import { runServerLua, throwServerLuaFailure } from './luaRuntime.js'
import {
  attachTriggerSource,
  getTriggerSource,
  withTriggerEffectSource,
  type TriggerSourceAttribution,
} from './triggerSource.js'
import {
  createTriggerRunCache,
  getCachedTriggerRegex,
  getRecentTranscriptLower,
  getRecentTranscriptRaw,
  getRecentTranscriptStrictWords,
  invalidateTriggerTranscriptCache,
  type TriggerRunCache,
} from './triggerRunCache.js'

/**
 * Trigger model + runner shell, ported from the Svelte-bound `runTrigger` in
 * `src/ts/process/triggers.ts`.
 *
 * The runner aggregates module triggers, filters by mode/manual name, evaluates
 * conditions through the request-local variable engine, and returns the SPA
 * result shape without reading Svelte stores. Supported V1 arms are `setvar`,
 * `systemprompt`, `impersonate`, `cutchat`, `modifychat`, `stop`, and bounded
 * `runtrigger` recursion.
 *
 * The V2 effect loop is index-based so control flow can advance / rewind
 * `index`. Ported arms: `v2Header` / `v2Comment` /
 * `v2ConsoleLog` (no-ops), `v2SetVar` (adds `%=`), `v2DeclareLocalVar`,
 * `v2If` / `v2IfAdvanced` (incl. the `∈` / `∋` / `∌` / `≒` / `≡`
 * operators with fail-skip to `v2EndIndent` / `v2Else`), `v2Else`,
 * `v2EndIndent` (loop-back when `endOfLoop`, `clearLocalVarsAtIndent`,
 * the `loopTimes > 100` lag guard), `v2Loop` / `v2LoopNTimes`,
 * `v2BreakLoop`, `v2StopTrigger`, `v2StopPromptSending`, bounded
 * `v2RunTrigger` (manual name from `effect.target`), and the
 * deterministic V2 state effects `v2CutChat` / `v2ModifyChat` /
 * `v2SystemPrompt` / `v2Impersonate`.
 *
 * V2 data helpers, display/request state effects, and start-trigger handoff
 * run through the injected helpers below.
 *
 * Browser-only and persistent-resource effects fall through the `switch` as
 * no-ops: `command` and the
 * `lowLevelAccess`-gated `showAlert` / `runLLM` / `checkSimilarity` /
 * `extractRegex` / `runImgGen` arms, plus browser plugin trigger code
 * (`triggercode`). These bypass the mode filter in the SPA
 * (`triggers.ts:1343`) so they are still *selected* here for parity, but
 * no code runs for them. The `sendAIprompt` / `v2SendAIprompt` effects are
 * supported by setting the result flag; the client/browser owns the resend.
 *
 * `triggerlua` runs the server Lua VM via the injected
 * {@link TriggerRunContext.runLua} seam. Input, output, and start-trigger
 * handoffs supply that runner, while direct tests may still omit it to exercise
 * the no-op fall-through. It bypasses the mode filter, so it is selected in
 * every run mode but only executes when a runner is injected.
 */

/** SPA `triggerMode` (`src/ts/process/triggers.ts:222`, unexported). */
export type TriggerMode = 'start' | 'manual' | 'output' | 'input' | 'display' | 'request'

/**
 * Arguments handed to the {@link TriggerRunContext.runLua} VM seam for a
 * `triggerlua` effect, mirroring the SPA's `runScripted(effect.code, {...})`
 * call (`src/ts/process/triggers.ts:1696-1703`): the user Lua `code`, the run
 * `mode` (`'manual'` resolves to the manual name), the trigger's
 * `lowLevelAccess`, and the working `chat` + variable engine the host fns bind
 * to so var/message writes thread through the same state.
 */
export interface TriggerLuaRunArgs {
  code: string
  mode: string
  lowLevelAccess: boolean
  chat: Chat
  varEngine: TriggerVarEngine
  source?: TriggerSourceAttribution
}

/** Result of a {@link TriggerRunContext.runLua} call: the (in-place mutated)
 * working chat and whether the script asked to stop the send. */
export interface TriggerLuaRunResult {
  chat: Chat
  stopSending: boolean
}

/**
 * Svelte-free DI seam replacing the SPA's store reads
 * (`getDatabase()` / `getCurrentChat()` / `getCurrentCharacter()` /
 * `selectedCharID` / `CurrentTriggerIdStore`).
 *
 * Carries the active module list, model id, database selection scope, and helper
 * seams used by condition evaluation and effect handlers.
 */
export interface TriggerRunContext {
  modules: RisuModule[]
  model?: string | null
  database: Database
  /** Index into `database.characters`; the scope `setVar` persists into. */
  selectedCharID: number
  /** Index into the selected character's `chats`. */
  chatPage: number
  /** Originating request/durable-job abort signal. */
  signal?: AbortSignal
  /**
   * Shared JS trigger interpreter budget. Recursive trigger calls reuse this
   * object so low-level scripts cannot reset the wall clock or iteration caps.
   */
  triggerBudget?: TriggerExecutionBudget
  /**
   * VM runner for `triggerlua` effects. When provided, a `triggerlua` effect
   * runs the server Lua VM; when absent, it stays the no-op fall-through it was
   * before. See the `case 'triggerlua'` arm in {@link runTrigger}.
   */
  runLua?: (args: TriggerLuaRunArgs) => Promise<TriggerLuaRunResult>
}

/**
 * Mirrors the SPA `runTrigger` `arg` object
 * (`src/ts/process/triggers.ts:1173-1183`). `recursiveCount` and
 * `triggerId` are threaded explicitly here instead of through
 * `CurrentTriggerIdStore`.
 */
export interface TriggerRunArg {
  chat: Chat
  recursiveCount?: number
  additonalSysPrompt?: additonalSysPrompt
  stopSending?: boolean
  manualName?: string
  triggerId?: string
  displayMode?: boolean
  displayData?: string
  tempVars?: Record<string, string>
  triggerBudget?: TriggerExecutionBudget
  triggerCache?: TriggerRunCache
}

/**
 * SPA `runTrigger` return shape (`triggers.ts:3341-3349`), plus
 * `varChanged`. The SPA signals a chat-var write by bumping
 * `ReloadGUIPointer` (browser-only); the server instead returns
 * `varChanged` so the route can decide whether to persist the
 * database, matching the `expandVariables` → `dirty` → `applyImport`
 * pattern.
 */
export interface TriggerRunResult {
  additonalSysPrompt: additonalSysPrompt
  chat: Chat
  tokens: number
  stopSending: boolean
  sendAIprompt: boolean
  displayData: string | undefined
  tempVars: Record<string, string> | undefined
  varChanged: boolean
}

/**
 * Effect-type allowlists for the `display` / `request` run modes, ported
 * verbatim from `src/ts/process/triggers.ts:1099-1146`. In those modes
 * only allowlisted effects run; everything else is skipped.
 *
 * `safeSubset` deliberately omits `v2Loop` (only `v2LoopNTimes` is
 * allowed), the dict ops, message readers, `v2Tokenize`, and
 * `v2QuickSearchChat`. The control-flow ops it *does* include keep
 * loop/if structure intact when non-allowlisted effects are skipped.
 */
const safeSubset = [
  'v2SetVar',
  'v2If',
  'v2IfAdvanced',
  'v2Else',
  'v2EndIndent',
  'v2LoopNTimes',
  'v2BreakLoop',
  'v2ConsoleLog',
  'v2StopTrigger',
  'v2Random',
  'v2ExtractRegex',
  'v2RegexTest',
  'v2GetCharAt',
  'v2GetCharCount',
  'v2ToLowerCase',
  'v2ToUpperCase',
  'v2SetCharAt',
  'v2SplitString',
  'v2JoinArrayVar',
  'v2ConcatString',
  'v2MakeArrayVar',
  'v2GetArrayVarLength',
  'v2GetArrayVar',
  'v2SetArrayVar',
  'v2PushArrayVar',
  'v2PopArrayVar',
  'v2ShiftArrayVar',
  'v2UnshiftArrayVar',
  'v2SpliceArrayVar',
  'v2SliceArrayVar',
  'v2GetIndexOfValueInArrayVar',
  'v2RemoveIndexFromArrayVar',
  'v2Calculate',
  'v2Comment',
  'v2DeclareLocalVar',
]

const displayAllowList = ['v2GetDisplayState', 'v2SetDisplayState', ...safeSubset]

const requestAllowList = [
  'v2GetRequestState',
  'v2SetRequestState',
  'v2GetRequestStateRole',
  'v2SetRequestStateRole',
  'v2GetRequestStateLength',
  ...safeSubset,
]

type TriggerModeCloneCounts = Record<TriggerMode, number>

interface TriggerCloneInstrumentation {
  fullTranscriptClones: TriggerModeCloneCounts
  messageSharingEnvelopeClones: TriggerModeCloneCounts
}

function zeroTriggerModeCounts(): TriggerModeCloneCounts {
  return {
    start: 0,
    manual: 0,
    output: 0,
    input: 0,
    display: 0,
    request: 0,
  }
}

const triggerCloneInstrumentation: TriggerCloneInstrumentation = {
  fullTranscriptClones: zeroTriggerModeCounts(),
  messageSharingEnvelopeClones: zeroTriggerModeCounts(),
}

export function resetTriggerCloneInstrumentation(): void {
  triggerCloneInstrumentation.fullTranscriptClones = zeroTriggerModeCounts()
  triggerCloneInstrumentation.messageSharingEnvelopeClones = zeroTriggerModeCounts()
}

export function getTriggerCloneInstrumentation(): TriggerCloneInstrumentation {
  return {
    fullTranscriptClones: {
      ...triggerCloneInstrumentation.fullTranscriptClones,
    },
    messageSharingEnvelopeClones: {
      ...triggerCloneInstrumentation.messageSharingEnvelopeClones,
    },
  }
}

const directMessageMutatingEffectTypes = new Set<string>([
  'impersonate',
  'cutchat',
  'modifychat',
  'runtrigger',
  'v2Impersonate',
  'v2CutChat',
  'v2ModifyChat',
  'v2RunTrigger',
  'triggerlua',
])

const knownNonMessageMutatingEffectTypes = new Set<string>([
  'setvar',
  'sendAIprompt',
  'systemprompt',
  'stop',
  'v2Header',
  'v2Comment',
  'v2ConsoleLog',
  'v2SetVar',
  'v2DeclareLocalVar',
  'v2If',
  'v2IfAdvanced',
  'v2Else',
  'v2EndIndent',
  'v2Loop',
  'v2LoopNTimes',
  'v2BreakLoop',
  'v2StopTrigger',
  'v2StopPromptSending',
  'v2SendAIprompt',
  'v2SystemPrompt',
  'v2GetLastMessage',
  'v2GetMessageAtIndex',
  'v2GetMessageCount',
  'v2GetLastUserMessage',
  'v2GetLastCharMessage',
  'v2GetFirstMessage',
  'v2GetCharAt',
  'v2GetCharCount',
  'v2ToLowerCase',
  'v2ToUpperCase',
  'v2SetCharAt',
  'v2SplitString',
  'v2JoinArrayVar',
  'v2ConcatString',
  'v2ReplaceString',
  'v2MakeArrayVar',
  'v2GetArrayVarLength',
  'v2GetArrayVar',
  'v2SetArrayVar',
  'v2PushArrayVar',
  'v2PopArrayVar',
  'v2ShiftArrayVar',
  'v2UnshiftArrayVar',
  'v2SpliceArrayVar',
  'v2SliceArrayVar',
  'v2GetIndexOfValueInArrayVar',
  'v2RemoveIndexFromArrayVar',
  'v2MakeDictVar',
  'v2GetDictVar',
  'v2SetDictVar',
  'v2DeleteDictKey',
  'v2HasDictKey',
  'v2ClearDict',
  'v2GetDictSize',
  'v2GetDictKeys',
  'v2GetDictValues',
  'v2Random',
  'v2Calculate',
  'v2Tokenize',
  'v2RegexTest',
  'v2QuickSearchChat',
  'v2GetDisplayState',
  'v2SetDisplayState',
  'v2GetRequestState',
  'v2SetRequestState',
  'v2GetRequestStateRole',
  'v2SetRequestStateRole',
  'v2GetRequestStateLength',
])

function effectRunsInMode(effectType: string, mode: TriggerMode): boolean {
  if (mode === 'display') {
    return displayAllowList.includes(effectType)
  }
  if (mode === 'request') {
    return requestAllowList.includes(effectType)
  }
  return true
}

function effectMayMutateMessages(effect: triggerscript['effect'][number], mode: TriggerMode): boolean {
  if (!effectRunsInMode(effect.type, mode)) {
    return false
  }
  if (directMessageMutatingEffectTypes.has(effect.type)) {
    return true
  }
  // Unsupported/browser-only arms stay isolated from server-side mutation.
  return !knownNonMessageMutatingEffectTypes.has(effect.type)
}

function selectedTriggersMayMutateMessages(triggers: readonly triggerscript[], mode: TriggerMode): boolean {
  return triggers.some((trigger) => (trigger.effect ?? []).some((effect) => effectMayMutateMessages(effect, mode)))
}

function cloneTriggerCharacterEnvelope(source: character): character {
  return {
    ...source,
    chats: Array.isArray(source.chats) ? source.chats.slice() : source.chats,
  } as character
}

function cloneTriggerChatEnvelope(source: Chat, mode: TriggerMode): Chat {
  triggerCloneInstrumentation.messageSharingEnvelopeClones[mode]++
  const cloned = {
    ...source,
    message: source.message ?? [],
  } as Chat
  if (source.scriptstate) {
    cloned.scriptstate = structuredClone(source.scriptstate)
  }
  return cloned
}

function cloneTriggerChatForRun(
  source: Chat,
  mode: TriggerMode,
  needsPrivateTranscript: boolean,
  hasSelectedTriggers: boolean,
): Chat {
  if (needsPrivateTranscript) {
    triggerCloneInstrumentation.fullTranscriptClones[mode]++
    return structuredClone(source)
  }
  if (hasSelectedTriggers) {
    return cloneTriggerChatEnvelope(source, mode)
  }
  return source
}

export const DEFAULT_TRIGGER_WALL_CLOCK_BUDGET_MS = 3_000
export const DEFAULT_TRIGGER_MAX_EFFECT_STEPS = 100_000
export const DEFAULT_TRIGGER_MAX_LOOP_BACK_EDGES = 10_000
export const DEFAULT_TRIGGER_MAX_RECURSION_DEPTH = 10

type TriggerBudgetStopReason = 'aborted' | 'wallClock' | 'effectSteps' | 'loopBackEdges'

export interface TriggerExecutionBudget {
  startedAtMs: number
  wallClockMs: number
  effectSteps: number
  maxEffectSteps: number
  loopBackEdges: number
  maxLoopBackEdges: number
  maxRecursionDepth: number
  now: () => number
  stoppedReason?: TriggerBudgetStopReason
  logged?: boolean
}

export interface TriggerExecutionBudgetOptions {
  wallClockMs?: number
  maxEffectSteps?: number
  maxLoopBackEdges?: number
  maxRecursionDepth?: number
  now?: () => number
}

export function createTriggerExecutionBudget(opts: TriggerExecutionBudgetOptions = {}): TriggerExecutionBudget {
  const now = opts.now ?? Date.now
  return {
    startedAtMs: now(),
    wallClockMs: opts.wallClockMs ?? DEFAULT_TRIGGER_WALL_CLOCK_BUDGET_MS,
    effectSteps: 0,
    maxEffectSteps: opts.maxEffectSteps ?? DEFAULT_TRIGGER_MAX_EFFECT_STEPS,
    loopBackEdges: 0,
    maxLoopBackEdges: opts.maxLoopBackEdges ?? DEFAULT_TRIGGER_MAX_LOOP_BACK_EDGES,
    maxRecursionDepth: opts.maxRecursionDepth ?? DEFAULT_TRIGGER_MAX_RECURSION_DEPTH,
    now,
  }
}

function emptySysPrompt(): additonalSysPrompt {
  return { start: '', historyend: '', promptend: '' }
}

/** Yield to the event loop; mirrors the SPA loop lag guard (`triggers.ts:1911`). */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (!signal) {
      setTimeout(resolve, ms)
      return
    }
    if (signal.aborted) {
      resolve()
      return
    }
    const onAbort = (): void => {
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function markTriggerStopped(budget: TriggerExecutionBudget, reason: TriggerBudgetStopReason, detail: string): void {
  budget.stoppedReason ??= reason
  if (budget.logged) return
  budget.logged = true
  console.debug(`[prompt.triggers] stopped trigger execution early: ${reason} (${detail})`)
}

function shouldStopTriggerExecution(ctx: TriggerRunContext, budget: TriggerExecutionBudget, detail: string): boolean {
  if (ctx.signal?.aborted) {
    markTriggerStopped(budget, 'aborted', detail)
    return true
  }
  if (budget.stoppedReason) {
    return true
  }
  if (Number.isFinite(budget.wallClockMs) && budget.now() - budget.startedAtMs >= budget.wallClockMs) {
    markTriggerStopped(budget, 'wallClock', detail)
    return true
  }
  return false
}

function chargeTriggerEffectStep(ctx: TriggerRunContext, budget: TriggerExecutionBudget, effectType: string): boolean {
  if (shouldStopTriggerExecution(ctx, budget, `before effect ${effectType}`)) {
    return true
  }
  budget.effectSteps++
  if (budget.effectSteps > budget.maxEffectSteps) {
    markTriggerStopped(budget, 'effectSteps', effectType)
    return true
  }
  return false
}

function chargeTriggerLoopBack(ctx: TriggerRunContext, budget: TriggerExecutionBudget, effectType: string): boolean {
  if (shouldStopTriggerExecution(ctx, budget, `before ${effectType} loop-back`)) {
    return true
  }
  budget.loopBackEdges++
  if (budget.loopBackEdges > budget.maxLoopBackEdges) {
    markTriggerStopped(budget, 'loopBackEdges', effectType)
    return true
  }
  return false
}

/**
 * Aggregates the character's own trigger scripts with the active
 * modules' triggers. Mirrors `triggers.ts:1197-1202`.
 *
 * Divergence from the SPA: the SPA mutates `v.lowLevelAccess` on the
 * character's trigger objects in place. The server clones each entry
 * (`{ ...v, lowLevelAccess }`) so the source `char.triggerscript`
 * objects are never mutated across requests. `getModuleTriggers`
 * already clones the module side.
 */
export function collectTriggers(char: character, modules: RisuModule[]): triggerscript[] {
  const characterLowLevelAccess = char.lowLevelAccess ?? false
  const own: triggerscript[] = (char.triggerscript ?? []).map((v, index) =>
    attachTriggerSource(
      {
        ...v,
        lowLevelAccess: characterLowLevelAccess,
      },
      {
        ownerType: 'character',
        ownerId: char.chaId,
        ownerName: char.name,
        triggerId: (v as { id?: string }).id,
        triggerIndex: index,
        triggerComment: v.comment,
        triggerType: v.type,
        lowLevelAccess: characterLowLevelAccess,
      },
    ),
  )
  return own.concat(getModuleTriggers(modules))
}

/**
 * Trigger selection filter, ported from `triggers.ts:1343-1351`:
 *   - `triggercode` / `triggerlua` first effects bypass the filter (so they
 *     run in every mode). `triggercode` execution stays browser-side (selected
 *     for parity, no-op here); `triggerlua` runs via the VM seam when injected
 *     (submit/start/output Lua paths).
 *   - with a `manualName`, only triggers whose `comment` matches run.
 *   - otherwise the trigger's `type` must equal the run `mode`.
 */
export function matchesTrigger(trigger: triggerscript, mode: TriggerMode, manualName?: string): boolean {
  const firstEffect = trigger.effect?.[0]?.type
  if (firstEffect === 'triggercode' || firstEffect === 'triggerlua') {
    return true
  }
  if (manualName) {
    return trigger.comment === manualName
  }
  return mode === trigger.type
}

/**
 * Evaluates a trigger's `conditions` (`triggers.ts:1353-1440`). All
 * conditions must pass; evaluation short-circuits on the first failure.
 *
 * `var` reads through the variable engine, `value` compares a literal,
 * `chatindex` compares `chat.message.length`, and `exists` scans the
 * last `depth` messages with `strict` / `loose` / `regex` matching.
 * Condition value/var strings are expanded through the injected
 * `expand` (the server `expandVariables` with `runVar: false` in
 * `runTrigger`), keeping effect-free condition checks side-effect-free.
 */
export function evaluateConditions(
  conditions: triggerCondition[],
  engine: TriggerVarEngine,
  chat: Chat,
  expand: (text: string) => string,
  triggerCache?: TriggerRunCache,
): boolean {
  for (const condition of conditions) {
    let pass = true
    if (condition.type === 'var' || condition.type === 'chatindex' || condition.type === 'value') {
      let varValue: string | null =
        condition.type === 'var'
          ? (engine.getVar(condition.var) ?? 'null')
          : condition.type === 'chatindex'
            ? chat.message.length.toString()
            : condition.var

      if (varValue === undefined || varValue === null) {
        pass = false
      } else {
        const conditionValue = expand(condition.value)
        varValue = expand(varValue)
        switch (condition.operator) {
          case 'true':
            if (varValue !== 'true' && varValue !== '1') pass = false
            break
          case '=':
            if (varValue !== conditionValue) pass = false
            break
          case '!=':
            if (varValue === conditionValue) pass = false
            break
          case '>':
            if (Number(varValue) <= Number(conditionValue)) pass = false
            break
          case '<':
            if (Number(varValue) >= Number(conditionValue)) pass = false
            break
          case '>=':
            if (Number(varValue) < Number(conditionValue)) pass = false
            break
          case '<=':
            if (Number(varValue) > Number(conditionValue)) pass = false
            break
          case 'null':
            if (varValue !== 'null') pass = false
            break
        }
      }
    } else if (condition.type === 'exists') {
      const conditionValue = expand(condition.value)
      const val = expand(conditionValue)
      if (condition.type2 === 'strict') {
        pass = triggerCache
          ? getRecentTranscriptStrictWords(triggerCache, chat, condition.depth).has(val)
          : chat.message
              .slice(0 - condition.depth)
              .map((v) => v.data)
              .join(' ')
              .split(' ')
              .includes(val)
      } else if (condition.type2 === 'loose') {
        pass = triggerCache
          ? getRecentTranscriptLower(triggerCache, chat, condition.depth).includes(val.toLowerCase())
          : chat.message
              .slice(0 - condition.depth)
              .map((v) => v.data)
              .join(' ')
              .toLowerCase()
              .includes(val.toLowerCase())
      } else if (condition.type2 === 'regex') {
        const da = triggerCache
          ? getRecentTranscriptRaw(triggerCache, chat, condition.depth)
          : chat.message
              .slice(0 - condition.depth)
              .map((v) => v.data)
              .join(' ')
        const regex = triggerCache
          ? getCachedTriggerRegex(triggerCache, val, '', 'trigger condition regex pattern')
          : compileBoundedRegex(val, '', 'trigger condition regex pattern')
        pass = testBoundedRegex(regex, da, 'trigger condition regex transcript')
      }
    }
    if (!pass) {
      return false
    }
  }
  return true
}

function stageForTriggerMode(mode: TriggerMode) {
  if (mode === 'output') return 'output'
  if (mode === 'display') return 'display'
  return 'input'
}

async function evaluateConditionsAsync(
  conditions: triggerCondition[],
  engine: TriggerVarEngine,
  chat: Chat,
  expand: (text: string) => string,
  triggerCache: TriggerRunCache | undefined,
  mode: TriggerMode,
  database: Database,
): Promise<boolean> {
  const regexCompatibility = complexRegexCompatibilityOptions(database, stageForTriggerMode(mode))
  for (const condition of conditions) {
    let pass = true
    if (condition.type === 'var' || condition.type === 'chatindex' || condition.type === 'value') {
      let varValue: string | null =
        condition.type === 'var'
          ? (engine.getVar(condition.var) ?? 'null')
          : condition.type === 'chatindex'
            ? chat.message.length.toString()
            : condition.var

      if (varValue === undefined || varValue === null) {
        pass = false
      } else {
        const conditionValue = expand(condition.value)
        varValue = expand(varValue)
        switch (condition.operator) {
          case 'true':
            if (varValue !== 'true' && varValue !== '1') pass = false
            break
          case '=':
            if (varValue !== conditionValue) pass = false
            break
          case '!=':
            if (varValue === conditionValue) pass = false
            break
          case '>':
            if (Number(varValue) <= Number(conditionValue)) pass = false
            break
          case '<':
            if (Number(varValue) >= Number(conditionValue)) pass = false
            break
          case '>=':
            if (Number(varValue) < Number(conditionValue)) pass = false
            break
          case '<=':
            if (Number(varValue) > Number(conditionValue)) pass = false
            break
          case 'null':
            if (varValue !== 'null') pass = false
            break
        }
      }
    } else if (condition.type === 'exists') {
      const conditionValue = expand(condition.value)
      const val = expand(conditionValue)
      if (condition.type2 === 'strict') {
        pass = triggerCache
          ? getRecentTranscriptStrictWords(triggerCache, chat, condition.depth).has(val)
          : chat.message
              .slice(0 - condition.depth)
              .map((v) => v.data)
              .join(' ')
              .split(' ')
              .includes(val)
      } else if (condition.type2 === 'loose') {
        pass = triggerCache
          ? getRecentTranscriptLower(triggerCache, chat, condition.depth).includes(val.toLowerCase())
          : chat.message
              .slice(0 - condition.depth)
              .map((v) => v.data)
              .join(' ')
              .toLowerCase()
              .includes(val.toLowerCase())
      } else if (condition.type2 === 'regex') {
        const da = triggerCache
          ? getRecentTranscriptRaw(triggerCache, chat, condition.depth)
          : chat.message
              .slice(0 - condition.depth)
              .map((v) => v.data)
              .join(' ')
        const regex = regexCompatibility.enabled
          ? compileBoundedRegexWithCompatibility(val, '', 'trigger condition regex pattern', regexCompatibility)
          : triggerCache
            ? getCachedTriggerRegex(triggerCache, val, '', 'trigger condition regex pattern')
            : compileBoundedRegex(val, '', 'trigger condition regex pattern')
        pass = regexCompatibility.enabled
          ? await testBoundedRegexWithCompatibility(regex, da, 'trigger condition regex transcript', regexCompatibility)
          : testBoundedRegex(regex as RegExp, da, 'trigger condition regex transcript')
      }
    }
    if (!pass) {
      return false
    }
  }
  return true
}

/**
 * Collects triggers, classifies the selected mode's effects, clones only the
 * inputs that need isolation, evaluates conditions, and returns the SPA result
 * shape.
 *
 * Returns `null` when there are no triggers at all (SPA
 * `triggers.ts:1215-1220`). When triggers exist but none match the
 * mode, a result is still returned (mode mismatch is *ignored*, not a
 * no-op return).
 *
 * In `displayMode` the caller's `char`/`chat` are used directly. Otherwise,
 * effects that can mutate `chat.message` get a private
 * full transcript clone; non-message-mutating trigger sets use a cheap chat
 * envelope clone that shares message rows but keeps scriptstate writes isolated.
 *
 * Parity note: `scriptstate` writes persist through the var engine
 * onto the db chat; `chat.message` edits (impersonate / cutchat /
 * modifychat) live only on the returned `result.chat`, matching the
 * SPA, which does not write message edits back mid-run.
 */
export async function runTrigger(
  ctx: TriggerRunContext,
  char: character,
  mode: TriggerMode,
  arg: TriggerRunArg,
): Promise<TriggerRunResult | null> {
  const budget = arg.triggerBudget ?? ctx.triggerBudget ?? createTriggerExecutionBudget()
  let recursiveCount = arg.recursiveCount ?? 0
  const triggers = collectTriggers(char, ctx.modules)
  if (triggers.length === 0) {
    return null
  }
  const triggerCache = arg.triggerCache ?? createTriggerRunCache()
  const selected = triggers.filter((trigger) => matchesTrigger(trigger, mode, arg.manualName))
  const needsPrivateTranscript = !arg.displayMode && selectedTriggersMayMutateMessages(selected, mode)
  const workingChar = arg.displayMode ? char : cloneTriggerCharacterEnvelope(char)
  const sourceChat = arg.chat ?? workingChar.chats[workingChar.chatPage]
  let stopSending = arg.stopSending ?? false
  let sendAIprompt = false
  let additonalSysPrompt = arg.additonalSysPrompt ?? emptySysPrompt()
  let chat = arg.displayMode
    ? sourceChat
    : cloneTriggerChatForRun(sourceChat, mode, needsPrivateTranscript, selected.length > 0)

  const defaultVariables = parseKeyValue(workingChar.defaultVariables ?? '').concat(
    parseKeyValue(ctx.database.templateDefaultVariables ?? ''),
  )
  const engine = createTriggerVarEngine({
    chat,
    database: ctx.database,
    selectedCharID: ctx.selectedCharID,
    chatPage: ctx.chatPage,
    defaultVariables,
    displayMode: arg.displayMode,
    tempVars: arg.tempVars,
  })
  const expand = (text: string): string =>
    expandVariables(text, {
      database: ctx.database,
      selectedCharID: ctx.selectedCharID,
      chatPage: ctx.chatPage,
      chara: workingChar,
      runVar: false,
    }).text

  let recursionVarChanged = false

  // Mutable holder for the per-run display/request state slot.
  // The state arms read/write `displayState.data`; the SPA mutates
  // `arg.displayData` in place. The result surfaces `displayState.data`.
  const displayState = { data: arg.displayData }

  const buildResult = (): TriggerRunResult => {
    // Terminal additional-system-prompt token accounting
    // (`triggers.ts:3321-3330`). Populated by `systemprompt` effects.
    let tokens = 0
    const encoding = encodingForModel(ctx.model)
    if (additonalSysPrompt.start) tokens += tokenize(additonalSysPrompt.start, encoding)
    if (additonalSysPrompt.historyend) tokens += tokenize(additonalSysPrompt.historyend, encoding)
    if (additonalSysPrompt.promptend) tokens += tokenize(additonalSysPrompt.promptend, encoding)

    return {
      additonalSysPrompt,
      chat,
      tokens,
      stopSending,
      sendAIprompt,
      displayData: displayState.data,
      tempVars: arg.tempVars,
      varChanged: engine.varChanged || recursionVarChanged,
    }
  }

  for (const trigger of selected) {
    if (shouldStopTriggerExecution(ctx, budget, 'before trigger conditions')) {
      return buildResult()
    }
    if (
      !(await evaluateConditionsAsync(trigger.conditions ?? [], engine, chat, expand, triggerCache, mode, ctx.database))
    ) {
      continue
    }

    // Var-or-value resolution shared by the V2 arms (`triggers.ts`):
    // `value` expands the literal; `var` expands then reads the var.
    const resolve = (raw: string, isValue: boolean): string => (isValue ? expand(raw) : engine.getVar(expand(raw)))

    // Per-trigger loop counters for `v2LoopNTimes` + the lag guard
    // (the SPA's inner numeric `tempVars`, `triggers.ts:1341`).
    const loopCounts: Record<string, number> = {}

    // Index-based walk: V2 control flow advances/rewinds `index`.
    const effects = trigger.effect ?? []
    if (shouldStopTriggerExecution(ctx, budget, 'before effect loop')) {
      return buildResult()
    }
    for (let index = 0; index < effects.length; index++) {
      const effect = effects[index]
      if (chargeTriggerEffectStep(ctx, budget, effect.type)) {
        return buildResult()
      }
      // Display/request effect allowlist guards (`triggers.ts:1444-1449`).
      // Skipped effects never touch indent; control flow stays intact
      // because every control-flow op lives in `safeSubset`.
      if (mode === 'display' && !displayAllowList.includes(effect.type)) {
        continue
      }
      if (mode === 'request' && !requestAllowList.includes(effect.type)) {
        continue
      }
      if (effect && 'indent' in effect && typeof effect.indent === 'number' && effect.indent >= 0) {
        engine.setIndent(effect.indent)
      } else if (!effect || !('indent' in effect)) {
        engine.setIndent(0)
      }

      switch (effect.type) {
        case 'setvar': {
          const varKey = expand(effect.var)
          const effectValue = expand(effect.value)
          let originalVar = Number(engine.getVar(varKey))
          if (Number.isNaN(originalVar)) {
            originalVar = 0
          }
          let resultValue = ''
          switch (effect.operator) {
            case '=':
              resultValue = effectValue
              break
            case '+=':
              resultValue = (originalVar + Number(effectValue)).toString()
              break
            case '-=':
              resultValue = (originalVar - Number(effectValue)).toString()
              break
            case '*=':
              resultValue = (originalVar * Number(effectValue)).toString()
              break
            case '/=':
              resultValue = (originalVar / Number(effectValue)).toString()
              break
          }
          engine.setVar(varKey, resultValue)
          break
        }
        case 'systemprompt': {
          additonalSysPrompt[effect.location] += expand(effect.value) + '\n\n'
          break
        }
        case 'impersonate': {
          const effectValue = expand(effect.value)
          if (effect.role === 'user') {
            chat.message.push({ role: 'user', data: effectValue })
            invalidateTriggerTranscriptCache(triggerCache)
          } else if (effect.role === 'char') {
            chat.message.push({ role: 'char', data: effectValue })
            invalidateTriggerTranscriptCache(triggerCache)
          }
          break
        }
        case 'stop':
        case 'v2StopPromptSending': {
          stopSending = true
          break
        }
        case 'sendAIprompt':
        case 'v2SendAIprompt': {
          if (trigger.lowLevelAccess) {
            sendAIprompt = true
          }
          break
        }
        case 'cutchat': {
          const start = Number(expand(effect.start))
          const end = Number(expand(effect.end))
          chat.message = chat.message.slice(start, end)
          invalidateTriggerTranscriptCache(triggerCache)
          break
        }
        case 'modifychat': {
          const index = Number(expand(effect.index))
          const value = expand(effect.value)
          if (chat.message[index]) {
            chat.message[index].data = value
            invalidateTriggerTranscriptCache(triggerCache)
          }
          break
        }
        case 'runtrigger': {
          if (recursiveCount < budget.maxRecursionDepth) {
            recursiveCount++
            const r = await runTrigger(ctx, workingChar, 'manual', {
              chat,
              recursiveCount,
              additonalSysPrompt,
              stopSending,
              manualName: effect.value,
              triggerBudget: budget,
              triggerCache,
            })
            if (r) {
              additonalSysPrompt = r.additonalSysPrompt
              chat = r.chat
              engine.setChat(chat)
              stopSending = r.stopSending
              recursionVarChanged ||= r.varChanged
            }
            if (shouldStopTriggerExecution(ctx, budget, 'after runtrigger')) {
              return buildResult()
            }
          }
          break
        }

        // ---- V2 control flow + deterministic effects ----
        case 'v2Header':
        case 'v2Comment':
        case 'v2ConsoleLog':
        case 'v2Loop':
        case 'v2LoopNTimes': {
          // v2Header / v2Comment: markers. v2ConsoleLog: server no-op.
          // v2Loop / v2LoopNTimes: looping is driven by `v2EndIndent`.
          break
        }
        case 'v2SetVar': {
          const effectValue = resolve(effect.value, effect.valueType === 'value')
          const varKey = expand(effect.var)
          let originalVar = Number(engine.getVar(varKey))
          if (Number.isNaN(originalVar)) {
            originalVar = 0
          }
          let resultValue = ''
          switch (effect.operator) {
            case '=':
              resultValue = effectValue
              break
            case '+=':
              resultValue = (originalVar + Number(effectValue)).toString()
              break
            case '-=':
              resultValue = (originalVar - Number(effectValue)).toString()
              break
            case '*=':
              resultValue = (originalVar * Number(effectValue)).toString()
              break
            case '/=':
              resultValue = (originalVar / Number(effectValue)).toString()
              break
            case '%=':
              resultValue = (originalVar % Number(effectValue)).toString()
              break
          }
          engine.setVar(varKey, resultValue)
          break
        }
        case 'v2DeclareLocalVar': {
          const effectValue = resolve(effect.value, effect.valueType === 'value')
          const varKey = expand(effect.var)
          const finalValue = effectValue === null || effectValue === undefined ? 'null' : effectValue
          engine.declareLocalVar(varKey, finalValue, effect.indent)
          break
        }
        case 'v2If':
        case 'v2IfAdvanced': {
          const sourceValue =
            effect.type === 'v2If' || effect.sourceType === 'var'
              ? engine.getVar(expand(effect.source))
              : expand(effect.source)
          const targetValue =
            effect.targetType === 'value' ? expand(effect.target) : engine.getVar(expand(effect.target))
          let pass = false
          switch (effect.condition) {
            case '=':
              pass =
                !isNaN(Number(sourceValue)) && !isNaN(Number(targetValue))
                  ? Number(sourceValue) === Number(targetValue)
                  : sourceValue === targetValue
              break
            case '!=':
              pass =
                !isNaN(Number(sourceValue)) && !isNaN(Number(targetValue))
                  ? Number(sourceValue) !== Number(targetValue)
                  : sourceValue !== targetValue
              break
            case '>':
              pass = Number(sourceValue) > Number(targetValue)
              break
            case '<':
              pass = Number(sourceValue) < Number(targetValue)
              break
            case '>=':
              pass = Number(sourceValue) >= Number(targetValue)
              break
            case '<=':
              pass = Number(sourceValue) <= Number(targetValue)
              break
            case '∈':
              try {
                pass = JSON.parse(targetValue).includes(sourceValue)
              } catch {
                pass = false
              }
              break
            case '∋':
              try {
                pass = JSON.parse(sourceValue).includes(targetValue)
              } catch {
                pass = false
              }
              break
            case '∌':
              try {
                pass = !JSON.parse(sourceValue).includes(targetValue)
              } catch {
                pass = true
              }
              break
            case '≒': {
              const num1 = Number(sourceValue)
              const num2 = Number(targetValue)
              pass =
                Number.isNaN(num1) || Number.isNaN(num2)
                  ? sourceValue.toLocaleLowerCase().replace(/ /g, '') ===
                    targetValue.toLocaleLowerCase().replace(/ /g, '')
                  : Math.abs(num1 - num2) < 0.0001
              break
            }
            case '≡':
              if (targetValue === 'true') {
                pass = sourceValue === 'true' || sourceValue === '1'
              } else if (targetValue === 'false') {
                pass = !(sourceValue === 'true' || sourceValue === '1')
              } else {
                pass = sourceValue === targetValue
              }
              break
          }

          if (!pass) {
            let indent = effect.indent + 1
            for (; index < effects.length; index++) {
              const ef = effects[index]
              if (ef.type === 'v2EndIndent' && indent === ef.indent) {
                const nextEf = effects[index + 1]
                indent--
                if (nextEf?.type === 'v2Else' && nextEf?.indent === indent) {
                  index++
                }
                break
              }
            }
          }
          break
        }
        case 'v2Else': {
          // The matching `if` already skipped its body here when false,
          // so reaching `v2Else` normally means skip to its `v2EndIndent`.
          const indent = effect.indent + 1
          for (; index < effects.length; index++) {
            const ef = effects[index]
            if (ef.type === 'v2EndIndent' && indent === ef.indent) {
              break
            }
          }
          break
        }
        case 'v2EndIndent': {
          if (effect.endOfLoop) {
            const indent = effect.indent - 1
            const originalIndex = index
            for (; index >= 0; index--) {
              const ef = effects[index]
              if ((ef.type === 'v2Loop' || ef.type === 'v2LoopNTimes') && indent === ef.indent) {
                if (ef.type === 'v2LoopNTimes') {
                  const loopValue = resolve(ef.value, ef.valueType === 'value')
                  let valueNum = Number(loopValue)
                  if (Number.isNaN(valueNum)) {
                    valueNum = 0
                  }
                  const key = index + 'LoopNTimes'
                  loopCounts[key] = (loopCounts[key] ?? 0) + 1
                  if (loopCounts[key] >= valueNum) {
                    index = originalIndex
                  } else {
                    if (chargeTriggerLoopBack(ctx, budget, ef.type)) {
                      return buildResult()
                    }
                    break
                  }
                } else if (chargeTriggerLoopBack(ctx, budget, ef.type)) {
                  return buildResult()
                }
                break
              }
            }

            // Lag guard (`triggers.ts:1908-1913`).
            loopCounts['loopTimes'] = (loopCounts['loopTimes'] ?? 0) + 1
            if (loopCounts['loopTimes'] > 100) {
              await sleep(1, ctx.signal)
              loopCounts['loopTimes'] = 0
              if (shouldStopTriggerExecution(ctx, budget, 'after v2 loop yield')) {
                return buildResult()
              }
            }
          }

          engine.clearLocalVarsAtIndent(effect.indent)
          break
        }
        case 'v2BreakLoop': {
          for (; index < effects.length; index++) {
            const ef = effects[index]
            if (ef.type === 'v2EndIndent' && ef.endOfLoop) {
              break
            }
          }
          break
        }
        case 'v2StopTrigger': {
          index = effects.length
          break
        }
        case 'v2RunTrigger': {
          if (recursiveCount < budget.maxRecursionDepth) {
            recursiveCount++
            const r = await runTrigger(ctx, workingChar, 'manual', {
              chat,
              recursiveCount,
              additonalSysPrompt,
              stopSending,
              manualName: effect.target,
              triggerBudget: budget,
              triggerCache,
            })
            if (r) {
              additonalSysPrompt = r.additonalSysPrompt
              chat = r.chat
              engine.setChat(chat)
              stopSending = r.stopSending
              recursionVarChanged ||= r.varChanged
            }
            if (shouldStopTriggerExecution(ctx, budget, 'after v2RunTrigger')) {
              return buildResult()
            }
          }
          break
        }
        case 'v2CutChat': {
          let start = Number(resolve(effect.start, effect.startType === 'value'))
          let end = Number(resolve(effect.end, effect.endType === 'value'))
          if (Number.isNaN(start)) {
            start = 0
          }
          if (Number.isNaN(end)) {
            end = chat.message.length
          }
          chat.message = chat.message.slice(start, end)
          invalidateTriggerTranscriptCache(triggerCache)
          break
        }
        case 'v2ModifyChat': {
          const targetIndex = Number(resolve(effect.index, effect.indexType === 'value'))
          const value = resolve(effect.value, effect.valueType === 'value')
          if (chat.message[targetIndex]) {
            chat.message[targetIndex].data = value
            invalidateTriggerTranscriptCache(triggerCache)
          }
          break
        }
        case 'v2SystemPrompt': {
          additonalSysPrompt[effect.location] += resolve(effect.value, effect.valueType === 'value') + '\n\n'
          break
        }
        case 'v2Impersonate': {
          const value = resolve(effect.value, effect.valueType === 'value')
          if (effect.role === 'user') {
            chat.message.push({ role: 'user', data: value })
            invalidateTriggerTranscriptCache(triggerCache)
          } else if (effect.role === 'char') {
            chat.message.push({ role: 'char', data: value })
            invalidateTriggerTranscriptCache(triggerCache)
          }
          break
        }
        case 'triggerlua': {
          // Run user Lua under the server VM via the injected seam, mirroring
          // the SPA's `runScripted(effect.code, {...})`
          // (`src/ts/process/triggers.ts:1695-1710`). The runner binds the host
          // fns to `chat` + `engine`, so message/var writes thread through this
          // run's state; it returns the (in-place mutated) chat + stopSending.
          // When no runner is injected (the start-trigger path), this stays a
          // no-op, preserving the fall-through behavior.
          if (ctx.runLua) {
            const luaMode = mode === 'manual' ? (arg.manualName ?? 'manual') : mode
            const r = await ctx.runLua({
              code: (effect as { code: string }).code,
              mode: luaMode,
              lowLevelAccess: trigger.lowLevelAccess ?? false,
              chat,
              varEngine: engine,
              source: withTriggerEffectSource(getTriggerSource(trigger), index, effect.type),
            })
            chat = r.chat
            engine.setChat(chat)
            invalidateTriggerTranscriptCache(triggerCache)
            if (r.stopSending) {
              stopSending = true
            }
            if (shouldStopTriggerExecution(ctx, budget, 'after triggerlua')) {
              return buildResult()
            }
          }
          break
        }
        default: {
          // Safe data helpers (message readers, string / array / dict / math,
          // random, tokenize, regex, quick chat search) plus request/display
          // state arms. Returns false for unsupported arms (`command`; the
          // `lowLevelAccess`-gated alert/LLM/image/similarity/regex; the
          // persistent lorebook / character / persona / note arms;
          // `v2UpdateGUI` / `v2UpdateChatAt` / `v2Wait`; `triggercode`),
          // which fall through as no-ops.
          await applyV2DataEffectAsync(effect, {
            engine,
            expand,
            chat,
            char: workingChar,
            model: ctx.model,
            displayMode: arg.displayMode,
            displayState,
            triggerCache,
            regexCompatibility: complexRegexCompatibilityOptions(ctx.database, stageForTriggerMode(mode)),
          })
          break
        }
      }
    }
  }

  return buildResult()
}

/**
 * Start-trigger handoff. Bridges the prompt-pipeline scope to the richer
 * `TriggerRunContext` and runs the `start` trigger, mirroring the SPA's
 * `runTrigger(char, 'start', { chat })` call inside `buildHistoryWindow`.
 *
 * A `start` run is not `displayMode`, so `runTrigger` deep-clones the
 * char/chat and `setVar` writes persist into the db snapshot; the
 * returned `result.chat` is the mutated clone the history walk re-reads.
 * Returns `null` when the character + active modules declare no
 * triggers at all (the no-op case).
 */
export async function runStartTrigger(
  ctx: ExpandContext,
  char: character,
  chat: Chat,
): Promise<TriggerRunResult | null> {
  const db = ctx.database
  const currentCharIndex = (db as { currentChar?: unknown }).currentChar
  const selectedCharID = ctx.selectedCharID ?? (typeof currentCharIndex === 'number' ? currentCharIndex : 0)
  const chatPage = ctx.chatPage ?? char.chatPage ?? 0
  const modules = getActiveModules(db, char, chat)
  const runCtx: TriggerRunContext = {
    modules,
    model: db.aiModel,
    database: db,
    selectedCharID,
    chatPage,
    signal: ctx.signal,
    runLua: async ({ code, mode, lowLevelAccess, chat: luaChat, varEngine, source }) => {
      const result = await runServerLua(
        { code, mode, lowLevelAccess, source },
        {
          chat: luaChat,
          database: db,
          selectedCharID,
          chatPage,
          varEngine,
          char,
          model: db.aiModel,
          signal: ctx.signal,
          execBudget: ctx.luaExecBudget,
        },
      )
      throwServerLuaFailure(result, `Lua ${mode} trigger failed`)
      return { chat: luaChat, stopSending: result.stopSending }
    },
  }
  return runTrigger(runCtx, char, 'start', { chat })
}
