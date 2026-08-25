export const SERVER_STANDALONE_SETTING_NAMES = [
  'selectedPersona',
  'botPresetsId',
  'modelPresetsId',
  'promptPresetsId',
  'loreBookPage',
  'personaPrompt',
  'userIcon',
  'userNote',
] as const

export type ServerStandaloneSettingName = (typeof SERVER_STANDALONE_SETTING_NAMES)[number]

export type ServerStandaloneSettingState = { present: false } | { present: true; value: unknown }

export interface ServerStandaloneSettingPayload {
  revision: number
  setting: ServerStandaloneSettingName
  state: ServerStandaloneSettingState
}

const standaloneSettingNameSet = new Set<string>(SERVER_STANDALONE_SETTING_NAMES)

export function isServerStandaloneSettingName(value: string): value is ServerStandaloneSettingName {
  return standaloneSettingNameSet.has(value)
}

export function isServerStandaloneSettingPayload(value: unknown): value is ServerStandaloneSettingPayload {
  if (!isRecord(value) || !Number.isSafeInteger(value.revision) || (value.revision as number) < 0) return false
  if (typeof value.setting !== 'string' || !isServerStandaloneSettingName(value.setting)) return false
  if (!isRecord(value.state) || typeof value.state.present !== 'boolean') return false
  const stateKeys = Object.keys(value.state)
  if (value.state.present) {
    return stateKeys.length === 2 && stateKeys.includes('present') && stateKeys.includes('value')
  }
  return stateKeys.length === 1 && stateKeys[0] === 'present'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
