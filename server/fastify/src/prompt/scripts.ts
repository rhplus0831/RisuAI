import { randomUUID } from 'node:crypto'
import type { Chat, Database, Message, character, customscript } from '../../../../src/ts/storage/database.svelte'
import type { CbsConditions } from '../../../../src/ts/parser/risuChatParserHelpers'
import type { RisuModule } from '../../../../src/ts/process/modules'
import {
  assertBoundedRegexHaystack,
  assertBoundedRegexOutput,
  assertBoundedRegexReplacement,
  type BoundedRegexCompatibilityOptions,
  type BoundedRegexLike,
  compileBoundedRegex,
  compileBoundedRegexWithCompatibility,
  complexRegexCompatibilityOptions,
  isBoundedRegexError,
  isComplexBoundedRegex,
  matchFirstBoundedRegexWithCompatibility,
  moveBoundedRegexWithCompatibility,
  replaceBoundedRegexWithCompatibility,
  testBoundedRegex,
  testBoundedRegexWithCompatibility,
} from './boundedRegex.js'
import { expandVariables, type ExpandContext } from './variables.js'
import { getActiveModules, getModuleRegexScripts } from './modules.js'
import { isRisuChatParserFixedPoint } from './parserFixedPoint.js'
import { serverUnsupportedRegexEffectType } from '../../../../src/ts/process/triggerServerSupport.js'
import { regexOutputSizeLimitCodeUnits } from '@risuai/shared-core/regex-output-size-limit'

/**
 * Regex script processor ported from `src/ts/process/scripts.ts`
 * `processScript` + `executeScript`.
 *
 * Walks `db.globalscript ?? []`, then `db.presetRegex ?? []`, then
 * `char.customscript ?? []`, then the regex scripts from the active modules.
 * Parses each entry through the `ableFlag` `<order N, action…>` DSL,
 * stable sorts by `order desc` when any script declared one, then
 * runs each script where `script.type === mode`.
 *
 * Action equivalence: `@@inject` / `@@move_top` / `@@move_bottom` /
 * `@@repeat_back` prefixes and the `inject` / `move_top` /
 * `move_bottom` / `repeat_back` actions resolve to the same code path
 * (`scripts.ts`). `@@emo` is prefix-only (no `'emo'` action in
 * the SPA either).
 *
 * Outscript prep (`scripts.ts`):
 *   - `$n` literal → `\n`
 *   - `{{data}}` → `$&` (full-match substitution)
 *   - `endsWith('>')` && !`no_end_nl` action: append `\n`
 *
 * Flag handling (`scripts.ts`):
 *   - Default `'g'`. `script.flag` is honored ONLY when
 *     `script.ableFlag === true` (SPA quirk; without `ableFlag` the
 *     declared flag is silently ignored).
 *   - `@@move_top` / `@@move_bottom` and the `move_top` / `move_bottom`
 *     actions force the `'g'` flag off to avoid double-counting move matches.
 *   - Sanitize to `[dgimsuvy]`, dedupe, fall back to `'u'` when empty.
 *
 * `cbs` action (`scripts.ts`): pre-expand `script.in` through
 * `expandVariables` before compiling the RegExp.
 *
 * Two documented divergences from the SPA:
 *   - Reset `reg.lastIndex = 0` after the dispatching `reg.test()` so
 *     `@@move_top g` finds all matches (SPA loses the first one via
 *     lastIndex leak; the move dispatch later defangs `g` anyway).
 *   - `@@repeat_back` adds an r-null guard the SPA elides
 *     (`scripts.ts` accesses `r[0]` blindly).
 *
 * Per-assembly prepared-script memo: the history walk runs
 * `processScript` once per window message with identical script inputs, so
 * the module-regex resolution, the `parseScripts` pass, and the per-script
 * invariant prep (flag sanitation, outScript templating, RegExp compile)
 * are hoisted into a `PreparedScript` list memoized per loaded `Database`
 * (WeakMap, same request-scoped keying as the `getActiveModules` memo —
 * a fresh request loads a fresh `Database`, so it can never hit a stale
 * entry). Only `data` / `cbsConditions` / `chatID` vary per message.
 * `cbs`-action scripts are excluded from regex precompilation: they
 * pre-expand `script.in` through `expandVariables` per message and cannot
 * share a compiled RegExp.
 *
 * Not handled here:
 *   - script-cache (`generateScriptCacheKey` / `getScriptCache` /
 *     `cacheScript`)
 *   - `runLuaEditTrigger` — `processScript` stays regex-only; Lua edit hooks
 *     are wired alongside it by callers at final render, history call sites,
 *     and submit-time `editinput`.
 *   - display/request trigger effects; the trigger runner owns those.
 *   - `pluginV2[mode]` browser plugin V2 hooks
 *
 * Errors from a single bad regex are swallowed (mirrors the SPA's
 * try/catch at scripts.ts); the rest of the script list still
 * runs. Bounded-regex rejections are intentionally not swallowed: one JS
 * RegExp operation is synchronous and non-interruptible after it begins, so
 * unsafe imported patterns/haystacks must fail before provider dispatch.
 */

export type ScriptMode = 'editinput' | 'editoutput' | 'editprocess' | 'editdisplay'

export interface ScriptInjectMutation {
  messageId: string
  before: Message
  after: Message
}

export interface ScriptMutationHooks {
  /** The history row being formatted; avoids addressing a filtered transcript by index. */
  injectTarget?: Message
  onInject?: (mutation: ScriptInjectMutation) => void
}

const VALID_FLAG_CHARS = /[^dgimsuvy]/g
const META_RE = /<(.+?)>/g
const DATA_RE = /\{\{data\}\}/g

function sanitizeFlag(flag: string): string {
  let f = flag.trim().replace(VALID_FLAG_CHARS, '')
  f = f
    .split('')
    .filter((v, i, a) => a.indexOf(v) === i)
    .join('')
  return f.length === 0 ? 'u' : f
}

interface ParsedScript {
  script: customscript
  order: number
  /** Baseline stores NaN; this flag preserves its stable-sort equality outcome explicitly. */
  malformedOrder: boolean
  actions: string[]
}

/** A `ParsedScript` plus every per-script invariant `applyOne` used to
 *  recompute per message: the sanitized flag, the prepped replacement
 *  template, the move-action classification, and — for non-`cbs` scripts —
 *  the compiled RegExp. */
interface PreparedScript {
  script: customscript
  order: number
  actions: string[]
  /** Final sanitized flag (move actions already defanged `g`). */
  flag: string
  /** Replacement template with `$n` / `{{data}}` / trailing-`\n` rules applied. */
  outScript: string
  isMoveTop: boolean
  isMoveBottom: boolean
  /** `cbs`-action scripts pre-expand `script.in` per message; their RegExp
   *  compiles per call and `reg` stays `null`. */
  isCbs: boolean
  /** Precompiled regex for non-cbs scripts (`lastIndex` reset before each
   *  use). `null` when `in` is empty, the script is cbs, or the source failed
   *  to compile (formerly a throw per message swallowed by `processScript`'s
   *  per-script catch — the apply stays a no-op either way). */
  reg: BoundedRegexLike | null
}

function parseScripts(rawScripts: customscript[]): {
  parsed: ParsedScript[]
  orderChanged: boolean
} {
  const parsed: ParsedScript[] = []
  let orderChanged = false
  for (const script of rawScripts) {
    if (script.ableFlag && script.flag?.includes('<')) {
      const cloned = { ...script }
      let order = 0
      let malformedOrder = false
      const actions: string[] = []
      cloned.flag = (cloned.flag ?? '').replace(META_RE, (_match, body: string) => {
        const tokens = body.split(',').map((t) => t.trim())
        for (const t of tokens) {
          if (t.startsWith('order ')) {
            const n = parseInt(t.substring(6))
            orderChanged = true
            if (Number.isNaN(n)) {
              malformedOrder = true
            } else {
              order = n
            }
          } else if (t.length > 0) {
            actions.push(t)
          }
        }
        return ''
      })
      parsed.push({ script: cloned, order, malformedOrder, actions })
    } else {
      parsed.push({ script, order: 0, malformedOrder: false, actions: [] })
    }
  }
  return { parsed, orderChanged }
}

/**
 * Match-template substitution mirroring scripts.ts:
 *  - `$N`  (N digit string) → matched[N] when defined, else literal
 *  - `$&`  → matched[0]
 *  - `$<x>` → SPA does `parseInt(x)` then `matched.groups[parseInt]`,
 *    which silently breaks for actual named groups. Mirrored.
 */
function substituteMatch(template: string, matched: RegExpMatchArray): string {
  return template
    .replace(/(?<!\$)\$[0-9]+/g, (v) => {
      const index = parseInt(v.substring(1))
      if (index < matched.length) return matched[index] ?? v
      return v
    })
    .replace(/\$\&/g, matched[0])
    .replace(/(?<!\$)\$<([^>]+)>/g, (v) => {
      const groupName = parseInt(v.substring(2, v.length - 1))
      if (matched.groups && (matched.groups as Record<string, string>)[groupName as unknown as string]) {
        return (matched.groups as Record<string, string>)[groupName as unknown as string]
      }
      return v
    })
}

function applyMove(
  data: string,
  reg: RegExp,
  flag: string,
  outScript: string,
  toTop: boolean,
  sizeLimit: number,
): string {
  assertBoundedRegexHaystack(data, 'customscript move source')
  assertBoundedRegexReplacement(outScript, 'customscript move replacement', sizeLimit)
  reg.lastIndex = 0
  const isGlobal = flag.includes('g')
  const matchAll = isGlobal ? Array.from(data.matchAll(reg)) : [data.match(reg)]
  let next = data.replace(reg, '')
  for (const matched of matchAll) {
    if (!matched) continue
    const template = outScript.replace('@@move_top ', '').replace('@@move_bottom ', '')
    const out = substituteMatch(template, matched as RegExpMatchArray)
    next = toTop ? out + '\n' + next : next + '\n' + out
    assertBoundedRegexOutput(next, 'customscript move source', sizeLimit)
  }
  return next
}

function injectTarget(
  currentChat: Chat | undefined,
  chatID: number,
  hooks: ScriptMutationHooks | undefined,
): Message | undefined {
  return hooks?.injectTarget ?? (chatID >= 0 ? currentChat?.message?.[chatID] : undefined)
}

function writeInjectTarget(target: Message, data: string, hooks: ScriptMutationHooks | undefined): void {
  const before = structuredClone(target) as Message
  const messageId = target.chatId || randomUUID()
  target.chatId = messageId
  target.data = data
  if (!before.chatId) before.chatId = messageId
  hooks?.onInject?.({
    messageId,
    before,
    after: structuredClone(target) as Message,
  })
}

function applyInject(
  currentChat: Chat | undefined,
  chatID: number,
  data: string,
  reg: RegExp,
  hooks?: ScriptMutationHooks,
): string {
  assertBoundedRegexHaystack(data, 'customscript inject source')
  const target = injectTarget(currentChat, chatID, hooks)
  if (!target) return data
  // SPA mutates message[chatID].data with the FULL pre-strip data (yes,
  // that is intentional in scripts.ts). The assembled chat is
  // persisted after prompt assembly.
  writeInjectTarget(target, data, hooks)
  return data.replace(reg, '')
}

function applyRepeatBack(
  currentChar: character,
  currentChat: Chat | undefined,
  chatID: number,
  data: string,
  reg: RegExp,
  outScript: string,
): string {
  if (!currentChat || chatID < 0) return data
  const target = currentChat.message?.[chatID]
  if (!target) return data

  const v = outScript.split(' ', 2)[1]
  const fmIndex = currentChat.fmIndex ?? -1
  let lastChat = fmIndex === -1 ? (currentChar.firstMessage ?? '') : (currentChar.alternateGreetings?.[fmIndex] ?? '')

  let pointer = chatID - 1
  while (pointer >= 0) {
    if (currentChat.message[pointer].role === target.role) {
      lastChat = currentChat.message[pointer].data
      break
    }
    pointer--
  }

  assertBoundedRegexHaystack(lastChat, 'customscript repeat_back source')
  reg.lastIndex = 0
  const r = lastChat.match(reg)
  // SPA accesses r[0] without a null check (would throw on no-match); we
  // guard so the chain stays alive.
  if (!r) return data

  if (!v) {
    return data + r[0]
  }
  switch (v) {
    case 'end':
      return data + r[0]
    case 'start':
      return r[0] + data
    case 'end_nl':
      return data + '\n' + r[0]
    case 'start_nl':
      return r[0] + '\n' + data
    default:
      return data
  }
}

/** Hoists the per-script invariant prep out of the per-message apply
 *  flag resolution + sanitation, outScript templating, move
 *  classification, and the RegExp compile for non-cbs scripts. */
function prepareOne(parsed: ParsedScript, options?: BoundedRegexCompatibilityOptions): PreparedScript {
  const script = parsed.script
  const actions = parsed.actions

  // Flag default: 'g' (SPA scripts.ts). script.flag is honored only
  // when ableFlag === true (scripts.ts).
  let flag = 'g'
  if (script.ableFlag) {
    flag = script.flag || 'g'
  }

  // outScript preparation
  let outScript = (script.out ?? '').replaceAll('$n', '\n').replace(DATA_RE, '$&')

  const isMoveTop = outScript.startsWith('@@move_top') || actions.includes('move_top')
  const isMoveBottom = outScript.startsWith('@@move_bottom') || actions.includes('move_bottom')

  if (isMoveTop || isMoveBottom) {
    // Force non-global so move actions do not double-count matches.
    flag = flag.replace('g', '')
  }

  if (outScript.endsWith('>') && !actions.includes('no_end_nl')) {
    outScript += '\n'
  }

  flag = sanitizeFlag(flag)

  const isCbs = actions.includes('cbs')
  let reg: BoundedRegexLike | null = null
  if (!isCbs && script.in) {
    try {
      reg = options
        ? compileBoundedRegexWithCompatibility(script.in, flag, 'customscript script.in pattern', options)
        : compileBoundedRegex(script.in, flag, 'customscript script.in pattern')
    } catch (err) {
      if (isBoundedRegexError(err)) throw err
      // Formerly thrown per message inside applyOne and swallowed by
      // processScript's per-script catch; the apply stays a no-op.
    }
  }

  return {
    script,
    order: parsed.order,
    actions,
    flag,
    outScript,
    isMoveTop,
    isMoveBottom,
    isCbs,
    reg,
  }
}

function applyOne(
  ctx: ExpandContext,
  char: character,
  data: string,
  prepared: PreparedScript,
  cbsConditions: CbsConditions | undefined,
  chatID: number,
  currentChat: Chat | undefined,
  mutationHooks: ScriptMutationHooks | undefined,
  sizeLimit: number,
): string {
  const script = prepared.script
  const actions = prepared.actions
  if (!script.in) return data

  const { flag, outScript, isMoveTop, isMoveBottom } = prepared

  let reg: RegExp
  if (prepared.isCbs) {
    // `cbs` action: pre-expand the input regex source (scripts.ts).
    // Per-message by design — the expansion depends on cbsConditions.
    const regexIn = expandVariables(script.in, { ...ctx, chatID, cbsConditions }).text
    reg = compileBoundedRegex(regexIn, flag, 'customscript cbs script.in pattern')
  } else {
    if (!prepared.reg) return data
    if (isComplexBoundedRegex(prepared.reg)) {
      throw new Error('complex regex requires async script execution')
    }
    reg = prepared.reg
    // The shared compiled regex carries `lastIndex` across messages; reset so
    // a reused global/sticky regex behaves exactly like a fresh compile.
    reg.lastIndex = 0
  }

  const isAction = outScript.startsWith('@@') || actions.length > 0
  if (isAction) {
    assertBoundedRegexHaystack(data, 'customscript action source')
    assertBoundedRegexReplacement(outScript, 'customscript action replacement', sizeLimit)
    const matched = testBoundedRegex(reg, data, 'customscript action source')
    // reg.test() advances `lastIndex` when the regex is global; both
    // matchAll() and a sticky-style match would then start past the
    // first hit. The SPA shares this bug (scripts.ts).
    // Reset before any downstream use of the same regex object.
    reg.lastIndex = 0
    if (matched) {
      const unsupportedEffectType = serverUnsupportedRegexEffectType(outScript)
      if (unsupportedEffectType) {
        ctx.unsupportedTriggerEffectTypes?.add(unsupportedEffectType)
        return data
      }
      if (outScript.startsWith('@@inject') || actions.includes('inject')) {
        return applyInject(currentChat, chatID, data, reg, mutationHooks)
      }
      if (isMoveTop || isMoveBottom) {
        return applyMove(data, reg, flag, outScript, isMoveTop, sizeLimit)
      }
      // Unknown @@ prefix or arbitrary action: fall through to plain replace.
      assertBoundedRegexHaystack(data, 'customscript action replace source')
      assertBoundedRegexReplacement(outScript, 'customscript action replace replacement', sizeLimit)
      const replaced = data.replace(reg, outScript)
      assertBoundedRegexOutput(replaced, 'customscript action replace source', sizeLimit)
      return expandVariables(replaced, { ...ctx, chatID, cbsConditions }).text
    }
    // No match: only @@repeat_back / the 'repeat_back' action fires.
    if (outScript.startsWith('@@repeat_back') || actions.includes('repeat_back')) {
      return applyRepeatBack(char, currentChat, chatID, data, reg, outScript)
    }
    return data
  }

  assertBoundedRegexHaystack(data, 'customscript replace source')
  assertBoundedRegexReplacement(outScript, 'customscript replace replacement', sizeLimit)
  const replaced = data.replace(reg, outScript)
  assertBoundedRegexOutput(replaced, 'customscript replace source', sizeLimit)
  return expandVariables(replaced, { ...ctx, chatID, cbsConditions }).text
}

async function applyMoveAsync(
  data: string,
  reg: BoundedRegexLike,
  outScript: string,
  toTop: boolean,
  options: BoundedRegexCompatibilityOptions,
): Promise<string> {
  if (!isComplexBoundedRegex(reg)) {
    return applyMove(data, reg, reg.flags, outScript, toTop, options.sizeLimit)
  }
  return moveBoundedRegexWithCompatibility(
    reg,
    data,
    outScript,
    toTop,
    'customscript move source',
    'customscript move replacement',
    options,
  )
}

async function applyInjectAsync(
  currentChat: Chat | undefined,
  chatID: number,
  data: string,
  reg: BoundedRegexLike,
  options: BoundedRegexCompatibilityOptions,
  hooks?: ScriptMutationHooks,
): Promise<string> {
  if (!isComplexBoundedRegex(reg)) return applyInject(currentChat, chatID, data, reg, hooks)

  assertBoundedRegexHaystack(data, 'customscript inject source')
  const target = injectTarget(currentChat, chatID, hooks)
  if (!target) return data
  writeInjectTarget(target, data, hooks)
  return replaceBoundedRegexWithCompatibility(
    reg,
    data,
    '',
    'customscript inject source',
    'customscript inject replacement',
    options,
  )
}

async function applyRepeatBackAsync(
  currentChar: character,
  currentChat: Chat | undefined,
  chatID: number,
  data: string,
  reg: BoundedRegexLike,
  outScript: string,
  options: BoundedRegexCompatibilityOptions,
): Promise<string> {
  if (!isComplexBoundedRegex(reg)) {
    return applyRepeatBack(currentChar, currentChat, chatID, data, reg, outScript)
  }
  if (!currentChat || chatID < 0) return data
  const target = currentChat.message?.[chatID]
  if (!target) return data

  const v = outScript.split(' ', 2)[1]
  const fmIndex = currentChat.fmIndex ?? -1
  let lastChat = fmIndex === -1 ? (currentChar.firstMessage ?? '') : (currentChar.alternateGreetings?.[fmIndex] ?? '')

  let pointer = chatID - 1
  while (pointer >= 0) {
    if (currentChat.message[pointer].role === target.role) {
      lastChat = currentChat.message[pointer].data
      break
    }
    pointer--
  }

  const match = await matchFirstBoundedRegexWithCompatibility(reg, lastChat, 'customscript repeat_back source', options)
  if (!match) return data

  if (!v) return data + match
  switch (v) {
    case 'end':
      return data + match
    case 'start':
      return match + data
    case 'end_nl':
      return data + '\n' + match
    case 'start_nl':
      return match + '\n' + data
    default:
      return data
  }
}

async function applyOneAsync(
  ctx: ExpandContext,
  char: character,
  data: string,
  prepared: PreparedScript,
  cbsConditions: CbsConditions | undefined,
  chatID: number,
  currentChat: Chat | undefined,
  options: BoundedRegexCompatibilityOptions,
  mutationHooks: ScriptMutationHooks | undefined,
): Promise<string> {
  const script = prepared.script
  const actions = prepared.actions
  if (!script.in) return data

  const { flag, outScript, isMoveTop, isMoveBottom } = prepared

  let reg: BoundedRegexLike
  if (prepared.isCbs) {
    const regexIn = expandVariables(script.in, { ...ctx, chatID, cbsConditions }).text
    reg = compileBoundedRegexWithCompatibility(regexIn, flag, 'customscript cbs script.in pattern', options)
  } else {
    if (!prepared.reg) return data
    reg = prepared.reg
    if (!isComplexBoundedRegex(reg)) reg.lastIndex = 0
  }

  const isAction = outScript.startsWith('@@') || actions.length > 0
  if (isAction) {
    assertBoundedRegexHaystack(data, 'customscript action source')
    assertBoundedRegexReplacement(outScript, 'customscript action replacement', options.sizeLimit)
    const matched = await testBoundedRegexWithCompatibility(reg, data, 'customscript action source', options)
    if (!isComplexBoundedRegex(reg)) reg.lastIndex = 0
    if (matched) {
      const unsupportedEffectType = serverUnsupportedRegexEffectType(outScript)
      if (unsupportedEffectType) {
        ctx.unsupportedTriggerEffectTypes?.add(unsupportedEffectType)
        return data
      }
      if (outScript.startsWith('@@inject') || actions.includes('inject')) {
        return applyInjectAsync(currentChat, chatID, data, reg, options, mutationHooks)
      }
      if (isMoveTop || isMoveBottom) {
        return applyMoveAsync(data, reg, outScript, isMoveTop, options)
      }
      const replaced = await replaceBoundedRegexWithCompatibility(
        reg,
        data,
        outScript,
        'customscript action replace source',
        'customscript action replace replacement',
        options,
      )
      return expandVariables(replaced, { ...ctx, chatID, cbsConditions }).text
    }
    if (outScript.startsWith('@@repeat_back') || actions.includes('repeat_back')) {
      return applyRepeatBackAsync(char, currentChat, chatID, data, reg, outScript, options)
    }
    return data
  }

  const replaced = await replaceBoundedRegexWithCompatibility(
    reg,
    data,
    outScript,
    'customscript replace source',
    'customscript replace replacement',
    options,
  )
  return expandVariables(replaced, { ...ctx, chatID, cbsConditions }).text
}

interface PreparedScriptsMemoEntry {
  /** Inputs the prepared list was computed from, compared by reference. A
   *  request loads a fresh `Database`, so within one assembly these refs are
   *  stable across the whole per-message walk. */
  charRef: character
  globalscriptRef: customscript[] | undefined
  presetRegexRef: customscript[] | undefined
  customscriptRef: customscript[] | undefined
  activeModulesRef: RisuModule[]
  compatEnabled: boolean
  compatStage: BoundedRegexCompatibilityOptions['stage'] | null
  prepared: PreparedScript[]
}

const preparedScriptsMemo = new WeakMap<Database, PreparedScriptsMemoEntry>()

/** Resolves the sorted, prepared script list for one (db, char, chat) input
 *  set, memoized per loaded `Database`. The first-message call
 *  (no `currentChat`) and the per-message calls key to different active-module
 *  sets, but each runs the prep at most once per assembly. */
function getPreparedScripts(
  db: Database,
  char: character,
  currentChat: Chat | undefined,
  options?: BoundedRegexCompatibilityOptions,
): PreparedScript[] {
  const activeModules = getActiveModules(db, char, currentChat)
  const memo = preparedScriptsMemo.get(db)
  if (
    memo &&
    memo.charRef === char &&
    memo.globalscriptRef === db.globalscript &&
    memo.presetRegexRef === db.presetRegex &&
    memo.customscriptRef === char.customscript &&
    memo.activeModulesRef === activeModules &&
    memo.compatEnabled === (options?.enabled ?? false) &&
    memo.compatStage === (options?.stage ?? null)
  ) {
    return memo.prepared
  }

  const rawScripts = (db.globalscript ?? [])
    .concat(db.presetRegex ?? [])
    .concat(char.customscript ?? [])
    .concat(getModuleRegexScripts(activeModules))
  const { parsed, orderChanged } = parseScripts(rawScripts)
  if (orderChanged) {
    parsed.sort((a, b) => (a.malformedOrder || b.malformedOrder ? 0 : b.order - a.order))
  }
  const prepared = parsed.map((script) => prepareOne(script, options?.enabled ? options : undefined))
  preparedScriptsMemo.set(db, {
    charRef: char,
    globalscriptRef: db.globalscript,
    presetRegexRef: db.presetRegex,
    customscriptRef: char.customscript,
    activeModulesRef: activeModules,
    compatEnabled: options?.enabled ?? false,
    compatStage: options?.stage ?? null,
    prepared,
  })
  return prepared
}

export function processScript(
  ctx: ExpandContext,
  char: character,
  data: string,
  mode: ScriptMode,
  cbsConditions: CbsConditions = {},
  chatID: number = -1,
  currentChat: Chat | undefined = undefined,
  mutationHooks: ScriptMutationHooks | undefined = undefined,
): string {
  const prepared = getPreparedScripts(ctx.database, char, currentChat)
  const sizeLimit = regexOutputSizeLimitCodeUnits(ctx.database.regexOutputSizeLimitMiB)

  let current = data
  for (const p of prepared) {
    if (p.script.type !== mode) continue
    try {
      current = applyOne(ctx, char, current, p, cbsConditions, chatID, currentChat, mutationHooks, sizeLimit)
    } catch (err) {
      if (isBoundedRegexError(err)) throw err
      // Mirror SPA behavior: one bad regex should not stop the rest of the chain.
    }
  }

  return current
}

function stageForScriptMode(mode: ScriptMode): BoundedRegexCompatibilityOptions['stage'] {
  if (mode === 'editoutput') return 'output'
  if (mode === 'editdisplay') return 'display'
  return 'input'
}

export async function processScriptAsync(
  ctx: ExpandContext,
  char: character,
  data: string,
  mode: ScriptMode,
  cbsConditions: CbsConditions = {},
  chatID: number = -1,
  currentChat: Chat | undefined = undefined,
  mutationHooks: ScriptMutationHooks | undefined = undefined,
): Promise<string> {
  const options = complexRegexCompatibilityOptions(ctx.database, stageForScriptMode(mode))
  const prepared = getPreparedScripts(ctx.database, char, currentChat, options)

  // `processScriptFull` reparsed the whole Lua/plugin-processed body before
  // regex scripts. Keep `runVar` disabled exactly like that parser call (which
  // omitted the flag), so nested CBS resolves without replaying state writes.
  let current = isRisuChatParserFixedPoint(data)
    ? data
    : expandVariables(data, {
        ...ctx,
        chatID,
        cbsConditions,
        runVar: false,
      }).text
  for (const p of prepared) {
    if (p.script.type !== mode) continue
    try {
      current = await applyOneAsync(ctx, char, current, p, cbsConditions, chatID, currentChat, options, mutationHooks)
    } catch (err) {
      if (isBoundedRegexError(err)) throw err
    }
  }

  return current
}
