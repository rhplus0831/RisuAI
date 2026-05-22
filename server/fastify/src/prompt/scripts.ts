import type {
  character,
  customscript,
} from '../../../../src/ts/storage/database.svelte'
import type { CbsConditions } from '../../../../src/ts/parser/risuChatParserHelpers'
import { expandVariables, type ExpandContext } from './variables.js'

/**
 * Phase 7-6a minimal regex script processor ported from
 * `src/ts/process/scripts.ts` `processScript` + `executeScript`.
 *
 * Walks `db.presetRegex ?? []` then `char.customscript ?? []`, runs each
 * script where `script.type === mode` as a plain `RegExp.replace`, then
 * routes the replaced text through `expandVariables` (matches the SPA's
 * `risuChatParser(data.replace(reg, outScript), {chatID, cbsConditions})`
 * at scripts.ts:285,328).
 *
 * Deferred to 7-6b/c/d/e:
 *   - `@@emo`, `@@move_top`, `@@move_bottom`, `@@inject`, `@@repeat_back`
 *     action prefixes
 *   - `ableFlag` + `<order, actions>` flag-meta DSL
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

function applyOne(
  ctx: ExpandContext,
  data: string,
  script: customscript,
  cbsConditions: CbsConditions | undefined,
): string {
  if (!script.in) return data
  const flag = sanitizeFlag(script.flag)
  const reg = new RegExp(script.in, flag)
  const outScript = (script.out ?? '').replaceAll('$n', '\n')
  const replaced = data.replace(reg, outScript)
  return expandVariables(replaced, { ...ctx, cbsConditions }).text
}

export function processScript(
  ctx: ExpandContext,
  char: character,
  data: string,
  mode: ScriptMode,
  cbsConditions: CbsConditions = {},
): string {
  const db = ctx.database
  const scripts = (db.presetRegex ?? []).concat(char.customscript ?? [])

  let current = data
  for (const script of scripts) {
    if (script.type !== mode) continue
    try {
      current = applyOne(ctx, current, script, cbsConditions)
    } catch {
      // Mirror SPA scripts.ts:372-376 - one bad regex shouldn't kill the
      // rest of the script chain. Logging deferred to a later 7-6 slice.
    }
  }

  return current
}
