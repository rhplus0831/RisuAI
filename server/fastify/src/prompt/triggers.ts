import type {
  Chat,
  Database,
  character,
} from '../../../../src/ts/storage/database.svelte'
import type { RisuModule } from '../../../../src/ts/process/modules'
import type {
  additonalSysPrompt,
  triggerCondition,
  triggerscript,
} from '../../../../src/ts/process/triggers'
import { parseKeyValue } from '../../../../src/ts/util/parseKeyValue'
import { getModuleTriggers } from './modules.js'
import { encodingForModel, tokenize } from './tokens.js'
import { createTriggerVarEngine, type TriggerVarEngine } from './triggerVars.js'
import { expandVariables } from './variables.js'

/**
 * Phase 7-9a trigger model + runner shell, ported from the Svelte-bound
 * `runTrigger` in `src/ts/process/triggers.ts` (3350 lines, 151 effect
 * arms).
 *
 * 7-9a established the deterministic, store-free skeleton:
 *   - the trigger type surface and result shape (`TriggerMode`,
 *     `TriggerRunResult`, `TriggerRunArg`, `TriggerRunContext`),
 *   - module-trigger aggregation with inherited `lowLevelAccess`
 *     (`getModuleTriggers` in `./modules.js`),
 *   - the trigger collection + mode/manual-name filter
 *     (`collectTriggers`, `matchesTrigger`),
 *   - the `runTrigger` shell: input cloning, no-match `null` return,
 *     recursion/trigger-id threading via the explicit `arg`/`ctx`
 *     (never `CurrentTriggerIdStore`), and the terminal token
 *     accounting + return shape.
 *
 * 7-9b adds the variable + condition engine: `runTrigger` now builds
 * the char + template `defaultVariables`, constructs the per-run
 * `TriggerVarEngine` (`./triggerVars.js`), and evaluates each selected
 * trigger's `conditions` (`var` / `value` / `chatindex` / `exists`)
 * before its effects would run. Condition strings expand through the
 * server `expandVariables` (`runVar: false`). A failing condition skips
 * the trigger. The result now carries `varChanged` so the caller can
 * decide whether to persist the database.
 *
 * The shell still executes NO effect. Those are the following slices
 * (see `ROADMAP.md`):
 *   - 7-9c: deterministic V1 effects (`setvar`, `systemprompt`,
 *     `impersonate`, `cutchat`, `modifychat`, `stop`, bounded
 *     `runtrigger`).
 *   - 7-9d: V2 control flow + safe data effects.
 *   - 7-9e: request/display state adapters.
 *   - 7-9f: prompt/history effects + `start` trigger handoff.
 *
 * Browser plugin/Lua trigger code (`triggercode` / `triggerlua`),
 * low-level alert/GUI/LLM/image effects, Hypa similarity, and
 * persistent character/persona/lorebook mutation stay deferred per the
 * roadmap boundary. `triggercode` / `triggerlua` triggers bypass the
 * mode filter in the SPA (`triggers.ts:1343`) so they are still
 * *selected* here for parity, but the shell runs no code for them.
 */

/** SPA `triggerMode` (`src/ts/process/triggers.ts:222`, unexported). */
export type TriggerMode =
  | 'start'
  | 'manual'
  | 'output'
  | 'input'
  | 'display'
  | 'request'

/**
 * Svelte-free DI seam replacing the SPA's store reads
 * (`getDatabase()` / `getCurrentChat()` / `getCurrentCharacter()` /
 * `selectedCharID` / `CurrentTriggerIdStore`).
 *
 * 7-9a needs the active module list (trigger aggregation) and the
 * model (terminal token accounting). 7-9b adds the
 * `database`/`selectedCharID`/`chatPage` scope the variable engine
 * persists into and that condition-string expansion reads. Later
 * slices extend this further for the effect handlers.
 */
export interface TriggerRunContext {
  modules: RisuModule[]
  model?: string | null
  database: Database
  /** Index into `database.characters`; the scope `setVar` persists into. */
  selectedCharID: number
  /** Index into the selected character's `chats`. */
  chatPage: number
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

function emptySysPrompt(): additonalSysPrompt {
  return { start: '', historyend: '', promptend: '' }
}

/**
 * Aggregates the character's own trigger scripts with the active
 * modules' triggers. Mirrors `triggers.ts:1197-1202`.
 *
 * Divergence from the SPA: the SPA mutates `v.lowLevelAccess` on the
 * character's trigger objects in place. The server clones each entry
 * (`{ ...v, lowLevelAccess }`) so the source `char.triggerscript`
 * objects are never mutated across requests. `getModuleTriggers`
 * (7-9a) already clones the module side.
 */
export function collectTriggers(
  char: character,
  modules: RisuModule[],
): triggerscript[] {
  const characterLowLevelAccess = char.lowLevelAccess ?? false
  const own = (char.triggerscript ?? []).map((v) => ({
    ...v,
    lowLevelAccess: characterLowLevelAccess,
  }))
  return own.concat(getModuleTriggers(modules))
}

/**
 * Trigger selection filter, ported from `triggers.ts:1343-1351`:
 *   - `triggercode` / `triggerlua` first effects bypass the filter
 *     (their execution stays browser-side, but they are still selected
 *     for parity).
 *   - with a `manualName`, only triggers whose `comment` matches run.
 *   - otherwise the trigger's `type` must equal the run `mode`.
 */
export function matchesTrigger(
  trigger: triggerscript,
  mode: TriggerMode,
  manualName?: string,
): boolean {
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
): boolean {
  for (const condition of conditions) {
    let pass = true
    if (
      condition.type === 'var' ||
      condition.type === 'chatindex' ||
      condition.type === 'value'
    ) {
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
      const da = chat.message
        .slice(0 - condition.depth)
        .map((v) => v.data)
        .join(' ')
      if (condition.type2 === 'strict') {
        pass = da.split(' ').includes(val)
      } else if (condition.type2 === 'loose') {
        pass = da.toLowerCase().includes(val.toLowerCase())
      } else if (condition.type2 === 'regex') {
        pass = new RegExp(val).test(da)
      }
    }
    if (!pass) {
      return false
    }
  }
  return true
}

/**
 * Phase 7-9a/b runner. Collects triggers, clones inputs, applies the
 * selection filter, evaluates each selected trigger's conditions
 * (7-9b), and returns the SPA result shape. Effect execution is still
 * deferred (see the module header); the post-condition body is an
 * explicit seam for 7-9c/d.
 *
 * Returns `null` when there are no triggers at all (SPA
 * `triggers.ts:1215-1220`). When triggers exist but none match the
 * mode, a result is still returned (mode mismatch is *ignored*, not a
 * no-op return).
 *
 * Cloning rules match the SPA (`triggers.ts:1186, 1207`): in
 * `displayMode` the caller's `char`/`chat` are used directly;
 * otherwise both are deep-cloned so the inputs are never mutated.
 *
 * Parity note: in 7-9b the working chat clone and the database chat
 * hold identical `scriptstate` at condition-eval time (no effect has
 * mutated state yet), so `engine.getVar` and the parser-side
 * `{{getvar}}` agree. 7-9c must keep the two in sync once effects
 * mutate the clone mid-run.
 */
export async function runTrigger(
  ctx: TriggerRunContext,
  char: character,
  mode: TriggerMode,
  arg: TriggerRunArg,
): Promise<TriggerRunResult | null> {
  const recursiveCount = arg.recursiveCount ?? 0
  void recursiveCount // threaded for 7-9c bounded `runtrigger` recursion
  const workingChar = arg.displayMode ? char : structuredClone(char)
  const stopSending = arg.stopSending ?? false
  const sendAIprompt = false
  const additonalSysPrompt = arg.additonalSysPrompt ?? emptySysPrompt()
  const chat = arg.displayMode
    ? arg.chat
    : structuredClone(arg.chat ?? workingChar.chats[workingChar.chatPage])

  const triggers = collectTriggers(workingChar, ctx.modules)
  if (triggers.length === 0) {
    return null
  }

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

  const selected = triggers.filter((trigger) =>
    matchesTrigger(trigger, mode, arg.manualName),
  )
  for (const trigger of selected) {
    if (!evaluateConditions(trigger.conditions ?? [], engine, chat, expand)) {
      continue
    }
    // 7-9c/d: dispatch `trigger.effect` via `engine` + `ctx`, mutating
    // `chat` / `additonalSysPrompt` / `stopSending` / `sendAIprompt` /
    // `tempVars`.
  }

  // Terminal additional-system-prompt token accounting
  // (`triggers.ts:3321-3330`). Empty for the default `additonalSysPrompt`;
  // 7-9c populates the slots via `systemprompt` effects.
  let tokens = 0
  const encoding = encodingForModel(ctx.model)
  if (additonalSysPrompt.start) tokens += tokenize(additonalSysPrompt.start, encoding)
  if (additonalSysPrompt.historyend)
    tokens += tokenize(additonalSysPrompt.historyend, encoding)
  if (additonalSysPrompt.promptend)
    tokens += tokenize(additonalSysPrompt.promptend, encoding)

  return {
    additonalSysPrompt,
    chat,
    tokens,
    stopSending,
    sendAIprompt,
    displayData: arg.displayData,
    tempVars: arg.tempVars,
    varChanged: engine.varChanged,
  }
}
