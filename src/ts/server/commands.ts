import { getNodeServerProxyAuth } from '../storage/fastifyStorage'
import type { ChatGenerationSettings } from '../chatGenerationSettings'
import { activeWriterSessionHeader, handleActiveWriterStaleResponse } from './activeWriterSession'

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
  additionalParams: 'providers',
  alwaysScrollToNewMessage: 'sidebar',
  animationSpeed: 'display',
  antiClaudeOverload: 'runtime',
  antiServerOverloads: 'runtime',
  apiType: 'providers',
  askRemoval: 'sidebar',
  assetMaxDifference: 'advanced',
  assetWidth: 'display',
  authRefreshes: 'providers',
  autoScrollToNewMessage: 'sidebar',
  autoTranslate: 'language',
  autoTranslateCachedOnly: 'language',
  automaticCachePoint: 'runtime',
  autofillRequestUrl: 'advanced',
  allowAllExtentionFiles: 'advanced',
  auxModelUnderModelSettings: 'advanced',
  banCharacterset: 'advanced',
  bias: 'providers',
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
  customTextTheme: 'display',
  cohereAPIKey: 'providers',
  combineTranslation: 'language',
  comfyConfig: 'media',
  comfyUiUrl: 'media',
  createFolderOnBranch: 'sidebar',
  currentPluginProvider: 'providers',
  customAPIFormat: 'providers',
  customBackground: 'display',
  chatDisplayTailCount: 'display',
  customCSS: 'display',
  customFont: 'display',
  customGUI: 'display',
  customModels: 'providers',
  customSidebarItems: 'sidebar',
  customProxyRequestModel: 'providers',
  customQuotes: 'display',
  customQuotesData: 'display',
  customFlags: 'advanced',
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
  doNotWarnExternalServers: 'advanced',
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
  enableLorebookStubs: 'advanced',
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
  globalChatVariables: 'sidebar',
  googleClaudeTokenizing: 'runtime',
  gptVisionQuality: 'media',
  guiHTML: 'display',
  globalscript: 'advanced',
  hamburgerButtonBottom: 'sidebar',
  heightMode: 'display',
  hideAllImages: 'display',
  hideApiKey: 'display',
  hideRealm: 'display',
  hordeConfig: 'providers',
  hotkeys: 'sidebar',
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
  instructChatTemplate: 'providers',
  instantRemove: 'sidebar',
  JinjaTemplate: 'providers',
  jailbreakToggle: 'sidebar',
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
  moduleIntergration: 'advanced',
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
  notification: 'display',
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
  ooba: 'providers',
  openAIKey: 'providers',
  openaiCompatImage: 'media',
  openrouterFallback: 'providers',
  openrouterKey: 'providers',
  openrouterMiddleOut: 'providers',
  openrouterProvider: 'providers',
  openrouterRequestModel: 'providers',
  useInstructPrompt: 'providers',
  outputImageModal: 'media',
  personaNote: 'advanced',
  playMessage: 'display',
  playMessageOnTranslateEnd: 'display',
  pluginCompatibilityMode: 'advanced',
  pluginDevelopMode: 'advanced',
  PresensePenalty: 'runtime',
  presetChain: 'advanced',
  promptInfoInsideChat: 'advanced',
  promptDiffPrefs: 'display',
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
  useAutoSuggestions: 'runtime',
  useAutoTranslateInput: 'language',
  useChatCopy: 'display',
  useChatSticker: 'display',
  useExperimental: 'advanced',
  useExperimentalGoogleTranslator: 'language',
  useLegacyGUI: 'display',
  usePlainFetch: 'runtime',
  useSayNothing: 'advanced',
  useStreaming: 'runtime',
  useTokenizerCaching: 'advanced',
  username: 'account',
  vertexAccessToken: 'providers',
  vertexAccessTokenExpires: 'providers',
  vertexClientEmail: 'providers',
  vertexPrivateKey: 'providers',
  vertexRegion: 'providers',
  verbosity: 'runtime',
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
  origin?: {
    writerSessionId: string
  }
}

export type ServerCommandResult<T extends Record<string, unknown> = {}> =
  | ({ status: 'ok'; revision: number; event: CommandEvent } & T)
  | { status: 'conflict'; currentRevision: number }
  | { status: 'error'; error: string }
  | { status: 'unavailable' }

export type SettingsPatch = Record<string, unknown>

export type RuntimeSettingsPatch = SettingsPatch

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
  keepalive?: boolean
}

export type PresetSnapshot = Record<string, unknown> & {
  id?: string
  name?: string
}

export type PromptItemSnapshot = Record<string, unknown> & {
  id?: string
  type?: string
}

export type PersonaSnapshot = Record<string, unknown> & {
  id?: string
  name?: string
  icon?: string
  personaPrompt?: string
  note?: string
  largePortrait?: boolean
}

export type TranslatorPresetSnapshot = Record<string, unknown> & {
  id?: string
  name?: string
  prompt?: string
  maxResponse?: number
}

export type LoadoutSnapshot = Record<string, unknown> & {
  id?: string
  name?: string
  lastUsed?: number
  favorite?: boolean
  characterIds?: string[]
  modules?: string[]
  globalVariables?: Record<string, string>
  presetName?: string
  personaId?: string
}

export type CharacterSnapshot = Record<string, unknown> & {
  chaId?: string
  name?: string
  trashTime?: number | null
}

export type CharacterOrderEntry =
  | string
  | (Record<string, unknown> & {
      id: string
      name?: string
      color?: string
      data: string[]
      imgFile?: string | null
      img?: string
    })

export type ChatSnapshot = Record<string, unknown> & {
  id?: string
  message?: unknown[]
  note?: string
  name?: string
  localLore?: unknown[]
  generationSettings?: ChatGenerationSettings
  folderId?: string | null
  bindedPersona?: string
  bookmarks?: string[]
  bookmarkNames?: Record<string, string>
  modules?: string[]
}

export type LorebookEntrySnapshot = Record<string, unknown> & {
  id?: string
  key?: string
  secondkey?: string
  insertorder?: number
  comment?: string
  content?: string
  mode?: string
  alwaysActive?: boolean
  selective?: boolean
  folder?: string
}

export type GlobalLorebookSnapshot = Record<string, unknown> & {
  id?: string
  name?: string
  data?: LorebookEntrySnapshot[]
}

export type ModuleSnapshot = Record<string, unknown> & {
  id?: string
  name?: string
  description?: string
  namespace?: string
  lowLevelAccess?: boolean
  hideIcon?: boolean
  backgroundEmbedding?: string
  customModuleToggle?: string
  cjs?: string
}

export type PluginSnapshot = Record<string, unknown> & {
  name?: string
  script?: string
  arguments?: Record<string, 'int' | 'string' | string[]>
  realArg?: Record<string, string | number>
  customLink?: Array<{ link: string; hoverText?: string }>
  argMeta?: Record<string, Record<string, string>>
  version?: 1 | 2 | '2.1' | '3.0'
  displayName?: string
  versionOfPlugin?: string
  updateURL?: string
  enabled?: boolean
  allowedIPC?: string[]
}

export type ScriptDefinitionSnapshot = Record<string, unknown> & {
  id?: string
  comment?: string
  in?: string
  out?: string
  type?: string
  flag?: string
  ableFlag?: boolean
}

export type TriggerDefinitionSnapshot = Record<string, unknown> & {
  id?: string
  comment?: string
  type?: string
  conditions?: unknown[]
  effect?: unknown[]
}

export type ChatScriptstateValue = string | number | boolean
export type ChatScriptstatePatch = Record<string, ChatScriptstateValue>

export type ChatFolderSnapshot = Record<string, unknown> & {
  id?: string
  name?: string
  color?: string
  folded?: boolean
}

export type MessageSnapshot = Record<string, unknown> & {
  role?: 'user' | 'char'
  data?: string
  chatId?: string
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
  newPresetId: string
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

export interface EnablePromptItemsCommandInput {
  baseRevision: number
  enabled: boolean
}

export interface PersonaCommandInput {
  baseRevision: number
}

export interface CreatePersonaCommandInput extends PersonaCommandInput {
  persona: PersonaSnapshot
  mirrorLegacyProfile?: boolean
}

export interface UpdatePersonaCommandInput extends PersonaCommandInput {
  personaId: string
  patch: PersonaSnapshot
  mirrorLegacyProfile?: boolean
}

export interface DeletePersonaCommandInput extends PersonaCommandInput {
  personaId: string
  selectPersonaId?: string
  mirrorLegacyProfile?: boolean
  saveCurrent?: boolean
}

export interface SelectPersonaCommandInput extends PersonaCommandInput {
  personaId: string
  mirrorLegacyProfile?: boolean
  saveCurrent?: boolean
}

export interface ReorderPersonasCommandInput extends PersonaCommandInput {
  personaIds: string[]
}

export interface TranslatorPresetCommandInput {
  baseRevision: number
}

export interface CreateTranslatorPresetCommandInput extends TranslatorPresetCommandInput {
  preset: TranslatorPresetSnapshot
  select?: boolean
}

export interface UpdateTranslatorPresetCommandInput extends TranslatorPresetCommandInput {
  presetId: string
  patch: TranslatorPresetSnapshot
}

export interface DeleteTranslatorPresetCommandInput extends TranslatorPresetCommandInput {
  presetId: string
  selectPresetId?: string
}

export interface SelectTranslatorPresetCommandInput extends TranslatorPresetCommandInput {
  presetId: string
}

export interface LoadoutCommandInput {
  baseRevision: number
}

export interface CreateLoadoutCommandInput extends LoadoutCommandInput {
  loadout: LoadoutSnapshot
}

export interface UpdateLoadoutCommandInput extends LoadoutCommandInput {
  loadoutId: string
  patch: LoadoutSnapshot
}

export interface DeleteLoadoutCommandInput extends LoadoutCommandInput {
  loadoutId: string
}

export interface FavoriteLoadoutCommandInput extends LoadoutCommandInput {
  loadoutId: string
  favorite: boolean
}

export interface TouchLoadoutCommandInput extends LoadoutCommandInput {
  loadoutId: string
  lastUsed?: number
  characterId?: string
}

export interface CharacterCommandInput {
  baseRevision: number
}

export interface CreateCharacterCommandInput extends CharacterCommandInput {
  character: CharacterSnapshot
}

export interface CreateAndSelectCharacterCommandInput extends CreateCharacterCommandInput {
  lastInteraction?: number
}

export interface UpdateCharacterCommandInput extends CharacterCommandInput {
  characterId: string
  patch: CharacterSnapshot
}

export interface DeleteCharacterCommandInput extends CharacterCommandInput {
  characterId: string
}

export interface SelectCharacterCommandInput extends CharacterCommandInput {
  characterId: string
  lastInteraction?: number
}

export interface ReorderCharactersCommandInput extends CharacterCommandInput {
  characterOrder: CharacterOrderEntry[]
}

export interface ChatCommandInput {
  baseRevision: number
}

export interface CreateChatCommandInput extends ChatCommandInput {
  characterId: string
  chat: ChatSnapshot
  select?: boolean
}

export interface UpdateChatCommandInput extends ChatCommandInput {
  chatId: string
  patch: ChatSnapshot
  select?: boolean
}

export interface SaveChatGenerationSettingsCommandInput extends ChatCommandInput {
  chatId: string
  generationSettings: ChatGenerationSettings
}

export interface DeleteChatCommandInput extends ChatCommandInput {
  chatId: string
}

export interface ForkChatCommandInput extends ChatCommandInput {
  chatId: string
  chat: ChatSnapshot
  sourcePatch?: ChatSnapshot
  folder?: ChatFolderSnapshot
  select?: boolean
}

export interface ReorderChatsCommandInput extends ChatCommandInput {
  characterId: string
  chatIds: string[]
  folderByChatId?: Record<string, string | null>
  selectedChatId?: string
}

export interface CreateChatFolderCommandInput extends ChatCommandInput {
  characterId: string
  folder: ChatFolderSnapshot
}

export interface UpdateChatFolderCommandInput extends ChatCommandInput {
  folderId: string
  patch: ChatFolderSnapshot
}

export interface DeleteChatFolderCommandInput extends ChatCommandInput {
  folderId: string
}

export interface ReorderChatFoldersCommandInput extends ChatCommandInput {
  characterId: string
  folderIds: string[]
  selectedChatId?: string
}

export interface PatchChatScriptstateCommandInput extends ChatCommandInput {
  chatId: string
  patch: ChatScriptstatePatch
  deleteKeys?: string[]
}

export interface LorebookCommandInput {
  baseRevision: number
}

export interface CreateGlobalLorebookCommandInput extends LorebookCommandInput {
  lorebook: GlobalLorebookSnapshot
}

export interface UpdateGlobalLorebookCommandInput extends LorebookCommandInput {
  lorebookId: string
  patch: Pick<GlobalLorebookSnapshot, 'name'>
}

export interface DeleteGlobalLorebookCommandInput extends LorebookCommandInput {
  lorebookId: string
}

export interface ReorderGlobalLorebooksCommandInput extends LorebookCommandInput {
  lorebookIds: string[]
}

export interface SelectGlobalLorebookCommandInput extends LorebookCommandInput {
  lorebookId: string
}

export interface ReplaceGlobalLorebookEntriesCommandInput extends LorebookCommandInput {
  lorebookId: string
  entries: LorebookEntrySnapshot[]
}

export interface UpsertGlobalLorebookEntryCommandInput extends LorebookCommandInput {
  lorebookId: string
  entryId: string
  entry: LorebookEntrySnapshot
}

export interface DeleteGlobalLorebookEntryCommandInput extends LorebookCommandInput {
  lorebookId: string
  entryId: string
}

export interface ReorderGlobalLorebookEntriesCommandInput extends LorebookCommandInput {
  lorebookId: string
  entryIds: string[]
}

export interface ReplaceCharacterLorebooksCommandInput extends LorebookCommandInput {
  characterId: string
  entries: LorebookEntrySnapshot[]
}

export interface UpsertCharacterLorebookEntryCommandInput extends LorebookCommandInput {
  characterId: string
  entryId: string
  entry: LorebookEntrySnapshot
}

export interface DeleteCharacterLorebookEntryCommandInput extends LorebookCommandInput {
  characterId: string
  entryId: string
}

export interface ReorderCharacterLorebookEntriesCommandInput extends LorebookCommandInput {
  characterId: string
  entryIds: string[]
}

export interface ReplaceChatLorebooksCommandInput extends LorebookCommandInput {
  chatId: string
  entries: LorebookEntrySnapshot[]
}

export interface UpsertChatLorebookEntryCommandInput extends LorebookCommandInput {
  chatId: string
  entryId: string
  entry: LorebookEntrySnapshot
}

export interface DeleteChatLorebookEntryCommandInput extends LorebookCommandInput {
  chatId: string
  entryId: string
}

export interface ReorderChatLorebookEntriesCommandInput extends LorebookCommandInput {
  chatId: string
  entryIds: string[]
}

export interface ReplaceModuleLorebooksCommandInput extends LorebookCommandInput {
  moduleId: string
  entries: LorebookEntrySnapshot[]
}

export interface UpsertModuleLorebookEntryCommandInput extends LorebookCommandInput {
  moduleId: string
  entryId: string
  entry: LorebookEntrySnapshot
}

export interface DeleteModuleLorebookEntryCommandInput extends LorebookCommandInput {
  moduleId: string
  entryId: string
}

export interface ReorderModuleLorebookEntriesCommandInput extends LorebookCommandInput {
  moduleId: string
  entryIds: string[]
}

export interface ScriptDefinitionCommandInput {
  baseRevision: number
}

export interface ReplaceCharacterScriptsCommandInput extends ScriptDefinitionCommandInput {
  characterId: string
  scripts: ScriptDefinitionSnapshot[]
}

export interface ReplaceCharacterTriggersCommandInput extends ScriptDefinitionCommandInput {
  characterId: string
  triggers: TriggerDefinitionSnapshot[]
}

export interface ReplaceModuleScriptsCommandInput extends ScriptDefinitionCommandInput {
  moduleId: string
  scripts: ScriptDefinitionSnapshot[]
}

export interface ReplaceModuleTriggersCommandInput extends ScriptDefinitionCommandInput {
  moduleId: string
  triggers: TriggerDefinitionSnapshot[]
}

export interface ModuleCommandInput {
  baseRevision: number
}

export interface CreateModuleCommandInput extends ModuleCommandInput {
  module: ModuleSnapshot
}

export interface UpdateModuleCommandInput extends ModuleCommandInput {
  moduleId: string
  patch: ModuleSnapshot
}

export interface DeleteModuleCommandInput extends ModuleCommandInput {
  moduleId: string
}

export interface EnableModuleCommandInput extends ModuleCommandInput {
  moduleId: string
  enabled: boolean
}

export interface ReorderModulesCommandInput extends ModuleCommandInput {
  moduleIds: string[]
}

export interface ReorderCharacterModulesCommandInput extends ModuleCommandInput {
  characterId: string
  moduleIds: string[]
}

export interface PluginCommandInput {
  baseRevision: number
}

export interface CreatePluginCommandInput extends PluginCommandInput {
  plugin: PluginSnapshot
}

export interface UpdatePluginCommandInput extends PluginCommandInput {
  pluginId: string
  patch: PluginSnapshot
}

export interface DeletePluginCommandInput extends PluginCommandInput {
  pluginId: string
}

export interface EnablePluginCommandInput extends PluginCommandInput {
  pluginId: string
  enabled: boolean
}

export interface SelectPluginProviderCommandInput extends PluginCommandInput {
  provider: string
}

export interface ReorderPluginsCommandInput extends PluginCommandInput {
  pluginIds: string[]
}

export interface PutPluginStorageCommandInput extends PluginCommandInput {
  key: string
  value: unknown
}

export interface DeletePluginStorageCommandInput extends PluginCommandInput {
  key: string
}

export interface BulkPluginStorageCommandInput extends PluginCommandInput {
  values?: Record<string, unknown>
  deleteKeys?: string[]
  clear?: boolean
}

export interface AppendMessageCommandInput extends ChatCommandInput {
  chatId: string
  message: MessageSnapshot
}

export interface UpdateMessageCommandInput extends ChatCommandInput {
  messageId: string
  patch: MessageSnapshot
}

export interface DeleteMessageCommandInput extends ChatCommandInput {
  messageId: string
}

export interface TruncateMessagesCommandInput extends ChatCommandInput {
  chatId: string
  afterMessageId?: string | null
}

export interface ReplaceTailMessagesCommandInput extends ChatCommandInput {
  chatId: string
  afterMessageId?: string | null
  messages: MessageSnapshot[]
}

export interface ReplaceMessagesCommandInput extends ChatCommandInput {
  chatId: string
  messages: MessageSnapshot[]
}

export interface PersistGenerationResultCommandInput extends ChatCommandInput {
  chatId: string
  generationResult: {
    message: MessageSnapshot
    targetMessageId?: string
  }
}

export interface RunServerPresetCommandInput<T extends Record<string, unknown> = {}> {
  command: (baseRevision: number) => Promise<ServerCommandResult<T>>
  rollback?: () => void
  signal?: AbortSignal | null
  keepalive?: boolean
}

export interface ServerCommandTransportOptions {
  signal?: AbortSignal | null
  keepalive?: boolean
}

let cachedServerCommandRevision: number | null = null

export function canUseServerCommands(): boolean {
  return true
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

/**
 * Returns the cached revision without ever issuing a fetch. Surgical sync needs
 * to compare an inbound event's revision against the last revision this client
 * applied, with no network round trip in the hot path; `null` means we have no
 * baseline yet and must full-bootstrap.
 */
export function peekCachedServerCommandRevision(): number | null {
  return cachedServerCommandRevision
}

export async function getServerCommandBaseRevision(
  signal?: AbortSignal | null,
  keepalive = false,
): Promise<number | null> {
  if (!canUseServerCommands()) return null
  if (cachedServerCommandRevision !== null) return cachedServerCommandRevision

  const auth = await getNodeServerProxyAuth()
  let response: Response
  try {
    const init: RequestInit = {
      method: 'GET',
      signal: signal ?? undefined,
      headers: {
        'risu-auth': auth,
      },
    }
    if (keepalive) init.keepalive = true
    response = await fetch(BOOTSTRAP_ENDPOINT, init)
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
  keepalive = false,
): Promise<ServerCommandResult> {
  return requestCommandJson(`/settings/${encodeURIComponent(input.group)}`, {
    method: 'PATCH',
    body: {
      baseRevision: input.baseRevision,
      patch: input.patch,
    },
    signal,
    keepalive,
  })
}

/**
 * First-run seed: ask a fresh server (whose persisted `database` is still
 * `null`) to create its default database. Must run before any other command,
 * which all require an existing database object. The server guards this
 * idempotently — it only writes when no database exists yet, so calling it
 * against an already-initialized server is a harmless no-op (`initialized: false`).
 */
export async function initializeServerDatabase(
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ initialized: boolean }>> {
  return requestCommandJson('/state/initialize', {
    method: 'POST',
    body: {},
    signal,
  })
}

export async function patchServerBackedSettings(input: PatchServerBackedSettingsInput): Promise<ServerCommandResult> {
  if (!canUseServerCommands()) return { status: 'unavailable' }

  const grouped = groupSettingsPatch(input.patch)
  if (grouped.length === 0) return { status: 'unavailable' }

  let lastResult: ServerCommandResult = { status: 'unavailable' }
  for (const [group, patch] of grouped) {
    const baseRevision = await getServerCommandBaseRevision(input.signal, input.keepalive)
    if (baseRevision === null) {
      input.rollback?.()
      return { status: 'error', error: 'Unable to read server command revision' }
    }

    const result = await patchSettingsGroup({ group, baseRevision, patch }, input.signal, input.keepalive)

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
      newPresetId: input.newPresetId,
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
  keepalive = false,
): Promise<ServerCommandResult> {
  return requestCommandJson('/prompt-settings', {
    method: 'PATCH',
    body: {
      baseRevision: input.baseRevision,
      patch: input.patch,
    },
    signal,
    keepalive,
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
  keepalive = false,
): Promise<ServerCommandResult<{ itemId: string }>> {
  return requestCommandJson(`/prompt-items/${encodeURIComponent(input.itemId)}`, {
    method: 'PATCH',
    body: {
      baseRevision: input.baseRevision,
      patch: input.patch,
    },
    signal,
    keepalive,
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

export async function enablePromptItemsCommand(
  input: EnablePromptItemsCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ enabled: boolean }>> {
  return requestCommandJson('/prompt-items/enable', {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      enabled: input.enabled,
    },
    signal,
  })
}

export async function createPersonaCommand(
  input: CreatePersonaCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ personaId: string }>> {
  return requestCommandJson('/personas', {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      persona: input.persona,
      mirrorLegacyProfile: input.mirrorLegacyProfile,
    },
    signal,
  })
}

export async function updatePersonaCommand(
  input: UpdatePersonaCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ personaId: string }>> {
  return requestCommandJson(`/personas/${encodeURIComponent(input.personaId)}`, {
    method: 'PATCH',
    body: {
      baseRevision: input.baseRevision,
      patch: input.patch,
      mirrorLegacyProfile: input.mirrorLegacyProfile,
    },
    signal,
  })
}

export async function deletePersonaCommand(
  input: DeletePersonaCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ personaId: string; selectedPersonaId: string | null }>> {
  return requestCommandJson(`/personas/${encodeURIComponent(input.personaId)}`, {
    method: 'DELETE',
    body: {
      baseRevision: input.baseRevision,
      selectPersonaId: input.selectPersonaId,
      mirrorLegacyProfile: input.mirrorLegacyProfile,
      saveCurrent: input.saveCurrent,
    },
    signal,
  })
}

export async function selectPersonaCommand(
  input: SelectPersonaCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ personaId: string }>> {
  return requestCommandJson('/personas/select', {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      personaId: input.personaId,
      mirrorLegacyProfile: input.mirrorLegacyProfile,
      saveCurrent: input.saveCurrent,
    },
    signal,
  })
}

export async function reorderPersonasCommand(
  input: ReorderPersonasCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ selectedPersonaId: string | null }>> {
  return requestCommandJson('/personas/reorder', {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      personaIds: input.personaIds,
    },
    signal,
  })
}

export async function createTranslatorPresetCommand(
  input: CreateTranslatorPresetCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ presetId: string }>> {
  return requestCommandJson('/translator-presets', {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      preset: input.preset,
      select: input.select,
    },
    signal,
  })
}

export async function updateTranslatorPresetCommand(
  input: UpdateTranslatorPresetCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ presetId: string }>> {
  return requestCommandJson(`/translator-presets/${encodeURIComponent(input.presetId)}`, {
    method: 'PATCH',
    body: {
      baseRevision: input.baseRevision,
      patch: input.patch,
    },
    signal,
  })
}

export async function deleteTranslatorPresetCommand(
  input: DeleteTranslatorPresetCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ presetId: string; selectedPresetId: string | null }>> {
  return requestCommandJson(`/translator-presets/${encodeURIComponent(input.presetId)}`, {
    method: 'DELETE',
    body: {
      baseRevision: input.baseRevision,
      selectPresetId: input.selectPresetId,
    },
    signal,
  })
}

export async function selectTranslatorPresetCommand(
  input: SelectTranslatorPresetCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ presetId: string }>> {
  return requestCommandJson('/translator-presets/select', {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      presetId: input.presetId,
    },
    signal,
  })
}

export async function createLoadoutCommand(
  input: CreateLoadoutCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ loadoutId: string }>> {
  return requestCommandJson('/loadouts', {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      loadout: input.loadout,
    },
    signal,
  })
}

export async function updateLoadoutCommand(
  input: UpdateLoadoutCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ loadoutId: string }>> {
  return requestCommandJson(`/loadouts/${encodeURIComponent(input.loadoutId)}`, {
    method: 'PATCH',
    body: {
      baseRevision: input.baseRevision,
      patch: input.patch,
    },
    signal,
  })
}

export async function deleteLoadoutCommand(
  input: DeleteLoadoutCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ loadoutId: string }>> {
  return requestCommandJson(`/loadouts/${encodeURIComponent(input.loadoutId)}`, {
    method: 'DELETE',
    body: {
      baseRevision: input.baseRevision,
    },
    signal,
  })
}

export async function favoriteLoadoutCommand(
  input: FavoriteLoadoutCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ loadoutId: string }>> {
  return requestCommandJson(`/loadouts/${encodeURIComponent(input.loadoutId)}/favorite`, {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      favorite: input.favorite,
    },
    signal,
  })
}

export async function touchLoadoutCommand(
  input: TouchLoadoutCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ loadoutId: string }>> {
  return requestCommandJson(`/loadouts/${encodeURIComponent(input.loadoutId)}/touch`, {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      lastUsed: input.lastUsed,
      characterId: input.characterId,
    },
    signal,
  })
}

export async function createCharacterCommand(
  input: CreateCharacterCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ characterId: string }>> {
  return requestCommandJson('/characters', {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      character: input.character,
    },
    signal,
  })
}

export async function createAndSelectCharacterCommand(
  input: CreateAndSelectCharacterCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ characterId: string }>> {
  return requestCommandJson('/characters/create-and-select', {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      character: input.character,
      lastInteraction: input.lastInteraction,
    },
    signal,
  })
}

export async function updateCharacterCommand(
  input: UpdateCharacterCommandInput,
  signal?: AbortSignal | null,
  keepalive = false,
): Promise<ServerCommandResult<{ characterId: string }>> {
  return requestCommandJson(`/characters/${encodeURIComponent(input.characterId)}`, {
    method: 'PATCH',
    body: {
      baseRevision: input.baseRevision,
      patch: input.patch,
    },
    signal,
    keepalive,
  })
}

export async function deleteCharacterCommand(
  input: DeleteCharacterCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ characterId: string; selectedCharacterId: string | null }>> {
  return requestCommandJson(`/characters/${encodeURIComponent(input.characterId)}`, {
    method: 'DELETE',
    body: {
      baseRevision: input.baseRevision,
    },
    signal,
  })
}

export async function selectCharacterCommand(
  input: SelectCharacterCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ characterId: string }>> {
  return requestCommandJson('/characters/select', {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      characterId: input.characterId,
      lastInteraction: input.lastInteraction,
    },
    signal,
  })
}

export async function reorderCharactersCommand(
  input: ReorderCharactersCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ selectedCharacterId: string | null }>> {
  return requestCommandJson('/characters/reorder', {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      characterOrder: input.characterOrder,
    },
    signal,
  })
}

export async function createChatCommand(
  input: CreateChatCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ chatId: string; selectedChatId: string | null }>> {
  return requestCommandJson(`/characters/${encodeURIComponent(input.characterId)}/chats`, {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      chat: input.chat,
      select: input.select,
    },
    signal,
  })
}

export async function updateChatCommand(
  input: UpdateChatCommandInput,
  signal?: AbortSignal | null,
  keepalive = false,
): Promise<ServerCommandResult<{ chatId: string; selectedChatId: string | null }>> {
  return requestCommandJson(`/chats/${encodeURIComponent(input.chatId)}`, {
    method: 'PATCH',
    body: {
      baseRevision: input.baseRevision,
      patch: input.patch,
      select: input.select,
    },
    signal,
    keepalive,
  })
}

export async function saveChatGenerationSettingsCommand(
  input: SaveChatGenerationSettingsCommandInput,
  signal?: AbortSignal | null,
  keepalive = false,
): Promise<ServerCommandResult<{ chatId: string }>> {
  return requestCommandJson(`/chats/${encodeURIComponent(input.chatId)}/generation-settings`, {
    method: 'PUT',
    body: {
      baseRevision: input.baseRevision,
      generationSettings: input.generationSettings,
    },
    signal,
    keepalive,
  })
}

export async function deleteChatCommand(
  input: DeleteChatCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ chatId: string; selectedChatId: string | null }>> {
  return requestCommandJson(`/chats/${encodeURIComponent(input.chatId)}`, {
    method: 'DELETE',
    body: {
      baseRevision: input.baseRevision,
    },
    signal,
  })
}

export async function forkChatCommand(
  input: ForkChatCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ chatId: string; sourceChatId: string; selectedChatId: string | null }>> {
  return requestCommandJson(`/chats/${encodeURIComponent(input.chatId)}/fork`, {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      chat: input.chat,
      sourcePatch: input.sourcePatch,
      folder: input.folder,
      select: input.select,
    },
    signal,
  })
}

export async function reorderChatsCommand(
  input: ReorderChatsCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ selectedChatId: string | null }>> {
  return requestCommandJson(`/characters/${encodeURIComponent(input.characterId)}/chats/reorder`, {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      chatIds: input.chatIds,
      folderByChatId: input.folderByChatId,
      selectedChatId: input.selectedChatId,
    },
    signal,
  })
}

export async function createChatFolderCommand(
  input: CreateChatFolderCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ folderId: string }>> {
  return requestCommandJson(`/characters/${encodeURIComponent(input.characterId)}/chat-folders`, {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      folder: input.folder,
    },
    signal,
  })
}

export async function updateChatFolderCommand(
  input: UpdateChatFolderCommandInput,
  signal?: AbortSignal | null,
  keepalive = false,
): Promise<ServerCommandResult<{ folderId: string }>> {
  return requestCommandJson(`/chat-folders/${encodeURIComponent(input.folderId)}`, {
    method: 'PATCH',
    body: {
      baseRevision: input.baseRevision,
      patch: input.patch,
    },
    signal,
    keepalive,
  })
}

export async function deleteChatFolderCommand(
  input: DeleteChatFolderCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ folderId: string }>> {
  return requestCommandJson(`/chat-folders/${encodeURIComponent(input.folderId)}`, {
    method: 'DELETE',
    body: {
      baseRevision: input.baseRevision,
    },
    signal,
  })
}

export async function reorderChatFoldersCommand(
  input: ReorderChatFoldersCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ selectedChatId: string | null }>> {
  return requestCommandJson(`/characters/${encodeURIComponent(input.characterId)}/chat-folders/reorder`, {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      folderIds: input.folderIds,
      selectedChatId: input.selectedChatId,
    },
    signal,
  })
}

export async function patchChatScriptstateCommand(
  input: PatchChatScriptstateCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ chatId: string }>> {
  return requestCommandJson(`/chats/${encodeURIComponent(input.chatId)}/scriptstate`, {
    method: 'PATCH',
    body: {
      baseRevision: input.baseRevision,
      patch: input.patch,
      deleteKeys: input.deleteKeys,
    },
    signal,
  })
}

export async function createGlobalLorebookCommand(
  input: CreateGlobalLorebookCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ lorebookId: string }>> {
  return requestCommandJson('/lorebooks', {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      lorebook: input.lorebook,
    },
    signal,
  })
}

export async function updateGlobalLorebookCommand(
  input: UpdateGlobalLorebookCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ lorebookId: string }>> {
  return requestCommandJson(`/lorebooks/${encodeURIComponent(input.lorebookId)}`, {
    method: 'PATCH',
    body: {
      baseRevision: input.baseRevision,
      patch: input.patch,
    },
    signal,
  })
}

export async function deleteGlobalLorebookCommand(
  input: DeleteGlobalLorebookCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ lorebookId: string }>> {
  return requestCommandJson(`/lorebooks/${encodeURIComponent(input.lorebookId)}`, {
    method: 'DELETE',
    body: {
      baseRevision: input.baseRevision,
    },
    signal,
  })
}

export async function reorderGlobalLorebooksCommand(
  input: ReorderGlobalLorebooksCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ selectedLorebookId: string | null }>> {
  return requestCommandJson('/lorebooks/reorder', {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      lorebookIds: input.lorebookIds,
    },
    signal,
  })
}

export async function selectGlobalLorebookCommand(
  input: SelectGlobalLorebookCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ selectedLorebookId: string }>> {
  return requestCommandJson(`/lorebooks/${encodeURIComponent(input.lorebookId)}/select`, {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
    },
    signal,
  })
}

export async function replaceGlobalLorebookEntriesCommand(
  input: ReplaceGlobalLorebookEntriesCommandInput,
  signal?: AbortSignal | null,
  keepalive = false,
): Promise<ServerCommandResult<{ lorebookId: string }>> {
  return requestCommandJson(`/lorebooks/${encodeURIComponent(input.lorebookId)}/entries`, {
    method: 'PUT',
    body: {
      baseRevision: input.baseRevision,
      entries: input.entries,
    },
    signal,
    keepalive,
  })
}

export async function upsertGlobalLorebookEntryCommand(
  input: UpsertGlobalLorebookEntryCommandInput,
  signal?: AbortSignal | null,
  keepalive = false,
): Promise<ServerCommandResult<{ lorebookId: string; entryId: string; entryIndex: number; created: boolean }>> {
  return requestCommandJson(
    `/lorebooks/${encodeURIComponent(input.lorebookId)}/entries/${encodeURIComponent(input.entryId)}`,
    {
      method: 'PUT',
      body: {
        baseRevision: input.baseRevision,
        entry: input.entry,
      },
      signal,
      keepalive,
    },
  )
}

export async function deleteGlobalLorebookEntryCommand(
  input: DeleteGlobalLorebookEntryCommandInput,
  signal?: AbortSignal | null,
  keepalive = false,
): Promise<ServerCommandResult<{ lorebookId: string; entryId: string; entryIndex: number }>> {
  return requestCommandJson(
    `/lorebooks/${encodeURIComponent(input.lorebookId)}/entries/${encodeURIComponent(input.entryId)}`,
    {
      method: 'DELETE',
      body: {
        baseRevision: input.baseRevision,
      },
      signal,
      keepalive,
    },
  )
}

export async function reorderGlobalLorebookEntriesCommand(
  input: ReorderGlobalLorebookEntriesCommandInput,
  signal?: AbortSignal | null,
  keepalive = false,
): Promise<ServerCommandResult<{ lorebookId: string }>> {
  return requestCommandJson(`/lorebooks/${encodeURIComponent(input.lorebookId)}/entries/reorder`, {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      entryIds: input.entryIds,
    },
    signal,
    keepalive,
  })
}

export async function replaceCharacterLorebooksCommand(
  input: ReplaceCharacterLorebooksCommandInput,
  signal?: AbortSignal | null,
  keepalive = false,
): Promise<ServerCommandResult<{ characterId: string }>> {
  return requestCommandJson(`/characters/${encodeURIComponent(input.characterId)}/lorebooks`, {
    method: 'PUT',
    body: {
      baseRevision: input.baseRevision,
      entries: input.entries,
    },
    signal,
    keepalive,
  })
}

export async function upsertCharacterLorebookEntryCommand(
  input: UpsertCharacterLorebookEntryCommandInput,
  signal?: AbortSignal | null,
  keepalive = false,
): Promise<ServerCommandResult<{ characterId: string; entryId: string; entryIndex: number; created: boolean }>> {
  return requestCommandJson(
    `/characters/${encodeURIComponent(input.characterId)}/lorebooks/entries/${encodeURIComponent(input.entryId)}`,
    {
      method: 'PUT',
      body: {
        baseRevision: input.baseRevision,
        entry: input.entry,
      },
      signal,
      keepalive,
    },
  )
}

export async function deleteCharacterLorebookEntryCommand(
  input: DeleteCharacterLorebookEntryCommandInput,
  signal?: AbortSignal | null,
  keepalive = false,
): Promise<ServerCommandResult<{ characterId: string; entryId: string; entryIndex: number }>> {
  return requestCommandJson(
    `/characters/${encodeURIComponent(input.characterId)}/lorebooks/entries/${encodeURIComponent(input.entryId)}`,
    {
      method: 'DELETE',
      body: {
        baseRevision: input.baseRevision,
      },
      signal,
      keepalive,
    },
  )
}

export async function reorderCharacterLorebookEntriesCommand(
  input: ReorderCharacterLorebookEntriesCommandInput,
  signal?: AbortSignal | null,
  keepalive = false,
): Promise<ServerCommandResult<{ characterId: string }>> {
  return requestCommandJson(`/characters/${encodeURIComponent(input.characterId)}/lorebooks/entries/reorder`, {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      entryIds: input.entryIds,
    },
    signal,
    keepalive,
  })
}

export async function replaceChatLorebooksCommand(
  input: ReplaceChatLorebooksCommandInput,
  signal?: AbortSignal | null,
  keepalive = false,
): Promise<ServerCommandResult<{ chatId: string }>> {
  return requestCommandJson(`/chats/${encodeURIComponent(input.chatId)}/lorebooks`, {
    method: 'PUT',
    body: {
      baseRevision: input.baseRevision,
      entries: input.entries,
    },
    signal,
    keepalive,
  })
}

export async function upsertChatLorebookEntryCommand(
  input: UpsertChatLorebookEntryCommandInput,
  signal?: AbortSignal | null,
  keepalive = false,
): Promise<ServerCommandResult<{ chatId: string; entryId: string; entryIndex: number; created: boolean }>> {
  return requestCommandJson(
    `/chats/${encodeURIComponent(input.chatId)}/lorebooks/entries/${encodeURIComponent(input.entryId)}`,
    {
      method: 'PUT',
      body: {
        baseRevision: input.baseRevision,
        entry: input.entry,
      },
      signal,
      keepalive,
    },
  )
}

export async function deleteChatLorebookEntryCommand(
  input: DeleteChatLorebookEntryCommandInput,
  signal?: AbortSignal | null,
  keepalive = false,
): Promise<ServerCommandResult<{ chatId: string; entryId: string; entryIndex: number }>> {
  return requestCommandJson(
    `/chats/${encodeURIComponent(input.chatId)}/lorebooks/entries/${encodeURIComponent(input.entryId)}`,
    {
      method: 'DELETE',
      body: {
        baseRevision: input.baseRevision,
      },
      signal,
      keepalive,
    },
  )
}

export async function reorderChatLorebookEntriesCommand(
  input: ReorderChatLorebookEntriesCommandInput,
  signal?: AbortSignal | null,
  keepalive = false,
): Promise<ServerCommandResult<{ chatId: string }>> {
  return requestCommandJson(`/chats/${encodeURIComponent(input.chatId)}/lorebooks/entries/reorder`, {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      entryIds: input.entryIds,
    },
    signal,
    keepalive,
  })
}

export async function replaceModuleLorebooksCommand(
  input: ReplaceModuleLorebooksCommandInput,
  signal?: AbortSignal | null,
  keepalive = false,
): Promise<ServerCommandResult<{ moduleId: string }>> {
  return requestCommandJson(`/modules/${encodeURIComponent(input.moduleId)}/lorebooks`, {
    method: 'PUT',
    body: {
      baseRevision: input.baseRevision,
      entries: input.entries,
    },
    signal,
    keepalive,
  })
}

export async function upsertModuleLorebookEntryCommand(
  input: UpsertModuleLorebookEntryCommandInput,
  signal?: AbortSignal | null,
  keepalive = false,
): Promise<ServerCommandResult<{ moduleId: string; entryId: string; entryIndex: number; created: boolean }>> {
  return requestCommandJson(
    `/modules/${encodeURIComponent(input.moduleId)}/lorebooks/entries/${encodeURIComponent(input.entryId)}`,
    {
      method: 'PUT',
      body: {
        baseRevision: input.baseRevision,
        entry: input.entry,
      },
      signal,
      keepalive,
    },
  )
}

export async function deleteModuleLorebookEntryCommand(
  input: DeleteModuleLorebookEntryCommandInput,
  signal?: AbortSignal | null,
  keepalive = false,
): Promise<ServerCommandResult<{ moduleId: string; entryId: string; entryIndex: number }>> {
  return requestCommandJson(
    `/modules/${encodeURIComponent(input.moduleId)}/lorebooks/entries/${encodeURIComponent(input.entryId)}`,
    {
      method: 'DELETE',
      body: {
        baseRevision: input.baseRevision,
      },
      signal,
      keepalive,
    },
  )
}

export async function reorderModuleLorebookEntriesCommand(
  input: ReorderModuleLorebookEntriesCommandInput,
  signal?: AbortSignal | null,
  keepalive = false,
): Promise<ServerCommandResult<{ moduleId: string }>> {
  return requestCommandJson(`/modules/${encodeURIComponent(input.moduleId)}/lorebooks/entries/reorder`, {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      entryIds: input.entryIds,
    },
    signal,
    keepalive,
  })
}

export async function replaceCharacterScriptsCommand(
  input: ReplaceCharacterScriptsCommandInput,
  signal?: AbortSignal | null,
  keepalive = false,
): Promise<ServerCommandResult<{ characterId: string }>> {
  return requestCommandJson(`/characters/${encodeURIComponent(input.characterId)}/scripts`, {
    method: 'PUT',
    body: {
      baseRevision: input.baseRevision,
      scripts: input.scripts,
    },
    signal,
    keepalive,
  })
}

export async function replaceCharacterTriggersCommand(
  input: ReplaceCharacterTriggersCommandInput,
  signal?: AbortSignal | null,
  keepalive = false,
): Promise<ServerCommandResult<{ characterId: string }>> {
  return requestCommandJson(`/characters/${encodeURIComponent(input.characterId)}/triggers`, {
    method: 'PUT',
    body: {
      baseRevision: input.baseRevision,
      triggers: input.triggers,
    },
    signal,
    keepalive,
  })
}

export async function replaceModuleScriptsCommand(
  input: ReplaceModuleScriptsCommandInput,
  signal?: AbortSignal | null,
  keepalive = false,
): Promise<ServerCommandResult<{ moduleId: string }>> {
  return requestCommandJson(`/modules/${encodeURIComponent(input.moduleId)}/scripts`, {
    method: 'PUT',
    body: {
      baseRevision: input.baseRevision,
      scripts: input.scripts,
    },
    signal,
    keepalive,
  })
}

export async function replaceModuleTriggersCommand(
  input: ReplaceModuleTriggersCommandInput,
  signal?: AbortSignal | null,
  keepalive = false,
): Promise<ServerCommandResult<{ moduleId: string }>> {
  return requestCommandJson(`/modules/${encodeURIComponent(input.moduleId)}/triggers`, {
    method: 'PUT',
    body: {
      baseRevision: input.baseRevision,
      triggers: input.triggers,
    },
    signal,
    keepalive,
  })
}

export async function createModuleCommand(
  input: CreateModuleCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ moduleId: string }>> {
  return requestCommandJson('/modules', {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      module: input.module,
    },
    signal,
  })
}

export async function updateModuleCommand(
  input: UpdateModuleCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ moduleId: string }>> {
  return requestCommandJson(`/modules/${encodeURIComponent(input.moduleId)}`, {
    method: 'PATCH',
    body: {
      baseRevision: input.baseRevision,
      patch: input.patch,
    },
    signal,
  })
}

export async function deleteModuleCommand(
  input: DeleteModuleCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ moduleId: string }>> {
  return requestCommandJson(`/modules/${encodeURIComponent(input.moduleId)}`, {
    method: 'DELETE',
    body: {
      baseRevision: input.baseRevision,
    },
    signal,
  })
}

export async function enableModuleCommand(
  input: EnableModuleCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ moduleId: string; enabled: boolean }>> {
  return requestCommandJson('/modules/enable', {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      moduleId: input.moduleId,
      enabled: input.enabled,
    },
    signal,
  })
}

export async function reorderModulesCommand(
  input: ReorderModulesCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult> {
  return requestCommandJson('/modules/reorder', {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      moduleIds: input.moduleIds,
    },
    signal,
  })
}

export async function reorderCharacterModulesCommand(
  input: ReorderCharacterModulesCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ characterId: string }>> {
  return requestCommandJson(`/characters/${encodeURIComponent(input.characterId)}/modules/reorder`, {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      moduleIds: input.moduleIds,
    },
    signal,
  })
}

export async function createPluginCommand(
  input: CreatePluginCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ pluginId: string }>> {
  return requestCommandJson('/plugins', {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      plugin: input.plugin,
    },
    signal,
  })
}

export async function updatePluginCommand(
  input: UpdatePluginCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ pluginId: string }>> {
  return requestCommandJson(`/plugins/${encodeURIComponent(input.pluginId)}`, {
    method: 'PATCH',
    body: {
      baseRevision: input.baseRevision,
      patch: input.patch,
    },
    signal,
  })
}

export async function deletePluginCommand(
  input: DeletePluginCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ pluginId: string }>> {
  return requestCommandJson(`/plugins/${encodeURIComponent(input.pluginId)}`, {
    method: 'DELETE',
    body: {
      baseRevision: input.baseRevision,
    },
    signal,
  })
}

export async function enablePluginCommand(
  input: EnablePluginCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ pluginId: string; enabled: boolean }>> {
  return requestCommandJson(`/plugins/${encodeURIComponent(input.pluginId)}/enable`, {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      enabled: input.enabled,
    },
    signal,
  })
}

export async function selectPluginProviderCommand(
  input: SelectPluginProviderCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ provider: string }>> {
  return requestCommandJson('/plugins/provider', {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      provider: input.provider,
    },
    signal,
  })
}

export async function reorderPluginsCommand(
  input: ReorderPluginsCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult> {
  return requestCommandJson('/plugins/reorder', {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      pluginIds: input.pluginIds,
    },
    signal,
  })
}

export async function putPluginStorageCommand(
  input: PutPluginStorageCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ key: string }>> {
  return requestCommandJson(`/plugin-storage/${encodeURIComponent(input.key)}`, {
    method: 'PUT',
    body: {
      baseRevision: input.baseRevision,
      value: input.value,
    },
    signal,
  })
}

export async function deletePluginStorageCommand(
  input: DeletePluginStorageCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ key: string }>> {
  return requestCommandJson(`/plugin-storage/${encodeURIComponent(input.key)}`, {
    method: 'DELETE',
    body: {
      baseRevision: input.baseRevision,
    },
    signal,
  })
}

export async function bulkPluginStorageCommand(
  input: BulkPluginStorageCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult> {
  return requestCommandJson('/plugin-storage/bulk', {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      values: input.values ?? {},
      deleteKeys: input.deleteKeys ?? [],
      clear: input.clear ?? false,
    },
    signal,
  })
}

export async function appendMessageCommand(
  input: AppendMessageCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ chatId: string; messageId: string }>> {
  return requestCommandJson(`/chats/${encodeURIComponent(input.chatId)}/messages`, {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      message: input.message,
    },
    signal,
  })
}

export async function updateMessageCommand(
  input: UpdateMessageCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ chatId: string; messageId: string }>> {
  return requestCommandJson(`/messages/${encodeURIComponent(input.messageId)}`, {
    method: 'PATCH',
    body: {
      baseRevision: input.baseRevision,
      patch: input.patch,
    },
    signal,
  })
}

export async function deleteMessageCommand(
  input: DeleteMessageCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ chatId: string; messageId: string }>> {
  return requestCommandJson(`/messages/${encodeURIComponent(input.messageId)}`, {
    method: 'DELETE',
    body: {
      baseRevision: input.baseRevision,
    },
    signal,
  })
}

export async function truncateMessagesCommand(
  input: TruncateMessagesCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ chatId: string; afterMessageId: string | null; removedCount: number }>> {
  return requestCommandJson(`/chats/${encodeURIComponent(input.chatId)}/messages/truncate`, {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      afterMessageId: input.afterMessageId ?? null,
    },
    signal,
  })
}

export async function replaceTailMessagesCommand(
  input: ReplaceTailMessagesCommandInput,
  signal?: AbortSignal | null,
): Promise<
  ServerCommandResult<{ chatId: string; afterMessageId: string | null; messageIds: string[]; replacedCount: number }>
> {
  return requestCommandJson(`/chats/${encodeURIComponent(input.chatId)}/messages/tail`, {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      afterMessageId: input.afterMessageId ?? null,
      messages: input.messages,
    },
    signal,
  })
}

export async function replaceMessagesCommand(
  input: ReplaceMessagesCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ chatId: string }>> {
  return requestCommandJson(`/chats/${encodeURIComponent(input.chatId)}/messages`, {
    method: 'PUT',
    body: {
      baseRevision: input.baseRevision,
      messages: input.messages,
    },
    signal,
  })
}

export async function persistGenerationResultCommand(
  input: PersistGenerationResultCommandInput,
  signal?: AbortSignal | null,
): Promise<ServerCommandResult<{ chatId: string; messageId: string }>> {
  return requestCommandJson(`/chats/${encodeURIComponent(input.chatId)}/generation-result`, {
    method: 'POST',
    body: {
      baseRevision: input.baseRevision,
      generationResult: input.generationResult,
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

  let result: ServerCommandResult<T>
  try {
    const baseRevision = await getServerCommandBaseRevision(input.signal, input.keepalive)
    if (baseRevision === null) {
      input.rollback?.()
      return { status: 'error', error: 'Unable to read server command revision' }
    }

    result = await input.command(baseRevision)
  } catch (error) {
    // A command-factory rejection must roll back and surface as an error result.
    // Without this, the fire-and-forget runners (`void runServerCommand(...)`)
    // swallowed the rejection and the optimistic write silently diverged from
    // the server.
    console.error('Server command factory rejected:', error)
    input.rollback?.()
    const message = error instanceof Error ? error.message : String(error)
    return { status: 'error', error: `Command factory rejected: ${message}` }
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
  init: { method: string; body: unknown; signal?: AbortSignal | null; keepalive?: boolean },
): Promise<ServerCommandResult<T>> {
  if (!canUseServerCommands()) return { status: 'unavailable' }

  const auth = await getNodeServerProxyAuth()
  let response: Response
  try {
    const requestInit: RequestInit = {
      method: init.method,
      signal: init.signal ?? undefined,
      headers: {
        'content-type': 'application/json',
        'risu-auth': auth,
        ...activeWriterSessionHeader(),
      },
      body: JSON.stringify(init.body),
    }
    if (init.keepalive) requestInit.keepalive = true
    response = await fetch(`${COMMAND_ENDPOINT}${path}`, requestInit)
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

  if (handleActiveWriterStaleResponse(response)) {
    return { status: 'error', error: errorMessageFromBody(body, 'HTTP 423') }
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
