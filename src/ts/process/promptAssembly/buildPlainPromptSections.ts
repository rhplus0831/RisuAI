import type { character } from '../../storage/database.svelte'
import { DBState } from '../../stores.svelte'
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

export function buildPlainPromptSections(currentChar: character): {
  main: OpenAIChat[]
  jailbreak: OpenAIChat[]
  globalNote: OpenAIChat[]
} {
  const mainp =
    currentChar.systemPrompt?.replaceAll('{{original}}', DBState.db.mainPrompt) ||
    DBState.db.mainPrompt

  const main = formatPrompt(
    risuChatParser(
      mainp +
        (DBState.db.additionalPrompt === '' || !DBState.db.promptPreprocess
          ? ''
          : `\n${DBState.db.additionalPrompt}`),
      { chara: currentChar },
    ),
  )

  const jailbreak = DBState.db.jailbreakToggle
    ? formatPrompt(risuChatParser(DBState.db.jailbreak, { chara: currentChar }))
    : []

  const globalNote = formatPrompt(
    risuChatParser(
      currentChar.replaceGlobalNote?.replaceAll('{{original}}', DBState.db.globalNote) ||
        DBState.db.globalNote,
      { chara: currentChar },
    ),
  )

  return { main, jailbreak, globalNote }
}
