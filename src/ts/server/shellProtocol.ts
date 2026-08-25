import type { Database } from '../storage/databaseTypes'
import { isServerCharactersSummaryPayload, type ServerCharactersSummaryPayload } from './characterSummaryProtocol'

export const SERVER_SHELL_PROTOCOL_VERSION = 1 as const

/**
 * Exact settings needed to paint and interact with the root shell before any
 * route-owned settings group is hydrated.
 */
export const SERVER_SHELL_SETTINGS_KEYS = [
  'language',
  'username',
  'colorScheme',
  'colorSchemeName',
  'textTheme',
  'customTextTheme',
  'font',
  'customFont',
  'customCSS',
  'animationSpeed',
  'reducedMotion',
  'heightMode',
  'sideBarSize',
  'roundIcons',
  'menuSideBar',
  'showFolderName',
  'showSavingIcon',
  'hamburgerButtonBottom',
  'botSettingAtStart',
  'enableDevTools',
  'doNotWarnExternalServers',
  'keepSessionAlive',
] as const satisfies readonly (keyof Database)[]

export type ServerShellSettingName = (typeof SERVER_SHELL_SETTINGS_KEYS)[number]
type ServerShellSettingsFromDatabase = {
  [Key in ServerShellSettingName]-?: Database[Key]
}
export type ServerShellSettings = Omit<
  ServerShellSettingsFromDatabase,
  'botSettingAtStart' | 'hamburgerButtonBottom'
> & {
  botSettingAtStart: boolean
  hamburgerButtonBottom: boolean
}

export const SERVER_SHELL_PAYLOAD_KEYS = ['protocolVersion', 'revision', 'settings', 'characters'] as const

export interface ServerShellPayload {
  protocolVersion: typeof SERVER_SHELL_PROTOCOL_VERSION
  revision: number
  settings: ServerShellSettings
  characters: ServerCharactersSummaryPayload
}

export function isServerShellPayload(value: unknown): value is ServerShellPayload {
  if (!isPlainRecord(value) || !hasExactKeys(value, SERVER_SHELL_PAYLOAD_KEYS)) return false
  if (value.protocolVersion !== SERVER_SHELL_PROTOCOL_VERSION || !nonNegativeSafeInteger(value.revision)) return false
  if (!isServerShellSettings(value.settings) || !isServerCharactersSummaryPayload(value.characters)) return false
  return value.characters.revision === value.revision
}

export function isServerShellSettings(value: unknown): value is ServerShellSettings {
  if (!isPlainRecord(value) || !hasExactKeys(value, SERVER_SHELL_SETTINGS_KEYS)) return false

  for (const key of [
    'language',
    'username',
    'colorSchemeName',
    'textTheme',
    'font',
    'customFont',
    'customCSS',
    'heightMode',
  ] as const) {
    if (typeof value[key] !== 'string') return false
  }

  for (const key of [
    'reducedMotion',
    'roundIcons',
    'menuSideBar',
    'showFolderName',
    'showSavingIcon',
    'hamburgerButtonBottom',
    'botSettingAtStart',
    'enableDevTools',
    'doNotWarnExternalServers',
  ] as const) {
    if (typeof value[key] !== 'boolean') return false
  }

  for (const key of ['animationSpeed', 'sideBarSize'] as const) {
    if (typeof value[key] !== 'number' || !Number.isFinite(value[key])) return false
  }

  if (value.keepSessionAlive !== 'off' && value.keepSessionAlive !== 'sound') return false
  return isColorScheme(value.colorScheme) && isTextTheme(value.customTextTheme)
}

function isColorScheme(value: unknown): boolean {
  if (!isPlainRecord(value)) return false
  for (const key of [
    'bgcolor',
    'darkbg',
    'borderc',
    'selected',
    'draculared',
    'textcolor',
    'textcolor2',
    'darkBorderc',
    'darkbutton',
  ] as const) {
    if (typeof value[key] !== 'string') return false
  }
  return value.type === 'light' || value.type === 'dark'
}

function isTextTheme(value: unknown): boolean {
  if (!isPlainRecord(value)) return false
  for (const key of [
    'FontColorStandard',
    'FontColorBold',
    'FontColorItalic',
    'FontColorItalicBold',
    'FontColorQuote1',
    'FontColorQuote2',
  ] as const) {
    if (typeof value[key] !== 'string') return false
  }
  return true
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value)
  return actual.length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
}

function nonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0
}
