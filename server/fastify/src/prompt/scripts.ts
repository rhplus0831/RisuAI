import type {
  Chat,
  character,
  customscript,
} from '../../../../src/ts/storage/database.svelte'
import type { CbsConditions } from '../../../../src/ts/parser/risuChatParserHelpers'
import { expandVariables, type ExpandContext } from './variables.js'

/**
 * Phase 7-6a/b regex script processor ported from
 * `src/ts/process/scripts.ts` `processScript` + `executeScript`.
 *
 * Walks `db.presetRegex ?? []` then `char.customscript ?? []`, runs each
 * script where `script.type === mode`. The plain branch is a
 * `RegExp.replace` routed through `expandVariables` (matches the SPA's
 * `risuChatParser(data.replace(reg, outScript), {chatID, cbsConditions})`
 * at scripts.ts:285,328).
 *
 * 7-6b adds the four server-implementable `@@`-prefixed action paths:
 *   - `@@emo …` — browser-only emotion-image side effect; no-op on the
 *     server.
 *   - `@@inject` (chatID !== -1) — overwrites the chat message at
 *     `chatID` with the current `data` and strips the matched portion.
 *   - `@@move_top` / `@@move_bottom` — extract matched text (global flag
 *     respects `g`), substitute `$1` / `$&` / `$<…>` against each match,
 *     then prepend / append the result to `data` with a newline.
 *   - `@@repeat_back [end|start|end_nl|start_nl]` (chatID !== -1) — fires
 *     when the inner regex does NOT match `data`; reads the previous
 *     same-role message body (falls back to `firstMessage` /
 *     `alternateGreetings[fmIndex]`), and appends / prepends its first
 *     match to `data` per the positional modifier.
 *
 * Deferred to 7-6c/d/e:
 *   - `ableFlag` + `<order, actions>` flag-meta DSL (so per-script
 *     `actions: string[]` stays empty)
 *   - the `cbs` action's pre-script CBS expansion of `script.in`
 *   - script-cache (`generateScriptCacheKey` / `getScriptCache` / `cacheScript`)
 *   - `runLuaEditTrigger` (browser-only)
 *   - `runTrigger('display', …)` (orthogonal: `editdisplay` mode only)
 *   - `pluginV2[mode]` browser plugin V2 hooks
 *   - module regex scripts (`getModuleRegexScripts()`)
 *
 * Errors from a single bad regex are swallowed (mirrors the SPA's
 * try/catch at scripts.ts:372-376); the rest of the script list still
 * runs.
 */

export type ScriptMode = 'editinput' | 'editoutput' | 'editprocess' | 'editdisplay'

const VALID_FLAG_CHARS = /[^dgimsuvy]/g

function sanitizeFlag(flag: string | undefined): string {
  if (!flag) return 'u'
  let f = flag.trim().replace(VALID_FLAG_CHARS, '')
  f = f
    .split('')
    .filter((v, i, a) => a.indexOf(v) === i)
    .join('')
  return f.length === 0 ? 'u' : f
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
  script: customscript,
  cbsConditions: CbsConditions | undefined,
  chatID: number,
  currentChat: Chat | undefined,
): string {
  if (!script.in) return data
  const flag = sanitizeFlag(script.flag)
  const reg = new RegExp(script.in, flag)
  const outScript = (script.out ?? '').replaceAll('$n', '\n')

  if (outScript.startsWith('@@')) {
    const matched = reg.test(data)
    // reg.test() advances `lastIndex` when the regex is global; both
    // matchAll() and a sticky-style match would then start past the
    // first hit. The SPA shares this bug (scripts.ts:216 then 254).
    // Reset before any downstream use of the same regex object.
    reg.lastIndex = 0
    if (matched) {
      if (outScript.startsWith('@@emo ')) return data
      if (outScript.startsWith('@@inject')) {
        return applyInject(currentChat, chatID, data, reg)
      }
      if (outScript.startsWith('@@move_top')) {
        return applyMove(data, reg, flag, outScript, true)
      }
      if (outScript.startsWith('@@move_bottom')) {
        return applyMove(data, reg, flag, outScript, false)
      }
      // Unknown @@ prefix: fall through to plain replace.
      const replaced = data.replace(reg, outScript)
      return expandVariables(replaced, { ...ctx, cbsConditions }).text
    }
    // No match: only @@repeat_back fires here.
    if (outScript.startsWith('@@repeat_back')) {
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
  const scripts = (db.presetRegex ?? []).concat(char.customscript ?? [])

  let current = data
  for (const script of scripts) {
    if (script.type !== mode) continue
    try {
      current = applyOne(
        ctx,
        char,
        current,
        script,
        cbsConditions,
        chatID,
        currentChat,
      )
    } catch {
      // Mirror SPA scripts.ts:372-376 - one bad regex shouldn't kill the
      // rest of the script chain. Logging deferred to a later 7-6 slice.
    }
  }

  return current
}
