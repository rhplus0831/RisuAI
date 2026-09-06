import { ParseMarkdown, risuChatParser, trimMarkdown } from './parser/parser.svelte'
import { staticVisibleText } from './parser/staticVisibleText'
import type { Chat, character } from './storage/database.svelte'
import { tokenize } from './tokenizer'
import { settingsResourceState } from './server/resourceState.svelte'
import { createSimpleCharacter } from './simpleCharacter'
import { getUserName } from './utilState'
import { getCharacterDisplayName } from './characterDisplayName'
import { bilingualInterleave, pruneEmptyBilingualPairs } from './translator/bilingualInterleave'

/** Matches the default display pipeline for every stored row, including saved
 * translations when automatic display is enabled. The greeting, transient
 * per-row toggles and app controls are separate from this static transcript.
 */
export async function getChatVisibleTokens(character: character, chat: Chat, signal?: AbortSignal): Promise<number> {
  const simpleCharacter = createSimpleCharacter(character)
  let total = 0
  for (let start = 0; start < chat.message.length; start += 8) {
    signal?.throwIfAborted()
    // A small batch lets the display-source bridge share its request context,
    // while bounding retained HTML independently of total history length.
    const texts = await Promise.all(
      chat.message.slice(start, start + 8).map(async (message, offset) => {
        signal?.throwIfAborted()
        const index = start + offset
        const cbsConditions = { firstmsg: false, chatRole: message.role }
        const name = message.role === 'user' ? getUserName() : getCharacterDisplayName(character)
        const translation =
          chat.autoTranslate && message.translation?.source === 'raw' ? message.translation.text : undefined
        const settings = settingsResourceState.value
        const displaySource =
          typeof translation !== 'string'
            ? message.data
            : chat.bilingualDisplay
              ? bilingualInterleave(message.data, translation, {
                  emphasize: chat.bilingualEmphasis ?? 'original',
                  sentenceBreaks: settings.paragraphBreakBySentences
                    ? { sentencesPerParagraph: settings.paragraphBreakSentenceCount ?? 3 }
                    : undefined,
                })
              : translation
        const layer = typeof translation !== 'string' ? 'original' : chat.bilingualDisplay ? 'bilingual' : 'translation'
        const source = risuChatParser(displaySource, {
          chara: name,
          chatID: index,
          rmVar: true,
          visualize: true,
          cbsConditions,
        })
        const html = await ParseMarkdown(source, simpleCharacter, 'normal', index, cbsConditions, {
          chatId: chat.id,
          messageId: message.chatId,
          layer,
          name,
          priority: 'background',
        })
        signal?.throwIfAborted()
        return staticVisibleText(pruneEmptyBilingualPairs(trimMarkdown(html)))
      }),
    )
    for (const text of texts) {
      signal?.throwIfAborted()
      total += await tokenize(text)
    }
    // Allow close/navigation/edits to cancel long calculations between batches.
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
  return total
}
