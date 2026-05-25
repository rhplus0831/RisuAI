import type { SettingItem, SettingContext } from './types'
import { DBState } from '../stores.svelte'
import { language } from 'src/lang'
import { accessibilitySettingsItems } from './accessibilitySettingsData'
import { advancedSettingsItems } from './advancedSettingsData'
import {
  basicParameterItems,
  modelSpecificParameterItems,
  penaltyParameterItems,
  samplingParameterItems,
  seedSetting,
} from './botSettingsParamsData'
import { chatFormatSettingsItems } from './chatFormatSettingsData'
import { displaySettingsItems } from './displaySettingsData.svelte'
import {
  canUseServerCommands,
  getServerCommandBaseRevision,
  patchSettingsGroup,
  type SettingsGroup,
} from '../server/commands'

/**
 * Sentinel value representing an uninitialized local state in wrapper components.
 * Used instead of `undefined` so that a legitimate `undefined` DB value
 * can still be written back without being silently ignored.
 */
export const UNINITIALIZED = Symbol('uninitialized')

const SERVER_SETTINGS_GROUP_BY_KEY: Record<string, SettingsGroup> = {
  maxContext: 'runtime',
  maxResponse: 'runtime',
  generationSeed: 'runtime',
  temperature: 'runtime',
  frequencyPenalty: 'runtime',
  PresensePenalty: 'runtime',
  top_p: 'runtime',
  top_k: 'runtime',
  min_p: 'runtime',
  top_a: 'runtime',
  repetition_penalty: 'runtime',
  thinkingType: 'runtime',
  deepseekThinkingType: 'runtime',
  thinkingTokens: 'runtime',
  adaptiveThinkingEffort: 'runtime',
  deepseekReasoningEffort: 'runtime',
  reasoningEffort: 'runtime',
  verbosity: 'runtime',
  requestRetrys: 'runtime',
  genTime: 'runtime',
  requestLocation: 'runtime',
  localNetworkMode: 'runtime',
  localNetworkTimeoutSec: 'runtime',
  usePlainFetch: 'runtime',
  autoContinueChat: 'runtime',
  autoContinueMinTokens: 'runtime',
  removeIncompleteResponse: 'runtime',
  newOAIHandle: 'runtime',
  googleClaudeTokenizing: 'runtime',
  automaticCachePoint: 'runtime',
  chainOfThought: 'runtime',
  antiServerOverloads: 'runtime',
  rememberToolUsage: 'runtime',
  simplifiedToolUse: 'runtime',
  disableSeperateParameterChangeOnPresetChange: 'runtime',
  useServerGeneration: 'runtime',
  useServerPromptAssembly: 'runtime',
  useStreaming: 'runtime',
  language: 'language',
  translator: 'language',
  translatorType: 'language',
  translatorInputLanguage: 'language',
  htmlTranslation: 'language',
  autoTranslate: 'language',
  combineTranslation: 'language',
  legacyTranslation: 'language',
  translateBeforeHTMLFormatting: 'language',
  autoTranslateCachedOnly: 'language',
  noWaitForTranslate: 'language',
  useExperimentalGoogleTranslator: 'language',
  deeplOptions: 'language',
  deeplXOptions: 'language',
  theme: 'display',
  guiHTML: 'display',
  waifuWidth: 'display',
  waifuWidth2: 'display',
  textTheme: 'display',
  font: 'display',
  customFont: 'display',
  zoomsize: 'display',
  lineHeight: 'display',
  iconsize: 'display',
  textAreaSize: 'display',
  textAreaTextSize: 'display',
  sideBarSize: 'display',
  assetWidth: 'display',
  animationSpeed: 'display',
  memoryLimitThickness: 'display',
  settingsCloseButtonSize: 'display',
  fullScreen: 'display',
  showMemoryLimit: 'display',
  showFirstMessagePages: 'display',
  hideRealm: 'display',
  hideAllImages: 'display',
  showFolderName: 'display',
  playMessage: 'display',
  playMessageOnTranslateEnd: 'display',
  roundIcons: 'display',
  textBorder: 'display',
  textScreenRounded: 'display',
  showSavingIcon: 'display',
  showPromptComparison: 'display',
  useChatCopy: 'display',
  useAdditionalAssetsPreview: 'display',
  useLegacyGUI: 'display',
  hideApiKey: 'display',
  unformatQuotes: 'display',
  blockquoteStyling: 'display',
  customQuotes: 'display',
  customQuotesData: 'display',
  betaMobileGUI: 'display',
  menuSideBar: 'display',
  useChatSticker: 'display',
  customCSS: 'display',
  heightMode: 'display',
  loreBookDepth: 'advanced',
  loreBookToken: 'advanced',
  additionalPrompt: 'advanced',
  descriptionPrefix: 'advanced',
  emotionPrompt2: 'advanced',
  keiServerURL: 'advanced',
  presetChain: 'advanced',
  assetMaxDifference: 'advanced',
  keepSessionAlive: 'advanced',
  useSayNothing: 'advanced',
  showUnrecommended: 'advanced',
  useExperimental: 'advanced',
  forceProxyAsOpenAI: 'advanced',
  autofillRequestUrl: 'advanced',
  allowAllExtentionFiles: 'advanced',
  coldstorage: 'advanced',
  enableDevTools: 'advanced',
  enableScrollToActiveChar: 'advanced',
  promptInfoInsideChat: 'advanced',
  promptTextInfoInsideChat: 'advanced',
  enableRemoteSaving: 'advanced',
  realmDirectOpen: 'advanced',
  returnCSSError: 'advanced',
  personaNote: 'advanced',
  enableBookmark: 'advanced',
  useTokenizerCaching: 'advanced',
  auxModelUnderModelSettings: 'advanced',
  pluginDevelopMode: 'advanced',
  showDeprecatedTriggerV1: 'advanced',
  showDeprecatedTriggerV2: 'advanced',
  banCharacterset: 'advanced',
  bulkEnabling: 'advanced',
  gptVisionQuality: 'media',
  imageCompression: 'media',
  legacyMediaFindings: 'media',
  newImageHandlingBeta: 'media',
  dynamicAssets: 'media',
  dynamicAssetsEditDisplay: 'media',
  removePunctuationHypa: 'memory',
  claudeRetrivalCaching: 'providers',
  claude1HourCaching: 'providers',
  claudeBatching: 'providers',
  dynamicModelRegistry: 'providers',
  askRemoval: 'sidebar',
  swipe: 'sidebar',
  instantRemove: 'sidebar',
  sendWithEnter: 'sidebar',
  fixedChatTextarea: 'sidebar',
  clickToEdit: 'sidebar',
  enableBlockPartialEdit: 'sidebar',
  longPressToPopupEditor: 'sidebar',
  enableDragPartialEdit: 'sidebar',
  botSettingAtStart: 'sidebar',
  showMenuChatList: 'sidebar',
  showMenuHypaMemoryModal: 'memory',
  goCharacterOnImport: 'sidebar',
  sideMenuRerollButton: 'sidebar',
  requestInfoInsideChat: 'sidebar',
  localActivationInGlobalLorebook: 'sidebar',
  inlayErrorResponse: 'advanced',
  showTranslationLoading: 'language',
  autoScrollToNewMessage: 'sidebar',
  alwaysScrollToNewMessage: 'sidebar',
  newMessageButtonStyle: 'sidebar',
  createFolderOnBranch: 'sidebar',
  hamburgerButtonBottom: 'sidebar',
  enableRisuaiProTools: 'sidebar',
}

export function getLabel(item: SettingItem): string {
  if (item.labelKey && (language as any)[item.labelKey]) {
    return (language as any)[item.labelKey]
  }
  return item.fallbackLabel ?? ''
}

export function getSettingValue(item: SettingItem, ctx: SettingContext): any {
  if (item.getValue) {
    return item.getValue(DBState.db, ctx)
  }
  if (item.bindPath) {
    const parts = item.bindPath.split('.')
    let value: any = DBState.db
    for (const part of parts) {
      value = value?.[part]
    }
    return value
  }
  if (item.bindKey) {
    return (DBState.db as any)[item.bindKey]
  }
  return undefined
}

export function setSettingValue(item: SettingItem, newValue: any, ctx: SettingContext): void {
  const previousValue = getSettingValue(item, ctx)
  const commandPatch = buildServerSettingsPatch(item)

  setLocalSettingValue(item, newValue, ctx)

  if (item.onChange) {
    item.onChange(newValue, ctx)
  }

  if (commandPatch) {
    void patchServerBackedSetting(item, commandPatch, newValue, previousValue, ctx)
  }
}

function setLocalSettingValue(item: SettingItem, newValue: any, ctx: SettingContext): void {
  if (item.setValue) {
    item.setValue(DBState.db, newValue, ctx)
  } else if (item.bindPath) {
    const parts = item.bindPath.split('.')
    let obj: any = DBState.db
    for (let i = 0; i < parts.length - 1; i++) {
      obj = obj[parts[i]] ??= {}
    }
    obj[parts[parts.length - 1]] = newValue
  } else if (item.bindKey) {
    ;(DBState.db as any)[item.bindKey] = newValue
  }
}

function buildServerSettingsPatch(
  item: SettingItem,
): { group: SettingsGroup; key: string; valueFromDb: () => unknown } | null {
  if (!canUseServerCommands()) return null

  if (item.bindPath) {
    const rootKey = item.bindPath.split('.')[0]
    const group = SERVER_SETTINGS_GROUP_BY_KEY[rootKey]
    if (!group) return null
    return {
      group,
      key: rootKey,
      valueFromDb: () => cloneJsonValue((DBState.db as any)[rootKey]),
    }
  }

  const key = item.bindKey ?? serverPatchKeyForItem(item)
  if (!key) return null
  const group = SERVER_SETTINGS_GROUP_BY_KEY[String(key)]
  if (!group) return null

  return {
    group,
    key: String(key),
    valueFromDb: () => cloneJsonValue((DBState.db as any)[key]),
  }
}

async function patchServerBackedSetting(
  item: SettingItem,
  commandPatch: { group: SettingsGroup; key: string; valueFromDb: () => unknown },
  newValue: unknown,
  previousValue: unknown,
  ctx: SettingContext,
): Promise<void> {
  const baseRevision = await getServerCommandBaseRevision()
  if (baseRevision === null) {
    rollbackLocalSetting(item, newValue, previousValue, ctx)
    return
  }

  const patch = { [commandPatch.key]: commandPatch.valueFromDb() }
  if (patch[commandPatch.key] === undefined) return

  let result = await patchSettingsGroup({
    group: commandPatch.group,
    baseRevision,
    patch,
  })

  if (result.status === 'conflict') {
    result = await patchSettingsGroup({
      group: commandPatch.group,
      baseRevision: result.currentRevision,
      patch,
    })
  }

  if (result.status !== 'ok') {
    rollbackLocalSetting(item, newValue, previousValue, ctx)
  }
}

function rollbackLocalSetting(
  item: SettingItem,
  attemptedValue: unknown,
  previousValue: unknown,
  ctx: SettingContext,
): void {
  if (getSettingValue(item, ctx) !== attemptedValue) return
  setLocalSettingValue(item, previousValue, ctx)
}

function serverPatchKeyForItem(item: SettingItem): string | null {
  if (item.id.startsWith('display.customQuotes')) return 'customQuotesData'
  return null
}

function cloneJsonValue<T>(value: T): T {
  if (value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}

/**
 * Check if item should be visible based on condition
 */
export function checkCondition(item: SettingItem, ctx: SettingContext): boolean {
  if (!item.condition) return true
  return item.condition(ctx)
}

export function getFullSettingsData(searchTerm = '') {
  const full = accessibilitySettingsItems.concat(
    advancedSettingsItems,
    basicParameterItems,
    seedSetting,
    samplingParameterItems,
    penaltyParameterItems,
    modelSpecificParameterItems,
    chatFormatSettingsItems,
    displaySettingsItems,
  )

  if (!searchTerm) return full

  const lowerSearch = searchTerm.toLowerCase()
  return full.filter((item) => {
    const label = getLabel(item).toLowerCase()
    const keywords = item.keywords?.map((k) => k.toLowerCase()) || []
    return label.includes(lowerSearch) || keywords.some((k) => k.includes(lowerSearch))
  })
}
