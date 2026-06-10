import { get } from 'svelte/store'
import { checkNullish, decryptBuffer, encryptBuffer, selectSingleFile } from '../util'
import { changeLanguage, language } from '../../lang'
import type { RisuPlugin } from '../plugins/plugins.svelte'
import type { triggerscript as triggerscriptMain } from '../process/triggers'
import { downloadFile, saveAsset as saveImageGlobal } from '../globalApi.svelte'
import { defaultAutoSuggestPrompt, defaultJailbreak, defaultMainPrompt } from './defaultPrompts'
import { alertNormal } from '../alert'
import type { NAISettings } from '../process/models/nai'
import { prebuiltNAIpresets, prebuiltPresets } from '../process/templates/templates'
import { defaultColorScheme, type ColorScheme } from '../gui/colorscheme'
import type { PromptItem, PromptSettings } from '../process/prompt'
import type { OobaChatCompletionRequestParams } from '../model/ooba'
import {
  type HypaV3Settings,
  type HypaV3Preset,
  createHypaV3Preset,
} from '../process/memory/hypav3'
import { normalizeTranslatorPresetState, type TranslatorPreset } from '../translator/presets'
import { safeStructuredClone } from '../polyfill'
import {
  canUseServerCommands,
  copyPresetCommand,
  createPresetCommand,
  deletePresetCommand,
  importPresetCommand,
  reorderPresetsCommand,
  runServerPresetCommand,
  selectPresetCommand,
  updatePresetCommand,
  type PresetSnapshot,
  type ServerCommandResult,
} from '../server/commands'
import {
  currentCharacterRowSnapshot,
  dispatchCompatibleCharacterUpdateScoped,
} from '../characterCommands'
import { currentChatScopedSnapshot, dispatchCompatibleChatUpdateScoped } from '../chatCommands'
import {
  createReadOnlyServerProjection,
  isServerProjectionWriteGuardEnabled,
  setServerProjectionWriteGuardEnabled,
  withServerProjectionApply,
  withTrustedServerProjectionWrite,
} from '../server/projectionWriteGuard.svelte'
import {
  isServerChatMessagePlaceholder,
  SERVER_UNLOADED_CHAT_MESSAGE_MARKER,
} from '../server/chatMessagePlaceholders'
import {
  DEFAULT_CHAT_DISPLAY_TAIL_COUNT,
  normalizeChatDisplayTailCount,
} from '../chatDisplayTailCount'
import type { ChatGenerationSettings } from '../chatGenerationSettings'

//APP_VERSION_POINT is to locate the app version in the database file for version bumping
export let appVer = 'Fastify Variant Version: Alpha' //<APP_VERSION_POINT>
export let webAppSubVer = ''

function createClientPresetId() {
  return crypto.randomUUID()
}

function createClientPromptItemId() {
  return crypto.randomUUID()
}

export function normalizePromptTemplateIds(data: Pick<Database, 'promptTemplate'>) {
  if (!Array.isArray(data.promptTemplate)) return

  const seen = new Set<string>()
  for (const item of data.promptTemplate) {
    if (!item || typeof item !== 'object') continue
    const id = typeof item.id === 'string' && item.id.trim() ? item.id : createClientPromptItemId()
    item.id = seen.has(id) ? createClientPromptItemId() : id
    seen.add(item.id)
  }
}

function normalizeBotPresetIds(data: Pick<Database, 'botPresets' | 'botPresetsId'>) {
  if (!Array.isArray(data.botPresets)) {
    data.botPresets = []
  }

  const seen = new Set<string>()
  for (const preset of data.botPresets) {
    if (!preset) continue
    const id =
      typeof preset.id === 'string' && preset.id.trim() ? preset.id : createClientPresetId()
    preset.id = seen.has(id) ? createClientPresetId() : id
    seen.add(preset.id)
  }

  if (!Number.isInteger(data.botPresetsId)) {
    data.botPresetsId = data.botPresets.length > 0 ? 0 : -1
  } else if (data.botPresetsId >= data.botPresets.length) {
    data.botPresetsId = data.botPresets.length > 0 ? data.botPresets.length - 1 : -1
  } else if (data.botPresetsId < -1) {
    data.botPresetsId = data.botPresets.length > 0 ? 0 : -1
  }
}

function presetIdAt(index: number): string | null {
  normalizeBotPresetIds(DBState.db)
  return DBState.db.botPresets[index]?.id ?? null
}

const SET_PRESET_ROLLBACK_KEYS = [
  'apiType',
  'localNetworkMode',
  'localNetworkTimeoutSec',
  'mainPrompt',
  'jailbreak',
  'globalNote',
  'temperature',
  'maxContext',
  'maxResponse',
  'frequencyPenalty',
  'PresensePenalty',
  'formatingOrder',
  'aiModel',
  'subModel',
  'currentPluginProvider',
  'textgenWebUIStreamURL',
  'textgenWebUIBlockingURL',
  'forceReplaceUrl',
  'promptPreprocess',
  'bias',
  'koboldURL',
  'proxyKey',
  'ooba',
  'ainconfig',
  'openrouterRequestModel',
  'proxyRequestModel',
  'NAIsettings',
  'autoSuggestPrompt',
  'autoSuggestPrefix',
  'autoSuggestClean',
  'promptTemplate',
  'NAIadventure',
  'NAIappendName',
  'localStopStrings',
  'customProxyRequestModel',
  'reverseProxyOobaArgs',
  'top_p',
  'promptSettings',
  'repetition_penalty',
  'min_p',
  'top_a',
  'openrouterProvider',
  'useInstructPrompt',
  'customPromptTemplateToggle',
  'templateDefaultVariables',
  'moduleIntergration',
  'top_k',
  'instructChatTemplate',
  'JinjaTemplate',
  'jsonSchemaEnabled',
  'jsonSchema',
  'strictJsonSchema',
  'extractJson',
  'seperateParametersEnabled',
  'customAPIFormat',
  'systemContentReplacement',
  'systemRoleReplacement',
  'customFlags',
  'enableCustomFlags',
  'presetRegex',
  'reasoningEffort',
  'thinkingTokens',
  'thinkingType',
  'deepseekThinkingType',
  'adaptiveThinkingEffort',
  'deepseekReasoningEffort',
  'outputImageModal',
  'seperateModelsForAxModels',
  'seperateModels',
  'fallbackModels',
  'fallbackWhenBlankResponse',
  'seperateParameters',
  'modelTools',
  'verbosity',
  'dynamicOutput',
] as const satisfies readonly (keyof Database)[]

type SetPresetRollbackKey = (typeof SET_PRESET_ROLLBACK_KEYS)[number]

interface PresetRollbackSnapshot {
  botPresets: botPreset[]
  botPresetsId: number
  setPresetSettings?: Partial<Record<SetPresetRollbackKey, unknown>>
}

function snapshotSetPresetSettings(db: Database): Partial<Record<SetPresetRollbackKey, unknown>> {
  const snapshot: Partial<Record<SetPresetRollbackKey, unknown>> = {}
  const dbRecord = db as unknown as Record<SetPresetRollbackKey, unknown>
  for (const key of SET_PRESET_ROLLBACK_KEYS) {
    snapshot[key] = safeStructuredClone(dbRecord[key])
  }
  return snapshot
}

function currentPresetRollbackSnapshot(
  db: Database,
  options: { includeSetPresetSettings?: boolean } = {},
): PresetRollbackSnapshot {
  normalizeBotPresetIds(db)
  return {
    botPresets: safeStructuredClone(db.botPresets),
    botPresetsId: db.botPresetsId,
    ...(options.includeSetPresetSettings
      ? { setPresetSettings: snapshotSetPresetSettings(db) }
      : {}),
  }
}

function restorePresetRollbackSnapshot(snapshot: PresetRollbackSnapshot): void {
  withTrustedServerProjectionWrite(() => {
    DBState.db.botPresets = safeStructuredClone(snapshot.botPresets)
    DBState.db.botPresetsId = snapshot.botPresetsId
    if (snapshot.setPresetSettings) {
      const dbRecord = DBState.db as unknown as Record<SetPresetRollbackKey, unknown>
      for (const key of SET_PRESET_ROLLBACK_KEYS) {
        if (Object.hasOwn(snapshot.setPresetSettings, key)) {
          dbRecord[key] = safeStructuredClone(snapshot.setPresetSettings[key])
        }
      }
    }
  })
}

function runPresetCommand<T extends Record<string, unknown>>(
  command: (baseRevision: number) => Promise<ServerCommandResult<T>>,
  rollback: () => void,
) {
  if (!canUseServerCommands()) return
  void runServerPresetCommand({ command, rollback })
}

export function setDatabase(data: Database) {
  if (checkNullish(data.characters)) {
    data.characters = []
  }
  data.characters = data.characters.filter((c) => (c as { type?: string } | null)?.type !== 'group')
  if (checkNullish(data.apiType)) {
    data.apiType = 'gemini-3-flash-preview'
  }
  if (checkNullish(data.openAIKey)) {
    data.openAIKey = ''
  }
  if (checkNullish(data.mainPrompt)) {
    data.mainPrompt = defaultMainPrompt
  }
  if (checkNullish(data.jailbreak)) {
    data.jailbreak = defaultJailbreak
  }
  if (checkNullish(data.globalNote)) {
    data.globalNote = ``
  }
  if (checkNullish(data.temperature)) {
    data.temperature = 80
  }
  if (checkNullish(data.maxContext)) {
    data.maxContext = 4000
  }
  if (checkNullish(data.maxResponse)) {
    data.maxResponse = 500
  }
  if (checkNullish(data.frequencyPenalty)) {
    data.frequencyPenalty = 70
  }
  if (checkNullish(data.PresensePenalty)) {
    data.PresensePenalty = 70
  }
  if (checkNullish(data.aiModel)) {
    data.aiModel = 'gemini-3-flash-preview'
  }
  if (checkNullish(data.jailbreakToggle)) {
    data.jailbreakToggle = false
  }
  if (checkNullish(data.formatingOrder)) {
    data.formatingOrder = [
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
  }
  if (checkNullish(data.loreBookDepth)) {
    data.loreBookDepth = 5
  }
  if (checkNullish(data.loreBookToken)) {
    data.loreBookToken = 800
  }
  if (checkNullish(data.username)) {
    data.username = 'User'
  }
  if (checkNullish(data.userIcon)) {
    data.userIcon = ''
  }
  if (checkNullish(data.userNote)) {
    data.userNote = ''
  }
  if (checkNullish(data.additionalPrompt)) {
    data.additionalPrompt = 'The assistant must act as {{char}}. user is {{user}}.'
  }
  if (checkNullish(data.descriptionPrefix)) {
    data.descriptionPrefix = 'description of {{char}}: '
  }
  if (checkNullish(data.forceReplaceUrl)) {
    data.forceReplaceUrl = ''
  }
  if (checkNullish(data.language)) {
    data.language = 'en'
  }
  if (checkNullish(data.swipe)) {
    data.swipe = true
  }
  if (checkNullish(data.translator)) {
    data.translator = ''
  }
  if (checkNullish(data.translatorMaxResponse)) {
    data.translatorMaxResponse = 1000
  }
  if (checkNullish(data.currentPluginProvider)) {
    data.currentPluginProvider = ''
  }
  if (checkNullish(data.plugins)) {
    data.plugins = []
  }
  if (checkNullish(data.zoomsize)) {
    data.zoomsize = 100
  }
  data.chatDisplayTailCount = normalizeChatDisplayTailCount(
    data.chatDisplayTailCount ?? DEFAULT_CHAT_DISPLAY_TAIL_COUNT,
  )
  if (checkNullish(data.customBackground)) {
    data.customBackground = ''
  }
  if (checkNullish(data.textgenWebUIStreamURL)) {
    data.textgenWebUIStreamURL = 'wss://localhost/api/'
  }
  if (checkNullish(data.textgenWebUIBlockingURL)) {
    data.textgenWebUIBlockingURL = 'https://localhost/api/'
  }
  if (checkNullish(data.autoTranslate)) {
    data.autoTranslate = false
  }
  if (checkNullish(data.fullScreen)) {
    data.fullScreen = false
  }
  if (checkNullish(data.playMessage)) {
    data.playMessage = false
  }
  if (checkNullish(data.iconsize)) {
    data.iconsize = 100
  }
  if (checkNullish(data.theme)) {
    data.theme = ''
  }
  if (checkNullish(data.subModel)) {
    data.subModel = 'gemini-3-flash-preview'
  }
  if (checkNullish(data.waifuWidth)) {
    data.waifuWidth = 100
  }
  if (checkNullish(data.waifuWidth2)) {
    data.waifuWidth2 = 100
  }
  if (checkNullish(data.emotionPrompt)) {
    data.emotionPrompt = ''
  }
  if (checkNullish(data.proxyKey)) {
    data.proxyKey = ''
  }
  if (checkNullish(data.botPresets)) {
    let defaultPreset = safeStructuredClone(presetTemplate)
    defaultPreset.name = 'Default'
    data.botPresets = [defaultPreset]
  }
  normalizeBotPresetIds(data)
  if (checkNullish(data.botPresetsId)) {
    data.botPresetsId = 0
  }
  if (checkNullish(data.sdProvider)) {
    data.sdProvider = ''
  }
  if (checkNullish(data.webUiUrl)) {
    data.webUiUrl = 'http://127.0.0.1:7860/'
  }
  if (checkNullish(data.sdSteps)) {
    data.sdSteps = 30
  }
  if (checkNullish(data.sdCFG)) {
    data.sdCFG = 7
  }
  if (checkNullish(data.NAIImgUrl)) {
    data.NAIImgUrl = 'https://image.novelai.net/ai/generate-image'
  }
  if (checkNullish(data.NAIApiKey)) {
    data.NAIApiKey = ''
  }
  if (checkNullish(data.NAIImgModel)) {
    data.NAIImgModel = 'nai-diffusion-4-5-full'
  }
  if (checkNullish(data.NAII2I)) {
    data.NAII2I = false
  }
  if (checkNullish(data.NAIREF)) {
    data.NAIREF = false
  }
  if (checkNullish(data.textTheme)) {
    data.textTheme = 'standard'
  }
  if (checkNullish(data.emotionPrompt2)) {
    data.emotionPrompt2 = ''
  }
  if (checkNullish(data.requestRetrys)) {
    data.requestRetrys = 2
  }
  if (checkNullish(data.useSayNothing)) {
    data.useSayNothing = true
  }
  if (checkNullish(data.bias)) {
    data.bias = []
  }
  if (checkNullish(data.showUnrecommended)) {
    data.showUnrecommended = false
  }
  data.doNotWarnExternalServers ??= false
  if (checkNullish(data.pluginCompatibilityMode)) {
    data.pluginCompatibilityMode = false
  }
  if (checkNullish(data.elevenLabKey)) {
    data.elevenLabKey = ''
  }
  if (checkNullish(data.voicevoxUrl)) {
    data.voicevoxUrl = ''
  }
  if (checkNullish(data.showMemoryLimit)) {
    data.showMemoryLimit = false
  }
  if (checkNullish(data.showFirstMessagePages)) {
    data.showFirstMessagePages = false
  }
  if (checkNullish(data.supaMemoryKey)) {
    data.supaMemoryKey = ''
  }
  if (checkNullish(data.hypaV3Key)) {
    data.hypaV3Key = data.supaMemoryKey ?? ''
  }
  if (checkNullish(data.hypaMemoryKey)) {
    data.hypaMemoryKey = ''
  }
  if (checkNullish(data.voyageApiKey)) {
    data.voyageApiKey = ''
  }
  if (checkNullish(data.askRemoval)) {
    data.askRemoval = true
  }
  if (checkNullish(data.sdConfig)) {
    data.sdConfig = {
      width: 512,
      height: 512,
      sampler_name: 'Euler a',
      script_name: '',
      denoising_strength: 0.7,
      enable_hr: false,
      hr_scale: 1.25,
      hr_upscaler: 'Latent',
    }
  }
  if (checkNullish(data.NAIImgConfig)) {
    data.NAIImgConfig = {
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
      //add 4
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
  }
  //add NAI v4 (사용중인 사람용 추가 DB Init)
  if (checkNullish(data.NAIImgConfig.v4_prompt)) {
    data.NAIImgConfig.autoSmea = false
    data.NAIImgConfig.use_coords = false
    data.NAIImgConfig.legacy_uc = false
    data.NAIImgConfig.v4_prompt = {
      caption: {
        base_caption: '',
        char_captions: [],
      },
      use_coords: false,
      use_order: true,
    }
    data.NAIImgConfig.v4_negative_prompt = {
      caption: {
        base_caption: '',
        char_captions: [],
      },
      legacy_uc: false,
    }
  }
  if (checkNullish(data.customTextTheme)) {
    data.customTextTheme = {
      FontColorStandard: '#f8f8f2',
      FontColorBold: '#f8f8f2',
      FontColorItalic: '#8C8D93',
      FontColorItalicBold: '#8C8D93',
      FontColorQuote1: '#8BE9FD',
      FontColorQuote2: '#FFB86C',
    }
  }
  if (checkNullish(data.hordeConfig)) {
    data.hordeConfig = {
      apiKey: '',
      model: '',
      softPrompt: '',
    }
  }
  if (checkNullish(data.novelai)) {
    data.novelai = {
      token: '',
      model: 'clio-v1',
    }
  }
  if (checkNullish(data.loreBook)) {
    data.loreBookPage = 0
    data.loreBook = [
      {
        name: 'My First LoreBook',
        data: [],
      },
    ]
  }
  if (checkNullish(data.loreBookPage) || data.loreBook.length < data.loreBookPage) {
    data.loreBookPage = 0
  }
  data.globalscript ??= []
  data.sendWithEnter ??= true
  data.autoSuggestPrompt ??= defaultAutoSuggestPrompt
  data.autoSuggestPrefix ??= ''
  data.OAIPrediction ??= ''
  data.autoSuggestClean ??= true
  data.imageCompression ??= true
  data.enableBlockPartialEdit ??= false
  data.enableDragPartialEdit ??= false
  if (!data.formatingOrder.includes('personaPrompt')) {
    data.formatingOrder.splice(data.formatingOrder.indexOf('main'), 0, 'personaPrompt')
  }
  data.selectedPersona ??= 0
  data.personaPrompt ??= ''
  data.personas ??= [
    {
      name: data.username,
      personaPrompt: '',
      icon: data.userIcon,
      note: data.userNote,
      largePortrait: false,
    },
  ]
  data.classicMaxWidth ??= false
  data.ooba ??= safeStructuredClone(defaultOoba)
  data.ainconfig ??= safeStructuredClone(defaultAIN)
  data.openrouterKey ??= ''
  data.openrouterRequestModel ??= 'openai/gpt-3.5-turbo'
  data.nanogptKey ??= ''
  data.nanogptRequestModel ??= ''
  data.nanogptRequestModelName ??= ''
  data.nanogptProvider ??= ''
  data.nanogptSubscriptionState ??= ''
  data.nanogptUseSubscriptionEndpoint ??= false
  data.NAIsettings ??= safeStructuredClone(prebuiltNAIpresets)
  data.assetWidth ??= -1
  data.animationSpeed ??= 0.4
  data.colorScheme ??= safeStructuredClone(defaultColorScheme)
  data.colorSchemeName ??= 'default'
  data.NAIsettings.starter ??= ''
  data.hypaModel ??= 'MiniLM'
  data.mancerHeader ??= ''
  data.emotionProcesser ??= 'submodel'
  data.translatorType ??= 'google'
  data.htmlTranslation ??= false
  data.deeplOptions ??= {
    key: '',
    freeApi: false,
  }
  data.deeplXOptions ??= {
    url: '',
    token: '',
  }
  data.NAIadventure ??= false
  data.NAIappendName ??= true
  data.NAIsettings.cfg_scale ??= 1
  data.NAIsettings.mirostat_tau ??= 0
  data.NAIsettings.mirostat_lr ??= 1
  data.autofillRequestUrl ??= true
  data.customProxyRequestModel ??= ''
  data.generationSeed ??= -1
  data.newOAIHandle ??= true
  data.localNetworkMode ??= false
  if (typeof data.localNetworkMode !== 'boolean') {
    data.localNetworkMode = false
  }
  data.localNetworkTimeoutSec ??= 600
  if (
    typeof data.localNetworkTimeoutSec !== 'number' ||
    Number.isNaN(data.localNetworkTimeoutSec)
  ) {
    data.localNetworkTimeoutSec = 600
  }
  data.gptVisionQuality ??= 'low'
  data.huggingfaceKey ??= ''
  data.fishSpeechKey ??= ''
  data.presetRegex ??= []
  data.reverseProxyOobaArgs ??= {
    mode: 'instruct',
  }
  data.top_p ??= 1
  if (typeof data.top_p !== 'number') {
    // Normalize migrated data that stored top_p as a non-number.
    data.top_p = 1
  }
  //@ts-expect-error data.google has required fields (accessToken, projectId), but we use empty object as default and populate below
  data.google ??= {}
  data.google.accessToken ??= ''
  data.google.projectId ??= ''
  data.genTime ??= 1
  data.promptSettings ??= {
    assistantPrefill: '',
    postEndInnerFormat: '',
    sendChatAsSystem: false,
    sendName: false,
    utilOverride: false,
    customChainOfThought: false,
    maxThoughtTagDepth: -1,
  }
  data.keiServerURL ??= ''
  data.top_k ??= 0
  data.promptSettings.maxThoughtTagDepth ??= -1
  data.openrouterFallback ??= true
  data.openrouterMiddleOut ??= false
  data.removePunctuationHypa ??= true
  data.memoryLimitThickness ??= 1
  data.modules ??= []
  data.enabledModules ??= []
  data.additionalParams ??= []
  data.heightMode ??= 'normal'
  data.antiClaudeOverload ??= false
  data.ollamaURL ??= ''
  data.ollamaModel ??= ''
  data.ollamaModelSource ??=
    data.aiModel === 'ollama-cloud' || data.subModel === 'ollama-cloud' ? 'cloud' : 'local'
  data.ollamaInputMode ??= 'manual'
  data.ollamaRequestFormat ??= LLMFormat.Ollama
  data.ollamaApiKey ??= ''
  data.ollamaModelName ??= ''
  data.ollamaCloudModel ??= ''
  data.ollamaCloudModelName ??= ''
  data.ollamaThinkingMode ??= 'auto'
  if (
    (data.aiModel === 'ollama-cloud' || data.subModel === 'ollama-cloud') &&
    !data.ollamaCloudModel
  ) {
    data.ollamaCloudModel = data.ollamaModel
    data.ollamaCloudModelName = data.ollamaModelName
  }
  data.repetition_penalty ??= 1
  data.min_p ??= 0
  data.top_a ??= 0
  data.customTokenizer ??= 'tik'
  data.instructChatTemplate ??= 'chatml'
  // Migration: convert old string type into new provider object
  if (typeof data.openrouterProvider === 'string') {
    const oldProvider = data.openrouterProvider as unknown as string
    data.openrouterProvider = {
      order: oldProvider ? [oldProvider] : [],
      only: [],
      ignore: [],
    }
  }
  if (data.botPresets) {
    for (const preset of data.botPresets) {
      preset.localNetworkMode ??= false
      preset.localNetworkTimeoutSec ??= 600
      if (typeof preset.localNetworkMode !== 'boolean') {
        preset.localNetworkMode = false
      }
      if (
        typeof preset.localNetworkTimeoutSec !== 'number' ||
        Number.isNaN(preset.localNetworkTimeoutSec)
      ) {
        preset.localNetworkTimeoutSec = 600
      }
      if (typeof preset.openrouterProvider === 'string') {
        const oldProvider = preset.openrouterProvider as unknown as string
        preset.openrouterProvider = {
          order: oldProvider ? [oldProvider] : [],
          only: [],
          ignore: [],
        }
      }
    }
  }
  data.openrouterProvider ??= {
    order: [],
    only: [],
    ignore: [],
  }
  data.useInstructPrompt ??= false
  data.textAreaSize ??= 0
  data.sideBarSize ??= 0
  data.textAreaTextSize ??= 0
  data.combineTranslation ??= false
  data.customPromptTemplateToggle ??= ''
  data.globalChatVariables ??= {}
  data.templateDefaultVariables ??= ''
  data.dallEQuality ??= 'standard'
  data.customTextTheme.FontColorQuote1 ??= '#8BE9FD'
  data.customTextTheme.FontColorQuote2 ??= '#FFB86C'
  data.font ??= 'default'
  data.customFont ??= ''
  data.lineHeight ??= 1.25
  data.stabilityModel ??= 'sd3-large'
  data.stabllityStyle ??= ''
  data.legacyTranslation ??= false
  data.comfyUiUrl ??= 'http://localhost:8188'
  data.comfyConfig ??= {
    workflow: '',
    posNodeID: '',
    posInputName: 'text',
    negNodeID: '',
    negInputName: 'text',
    timeout: 30,
  }
  data.hideApiKey ??= true
  data.unformatQuotes ??= false
  data.ttsAutoSpeech ??= false
  data.translatorInputLanguage ??= 'auto'
  data.falModel ??= 'fal-ai/flux/dev'
  data.falLoraScale ??= 1
  data.customCSS ??= ''
  data.strictJsonSchema ??= true
  data.statics ??= {
    messages: 0,
    imports: 0,
  }
  data.customQuotes ??= false
  data.customQuotesData ??= ['“', '”', '‘', '’']
  data.customGUI ??= ''
  data.guiHTML ??= ''
  data.customAPIFormat ??= LLMFormat.OpenAICompatible
  data.systemContentReplacement ??= `system: {{slot}}`
  data.systemRoleReplacement ??= 'user'
  data.vertexAccessToken ??= ''
  data.vertexAccessTokenExpires ??= 0
  data.vertexClientEmail ??= ''
  data.vertexPrivateKey ??= ''
  data.vertexRegion ??= 'global'
  data.seperateParametersEnabled ??= false
  data.seperateParameters ??= {
    memory: {},
    emotion: {},
    translate: {},
    otherAx: {},
    overrides: {},
  }
  data.seperateParameters.overrides ??= {}
  data.customFlags ??= []
  data.enableCustomFlags ??= false
  data.assetMaxDifference ??= 4
  data.showSavingIcon ??= false
  data.banCharacterset ??= []
  data.showPromptComparison ??= false
  data.OaiCompAPIKeys ??= {}
  data.reasoningEffort ??= 0
  data.hypaV3Presets ??= [
    createHypaV3Preset('Default', {
      summarizationPrompt: (data as { supaMemoryPrompt?: string }).supaMemoryPrompt ?? '',
      ...data.hypaV3Settings,
    }),
  ]
  if (data.hypaV3Presets.length > 0) {
    data.hypaV3Presets = data.hypaV3Presets.map((preset, i) =>
      createHypaV3Preset(preset.name || `Preset ${i + 1}`, preset.settings || {}),
    )
  }
  data.hypaV3PresetId ??= 0
  normalizeTranslatorPresetState(data)
  data.showDeprecatedTriggerV2 ??= false
  data.returnCSSError ??= true
  data.realmDirectOpen ??= false
  data.checkCorruption ??= false
  data.toggleConfirmRecommendedPreset ??= false
  data.useExperimentalGoogleTranslator ??= false
  data.thinkingType ??= 'budget'
  data.deepseekThinkingType ??= 'off'
  data.adaptiveThinkingEffort ??= 'high'
  data.deepseekReasoningEffort ??= 'high'
  if (data.antiClaudeOverload) {
    //migration
    data.antiClaudeOverload = false
    data.antiServerOverloads = true
  }
  data.hypaCustomSettings = {
    url: data.hypaCustomSettings?.url ?? '',
    key: data.hypaCustomSettings?.key ?? '',
    model: data.hypaCustomSettings?.model ?? '',
  }
  data.doNotChangeSeperateModels ??= false
  data.modelTools ??= []
  data.enableScrollToActiveChar ??= true

  // Merge existing hotkeys with new default hotkeys
  if (!data.hotkeys) {
    data.hotkeys = safeStructuredClone(defaultHotkeys)
  } else {
    const existingActions = new Set(data.hotkeys.map((h) => h.action))
    const newHotkeys = defaultHotkeys.filter((h) => !existingActions.has(h.action))
    if (newHotkeys.length > 0) {
      data.hotkeys.push(...safeStructuredClone(newHotkeys))
    }
  }

  // Remove scrollToActiveChar hotkey if feature is disabled
  if (data.enableScrollToActiveChar === false) {
    data.hotkeys = data.hotkeys.filter((h) => h.action !== 'scrollToActiveChar')
  }

  data.fallbackModels ??= {
    memory: [],
    emotion: [],
    translate: [],
    otherAx: [],
    model: [],
  }
  data.fallbackModels = {
    model: data.fallbackModels.model.filter((v) => v !== ''),
    memory: data.fallbackModels.memory.filter((v) => v !== ''),
    emotion: data.fallbackModels.emotion.filter((v) => v !== ''),
    translate: data.fallbackModels.translate.filter((v) => v !== ''),
    otherAx: data.fallbackModels.otherAx.filter((v) => v !== ''),
  }
  data.customModels ??= []
  data.authRefreshes ??= []
  data.rememberToolUsage ??= true
  data.simplifiedToolUse ??= false
  data.streamGeminiThoughts ??= false
  data.settingsCloseButtonSize ??= 24
  data.hideAllImages ??= false
  data.ImagenModel ??= 'imagen-4.0-generate-001'
  data.ImagenImageSize ??= '1K'
  data.ImagenAspectRatio ??= '1:1'
  data.ImagenPersonGeneration ??= 'allow_all'
  data.openaiCompatImage ??= {
    url: '',
    key: '',
    model: '',
    size: '1024x1024',
    quality: 'auto',
  }
  data.wavespeedImage ??= {
    key: '',
    model: '',
    loras: [],
    reference_mode: '',
    reference_image: '',
    reference_base64image: '',
  }
  data.autoScrollToNewMessage ??= true
  data.alwaysScrollToNewMessage ??= false
  data.newMessageButtonStyle ??= 'bottom-center'
  data.echoMessage ??= 'Echo Message'
  data.echoDelay ??= 0
  data.createFolderOnBranch ??= true
  data.hamburgerButtonBottom ??= false
  data.dynamicModelRegistry ??= true
  data.saveSignatures ??= false
  // If the user uses plugins, its probably better to enable RisuAI Pro Tools by default
  // Because its likely they are power users who would benefit from the features
  data.enableRisuaiProTools ??= data.plugins.length > 0
  data.keepSessionAlive ??= 'off'
  data.loadouts ??= []
  data.longPressToPopupEditor ??= false
  data.customSidebarItems ??= []
  changeLanguage(data.language)
  setDatabaseLite(data)
}

export function applyServerProjectionDatabase(data: Database) {
  return withServerProjectionApply(() => {
    changeLanguage(data.language)
    setDatabaseLite(data)
  })
}

/**
 * Surgically merges targeted projection fields into the live projection without
 * a full `setDatabase` replace. Used for foreign command events and entity
 * hydration. The fields come from the server projection (same source as
 * bootstrap), so no re-normalization is needed; this must not clobber
 * locally-hydrated entities outside the named keys.
 */
export function mergeServerProjectionFields(fields: Partial<Database>) {
  return withServerProjectionApply(() => {
    const db = DBState.db as unknown as Record<string, unknown>
    for (const [key, value] of Object.entries(fields)) {
      db[key] = value
    }
  })
}

/**
 * Surgically replace a single character row by `chaId` without touching the rest
 * of the `characters` array. Used for foreign per-character refreshes
 * (`characterRow` events: character field edits, module-link reorders, chat /
 * chat-folder metadata edits). The shipped row is message-free (stubbed chats),
 * so already-hydrated chat messages / globalLore are carried over to avoid
 * dropping loaded history. Returns false if the character is unknown so the
 * caller can fall back to a full bootstrap.
 */
export function mergeServerProjectionCharacterRow(
  character: { chaId?: string } & Record<string, unknown>,
): boolean {
  return withServerProjectionApply(() => {
    const characters = DBState.db.characters
    if (!Array.isArray(characters) || typeof character?.chaId !== 'string') return false
    const index = characters.findIndex((candidate) => candidate?.chaId === character.chaId)
    if (index < 0) return false
    const existing = characters[index] as unknown as Record<string, unknown> | undefined

    // The shipped chats are stubs (empty message[]); carry over any messages
    // this client already hydrated so a metadata refresh keeps loaded history.
    const incomingChats = (character as { chats?: Array<Record<string, unknown>> }).chats
    const existingChats = (existing as { chats?: Array<Record<string, unknown>> } | undefined)
      ?.chats
    if (Array.isArray(incomingChats) && Array.isArray(existingChats)) {
      const existingById = new Map(existingChats.map((chat) => [chat?.id, chat]))
      for (const chat of incomingChats) {
        const prior = existingById.get((chat as { id?: unknown }).id)
        if (!prior) continue
        const priorMessage = (prior as { message?: unknown }).message
        if (Array.isArray(priorMessage) && priorMessage.length > 0) {
          ;(chat as { message?: unknown }).message = priorMessage
        }
        const priorHypa = (prior as { hypaV3Data?: unknown }).hypaV3Data
        if (priorHypa !== undefined) (chat as { hypaV3Data?: unknown }).hypaV3Data = priorHypa
      }
    }
    // Preserve resident globalLore if the shipped row stubbed it (stubs on).
    if (
      (character as { globalLore?: unknown }).globalLore === undefined &&
      existing &&
      (existing as { globalLore?: unknown }).globalLore !== undefined
    ) {
      ;(character as { globalLore?: unknown }).globalLore = (
        existing as { globalLore?: unknown }
      ).globalLore
    }

    characters[index] = character as unknown as (typeof characters)[number]
    return true
  })
}

export function applyServerCharacterSelectionProjection(input: {
  characterId: string
  currentChar: number
  lastInteraction?: number
}) {
  return withServerProjectionApply(() => {
    ;(DBState.db as unknown as { currentChar?: number }).currentChar = input.currentChar
    const character = DBState.db.characters?.find(
      (candidate) => candidate?.chaId === input.characterId,
    )
    if (character && input.lastInteraction !== undefined) {
      character.lastInteraction = input.lastInteraction
    }
    selectedCharID.set(input.currentChar)
  })
}

/**
 * Fill a stubbed chat's `message[]` with messages hydrated from the server on
 * chat-open. Targets the chat by id across all characters; a trusted projection
 * write so it passes the read-only guard. Returns true if found and hydrated.
 */
export interface ServerChatMessagesHydrationRange {
  start: number
  total: number
}

export { isServerChatMessagePlaceholder }

function createServerChatMessagePlaceholder(): Message {
  return {
    role: 'char',
    data: '',
    isComment: true,
    disabled: true,
    [SERVER_UNLOADED_CHAT_MESSAGE_MARKER]: true,
  } as Message
}

function createServerChatMessagePlaceholderArray(total: number): Message[] {
  return Array.from({ length: total }, () => createServerChatMessagePlaceholder())
}

export function hydrateServerChatMessages(
  chatId: string,
  message: unknown[],
  hypaV3Data?: unknown,
  range?: ServerChatMessagesHydrationRange,
): boolean {
  return withTrustedServerProjectionWrite(() => {
    for (const character of DBState.db.characters ?? []) {
      const chat = character.chats?.find((candidate) => candidate.id === chatId)
      if (chat) {
        if (range) {
          const total = Math.max(0, Math.floor(range.total))
          const start = Math.min(Math.max(0, Math.floor(range.start)), total)
          const next =
            Array.isArray(chat.message) && chat.message.length === total
              ? chat.message.slice()
              : createServerChatMessagePlaceholderArray(total)
          for (let index = 0; index < message.length && start + index < total; index += 1) {
            next[start + index] = message[index] as Message
          }
          chat.message = next
        } else {
          chat.message = message as Message[]
        }
        // `hypaV3Data` is hydrated alongside messages; undefined means the chat
        // has none, so clear any stale value.
        if (hypaV3Data === undefined) {
          delete (chat as { hypaV3Data?: unknown }).hypaV3Data
        } else {
          chat.hypaV3Data = hypaV3Data as typeof chat.hypaV3Data
        }
        return true
      }
    }
    return false
  })
}

/**
 * Fill a stubbed character's `globalLore` with entries hydrated from the server
 * on character-open. Targets by `chaId`; a trusted projection write so it passes
 * the read-only guard. Returns true if found and hydrated.
 */
export function hydrateServerCharacterLorebook(
  characterId: string,
  globalLore: unknown[],
): boolean {
  return withTrustedServerProjectionWrite(() => {
    return writeServerCharacterLorebook(characterId, globalLore)
  })
}

/**
 * Apply a foreign command-event `character-lorebook` projection. Unlike
 * user-open hydration, this advances the projection epoch so mounted bridge
 * watchers refresh their baselines instead of echoing the foreign edit.
 */
export function applyServerCharacterLorebookProjection(
  characterId: string,
  globalLore: unknown[],
): boolean {
  return withServerProjectionApply(() => {
    return writeServerCharacterLorebook(characterId, globalLore)
  })
}

function writeServerCharacterLorebook(characterId: string, globalLore: unknown[]): boolean {
  for (const character of DBState.db.characters ?? []) {
    if (character.chaId === characterId) {
      character.globalLore = globalLore as typeof character.globalLore
      return true
    }
  }
  return false
}

export {
  isServerProjectionWriteGuardEnabled,
  setServerProjectionWriteGuardEnabled,
  withTrustedServerProjectionWrite,
}

export function setDatabaseLite(data: Database) {
  DBState.db = isServerProjectionWriteGuardEnabled() ? createReadOnlyServerProjection(data) : data
}

interface getDatabaseOptions {
  snapshot?: boolean
}

export function getDatabase(options: getDatabaseOptions = {}): Database {
  if (options.snapshot) {
    return $state.snapshot(DBState.db) as Database
  }
  return DBState.db as Database
}

export function getCurrentCharacter(options: getDatabaseOptions = {}): character {
  const db = getDatabase(options)
  if (!db.characters) {
    db.characters = []
  }
  const char = db.characters?.[get(selectedCharID)]
  return char
}

export function setCurrentCharacter(
  char: character,
  options: { dispatchServerCommand?: boolean } = {},
) {
  withTrustedServerProjectionWrite(() => {
    const shouldDispatch = options.dispatchServerCommand ?? true
    const index = get(selectedCharID)
    const previousState =
      shouldDispatch && canUseServerCommands() ? currentCharacterRowSnapshot(index) : null
    const previousCharacter =
      previousState && DBState.db.characters
        ? $state.snapshot(DBState.db.characters[index])
        : undefined

    if (!DBState.db.characters) {
      DBState.db.characters = []
    }
    DBState.db.characters[index] = char
    if (previousState) {
      dispatchCompatibleCharacterUpdateScoped(previousCharacter, char, previousState)
    }
  })
}

export function getCharacterByIndex(index: number, options: getDatabaseOptions = {}): character {
  const db = getDatabase(options)
  if (!db.characters) {
    db.characters = []
  }
  const char = db.characters?.[index]
  return char
}

export function setCharacterByIndex(index: number, char: character) {
  withTrustedServerProjectionWrite(() => {
    const previousState = canUseServerCommands() ? currentCharacterRowSnapshot(index) : null
    const previousCharacter =
      previousState && DBState.db.characters
        ? $state.snapshot(DBState.db.characters[index])
        : undefined

    if (!DBState.db.characters) {
      DBState.db.characters = []
    }
    DBState.db.characters[index] = char
    if (previousState) {
      dispatchCompatibleCharacterUpdateScoped(previousCharacter, char, previousState)
    }
  })
}

export function getCurrentChat() {
  const char = getCurrentCharacter()
  return char?.chats[char.chatPage]
}

export function setCurrentChat(chat: Chat) {
  withTrustedServerProjectionWrite(() => {
    // Replacing the active chat row only mutates that one chat, so the scoped
    // snapshot's single-chat clone serves as both the diff baseline and the
    // rollback — never a deep clone of the whole characters array (U4).
    const previousState = canUseServerCommands() ? currentChatScopedSnapshot() : null
    const char = getCurrentCharacter()
    const previousChat = previousState?.chat
    char.chats[char.chatPage] = chat
    setCurrentCharacter(char, { dispatchServerCommand: false })
    if (previousState) {
      dispatchCompatibleChatUpdateScoped(previousChat, chat, previousState)
    }
  })
}

export interface DynamicOutput {
  autoAdjustSchema: boolean
  dynamicMessages: boolean
  dynamicMemory: boolean
  dynamicResponseTiming: boolean
  dynamicOutputPrompt: boolean
  showTypingEffect: boolean
  dynamicRequest: boolean
}

export interface Database {
  characters: character[]
  apiType: string
  openAIKey: string
  proxyKey: string
  mainPrompt: string
  jailbreak: string
  globalNote: string
  temperature: number
  askRemoval: boolean
  maxContext: number
  maxResponse: number
  frequencyPenalty: number
  PresensePenalty: number
  formatingOrder: FormatingOrderItem[]
  aiModel: string
  jailbreakToggle: boolean
  loreBookDepth: number
  loreBookToken: number
  cipherChat: boolean
  loreBook: {
    name: string
    data: loreBook[]
  }[]
  loreBookPage: number
  username: string
  userIcon: string
  userNote: string
  additionalPrompt: string
  descriptionPrefix: string
  forceReplaceUrl: string
  language: string
  translator: string
  plugins: RisuPlugin[]
  currentPluginProvider: string
  zoomsize: number
  chatDisplayTailCount?: number
  customBackground: string
  textgenWebUIStreamURL: string
  textgenWebUIBlockingURL: string
  autoTranslate: boolean
  fullScreen: boolean
  playMessage: boolean
  iconsize: number
  theme: string
  subModel: string
  emotionPrompt: string
  formatversion: number
  waifuWidth: number
  waifuWidth2: number
  botPresets: botPreset[]
  botPresetsId: number
  sdProvider: string
  webUiUrl: string
  sdSteps: number
  sdCFG: number
  sdConfig: sdConfig
  NAIImgUrl: string
  NAIApiKey: string
  NAIImgModel: string
  NAII2I: boolean
  NAIREF: boolean
  NAIImgConfig: NAIImgConfig
  ttsAutoSpeech?: boolean
  promptPreprocess: boolean
  bias: [string, number][]
  swipe: boolean
  instantRemove: boolean
  textTheme: string
  customTextTheme: {
    FontColorStandard: string
    FontColorBold: string
    FontColorItalic: string
    FontColorItalicBold: string
    FontColorQuote1: string
    FontColorQuote2: string
  }
  requestRetrys: number
  localNetworkMode: boolean
  localNetworkTimeoutSec: number
  emotionPrompt2: string
  useSayNothing: boolean
  didFirstSetup: boolean
  showUnrecommended: boolean
  doNotWarnExternalServers: boolean
  pluginCompatibilityMode: boolean
  elevenLabKey: string
  voicevoxUrl: string
  useExperimental: boolean
  showMemoryLimit: boolean
  roundIcons: boolean
  useStreaming: boolean
  supaMemoryKey: string
  hypaV3Key: string
  hypaMemoryKey: string
  voyageApiKey: string
  textScreenColor?: string
  textBorder?: boolean
  textScreenRounded?: boolean
  textScreenBorder?: string
  characterOrder: (string | folder)[]
  hordeConfig: hordeConfig
  novelai: {
    token: string
    model: string
  }
  globalscript: customscript[]
  sendWithEnter: boolean
  fixedChatTextarea: boolean
  clickToEdit: boolean
  enableBlockPartialEdit: boolean
  enableDragPartialEdit: boolean
  koboldURL: string
  useAutoSuggestions: boolean
  autoSuggestPrompt: string
  autoSuggestPrefix: string
  autoSuggestClean: boolean
  claudeAPIKey: string
  useChatCopy: boolean
  novellistAPI: string
  useAutoTranslateInput: boolean
  imageCompression: boolean
  account?: {
    token: string
    id: string
    kei?: boolean
  }
  classicMaxWidth: boolean
  useChatSticker: boolean
  useAdditionalAssetsPreview: boolean
  usePlainFetch: boolean
  proxyRequestModel: string
  ooba: OobaSettings
  ainconfig: AINsettings
  personaPrompt: string
  openrouterRequestModel: string
  openrouterKey: string
  openrouterMiddleOut: boolean
  nanogptKey: string
  nanogptRequestModel: string
  nanogptRequestModelName: string
  nanogptProvider: string
  nanogptSubscriptionState: string
  nanogptUseSubscriptionEndpoint: boolean
  openrouterFallback: boolean
  selectedPersona: number
  personas: {
    personaPrompt: string
    name: string
    icon: string
    largePortrait?: boolean
    id?: string
    note?: string
  }[]
  personaNote: boolean
  assetWidth: number
  animationSpeed: number
  botSettingAtStart: false
  NAIsettings: NAISettings
  hideRealm: boolean
  colorScheme: ColorScheme
  colorSchemeName: string
  promptTemplate?: PromptItem[]
  forceProxyAsOpenAI?: boolean
  hypaModel: HypaModel
  saveTime?: number
  mancerHeader: string
  emotionProcesser: 'submodel' | 'embedding'
  showMenuChatList?: boolean
  translatorType: 'google' | 'deepl' | 'none' | 'llm' | 'deeplX' | 'bergamot'
  translatorInputLanguage?: string
  htmlTranslation?: boolean
  NAIadventure?: boolean
  NAIappendName?: boolean
  deeplOptions: {
    key: string
    freeApi: boolean
  }
  deeplXOptions: {
    url: string
    token: string
  }
  localStopStrings?: string[]
  autofillRequestUrl: boolean
  customProxyRequestModel: string
  generationSeed: number
  newOAIHandle: boolean
  gptVisionQuality: string
  reverseProxyOobaMode: boolean
  reverseProxyOobaArgs: OobaChatCompletionRequestParams
  huggingfaceKey: string
  fishSpeechKey: string
  allowAllExtentionFiles?: boolean
  translatorPrompt: string
  translatorMaxResponse: number
  translatorPresets: TranslatorPreset[]
  translatorPresetId: number
  top_p: number
  google: {
    accessToken: string
    projectId: string
  }
  mistralKey?: string
  chainOfThought?: boolean
  genTime: number
  promptSettings: PromptSettings
  keiServerURL: string
  top_k: number
  repetition_penalty: number
  min_p: number
  top_a: number
  claudeAws: boolean
  lastPatchNoteCheckVersion?: string
  removePunctuationHypa?: boolean
  memoryLimitThickness?: number
  modules: RisuModule[]
  enabledModules: string[]
  sideMenuRerollButton?: boolean
  requestInfoInsideChat?: boolean
  additionalParams: [string, string][]
  heightMode: string
  noWaitForTranslate: boolean
  antiClaudeOverload: boolean
  ollamaURL: string
  ollamaModel: string
  ollamaModelSource: 'local' | 'cloud'
  ollamaInputMode: 'list' | 'manual'
  ollamaRequestFormat: LLMFormat
  ollamaApiKey: string
  ollamaModelName: string
  ollamaCloudModel: string
  ollamaCloudModelName: string
  ollamaThinkingMode: 'auto' | 'off' | 'on' | 'low' | 'medium' | 'high'
  removeIncompleteResponse: boolean
  customTokenizer: string
  instructChatTemplate: string
  JinjaTemplate: string
  openrouterProvider: {
    order: string[]
    only: string[]
    ignore: string[]
  }
  useInstructPrompt: boolean
  textAreaSize: number
  sideBarSize: number
  textAreaTextSize: number
  combineTranslation: boolean
  dynamicAssets: boolean
  dynamicAssetsEditDisplay: boolean
  customPromptTemplateToggle: string
  globalChatVariables: { [key: string]: string }
  templateDefaultVariables: string
  cohereAPIKey: string
  goCharacterOnImport: boolean
  dallEQuality: string
  font: string
  customFont: string
  lineHeight: number
  stabilityModel: string
  stabilityKey: string
  stabllityStyle: string
  legacyTranslation: boolean
  comfyConfig: ComfyConfig
  comfyUiUrl: string
  useLegacyGUI: boolean
  claudeCachingExperimental: boolean
  hideApiKey: boolean
  unformatQuotes: boolean
  enableDevTools: boolean
  falToken: string
  falModel: string
  falLora: string
  falLoraName: string
  falLoraScale: number
  moduleIntergration: string
  customCSS: string
  betaMobileGUI: boolean
  jsonSchemaEnabled: boolean
  jsonSchema: string
  strictJsonSchema: boolean
  extractJson: string
  statics: {
    messages: number
    imports: number
  }
  customQuotes: boolean
  customQuotesData?: [string, string, string, string]
  customGUI: string
  guiHTML: string
  OAIPrediction: string
  customAPIFormat: LLMFormat
  systemContentReplacement: string
  systemRoleReplacement: 'user' | 'assistant'
  vertexPrivateKey: string
  vertexClientEmail: string
  vertexAccessToken: string
  vertexAccessTokenExpires: number
  vertexRegion: string
  seperateParametersEnabled: boolean
  seperateParameters: {
    memory: SeparateParameters
    emotion: SeparateParameters
    translate: SeparateParameters
    otherAx: SeparateParameters
    overrides: Record<string, SeparateParameters>
  }
  translateBeforeHTMLFormatting: boolean
  autoTranslateCachedOnly: boolean
  notification: boolean
  customFlags: LLMFlags[]
  enableCustomFlags: boolean
  googleClaudeTokenizing: boolean
  presetChain: string
  legacyMediaFindings?: boolean
  geminiStream?: boolean
  assetMaxDifference: number
  auxModelUnderModelSettings: boolean
  menuSideBar: boolean
  pluginV2: RisuPlugin[]
  showSavingIcon: boolean
  presetRegex: customscript[]
  banCharacterset: string[]
  showPromptComparison: boolean
  hypaV3: boolean
  hypaV3Settings: HypaV3Settings // legacy
  hypaV3Presets: HypaV3Preset[]
  hypaV3PresetId: number
  realmDirectOpen: boolean
  OaiCompAPIKeys: { [key: string]: string }
  inlayErrorResponse: boolean
  reasoningEffort: number
  bulkEnabling: boolean
  showTranslationLoading: boolean
  showDeprecatedTriggerV1: boolean
  showDeprecatedTriggerV2: boolean
  returnCSSError: boolean
  checkCorruption?: boolean
  toggleConfirmRecommendedPreset?: boolean
  useExperimentalGoogleTranslator: boolean
  thinkingTokens: number
  thinkingType: 'off' | 'budget' | 'adaptive'
  deepseekThinkingType: 'off' | 'enabled'
  adaptiveThinkingEffort: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  deepseekReasoningEffort: 'high' | 'max'
  antiServerOverloads: boolean
  hypaCustomSettings: {
    url: string
    key: string
    model: string
  }
  localActivationInGlobalLorebook: boolean
  showFolderName: boolean
  automaticCachePoint: boolean
  coldstorage: boolean
  claudeRetrivalCaching: boolean
  outputImageModal: boolean
  playMessageOnTranslateEnd: boolean
  seperateModelsForAxModels: boolean
  seperateModels: {
    memory: string
    emotion: string
    translate: string
    otherAx: string
  }
  doNotChangeSeperateModels: boolean
  modelTools: string[]
  hotkeys: Hotkey[]
  fallbackModels: {
    memory: string[]
    emotion: string[]
    translate: string[]
    otherAx: string[]
    model: string[]
  }
  doNotChangeFallbackModels: boolean
  fallbackWhenBlankResponse: boolean
  customModels: {
    id: string
    internalId: string
    url: string
    format: LLMFormat
    tokenizer: LLMTokenizer
    key: string
    name: string
    params: string
    flags: LLMFlags[]
  }[]
  igpPrompt: string
  useTokenizerCaching: boolean
  showMenuHypaMemoryModal: boolean
  authRefreshes: {
    url: string
    tokenUrl: string
    refreshToken: string
    clientId: string
    clientSecret: string
  }[]
  promptInfoInsideChat: boolean
  promptTextInfoInsideChat: boolean
  claudeBatching: boolean
  claude1HourCaching: boolean
  rememberToolUsage: boolean
  simplifiedToolUse: boolean
  requestLocation: string
  newImageHandlingBeta?: boolean
  showFirstMessagePages: boolean
  streamGeminiThoughts: boolean
  verbosity: number
  dynamicOutput?: DynamicOutput
  hubServerType?: string
  pluginCustomStorage: { [key: string]: any }
  ImagenModel: string
  ImagenImageSize: string
  ImagenAspectRatio: string
  ImagenPersonGeneration: string
  enableScrollToActiveChar: boolean
  openaiCompatImage: {
    url: string
    key: string
    model: string
    size: string
    quality: string
  }
  wavespeedImage: {
    key: string
    model: string
    loras: Array<{ path: string; scale: number }>
    reference_mode: string
    reference_image: string
    reference_base64image: string
  }
  settingsCloseButtonSize: number
  promptDiffPrefs: PromptDiffPrefs
  enableBookmark?: boolean
  hideAllImages?: boolean
  autoScrollToNewMessage?: boolean
  alwaysScrollToNewMessage?: boolean
  newMessageButtonStyle?: string
  pluginDevelopMode?: boolean
  echoMessage?: string
  echoDelay?: number
  /**
   * Lazy-projection Phase 5 (EXPERIMENTAL, Fastify-only, off by default — NOT
   * RECOMMENDED). When on, the server projection ships character `globalLore` as a
   * stub for non-open characters and the client hydrates it on character-open. The
   * full reader surface still needs real-app validation (see the TODO in
   * `server/fastify/src/repository.ts` loadStubProjection).
   */
  enableLorebookStubs?: boolean
  createFolderOnBranch?: boolean
  hamburgerButtonBottom?: boolean
  enableRemoteSaving?: boolean
  blockquoteStyling?: boolean
  dynamicModelRegistry?: boolean
  enableRisuaiProTools?: boolean
  epEnabled?: boolean
  seperateParametersByModel?: boolean
  disableSeperateParameterChangeOnPresetChange?: boolean
  saveSignatures?: boolean
  keepSessionAlive: 'off' | 'pip' | 'sound'
  longPressToPopupEditor?: boolean
  loadouts: Loadout[]
  disableAprilFools?: boolean
  customSidebarItems: CustomSideBarItem[]
  lastLoadedLoadoutName: string
}

export interface CustomSideBarItem {
  id: string
  type: 'model' | 'databaseKey' | 'loadout' | 'persona' | 'preset' | 'setting'
  subType: string
  label: string
}

export interface SeparateParameters {
  temperature?: number
  top_k?: number
  repetition_penalty?: number
  min_p?: number
  top_a?: number
  top_p?: number
  frequency_penalty?: number
  presence_penalty?: number
  reasoning_effort?: number
  thinking_tokens?: number
  thinking_type?: 'off' | 'budget' | 'adaptive'
  deepseek_thinking_type?: 'off' | 'enabled'
  adaptive_thinking_effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  deepseek_reasoning_effort?: 'high' | 'max'
  outputImageModal?: boolean
  verbosity?: number
}

type OutputModal = 'image' | 'audio' | 'video'

export interface customscript {
  id?: string
  comment: string
  in: string
  out: string
  type: string
  flag?: string
  ableFlag?: boolean
}

export type triggerscript = triggerscriptMain

export interface loreBook {
  key: string
  secondkey: string
  insertorder: number
  comment: string
  content: string
  mode: 'multiple' | 'constant' | 'normal' | 'child' | 'folder'
  alwaysActive: boolean
  selective: boolean
  extentions?: {
    risu_case_sensitive: boolean
  }
  activationPercent?: number
  loreCache?: {
    key: string
    data: string[]
  }
  useRegex?: boolean
  bookVersion?: number
  id?: string
  folder?: string
}

export interface character {
  type?: 'character'
  name: string
  image?: string
  firstMessage: string
  desc: string
  notes: string
  chats: Chat[]
  chatFolders: ChatFolder[]
  chatPage: number
  viewScreen: 'emotion' | 'none' | 'imggen'
  bias: [string, number][]
  emotionImages: [string, string][]
  globalLore: loreBook[]
  chaId: string
  sdData: [string, string][]
  newGenData?: {
    prompt: string
    negative: string
    instructions: string
    emotionInstructions: string
  }
  customscript: customscript[]
  triggerscript: triggerscript[]
  utilityBot: boolean
  exampleMessage: string
  removedQuotes?: boolean
  creatorNotes: string
  systemPrompt: string
  postHistoryInstructions: string
  alternateGreetings: string[]
  tags: string[]
  creator: string
  characterVersion: string
  personality: string
  scenario: string
  firstMsgIndex: number
  loreSettings?: loreSettings
  loreExt?: any
  additionalData?: {
    tag?: string[]
    creator?: string
    character_version?: string
  }
  ttsMode?: string
  ttsSpeech?: string
  voicevoxConfig?: {
    speaker?: string
    SPEED_SCALE?: number
    PITCH_SCALE?: number
    INTONATION_SCALE?: number
    VOLUME_SCALE?: number
  }
  naittsConfig?: {
    customvoice?: boolean
    voice?: string
    version?: string
  }
  gptSoVitsConfig?: {
    url?: string
    use_auto_path?: boolean
    ref_audio_path?: string
    use_long_audio?: boolean
    ref_audio_data?: {
      fileName: string
      assetId: string
    }
    volume?: number
    text_lang?:
      | 'auto'
      | 'auto_yue'
      | 'en'
      | 'zh'
      | 'ja'
      | 'yue'
      | 'ko'
      | 'all_zh'
      | 'all_ja'
      | 'all_yue'
      | 'all_ko'
    text?: string
    use_prompt?: boolean
    prompt?: string | null
    prompt_lang?:
      | 'auto'
      | 'auto_yue'
      | 'en'
      | 'zh'
      | 'ja'
      | 'yue'
      | 'ko'
      | 'all_zh'
      | 'all_ja'
      | 'all_yue'
      | 'all_ko'
    top_p?: number
    temperature?: number
    speed?: number
    top_k?: number
    text_split_method?: 'cut0' | 'cut1' | 'cut2' | 'cut3' | 'cut4' | 'cut5'
  }
  fishSpeechConfig?: {
    model?: {
      _id: string
      title: string
      description: string
    }
    chunk_length: number
    normalize: boolean
  }
  supaMemory?: boolean
  additionalAssets?: [string, string, string][]
  ttsReadOnlyQuoted?: boolean
  replaceGlobalNote: string
  backgroundHTML?: string
  reloadKeys?: number
  backgroundCSS?: string
  license?: string
  private?: boolean
  additionalText: string
  oaiVoice?: string
  oaiTTSConfig?: {
    /** User opted into advanced OpenAI-compatible settings. When false/absent,
     *  tts.ts ignores the other fields and uses the legacy oaiVoice + db.openAIKey path. */
    enabled?: boolean
    /** Base URL, trailing slash trimmed at runtime. Falls back to 'https://api.openai.com/v1'. */
    baseURL?: string
    /** Per-character API key. Falls back to db.openAIKey; the Authorization header is omitted entirely when both are empty. */
    apiKey?: string
    /** Model ID. Falls back to 'tts-1'. */
    model?: string
    /** Freeform voice ID for custom endpoints. Falls back to character.oaiVoice, then to 'alloy'. */
    voice?: string
    /** Response format. Falls back to 'mp3'. */
    format?: 'mp3' | 'opus' | 'aac' | 'flac' | 'wav' | 'pcm'
  }
  virtualscript?: string
  scriptstate?: { [key: string]: string | number | boolean }
  depth_prompt?: { depth: number; prompt: string }
  extentions?: { [key: string]: any }
  largePortrait?: boolean
  lorePlus?: boolean
  inlayViewScreen?: boolean
  hfTTS?: {
    model: string
    language: string
  }
  vits?: OnnxModelFiles
  realmId?: string
  imported?: boolean
  trashTime?: number
  nickname?: string
  source?: string[]
  group_only_greetings?: string[]
  creation_date?: number
  modification_date?: number
  ccAssets?: Array<{
    type: string
    uri: string
    name: string
    ext: string
  }>
  defaultVariables?: string
  lowLevelAccess?: boolean
  hideChatIcon?: boolean
  lastInteraction?: number
  translatorNote?: string
  doNotChangeSeperateModels?: boolean
  escapeOutput?: boolean
  prebuiltAssetCommand?: boolean
  prebuiltAssetStyle?: string
  prebuiltAssetExclude?: string[]
  modules?: string[]
  coldstorage?: string
  coldStoragedChats?: string[]
}

export interface loreSettings {
  tokenBudget: number
  scanDepth: number
  recursiveScanning: boolean
  fullWordMatching?: boolean
}

export interface botPreset {
  id?: string
  name?: string
  apiType?: string
  openAIKey?: string
  localNetworkMode?: boolean
  localNetworkTimeoutSec?: number
  mainPrompt: string
  jailbreak: string
  globalNote: string
  temperature: number
  maxContext: number
  maxResponse: number
  frequencyPenalty: number
  PresensePenalty: number
  formatingOrder: FormatingOrderItem[]
  aiModel?: string
  subModel?: string
  currentPluginProvider?: string
  textgenWebUIStreamURL?: string
  textgenWebUIBlockingURL?: string
  forceReplaceUrl?: string
  forceReplaceUrl2?: string
  promptPreprocess: boolean
  bias: [string, number][]
  proxyRequestModel?: string
  openrouterRequestModel?: string
  proxyKey?: string
  ooba: OobaSettings
  ainconfig: AINsettings
  koboldURL?: string
  NAISettings?: NAISettings
  autoSuggestPrompt?: string
  autoSuggestPrefix?: string
  autoSuggestClean?: boolean
  promptTemplate?: PromptItem[]
  NAIadventure?: boolean
  NAIappendName?: boolean
  localStopStrings?: string[]
  customProxyRequestModel?: string
  reverseProxyOobaArgs?: OobaChatCompletionRequestParams
  top_p?: number
  promptSettings?: PromptSettings
  repetition_penalty?: number
  min_p?: number
  top_a?: number
  openrouterProvider?: {
    order: string[]
    only: string[]
    ignore: string[]
  }
  useInstructPrompt?: boolean
  customPromptTemplateToggle?: string
  templateDefaultVariables?: string
  moduleIntergration?: string
  top_k?: number
  instructChatTemplate?: string
  JinjaTemplate?: string
  jsonSchemaEnabled?: boolean
  jsonSchema?: string
  strictJsonSchema?: boolean
  extractJson?: string
  seperateParametersEnabled?: boolean
  seperateParameters?: {
    memory: SeparateParameters
    emotion: SeparateParameters
    translate: SeparateParameters
    otherAx: SeparateParameters
    overrides: Record<string, SeparateParameters>
  }
  customAPIFormat?: LLMFormat
  systemContentReplacement?: string
  systemRoleReplacement?: 'user' | 'assistant'
  enableCustomFlags?: boolean
  customFlags?: LLMFlags[]
  image?: string
  regex?: customscript[]
  reasonEffort?: number
  thinkingTokens?: number
  thinkingType?: 'off' | 'budget' | 'adaptive'
  deepseekThinkingType?: 'off' | 'enabled'
  adaptiveThinkingEffort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  deepseekReasoningEffort?: 'high' | 'max'
  outputImageModal?: boolean
  seperateModelsForAxModels?: boolean
  seperateModels?: {
    memory: string
    emotion: string
    translate: string
    otherAx: string
  }
  modelTools?: string[]
  fallbackModels?: {
    memory: string[]
    emotion: string[]
    translate: string[]
    otherAx: string[]
    model: string[]
  }
  fallbackWhenBlankResponse?: boolean
  verbosity?: number
  dynamicOutput?: DynamicOutput
}

interface hordeConfig {
  apiKey: string
  model: string
  softPrompt: string
}

export interface folder {
  name: string
  data: string[]
  color: string
  id: string
  imgFile?: string
  img?: string
}

interface sdConfig {
  width: number
  height: number
  sampler_name: string
  script_name: string
  denoising_strength: number
  enable_hr: boolean
  hr_scale: number
  hr_upscaler: string
}

export interface NAIImgConfig {
  width: number
  height: number
  sampler: string
  noise_schedule: string
  steps: number
  scale: number
  cfg_rescale: number
  sm: boolean
  sm_dyn: boolean
  noise: number
  strength: number
  image: string
  base64image: string
  InfoExtracted: number
  //add 4
  autoSmea: boolean
  use_coords: boolean
  legacy_uc: boolean
  v4_prompt: NAIImgConfigV4Prompt
  v4_negative_prompt: NAIImgConfigV4NegativePrompt
  //add vibe
  reference_image_multiple?: string[]
  reference_strength_multiple?: number[]
  vibe_data?: NAIVibeData
  vibe_model_selection?: string
  //add variety+ and decrisp options
  variety_plus: boolean
  decrisp: boolean
  //add character reference
  reference_mode: string
  character_image: string
  character_base64image: string
  style_aware: boolean
}

//add 4
interface NAIImgConfigV4Prompt {
  caption: NAIImgConfigV4Caption
  use_coords: boolean
  use_order: boolean
}
//add 4
interface NAIImgConfigV4NegativePrompt {
  caption: NAIImgConfigV4Caption
  legacy_uc: boolean
}
//add 4
interface NAIImgConfigV4Caption {
  base_caption: string
  char_captions: NAIImgConfigV4CharCaption[]
}
//add 4
interface NAIImgConfigV4CharCaption {
  char_caption: string
  centers: {
    x: number
    y: number
  }[]
}

// NAI Vibe Data interfaces
interface NAIVibeData {
  identifier: string
  version: number
  type: string
  image: string
  id: string
  encodings: {
    [key: string]: {
      [key: string]: NAIVibeEncoding
    }
  }
  name: string
  thumbnail: string
  createdAt: number
  importInfo: {
    model: string
    information_extracted: number
    strength: number
  }
}

interface NAIVibeEncoding {
  encoding: string
  params: {
    information_extracted: number
  }
}

interface ComfyConfig {
  workflow: string
  posNodeID: string
  posInputName: string
  negNodeID: string
  negInputName: string
  timeout: number
}

export type FormatingOrderItem =
  | 'main'
  | 'jailbreak'
  | 'chats'
  | 'lorebook'
  | 'globalNote'
  | 'authorNote'
  | 'lastChat'
  | 'description'
  | 'postEverything'
  | 'personaPrompt'

export interface Chat {
  message: Message[]
  note: string
  name: string
  localLore: loreBook[]
  generationSettings?: ChatGenerationSettings
  sdData?: string
  lastMemory?: string
  suggestMessages?: string[]
  isStreaming?: boolean
  scriptstate?: { [key: string]: string | number | boolean }
  modules?: string[]
  id?: string
  bindedPersona?: string
  fmIndex?: number
  hypaV3Data?: SerializableHypaV3Data
  folderId?: string
  lastDate?: number
  bookmarks?: string[]
  bookmarkNames?: { [chatId: string]: string }
}

export interface ChatFolder {
  id: string
  name?: string
  color?: string
  folded: boolean
}

export interface Message {
  role: 'user' | 'char'
  data: string
  saying?: string
  chatId?: string
  time?: number
  generationInfo?: MessageGenerationInfo
  promptInfo?: MessagePresetInfo
  name?: string
  otherUser?: boolean
  disabled?: false | true | 'allBefore'
  isComment?: boolean
}

export interface MessageGenerationInfo {
  model?: string
  generationId?: string
  inputTokens?: number
  outputTokens?: number
  maxContext?: number
  stageTiming?: {
    stage1?: number
    stage2?: number
    stage3?: number
    stage4?: number
  }
}

export interface MessagePresetInfo {
  promptName?: string
  promptToggles?: { key: string; value: string }[]
  promptText?: OpenAIChat[]
}

export interface PromptDiffPrefs {
  diffStyle: 'line' | 'intraline'
  formatStyle: 'raw' | 'card'
  viewStyle: 'unified' | 'split'
  isGrouped: boolean
  showOnlyChanges: boolean
  contextRadius: number
}

interface AINsettings {
  top_p: number
  rep_pen: number
  top_a: number
  rep_pen_slope: number
  rep_pen_range: number
  typical_p: number
  badwords: string
  stoptokens: string
  top_k: number
}

export interface OobaSettings {
  max_new_tokens: number
  do_sample: boolean
  temperature: number
  top_p: number
  typical_p: number
  repetition_penalty: number
  encoder_repetition_penalty: number
  top_k: number
  min_length: number
  no_repeat_ngram_size: number
  num_beams: number
  penalty_alpha: number
  length_penalty: number
  early_stopping: boolean
  seed: number
  add_bos_token: boolean
  truncation_length: number
  ban_eos_token: boolean
  skip_special_tokens: boolean
  top_a: number
  tfs: number
  epsilon_cutoff: number
  eta_cutoff: number
  formating: {
    header: string
    systemPrefix: string
    userPrefix: string
    assistantPrefix: string
    seperator: string
    useName: boolean
  }
}

export const saveImage = saveImageGlobal

export const defaultAIN: AINsettings = {
  top_p: 0.7,
  rep_pen: 1.0625,
  top_a: 0.08,
  rep_pen_slope: 1.7,
  rep_pen_range: 1024,
  typical_p: 1.0,
  badwords: '',
  stoptokens: '',
  top_k: 140,
}

export const defaultOoba: OobaSettings = {
  max_new_tokens: 180,
  do_sample: true,
  temperature: 0.7,
  top_p: 0.9,
  typical_p: 1,
  repetition_penalty: 1.15,
  encoder_repetition_penalty: 1,
  top_k: 20,
  min_length: 0,
  no_repeat_ngram_size: 0,
  num_beams: 1,
  penalty_alpha: 0,
  length_penalty: 1,
  early_stopping: false,
  seed: -1,
  add_bos_token: true,
  truncation_length: 4096,
  ban_eos_token: false,
  skip_special_tokens: true,
  top_a: 0,
  tfs: 1,
  epsilon_cutoff: 0,
  eta_cutoff: 0,
  formating: {
    header:
      'Below is an instruction that describes a task. Write a response that appropriately completes the request.',
    systemPrefix: '### Instruction:',
    userPrefix: '### Input:',
    assistantPrefix: '### Response:',
    seperator: '',
    useName: false,
  },
}

export const presetTemplate: botPreset = {
  name: 'New Preset',
  apiType: 'gemini-3-flash-preview',
  openAIKey: '',
  localNetworkMode: false,
  localNetworkTimeoutSec: 600,
  mainPrompt: defaultMainPrompt,
  jailbreak: defaultJailbreak,
  globalNote: '',
  temperature: 80,
  maxContext: 4000,
  maxResponse: 300,
  frequencyPenalty: 70,
  PresensePenalty: 70,
  formatingOrder: [
    'main',
    'description',
    'personaPrompt',
    'chats',
    'lastChat',
    'jailbreak',
    'lorebook',
    'globalNote',
    'authorNote',
  ],
  aiModel: 'gemini-3-flash-preview',
  subModel: 'gemini-3-flash-preview',
  currentPluginProvider: '',
  textgenWebUIStreamURL: '',
  textgenWebUIBlockingURL: '',
  forceReplaceUrl: '',
  forceReplaceUrl2: '',
  promptPreprocess: false,
  proxyKey: '',
  bias: [],
  ooba: safeStructuredClone(defaultOoba),
  ainconfig: safeStructuredClone(defaultAIN),
  reverseProxyOobaArgs: {
    mode: 'instruct',
  },
  top_p: 1,
  useInstructPrompt: false,
  verbosity: 1,
}

const defaultSdData: [string, string][] = [
  ['always', 'solo, 1girl'],
  ['negative', ''],
  ["|character\'s appearance", ''],
  ['current situation', ''],
  ["$character's pose", ''],
  ["$character's emotion", ''],
  ['current location', ''],
]

export const defaultSdDataFunc = () => {
  return safeStructuredClone(defaultSdData)
}

function saveCurrentPresetLocal() {
  let db = DBState.db
  normalizeBotPresetIds(db)
  let pres = db.botPresets

  if (db.botPresetsId === -1) {
    return null
  }
  pres[db.botPresetsId].id ??= createClientPresetId()
  const savedPreset: botPreset = {
    id: pres[db.botPresetsId].id,
    name: pres[db.botPresetsId].name,
    apiType: db.apiType,
    openAIKey: db.openAIKey,
    localNetworkMode: db.localNetworkMode,
    localNetworkTimeoutSec: db.localNetworkTimeoutSec,
    mainPrompt: db.mainPrompt,
    jailbreak: db.jailbreak,
    globalNote: db.globalNote,
    temperature: db.temperature,
    maxContext: db.maxContext,
    maxResponse: db.maxResponse,
    frequencyPenalty: db.frequencyPenalty,
    PresensePenalty: db.PresensePenalty,
    formatingOrder: db.formatingOrder,
    aiModel: db.aiModel,
    subModel: db.subModel,
    currentPluginProvider: db.currentPluginProvider,
    textgenWebUIStreamURL: db.textgenWebUIStreamURL,
    textgenWebUIBlockingURL: db.textgenWebUIBlockingURL,
    forceReplaceUrl: db.forceReplaceUrl,
    promptPreprocess: db.promptPreprocess,
    bias: db.bias,
    koboldURL: db.koboldURL,
    proxyKey: db.proxyKey,
    ooba: safeStructuredClone(db.ooba),
    ainconfig: safeStructuredClone(db.ainconfig),
    proxyRequestModel: db.proxyRequestModel,
    openrouterRequestModel: db.openrouterRequestModel,
    NAISettings: safeStructuredClone(db.NAIsettings),
    promptTemplate: db.promptTemplate ?? null,
    NAIadventure: db.NAIadventure ?? false,
    NAIappendName: db.NAIappendName ?? false,
    localStopStrings: db.localStopStrings,
    autoSuggestPrompt: db.autoSuggestPrompt,
    customProxyRequestModel: db.customProxyRequestModel,
    reverseProxyOobaArgs: safeStructuredClone(db.reverseProxyOobaArgs) ?? null,
    top_p: db.top_p ?? 1,
    promptSettings: safeStructuredClone(db.promptSettings) ?? null,
    repetition_penalty: db.repetition_penalty,
    min_p: db.min_p,
    top_a: db.top_a,
    openrouterProvider: db.openrouterProvider,
    useInstructPrompt: db.useInstructPrompt,
    customPromptTemplateToggle: db.customPromptTemplateToggle ?? '',
    templateDefaultVariables: db.templateDefaultVariables ?? '',
    moduleIntergration: db.moduleIntergration ?? '',
    top_k: db.top_k,
    instructChatTemplate: db.instructChatTemplate,
    JinjaTemplate: db.JinjaTemplate ?? '',
    jsonSchemaEnabled: db.jsonSchemaEnabled ?? false,
    jsonSchema: db.jsonSchema ?? '',
    strictJsonSchema: db.strictJsonSchema ?? true,
    extractJson: db.extractJson ?? '',
    seperateParametersEnabled: db.seperateParametersEnabled ?? false,
    seperateParameters: safeStructuredClone(db.seperateParameters),
    customAPIFormat: safeStructuredClone(db.customAPIFormat),
    systemContentReplacement: db.systemContentReplacement,
    systemRoleReplacement: db.systemRoleReplacement,
    customFlags: safeStructuredClone(db.customFlags),
    enableCustomFlags: db.enableCustomFlags,
    regex: db.presetRegex,
    image: pres?.[db.botPresetsId]?.image ?? '',
    reasonEffort: db.reasoningEffort ?? 0,
    thinkingTokens: db.thinkingTokens ?? null,
    thinkingType: db.thinkingType ?? 'budget',
    deepseekThinkingType: db.deepseekThinkingType ?? 'off',
    adaptiveThinkingEffort: db.adaptiveThinkingEffort ?? 'high',
    deepseekReasoningEffort: db.deepseekReasoningEffort ?? 'high',
    outputImageModal: db.outputImageModal ?? false,
    seperateModelsForAxModels: db.doNotChangeSeperateModels
      ? false
      : (db.seperateModelsForAxModels ?? false),
    seperateModels: db.doNotChangeSeperateModels ? null : safeStructuredClone(db.seperateModels),
    modelTools: safeStructuredClone(db.modelTools),
    fallbackModels: safeStructuredClone(db.fallbackModels),
    fallbackWhenBlankResponse: db.fallbackWhenBlankResponse ?? false,
    verbosity: db.verbosity ?? 1,
    dynamicOutput: db.dynamicOutput ?? null,
  }

  if (!Array.isArray(pres)) {
    pres = []
  }
  //if out of bounds, create a new preset
  if (db.botPresetsId >= pres.length) {
    pres.push(savedPreset)
  } else {
    pres[db.botPresetsId] = savedPreset
  }
  db.botPresets = pres
  return savedPreset
}

export function saveCurrentPreset() {
  withTrustedServerProjectionWrite(() => {
    const db = DBState.db
    const rollback = currentPresetRollbackSnapshot(db)
    const savedPreset = saveCurrentPresetLocal()
    if (!savedPreset?.id) return
    runPresetCommand(
      (baseRevision) =>
        updatePresetCommand({
          baseRevision,
          presetId: savedPreset.id!,
          patch: safeStructuredClone(savedPreset) as unknown as PresetSnapshot,
        }),
      () => restorePresetRollbackSnapshot(rollback),
    )
  })
}

export function copyPreset(id: number) {
  withTrustedServerProjectionWrite(() => {
    let db = DBState.db
    const rollback = currentPresetRollbackSnapshot(db)
    saveCurrentPresetLocal()
    normalizeBotPresetIds(db)
    let pres = db.botPresets
    const newPres = safeStructuredClone(pres[id])
    if (!newPres?.id) return
    const sourcePresetId = newPres.id
    newPres.id = createClientPresetId()
    newPres.name += ' Copy'
    db.botPresets.push(newPres)
    runPresetCommand(
      (baseRevision) =>
        copyPresetCommand({
          baseRevision,
          presetId: sourcePresetId,
          newPresetId: newPres.id,
          name: newPres.name,
          saveCurrent: true,
        }),
      () => restorePresetRollbackSnapshot(rollback),
    )
  })
}

export function changeToPreset(id = 0, savecurrent = true) {
  withTrustedServerProjectionWrite(() => {
    let db = DBState.db
    const rollback = currentPresetRollbackSnapshot(db, { includeSetPresetSettings: true })
    if (savecurrent) {
      saveCurrentPresetLocal()
    }
    normalizeBotPresetIds(db)
    let pres = db.botPresets
    const newPres = pres[id]
    const targetPresetId = newPres?.id
    db.botPresetsId = id
    if (newPres) {
      setPreset(db, newPres)
    }
    if (targetPresetId) {
      runPresetCommand(
        (baseRevision) =>
          selectPresetCommand({
            baseRevision,
            presetId: targetPresetId,
            apply: true,
            saveCurrent: savecurrent,
          }),
        () => restorePresetRollbackSnapshot(rollback),
      )
    }
  })
}

export function createPreset(preset: botPreset) {
  withTrustedServerProjectionWrite(() => {
    let db = DBState.db
    const rollback = currentPresetRollbackSnapshot(db)
    const newPreset = safeStructuredClone(preset)
    newPreset.id ??= createClientPresetId()
    db.botPresets.push(newPreset)
    db.botPresets = db.botPresets
    runPresetCommand(
      (baseRevision) =>
        createPresetCommand({
          baseRevision,
          preset: safeStructuredClone(newPreset) as unknown as PresetSnapshot,
        }),
      () => restorePresetRollbackSnapshot(rollback),
    )
  })
}

function addImportedPreset(preset: botPreset) {
  withTrustedServerProjectionWrite(() => {
    let db = DBState.db
    const rollback = currentPresetRollbackSnapshot(db)
    const newPreset = safeStructuredClone(preset)
    newPreset.id ??= createClientPresetId()
    db.botPresets.push(newPreset)
    db.botPresets = db.botPresets
    runPresetCommand(
      (baseRevision) =>
        importPresetCommand({
          baseRevision,
          preset: safeStructuredClone(newPreset) as unknown as PresetSnapshot,
        }),
      () => restorePresetRollbackSnapshot(rollback),
    )
  })
}

export function updatePreset(id: number, patch: Partial<botPreset>) {
  withTrustedServerProjectionWrite(() => {
    let db = DBState.db
    const rollback = currentPresetRollbackSnapshot(db)
    const presetId = db.botPresets[id]?.id
    if (!presetId) return
    Object.assign(db.botPresets[id], patch)
    runPresetCommand(
      (baseRevision) =>
        updatePresetCommand({
          baseRevision,
          presetId,
          patch: safeStructuredClone({ ...patch, id: presetId }) as PresetSnapshot,
        }),
      () => restorePresetRollbackSnapshot(rollback),
    )
  })
}

export function deletePreset(id: number, selectIndex = 0, apply = true) {
  withTrustedServerProjectionWrite(() => {
    let db = DBState.db
    const rollback = currentPresetRollbackSnapshot(db, { includeSetPresetSettings: apply })
    if (db.botPresets.length <= 1) return
    const presetId = db.botPresets[id]?.id
    const nextSelectedPreset =
      db.botPresets[selectIndex]?.id === presetId
        ? db.botPresets.find((preset) => preset.id !== presetId)
        : db.botPresets[selectIndex]
    const selectPresetId = nextSelectedPreset?.id
    if (!presetId) return
    let botPresets = db.botPresets
    botPresets.splice(id, 1)
    db.botPresets = botPresets
    const selectedIndex = selectPresetId
      ? db.botPresets.findIndex((preset) => preset.id === selectPresetId)
      : -1
    if (selectedIndex >= 0) {
      db.botPresetsId = selectedIndex
      if (apply) {
        setPreset(db, db.botPresets[selectedIndex])
      }
    } else if (db.botPresetsId >= db.botPresets.length) {
      db.botPresetsId = db.botPresets.length - 1
    }
    runPresetCommand(
      (baseRevision) =>
        deletePresetCommand({
          baseRevision,
          presetId,
          selectPresetId,
          apply,
          saveCurrent: false,
        }),
      () => restorePresetRollbackSnapshot(rollback),
    )
  })
}

export function reorderPresets(fromIndex: number, toIndex: number) {
  withTrustedServerProjectionWrite(() => {
    let db = DBState.db
    const rollback = currentPresetRollbackSnapshot(db)
    if (fromIndex === toIndex) return
    if (
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= db.botPresets.length ||
      toIndex > db.botPresets.length
    ) {
      return
    }

    let botPresets = [...db.botPresets]
    const movedItem = botPresets.splice(fromIndex, 1)[0]
    if (!movedItem) return

    const adjustedToIndex = fromIndex < toIndex ? toIndex - 1 : toIndex
    botPresets.splice(adjustedToIndex, 0, movedItem)

    const currentId = db.botPresetsId
    if (currentId === fromIndex) {
      db.botPresetsId = adjustedToIndex
    } else if (fromIndex < currentId && adjustedToIndex >= currentId) {
      db.botPresetsId = currentId - 1
    } else if (fromIndex > currentId && adjustedToIndex <= currentId) {
      db.botPresetsId = currentId + 1
    }

    db.botPresets = botPresets
    const presetIds = db.botPresets.map((preset) => preset.id).filter((id): id is string => !!id)
    runPresetCommand(
      (baseRevision) =>
        reorderPresetsCommand({
          baseRevision,
          presetIds,
        }),
      () => restorePresetRollbackSnapshot(rollback),
    )
  })
}

export function setPreset(db: Database, newPres: botPreset) {
  db.apiType = newPres.apiType ?? db.apiType
  db.localNetworkMode = newPres.localNetworkMode ?? db.localNetworkMode
  db.localNetworkTimeoutSec = newPres.localNetworkTimeoutSec ?? db.localNetworkTimeoutSec
  db.mainPrompt = newPres.mainPrompt ?? db.mainPrompt
  db.jailbreak = newPres.jailbreak ?? db.jailbreak
  db.globalNote = newPres.globalNote ?? db.globalNote
  db.temperature = newPres.temperature ?? db.temperature
  db.maxContext = newPres.maxContext ?? db.maxContext
  db.maxResponse = newPres.maxResponse ?? db.maxResponse
  db.frequencyPenalty = newPres.frequencyPenalty ?? db.frequencyPenalty
  db.PresensePenalty = newPres.PresensePenalty ?? db.PresensePenalty
  db.formatingOrder = newPres.formatingOrder ?? db.formatingOrder
  db.aiModel = newPres.aiModel ?? db.aiModel
  db.subModel = newPres.subModel ?? db.subModel
  db.currentPluginProvider = newPres.currentPluginProvider ?? db.currentPluginProvider
  db.textgenWebUIStreamURL = newPres.textgenWebUIStreamURL ?? db.textgenWebUIStreamURL
  db.textgenWebUIBlockingURL = newPres.textgenWebUIBlockingURL ?? db.textgenWebUIBlockingURL
  db.forceReplaceUrl = newPres.forceReplaceUrl ?? db.forceReplaceUrl
  db.promptPreprocess = newPres.promptPreprocess ?? db.promptPreprocess
  db.bias = newPres.bias ?? db.bias
  db.koboldURL = newPres.koboldURL ?? db.koboldURL
  db.proxyKey = newPres.proxyKey ?? db.proxyKey
  db.ooba = safeStructuredClone(newPres.ooba ?? db.ooba)
  db.ainconfig = safeStructuredClone(newPres.ainconfig ?? db.ainconfig)
  db.openrouterRequestModel = newPres.openrouterRequestModel ?? db.openrouterRequestModel
  db.proxyRequestModel = newPres.proxyRequestModel ?? db.proxyRequestModel
  db.NAIsettings = newPres.NAISettings ?? db.NAIsettings
  db.autoSuggestPrompt = newPres.autoSuggestPrompt ?? db.autoSuggestPrompt
  db.autoSuggestPrefix = newPres.autoSuggestPrefix ?? db.autoSuggestPrefix
  db.autoSuggestClean = newPres.autoSuggestClean ?? db.autoSuggestClean
  db.promptTemplate = newPres.promptTemplate
  db.NAIadventure = newPres.NAIadventure
  db.NAIappendName = newPres.NAIappendName
  db.NAIsettings.cfg_scale ??= 1
  db.NAIsettings.mirostat_tau ??= 0
  db.NAIsettings.mirostat_lr ??= 1
  db.localStopStrings = newPres.localStopStrings
  db.customProxyRequestModel = newPres.customProxyRequestModel ?? ''
  db.reverseProxyOobaArgs = safeStructuredClone(newPres.reverseProxyOobaArgs) ?? {
    mode: 'instruct',
  }
  db.top_p = newPres.top_p ?? 1
  db.promptSettings = safeStructuredClone(newPres.promptSettings) ?? {
    assistantPrefill: '',
    postEndInnerFormat: '',
    sendChatAsSystem: false,
    sendName: false,
    utilOverride: false,
  }
  db.promptSettings.maxThoughtTagDepth ??= -1
  db.repetition_penalty = newPres.repetition_penalty
  db.min_p = newPres.min_p
  db.top_a = newPres.top_a
  db.openrouterProvider = newPres.openrouterProvider
  db.useInstructPrompt = newPres.useInstructPrompt ?? false
  db.customPromptTemplateToggle = newPres.customPromptTemplateToggle ?? ''
  db.templateDefaultVariables = newPres.templateDefaultVariables ?? ''
  db.moduleIntergration = newPres.moduleIntergration ?? ''
  db.top_k = newPres.top_k ?? db.top_k
  db.instructChatTemplate = newPres.instructChatTemplate ?? db.instructChatTemplate
  db.JinjaTemplate = newPres.JinjaTemplate ?? db.JinjaTemplate
  db.jsonSchemaEnabled = newPres.jsonSchemaEnabled ?? false
  db.jsonSchema = newPres.jsonSchema ?? ''
  db.strictJsonSchema = newPres.strictJsonSchema ?? true
  db.extractJson = newPres.extractJson ?? ''
  db.seperateParametersEnabled = newPres.seperateParametersEnabled ?? false
  db.customAPIFormat = safeStructuredClone(newPres.customAPIFormat) ?? LLMFormat.OpenAICompatible
  db.systemContentReplacement = newPres.systemContentReplacement ?? ''
  db.systemRoleReplacement = newPres.systemRoleReplacement ?? 'user'
  db.customFlags = safeStructuredClone(newPres.customFlags) ?? []
  db.enableCustomFlags = newPres.enableCustomFlags ?? false
  db.presetRegex = newPres.regex ?? []
  db.reasoningEffort = newPres.reasonEffort ?? 0
  db.thinkingTokens = newPres.thinkingTokens ?? null
  db.thinkingType = newPres.thinkingType ?? 'budget'
  db.deepseekThinkingType = newPres.deepseekThinkingType ?? 'off'
  db.adaptiveThinkingEffort = newPres.adaptiveThinkingEffort ?? 'high'
  db.deepseekReasoningEffort = newPres.deepseekReasoningEffort ?? 'high'
  db.outputImageModal = newPres.outputImageModal ?? false
  if (!db.doNotChangeSeperateModels) {
    db.seperateModelsForAxModels = newPres.seperateModelsForAxModels ?? false
    db.seperateModels = safeStructuredClone(newPres.seperateModels) ?? {
      memory: '',
      emotion: '',
      translate: '',
      otherAx: '',
    }
  }
  if (!db.doNotChangeFallbackModels) {
    db.fallbackModels = safeStructuredClone(newPres.fallbackModels) ?? {
      memory: [],
      emotion: [],
      translate: [],
      otherAx: [],
      model: [],
    }
    db.fallbackWhenBlankResponse = newPres.fallbackWhenBlankResponse ?? false
  }
  if (db.disableSeperateParameterChangeOnPresetChange) {
    db.seperateParameters = safeStructuredClone(db.seperateParameters)
  } else {
    db.seperateParameters = newPres.seperateParameters
      ? safeStructuredClone(newPres.seperateParameters)
      : {
          memory: {},
          emotion: {},
          translate: {},
          otherAx: {},
          overrides: {},
        }
  }
  db.modelTools = safeStructuredClone(newPres.modelTools ?? [])
  db.verbosity = newPres.verbosity ?? 1
  db.dynamicOutput = newPres.dynamicOutput

  return db
}

import { encode as encodeMsgpack, decode as decodeMsgpack } from 'msgpackr/index-no-eval'
import * as fflate from 'fflate'
import type { OnnxModelFiles } from '../process/transformers'
import type { RisuModule } from '../process/modules'
import { decodeRPack, encodeRPack } from '../rpack/rpack_js'
import { DBState, selectedCharID } from '../stores.svelte'
import { LLMFlags, LLMFormat, LLMTokenizer } from '../model/modellist'
import type { HypaModel } from '../process/memory/hypamemory'
import type { SerializableHypaV3Data } from '../process/memory/hypav3'
import { defaultHotkeys, type Hotkey } from '../defaulthotkeys'
import type { OpenAIChat } from '../process/index.svelte'
import type { Loadout } from '../loadout'

export async function downloadPreset(id: number, type: 'json' | 'risupreset' | 'return' = 'json') {
  saveCurrentPreset()
  let db = getDatabase()
  let pres = safeStructuredClone(db.botPresets[id])
  pres.openAIKey = ''
  pres.forceReplaceUrl = ''
  pres.forceReplaceUrl2 = ''
  pres.proxyKey = ''
  pres.textgenWebUIStreamURL = ''
  pres.textgenWebUIBlockingURL = ''

  if (type === 'json') {
    downloadFile(pres.name + '_preset.json', Buffer.from(JSON.stringify(pres, null, 2)))
  } else if (type === 'risupreset' || type === 'return') {
    const buf = fflate.compressSync(
      encodeMsgpack({
        presetVersion: 2,
        type: 'preset',
        preset: await encryptBuffer(encodeMsgpack(pres), 'risupreset'),
      }),
    )

    const buf2 = await encodeRPack(buf)

    if (type === 'risupreset') {
      downloadFile(pres.name + '_preset.risup', buf2)
    } else {
      return {
        data: pres,
        buf: buf2,
      }
    }
  }

  alertNormal(language.successExport)

  return {
    data: pres,
    buf: null,
  }
}

export async function importPreset(
  f: {
    name: string
    data: Uint8Array
  } | null = null,
) {
  if (!f) {
    f = await selectSingleFile(['json', 'preset', 'risupreset', 'risup'])
  }
  if (!f) {
    return
  }
  let pre: any
  if (f.name.endsWith('.risupreset') || f.name.endsWith('.risup')) {
    let data = f.data
    if (f.name.endsWith('.risup')) {
      data = await decodeRPack(data)
    }
    const decoded = await decodeMsgpack(fflate.decompressSync(data))
    if ((decoded.presetVersion === 0 || decoded.presetVersion === 2) && decoded.type === 'preset') {
      pre = {
        ...presetTemplate,
        ...decodeMsgpack(
          Buffer.from(await decryptBuffer(decoded.preset ?? decoded.pres, 'risupreset')),
        ),
      }
    }
  } else {
    pre = { ...presetTemplate, ...JSON.parse(Buffer.from(f.data).toString('utf-8')) }
  }
  let db = DBState.db
  if (pre.presetVersion && pre.presetVersion >= 3) {
    //NAI preset
    const pr = safeStructuredClone(prebuiltPresets.NAI)
    pr.temperature = pre.parameters.temperature * 100
    pr.maxResponse = pre.parameters.max_length
    pr.NAISettings.topK = pre.parameters.top_k
    pr.NAISettings.topP = pre.parameters.top_p
    pr.NAISettings.topA = pre.parameters.top_a
    pr.NAISettings.typicalp = pre.parameters.typical_p
    pr.NAISettings.tailFreeSampling = pre.parameters.tail_free_sampling
    pr.NAISettings.repetitionPenalty = pre.parameters.repetition_penalty
    pr.NAISettings.repetitionPenaltyRange = pre.parameters.repetition_penalty_range
    pr.NAISettings.repetitionPenaltySlope = pre.parameters.repetition_penalty_slope
    pr.NAISettings.frequencyPenalty = pre.parameters.repetition_penalty_frequency
    pr.NAISettings.repostitionPenaltyPresence = pre.parameters.repetition_penalty_presence
    pr.PresensePenalty = pre.parameters.repetition_penalty_presence * 100
    pr.NAISettings.cfg_scale = pre.parameters.cfg_scale
    pr.NAISettings.mirostat_lr = pre.parameters.mirostat_lr
    pr.NAISettings.mirostat_tau = pre.parameters.mirostat_tau
    pr.name = pre.name ?? 'Imported'
    addImportedPreset(pr)
    return
  }

  if (Array.isArray(pre?.prompt_order?.[0]?.order) && Array.isArray(pre?.prompts)) {
    //ST preset
    const pr = safeStructuredClone(presetTemplate)
    pr.promptTemplate = []

    function findPrompt(identifier: number) {
      return pre.prompts.find((p: any) => p.identifier === identifier)
    }
    pr.temperature = (pre.temperature ?? 0.8) * 100
    pr.frequencyPenalty = (pre.frequency_penalty ?? 0.7) * 100
    pr.PresensePenalty = pre.presence_penalty * 0.7 * 100
    pr.top_p = pre.top_p ?? 1

    for (const prompt of pre.prompt_order[0].order) {
      if (!prompt?.enabled) {
        continue
      }
      const p = findPrompt(prompt?.identifier ?? '')
      if (p) {
        switch (p.identifier) {
          case 'main': {
            pr.promptTemplate.push({
              type: 'plain',
              type2: 'main',
              text: p.content ?? '',
              role: p.role ?? 'system',
            })
            break
          }
          case 'jailbreak':
          case 'nsfw': {
            pr.promptTemplate.push({
              type: 'jailbreak',
              type2: 'normal',
              text: p.content ?? '',
              role: p.role ?? 'system',
            })
            break
          }
          case 'dialogueExamples':
          case 'charPersonality':
          case 'scenario': {
            break //ignore
          }
          case 'chatHistory': {
            pr.promptTemplate.push({
              type: 'chat',
              rangeEnd: 'end',
              rangeStart: 0,
            })
            break
          }
          case 'worldInfoBefore': {
            pr.promptTemplate.push({
              type: 'lorebook',
            })
            break
          }
          case 'worldInfoAfter': {
            break
          }
          case 'charDescription': {
            pr.promptTemplate.push({
              type: 'description',
            })
            break
          }
          case 'personaDescription': {
            pr.promptTemplate.push({
              type: 'persona',
            })
            break
          }
          default: {
            pr.promptTemplate.push({
              type: 'plain',
              type2: 'normal',
              text: p.content ?? '',
              role: p.role ?? 'system',
            })
          }
        }
      }
    }
    if (pre?.assistant_prefill) {
      pr.promptTemplate.push({
        type: 'postEverything',
      })
      pr.promptTemplate.push({
        type: 'plain',
        type2: 'main',
        text: `{{#if {{prefill_supported}}}}${pre?.assistant_prefill}{{/if}}`,
        role: 'bot',
      })
    }
    pr.name = 'Imported ST Preset'
    addImportedPreset(pr)
    return
  }
  pre.name ??= 'Imported'
  if (!Array.isArray(db.botPresets)) {
    db.botPresets = []
  }
  addImportedPreset(pre)
}
