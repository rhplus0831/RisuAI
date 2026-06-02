import type { CBSRegisterArg, matcherArg } from '../../../../src/ts/cbs'
import type { LLMModel } from '../../../../src/ts/model/modellist'
import { risuChatParser } from '../../../../src/ts/parser/risuChatParser'
import {
  dateTimeFormat,
  makeArray,
  parseArray,
  parseDict,
} from '../../../../src/ts/parser/risuChatParserHelpers'
import { calcString } from '../../../../src/ts/process/infunctions'
import { getChatVar, getGlobalChatVar, setChatVar } from '../../../../src/ts/parser/chatVarBackend'
import { getActiveDatabase, getActiveSelectedCharID } from './promptScope.js'

/**
 * Server-side `CBSRegisterArg` factory. Wires the 24 DI fields the
 * `registerCBS` infrastructure expects, reading dynamic context
 * (`database`, `selectedCharID`, `userName`, `personaPrompt`) from the
 * active `promptScope` singleton rather than from `DBState` /
 * Svelte stores.
 *
 * Browser-only callbacks like `{{screenwidth}}`, `{{metadata::browserlanguage}}`,
 * and the HTML emitters (`{{button}}`, `{{tex}}`, `{{ruby}}`, `{{codeblock}}`)
 * register with their original `cbs.ts` bodies, which reference `window`
 * / `navigator` / DOM globals and will throw at invocation on the
 * server. Prompt-assembly paths do not invoke them; fix per fixture if any
 * future preset reaches them.
 *
 * `getCurrentTriggerId` returns `'null'` because manual triggers are a
 * browser UI concept.
 *
 * `getModelInfo` returns a placeholder shape (same as
 * `defaultCBSRegisterArg`). The chat route does not yet need the real model
 * metadata at variable-expansion time; revisit when it does.
 */

// In-process pseudo-random generator, ported from src/ts/util.ts:604.
function sfc32(a: number, b: number, c: number, d: number): () => number {
  return () => {
    a |= 0
    b |= 0
    c |= 0
    d |= 0
    const t = (((a + b) | 0) + d) | 0
    d = (d + 1) | 0
    a = b ^ (b >>> 9)
    b = (c + (c << 3)) | 0
    c = (c << 21) | (c >>> 11)
    c = (c + t) | 0
    return (t >>> 0) / 4294967296
  }
}

// Deterministic hash-seeded RNG, ported from src/ts/util.ts:1140.
function pickHashRand(cid: number, word: string): number {
  let hashAddress = 5515
  const rand = (w: string) => {
    for (let i = 0; i < w.length; i++) {
      hashAddress = (hashAddress << 5) + hashAddress + w.charCodeAt(i)
    }
    return hashAddress
  }
  const randF = sfc32(rand(word), rand(word), rand(word), rand(word))
  const v = cid % 1000
  for (let i = 0; i < v; i++) randF()
  return randF()
}

const PLACEHOLDER_MODEL: LLMModel = {
  id: 'placeholder',
  name: 'Placeholder Model',
  shortName: 'Placeholder',
  internalID: 'placeholder',
  format: 0,
  provider: 0,
  tokenizer: 0,
} as LLMModel

export function buildServerCBSArg(): Omit<CBSRegisterArg, 'registerFunction'> {
  return {
    getDatabase: () => {
      const db = getActiveDatabase()
      if (!db) {
        throw new Error('promptScope not set; call setActivePromptScope before expandVariables')
      }
      return db
    },
    getUserName: () => {
      const db = getActiveDatabase()
      return db?.username ?? 'User'
    },
    getPersonaPrompt: () => {
      const db = getActiveDatabase()
      return db?.personaPrompt ?? ''
    },
    risuChatParser: (text: string, arg: matcherArg) =>
      risuChatParser(text, {
        chatID: arg.chatID,
        db: arg.db,
        chara: arg.chara ?? undefined,
        rmVar: arg.rmVar,
        var: arg.var,
        tokenizeAccurate: arg.tokenizeAccurate,
        consistantChar: arg.consistantChar,
        role: arg.role,
        runVar: arg.runVar,
        cbsConditions: arg.cbsConditions,
      }),
    makeArray,
    safeStructuredClone: <T>(obj: T) => structuredClone(obj),
    parseArray,
    parseDict,
    // cbs.ts callbacks like {{getvar}} / {{setvar}} close over these
    // destructured fields. Route them through the chatVarBackend DI
    // seam so both the cbs path and the parser's #when evaluator
    // resolve to the same server-side promptScope chatVarBackend.
    getChatVar,
    setChatVar,
    getGlobalChatVar,
    calcString: (str: string) => calcString(str) ?? 0,
    dateTimeFormat,
    // Module + lorebook callbacks are not available in this server adapter yet.
    getModules: () => [],
    getModuleLorebooks: () => [],
    pickHashRand,
    getSelectedCharID: getActiveSelectedCharID,
    getModelInfo: () => PLACEHOLDER_MODEL,
    callInternalFunction: () => '',
    isMobile: false,
    appVer: '2026.4.181',
    getCurrentTriggerId: () => 'null',
  }
}
