import type { Database, character } from '../../storage/database.svelte'
import { DBState } from '../../stores.svelte'
import type { PromptItem } from '../prompt'
import { resolveEffectivePromptTemplate, type EffectivePromptTemplateOptions } from './effectivePromptTemplate'

export interface NormalizedTemplate {
  promptTemplate: PromptItem[] | null
  usingPromptTemplate: boolean
}

export interface NormalizeTemplateOptions extends EffectivePromptTemplateOptions {
  db?: Database
}

export function normalizeTemplate(currentChar: character, options: NormalizeTemplateOptions = {}): NormalizedTemplate {
  const db = options.db ?? DBState.db
  const resolved = resolveEffectivePromptTemplate(db, options)
  let promptTemplate = safeStructuredClone(resolved.promptTemplate) ?? null
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

  if (currentChar.utilityBot && !(usingPromptTemplate && db.promptSettings.utilOverride)) {
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
