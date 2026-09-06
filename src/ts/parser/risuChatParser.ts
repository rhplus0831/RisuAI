import {
  blockEndMatcher,
  blockStartMatcher,
  matcher,
  matcherMap,
  normalizeRisuChatParserMatcherName,
  registerRisuChatParserCBS as registerSharedRisuChatParserCBS,
  registerRisuChatParserMatcher,
  risuChatParser as parseRisuChatParser,
  RISU_EACH_EXPANSION_BUDGET,
  RisuParserBudgetError,
} from '@risuai/shared-core/risuchat-parser'
import type {
  CbsDatabase,
  CbsMatcherArg,
  CbsCallbackMemo,
  CbsConditions,
  CBSRegisterArg,
  ParserStateBackend,
  RisuChatParserVariableResolver,
} from '@risuai/shared-core/cbs-contracts'
import type { Database, character } from '../storage/database.svelte'
import { getChatVar, getGlobalChatVar } from './chatVarBackend'
import { getDefaultDatabase, getDefaultSelectedCharID } from './parserStateBackend'

const browserChatVariables: RisuChatParserVariableResolver = {
  getChatVar,
  getGlobalChatVar,
}

const browserParserState: ParserStateBackend = {
  getDefaultDatabase: () => getDefaultDatabase() as unknown as CbsDatabase | null,
  getDefaultSelectedCharID,
}

export type RisuChatParserArg = {
  chatID?: number
  db?: Database | null
  chara?: string | character
  rmVar?: boolean
  var?: { [key: string]: string }
  tokenizeAccurate?: boolean
  consistantChar?: boolean
  visualize?: boolean
  role?: string
  runVar?: boolean
  functions?: Map<string, { data: string; arg: string[] }>
  callStack?: number
  cbsConditions?: CbsConditions
  callbackMemo?: CbsCallbackMemo
  chatVariables?: RisuChatParserVariableResolver
  parserState?: ParserStateBackend
}

export function risuChatParser(da: string, arg: RisuChatParserArg | CbsMatcherArg = {}): string {
  const parserArg = arg as RisuChatParserArg
  return parseRisuChatParser(da, {
    ...parserArg,
    chatVariables: parserArg.chatVariables ?? browserChatVariables,
    parserState: parserArg.parserState ?? browserParserState,
  } as never)
}

export function registerRisuChatParserCBS(arg: unknown): void {
  registerSharedRisuChatParserCBS(arg as Omit<CBSRegisterArg, 'registerFunction'>)
}

export {
  blockEndMatcher,
  blockStartMatcher,
  matcher,
  matcherMap,
  normalizeRisuChatParserMatcherName,
  registerRisuChatParserMatcher,
  RISU_EACH_EXPANSION_BUDGET,
  RisuParserBudgetError,
}

export type { CbsMatcherArg as matcherArg, CbsCallbackMemo, CbsConditions, RisuChatParserVariableResolver }
