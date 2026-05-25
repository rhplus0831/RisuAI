import { isFastifyServer } from '../platform'
import { getNodeServerProxyAuth } from '../storage/nodeStorage'

const COMMAND_ENDPOINT = '/api/v1/commands'
const BOOTSTRAP_ENDPOINT = '/api/v1/bootstrap'

export const SETTINGS_GROUPS = [
  'providers',
  'runtime',
  'display',
  'language',
  'media',
  'memory',
  'advanced',
  'sidebar',
  'account',
] as const

export type SettingsGroup = (typeof SETTINGS_GROUPS)[number]

export const SERVER_SETTINGS_GROUP_BY_KEY: Record<string, SettingsGroup> = {
  account: 'account',
  adaptiveThinkingEffort: 'runtime',
  additionalPrompt: 'advanced',
  aiModel: 'providers',
  ainconfig: 'providers',
  alwaysScrollToNewMessage: 'sidebar',
  animationSpeed: 'display',
  antiClaudeOverload: 'runtime',
  antiServerOverloads: 'runtime',
  apiType: 'providers',
  askRemoval: 'sidebar',
  assetMaxDifference: 'advanced',
  assetWidth: 'display',
  authRefreshes: 'providers',
  autoContinueChat: 'runtime',
  autoContinueMinTokens: 'runtime',
  autoScrollToNewMessage: 'sidebar',
  autoTranslate: 'language',
  autoTranslateCachedOnly: 'language',
  automaticCachePoint: 'runtime',
  autofillRequestUrl: 'advanced',
  banCharacterset: 'advanced',
  betaMobileGUI: 'display',
  blockquoteStyling: 'display',
  botSettingAtStart: 'sidebar',
  bulkEnabling: 'advanced',
  chainOfThought: 'runtime',
  checkCorruption: 'advanced',
  claude1HourCaching: 'providers',
  claudeAPIKey: 'providers',
  claudeAws: 'providers',
  claudeBatching: 'providers',
  claudeCachingExperimental: 'providers',
  claudeRetrivalCaching: 'providers',
  clickToEdit: 'sidebar',
  coldstorage: 'advanced',
  colorScheme: 'display',
  colorSchemeName: 'display',
  cohereAPIKey: 'providers',
  combineTranslation: 'language',
  comfyConfig: 'media',
  comfyUiUrl: 'media',
  createFolderOnBranch: 'sidebar',
  currentPluginProvider: 'providers',
  customAPIFormat: 'providers',
  customBackground: 'display',
  customCSS: 'display',
  customFont: 'display',
  customGUI: 'display',
  customModels: 'providers',
  customProxyRequestModel: 'providers',
  customQuotes: 'display',
  customQuotesData: 'display',
  customTokenizer: 'providers',
  dallEQuality: 'media',
  deeplOptions: 'language',
  deeplXOptions: 'language',
  deepseekReasoningEffort: 'runtime',
  deepseekThinkingType: 'runtime',
  descriptionPrefix: 'advanced',
  didFirstSetup: 'account',
  disableSeperateParameterChangeOnPresetChange: 'runtime',
  doNotChangeFallbackModels: 'runtime',
  doNotChangeSeperateModels: 'runtime',
  dynamicAssets: 'media',
  dynamicAssetsEditDisplay: 'media',
  dynamicModelRegistry: 'providers',
  elevenLabKey: 'media',
  emotionProcesser: 'media',
  emotionPrompt2: 'advanced',
  enableBlockPartialEdit: 'sidebar',
  enableBookmark: 'advanced',
  enableCustomFlags: 'advanced',
  enableDevTools: 'advanced',
  enableDragPartialEdit: 'sidebar',
  enableRemoteSaving: 'advanced',
  enableRisuaiProTools: 'sidebar',
  enableScrollToActiveChar: 'advanced',
  epEnabled: 'runtime',
  echoDelay: 'providers',
  echoMessage: 'providers',
  falLora: 'media',
  falLoraName: 'media',
  falLoraScale: 'media',
  falModel: 'media',
  falToken: 'media',
  fallbackModels: 'runtime',
  fallbackWhenBlankResponse: 'runtime',
  fishSpeechKey: 'media',
  fixedChatTextarea: 'sidebar',
  font: 'display',
  forceProxyAsOpenAI: 'advanced',
  forceReplaceUrl: 'providers',
  frequencyPenalty: 'runtime',
  fullScreen: 'display',
  genTime: 'runtime',
  generationSeed: 'runtime',
  goCharacterOnImport: 'sidebar',
  google: 'providers',
  googleClaudeTokenizing: 'runtime',
  gptVisionQuality: 'media',
  guiHTML: 'display',
  hamburgerButtonBottom: 'sidebar',
  heightMode: 'display',
  hideAllImages: 'display',
  hideApiKey: 'display',
  hideRealm: 'display',
  hordeConfig: 'providers',
  htmlTranslation: 'language',
  huggingfaceKey: 'providers',
  hypaCustomSettings: 'memory',
  hypaMemoryKey: 'memory',
  hypaModel: 'memory',
  hypaV3: 'memory',
  hypaV3Key: 'memory',
  hypaV3PresetId: 'memory',
  hypaV3Presets: 'memory',
  hypaV3Settings: 'memory',
  iconsize: 'display',
  imageCompression: 'media',
  ImagenAspectRatio: 'media',
  ImagenImageSize: 'media',
  ImagenModel: 'media',
  ImagenPersonGeneration: 'media',
  inlayErrorResponse: 'advanced',
  instantRemove: 'sidebar',
  keepSessionAlive: 'advanced',
  keiServerURL: 'advanced',
  koboldURL: 'providers',
  language: 'language',
  legacyMediaFindings: 'media',
  legacyTranslation: 'language',
  lineHeight: 'display',
  localActivationInGlobalLorebook: 'sidebar',
  localNetworkMode: 'runtime',
  localNetworkTimeoutSec: 'runtime',
  localStopStrings: 'runtime',
  longPressToPopupEditor: 'sidebar',
  loreBookDepth: 'advanced',
  loreBookToken: 'advanced',
  mancerHeader: 'providers',
  maxContext: 'runtime',
  maxResponse: 'runtime',
  memoryLimitThickness: 'display',
  menuSideBar: 'display',
  min_p: 'runtime',
  mistralKey: 'providers',
  modelTools: 'providers',
  NAIadventure: 'providers',
  NAIApiKey: 'media',
  NAIappendName: 'providers',
  NAII2I: 'media',
  NAIImgConfig: 'media',
  NAIImgModel: 'media',
  NAIImgUrl: 'media',
  NAIREF: 'media',
  NAIsettings: 'providers',
  nanogptKey: 'providers',
  nanogptProvider: 'providers',
  nanogptRequestModel: 'providers',
  nanogptRequestModelName: 'providers',
  nanogptSubscriptionState: 'providers',
  nanogptUseSubscriptionEndpoint: 'providers',
  newImageHandlingBeta: 'media',
  newMessageButtonStyle: 'sidebar',
  newOAIHandle: 'runtime',
  noWaitForTranslate: 'language',
  novelai: 'providers',
  novellistAPI: 'providers',
  OaiCompAPIKeys: 'providers',
  ollamaApiKey: 'providers',
  ollamaCloudModel: 'providers',
  ollamaCloudModelName: 'providers',
  ollamaInputMode: 'providers',
  ollamaModel: 'providers',
  ollamaModelName: 'providers',
  ollamaModelSource: 'providers',
  ollamaRequestFormat: 'providers',
  ollamaThinkingMode: 'providers',
  ollamaURL: 'providers',
  openAIKey: 'providers',
  openaiCompatImage: 'media',
  openrouterFallback: 'providers',
  openrouterKey: 'providers',
  openrouterMiddleOut: 'providers',
  openrouterProvider: 'providers',
  openrouterRequestModel: 'providers',
  outputImageModal: 'media',
  personaNote: 'advanced',
  playMessage: 'display',
  playMessageOnTranslateEnd: 'display',
  pluginDevelopMode: 'advanced',
  PresensePenalty: 'runtime',
  presetChain: 'advanced',
  promptInfoInsideChat: 'advanced',
  promptTextInfoInsideChat: 'advanced',
  proxyKey: 'providers',
  proxyRequestModel: 'providers',
  realmDirectOpen: 'advanced',
  reasoningEffort: 'runtime',
  rememberToolUsage: 'runtime',
  removeIncompleteResponse: 'runtime',
  removePunctuationHypa: 'memory',
  repetition_penalty: 'runtime',
  requestInfoInsideChat: 'sidebar',
  requestLocation: 'runtime',
  requestRetrys: 'runtime',
  returnCSSError: 'advanced',
  reverseProxyOobaArgs: 'providers',
  reverseProxyOobaMode: 'providers',
  roundIcons: 'display',
  saveSignatures: 'advanced',
  sdCFG: 'media',
  sdConfig: 'media',
  sdProvider: 'media',
  sdSteps: 'media',
  sendWithEnter: 'sidebar',
  seperateModels: 'runtime',
  seperateModelsForAxModels: 'runtime',
  seperateParameters: 'runtime',
  seperateParametersByModel: 'runtime',
  seperateParametersEnabled: 'runtime',
  settingsCloseButtonSize: 'display',
  showDeprecatedTriggerV1: 'advanced',
  showDeprecatedTriggerV2: 'advanced',
  showFirstMessagePages: 'display',
  showFolderName: 'display',
  showMemoryLimit: 'display',
  showMenuChatList: 'sidebar',
  showMenuHypaMemoryModal: 'memory',
  showPromptComparison: 'display',
  showSavingIcon: 'display',
  showTranslationLoading: 'language',
  showUnrecommended: 'advanced',
  sideBarSize: 'display',
  sideMenuRerollButton: 'sidebar',
  simplifiedToolUse: 'runtime',
  stabilityKey: 'media',
  stabilityModel: 'media',
  stabllityStyle: 'media',
  streamGeminiThoughts: 'runtime',
  subModel: 'providers',
  supaMemoryKey: 'memory',
  swipe: 'sidebar',
  temperature: 'runtime',
  textAreaSize: 'display',
  textAreaTextSize: 'display',
  textBorder: 'display',
  textgenWebUIBlockingURL: 'providers',
  textgenWebUIStreamURL: 'providers',
  textScreenBorder: 'display',
  textScreenColor: 'display',
  textScreenRounded: 'display',
  textTheme: 'display',
  theme: 'display',
  thinkingTokens: 'runtime',
  thinkingType: 'runtime',
  toggleConfirmRecommendedPreset: 'advanced',
  top_a: 'runtime',
  top_k: 'runtime',
  top_p: 'runtime',
  translateBeforeHTMLFormatting: 'language',
  translator: 'language',
  translatorInputLanguage: 'language',
  translatorMaxResponse: 'language',
  translatorPrompt: 'language',
  translatorType: 'language',
  ttsAutoSpeech: 'media',
  unformatQuotes: 'display',
  useAdditionalAssetsPreview: 'display',
  useAutoTranslateInput: 'language',
  useChatCopy: 'display',
  useChatSticker: 'display',
  useExperimental: 'advanced',
  useExperimentalGoogleTranslator: 'language',
  useLegacyGUI: 'display',
  usePlainFetch: 'runtime',
  useSayNothing: 'advanced',
  useServerGeneration: 'runtime',
  useServerPromptAssembly: 'runtime',
  useStreaming: 'runtime',
  useTokenizerCaching: 'advanced',
  username: 'account',
  vertexAccessToken: 'providers',
  vertexAccessTokenExpires: 'providers',
  vertexClientEmail: 'providers',
  vertexPrivateKey: 'providers',
  vertexRegion: 'providers',
  voicevoxUrl: 'media',
  voyageApiKey: 'memory',
  waifuWidth: 'display',
  waifuWidth2: 'display',
  wavespeedImage: 'media',
  webUiUrl: 'media',
  zoomsize: 'display',
}

export interface CommandEvent {
  type: string
  revision: number
  resource: string
  id?: string
  parentId?: string
}

export type ServerCommandResult<T extends Record<string, unknown> = {}> =
  | ({ status: 'ok'; revision: number; event: CommandEvent } & T)
  | { status: 'conflict'; currentRevision: number }
  | { status: 'error'; error: string }
  | { status: 'unavailable' }

export type SettingsPatch = Record<string, unknown>

export interface RuntimeSettingsPatch extends SettingsPatch {
  useServerPromptAssembly?: boolean
}

export interface PatchRuntimeSettingsInput {
  baseRevision: number
  patch: RuntimeSettingsPatch
}

export interface PatchSettingsGroupInput {
  group: SettingsGroup
  baseRevision: number
  patch: SettingsPatch
}

export interface PatchServerBackedSettingsInput {
  patch: SettingsPatch
  rollback?: () => void
  signal?: AbortSignal | null
}

export type PresetSnapshot = Record<string, unknown> & {
  id?: string
  name?: string
}

export type PromptItemSnapshot = Record<string, unknown> & {
  id?: string
  type?: string
}

export interface PresetCommandInput {
  baseRevision: number
}

export interface CreatePresetCommandInput extends PresetCommandInput {
  preset: PresetSnapshot
}

export interface UpdatePresetCommandInput extends PresetCommandInput {
  presetId: string
  patch: PresetSnapshot
}

export interface DeletePresetCommandInput extends PresetCommandInput {
  presetId: string
  selectPresetId?: string
  apply?: boolean
  saveCurrent?: boolean
}

export interface CopyPresetCommandInput extends PresetCommandInput {
  presetId: string
  name?: string
  saveCurrent?: boolean
}

export interface SelectPresetCommandInput extends PresetCommandInput {
  presetId: string
  apply?: boolean
  saveCurrent?: boolean
}

export interface ImportPresetCommandInput extends PresetCommandInput {
  preset: PresetSnapshot
}

export interface ReorderPresetsCommandInput extends PresetCommandInput {
  presetIds: string[]
}

export interface PatchPromptSettingsCommandInput {
  baseRevision: number
  patch: SettingsPatch
}

export interface CreatePromptItemCommandInput {
  baseRevision: number
  promptItem: PromptItemSnapshot
}

export interface UpdatePromptItemCommandInput {
  baseRevision: number
  itemId: string
  patch: PromptItemSnapshot
}

export interface DeletePromptItemCommandInput {
  baseRevision: number
  itemId: string
}

export interface ReorderPromptItemsCommandInput {
  baseRevision: number
  itemIds: string[]
}

export interface RunServerPresetCommandInput<T extends Record<string, unknown> = {}> {
  command: (baseRevision: number) => Promise<ServerCommandResult<T>>
  rollback?: () => void
  signal?: AbortSignal | null
}

let cachedServerCommandRevision: number | null = null

export function canUseServerCommands(): boolean {
  return isFastifyServer
}

export function settingsGroupForKey(key: string): SettingsGroup | null {
  return SERVER_SETTINGS_GROUP_BY_KEY[key] ?? null
}

export function setCachedServerCommandRevision(revision: number): void {
  if (Number.isInteger(revision) && revision >= 0) {
    cachedServerCommandRevision = revision
  }
}

export function clearCachedServerCommandRevision(): void {
  cachedServerCommandRevision = null
}

export async function getServerCommandBaseRevision(
  signal?: AbortSignal | null,
): Promise<number | null> {
  if (!canUseServerCommands()) return null
  if (cachedServerCommandRevision !== null) return cachedServerCommandRevision

  const auth = await getNodeServerProxyAuth()
  let response: Response
  try {
    response = await fetch(BOOTSTRAP_ENDPOINT, {
      method: 'GET',
      signal: signal ?? undefined,
      headers: {
        'risu-auth': auth,
      },
    })
  } catch {
    return null
  }

  if (!response.ok) return null

  try {
    const body = (await response.json()) as { revision?: unknown }
    if (Number.isInteger(body.revision) && (body.revision as number) >= 0) {
      cachedServerCommandRevision = body.revision as number
      return cachedServerCommandRevision
    }
  } catch {
    return null
  }

  return null
}

export async function patchRuntimeSettings(
  input: PatchRuntimeSettingsInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult> {
  return patchSettingsGroup(
    {
      group: 'runtime',
      ...input,
    },
    signal,
  )
}

export async function patchSettingsGroup(
  input: PatchSettingsGroupInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult> {
  return requestCommandJson(`/settings/${encodeURIComponent(input.group)}`, {
    method: 'PATCH',
    body: {
      baseRevision: input.baseRevision,
      patch: input.patch,
    },
    signal,
  })
}

export async function patchServerBackedSettings(
  input: PatchServerBackedSettingsInput,
): Promise<ServerCommandResult> {
  if (!canUseServerCommands()) return { status: 'unavailable' }

  const grouped = groupSettingsPatch(input.patch)
  if (grouped.length === 0) return { status: 'unavailable' }

  let lastResult: ServerCommandResult = { status: 'unavailable' }
  for (const [group, patch] of grouped) {
    const baseRevision = await getServerCommandBaseRevision(input.signal)
    if (baseRevision === null) {
      input.rollback?.()
      return { status: 'error', error: 'Unable to read server command revision' }
    }

    let result = await patchSettingsGroup({ group, baseRevision, patch }, input.signal)
    if (result.status === 'conflict') {
      result = await patchSettingsGroup(
        {
          group,
          baseRevision: result.currentRevision,
          patch,
        },
        input.signal,
      )
    }

    if (result.status !== 'ok') {
      input.rollback?.()
      return result
    }
    lastResult = result
  }

  return lastResult
}

export async function createPresetCommand(
  input: CreatePresetCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ presetId: string }>> {
  return requestCommandJson('/presets', {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      preset: input.preset,
    },
    signal,
  })
}

export async function updatePresetCommand(
  input: UpdatePresetCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ presetId: string }>> {
  return requestCommandJson(`/presets/${encodeURIComponent(input.presetId)}`, {
    method: 'PATCH',
    body: {
      baseRevision: input.baseRevision,
      patch: input.patch,
    },
    signal,
  })
}

export async function deletePresetCommand(
  input: DeletePresetCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ presetId: string; selectedPresetId: string | null }>> {
  return requestCommandJson(`/presets/${encodeURIComponent(input.presetId)}`, {
    method: 'DELETE',
    body: {
      baseRevision: input.baseRevision,
      presetId: input.selectPresetId,
      apply: input.apply,
      saveCurrent: input.saveCurrent,
    },
    signal,
  })
}

export async function copyPresetCommand(
  input: CopyPresetCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ presetId: string; sourcePresetId: string }>> {
  return requestCommandJson(`/presets/${encodeURIComponent(input.presetId)}/copy`, {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      name: input.name,
      saveCurrent: input.saveCurrent,
    },
    signal,
  })
}

export async function selectPresetCommand(
  input: SelectPresetCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ presetId: string }>> {
  return requestCommandJson('/presets/select', {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      presetId: input.presetId,
      apply: input.apply,
      saveCurrent: input.saveCurrent,
    },
    signal,
  })
}

export async function importPresetCommand(
  input: ImportPresetCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ presetId: string }>> {
  return requestCommandJson('/presets/import', {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      preset: input.preset,
    },
    signal,
  })
}

export async function reorderPresetsCommand(
  input: ReorderPresetsCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ selectedPresetId: string | null }>> {
  return requestCommandJson('/presets/reorder', {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      presetIds: input.presetIds,
    },
    signal,
  })
}

export async function patchPromptSettingsCommand(
  input: PatchPromptSettingsCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult> {
  return requestCommandJson('/prompt-settings', {
    method: 'PATCH',
    body: {
      baseRevision: input.baseRevision,
      patch: input.patch,
    },
    signal,
  })
}

export async function createPromptItemCommand(
  input: CreatePromptItemCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ itemId: string }>> {
  return requestCommandJson('/prompt-items', {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      promptItem: input.promptItem,
    },
    signal,
  })
}

export async function updatePromptItemCommand(
  input: UpdatePromptItemCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ itemId: string }>> {
  return requestCommandJson(`/prompt-items/${encodeURIComponent(input.itemId)}`, {
    method: 'PATCH',
    body: {
      baseRevision: input.baseRevision,
      patch: input.patch,
    },
    signal,
  })
}

export async function deletePromptItemCommand(
  input: DeletePromptItemCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ itemId: string }>> {
  return requestCommandJson(`/prompt-items/${encodeURIComponent(input.itemId)}`, {
    method: 'DELETE',
    body: {
      baseRevision: input.baseRevision,
    },
    signal,
  })
}

export async function reorderPromptItemsCommand(
  input: ReorderPromptItemsCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult> {
  return requestCommandJson('/prompt-items/reorder', {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      itemIds: input.itemIds,
    },
    signal,
  })
}

export async function runServerPresetCommand<T extends Record<string, unknown> = {}>(
  input: RunServerPresetCommandInput<T>,
): Promise<ServerCommandResult<T>> {
  return runServerCommand(input)
}

export async function runServerCommand<T extends Record<string, unknown> = {}>(
  input: RunServerPresetCommandInput<T>,
): Promise<ServerCommandResult<T>> {
  if (!canUseServerCommands()) return { status: 'unavailable' }

  const baseRevision = await getServerCommandBaseRevision(input.signal)
  if (baseRevision === null) {
    input.rollback?.()
    return { status: 'error', error: 'Unable to read server command revision' }
  }

  let result = await input.command(baseRevision)
  if (result.status === 'conflict') {
    result = await input.command(result.currentRevision)
  }

  if (result.status !== 'ok') {
    input.rollback?.()
  }
  return result
}

function groupSettingsPatch(patch: SettingsPatch): Array<[SettingsGroup, SettingsPatch]> {
  const groups = new Map<SettingsGroup, SettingsPatch>()
  for (const [key, value] of Object.entries(patch)) {
    const group = settingsGroupForKey(key)
    if (!group || value === undefined) continue
    const groupPatch = groups.get(group) ?? {}
    groupPatch[key] = value
    groups.set(group, groupPatch)
  }
  return Array.from(groups.entries())
}

async function requestCommandJson<T extends Record<string, unknown> = {}>(
  path: string,
  init: { method: string; body: unknown; signal?: AbortSignal | null },
): Promise<ServerCommandResult<T>> {
  if (!canUseServerCommands()) return { status: 'unavailable' }

  const auth = await getNodeServerProxyAuth()
  let response: Response
  try {
    response = await fetch(`${COMMAND_ENDPOINT}${path}`, {
      method: init.method,
      signal: init.signal ?? undefined,
      headers: {
        'content-type': 'application/json',
        'risu-auth': auth,
      },
      body: JSON.stringify(init.body),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { status: 'error', error: `Network error: ${message}` }
  }

  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    // Non-JSON command errors are reported by HTTP status below.
  }

  if (response.status === 409) {
    const currentRevision = readCurrentRevision(body)
    if (currentRevision !== null) setCachedServerCommandRevision(currentRevision)
    return currentRevision === null
      ? { status: 'error', error: errorMessageFromBody(body, 'HTTP 409') }
      : { status: 'conflict', currentRevision }
  }

  if (!response.ok) {
    return {
      status: 'error',
      error: errorMessageFromBody(body, `HTTP ${response.status}`),
    }
  }

  if (body && typeof body === 'object') {
    const revision = (body as { revision?: unknown }).revision
    if (Number.isInteger(revision) && (revision as number) >= 0) {
      setCachedServerCommandRevision(revision as number)
    }
  }

  return { status: 'ok', ...(body as { revision: number; event: CommandEvent } & T) }
}

function readCurrentRevision(body: unknown): number | null {
  if (!body || typeof body !== 'object') return null
  const currentRevision = (body as { currentRevision?: unknown }).currentRevision
  return Number.isInteger(currentRevision) ? (currentRevision as number) : null
}

function errorMessageFromBody(body: unknown, fallback: string): string {
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>
    if (typeof record.error === 'string') return record.error
    if (typeof record.reason === 'string') return record.reason
  }
  return fallback
}
