import type { Chat, Database, character, customscript } from '../../../../src/ts/storage/database.svelte'
import type { CbsConditions } from '../../../../src/ts/parser/risuChatParserHelpers'
import type { RisuModule } from '../../../../src/ts/process/modules'
import {
  assertBoundedRegexHaystack,
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

/**
 * Regex script processor ported from `src/ts/process/scripts.ts`
 * `processScript` + `executeScript`.
 *
 * Walks `db.presetRegex ?? []`, then `char.customscript ?? []`, then
 * the regex scripts from the active modules.
 * Parses each entry through the `ableFlag` `<order N, action…>` DSL,
 * stable sorts by `order desc` when any script declared one, then
 * runs each script where `script.type === mode`.
 *
 * Action equivalence: `@@inject` / `@@move_top` / `@@move_bottom` /
 * `@@repeat_back` prefixes and the `inject` / `move_top` /
 * `move_bottom` / `repeat_back` actions resolve to the same code path
 * (`scripts.ts:240-326`). `@@emo` is prefix-only (no `'emo'` action in
 * the SPA either).
 *
 * Outscript prep (`scripts.ts:180-196`):
 *   - `$n` literal → `\n`
 *   - `{{data}}` → `$&` (full-match substitution)
 *   - `endsWith('>')` && !`no_end_nl` action: append `\n`
 *
 * Flag handling (`scripts.ts:182-208`):
 *   - Default `'g'`. `script.flag` is honored ONLY when
 *     `script.ableFlag === true` (SPA quirk; without `ableFlag` the
 *     declared flag is silently ignored).
 *   - `@@move_top` / `@@move_bottom` and the `move_top` / `move_bottom`
 *     actions force the `'g'` flag off (SPA "temperary fix").
 *   - Sanitize to `[dgimsuvy]`, dedupe, fall back to `'u'` when empty.
 *
 * `cbs` action (`scripts.ts:211-213`): pre-expand `script.in` through
 * `expandVariables` before compiling the RegExp.
 *
 * Two documented divergences from the SPA:
 *   - Reset `reg.lastIndex = 0` after the dispatching `reg.test()` so
 *     `@@move_top g` finds all matches (SPA loses the first one via
 *     lastIndex leak; the move dispatch later defangs `g` anyway).
 *   - `@@repeat_back` adds an r-null guard the SPA elides
 *     (`scripts.ts:306` accesses `r[0]` blindly).
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
 *   - `runTrigger('display', …)` (orthogonal: `editdisplay` mode only,
 *     blocked on trigger support)
 *   - `pluginV2[mode]` browser plugin V2 hooks
 *
 * Errors from a single bad regex are swallowed (mirrors the SPA's
 * try/catch at scripts.ts:372-376); the rest of the script list still
 * runs. Bounded-regex rejections are intentionally not swallowed: one JS
 * RegExp operation is synchronous and non-interruptible after it begins, so
 * unsafe imported patterns/haystacks must fail before provider dispatch.
 */

export type ScriptMode = 'editinput' | 'editoutput' | 'editprocess' | 'editdisplay'

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
      const actions: string[] = []
      cloned.flag = (cloned.flag ?? '').replace(META_RE, (_match, body: string) => {
        const tokens = body.split(',').map((t) => t.trim())
        for (const t of tokens) {
          if (t.startsWith('order ')) {
            const n = parseInt(t.substring(6))
            if (!Number.isNaN(n)) {
              order = n
              orderChanged = true
            }
          } else if (t.length > 0) {
            actions.push(t)
          }
        }
        return ''
      })
      parsed.push({ script: cloned, order, actions })
    } else {
      parsed.push({ script, order: 0, actions: [] })
    }
  }
  return { parsed, orderChanged }
}

/**
 * Match-template substitution mirroring scripts.ts:262-276:
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

function applyMove(data: string, reg: RegExp, flag: string, outScript: string, toTop: boolean): string {
  assertBoundedRegexHaystack(data, 'customscript move source')
  assertBoundedRegexReplacement(outScript, 'customscript move replacement')
  reg.lastIndex = 0
  const isGlobal = flag.includes('g')
  const matchAll = isGlobal ? Array.from(data.matchAll(reg)) : [data.match(reg)]
  let next = data.replace(reg, '')
  for (const matched of matchAll) {
    if (!matched) continue
    const template = outScript.replace('@@move_top ', '').replace('@@move_bottom ', '')
    const out = substituteMatch(template, matched as RegExpMatchArray)
    next = toTop ? out + '\n' + next : next + '\n' + out
  }
  return next
}

function applyInject(currentChat: Chat | undefined, chatID: number, data: string, reg: RegExp): string {
  assertBoundedRegexHaystack(data, 'customscript inject source')
  if (!currentChat || chatID < 0) return data
  const target = currentChat.message?.[chatID]
  if (!target) return data
  // SPA mutates message[chatID].data with the FULL pre-strip data (yes,
  // that is intentional in scripts.ts:244-245). The assembled chat is
  // persisted after prompt assembly.
  target.data = data
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

  // Flag default: 'g' (SPA scripts.ts:182). script.flag is honored only
  // when ableFlag === true (scripts.ts:183-185).
  let flag = 'g'
  if (script.ableFlag) {
    flag = script.flag || 'g'
  }

  // outScript preparation
  let outScript = (script.out ?? '').replaceAll('$n', '\n').replace(DATA_RE, '$&')

  const isMoveTop = outScript.startsWith('@@move_top') || actions.includes('move_top')
  const isMoveBottom = outScript.startsWith('@@move_bottom') || actions.includes('move_bottom')

  if (isMoveTop || isMoveBottom) {
    // SPA "temperary fix" at scripts.ts:191-193 — force non-global so
    // matchAll doesn't double-count.
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
): string {
  const script = prepared.script
  const actions = prepared.actions
  if (!script.in) return data

  const { flag, outScript, isMoveTop, isMoveBottom } = prepared

  let reg: RegExp
  if (prepared.isCbs) {
    // `cbs` action: pre-expand the input regex source (scripts.ts:211-213).
    // Per-message by design — the expansion depends on cbsConditions.
    const regexIn = expandVariables(script.in, { ...ctx, cbsConditions }).text
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
    assertBoundedRegexReplacement(outScript, 'customscript action replacement')
    const matched = testBoundedRegex(reg, data, 'customscript action source')
    // reg.test() advances `lastIndex` when the regex is global; both
    // matchAll() and a sticky-style match would then start past the
    // first hit. The SPA shares this bug (scripts.ts:216 then 254).
    // Reset before any downstream use of the same regex object.
    reg.lastIndex = 0
    if (matched) {
      if (outScript.startsWith('@@emo ')) return data
      if (outScript.startsWith('@@inject') || actions.includes('inject')) {
        return applyInject(currentChat, chatID, data, reg)
      }
      if (isMoveTop || isMoveBottom) {
        return applyMove(data, reg, flag, outScript, isMoveTop)
      }
      // Unknown @@ prefix or arbitrary action: fall through to plain replace.
      assertBoundedRegexHaystack(data, 'customscript action replace source')
      assertBoundedRegexReplacement(outScript, 'customscript action replace replacement')
      const replaced = data.replace(reg, outScript)
      return expandVariables(replaced, { ...ctx, cbsConditions }).text
    }
    // No match: only @@repeat_back / the 'repeat_back' action fires.
    if (outScript.startsWith('@@repeat_back') || actions.includes('repeat_back')) {
      return applyRepeatBack(char, currentChat, chatID, data, reg, outScript)
    }
    return data
  }

  assertBoundedRegexHaystack(data, 'customscript replace source')
  assertBoundedRegexReplacement(outScript, 'customscript replace replacement')
  const replaced = data.replace(reg, outScript)
  return expandVariables(replaced, { ...ctx, cbsConditions }).text
}

async function applyMoveAsync(
  data: string,
  reg: BoundedRegexLike,
  outScript: string,
  toTop: boolean,
  options: BoundedRegexCompatibilityOptions,
): Promise<string> {
  if (!isComplexBoundedRegex(reg)) {
    return applyMove(data, reg, reg.flags, outScript, toTop)
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
): Promise<string> {
  if (!isComplexBoundedRegex(reg)) return applyInject(currentChat, chatID, data, reg)

  assertBoundedRegexHaystack(data, 'customscript inject source')
  if (!currentChat || chatID < 0) return data
  const target = currentChat.message?.[chatID]
  if (!target) return data
  target.data = data
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
): Promise<string> {
  const script = prepared.script
  const actions = prepared.actions
  if (!script.in) return data

  const { flag, outScript, isMoveTop, isMoveBottom } = prepared

  let reg: BoundedRegexLike
  if (prepared.isCbs) {
    const regexIn = expandVariables(script.in, { ...ctx, cbsConditions }).text
    reg = compileBoundedRegexWithCompatibility(regexIn, flag, 'customscript cbs script.in pattern', options)
  } else {
    if (!prepared.reg) return data
    reg = prepared.reg
    if (!isComplexBoundedRegex(reg)) reg.lastIndex = 0
  }

  const isAction = outScript.startsWith('@@') || actions.length > 0
  if (isAction) {
    assertBoundedRegexHaystack(data, 'customscript action source')
    assertBoundedRegexReplacement(outScript, 'customscript action replacement')
    const matched = await testBoundedRegexWithCompatibility(reg, data, 'customscript action source', options)
    if (!isComplexBoundedRegex(reg)) reg.lastIndex = 0
    if (matched) {
      if (outScript.startsWith('@@emo ')) return data
      if (outScript.startsWith('@@inject') || actions.includes('inject')) {
        return applyInjectAsync(currentChat, chatID, data, reg, options)
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
      return expandVariables(replaced, { ...ctx, cbsConditions }).text
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
  return expandVariables(replaced, { ...ctx, cbsConditions }).text
}

interface PreparedScriptsMemoEntry {
  /** Inputs the prepared list was computed from, compared by reference. A
   *  request loads a fresh `Database`, so within one assembly these refs are
   *  stable across the whole per-message walk. */
  charRef: character
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
    memo.presetRegexRef === db.presetRegex &&
    memo.customscriptRef === char.customscript &&
    memo.activeModulesRef === activeModules &&
    memo.compatEnabled === (options?.enabled ?? false) &&
    memo.compatStage === (options?.stage ?? null)
  ) {
    return memo.prepared
  }

  const rawScripts = (db.presetRegex ?? []).concat(char.customscript ?? []).concat(getModuleRegexScripts(activeModules))
  const { parsed, orderChanged } = parseScripts(rawScripts)
  if (orderChanged) {
    parsed.sort((a, b) => b.order - a.order)
  }
  const prepared = parsed.map((script) => prepareOne(script, options?.enabled ? options : undefined))
  preparedScriptsMemo.set(db, {
    charRef: char,
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
): string {
  const prepared = getPreparedScripts(ctx.database, char, currentChat)

  let current = data
  for (const p of prepared) {
    if (p.script.type !== mode) continue
    try {
      current = applyOne(ctx, char, current, p, cbsConditions, chatID, currentChat)
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
): Promise<string> {
  const options = complexRegexCompatibilityOptions(ctx.database, stageForScriptMode(mode))
  const prepared = getPreparedScripts(ctx.database, char, currentChat, options)

  let current = data
  for (const p of prepared) {
    if (p.script.type !== mode) continue
    try {
      current = await applyOneAsync(ctx, char, current, p, cbsConditions, chatID, currentChat, options)
    } catch (err) {
      if (isBoundedRegexError(err)) throw err
    }
  }

  return current
}
