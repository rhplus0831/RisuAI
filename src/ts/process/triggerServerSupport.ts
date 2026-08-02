/**
 * Trigger effects intentionally retained as no-ops by the Fastify generation
 * runtime. Imported scripts keep these effect records so they can round-trip,
 * but the server neither performs their privileged action nor mutates their
 * persistent character/persona/lorebook data.
 */
export const serverUnsupportedTriggerEffectTypes: ReadonlySet<string> = new Set([
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

export function isServerUnsupportedTriggerEffectType(type: string): boolean {
  return serverUnsupportedTriggerEffectTypes.has(type)
}
