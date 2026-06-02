import type { Chat, character } from '../../storage/database.svelte'
import { DBState } from '../../stores.svelte'
import type { OpenAIChat } from '../index.svelte'
import { risuChatParser } from '../scripts'
import { getAuthorNoteDefaultText, getPersonaPrompt } from '../../util'

const COT_INSTRUCTION =
  '<instruction> - before respond everything, Think step by step as a ai assistant how would you respond inside <Thoughts> xml tag. this must be less than 5 paragraphs.</instruction>'

export function buildAuthorNote(currentChar: character, currentChat: Chat): OpenAIChat[] {
  if (currentChat.note) {
    return [
      {
        role: 'system',
        content: risuChatParser(currentChat.note, { chara: currentChar }),
      },
    ]
  }
  const defaultText = getAuthorNoteDefaultText()
  if (defaultText !== '') {
    return [
      {
        role: 'system',
        content: risuChatParser(defaultText, { chara: currentChar }),
      },
    ]
  }
  return []
}

export function buildCotInstruction(usingPromptTemplate: boolean): OpenAIChat[] {
  if (!DBState.db.chainOfThought) return []
  if (usingPromptTemplate && DBState.db.promptSettings.customChainOfThought) return []
  return [{ role: 'system', content: COT_INSTRUCTION }]
}

export function buildPersona(currentChar: character): OpenAIChat[] {
  if (!DBState.db.personaPrompt) return []
  return [
    {
      role: 'system',
      content: risuChatParser(getPersonaPrompt(), { chara: currentChar }),
    },
  ]
}

export function buildInlayViewInstruction(currentChar: character): OpenAIChat[] {
  if (!currentChar.inlayViewScreen) return []
  if (currentChar.viewScreen === 'emotion') {
    return [
      {
        role: 'system',
        content: currentChar.newGenData.emotionInstructions.replaceAll(
          '{{slot}}',
          currentChar.emotionImages.map((v) => v[0]).join(', '),
        ),
      },
    ]
  }
  if (currentChar.viewScreen === 'imggen') {
    return [{ role: 'system', content: currentChar.newGenData.instructions }]
  }
  return []
}
