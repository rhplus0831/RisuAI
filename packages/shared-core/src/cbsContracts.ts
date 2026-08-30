import type { LLMModel } from './modelTypes.js'

/** The callback cache is supplied by the caller and is never global. */
export type CbsCallbackMemoName = 'charhistory' | 'userhistory' | 'lorebook'

export interface CbsCallbackMemo {
  entries: Map<string, string>
  historyGeneration: number
  loreGeneration?: number
  recordMiss?: (name: CbsCallbackMemoName, key: string) => void
}

/**
 * CBS deliberately consumes a structural projection rather than the browser
 * aggregate Database type. The index signature keeps legacy callback fields
 * extensible while the parser-facing fields remain explicit.
 */
export type CbsDatabase = {
  [key: string]: any
  characters: CbsCharacter[]
  aiModel: string
  subModel: string
  maxContext: number
  mainPrompt: string
  jailbreak: string
  globalNote: string
  jailbreakToggle: boolean
  language: string
  promptPresets?: Array<{ id?: string; name?: string; promptTemplate?: Array<{ type?: string; defaultText?: string }> }>
  promptPresetsId?: number
  promptTemplate?: Array<{ type?: string; defaultText?: string }>
}

export type CbsMessage = {
  [key: string]: any
  role: string
  data: string
}

export type CbsChat = {
  [key: string]: any
  message: CbsMessage[]
  id?: string
  name?: string
  fmIndex?: number | null
  localLore?: CbsLoreBook[]
  note: string
}

export type CbsCharacter = {
  [key: string]: any
  name: string
  nickname?: string
  chaId?: string
  personality: string
  desc: string
  scenario: string
  exampleMessage: string
  firstMessage: string
  alternateGreetings: string[]
  globalLore?: CbsLoreBook[]
  chats: CbsChat[]
  chatPage: number
  emotionImages?: Array<[string, ...unknown[]]>
  additionalAssets?: Array<[string, string, ...unknown[]]>
  prebuiltAssetCommand?: string
  prebuiltAssetExclude?: string[]
}

export type CbsLoreBook = {
  [key: string]: any
  id?: string
  key?: string
  secondkey?: string
  content?: string
  bookVersion?: number | string
  comment?: string
  mode?: string
  alwaysActive?: boolean
  selective?: boolean
  insertorder?: number
}

export type CbsModule = {
  [key: string]: any
  id?: string
  name?: string
  namespace?: string
  lorebook?: CbsLoreBook[]
  assets?: Array<[string, string, ...unknown[]]>
}

export type CBSModelRole = 'chatMain' | 'chatAux'

export interface CBSModelContext {
  modelId: string
  requestModel: string
  modelInfo: LLMModel
  maxContext?: number
}

export type CbsMatcherArg = {
  chatID: number
  db: CbsDatabase | null
  chara: CbsCharacter | string | null
  rmVar: boolean
  var?: { [key: string]: string } | null
  tokenizeAccurate?: boolean
  consistantChar?: boolean
  displaying?: boolean
  role?: string
  runVar?: boolean
  funcName?: string
  text?: string
  recursiveCount?: number
  callStack?: number
  lowLevelAccess?: boolean
  cbsConditions: CbsConditions
  triggerId?: string
  getNested?: () => string[]
  setNestedRoot?: (val: string) => void
  callbackMemo?: CbsCallbackMemo
}

export type CbsConditions = {
  firstmsg?: boolean
  chatRole?: string
}

export type RegisterCallback = (
  str: string,
  matcherArg: CbsMatcherArg,
  args: string[],
  vars: { [key: string]: string } | null,
) =>
  | {
      text: string
      var: { [key: string]: string }
    }
  | string
  | null

export interface CbsRegistration {
  name: string
  callback: RegisterCallback | 'doc_only'
  alias: string[]
  description: string
  deprecated?: {
    message: string
    since?: string
    replacement?: string
  }
  internalOnly?: boolean
}

export interface CBSRegisterArg {
  registerFunction: (arg: CbsRegistration) => void | Promise<void>
  getDatabase: () => CbsDatabase
  getUserName: () => string
  getPersonaPrompt: () => string
  risuChatParser: (text: string, arg: CbsMatcherArg) => string
  makeArray: (arr: unknown[]) => string
  safeStructuredClone: <T>(obj: T) => T
  parseArray: (str: string) => unknown[]
  parseDict: (str: string) => { [key: string]: unknown }
  getChatVar: (key: string) => string
  setChatVar: (key: string, value: string) => void
  getGlobalChatVar: (key: string) => string
  calcString: (str: string) => number
  dateTimeFormat: (format: string, timestamp?: number) => string
  getModules: () => CbsModule[]
  getModuleLorebooks: () => CbsLoreBook[]
  pickHashRand: (seed: number, hash: string) => number
  getSelectedCharID: () => number
  getModelInfo: (model: string) => LLMModel
  getModelContext?: (role: CBSModelRole) => CBSModelContext
  callInternalFunction: (args: string[]) => string
  isMobile: boolean
  appVer: string
  getCurrentTriggerId: () => string
  getScreenWidth: () => string
  getScreenHeight: () => string
  getBrowserLanguage: () => string
}

export interface ParserStateBackend {
  getDefaultDatabase: () => CbsDatabase | null
  getDefaultSelectedCharID: () => number
}

export interface RisuChatParserVariableResolver {
  getChatVar: (key: string) => string
  getGlobalChatVar: (key: string) => string
}
