import { calculateString } from '@risuai/shared-core/calculation'
import { getChatVar, getGlobalChatVar } from '../parser/chatVarBackend'

const calculationVariables = { getChatVar, getGlobalChatVar }

export function calcString(text: string): number | undefined {
  return calculateString(text, calculationVariables)
}
