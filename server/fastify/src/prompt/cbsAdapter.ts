import type { CBSRegisterArg, matcherArg } from '../../../../src/ts/cbs'
import { risuChatParser } from '../../../../src/ts/parser/risuChatParser'
import { dateTimeFormat, makeArray, parseArray, parseDict } from '../../../../src/ts/parser/risuChatParserHelpers'
import { calcString } from '../../../../src/ts/process/infunctions'
import { getChatVar, getGlobalChatVar, setChatVar } from '../../../../src/ts/parser/chatVarBackend'
import { getActiveChatPage, getActiveDatabase, getActiveModelInfo, getActiveSelectedCharID } from './promptScope.js'
import { getActiveModules, getModuleLorebooks } from './modules.js'

/**
 * Server-side `CBSRegisterArg` factory. Wires the DI fields the `registerCBS`
 * infrastructure expects, reading dynamic context
 * (`database`, `selectedCharID`, `userName`, `personaPrompt`) from the
 * active `promptScope` singleton rather than from browser resource state or
 * Svelte stores.
 *
 * Browser-context callbacks like `{{screenwidth}}` and
 * `{{metadata::browserlanguage}}` register with their original `cbs.ts` bodies,
 * which reference `window` / `navigator` globals and will throw at invocation on
 * the server.
 *
 * `getCurrentTriggerId` returns `'null'` because manual triggers are a
 * browser UI concept.
 *
 * Model metadata is read lazily from the active prompt scope so CBS sees the
 * same resolved profile/request model that assembly sends to dispatch.
 */

// In-process pseudo-random generator, ported from src/ts/util/loreHash.ts.
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

// Deterministic hash-seeded RNG, ported from src/ts/util/loreHash.ts.
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

function getScopedModules() {
  const database = getActiveDatabase()
  if (!database) return []
  const currentChar = database.characters[getActiveSelectedCharID()]
  const currentChat = currentChar?.chats[getActiveChatPage()]
  return getActiveModules(database, currentChar, currentChat)
}

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
        callbackMemo: arg.callbackMemo,
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
    // Match the browser parser's module scope: database-enabled, current-chat,
    // current-character, and effective prompt/agent module integration.
    getModules: getScopedModules,
    getModuleLorebooks: () => getModuleLorebooks(getScopedModules()),
    pickHashRand,
    getSelectedCharID: getActiveSelectedCharID,
    getModelInfo: getActiveModelInfo,
    callInternalFunction: () => '',
    isMobile: false,
    appVer: '2026.4.181',
    getCurrentTriggerId: () => 'null',
  }
}
