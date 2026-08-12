/**
 * Trigger effects intentionally retained as no-ops by the Fastify generation
 * runtime. Imported scripts keep these effect records so they can round-trip,
 * but the server neither performs their privileged action nor mutates their
 * persistent character/persona/lorebook data.
 */
export const serverUnsupportedTriggerEffectTypes: ReadonlySet<string> = new Set([
  '@@emo',
  'command',
  'extractRegex',
  'showAlert',
  'runImgGen',
  'checkSimilarity',
  'runLLM',
  'runAxLLM',
  'triggercode',
  'v2Command',
  'v2ImgGen',
  'v2CheckSimilarity',
  'v2RunLLM',
  'v2ShowAlert',
  'v2GetAlertInput',
  'v2GetAlertSelect',
  'v2GetCharacterDesc',
  'v2SetCharacterDesc',
  'v2GetPersonaDesc',
  'v2SetPersonaDesc',
  'v2GetReplaceGlobalNote',
  'v2SetReplaceGlobalNote',
  'v2GetAuthorNote',
  'v2SetAuthorNote',
  'v2ModifyLorebook',
  'v2GetLorebook',
  'v2GetLorebookCount',
  'v2GetLorebookEntry',
  'v2SetLorebookActivation',
  'v2GetLorebookIndexViaName',
  'v2GetAllLorebooks',
  'v2GetLorebookByName',
  'v2GetLorebookByIndex',
  'v2CreateLorebook',
  'v2ModifyLorebookByIndex',
  'v2DeleteLorebookByIndex',
  'v2GetLorebookCountNew',
  'v2SetLorebookAlwaysActive',
  'v2UpdateGUI',
  'v2UpdateChatAt',
  'v2Wait',
])

export function serverUnsupportedRegexEffectType(output: unknown): '@@emo' | null {
  return typeof output === 'string' && output.startsWith('@@emo ') ? '@@emo' : null
}

export function isServerUnsupportedTriggerEffectType(type: string): boolean {
  return serverUnsupportedTriggerEffectTypes.has(type)
}

/**
 * Browser-context CBS deliberately not implemented by Fastify. Screen width
 * and browser language are supported through reported client context; screen
 * height remains explicit no-port behavior.
 */
export const serverUnsupportedCbsCallbackNames: ReadonlySet<string> = new Set(['screenheight', 'screen_height'])

export interface TriggerServerCompatibilityDiagnostics {
  unsupportedEffectTypes: string[]
  unsupportedCbsCallbacks: string[]
}

const unsupportedCbsPattern = /\{\{\s*(screenheight|screen_height)(?=\s*(?:::|\}\}))/giu

function collectUnsupportedCbsFromString(value: string, output: Set<string>): void {
  unsupportedCbsPattern.lastIndex = 0
  for (const match of value.matchAll(unsupportedCbsPattern)) {
    if (match[1]) output.add('screenheight')
  }
}

/**
 * Inspect an imported or configured trigger definition without normalizing or
 * mutating it. The result is stable and deduplicated for concise UI diagnostics.
 */
export function diagnoseServerTriggerCompatibility(definitions: unknown): TriggerServerCompatibilityDiagnostics {
  const unsupportedEffectTypes = new Set<string>()
  const unsupportedCbsCallbacks = new Set<string>()
  const seen = new Set<object>()

  const visit = (value: unknown): void => {
    if (typeof value === 'string') {
      collectUnsupportedCbsFromString(value, unsupportedCbsCallbacks)
      return
    }
    if (!value || typeof value !== 'object' || seen.has(value)) return
    seen.add(value)

    if (!Array.isArray(value)) {
      const type = (value as { type?: unknown }).type
      if (typeof type === 'string' && isServerUnsupportedTriggerEffectType(type)) {
        unsupportedEffectTypes.add(type)
      }
    }

    for (const nested of Array.isArray(value) ? value : Object.values(value)) visit(nested)
  }

  visit(definitions)
  return {
    unsupportedEffectTypes: [...unsupportedEffectTypes].sort(),
    unsupportedCbsCallbacks: [...unsupportedCbsCallbacks].sort(),
  }
}
