import type { CBSRegisterArg } from '@risuai/shared-core/cbs-contracts'
import { registerCBS as registerSharedCBS } from '@risuai/shared-core/cbs-registry'
import type { LLMModel } from './model/modellist'

/** Browser defaults used by playground/documentation registration. */
export const defaultCBSRegisterArg: CBSRegisterArg = {
  registerFunction: () => {
    throw new Error('registerFunction not implemented')
  },
  getDatabase: () => {
    throw new Error('getDatabase not implemented')
  },
  getUserName: () => 'placeholder_user',
  getPersonaPrompt: () => 'placeholder_persona',
  risuChatParser: (text: string) => text,
  makeArray: (arr: unknown[]) => JSON.stringify(arr),
  safeStructuredClone: <T>(obj: T) => JSON.parse(JSON.stringify(obj)),
  parseArray: (str: string) => {
    try {
      return JSON.parse(str)
    } catch {
      return []
    }
  },
  parseDict: (str: string) => {
    try {
      return JSON.parse(str)
    } catch {
      return {}
    }
  },
  getChatVar: () => '',
  setChatVar: () => {},
  getGlobalChatVar: () => '',
  calcString: () => 0,
  dateTimeFormat: (format: string, timestamp?: number) => {
    const date = timestamp ? new Date(timestamp * 1000) : new Date()
    return date.toISOString()
  },
  getModules: () => [],
  getModuleLorebooks: () => [],
  pickHashRand: () => Math.random(),
  getSelectedCharID: () => 0,
  callInternalFunction: () => '',
  isMobile: false,
  appVer: '0.0.0',
  getCurrentTriggerId: () => 'null',
  getScreenWidth: () => {
    try {
      return typeof window === 'undefined' ? '' : window.innerWidth.toString()
    } catch {
      return ''
    }
  },
  getScreenHeight: () => {
    try {
      return typeof window === 'undefined' ? '' : window.innerHeight.toString()
    } catch {
      return ''
    }
  },
  getBrowserLanguage: () => {
    try {
      return typeof navigator === 'undefined' ? '' : navigator.language
    } catch {
      return ''
    }
  },
  getModelInfo: () =>
    ({
      id: 'placeholder',
      name: 'Placeholder Model',
      shortName: 'Placeholder',
      internalID: 'placeholder',
      format: 0,
      provider: 0,
      tokenizer: 0,
    }) as LLMModel,
}

export const registerCBS = registerSharedCBS

export type {
  CbsCallbackMemo,
  CbsCallbackMemoName,
  CbsCharacter,
  CbsChat,
  CbsConditions,
  CbsDatabase,
  CbsLoreBook,
  CbsMatcherArg as matcherArg,
  CbsMessage,
  CbsModule,
  CBSModelContext,
  CBSModelRole,
  CBSRegisterArg,
  CbsRegistration,
  RegisterCallback,
} from '@risuai/shared-core/cbs-contracts'
