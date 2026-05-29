import type {
  Chat,
  character,
  customscript,
} from '../../../../src/ts/storage/database.svelte'
import type { CbsConditions } from '../../../../src/ts/parser/risuChatParserHelpers'
import { expandVariables, type ExpandContext } from './variables.js'
import { getActiveModules, getModuleRegexScripts } from './modules.js'

/**
 * Phase 7-6a/b/c regex script processor ported from
 * `src/ts/process/scripts.ts` `processScript` + `executeScript`.
 *
 * Walks `db.presetRegex ?? []`, then `char.customscript ?? []`, then
 * the regex scripts from the active modules (`getActiveModules` +
 * `getModuleRegexScripts` from `./modules.js`, ported in 7-6d).
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
 * Two documented divergences from the SPA carried over from 7-6b:
 *   - Reset `reg.lastIndex = 0` after the dispatching `reg.test()` so
 *     `@@move_top g` finds all matches (SPA loses the first one via
 *     lastIndex leak; the move dispatch later defangs `g` anyway).
 *   - `@@repeat_back` adds an r-null guard the SPA elides
 *     (`scripts.ts:306` accesses `r[0]` blindly).
 *
 * Deferred to 7-6e:
 *   - script-cache (`generateScriptCacheKey` / `getScriptCache` /
 *     `cacheScript`)
 *   - `runLuaEditTrigger` — `processScript` stays regex-only; the Lua
 *     edit hooks are wired alongside it by the callers. The `editRequest`
 *     hook lands at the final render (`assemble.ts` →
 *     `templates.ts::renderFinalPrompt`, slice 3b sub-slice 2) and the
 *     `editprocess` hook at the two history call sites
 *     (`history.ts`, slice 3b sub-slice 3 — a browser no-op routed through
 *     the runtime). `editinput` is sub-slice 4.
 *   - `runTrigger('display', …)` (orthogonal: `editdisplay` mode only,
 *     blocked on Triggers 7-9)
 *   - `pluginV2[mode]` browser plugin V2 hooks
 *
 * Errors from a single bad regex are swallowed (mirrors the SPA's
 * try/catch at scripts.ts:372-376); the rest of the script list still
 * runs.
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

function applyMove(
  data: string,
  reg: RegExp,
  flag: string,
  outScript: string,
  toTop: boolean,
): string {
  const isGlobal = flag.includes('g')
  const matchAll = isGlobal
    ? Array.from(data.matchAll(reg))
    : [data.match(reg)]
  let next = data.replace(reg, '')
  for (const matched of matchAll) {
    if (!matched) continue
    const template = outScript
      .replace('@@move_top ', '')
      .replace('@@move_bottom ', '')
    const out = substituteMatch(template, matched as RegExpMatchArray)
    next = toTop ? out + '\n' + next : next + '\n' + out
  }
  return next
}

function applyInject(
  currentChat: Chat | undefined,
  chatID: number,
  data: string,
  reg: RegExp,
): string {
  if (!currentChat || chatID < 0) return data
  const target = currentChat.message?.[chatID]
  if (!target) return data
  // SPA mutates message[chatID].data with the FULL pre-strip data (yes,
  // that is intentional in scripts.ts:244-245). Persistence is a Tier 3
  // concern: the chat blob will be re-saved after assembly anyway.
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
  let lastChat =
    fmIndex === -1
      ? currentChar.firstMessage ?? ''
      : currentChar.alternateGreetings?.[fmIndex] ?? ''

  let pointer = chatID - 1
  while (pointer >= 0) {
    if (currentChat.message[pointer].role === target.role) {
      lastChat = currentChat.message[pointer].data
      break
    }
    pointer--
  }

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

function applyOne(
  ctx: ExpandContext,
  char: character,
  data: string,
  parsed: ParsedScript,
  cbsConditions: CbsConditions | undefined,
  chatID: number,
  currentChat: Chat | undefined,
): string {
  const script = parsed.script
  const actions = parsed.actions
  if (!script.in) return data

  // Flag default: 'g' (SPA scripts.ts:182). script.flag is honored only
  // when ableFlag === true (scripts.ts:183-185).
  let flag = 'g'
  if (script.ableFlag) {
    flag = script.flag || 'g'
  }

  // outScript preparation
  let outScript = (script.out ?? '')
    .replaceAll('$n', '\n')
    .replace(DATA_RE, '$&')

  const isMoveTop =
    outScript.startsWith('@@move_top') || actions.includes('move_top')
  const isMoveBottom =
    outScript.startsWith('@@move_bottom') || actions.includes('move_bottom')

  if (isMoveTop || isMoveBottom) {
    // SPA "temperary fix" at scripts.ts:191-193 — force non-global so
    // matchAll doesn't double-count.
    flag = flag.replace('g', '')
  }

  if (outScript.endsWith('>') && !actions.includes('no_end_nl')) {
    outScript += '\n'
  }

  flag = sanitizeFlag(flag)

  // `cbs` action: pre-expand the input regex source (scripts.ts:211-213).
  let regexIn = script.in
  if (actions.includes('cbs')) {
    regexIn = expandVariables(regexIn, { ...ctx, cbsConditions }).text
  }

  const reg = new RegExp(regexIn, flag)

  const isAction = outScript.startsWith('@@') || actions.length > 0
  if (isAction) {
    const matched = reg.test(data)
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
      const replaced = data.replace(reg, outScript)
      return expandVariables(replaced, { ...ctx, cbsConditions }).text
    }
    // No match: only @@repeat_back / the 'repeat_back' action fires.
    if (
      outScript.startsWith('@@repeat_back') ||
      actions.includes('repeat_back')
    ) {
      return applyRepeatBack(char, currentChat, chatID, data, reg, outScript)
    }
    return data
  }

  const replaced = data.replace(reg, outScript)
  return expandVariables(replaced, { ...ctx, cbsConditions }).text
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
  const db = ctx.database
  const moduleRegex = getModuleRegexScripts(
    getActiveModules(db, char, currentChat),
  )
  const rawScripts = (db.presetRegex ?? [])
    .concat(char.customscript ?? [])
    .concat(moduleRegex)
  const { parsed, orderChanged } = parseScripts(rawScripts)
  if (orderChanged) {
    parsed.sort((a, b) => b.order - a.order)
  }

  let current = data
  for (const p of parsed) {
    if (p.script.type !== mode) continue
    try {
      current = applyOne(
        ctx,
        char,
        current,
        p,
        cbsConditions,
        chatID,
        currentChat,
      )
    } catch {
      // Mirror SPA scripts.ts:372-376 — one bad regex shouldn't kill the
      // rest of the script chain. Logging deferred to a later 7-6 slice.
    }
  }

  return current
}
