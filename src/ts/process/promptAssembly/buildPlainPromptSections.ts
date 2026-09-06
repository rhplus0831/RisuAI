import { type Database, type character } from '../../storage/database.svelte'
import type { OpenAIChat } from '../index.svelte'
import { risuChatParser } from '../scripts'

function formatPrompt(data: string): OpenAIChat[] {
  if (!data.startsWith('@@')) {
    data = '@@system\n' + data
  }
  const parts = data.split(/@@@?(user|assistant|system)\n/)

  const chatObjects: OpenAIChat[] = []
  for (let i = 1; i < parts.length; i += 2) {
    const role = parts[i] as 'user' | 'assistant' | 'system'
    const content = parts[i + 1]?.trim() || ''
    chatObjects.push({ role, content })
  }

  return chatObjects
}

export function buildPlainPromptSections(
  currentChar: character,
  database: Database,
): {
  main: OpenAIChat[]
  jailbreak: OpenAIChat[]
  globalNote: OpenAIChat[]
} {
  const mainp = currentChar.systemPrompt?.replaceAll('{{original}}', database.mainPrompt) || database.mainPrompt

  const main = formatPrompt(
    risuChatParser(
      mainp + (database.additionalPrompt === '' || !database.promptPreprocess ? '' : `\n${database.additionalPrompt}`),
      {
        chara: currentChar,
      },
    ),
  )

  const jailbreak = database.jailbreakToggle
    ? formatPrompt(risuChatParser(database.jailbreak, { chara: currentChar }))
    : []

  const globalNote = formatPrompt(
    risuChatParser(
      currentChar.replaceGlobalNote?.replaceAll('{{original}}', database.globalNote) || database.globalNote,
      {
        chara: currentChar,
      },
    ),
  )

  return { main, jailbreak, globalNote }
}
