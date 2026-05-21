import type { character } from '../../storage/database.svelte'
import { DBState } from '../../stores.svelte'
import type { PromptItem } from '../prompt'

export interface NormalizedTemplate {
  promptTemplate: PromptItem[] | null
  usingPromptTemplate: boolean
}

export function normalizeTemplate(currentChar: character): NormalizedTemplate {
  let promptTemplate = safeStructuredClone(DBState.db.promptTemplate) ?? null
  const usingPromptTemplate = !!promptTemplate

  if (promptTemplate) {
    let hasPostEverything = false
    for (const card of promptTemplate) {
      if (card.type === 'postEverything') {
        hasPostEverything = true
        break
      }
    }

    if (!hasPostEverything) {
      promptTemplate.push({ type: 'postEverything' })
    }
  }

  if (currentChar.utilityBot && !(usingPromptTemplate && DBState.db.promptSettings.utilOverride)) {
    promptTemplate = [
      { type: 'plain', text: '', role: 'system', type2: 'main' },
      { type: 'description' },
      { type: 'lorebook' },
      { type: 'chat', rangeStart: 0, rangeEnd: 'end' },
      { type: 'plain', text: '', role: 'system', type2: 'globalNote' },
      { type: 'postEverything' },
    ]
  }

  return { promptTemplate, usingPromptTemplate }
}
