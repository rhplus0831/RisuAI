import type { Database, character } from '../../../../src/ts/storage/database.svelte'
import { parseKeyValue } from '../../../../src/ts/util/parseKeyValue'

export type ChatDefaultVariable = [key: string, value: string]

/**
 * Parse persistent chat-variable defaults with the browser's exact precedence:
 * character rows first, then template rows, with the first matching key winning.
 */
export function getChatDefaultVariables(
  currentChar: Pick<character, 'defaultVariables'> | undefined,
  database: Pick<Database, 'templateDefaultVariables'>,
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
