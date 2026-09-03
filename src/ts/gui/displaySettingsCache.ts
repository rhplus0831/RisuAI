import type { Database } from '../storage/databaseTypes'

export const DISPLAY_SETTINGS_CACHE_KEY = 'risu-display-settings-v1'

// Keep the early index.html bootstrap allowlist in sync (covered by the DOM test).
export const DISPLAY_STYLE_PROPERTIES = [
  '--risu-theme-bgcolor',
  '--risu-theme-darkbg',
  '--risu-theme-borderc',
  '--risu-theme-selected',
  '--risu-theme-draculared',
  '--risu-theme-textcolor',
  '--risu-theme-textcolor2',
  '--risu-theme-darkborderc',
  '--risu-theme-darkbutton',
  '--risu-theme-color-scheme',
  '--FontColorStandard',
  '--FontColorItalic',
  '--FontColorBold',
  '--FontColorItalicBold',
  '--FontColorQuote1',
  '--FontColorQuote2',
  '--risu-font-family',
  '--risu-animation-speed',
  '--risu-height-size',
  '--sidebar-size',
] as const

const stringSettings = [
  'theme',
  'guiHTML',
  'colorSchemeName',
  'textTheme',
  'font',
  'customFont',
  'customBackground',
  'textScreenColor',
  'textScreenBorder',
] as const
const booleanSettings = ['reducedMotion', 'classicMaxWidth', 'textBorder', 'textScreenRounded', 'roundIcons'] as const
const numberSettings = [
  'waifuWidth',
  'waifuWidth2',
  'zoomsize',
  'lineHeight',
  'chatScreenWidth',
  'iconsize',
  'textAreaSize',
  'textAreaTextSize',
  'sideBarSize',
  'assetWidth',
  'animationSpeed',
  'memoryLimitThickness',
  'settingsCloseButtonSize',
] as const
const recordSettings = ['colorScheme', 'customColorScheme', 'customTextTheme'] as const
export const DISPLAY_PAINT_SETTING_KEYS = [
  ...stringSettings,
  ...numberSettings,
  ...recordSettings,
  ...booleanSettings,
  'heightMode',
] as const
export type DisplayPaintSettingKey = (typeof DISPLAY_PAINT_SETTING_KEYS)[number]
export type DisplayPaintSettings = Partial<Pick<Database, DisplayPaintSettingKey>>
export type DisplayStyleProperties = Partial<Record<(typeof DISPLAY_STYLE_PROPERTIES)[number], string>>

interface DisplaySettingsCache {
  version: 1
  settings: DisplayPaintSettings
  styles: DisplayStyleProperties
  reducedMotion?: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function validSetting(key: DisplayPaintSettingKey, value: unknown): boolean {
  if ((numberSettings as readonly string[]).includes(key)) return typeof value === 'number' && Number.isFinite(value)
  if ((recordSettings as readonly string[]).includes(key)) {
    return (
      isRecord(value) &&
      Object.keys(value).length <= 16 &&
      Object.values(value).every((field) => typeof field === 'string' && field.length <= 4096)
    )
  }
  return (booleanSettings as readonly string[]).includes(key)
    ? typeof value === 'boolean'
    : typeof value === 'string' && value.length <= 256 * 1024
}

/** Disposable visual hints only; never apply these values to a resource owner. */
export function readDisplaySettingsCache(): DisplaySettingsCache {
  const empty: DisplaySettingsCache = { version: 1, settings: {}, styles: {} }
  try {
    const serialized = globalThis.localStorage?.getItem(DISPLAY_SETTINGS_CACHE_KEY)
    if (!serialized || serialized.length > 1024 * 1024) return empty
    const value: unknown = JSON.parse(serialized)
    if (!isRecord(value) || value.version !== 1 || !isRecord(value.settings) || !isRecord(value.styles)) return empty
    for (const key of DISPLAY_PAINT_SETTING_KEYS) {
      if (validSetting(key, value.settings[key])) (empty.settings as Record<string, unknown>)[key] = value.settings[key]
    }
    for (const key of DISPLAY_STYLE_PROPERTIES) {
      const style = value.styles[key]
      if (typeof style === 'string' && style.length <= 4096) empty.styles[key] = style
    }
    if (typeof value.reducedMotion === 'boolean') empty.reducedMotion = value.reducedMotion
  } catch {}
  return empty
}

function writeCache(cache: DisplaySettingsCache): void {
  try {
    const storage = globalThis.localStorage
    const serialized = JSON.stringify(cache)
    if (serialized.length <= 1024 * 1024 && storage?.getItem(DISPLAY_SETTINGS_CACHE_KEY) !== serialized) {
      storage?.setItem(DISPLAY_SETTINGS_CACHE_KEY, serialized)
    }
  } catch {
    // A blocked/full cache must never prevent authoritative display updates.
  }
}

/** Merge only projected keys so a partial shell cannot erase deferred size/layout hints. */
export function cacheDisplaySettings(settings: Partial<Database>, keys: readonly string[]): void {
  const projectedKeys = DISPLAY_PAINT_SETTING_KEYS.filter((key) => keys.includes(key))
  if (projectedKeys.length === 0) return
  const cache = readDisplaySettingsCache()
  for (const key of projectedKeys) {
    if (validSetting(key, settings[key])) (cache.settings as Record<string, unknown>)[key] = settings[key]
    else delete cache.settings[key]
  }
  writeCache(cache)
}

/** Apply/cache the resolved appearance, preserving custom palettes and Lite overrides exactly. */
export function applyDisplayStyles(styles: DisplayStyleProperties, reducedMotion?: boolean): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  const cache = readDisplaySettingsCache()
  for (const key of DISPLAY_STYLE_PROPERTIES) {
    const value = styles[key]
    if (typeof value !== 'string') continue
    if (root.style.getPropertyValue(key) !== value) root.style.setProperty(key, value)
    cache.styles[key] = value
  }
  if (typeof reducedMotion === 'boolean') {
    if (root.classList.contains('risu-reduced-motion') !== reducedMotion) {
      root.classList.toggle('risu-reduced-motion', reducedMotion)
    }
    cache.reducedMotion = reducedMotion
  }
  writeCache(cache)
}
