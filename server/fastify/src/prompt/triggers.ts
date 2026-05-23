import type {
  Chat,
  character,
} from '../../../../src/ts/storage/database.svelte'
import type { RisuModule } from '../../../../src/ts/process/modules'
import type {
  additonalSysPrompt,
  triggerscript,
} from '../../../../src/ts/process/triggers'
import { getModuleTriggers } from './modules.js'
import { encodingForModel, tokenize } from './tokens.js'

/**
 * Phase 7-9a trigger model + runner shell, ported from the Svelte-bound
 * `runTrigger` in `src/ts/process/triggers.ts` (3350 lines, 151 effect
 * arms).
 *
 * This slice establishes ONLY the deterministic, store-free skeleton:
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
 * The shell does NOT evaluate conditions or execute any effect. Those
 * are the following slices (see `ROADMAP.md`):
 *   - 7-9b: variable + condition engine.
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
 * Svelte-free DI seam replacing the SPA's store reads. 7-9a only needs
 * the active module list (for trigger aggregation) and the model (for
 * terminal token accounting). Later slices extend this with the
 * database/character/chat scope used by the variable engine and the
 * effect handlers.
 */
export interface TriggerRunContext {
  modules: RisuModule[]
  model?: string | null
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

/** SPA `runTrigger` return shape (`triggers.ts:3341-3349`). */
export interface TriggerRunResult {
  additonalSysPrompt: additonalSysPrompt
  chat: Chat
  tokens: number
  stopSending: boolean
  sendAIprompt: boolean
  displayData: string | undefined
  tempVars: Record<string, string> | undefined
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
 * Phase 7-9a runner shell. Collects triggers, clones inputs, applies
 * the selection filter, and returns the SPA result shape. Condition
 * evaluation and effect execution are deferred (see the module header);
 * the selected-trigger loop is left as an explicit seam for 7-9b/c/d.
 *
 * Returns `null` when there are no triggers at all (SPA
 * `triggers.ts:1215-1220`). When triggers exist but none match the
 * mode, a result is still returned (mode mismatch is *ignored*, not a
 * no-op return).
 *
 * Cloning rules match the SPA (`triggers.ts:1186, 1207`): in
 * `displayMode` the caller's `char`/`chat` are used directly;
 * otherwise both are deep-cloned so the inputs are never mutated.
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

  const selected = triggers.filter((trigger) =>
    matchesTrigger(trigger, mode, arg.manualName),
  )
  for (const _trigger of selected) {
    // 7-9b: evaluate `_trigger.conditions`.
    // 7-9c/d: dispatch `_trigger.effect`, mutating `chat` /
    // `additonalSysPrompt` / `stopSending` / `sendAIprompt` / `tempVars`
    // through the explicit `ctx` (no Svelte stores).
    void _trigger
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
  }
}
