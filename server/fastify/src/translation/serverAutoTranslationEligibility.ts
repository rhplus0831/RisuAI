export const SERVER_RAW_TRANSLATOR_TYPES = ['google', 'deepl', 'deeplX', 'llm'] as const

export interface ServerAutoTranslationEligibilityInput {
  chatAutoTranslate: unknown
  messageText: unknown
  translator: unknown
  translatorType: unknown
  autoTranslateCachedOnly: unknown
}

/**
 * Server counterpart of the automatic raw-message translation guards in
 * Chat.svelte. Generated rows are always assistant/`char` rows, so the
 * browser's `autoTranslateBotOnly` user-role exclusion is intentionally absent.
 */
export function isServerAutoTranslationEligible(input: ServerAutoTranslationEligibilityInput): boolean {
  if (input.chatAutoTranslate !== true) return false
  if (typeof input.messageText !== 'string' || input.messageText.trim().length === 0) return false
  if (typeof input.translator !== 'string' || input.translator === '') return false
  if (!SERVER_RAW_TRANSLATOR_TYPES.includes(input.translatorType as (typeof SERVER_RAW_TRANSLATOR_TYPES)[number])) {
    return false
  }
  return !(input.autoTranslateCachedOnly === true && input.translatorType === 'llm')
}
