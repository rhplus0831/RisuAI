import type { Chat, character } from '../../../../src/ts/storage/database.svelte'
import type { triggerEffect } from '../../../../src/ts/process/triggers'
import type { OpenAIChat } from '../../../../src/ts/process/index.svelte'
import { calcString } from '../../../../src/ts/process/infunctions'
import { encodingForModel, tokenize, type TokenEncoding } from './tokens.js'
import {
  assertBoundedRegexHaystack,
  assertBoundedRegexReplacement,
  type BoundedRegexCompatibilityOptions,
  compileBoundedRegex,
  compileBoundedRegexWithCompatibility,
  isBoundedRegexError,
  splitBoundedRegexWithCompatibility,
  testBoundedRegex,
  testBoundedRegexWithCompatibility,
  triggerReplaceBoundedRegexWithCompatibility,
} from './boundedRegex.js'
import type { TriggerVarEngine } from './triggerVars.js'
import {
  getCachedRegexDelimiter,
  getCachedTriggerRegex,
  getRecentTranscriptLower,
  getRecentTranscriptRaw,
  getRecentTranscriptStrictWords,
  type TriggerRunCache,
} from './triggerRunCache.js'

/**
 * V2 trigger "safe data helper" leaf arms, extracted from the `runTrigger`
 * switch in `src/ts/process/triggers.ts`.
 *
 * Every arm here is side-effect-free with respect to prompt assembly:
 * it reads `chat` / `char` and the variable engine, computes, and
 * writes the result back through `engine.setVar`. None of them touch
 * `additonalSysPrompt`, `stopSending`, chat reassignment, or recursion,
 * so they live in their own module dispatched from `runTrigger`'s
 * switch `default` (`applyV2DataEffect` returns `true` when it handled
 * the effect, `false` otherwise).
 *
 * Covered: message readers, string ops, array helpers (JSON-in-var),
 * dict helpers (JSON-in-var), `v2Random`, `v2Calculate` (via the
 * Svelte-free `calcString`), `v2Tokenize` (via `tokens.ts`),
 * `v2ExtractRegex`, `v2RegexTest`, and `v2QuickSearchChat`.
 *
 * Divergence from the SPA: `v2MakeArrayVar` / `v2MakeDictVar` /
 * `v2ClearDict` guard a malformed var name with `return`, which in the
 * SPA exits the whole `runTrigger` (almost certainly an unintended
 * bug, and incompatible with our typed return). Here that guard simply
 * returns from this helper as a handled no-op so the trigger run
 * continues.
 *
 * Request/display state arms (`v2GetDisplayState` /
 * `v2SetDisplayState` and the five request-state arms). Unlike the data
 * helpers above they also write the per-run display/request state slot,
 * carried through `deps.displayState` (a mutable `{ data }` holder) so
 * `runTrigger` can surface the writes on `result.displayData`. They
 * gate on `deps.displayMode`; see the divergence note below.
 *
 * Divergence: each SPA state arm does `if (!arg.displayMode) return`, which
 * aborts the *entire* `runTrigger` (returns `undefined`, almost certainly an
 * unintended bug). As with the make-var guard above we instead `return true`
 * here, a handled no-op so the run continues.
 * The request-state arms otherwise match the SPA exactly, including the
 * un-guarded `JSON.parse(displayState.data)`: in `request` mode the
 * caller contractually supplies a valid `OpenAIChat[]` JSON payload.
 *
 * Unsupported or externally handled effects fall through to `return false`: the
 * persistent character/persona/author-note
 * get+set pairs, the `lowLevelAccess`-gated
 * alert/LLM/image/similarity arms, `command`,
 * `v2UpdateGUI` / `v2UpdateChatAt` / `v2Wait`, and the lorebook arms.
 */

export interface V2DataEffectDeps {
  engine: TriggerVarEngine
  /** The server `expandVariables`-backed parser (`runVar: false`). */
  expand: (text: string) => string
  /** The working (cloned) chat. */
  chat: Chat
  /** The working (cloned) character. */
  char: character
  /** Model id for `v2Tokenize`'s encoder; defaults to `cl100k_base`. */
  model?: string | null
  /** Database-resolved tokenizer used by production trigger runs. */
  tokenizerEncoding?: TokenEncoding
  /** `display` / `request` runs that gate the state arms. */
  displayMode?: boolean
  /** Mutable per-run display/request state slot. */
  displayState?: { data: string | undefined }
  /** Per-run trigger hot-path cache. */
  triggerCache?: TriggerRunCache
  /** Enables isolated-worker fallback for complexity-screened regexes. */
  regexCompatibility?: BoundedRegexCompatibilityOptions
}

function compileTriggerRegexWithCompatibility(deps: V2DataEffectDeps, pattern: string, flags: string, context: string) {
  const options = deps.regexCompatibility
  if (!options?.enabled) {
    return deps.triggerCache
      ? getCachedTriggerRegex(deps.triggerCache, pattern, flags, context)
      : compileBoundedRegex(pattern, flags, context)
  }
  try {
    return deps.triggerCache
      ? getCachedTriggerRegex(deps.triggerCache, pattern, flags, context)
      : compileBoundedRegex(pattern, flags, context)
  } catch (err) {
    return compileBoundedRegexWithCompatibility(pattern, flags, context, options)
  }
}

function compileDelimiterWithCompatibility(deps: V2DataEffectDeps, delimiter: string, context: string) {
  const options = deps.regexCompatibility
  if (!options?.enabled) {
    return deps.triggerCache
      ? getCachedRegexDelimiter(deps.triggerCache, delimiter, context)
      : (() => {
          const regexMatch = delimiter.match(/^\/(.+)\/([gimuy]*)$/)
          if (regexMatch) {
            const [, pattern, flags] = regexMatch
            return compileBoundedRegex(pattern, flags, context)
          }
          return compileBoundedRegex(delimiter, '', context)
        })()
  }
  try {
    return deps.triggerCache
      ? getCachedRegexDelimiter(deps.triggerCache, delimiter, context)
      : (() => {
          const regexMatch = delimiter.match(/^\/(.+)\/([gimuy]*)$/)
          if (regexMatch) {
            const [, pattern, flags] = regexMatch
            return compileBoundedRegex(pattern, flags, context)
          }
          return compileBoundedRegex(delimiter, '', context)
        })()
  } catch (err) {
    const regexMatch = delimiter.match(/^\/(.+)\/([gimuy]*)$/)
    if (regexMatch) {
      const [, pattern, flags] = regexMatch
      return compileBoundedRegexWithCompatibility(pattern, flags, context, options)
    }
    return compileBoundedRegexWithCompatibility(delimiter, '', context, options)
  }
}

export function applyV2DataEffect(effect: triggerEffect, deps: V2DataEffectDeps): boolean {
  const { engine, expand, chat, char } = deps
  const resolve = (raw: string, isValue: boolean): string => (isValue ? expand(raw) : engine.getVar(expand(raw)))

  switch (effect.type) {
    // ---- Message readers ----
    case 'v2GetLastMessage': {
      engine.setVar(expand(effect.outputVar), chat.message[chat.message.length - 1]?.data ?? 'null')
      return true
    }
    case 'v2GetMessageAtIndex': {
      const index = Number(resolve(effect.index, effect.indexType === 'value'))
      engine.setVar(expand(effect.outputVar), chat.message[index]?.data ?? 'null')
      return true
    }
    case 'v2GetMessageCount': {
      engine.setVar(expand(effect.outputVar), chat.message.length.toString())
      return true
    }
    case 'v2GetLastUserMessage': {
      const last = chat.message
        .slice()
        .reverse()
        .find((v) => v.role === 'user')
      engine.setVar(expand(effect.outputVar), last?.data ?? 'null')
      return true
    }
    case 'v2GetLastCharMessage': {
      const last = chat.message
        .slice()
        .reverse()
        .find((v) => v.role === 'char')
      engine.setVar(expand(effect.outputVar), last?.data ?? 'null')
      return true
    }
    case 'v2GetFirstMessage': {
      engine.setVar(
        expand(effect.outputVar),
        chat.fmIndex == null || chat.fmIndex === -1 ? char.firstMessage : char.alternateGreetings[chat.fmIndex],
      )
      return true
    }

    // ---- String ----
    case 'v2GetCharAt': {
      const source = resolve(effect.source, effect.sourceType === 'value')
      const index = Number(resolve(effect.index, effect.indexType === 'value'))
      engine.setVar(expand(effect.outputVar), source[index] ?? 'null')
      return true
    }
    case 'v2GetCharCount': {
      const source = resolve(effect.source, effect.sourceType === 'value')
      engine.setVar(expand(effect.outputVar), source.length.toString())
      return true
    }
    case 'v2ToLowerCase': {
      const source = resolve(effect.source, effect.sourceType === 'value')
      engine.setVar(expand(effect.outputVar), source.toLowerCase())
      return true
    }
    case 'v2ToUpperCase': {
      const source = resolve(effect.source, effect.sourceType === 'value')
      engine.setVar(expand(effect.outputVar), source.toUpperCase())
      return true
    }
    case 'v2SetCharAt': {
      const source = resolve(effect.source, effect.sourceType === 'value')
      const index = Number(resolve(effect.index, effect.indexType === 'value'))
      const value = resolve(effect.value, effect.valueType === 'value')
      const chars = [...source]
      chars[index] = value
      engine.setVar(expand(effect.outputVar), chars.join(''))
      return true
    }
    case 'v2SplitString': {
      const source = resolve(effect.source, effect.sourceType === 'value')
      let delimiter: string
      if (effect.delimiterType === 'var') {
        delimiter = engine.getVar(expand(effect.delimiter))
      } else {
        delimiter = expand(effect.delimiter)
      }
      let result: string[]
      if (effect.delimiterType === 'regex') {
        try {
          const regex = deps.triggerCache
            ? getCachedRegexDelimiter(deps.triggerCache, delimiter, 'trigger v2SplitString delimiter')
            : (() => {
                const regexMatch = delimiter.match(/^\/(.+)\/([gimuy]*)$/)
                if (regexMatch) {
                  const [, pattern, flags] = regexMatch
                  return compileBoundedRegex(pattern, flags, 'trigger v2SplitString delimiter')
                }
                return compileBoundedRegex(delimiter, '', 'trigger v2SplitString delimiter')
              })()
          regex.lastIndex = 0
          assertBoundedRegexHaystack(source, 'trigger v2SplitString source')
          result = source.split(regex)
        } catch (err) {
          if (isBoundedRegexError(err)) throw err
          result = [source]
        }
      } else {
        result = source.split(delimiter)
      }
      engine.setVar(expand(effect.outputVar), JSON.stringify(result))
      return true
    }
    case 'v2ConcatString': {
      const source1 = resolve(effect.source1, effect.source1Type === 'value')
      const source2 = resolve(effect.source2, effect.source2Type === 'value')
      engine.setVar(expand(effect.outputVar), source1 + source2)
      return true
    }
    case 'v2ReplaceString': {
      try {
        const source = resolve(effect.source, effect.sourceType === 'value')
        const regexPattern = resolve(effect.regex, effect.regexType === 'value')
        const resultFormat = resolve(effect.result, effect.resultType === 'value')
        const replacement = resolve(effect.replacement, effect.replacementType === 'value')
        const flags = resolve(effect.flags, effect.flagsType === 'value')
        const regex = deps.triggerCache
          ? getCachedTriggerRegex(deps.triggerCache, regexPattern, flags, 'trigger v2ReplaceString pattern')
          : compileBoundedRegex(regexPattern, flags, 'trigger v2ReplaceString pattern')
        regex.lastIndex = 0
        assertBoundedRegexHaystack(source, 'trigger v2ReplaceString source')
        assertBoundedRegexReplacement(resultFormat, 'trigger v2ReplaceString result template')
        assertBoundedRegexReplacement(replacement, 'trigger v2ReplaceString replacement')
        const result = source.replace(regex, (...args) => {
          const match = args[0] as string
          const groups = args.slice(1, -2) as string[]
          const targetGroupMatch = resultFormat.match(/^\$(\d+)$/)
          if (targetGroupMatch) {
            const targetIndex = Number(targetGroupMatch[1])
            if (targetIndex === 0) {
              return replacement
            }
            const targetGroup = groups[targetIndex - 1]
            if (targetGroup) {
              return match.replace(targetGroup, replacement)
            }
          }
          return resultFormat
            .replace(/\$[0-9]+/g, (placeholder) => {
              const index = Number(placeholder.slice(1))
              return index === 0 ? match : groups[index - 1] || ''
            })
            .replace(/\$&/g, match)
            .replace(/\$\$/g, '$')
        })
        engine.setVar(expand(effect.outputVar), result)
      } catch (err) {
        if (isBoundedRegexError(err)) throw err
        engine.setVar(expand(effect.outputVar), resolve(effect.source, effect.sourceType === 'value'))
      }
      return true
    }

    // ---- Array (JSON-in-var) ----
    case 'v2MakeArrayVar': {
      const varName = expand(effect.var)
      if (varName.startsWith('[') && varName.endsWith(']')) {
        return true
      }
      engine.setVar(varName, '[]')
      return true
    }
    case 'v2GetArrayVarLength': {
      const outVar = expand(effect.outputVar)
      try {
        const arr = JSON.parse(engine.getVar(expand(effect.var)))
        engine.setVar(outVar, arr.length.toString())
      } catch {
        engine.setVar(outVar, '0')
      }
      return true
    }
    case 'v2GetArrayVar': {
      const outVar = expand(effect.outputVar)
      try {
        const arr = JSON.parse(engine.getVar(expand(effect.var)))
        const index = Number(resolve(effect.index, effect.indexType === 'value'))
        engine.setVar(outVar, arr[index] ?? 'null')
      } catch {
        engine.setVar(outVar, 'null')
      }
      return true
    }
    case 'v2SetArrayVar': {
      const value = resolve(effect.value, effect.valueType === 'value')
      const index = Number(resolve(effect.index, effect.indexType === 'value'))
      if (Number.isNaN(index)) {
        return true
      }
      try {
        const varName = expand(effect.var)
        const arr = JSON.parse(engine.getVar(varName))
        arr[index] = value
        engine.setVar(varName, JSON.stringify(arr))
      } catch {
        // intentionally ignored (SPA parity)
      }
      return true
    }
    case 'v2PushArrayVar': {
      const varName = expand(effect.var)
      try {
        const arr = JSON.parse(engine.getVar(varName))
        arr.push(resolve(effect.value, effect.valueType === 'value'))
        engine.setVar(varName, JSON.stringify(arr))
      } catch {
        engine.setVar(varName, '[]')
      }
      return true
    }
    case 'v2PopArrayVar': {
      const varName = expand(effect.var)
      const outVar = expand(effect.outputVar)
      try {
        const arr = JSON.parse(engine.getVar(varName))
        engine.setVar(outVar, arr.pop() ?? 'null')
        engine.setVar(varName, JSON.stringify(arr))
      } catch {
        engine.setVar(varName, '[]')
        engine.setVar(outVar, 'null')
      }
      return true
    }
    case 'v2ShiftArrayVar': {
      const varName = expand(effect.var)
      const outVar = expand(effect.outputVar)
      try {
        const arr = JSON.parse(engine.getVar(varName))
        engine.setVar(outVar, arr.shift() ?? 'null')
        engine.setVar(varName, JSON.stringify(arr))
      } catch {
        engine.setVar(varName, '[]')
        engine.setVar(outVar, 'null')
      }
      return true
    }
    case 'v2UnshiftArrayVar': {
      const varName = expand(effect.var)
      try {
        const arr = JSON.parse(engine.getVar(varName))
        arr.unshift(resolve(effect.value, effect.valueType === 'value'))
        engine.setVar(varName, JSON.stringify(arr))
      } catch {
        engine.setVar(varName, '[]')
      }
      return true
    }
    case 'v2SpliceArrayVar': {
      const varName = expand(effect.var)
      try {
        const arr = JSON.parse(engine.getVar(varName))
        const start = Number(resolve(effect.start, effect.startType === 'value'))
        const value = resolve(effect.item, effect.itemType === 'value')
        arr.splice(start, 0, value)
        engine.setVar(varName, JSON.stringify(arr))
      } catch {
        engine.setVar(varName, '[]')
      }
      return true
    }
    case 'v2SliceArrayVar': {
      const outVar = expand(effect.outputVar)
      try {
        const arr = JSON.parse(engine.getVar(expand(effect.var)))
        const start = Number(resolve(effect.start, effect.startType === 'value'))
        const end = Number(resolve(effect.end, effect.endType === 'value'))
        engine.setVar(outVar, JSON.stringify(arr.slice(start, end)))
      } catch {
        engine.setVar(outVar, '[]')
      }
      return true
    }
    case 'v2GetIndexOfValueInArrayVar': {
      const outVar = expand(effect.outputVar)
      try {
        const arr = JSON.parse(engine.getVar(expand(effect.var)))
        const value = resolve(effect.value, effect.valueType === 'value')
        engine.setVar(outVar, arr.indexOf(value).toString())
      } catch {
        engine.setVar(outVar, '-1')
      }
      return true
    }
    case 'v2RemoveIndexFromArrayVar': {
      const varName = expand(effect.var)
      try {
        const arr = JSON.parse(engine.getVar(varName))
        const index = Number(resolve(effect.index, effect.indexType === 'value'))
        arr.splice(index, 1)
        engine.setVar(varName, JSON.stringify(arr))
      } catch {
        engine.setVar(varName, '[]')
      }
      return true
    }
    case 'v2JoinArrayVar': {
      const outVar = expand(effect.outputVar)
      try {
        const arr = JSON.parse(resolve(effect.var, effect.varType === 'value'))
        const delimiter = resolve(effect.delimiter, effect.delimiterType === 'value')
        engine.setVar(outVar, arr.join(delimiter))
      } catch {
        engine.setVar(outVar, '')
      }
      return true
    }

    // ---- Dict (JSON-in-var) ----
    case 'v2MakeDictVar': {
      if (effect.var.startsWith('{') && effect.var.endsWith('}')) {
        return true
      }
      engine.setVar(expand(effect.var), '{}')
      return true
    }
    case 'v2GetDictVar': {
      const outVar = expand(effect.outputVar)
      try {
        const dict = JSON.parse(resolve(effect.var, effect.varType === 'value'))
        const key = resolve(effect.key, effect.keyType === 'value')
        engine.setVar(outVar, dict[key] ?? 'null')
      } catch {
        engine.setVar(outVar, 'null')
      }
      return true
    }
    case 'v2SetDictVar': {
      const value = resolve(effect.value, effect.valueType === 'value')
      const key = resolve(effect.key, effect.keyType === 'value')
      if (effect.varType === 'value') {
        return true
      }
      try {
        const dict = JSON.parse(engine.getVar(expand(effect.var)))
        dict[key] = value
        engine.setVar(expand(effect.var), JSON.stringify(dict))
      } catch {
        const dict: Record<string, string> = {}
        dict[key] = value
        engine.setVar(expand(effect.var), JSON.stringify(dict))
      }
      return true
    }
    case 'v2DeleteDictKey': {
      if (effect.varType === 'value') {
        return true
      }
      try {
        const dict = JSON.parse(engine.getVar(expand(effect.var)))
        delete dict[resolve(effect.key, effect.keyType === 'value')]
        engine.setVar(expand(effect.var), JSON.stringify(dict))
      } catch {
        engine.setVar(expand(effect.var), '{}')
      }
      return true
    }
    case 'v2HasDictKey': {
      const outVar = expand(effect.outputVar)
      try {
        const dict = JSON.parse(resolve(effect.var, effect.varType === 'value'))
        const key = resolve(effect.key, effect.keyType === 'value')
        engine.setVar(outVar, Object.hasOwn(dict, key) ? '1' : '0')
      } catch {
        engine.setVar(outVar, '0')
      }
      return true
    }
    case 'v2ClearDict': {
      if (effect.var.startsWith('{') && effect.var.endsWith('}')) {
        return true
      }
      engine.setVar(expand(effect.var), '{}')
      return true
    }
    case 'v2GetDictSize': {
      const outVar = expand(effect.outputVar)
      try {
        const dict = JSON.parse(resolve(effect.var, effect.varType === 'value'))
        engine.setVar(outVar, Object.keys(dict).length.toString())
      } catch {
        engine.setVar(outVar, '0')
      }
      return true
    }
    case 'v2GetDictKeys': {
      const outVar = expand(effect.outputVar)
      try {
        const dict = JSON.parse(resolve(effect.var, effect.varType === 'value'))
        engine.setVar(outVar, JSON.stringify(Object.keys(dict)))
      } catch {
        engine.setVar(outVar, '[]')
      }
      return true
    }
    case 'v2GetDictValues': {
      const outVar = expand(effect.outputVar)
      try {
        const dict = JSON.parse(resolve(effect.var, effect.varType === 'value'))
        engine.setVar(outVar, JSON.stringify(Object.values(dict)))
      } catch {
        engine.setVar(outVar, '[]')
      }
      return true
    }

    // ---- Math / misc ----
    case 'v2Random': {
      const min = Number(resolve(effect.min, effect.minType === 'value'))
      const max = Number(resolve(effect.max, effect.maxType === 'value'))
      const output = Math.floor(Math.random() * (max - min + 1) + min)
      engine.setVar(expand(effect.outputVar), output.toString())
      return true
    }
    case 'v2Calculate': {
      const outVar = expand(effect.outputVar)
      try {
        let expression = resolve(effect.expression, effect.expressionType === 'value')
        expression = expression.replace(/\$([a-zA-Z0-9_]+)/g, (_, varName) => {
          const parsed = parseFloat(engine.getVar(varName))
          return isNaN(parsed) ? '0' : parsed.toString()
        })
        engine.setVar(outVar, (calcString(expression) ?? 0).toString())
      } catch {
        engine.setVar(outVar, '0')
      }
      return true
    }
    case 'v2Tokenize': {
      const value = resolve(effect.value, effect.valueType === 'value')
      engine.setVar(
        expand(effect.outputVar),
        tokenize(value, deps.tokenizerEncoding ?? encodingForModel(deps.model)).toString(),
      )
      return true
    }
    case 'v2RegexTest': {
      const outVar = expand(effect.outputVar)
      try {
        const value = resolve(effect.value, effect.valueType === 'value')
        const regexPattern = resolve(effect.regex, effect.regexType === 'value')
        const flags = resolve(effect.flags, effect.flagsType === 'value')
        const regex = deps.triggerCache
          ? getCachedTriggerRegex(deps.triggerCache, regexPattern, flags, 'trigger v2RegexTest pattern')
          : compileBoundedRegex(regexPattern, flags, 'trigger v2RegexTest pattern')
        engine.setVar(outVar, testBoundedRegex(regex, value, 'trigger v2RegexTest value') ? '1' : '0')
      } catch (err) {
        if (isBoundedRegexError(err)) throw err
        engine.setVar(outVar, '0')
      }
      return true
    }
    case 'v2QuickSearchChat': {
      const outVar = expand(effect.outputVar)
      const value = resolve(effect.value, effect.valueType === 'value')
      const depth = Number(resolve(effect.depth, effect.depthType === 'value'))
      if (isNaN(depth)) {
        engine.setVar(outVar, '0')
        return true
      }
      let pass = false
      if (effect.condition === 'strict') {
        pass = deps.triggerCache
          ? getRecentTranscriptStrictWords(deps.triggerCache, chat, depth).has(value)
          : chat.message
              .slice(0 - depth)
              .map((v) => v.data)
              .join(' ')
              .split(' ')
              .includes(value)
      } else if (effect.condition === 'loose') {
        pass = deps.triggerCache
          ? getRecentTranscriptLower(deps.triggerCache, chat, depth).includes(value.toLowerCase())
          : chat.message
              .slice(0 - depth)
              .map((v) => v.data)
              .join(' ')
              .toLowerCase()
              .includes(value.toLowerCase())
      } else if (effect.condition === 'regex') {
        const da = deps.triggerCache
          ? getRecentTranscriptRaw(deps.triggerCache, chat, depth)
          : chat.message
              .slice(0 - depth)
              .map((v) => v.data)
              .join(' ')
        const regex = deps.triggerCache
          ? getCachedTriggerRegex(deps.triggerCache, value, '', 'trigger v2QuickSearchChat pattern')
          : compileBoundedRegex(value, '', 'trigger v2QuickSearchChat pattern')
        pass = testBoundedRegex(regex, da, 'trigger v2QuickSearchChat transcript')
      }
      engine.setVar(outVar, pass ? '1' : '0')
      return true
    }

    // ---- Display state ----
    case 'v2GetDisplayState': {
      if (!deps.displayMode) {
        return true
      }
      engine.setVar(expand(effect.outputVar), deps.displayState?.data ?? 'null')
      return true
    }
    case 'v2SetDisplayState': {
      if (!deps.displayMode) {
        return true
      }
      if (deps.displayState) {
        deps.displayState.data = resolve(effect.value, effect.valueType === 'value')
      }
      return true
    }

    // ---- Request state over JSON.parse(displayState.data) ----
    case 'v2GetRequestState': {
      if (!deps.displayMode) {
        return true
      }
      const json = JSON.parse(deps.displayState?.data ?? 'null') as OpenAIChat[]
      const index = Number(resolve(effect.index, effect.indexType === 'value'))
      engine.setVar(expand(effect.outputVar), json?.[index]?.content ?? 'null')
      return true
    }
    case 'v2SetRequestState': {
      if (!deps.displayMode) {
        return true
      }
      const json = JSON.parse(deps.displayState?.data ?? 'null') as OpenAIChat[]
      const index = Number(resolve(effect.index, effect.indexType === 'value'))
      json[index].content = resolve(effect.value, effect.valueType === 'value')
      if (deps.displayState) {
        deps.displayState.data = JSON.stringify(json)
      }
      return true
    }
    case 'v2GetRequestStateRole': {
      if (!deps.displayMode) {
        return true
      }
      const json = JSON.parse(deps.displayState?.data ?? 'null') as OpenAIChat[]
      const index = Number(resolve(effect.index, effect.indexType === 'value'))
      engine.setVar(expand(effect.outputVar), json?.[index]?.role ?? 'null')
      return true
    }
    case 'v2SetRequestStateRole': {
      if (!deps.displayMode) {
        return true
      }
      const json = JSON.parse(deps.displayState?.data ?? 'null') as OpenAIChat[]
      const index = Number(resolve(effect.index, effect.indexType === 'value'))
      const value = resolve(effect.value, effect.valueType === 'value')
      if (value === 'user' || value === 'assistant' || value === 'system') {
        json[index].role = value
      }
      if (deps.displayState) {
        deps.displayState.data = JSON.stringify(json)
      }
      return true
    }
    case 'v2GetRequestStateLength': {
      if (!deps.displayMode) {
        return true
      }
      const json = JSON.parse(deps.displayState?.data ?? 'null') as OpenAIChat[]
      engine.setVar(expand(effect.outputVar), json.length.toString())
      return true
    }

    default:
      return false
  }
}

export async function applyV2DataEffectAsync(effect: triggerEffect, deps: V2DataEffectDeps): Promise<boolean> {
  const { engine, expand, chat } = deps
  const resolve = (raw: string, isValue: boolean): string => (isValue ? expand(raw) : engine.getVar(expand(raw)))
  const options = deps.regexCompatibility

  if (effect.type === 'v2ExtractRegex') {
    const value = resolve(effect.value, effect.valueType === 'value')
    const regexPattern = resolve(effect.regex, effect.regexType === 'value')
    const flags = resolve(effect.flags, effect.flagsType === 'value')
    const resultFormat = resolve(effect.result, effect.resultType === 'value')
    const regex = deps.triggerCache
      ? getCachedTriggerRegex(deps.triggerCache, regexPattern, flags, 'trigger v2ExtractRegex pattern')
      : compileBoundedRegex(regexPattern, flags, 'trigger v2ExtractRegex pattern')
    assertBoundedRegexHaystack(value, 'trigger v2ExtractRegex value')
    assertBoundedRegexReplacement(resultFormat, 'trigger v2ExtractRegex result template')
    regex.lastIndex = 0
    const matched = regex.exec(value)
    const result = resultFormat
      .replace(/\$[0-9]+/g, (placeholder) => {
        const index = Number(placeholder.slice(1))
        return matched?.[index] || ''
      })
      .replace(/\$&/g, matched?.[0] || '')
      .replace(/\$\$/g, '$')
    engine.setVar(expand(effect.outputVar), result)
    return true
  }

  if (effect.type === 'v2SplitString' && effect.delimiterType === 'regex') {
    const source = resolve(effect.source, effect.sourceType === 'value')
    const delimiter = expand(effect.delimiter)
    let result: string[]
    try {
      const regex = compileDelimiterWithCompatibility(deps, delimiter, 'trigger v2SplitString delimiter')
      result = options?.enabled
        ? await splitBoundedRegexWithCompatibility(regex, source, 'trigger v2SplitString source', options)
        : (() => {
            assertBoundedRegexHaystack(source, 'trigger v2SplitString source')
            return source.split(regex as RegExp)
          })()
    } catch (err) {
      if (isBoundedRegexError(err)) throw err
      result = [source]
    }
    engine.setVar(expand(effect.outputVar), JSON.stringify(result))
    return true
  }

  if (effect.type === 'v2ReplaceString') {
    try {
      const source = resolve(effect.source, effect.sourceType === 'value')
      const regexPattern = resolve(effect.regex, effect.regexType === 'value')
      const resultFormat = resolve(effect.result, effect.resultType === 'value')
      const replacement = resolve(effect.replacement, effect.replacementType === 'value')
      const flags = resolve(effect.flags, effect.flagsType === 'value')
      const regex = compileTriggerRegexWithCompatibility(deps, regexPattern, flags, 'trigger v2ReplaceString pattern')
      const result = options?.enabled
        ? await triggerReplaceBoundedRegexWithCompatibility(
            regex,
            source,
            resultFormat,
            replacement,
            'trigger v2ReplaceString source',
            'trigger v2ReplaceString result template',
            'trigger v2ReplaceString replacement',
            options,
          )
        : (() => {
            assertBoundedRegexHaystack(source, 'trigger v2ReplaceString source')
            assertBoundedRegexReplacement(resultFormat, 'trigger v2ReplaceString result template')
            assertBoundedRegexReplacement(replacement, 'trigger v2ReplaceString replacement')
            return source.replace(regex as RegExp, (...args) => {
              const match = args[0] as string
              const groups = args.slice(1, -2) as string[]
              const targetGroupMatch = resultFormat.match(/^\$(\d+)$/)
              if (targetGroupMatch) {
                const targetIndex = Number(targetGroupMatch[1])
                if (targetIndex === 0) {
                  return replacement
                }
                const targetGroup = groups[targetIndex - 1]
                if (targetGroup) {
                  return match.replace(targetGroup, replacement)
                }
              }
              return resultFormat
                .replace(/\$[0-9]+/g, (placeholder) => {
                  const index = Number(placeholder.slice(1))
                  return index === 0 ? match : groups[index - 1] || ''
                })
                .replace(/\$&/g, match)
                .replace(/\$\$/g, '$')
            })
          })()
      engine.setVar(expand(effect.outputVar), result)
    } catch (err) {
      if (isBoundedRegexError(err)) throw err
      engine.setVar(expand(effect.outputVar), resolve(effect.source, effect.sourceType === 'value'))
    }
    return true
  }

  if (effect.type === 'v2RegexTest') {
    const outVar = expand(effect.outputVar)
    try {
      const value = resolve(effect.value, effect.valueType === 'value')
      const regexPattern = resolve(effect.regex, effect.regexType === 'value')
      const flags = resolve(effect.flags, effect.flagsType === 'value')
      const regex = compileTriggerRegexWithCompatibility(deps, regexPattern, flags, 'trigger v2RegexTest pattern')
      const pass = options?.enabled
        ? await testBoundedRegexWithCompatibility(regex, value, 'trigger v2RegexTest value', options)
        : testBoundedRegex(regex as RegExp, value, 'trigger v2RegexTest value')
      engine.setVar(outVar, pass ? '1' : '0')
    } catch (err) {
      if (isBoundedRegexError(err)) throw err
      engine.setVar(outVar, '0')
    }
    return true
  }

  if (effect.type === 'v2QuickSearchChat' && effect.condition === 'regex') {
    const outVar = expand(effect.outputVar)
    const value = resolve(effect.value, effect.valueType === 'value')
    const depth = Number(resolve(effect.depth, effect.depthType === 'value'))
    if (isNaN(depth)) {
      engine.setVar(outVar, '0')
      return true
    }
    const da = deps.triggerCache
      ? getRecentTranscriptRaw(deps.triggerCache, chat, depth)
      : chat.message
          .slice(0 - depth)
          .map((v) => v.data)
          .join(' ')
    const regex = compileTriggerRegexWithCompatibility(deps, value, '', 'trigger v2QuickSearchChat pattern')
    const pass = options?.enabled
      ? await testBoundedRegexWithCompatibility(regex, da, 'trigger v2QuickSearchChat transcript', options)
      : testBoundedRegex(regex as RegExp, da, 'trigger v2QuickSearchChat transcript')
    engine.setVar(outVar, pass ? '1' : '0')
    return true
  }

  return applyV2DataEffect(effect, deps)
}
