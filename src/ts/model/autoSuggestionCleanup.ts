import type { Database } from '../storage/database.svelte'
import { resolveModelProfile } from './modelProfileResolver'

function usesLegacySuggestionSuffixes(modelId: string): boolean {
  return modelId === 'textgen_webui' || modelId === 'mancer' || modelId.startsWith('local_')
}

export function cleanAutoSuggestionInput(message: string, database: Database): string {
  if (!database.autoSuggestClean) return message
  const auxiliaryModelId = resolveModelProfile({ database, role: 'chatAux' }).modelId
  return usesLegacySuggestionSuffixes(auxiliaryModelId) ? message.replace(/ +\(.+?\) *$| - [^"'*]*?$/, '') : message
}
