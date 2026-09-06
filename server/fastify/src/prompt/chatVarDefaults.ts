import { parseKeyValue } from '@risuai/shared-core/parse-key-value'

export type ChatDefaultVariable = [key: string, value: string]

export interface ChatDefaultCharacterInput {
  defaultVariables?: string | null
}

export interface ChatDefaultDatabaseInput {
  templateDefaultVariables?: string | null
}

/**
 * Parse persistent chat-variable defaults with the browser's exact precedence:
 * character rows first, then template rows, with the first matching key winning.
 */
export function getChatDefaultVariables(
  currentChar: ChatDefaultCharacterInput | undefined,
  database: ChatDefaultDatabaseInput,
): ChatDefaultVariable[] {
  return parseKeyValue(currentChar?.defaultVariables ?? '').concat(
    parseKeyValue(database.templateDefaultVariables ?? ''),
  )
}

/**
 * Resolve a persisted chat variable before the public `'null'` fallback is
 * applied. Nullish stored values fall through to defaults; other values,
 * including the empty string, shadow defaults exactly like the browser.
 */
export function readChatVariable(
  scriptstate: Record<string, unknown> | undefined,
  key: string,
  defaultVariables: readonly ChatDefaultVariable[],
): string | undefined {
  const stored = scriptstate?.['$' + key]
  if (stored !== undefined && stored !== null) return String(stored)
  return defaultVariables.find(([defaultKey]) => defaultKey === key)?.[1]
}
