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
 * 7-9c adds the deterministic V1 effect arms: a passing trigger now
 * runs `setvar`, `systemprompt`, `impersonate`, `cutchat`,
 * `modifychat`, `stop`, and bounded `runtrigger` recursion
 * (`triggers.ts:1442-1546`). `setvar` writes persist through the var
 * engine; `chat.message` mutations live on the returned `result.chat`
 * (the SPA does not write message edits back to the db mid-run, only
 * `scriptstate`). The `runtrigger` arm recurses through this same
 * `runTrigger` with `recursiveCount + 1`, bounded at 10 unless the
 * trigger has `lowLevelAccess`.
 *
 * 7-9d-i adds the V2 control-flow core: the effect loop is now
 * index-based (`for (let index…)`) so V2 control flow can advance /
 * rewind `index`. Ported arms: `v2Header` / `v2Comment` /
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
 * Still deferred (later slices, see `ROADMAP.md`):
 *   - 7-9d-ii: the V2 safe data helpers (message readers, string /
 *     array / dict / math, random, tokenize, regex, quick chat search).
 *   - 7-9e: request/display state adapters + the display/request
 *     effect allowlists (`triggers.ts:1444-1449`).
 *   - 7-9f: prompt/history effects + `start` trigger handoff.
 *
 * Out of scope beyond Phase 7 (unhandled effect types fall through the
 * `switch` as no-ops): `command` (Phase 9 command APIs) and the
 * `lowLevelAccess`-gated `showAlert` / `sendAIprompt` / `runLLM` /
 * `checkSimilarity` / `extractRegex` / `runImgGen` arms, plus browser
 * plugin/Lua trigger code (`triggercode` / `triggerlua`). The latter
 * bypass the mode filter in the SPA (`triggers.ts:1343`) so they are
 * still *selected* here for parity, but no code runs for them.
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

/** Yield to the event loop; mirrors the SPA loop lag guard (`triggers.ts:1911`). */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
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
  let recursiveCount = arg.recursiveCount ?? 0
  const workingChar = arg.displayMode ? char : structuredClone(char)
  let stopSending = arg.stopSending ?? false
  const sendAIprompt = false
  let additonalSysPrompt = arg.additonalSysPrompt ?? emptySysPrompt()
  let chat = arg.displayMode
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

  let recursionVarChanged = false

  const selected = triggers.filter((trigger) =>
    matchesTrigger(trigger, mode, arg.manualName),
  )
  for (const trigger of selected) {
    if (!evaluateConditions(trigger.conditions ?? [], engine, chat, expand)) {
      continue
    }

    // Var-or-value resolution shared by the V2 arms (`triggers.ts`):
    // `value` expands the literal; `var` expands then reads the var.
    const resolve = (raw: string, isValue: boolean): string =>
      isValue ? expand(raw) : engine.getVar(expand(raw))

    // Per-trigger loop counters for `v2LoopNTimes` + the lag guard
    // (the SPA's inner numeric `tempVars`, `triggers.ts:1341`).
    const loopCounts: Record<string, number> = {}

    // Index-based walk (7-9d): V2 control flow advances/rewinds `index`.
    const effects = trigger.effect ?? []
    for (let index = 0; index < effects.length; index++) {
      const effect = effects[index]
      // 7-9e adds the display/request effect allowlist guards
      // (`triggers.ts:1444-1449`).
      if (
        effect &&
        'indent' in effect &&
        typeof effect.indent === 'number' &&
        effect.indent >= 0
      ) {
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
          } else if (effect.role === 'char') {
            chat.message.push({ role: 'char', data: effectValue })
          }
          break
        }
        case 'stop':
        case 'v2StopPromptSending': {
          stopSending = true
          break
        }
        case 'cutchat': {
          const start = Number(expand(effect.start))
          const end = Number(expand(effect.end))
          chat.message = chat.message.slice(start, end)
          break
        }
        case 'modifychat': {
          const index = Number(expand(effect.index))
          const value = expand(effect.value)
          if (chat.message[index]) {
            chat.message[index].data = value
          }
          break
        }
        case 'runtrigger': {
          if (recursiveCount < 10 || trigger.lowLevelAccess) {
            recursiveCount++
            const r = await runTrigger(ctx, workingChar, 'manual', {
              chat,
              recursiveCount,
              additonalSysPrompt,
              stopSending,
              manualName: effect.value,
            })
            if (r) {
              additonalSysPrompt = r.additonalSysPrompt
              chat = r.chat
              engine.setChat(chat)
              stopSending = r.stopSending
              recursionVarChanged ||= r.varChanged
            }
          }
          break
        }

        // ---- V2 control flow + deterministic effects (7-9d-i) ----
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
          const finalValue =
            effectValue === null || effectValue === undefined ? 'null' : effectValue
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
            effect.targetType === 'value'
              ? expand(effect.target)
              : engine.getVar(expand(effect.target))
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
              if (
                (ef.type === 'v2Loop' || ef.type === 'v2LoopNTimes') &&
                indent === ef.indent
              ) {
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
                    break
                  }
                }
                break
              }
            }

            // Lag guard (`triggers.ts:1908-1913`).
            loopCounts['loopTimes'] = (loopCounts['loopTimes'] ?? 0) + 1
            if (loopCounts['loopTimes'] > 100) {
              await sleep(1)
              loopCounts['loopTimes'] = 0
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
          if (recursiveCount < 10 || trigger.lowLevelAccess) {
            recursiveCount++
            const r = await runTrigger(ctx, workingChar, 'manual', {
              chat,
              recursiveCount,
              additonalSysPrompt,
              stopSending,
              manualName: effect.target,
            })
            if (r) {
              additonalSysPrompt = r.additonalSysPrompt
              chat = r.chat
              engine.setChat(chat)
              stopSending = r.stopSending
              recursionVarChanged ||= r.varChanged
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
          break
        }
        case 'v2ModifyChat': {
          const targetIndex = Number(resolve(effect.index, effect.indexType === 'value'))
          const value = resolve(effect.value, effect.valueType === 'value')
          if (chat.message[targetIndex]) {
            chat.message[targetIndex].data = value
          }
          break
        }
        case 'v2SystemPrompt': {
          additonalSysPrompt[effect.location] +=
            resolve(effect.value, effect.valueType === 'value') + '\n\n'
          break
        }
        case 'v2Impersonate': {
          const value = resolve(effect.value, effect.valueType === 'value')
          if (effect.role === 'user') {
            chat.message.push({ role: 'user', data: value })
          } else if (effect.role === 'char') {
            chat.message.push({ role: 'char', data: value })
          }
          break
        }
        // Deferred (no-op): `command`; the `lowLevelAccess`-gated
        // alert/LLM/image/similarity/regex V1 + V2 arms; the V2 safe
        // data helpers (7-9d-ii); request/display state (7-9e); the
        // persistent lorebook/character/persona/note arms; and
        // `triggercode` / `triggerlua`.
      }
    }
  }

  // Terminal additional-system-prompt token accounting
  // (`triggers.ts:3321-3330`). Populated by `systemprompt` effects.
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
    varChanged: engine.varChanged || recursionVarChanged,
  }
}
