import { createDefaultInputHooks, defaultAutoSuggestPrompt } from '../../../src/ts/storage/defaultPrompts.js'
import { prebuiltNAIpresets, prebuiltPresets } from '../../../src/ts/process/templates/templates.js'
import { defaultHotkeys, RETIRED_HOTKEY_ACTIONS } from '../../../src/ts/defaulthotkeys.js'
import { LLMFormat } from '../../../src/ts/model/types.js'
import { DEFAULT_CHAT_DISPLAY_TAIL_COUNT } from '../../../src/ts/chatDisplayTailCount.js'
import {
  DEFAULT_CHAT_LOAD_ADDITIONAL_PAGES,
  DEFAULT_CHAT_LOAD_INITIAL_PAGES,
  normalizeChatLoadPages,
} from '../../../src/ts/chatLoadPages.js'
import {
  createExtractedModelPreset,
  createExtractedPromptPreset,
  repairPromptPresetRecommendedModelPresetReferences,
} from '../../../src/ts/presetSplit.js'
import {
  createDefaultLegacyFallbackModels,
  createDefaultModelRoleOverrides,
  normalizeLegacyFallbackModels,
  normalizeLegacySeperateModels,
  normalizeModelRoleOverrides,
} from '../../../src/ts/model/modelRoles.js'
import {
  createDefaultModelRoleProfiles,
  normalizeModelProfileOrder,
  normalizeModelRuntimeDefaults,
  normalizeModelProfiles,
  normalizeModelRoleProfiles,
} from '../../../src/ts/model/modelProfileRecords.js'
import { normalizeProviderCredentials } from '../../../src/ts/model/providerCredentialRecords.js'
import { normalizeAgentConfiguration, normalizeAgentPresetDefaultId } from '../../../src/ts/agentPresetRecords.js'
import { normalizeTranslatorPresetState, type TranslatorPresetStateLike } from '../../../src/ts/translator/presets.js'
import { normalizePromptTemplateValue } from './commands/prompts.js'
import { DEFAULT_REQUEST_HISTORY_LIMIT, normalizeRequestHistoryLimit } from './requestHistory.js'

type JsonRecord = Record<string, unknown>

interface NormalizeDatabaseDefaultsOptions {
  providerDefaults?: boolean
}

const DEFAULT_FORMATING_ORDER = [
  'main',
  'description',
  'personaPrompt',
  'chats',
  'lastChat',
  'jailbreak',
  'lorebook',
  'globalNote',
  'authorNote',
]

const DEFAULT_COLOR_SCHEME = {
  bgcolor: '#282a36',
  darkbg: '#21222c',
  borderc: '#6272a4',
  selected: '#44475a',
  draculared: '#ff5555',
  textcolor: '#f8f8f2',
  textcolor2: '#94a3b8',
  darkBorderc: '#4b5563',
  darkbutton: '#374151',
  type: 'dark',
}

const DEFAULT_CUSTOM_TEXT_THEME = {
  FontColorStandard: '#f8f8f2',
  FontColorBold: '#f8f8f2',
  FontColorItalic: '#8C8D93',
  FontColorItalicBold: '#8C8D93',
  FontColorQuote1: '#8BE9FD',
  FontColorQuote2: '#FFB86C',
}

const DEFAULT_NAI_IMG_CONFIG = {
  width: 1024,
  height: 1024,
  sampler: 'k_euler_ancestral',
  noise_schedule: 'karras',
  steps: 28,
  scale: 5,
  cfg_rescale: 0,
  sm: true,
  sm_dyn: false,
  noise: 0.0,
  strength: 0.6,
  image: '',
  base64image: '',
  InfoExtracted: 1,
  autoSmea: false,
  legacy_uc: false,
  use_coords: false,
  v4_prompt: {
    caption: {
      base_caption: '',
      char_captions: [],
    },
    use_coords: false,
    use_order: true,
  },
  v4_negative_prompt: {
    caption: {
      base_caption: '',
      char_captions: [],
    },
    legacy_uc: false,
  },
  variety_plus: false,
  decrisp: false,
  reference_mode: '',
  character_image: '',
  character_base64image: '',
  style_aware: false,
}

const DEFAULT_SD_CONFIG = {
  width: 512,
  height: 512,
  sampler_name: 'Euler a',
  script_name: '',
  denoising_strength: 0.7,
  enable_hr: false,
  hr_scale: 1.25,
  hr_upscaler: 'Latent',
}

const DEFAULT_COMFY_CONFIG = {
  workflow: '',
  posNodeID: '',
  posInputName: 'text',
  negNodeID: '',
  negInputName: 'text',
  timeout: 30,
}

const DEFAULT_FALLBACK_MODELS = createDefaultLegacyFallbackModels()

const DEFAULT_PROMPT_SETTINGS = {
  assistantPrefill: '',
  postEndInnerFormat: '',
  sendChatAsSystem: false,
  sendName: false,
  utilOverride: false,
  customChainOfThought: false,
  maxThoughtTagDepth: -1,
}

const DEFAULT_SEPERATE_PARAMETERS = {
  memory: {},
  emotion: {},
  translate: {},
  otherAx: {},
  scriptMain: {},
  scriptAux: {},
  overrides: {},
}

const DEFAULT_HYPA_V3_SETTINGS = {
  summarizationModel: 'subModel',
  summarizationPrompt: '',
  reSummarizationPrompt: '',
  memoryTokensRatio: 0.2,
  extraSummarizationRatio: 0,
  maxChatsPerSummary: 6,
  recentMemoryRatio: 0.4,
  similarMemoryRatio: 0.4,
  enableSimilarityCorrection: false,
  preserveOrphanedMemory: false,
  processRegexScript: false,
  doNotSummarizeUserMessage: false,
  summaryChunkSeparator: '\\n\\n',
  useExperimentalImpl: false,
  summarizationRequestsPerMinute: 20,
  summarizationMaxConcurrent: 1,
  embeddingRequestsPerMinute: 100,
  embeddingMaxConcurrent: 1,
  alwaysToggleOn: false,
  queryChatCount: 3,
}

export function createInitialDatabase(): JsonRecord {
  return normalizeDatabaseDefaults({})
}

export function normalizeDatabaseDefaults(
  database: JsonRecord,
  options: NormalizeDatabaseDefaultsOptions = {},
): JsonRecord {
  const providerDefaults = options.providerDefaults ?? true

  delete database.useServerPromptAssembly
  normalizeCharacters(database)

  if (providerDefaults) {
    setDefault(database, 'apiType', 'gemini-3-flash-preview')
  }
  setDefault(database, 'openAIKey', '')
  setDefault(database, 'mainPrompt', prebuiltPresets.OAI.mainPrompt)
  setDefault(database, 'jailbreak', prebuiltPresets.OAI.jailbreak)
  setDefault(database, 'globalNote', '')
  setDefault(database, 'temperature', 80)
  setDefault(database, 'maxContext', 4000)
  setDefault(database, 'maxResponse', 500)
  setDefault(database, 'frequencyPenalty', 70)
  setDefault(database, 'PresensePenalty', 70)
  if (providerDefaults) {
    setDefault(database, 'aiModel', 'gemini-3-flash-preview')
  }
  setDefault(database, 'jailbreakToggle', false)
  setDefault(database, 'formatingOrder', DEFAULT_FORMATING_ORDER)
  setDefault(database, 'loreBookDepth', 5)
  setDefault(database, 'loreBookToken', 800)
  setDefault(database, 'username', 'User')
  setDefault(database, 'userIcon', '')
  setDefault(database, 'userNote', '')
  setDefault(database, 'additionalPrompt', 'The assistant must act as {{char}}. user is {{user}}.')
  setDefault(database, 'descriptionPrefix', 'description of {{char}}: ')
  setDefault(database, 'forceReplaceUrl', '')
  setDefault(database, 'language', 'en')
  setDefault(database, 'swipe', true)
  setDefault(database, 'translator', '')
  setDefault(database, 'translatorMaxResponse', 1000)
  setDefault(database, 'translatorHistoryMaxTokens', 2048)
  setDefault(database, 'inputHooks', createDefaultInputHooks())
  setDefault(database, 'currentPluginProvider', '')
  setDefault(database, 'plugins', [])
  setDefault(database, 'zoomsize', 100)
  setDefault(database, 'chatScreenWidth', 900)
  setDefault(database, 'autoTranslateNotificationDeferCapSeconds', 180)
  setDefault(database, 'chatDisplayTailCount', DEFAULT_CHAT_DISPLAY_TAIL_COUNT)
  database.chatLoadInitialPages = normalizeChatLoadPages(
    database.chatLoadInitialPages ?? database.chatDisplayTailCount,
    DEFAULT_CHAT_LOAD_INITIAL_PAGES,
  )
  database.chatLoadAdditionalPages = normalizeChatLoadPages(
    database.chatLoadAdditionalPages,
    DEFAULT_CHAT_LOAD_ADDITIONAL_PAGES,
  )
  setDefault(database, 'customBackground', '')
  if (providerDefaults) {
    setDefault(database, 'textgenWebUIStreamURL', 'wss://localhost/api/')
    setDefault(database, 'textgenWebUIBlockingURL', 'https://localhost/api/')
  }
  setDefault(database, 'fullScreen', false)
  setDefault(database, 'playMessage', false)
  setDefault(database, 'iconsize', 100)
  setDefault(database, 'theme', 'fastify')
  if (providerDefaults) {
    setDefault(database, 'subModel', 'gemini-3-flash-preview')
  }
  setDefault(database, 'modelRoles', createDefaultModelRoleOverrides())
  normalizeModelRoleSettings(database)
  setDefault(database, 'modelProfiles', [])
  setDefault(database, 'modelProfileOrder', [])
  setDefault(database, 'providerCredentials', [])
  setDefault(database, 'modelRoleProfiles', createDefaultModelRoleProfiles())
  setDefault(database, 'modelRuntimeDefaults', {})
  normalizeModelProfileSettings(database)
  setDefault(database, 'agents', [])
  setDefault(database, 'agentPresets', [])
  normalizeAgentPresetSettings(database)
  setDefault(database, 'waifuWidth', 100)
  setDefault(database, 'waifuWidth2', 100)
  setDefault(database, 'emotionPrompt', '')
  setDefault(database, 'proxyKey', '')
  if (Object.prototype.hasOwnProperty.call(database, 'promptTemplate')) {
    database.promptTemplate = normalizePromptTemplateValue(database.promptTemplate)
  }
  normalizeBotPresets(database)
  normalizeSplitPresets(database)
  setDefault(database, 'sdProvider', '')
  setDefault(database, 'webUiUrl', 'http://127.0.0.1:7860/')
  setDefault(database, 'sdSteps', 30)
  setDefault(database, 'sdCFG', 7)
  setDefault(database, 'NAIImgUrl', 'https://image.novelai.net/ai/generate-image')
  setDefault(database, 'NAIApiKey', '')
  setDefault(database, 'NAIImgModel', 'nai-diffusion-4-5-full')
  setDefault(database, 'NAII2I', false)
  setDefault(database, 'NAIREF', false)
  setDefault(database, 'textTheme', 'standard')
  setDefault(database, 'emotionPrompt2', '')
  setDefault(database, 'requestRetrys', 2)
  setDefault(database, 'requestHistoryLimit', DEFAULT_REQUEST_HISTORY_LIMIT)
  database.requestHistoryLimit = normalizeRequestHistoryLimit(database.requestHistoryLimit)
  setDefault(database, 'useSayNothing', true)
  setDefault(database, 'bias', [])
  setDefault(database, 'showUnrecommended', false)
  setDefault(database, 'doNotWarnExternalServers', false)
  setDefault(database, 'pluginCompatibilityMode', false)
  setDefault(database, 'strictScriptCheck', false)
  setDefault(database, 'complexRegexCompatibilityMode', 'strict')
  if (database.complexRegexCompatibilityMode !== 'worker') {
    database.complexRegexCompatibilityMode = 'strict'
  }
  setDefault(database, 'complexRegexInputTimeoutMs', 10000)
  normalizeNumber(database, 'complexRegexInputTimeoutMs', 10000)
  setDefault(database, 'complexRegexOutputTimeoutMs', 10000)
  normalizeNumber(database, 'complexRegexOutputTimeoutMs', 10000)
  setDefault(database, 'complexRegexDisplayTimeoutMs', 10000)
  normalizeNumber(database, 'complexRegexDisplayTimeoutMs', 10000)
  setDefault(database, 'elevenLabKey', '')
  setDefault(database, 'voicevoxUrl', '')
  setDefault(database, 'showMemoryLimit', false)
  setDefault(database, 'showFirstMessagePages', false)
  setDefault(database, 'supaMemoryKey', '')
  setDefault(database, 'hypaV3Key', typeof database.supaMemoryKey === 'string' ? database.supaMemoryKey : '')
  setDefault(database, 'hypaMemoryKey', '')
  setDefault(database, 'voyageApiKey', '')
  setDefault(database, 'askRemoval', true)
  setDefault(database, 'sdConfig', DEFAULT_SD_CONFIG)
  setDefault(database, 'NAIImgConfig', DEFAULT_NAI_IMG_CONFIG)
  normalizeNAIImgConfig(database)
  setDefault(database, 'customTextTheme', DEFAULT_CUSTOM_TEXT_THEME)
  normalizeCustomTextTheme(database)
  setDefault(database, 'hordeConfig', { apiKey: '', model: '', softPrompt: '' })
  setDefault(database, 'novelai', { token: '', model: 'clio-v1' })
  normalizeLorebooks(database)
  setDefault(database, 'globalscript', [])
  setDefault(database, 'sendWithEnter', true)
  setDefault(database, 'autoSuggestPrompt', defaultAutoSuggestPrompt)
  setDefault(database, 'autoSuggestPrefix', '')
  setDefault(database, 'OAIPrediction', '')
  setDefault(database, 'autoSuggestClean', true)
  setDefault(database, 'imageCompression', true)
  setDefault(database, 'enableBlockPartialEdit', false)
  setDefault(database, 'enableDragPartialEdit', false)
  normalizeFormatingOrder(database)
  setDefault(database, 'selectedPersona', 0)
  setDefault(database, 'personaPrompt', '')
  normalizePersonas(database)
  setDefault(database, 'classicMaxWidth', false)
  setDefault(database, 'ooba', prebuiltPresets.OAI.ooba)
  setDefault(database, 'ainconfig', prebuiltPresets.OAI.ainconfig)
  setDefault(database, 'openrouterKey', '')
  setDefault(database, 'openrouterRequestModel', 'openai/gpt-3.5-turbo')
  setDefault(database, 'nanogptKey', '')
  setDefault(database, 'nanogptRequestModel', '')
  setDefault(database, 'nanogptRequestModelName', '')
  setDefault(database, 'nanogptProvider', '')
  setDefault(database, 'nanogptSubscriptionState', '')
  setDefault(database, 'nanogptUseSubscriptionEndpoint', false)
  setDefault(database, 'NAIsettings', prebuiltNAIpresets)
  setDefault(database, 'assetWidth', -1)
  setDefault(database, 'animationSpeed', 0.4)
  setDefault(database, 'reducedMotion', false)
  setDefault(database, 'colorScheme', DEFAULT_COLOR_SCHEME)
  setDefault(database, 'colorSchemeName', 'default')
  setDefault(
    database,
    'customColorScheme',
    database.colorSchemeName === 'custom' ? database.colorScheme : DEFAULT_COLOR_SCHEME,
  )
  normalizeNAISettings(database)
  setDefault(database, 'hypaModel', 'MiniLM')
  setDefault(database, 'mancerHeader', '')
  setDefault(database, 'emotionProcesser', 'submodel')
  setDefault(database, 'translatorType', 'google')
  setDefault(database, 'htmlTranslation', false)
  setDefault(database, 'deeplOptions', { key: '', freeApi: false })
  setDefault(database, 'deeplXOptions', { url: '', token: '' })
  setDefault(database, 'NAIadventure', false)
  setDefault(database, 'NAIappendName', true)
  setDefault(database, 'autofillRequestUrl', true)
  setDefault(database, 'customProxyRequestModel', '')
  setDefault(database, 'generationSeed', -1)
  setDefault(database, 'newOAIHandle', true)
  setDefault(database, 'localNetworkMode', false)
  setDefault(database, 'localNetworkTimeoutSec', 600)
  normalizeLocalNetwork(database)
  setDefault(database, 'gptVisionQuality', 'low')
  setDefault(database, 'huggingfaceKey', '')
  setDefault(database, 'fishSpeechKey', '')
  setDefault(database, 'presetRegex', [])
  setDefault(database, 'reverseProxyOobaArgs', { mode: 'instruct' })
  setDefault(database, 'top_p', 1)
  normalizeNumber(database, 'top_p', 1)
  setDefault(database, 'google', {})
  normalizeGoogle(database)
  setDefault(database, 'genTime', 1)
  setDefault(database, 'promptSettings', DEFAULT_PROMPT_SETTINGS)
  normalizePromptSettings(database)
  setDefault(database, 'keiServerURL', '')
  setDefault(database, 'top_k', 0)
  setDefault(database, 'openrouterFallback', true)
  setDefault(database, 'openrouterMiddleOut', false)
  setDefault(database, 'removePunctuationHypa', true)
  setDefault(database, 'memoryLimitThickness', 1)
  setDefault(database, 'modules', [])
  setDefault(database, 'enabledModules', [])
  setDefault(database, 'additionalParams', [])
  setDefault(database, 'applyAdditionalParamsToAll', false)
  setDefault(database, 'heightMode', 'normal')
  normalizeAntiServerOverload(database)
  setDefault(database, 'ollamaURL', '')
  setDefault(database, 'ollamaModel', '')
  setDefault(database, 'ollamaModelSource', 'local')
  setDefault(database, 'ollamaInputMode', 'manual')
  setDefault(database, 'ollamaRequestFormat', LLMFormat.Ollama)
  setDefault(database, 'ollamaApiKey', '')
  setDefault(database, 'ollamaModelName', '')
  setDefault(database, 'ollamaCloudModel', '')
  setDefault(database, 'ollamaCloudModelName', '')
  setDefault(database, 'ollamaThinkingMode', 'auto')
  setDefault(database, 'repetition_penalty', 1)
  setDefault(database, 'min_p', 0)
  setDefault(database, 'top_a', 0)
  setDefault(database, 'customTokenizer', 'tik')
  setDefault(database, 'instructChatTemplate', 'chatml')
  normalizeOpenrouterProvider(database)
  normalizePresetOpenrouterProviders(database)
  setDefault(database, 'useInstructPrompt', false)
  setDefault(database, 'textAreaSize', 0)
  setDefault(database, 'sideBarSize', 0)
  setDefault(database, 'textAreaTextSize', 0)
  setDefault(database, 'combineTranslation', false)
  setDefault(database, 'customPromptTemplateToggle', '')
  setDefault(database, 'globalChatVariables', {})
  setDefault(database, 'templateDefaultVariables', '')
  setDefault(database, 'dallEQuality', 'standard')
  setDefault(database, 'font', 'default')
  setDefault(database, 'customFont', '')
  setDefault(database, 'lineHeight', 1.25)
  setDefault(database, 'paragraphBreakBySentences', false)
  setDefault(database, 'paragraphBreakSentenceCount', 3)
  setDefault(database, 'stabilityModel', 'sd3-large')
  setDefault(database, 'stabllityStyle', '')
  setDefault(database, 'legacyTranslation', false)
  setDefault(database, 'translatorSendTextAsIs', false)
  setDefault(database, 'translatorExcludeThoughts', false)
  setDefault(database, 'comfyUiUrl', 'http://localhost:8188')
  setDefault(database, 'comfyConfig', DEFAULT_COMFY_CONFIG)
  setDefault(database, 'hideApiKey', true)
  setDefault(database, 'unformatQuotes', false)
  setDefault(database, 'ttsAutoSpeech', false)
  setDefault(database, 'translatorInputLanguage', 'auto')
  setDefault(database, 'falModel', 'fal-ai/flux/dev')
  setDefault(database, 'falLoraScale', 1)
  setDefault(database, 'customCSS', '')
  setDefault(database, 'strictJsonSchema', true)
  setDefault(database, 'statics', { messages: 0, imports: 0 })
  setDefault(database, 'customQuotes', false)
  setDefault(database, 'customQuotesData', ['“', '”', '‘', '’'])
  setDefault(database, 'groupOtherBotRole', 'user')
  setDefault(database, 'groupTemplate', '')
  setDefault(database, 'customGUI', '')
  setDefault(database, 'customAPIFormat', LLMFormat.OpenAICompatible)
  setDefault(database, 'systemContentReplacement', 'system: {{slot}}')
  setDefault(database, 'systemRoleReplacement', 'user')
  setDefault(database, 'vertexAccessToken', '')
  setDefault(database, 'vertexAccessTokenExpires', 0)
  setDefault(database, 'vertexClientEmail', '')
  setDefault(database, 'vertexPrivateKey', '')
  setDefault(database, 'vertexRegion', 'global')
  setDefault(database, 'seperateParametersEnabled', false)
  setDefault(database, 'seperateParameters', DEFAULT_SEPERATE_PARAMETERS)
  normalizeSeperateParameters(database)
  setDefault(database, 'customFlags', [])
  setDefault(database, 'enableCustomFlags', false)
  setDefault(database, 'assetMaxDifference', 4)
  setDefault(database, 'showSavingIcon', true)
  setDefault(database, 'banCharacterset', [])
  setDefault(database, 'showPromptComparison', false)
  setDefault(database, 'OaiCompAPIKeys', {})
  setDefault(database, 'reasoningEffort', 0)
  setDefault(database, 'verbosity', 1)
  normalizeHypaV3Presets(database)
  normalizeTranslatorPresets(database)
  setDefault(database, 'showDeprecatedTriggerV2', false)
  setDefault(database, 'returnCSSError', true)
  setDefault(database, 'realmDirectOpen', false)
  setDefault(database, 'checkCorruption', false)
  setDefault(database, 'toggleConfirmRecommendedPreset', false)
  setDefault(database, 'useExperimentalGoogleTranslator', false)
  setDefault(database, 'thinkingType', 'budget')
  setDefault(database, 'deepseekThinkingType', 'off')
  setDefault(database, 'adaptiveThinkingEffort', 'high')
  setDefault(database, 'deepseekReasoningEffort', 'high')
  normalizeHypaCustomSettings(database)
  setDefault(database, 'doNotChangeSeperateModels', false)
  setDefault(database, 'seperateModelsForAxModels', false)
  setDefault(database, 'seperateModels', normalizeLegacySeperateModels(undefined))
  normalizeModelRoleSettings(database)
  normalizeModelProfileSettings(database)
  normalizeAgentPresetSettings(database)
  setDefault(database, 'modelTools', [])
  setDefault(database, 'enableScrollToActiveChar', true)
  normalizeHotkeys(database)
  setDefault(database, 'fallbackModels', DEFAULT_FALLBACK_MODELS)
  normalizeFallbackModels(database)
  setDefault(database, 'customModels', [])
  setDefault(database, 'authRefreshes', [])
  setDefault(database, 'openAIFlexProcessing', false)
  setDefault(database, 'rememberToolUsage', true)
  setDefault(database, 'simplifiedToolUse', false)
  setDefault(database, 'halfStreaming', false)
  setDefault(database, 'streamGeminiThoughts', false)
  setDefault(database, 'settingsCloseButtonSize', 24)
  setDefault(database, 'hideAllImages', false)
  setDefault(database, 'ImagenModel', 'imagen-4.0-generate-001')
  setDefault(database, 'ImagenImageSize', '1K')
  setDefault(database, 'ImagenAspectRatio', '1:1')
  setDefault(database, 'ImagenPersonGeneration', 'allow_all')
  setDefault(database, 'openaiCompatImage', {
    url: '',
    key: '',
    model: '',
    size: '1024x1024',
    quality: 'auto',
  })
  setDefault(database, 'wavespeedImage', {
    key: '',
    model: '',
    loras: [],
    reference_mode: '',
    reference_image: '',
    reference_base64image: '',
  })
  setDefault(database, 'autoScrollToNewMessage', true)
  setDefault(database, 'alwaysScrollToNewMessage', false)
  setDefault(database, 'newMessageButtonStyle', 'bottom-center')
  setDefault(database, 'floatingChatInput', true)
  setDefault(database, 'echoMessage', 'Echo Message')
  setDefault(database, 'echoDelay', 0)
  setDefault(database, 'createFolderOnBranch', true)
  setDefault(database, 'hamburgerButtonBottom', false)
  setDefault(database, 'dynamicModelRegistry', true)
  setDefault(database, 'saveSignatures', false)
  setDefault(database, 'enableRisuaiProTools', Array.isArray(database.plugins) && database.plugins.length > 0)
  setDefault(database, 'showGlobalLorebookAndRegex', false)
  database.keepSessionAlive = normalizeKeepSessionAlive(database.keepSessionAlive)
  setDefault(database, 'chatGenerationTogglePresets', [])
  setDefault(database, 'loadouts', [])
  setDefault(database, 'longPressToPopupEditor', false)
  setDefault(database, 'disableAutoPopupMessageEditor', false)
  setDefault(database, 'useMonacoEditorOnDesktop', false)
  setDefault(database, 'useMonacoEditorOnMobile', false)
  setDefault(database, 'customSidebarItems', [])
  setDefault(database, 'moodLightMembership', { characterIds: [], folders: [] })
  normalizeFormatVersion(database)

  return database
}

function normalizeCharacters(database: JsonRecord): void {
  const characters = Array.isArray(database.characters) ? database.characters : []
  // Import entry points reject unsupported group rows before normalization.
  // Preserve any already-stored legacy rows here so generic default repair and
  // export paths can never become a second, silent deletion boundary.
  database.characters = characters.filter((character) => isRecord(character))
  for (const character of database.characters as JsonRecord[]) {
    if (typeof character.customNotificationMessage !== 'string') {
      character.customNotificationMessage = ''
    }
    if (typeof character.notificationImage !== 'string') {
      character.notificationImage = ''
    }
  }
}

function normalizeBotPresets(database: JsonRecord): void {
  if (isNullish(database.botPresets)) {
    database.botPresets = []
  } else if (!Array.isArray(database.botPresets)) {
    database.botPresets = []
  }

  const presets = database.botPresets as unknown[]
  const seen = new Set<string>()
  for (const [index, rawPreset] of presets.entries()) {
    if (!isRecord(rawPreset)) continue
    const requestedId = typeof rawPreset.id === 'string' && rawPreset.id.trim() ? rawPreset.id : ''
    const fallbackId = index === 0 ? 'default-preset' : `preset-${index + 1}`
    const id = requestedId && !seen.has(requestedId) ? requestedId : fallbackId
    rawPreset.id = seen.has(id) ? `${id}-${index + 1}` : id
    seen.add(rawPreset.id as string)
    rawPreset.localNetworkMode ??= false
    rawPreset.localNetworkTimeoutSec ??= 600
    if (Object.prototype.hasOwnProperty.call(rawPreset, 'promptTemplate')) {
      rawPreset.promptTemplate = normalizePromptTemplateValue(rawPreset.promptTemplate)
    }
    if (typeof rawPreset.localNetworkMode !== 'boolean') rawPreset.localNetworkMode = false
    if (!isFiniteNumber(rawPreset.localNetworkTimeoutSec)) rawPreset.localNetworkTimeoutSec = 600
  }

  if (!Number.isInteger(database.botPresetsId)) {
    database.botPresetsId = presets.length > 0 ? 0 : -1
  } else if ((database.botPresetsId as number) >= presets.length) {
    database.botPresetsId = presets.length > 0 ? presets.length - 1 : -1
  } else if ((database.botPresetsId as number) < -1) {
    database.botPresetsId = presets.length > 0 ? 0 : -1
  }
}

function normalizeSplitPresets(database: JsonRecord): void {
  const defaultPreset = createDefaultPreset()
  if (!Array.isArray(database.modelPresets) || database.modelPresets.length === 0) {
    database.modelPresets = [
      createExtractedModelPreset(defaultPreset, {
        id: 'default-model-preset',
        name: 'Default Model',
      }),
    ]
    database.modelPresetsId = 0
  }
  normalizePresetCollection(database, 'modelPresets', 'modelPresetsId', 'model-preset')

  if (!Array.isArray(database.promptPresets) || database.promptPresets.length === 0) {
    database.promptPresets = [
      createExtractedPromptPreset(defaultPreset, {
        id: 'default-prompt-preset',
        name: 'Default Prompt',
      }),
    ]
    database.promptPresetsId = 0
  }
  normalizePresetCollection(database, 'promptPresets', 'promptPresetsId', 'prompt-preset')
  repairPromptPresetRecommendedModelPresetReferences(
    database.modelPresets as unknown[],
    database.promptPresets as unknown[],
  )
}

function normalizePresetCollection(
  database: JsonRecord,
  collectionKey: 'modelPresets' | 'promptPresets',
  selectedKey: 'modelPresetsId' | 'promptPresetsId',
  fallbackPrefix: string,
): void {
  const presets = database[collectionKey] as unknown[]
  const seen = new Set<string>()
  for (const [index, rawPreset] of presets.entries()) {
    if (!isRecord(rawPreset)) continue
    const requestedId = typeof rawPreset.id === 'string' && rawPreset.id.trim() ? rawPreset.id : ''
    const fallbackId = index === 0 ? `default-${fallbackPrefix}` : `${fallbackPrefix}-${index + 1}`
    const id = requestedId && !seen.has(requestedId) ? requestedId : fallbackId
    rawPreset.id = seen.has(id) ? `${id}-${index + 1}` : id
    if (typeof rawPreset.name !== 'string') rawPreset.name = `Preset ${index + 1}`
    if (collectionKey === 'promptPresets' && Object.prototype.hasOwnProperty.call(rawPreset, 'promptTemplate')) {
      rawPreset.promptTemplate = normalizePromptTemplateValue(rawPreset.promptTemplate)
    }
    seen.add(rawPreset.id as string)
  }

  if (!Number.isInteger(database[selectedKey])) {
    database[selectedKey] = presets.length > 0 ? 0 : -1
  } else if ((database[selectedKey] as number) >= presets.length) {
    database[selectedKey] = presets.length > 0 ? presets.length - 1 : -1
  } else if ((database[selectedKey] as number) < -1) {
    database[selectedKey] = presets.length > 0 ? 0 : -1
  }
}

function createDefaultPreset(): JsonRecord {
  return {
    id: 'default-preset',
    name: 'Default',
    apiType: 'gemini-3-flash-preview',
    openAIKey: '',
    localNetworkMode: false,
    localNetworkTimeoutSec: 600,
    mainPrompt: prebuiltPresets.OAI.mainPrompt,
    jailbreak: prebuiltPresets.OAI.jailbreak,
    globalNote: '',
    temperature: 80,
    maxContext: 4000,
    maxResponse: 300,
    frequencyPenalty: 70,
    PresensePenalty: 70,
    formatingOrder: DEFAULT_FORMATING_ORDER,
    aiModel: 'gemini-3-flash-preview',
    subModel: 'gemini-3-flash-preview',
    modelRoles: createDefaultModelRoleOverrides(),
    currentPluginProvider: '',
    textgenWebUIStreamURL: '',
    textgenWebUIBlockingURL: '',
    forceReplaceUrl: '',
    forceReplaceUrl2: '',
    promptPreprocess: false,
    proxyKey: '',
    bias: [],
    ooba: prebuiltPresets.OAI.ooba,
    ainconfig: prebuiltPresets.OAI.ainconfig,
    reverseProxyOobaArgs: { mode: 'instruct' },
    top_p: 1,
    useInstructPrompt: false,
    verbosity: 1,
  }
}

function normalizeNAIImgConfig(database: JsonRecord): void {
  if (!isRecord(database.NAIImgConfig)) return
  const config = database.NAIImgConfig
  config.v4_prompt ??= cloneJson(DEFAULT_NAI_IMG_CONFIG.v4_prompt)
  config.v4_negative_prompt ??= cloneJson(DEFAULT_NAI_IMG_CONFIG.v4_negative_prompt)
  config.autoSmea ??= false
  config.use_coords ??= false
  config.legacy_uc ??= false
}

function normalizeCustomTextTheme(database: JsonRecord): void {
  if (!isRecord(database.customTextTheme)) return
  database.customTextTheme.FontColorQuote1 ??= '#8BE9FD'
  database.customTextTheme.FontColorQuote2 ??= '#FFB86C'
}

function normalizeLorebooks(database: JsonRecord): void {
  if (isNullish(database.loreBook)) {
    database.loreBookPage = 0
    database.loreBook = [{ id: 'default-global-lorebook', name: 'My First LoreBook', data: [] }]
  } else if (!Array.isArray(database.loreBook)) {
    database.loreBook = [{ id: 'default-global-lorebook', name: 'My First LoreBook', data: [] }]
    database.loreBookPage = 0
  }

  if (
    !Number.isInteger(database.loreBookPage) ||
    (database.loreBookPage as number) >= (database.loreBook as unknown[]).length
  ) {
    database.loreBookPage = 0
  }
}

function normalizeFormatingOrder(database: JsonRecord): void {
  if (!Array.isArray(database.formatingOrder)) {
    database.formatingOrder = cloneJson(DEFAULT_FORMATING_ORDER)
    return
  }
  if (!database.formatingOrder.includes('personaPrompt')) {
    const mainIndex = database.formatingOrder.indexOf('main')
    database.formatingOrder.splice(mainIndex >= 0 ? mainIndex : 0, 0, 'personaPrompt')
  }
}

function normalizePersonas(database: JsonRecord): void {
  if (!Array.isArray(database.personas) || database.personas.length === 0) {
    database.personas = [
      {
        id: 'default-persona',
        name: typeof database.username === 'string' ? database.username : 'User',
        personaPrompt: '',
        icon: typeof database.userIcon === 'string' ? database.userIcon : '',
        note: typeof database.userNote === 'string' ? database.userNote : '',
        largePortrait: false,
      },
    ]
    database.selectedPersona = 0
    return
  }

  const seen = new Set<string>()
  for (const [index, persona] of database.personas.entries()) {
    if (!isRecord(persona)) continue
    const requestedId = typeof persona.id === 'string' && persona.id.trim() ? persona.id : ''
    const id = requestedId && !seen.has(requestedId) ? requestedId : `persona-${index + 1}`
    persona.id = seen.has(id) ? `${id}-${index + 1}` : id
    seen.add(persona.id as string)
  }

  if (!Number.isInteger(database.selectedPersona)) database.selectedPersona = 0
  const selected = database.selectedPersona as number
  if (selected < 0 || selected >= database.personas.length) database.selectedPersona = 0
}

function normalizeNAISettings(database: JsonRecord): void {
  if (!isRecord(database.NAIsettings)) return
  database.NAIsettings.starter ??= ''
  database.NAIsettings.cfg_scale ??= 1
  database.NAIsettings.mirostat_tau ??= 0
  database.NAIsettings.mirostat_lr ??= 1
}

function normalizeLocalNetwork(database: JsonRecord): void {
  if (typeof database.localNetworkMode !== 'boolean') database.localNetworkMode = false
  if (!isFiniteNumber(database.localNetworkTimeoutSec)) database.localNetworkTimeoutSec = 600
}

function normalizeGoogle(database: JsonRecord): void {
  if (!isRecord(database.google)) database.google = {}
  const google = database.google as JsonRecord
  google.accessToken ??= ''
  google.projectId ??= ''
}

function normalizePromptSettings(database: JsonRecord): void {
  if (!isRecord(database.promptSettings)) {
    database.promptSettings = cloneJson(DEFAULT_PROMPT_SETTINGS)
  }
  ;(database.promptSettings as JsonRecord).maxThoughtTagDepth ??= -1
}

function normalizeAntiServerOverload(database: JsonRecord): void {
  if (database.antiClaudeOverload) {
    database.antiClaudeOverload = false
    database.antiServerOverloads = true
  } else {
    database.antiClaudeOverload ??= false
  }
}

function normalizeOpenrouterProvider(database: JsonRecord): void {
  if (typeof database.openrouterProvider === 'string') {
    const oldProvider = database.openrouterProvider
    database.openrouterProvider = {
      order: oldProvider ? [oldProvider] : [],
      only: [],
      ignore: [],
    }
  }
  setDefault(database, 'openrouterProvider', { order: [], only: [], ignore: [] })
}

function normalizePresetOpenrouterProviders(database: JsonRecord): void {
  if (!Array.isArray(database.botPresets)) return
  for (const preset of database.botPresets) {
    if (!isRecord(preset) || typeof preset.openrouterProvider !== 'string') continue
    const oldProvider = preset.openrouterProvider
    preset.openrouterProvider = {
      order: oldProvider ? [oldProvider] : [],
      only: [],
      ignore: [],
    }
  }
}

function normalizeModelRoleSettings(database: JsonRecord): void {
  database.modelRoles = normalizeModelRoleOverrides(database.modelRoles)
  database.seperateModels = normalizeLegacySeperateModels(database.seperateModels)
}

function normalizeModelProfileSettings(database: JsonRecord): void {
  database.providerCredentials = normalizeProviderCredentials(database.providerCredentials)
  const modelProfiles = normalizeModelProfiles(database.modelProfiles)
  database.modelProfiles = modelProfiles
  database.modelProfileOrder = normalizeModelProfileOrder(database.modelProfileOrder, modelProfiles)
  database.modelRoleProfiles = normalizeModelRoleProfiles(database.modelRoleProfiles)
  database.modelRuntimeDefaults = normalizeModelRuntimeDefaults(database.modelRuntimeDefaults)
}

function normalizeAgentPresetSettings(database: JsonRecord): void {
  const normalized = normalizeAgentConfiguration(database.agents, database.agentPresets)
  database.agents = normalized.agents
  database.agentPresets = normalized.agentPresets
  const agentPresets = normalized.agentPresets
  const defaultId = normalizeAgentPresetDefaultId(database.agentPresetDefaultId, agentPresets)
  if (defaultId) {
    database.agentPresetDefaultId = defaultId
  } else {
    delete database.agentPresetDefaultId
  }
}

function normalizeSeperateParameters(database: JsonRecord): void {
  const source = isRecord(database.seperateParameters) ? database.seperateParameters : {}
  database.seperateParameters = {
    memory: isRecord(source.memory) ? source.memory : {},
    emotion: isRecord(source.emotion) ? source.emotion : {},
    translate: isRecord(source.translate) ? source.translate : {},
    otherAx: isRecord(source.otherAx) ? source.otherAx : {},
    scriptMain: isRecord(source.scriptMain) ? source.scriptMain : {},
    scriptAux: isRecord(source.scriptAux) ? source.scriptAux : {},
    overrides: isRecord(source.overrides) ? source.overrides : {},
  }
}

function normalizeHypaV3Presets(database: JsonRecord): void {
  if (!Array.isArray(database.hypaV3Presets) || database.hypaV3Presets.length === 0) {
    const existingSettings = isRecord(database.hypaV3Settings) ? database.hypaV3Settings : {}
    database.hypaV3Presets = [
      {
        name: 'Default',
        settings: {
          ...cloneJson(DEFAULT_HYPA_V3_SETTINGS),
          ...cloneJson(existingSettings),
          summarizationPrompt: typeof database.supaMemoryPrompt === 'string' ? database.supaMemoryPrompt : '',
        },
      },
    ]
  } else {
    database.hypaV3Presets = database.hypaV3Presets.map((preset, index) => {
      const source = isRecord(preset) ? preset : {}
      const settings = isRecord(source.settings) ? source.settings : {}
      return {
        name: typeof source.name === 'string' && source.name ? source.name : `Preset ${index + 1}`,
        settings: {
          ...cloneJson(DEFAULT_HYPA_V3_SETTINGS),
          ...cloneJson(settings),
        },
      }
    })
  }
  if (!Number.isInteger(database.hypaV3PresetId)) database.hypaV3PresetId = 0
}

function normalizeTranslatorPresets(database: JsonRecord): void {
  normalizeTranslatorPresetState(database as TranslatorPresetStateLike)
}

function normalizeHypaCustomSettings(database: JsonRecord): void {
  const source = isRecord(database.hypaCustomSettings) ? database.hypaCustomSettings : {}
  database.hypaCustomSettings = {
    url: typeof source.url === 'string' ? source.url : '',
    key: typeof source.key === 'string' ? source.key : '',
    model: typeof source.model === 'string' ? source.model : '',
  }
}

function normalizeHotkeys(database: JsonRecord): void {
  if (!Array.isArray(database.hotkeys)) {
    database.hotkeys = cloneJson(defaultHotkeys)
    return
  }
  const hotkeys = database.hotkeys.filter(
    (hotkey) => !isRecord(hotkey) || !RETIRED_HOTKEY_ACTIONS.has(String(hotkey.action)),
  )
  const existingActions = new Set(
    hotkeys
      .filter((hotkey): hotkey is JsonRecord => isRecord(hotkey))
      .map((hotkey) => hotkey.action)
      .filter((action): action is string => typeof action === 'string'),
  )
  const missing = defaultHotkeys.filter((hotkey) => !existingActions.has(hotkey.action))
  if (missing.length > 0) hotkeys.push(...cloneJson(missing))
  if (database.enableScrollToActiveChar === false) {
    database.hotkeys = hotkeys.filter((hotkey) => !isRecord(hotkey) || hotkey.action !== 'scrollToActiveChar')
    return
  }
  database.hotkeys = hotkeys
}

function normalizeFallbackModels(database: JsonRecord): void {
  database.fallbackModels = normalizeLegacyFallbackModels(database.fallbackModels)
}

function normalizeFormatVersion(database: JsonRecord): void {
  const version = isFiniteNumber(database.formatversion) ? database.formatversion : 0
  if (version < 5 && isFiniteNumber(database.loreBookToken) && database.loreBookToken < 8000) {
    database.loreBookToken = 8000
  }
  database.formatversion = Math.max(version, 5)
  if (!Array.isArray(database.characterOrder)) database.characterOrder = []
}

function normalizeNumber(database: JsonRecord, key: string, fallback: number): void {
  if (!isFiniteNumber(database[key])) database[key] = fallback
}

function setDefault(target: JsonRecord, key: string, value: unknown): void {
  if (isNullish(target[key])) target[key] = cloneJson(value)
}

function normalizeKeepSessionAlive(value: unknown): 'off' | 'sound' {
  if (value === 'pip') return 'sound'
  return value === 'sound' ? 'sound' : 'off'
}

function isNullish(value: unknown): boolean {
  return value === null || value === undefined
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
