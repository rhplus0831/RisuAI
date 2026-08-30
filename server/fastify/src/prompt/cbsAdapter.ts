import type { CBSRegisterArg, matcherArg } from '../../../../src/ts/cbs'
import { risuChatParser } from '../../../../src/ts/parser/risuChatParser'
import { dateTimeFormat, makeArray, parseArray, parseDict } from '../../../../src/ts/parser/risuChatParserHelpers'
import { calcString } from '../../../../src/ts/process/infunctions'
import { getChatVar, getGlobalChatVar, setChatVar } from '../../../../src/ts/parser/chatVarBackend'
import {
  getActiveChatPage,
  getActiveClientContext,
  getActiveDatabase,
  getActiveModelInfo,
  getActiveSelectedCharID,
  reportActiveCbsCallbackDiagnostic,
} from './promptScope.js'
import { getActiveModules, getModuleLorebooks } from './modules.js'
import { pickHashRand } from '@risuai/shared-core/lore-hash'

/**
 * Server-side `CBSRegisterArg` factory. Wires the DI fields the `registerCBS`
 * infrastructure expects, reading dynamic context
 * (`database`, `selectedCharID`, `userName`, `personaPrompt`) from the
 * active `promptScope` singleton rather than from browser resource state or
 * Svelte stores.
 *
 * Browser-context callbacks never read server globals. `{{screenwidth}}`,
 * `{{screenheight}}`, and `{{metadata::browserlanguage}}` resolve from the
 * request-local client context reported with the generation request.
 *
 * `getCurrentTriggerId` returns `'null'` because manual triggers are a
 * browser UI concept.
 *
 * Model metadata is read lazily from the active prompt scope so CBS sees the
 * same resolved profile/request model that assembly sends to dispatch.
 */

function getScopedModules() {
  const database = getActiveDatabase()
  if (!database) return []
  const currentChar = database.characters[getActiveSelectedCharID()]
  const currentChat = currentChar?.chats[getActiveChatPage()]
  return getActiveModules(database, currentChar, currentChat)
}

function reportedScreenWidth(): string {
  const value = getActiveClientContext()?.screenWidth
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.round(value).toString()
  reportActiveCbsCallbackDiagnostic('screenwidth', 'client_context_unavailable')
  return ''
}

function reportedBrowserLanguage(): string {
  const value = getActiveClientContext()?.browserLanguage
  if (typeof value === 'string' && value.length > 0) return value
  reportActiveCbsCallbackDiagnostic('browserlanguage', 'client_context_unavailable')
  return ''
}

function reportedScreenHeight(): string {
  const value = getActiveClientContext()?.screenHeight
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.round(value).toString()
  reportActiveCbsCallbackDiagnostic('screenheight', 'client_context_unavailable')
  return ''
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
        callStack: arg.callStack,
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
    getScreenWidth: reportedScreenWidth,
    getScreenHeight: reportedScreenHeight,
    getBrowserLanguage: reportedBrowserLanguage,
  }
}
