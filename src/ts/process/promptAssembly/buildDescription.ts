import { type Chat, type Database, type character } from '../../storage/database.svelte'
import { additionalInformations } from '../embedding/addinfo'
import type { OpenAIChat } from '../index.svelte'
import { risuChatParser } from '../scripts'

export async function buildDescription(
  currentChar: character,
  currentChat: Chat,
  database: Database,
): Promise<OpenAIChat> {
  let description = risuChatParser((database.promptPreprocess ? database.descriptionPrefix : '') + currentChar.desc, {
    chara: currentChar,
  })

  const additionalInfo = await additionalInformations(currentChar, currentChat)

  if (additionalInfo) {
    description += '\n\n' + risuChatParser(additionalInfo, { chara: currentChar })
  }

  if (currentChar.personality) {
    description += risuChatParser('\n\nDescription of {{char}}: ' + currentChar.personality, {
      chara: currentChar,
    })
  }

  if (currentChar.scenario) {
    description += risuChatParser('\n\nCircumstances and context of the dialogue: ' + currentChar.scenario, {
      chara: currentChar,
    })
  }

  return {
    role: 'system',
    content: description,
  }
}
