import type { FastifyInstance, FastifyReply } from 'fastify'
import type { DatabaseSync } from 'node:sqlite'
import type { AuthState } from '../auth.js'
import { COMMAND_EVENT_CATALOG, type CommandEventSink } from '../commands/events.js'
import { applyJsonCommandMutation, readBaseRevision } from '../commands/mutations.js'
import {
  applyPreset,
  createPresetRecord,
  ensureDatabaseObject,
  ensurePresetCollection,
  findPresetIndex,
  readJsonObject,
  readOptionalBoolean,
  readOptionalString,
  readPresetId,
  requirePresetIndex,
  saveCurrentPresetSnapshot,
  selectedPresetId,
  validateFullPresetIdList,
} from '../commands/presets.js'
import { requireAuth } from '../http.js'
import { EntityNotFoundError, RevisionMismatchError, ValidationError } from '../repository.js'

interface RuntimeSettingsCommandBody {
  baseRevision?: unknown
  patch?: unknown
}

interface PresetCommandBody {
  baseRevision?: unknown
  preset?: unknown
  patch?: unknown
  presetId?: unknown
  presetIds?: unknown
  apply?: unknown
  saveCurrent?: unknown
  name?: unknown
}

const SETTINGS_GROUPS = [
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

type SettingsGroup = (typeof SETTINGS_GROUPS)[number]
type SettingValueKind = 'boolean' | 'number' | 'string' | 'object' | 'array' | 'arrayOrNull' | 'json'

const SETTINGS_GROUP_KEYS: Record<SettingsGroup, readonly string[]> = {
  providers: [
    'apiType',
    'openAIKey',
    'proxyKey',
    'aiModel',
    'subModel',
    'textgenWebUIStreamURL',
    'textgenWebUIBlockingURL',
    'hordeConfig',
    'novelai',
    'claudeAPIKey',
    'openrouterRequestModel',
    'openrouterKey',
    'openrouterMiddleOut',
    'openrouterFallback',
    'openrouterProvider',
    'nanogptKey',
    'nanogptRequestModel',
    'nanogptRequestModelName',
    'nanogptProvider',
    'nanogptSubscriptionState',
    'nanogptUseSubscriptionEndpoint',
    'customProxyRequestModel',
    'customAPIFormat',
    'proxyRequestModel',
    'mancerHeader',
    'reverseProxyOobaMode',
    'reverseProxyOobaArgs',
    'koboldURL',
    'ooba',
    'ainconfig',
    'NAIsettings',
    'huggingfaceKey',
    'cohereAPIKey',
    'ollamaURL',
    'ollamaModel',
    'ollamaModelSource',
    'ollamaInputMode',
    'ollamaRequestFormat',
    'ollamaApiKey',
    'ollamaModelName',
    'ollamaCloudModel',
    'ollamaCloudModelName',
    'ollamaThinkingMode',
    'google',
    'mistralKey',
    'claudeAws',
    'claudeCachingExperimental',
    'claudeRetrivalCaching',
    'claude1HourCaching',
    'claudeBatching',
    'vertexPrivateKey',
    'vertexClientEmail',
    'vertexAccessToken',
    'vertexAccessTokenExpires',
    'vertexRegion',
    'OaiCompAPIKeys',
    'authRefreshes',
    'customModels',
    'dynamicModelRegistry',
    'modelTools',
    'currentPluginProvider',
    'forceReplaceUrl',
    'novellistAPI',
    'customTokenizer',
    'echoMessage',
    'echoDelay',
  ],
  runtime: [
    'useServerPromptAssembly',
    'useServerGeneration',
    'useStreaming',
    'streamGeminiThoughts',
    'maxContext',
    'maxResponse',
    'generationSeed',
    'temperature',
    'frequencyPenalty',
    'PresensePenalty',
    'top_p',
    'top_k',
    'min_p',
    'top_a',
    'repetition_penalty',
    'thinkingType',
    'deepseekThinkingType',
    'thinkingTokens',
    'adaptiveThinkingEffort',
    'deepseekReasoningEffort',
    'reasoningEffort',
    'verbosity',
    'fallbackModels',
    'doNotChangeFallbackModels',
    'fallbackWhenBlankResponse',
    'seperateModelsForAxModels',
    'seperateModels',
    'doNotChangeSeperateModels',
    'seperateParametersEnabled',
    'seperateParameters',
    'seperateParametersByModel',
    'disableSeperateParameterChangeOnPresetChange',
    'epEnabled',
    'requestRetrys',
    'genTime',
    'requestLocation',
    'localNetworkMode',
    'localNetworkTimeoutSec',
    'usePlainFetch',
    'antiServerOverloads',
    'antiClaudeOverload',
    'autoContinueChat',
    'autoContinueMinTokens',
    'removeIncompleteResponse',
    'localStopStrings',
    'newOAIHandle',
    'googleClaudeTokenizing',
    'automaticCachePoint',
    'chainOfThought',
    'rememberToolUsage',
    'simplifiedToolUse',
  ],
  display: [
    'theme',
    'guiHTML',
    'waifuWidth',
    'waifuWidth2',
    'textTheme',
    'customTextTheme',
    'font',
    'customFont',
    'zoomsize',
    'lineHeight',
    'iconsize',
    'textAreaSize',
    'textAreaTextSize',
    'sideBarSize',
    'assetWidth',
    'animationSpeed',
    'memoryLimitThickness',
    'settingsCloseButtonSize',
    'fullScreen',
    'showMemoryLimit',
    'showFirstMessagePages',
    'hideRealm',
    'hideAllImages',
    'showFolderName',
    'playMessage',
    'playMessageOnTranslateEnd',
    'roundIcons',
    'textScreenColor',
    'textBorder',
    'textScreenRounded',
    'textScreenBorder',
    'showSavingIcon',
    'showPromptComparison',
    'useChatCopy',
    'useAdditionalAssetsPreview',
    'useLegacyGUI',
    'hideApiKey',
    'unformatQuotes',
    'blockquoteStyling',
    'customQuotes',
    'customQuotesData',
    'betaMobileGUI',
    'menuSideBar',
    'useChatSticker',
    'customCSS',
    'customGUI',
    'colorScheme',
    'colorSchemeName',
    'customBackground',
    'classicMaxWidth',
    'heightMode',
  ],
  language: [
    'language',
    'translator',
    'translatorType',
    'translatorInputLanguage',
    'htmlTranslation',
    'autoTranslate',
    'combineTranslation',
    'legacyTranslation',
    'translateBeforeHTMLFormatting',
    'autoTranslateCachedOnly',
    'useAutoTranslateInput',
    'translatorPrompt',
    'translatorMaxResponse',
    'deeplOptions',
    'deeplXOptions',
    'noWaitForTranslate',
    'translateBeforeHTMLFormatting',
    'showTranslationLoading',
    'useExperimentalGoogleTranslator',
  ],
  media: [
    'sdProvider',
    'webUiUrl',
    'sdSteps',
    'sdCFG',
    'sdConfig',
    'NAIImgUrl',
    'NAIApiKey',
    'NAIImgModel',
    'NAII2I',
    'NAIREF',
    'NAIImgConfig',
    'gptVisionQuality',
    'imageCompression',
    'dynamicAssets',
    'dynamicAssetsEditDisplay',
    'newImageHandlingBeta',
    'legacyMediaFindings',
    'outputImageModal',
    'dallEQuality',
    'stabilityModel',
    'stabilityKey',
    'stabllityStyle',
    'comfyConfig',
    'comfyUiUrl',
    'falToken',
    'falModel',
    'falLora',
    'falLoraName',
    'falLoraScale',
    'ImagenModel',
    'ImagenImageSize',
    'ImagenAspectRatio',
    'ImagenPersonGeneration',
    'openaiCompatImage',
    'wavespeedImage',
    'elevenLabKey',
    'voicevoxUrl',
    'fishSpeechKey',
    'ttsAutoSpeech',
    'emotionProcesser',
  ],
  memory: [
    'supaMemoryKey',
    'hypaV3Key',
    'hypaMemoryKey',
    'voyageApiKey',
    'hypaModel',
    'removePunctuationHypa',
    'hypaV3',
    'hypaV3Settings',
    'hypaV3Presets',
    'hypaV3PresetId',
    'hypaCustomSettings',
    'showMenuHypaMemoryModal',
  ],
  advanced: [
    'loreBookDepth',
    'loreBookToken',
    'additionalPrompt',
    'descriptionPrefix',
    'emotionPrompt2',
    'keiServerURL',
    'presetChain',
    'assetMaxDifference',
    'keepSessionAlive',
    'useSayNothing',
    'showUnrecommended',
    'useExperimental',
    'forceProxyAsOpenAI',
    'autofillRequestUrl',
    'allowAllExtentionFiles',
    'coldstorage',
    'enableDevTools',
    'enableScrollToActiveChar',
    'promptInfoInsideChat',
    'promptTextInfoInsideChat',
    'enableRemoteSaving',
    'realmDirectOpen',
    'returnCSSError',
    'personaNote',
    'enableBookmark',
    'useTokenizerCaching',
    'auxModelUnderModelSettings',
    'pluginDevelopMode',
    'showDeprecatedTriggerV1',
    'showDeprecatedTriggerV2',
    'checkCorruption',
    'toggleConfirmRecommendedPreset',
    'banCharacterset',
    'bulkEnabling',
    'saveSignatures',
    'inlayErrorResponse',
  ],
  sidebar: [
    'askRemoval',
    'swipe',
    'instantRemove',
    'sendWithEnter',
    'fixedChatTextarea',
    'clickToEdit',
    'enableBlockPartialEdit',
    'longPressToPopupEditor',
    'enableDragPartialEdit',
    'botSettingAtStart',
    'showMenuChatList',
    'goCharacterOnImport',
    'sideMenuRerollButton',
    'requestInfoInsideChat',
    'localActivationInGlobalLorebook',
    'autoScrollToNewMessage',
    'alwaysScrollToNewMessage',
    'newMessageButtonStyle',
    'createFolderOnBranch',
    'hamburgerButtonBottom',
    'enableRisuaiProTools',
  ],
  account: ['account', 'didFirstSetup', 'username', 'localNetworkMode', 'localNetworkTimeoutSec'],
}

const BOOLEAN_SETTING_KEYS = new Set([
  'askRemoval',
  'autoContinueChat',
  'autoScrollToNewMessage',
  'autoTranslate',
  'autoTranslateCachedOnly',
  'autofillRequestUrl',
  'automaticCachePoint',
  'betaMobileGUI',
  'blockquoteStyling',
  'botSettingAtStart',
  'bulkEnabling',
  'chainOfThought',
  'checkCorruption',
  'cipherChat',
  'classicMaxWidth',
  'claude1HourCaching',
  'claudeAws',
  'claudeBatching',
  'claudeCachingExperimental',
  'claudeRetrivalCaching',
  'clickToEdit',
  'coldstorage',
  'combineTranslation',
  'createFolderOnBranch',
  'customQuotes',
  'disableSeperateParameterChangeOnPresetChange',
  'doNotChangeFallbackModels',
  'doNotChangeSeperateModels',
  'dynamicAssets',
  'dynamicAssetsEditDisplay',
  'dynamicModelRegistry',
  'epEnabled',
  'enableBlockPartialEdit',
  'enableBookmark',
  'enableCustomFlags',
  'enableDevTools',
  'enableDragPartialEdit',
  'enableRemoteSaving',
  'enableRisuaiProTools',
  'enableScrollToActiveChar',
  'fallbackWhenBlankResponse',
  'fixedChatTextarea',
  'forceProxyAsOpenAI',
  'fullScreen',
  'goCharacterOnImport',
  'googleClaudeTokenizing',
  'hamburgerButtonBottom',
  'hideAllImages',
  'hideApiKey',
  'hideRealm',
  'htmlTranslation',
  'hypaV3',
  'imageCompression',
  'inlayErrorResponse',
  'instantRemove',
  'legacyMediaFindings',
  'legacyTranslation',
  'localActivationInGlobalLorebook',
  'localNetworkMode',
  'longPressToPopupEditor',
  'NAIadventure',
  'NAIappendName',
  'NAII2I',
  'NAIREF',
  'nanogptUseSubscriptionEndpoint',
  'newImageHandlingBeta',
  'newOAIHandle',
  'noWaitForTranslate',
  'openrouterFallback',
  'openrouterMiddleOut',
  'outputImageModal',
  'personaNote',
  'playMessage',
  'playMessageOnTranslateEnd',
  'pluginDevelopMode',
  'promptInfoInsideChat',
  'promptTextInfoInsideChat',
  'realmDirectOpen',
  'rememberToolUsage',
  'removeIncompleteResponse',
  'removePunctuationHypa',
  'returnCSSError',
  'roundIcons',
  'saveSignatures',
  'seperateModelsForAxModels',
  'seperateParametersByModel',
  'seperateParametersEnabled',
  'showDeprecatedTriggerV1',
  'showDeprecatedTriggerV2',
  'showFirstMessagePages',
  'showFolderName',
  'showMemoryLimit',
  'showMenuChatList',
  'showMenuHypaMemoryModal',
  'showPromptComparison',
  'showSavingIcon',
  'showTranslationLoading',
  'showUnrecommended',
  'sideMenuRerollButton',
  'simplifiedToolUse',
  'strictJsonSchema',
  'swipe',
  'textBorder',
  'textScreenRounded',
  'toggleConfirmRecommendedPreset',
  'translateBeforeHTMLFormatting',
  'ttsAutoSpeech',
  'unformatQuotes',
  'useAdditionalAssetsPreview',
  'useAutoTranslateInput',
  'useChatCopy',
  'useChatSticker',
  'useExperimental',
  'useExperimentalGoogleTranslator',
  'useLegacyGUI',
  'usePlainFetch',
  'useSayNothing',
  'useServerGeneration',
  'useServerPromptAssembly',
  'useStreaming',
  'useTokenizerCaching',
])

const NUMBER_SETTING_KEYS = new Set([
  'animationSpeed',
  'assetMaxDifference',
  'assetWidth',
  'autoContinueMinTokens',
  'echoDelay',
  'falLoraScale',
  'frequencyPenalty',
  'genTime',
  'generationSeed',
  'iconsize',
  'lineHeight',
  'localNetworkTimeoutSec',
  'loreBookDepth',
  'loreBookToken',
  'maxContext',
  'maxResponse',
  'memoryLimitThickness',
  'PresensePenalty',
  'reasoningEffort',
  'repetition_penalty',
  'requestRetrys',
  'sdCFG',
  'sdSteps',
  'settingsCloseButtonSize',
  'sideBarSize',
  'temperature',
  'textAreaSize',
  'textAreaTextSize',
  'thinkingTokens',
  'top_a',
  'top_k',
  'top_p',
  'translatorMaxResponse',
  'verbosity',
  'vertexAccessTokenExpires',
  'waifuWidth',
  'waifuWidth2',
  'zoomsize',
])

const STRING_SETTING_KEYS = new Set([
  'additionalPrompt',
  'adaptiveThinkingEffort',
  'apiType',
  'autoSuggestPrompt',
  'autoSuggestPrefix',
  'claudeAPIKey',
  'cohereAPIKey',
  'customAPIFormat',
  'customBackground',
  'customCSS',
  'customFont',
  'customGUI',
  'customProxyRequestModel',
  'customTokenizer',
  'dallEQuality',
  'deepseekReasoningEffort',
  'deepseekThinkingType',
  'descriptionPrefix',
  'echoMessage',
  'emotionProcesser',
  'emotionPrompt2',
  'falLora',
  'falLoraName',
  'falModel',
  'falToken',
  'fishSpeechKey',
  'font',
  'forceReplaceUrl',
  'gptVisionQuality',
  'guiHTML',
  'heightMode',
  'hordeModel',
  'huggingfaceKey',
  'hypaMemoryKey',
  'hypaModel',
  'hypaV3Key',
  'ImagenAspectRatio',
  'ImagenImageSize',
  'ImagenModel',
  'ImagenPersonGeneration',
  'instructChatTemplate',
  'JinjaTemplate',
  'keepSessionAlive',
  'keiServerURL',
  'koboldURL',
  'language',
  'mancerHeader',
  'mistralKey',
  'nanogptKey',
  'nanogptProvider',
  'nanogptRequestModel',
  'nanogptRequestModelName',
  'nanogptSubscriptionState',
  'NAIApiKey',
  'NAIImgModel',
  'NAIImgUrl',
  'newMessageButtonStyle',
  'novellistAPI',
  'ollamaApiKey',
  'ollamaCloudModel',
  'ollamaCloudModelName',
  'ollamaInputMode',
  'ollamaModel',
  'ollamaModelName',
  'ollamaModelSource',
  'ollamaRequestFormat',
  'ollamaThinkingMode',
  'openAIKey',
  'openrouterKey',
  'openrouterRequestModel',
  'presetChain',
  'proxyKey',
  'proxyRequestModel',
  'requestLocation',
  'sdProvider',
  'stabllityStyle',
  'stabilityKey',
  'stabilityModel',
  'systemRoleReplacement',
  'textgenWebUIBlockingURL',
  'textgenWebUIStreamURL',
  'textScreenBorder',
  'textScreenColor',
  'textTheme',
  'theme',
  'thinkingType',
  'translator',
  'translatorInputLanguage',
  'translatorPrompt',
  'translatorType',
  'vertexAccessToken',
  'vertexClientEmail',
  'vertexPrivateKey',
  'vertexRegion',
  'voicevoxUrl',
  'voyageApiKey',
  'webUiUrl',
  'username',
])

const ARRAY_SETTING_KEYS = new Set([
  'authRefreshes',
  'banCharacterset',
  'customFlags',
  'customQuotesData',
  'customModels',
  'modelTools',
  'hypaV3Presets',
])

const ARRAY_OR_NULL_SETTING_KEYS = new Set(['localStopStrings'])

const OBJECT_SETTING_KEYS = new Set([
  'account',
  'ainconfig',
  'colorScheme',
  'comfyConfig',
  'customTextTheme',
  'deeplOptions',
  'deeplXOptions',
  'google',
  'hordeConfig',
  'hypaCustomSettings',
  'hypaV3Settings',
  'fallbackModels',
  'NAIImgConfig',
  'NAIsettings',
  'novelai',
  'OaiCompAPIKeys',
  'ooba',
  'openaiCompatImage',
  'openrouterProvider',
  'reverseProxyOobaArgs',
  'sdConfig',
  'seperateModels',
  'seperateParameters',
  'wavespeedImage',
])

const SETTINGS_GROUP_KEY_SETS = Object.fromEntries(
  Object.entries(SETTINGS_GROUP_KEYS).map(([group, keys]) => [group, new Set(keys)]),
) as Record<SettingsGroup, Set<string>>

export function registerCommandRoutes(
  app: FastifyInstance,
  db: DatabaseSync,
  authState: AuthState,
  dataDir: string,
  eventSink: CommandEventSink,
): void {
  app.patch('/api/v1/commands/settings/:group', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const group = readSettingsGroup((req.params as { group?: unknown }).group)
      const body = (req.body ?? {}) as RuntimeSettingsCommandBody
      const baseRevision = readBaseRevision(body)
      const patch = readSettingsGroupPatch(group, body.patch)
      const result = applyJsonCommandMutation({
        db,
        dataDir,
        baseRevision,
        eventSink,
        mutate(database) {
          applySettingsPatch(database, patch)
          return {
            event: COMMAND_EVENT_CATALOG.settingsUpdated,
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.post('/api/v1/commands/presets', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const body = (req.body ?? {}) as PresetCommandBody
      const baseRevision = readBaseRevision(body)
      const preset = createPresetRecord(readJsonObject(body.preset, 'preset'))
      const result = applyJsonCommandMutation<{ presetId: string }>({
        db,
        dataDir,
        baseRevision,
        eventSink,
        mutate(database) {
          const target = ensureDatabaseObject(database)
          const presets = ensurePresetCollection(target)
          if (findPresetIndex(presets, preset.id) !== -1) {
            throw new ValidationError(`Duplicate preset id: ${preset.id}`)
          }
          presets.push(preset)
          return {
            event: { ...COMMAND_EVENT_CATALOG.presetCreated, id: preset.id },
            extra: { presetId: preset.id },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.patch('/api/v1/commands/presets/:presetId', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const presetId = readPresetId((req.params as { presetId?: unknown }).presetId)
      const body = (req.body ?? {}) as PresetCommandBody
      const baseRevision = readBaseRevision(body)
      const patch = readJsonObject(body.patch, 'patch')
      if (Object.prototype.hasOwnProperty.call(patch, 'id') && patch.id !== presetId) {
        throw new ValidationError('patch.id must match presetId')
      }
      const result = applyJsonCommandMutation<{ presetId: string }>({
        db,
        dataDir,
        baseRevision,
        eventSink,
        mutate(database) {
          const target = ensureDatabaseObject(database)
          const presets = ensurePresetCollection(target)
          const index = requirePresetIndex(presets, presetId)
          presets[index] = {
            ...presets[index],
            ...patch,
            id: presetId,
          }
          return {
            event: { ...COMMAND_EVENT_CATALOG.presetUpdated, id: presetId },
            extra: { presetId },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.delete('/api/v1/commands/presets/:presetId', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const presetId = readPresetId((req.params as { presetId?: unknown }).presetId)
      const body = (req.body ?? {}) as PresetCommandBody
      const baseRevision = readBaseRevision(body)
      const selectPresetId =
        body.presetId === undefined ? undefined : readPresetId(body.presetId, 'presetId')
      const apply = readOptionalBoolean(body.apply, 'apply', false)
      const saveCurrent = readOptionalBoolean(body.saveCurrent, 'saveCurrent', false)
      const result = applyJsonCommandMutation<{ presetId: string; selectedPresetId: string | null }>({
        db,
        dataDir,
        baseRevision,
        eventSink,
        mutate(database) {
          const target = ensureDatabaseObject(database)
          const presets = ensurePresetCollection(target)
          if (presets.length <= 1) {
            throw new ValidationError('Cannot delete the only preset')
          }
          if (saveCurrent) {
            saveCurrentPresetSnapshot(target, presets)
          }
          const deletedIndex = requirePresetIndex(presets, presetId)
          const currentSelectedId = selectedPresetId(target, presets)
          const deletedWasSelected = currentSelectedId === presetId
          presets.splice(deletedIndex, 1)

          let nextSelectedId = selectPresetId
          if (!nextSelectedId && deletedWasSelected) {
            nextSelectedId = presets[0]?.id
          } else if (!nextSelectedId) {
            nextSelectedId = currentSelectedId ?? presets[0]?.id
          }

          const selectedIndex = nextSelectedId ? requirePresetIndex(presets, nextSelectedId) : -1
          target.botPresetsId = selectedIndex
          if (apply && selectedIndex >= 0) {
            applyPreset(target, presets[selectedIndex])
          }

          return {
            event: { ...COMMAND_EVENT_CATALOG.presetDeleted, id: presetId },
            extra: {
              presetId,
              selectedPresetId: selectedIndex >= 0 ? presets[selectedIndex].id : null,
            },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.post('/api/v1/commands/presets/:presetId/copy', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const presetId = readPresetId((req.params as { presetId?: unknown }).presetId)
      const body = (req.body ?? {}) as PresetCommandBody
      const baseRevision = readBaseRevision(body)
      const name = readOptionalString(body.name, 'name')
      const saveCurrent = readOptionalBoolean(body.saveCurrent, 'saveCurrent', false)
      const result = applyJsonCommandMutation<{ presetId: string; sourcePresetId: string }>({
        db,
        dataDir,
        baseRevision,
        eventSink,
        mutate(database) {
          const target = ensureDatabaseObject(database)
          const presets = ensurePresetCollection(target)
          if (saveCurrent) {
            saveCurrentPresetSnapshot(target, presets)
          }
          const index = requirePresetIndex(presets, presetId)
          const copy = createPresetRecord({
            ...presets[index],
            id: undefined,
            name: name ?? `${presets[index].name ?? 'Preset'} Copy`,
          })
          presets.push(copy)
          return {
            event: { ...COMMAND_EVENT_CATALOG.presetCopied, id: copy.id },
            extra: { presetId: copy.id, sourcePresetId: presetId },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.post('/api/v1/commands/presets/select', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const body = (req.body ?? {}) as PresetCommandBody
      const baseRevision = readBaseRevision(body)
      const presetId = readPresetId(body.presetId, 'presetId')
      const apply = readOptionalBoolean(body.apply, 'apply', true)
      const saveCurrent = readOptionalBoolean(body.saveCurrent, 'saveCurrent', true)
      const result = applyJsonCommandMutation<{ presetId: string }>({
        db,
        dataDir,
        baseRevision,
        eventSink,
        mutate(database) {
          const target = ensureDatabaseObject(database)
          const presets = ensurePresetCollection(target)
          if (saveCurrent) {
            saveCurrentPresetSnapshot(target, presets)
          }
          const index = requirePresetIndex(presets, presetId)
          target.botPresetsId = index
          if (apply) {
            applyPreset(target, presets[index])
          }
          return {
            event: { ...COMMAND_EVENT_CATALOG.presetSelected, id: presetId },
            extra: { presetId },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.post('/api/v1/commands/presets/import', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const body = (req.body ?? {}) as PresetCommandBody
      const baseRevision = readBaseRevision(body)
      const preset = createPresetRecord(readJsonObject(body.preset, 'preset'), 'Imported')
      const result = applyJsonCommandMutation<{ presetId: string }>({
        db,
        dataDir,
        baseRevision,
        eventSink,
        mutate(database) {
          const target = ensureDatabaseObject(database)
          const presets = ensurePresetCollection(target)
          if (findPresetIndex(presets, preset.id) !== -1) {
            throw new ValidationError(`Duplicate preset id: ${preset.id}`)
          }
          presets.push(preset)
          return {
            event: { ...COMMAND_EVENT_CATALOG.presetImported, id: preset.id },
            extra: { presetId: preset.id },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })

  app.post('/api/v1/commands/presets/reorder', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const body = (req.body ?? {}) as PresetCommandBody
      const baseRevision = readBaseRevision(body)
      if (!Array.isArray(body.presetIds)) {
        throw new ValidationError('presetIds must be an array')
      }
      const presetIds = body.presetIds
      const result = applyJsonCommandMutation<{ selectedPresetId: string | null }>({
        db,
        dataDir,
        baseRevision,
        eventSink,
        mutate(database) {
          const target = ensureDatabaseObject(database)
          const presets = ensurePresetCollection(target)
          const currentSelectedId = selectedPresetId(target, presets)
          validateFullPresetIdList(presets, presetIds)
          const byId = new Map(presets.map((preset) => [preset.id, preset]))
          const reordered = presetIds.map((id) => byId.get(id)!)
          target.botPresets = reordered
          target.botPresetsId = currentSelectedId
            ? requirePresetIndex(reordered, currentSelectedId)
            : reordered.length > 0
              ? 0
              : -1
          return {
            event: COMMAND_EVENT_CATALOG.presetReordered,
            extra: { selectedPresetId: selectedPresetId(target, reordered) },
          }
        },
      })

      return {
        revision: result.revision,
        event: result.event,
        ...result.extra,
      }
    } catch (err) {
      return sendCommandError(reply, err)
    }
  })
}

function readSettingsGroup(group: unknown): SettingsGroup {
  if (typeof group !== 'string' || !SETTINGS_GROUPS.includes(group as SettingsGroup)) {
    throw new ValidationError(`Unsupported settings group: ${String(group)}`)
  }
  return group as SettingsGroup
}

function readSettingsGroupPatch(group: SettingsGroup, patch: unknown): Record<string, unknown> {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new ValidationError('patch must be an object')
  }

  const entries = Object.entries(patch as Record<string, unknown>)
  if (entries.length === 0) {
    throw new ValidationError('patch must include at least one setting')
  }

  for (const [key, value] of entries) {
    if (!SETTINGS_GROUP_KEY_SETS[group].has(key)) {
      throw new ValidationError(`Unsupported ${group} setting: ${key}`)
    }
    validateSettingValue(key, value)
  }

  return patch as Record<string, unknown>
}

function validateSettingValue(key: string, value: unknown): void {
  const kind = settingValueKind(key)
  if (kind === 'json') {
    validateJsonValue(key, value)
    return
  }
  if (kind === 'boolean' && typeof value !== 'boolean') {
    throw new ValidationError(`${key} must be a boolean`)
  }
  if (kind === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) {
    throw new ValidationError(`${key} must be a finite number`)
  }
  if (kind === 'string' && typeof value !== 'string') {
    throw new ValidationError(`${key} must be a string`)
  }
  if (kind === 'object' && (!value || typeof value !== 'object' || Array.isArray(value))) {
    throw new ValidationError(`${key} must be an object`)
  }
  if (kind === 'array' && !Array.isArray(value)) {
    throw new ValidationError(`${key} must be an array`)
  }
  if (kind === 'arrayOrNull' && value !== null && !Array.isArray(value)) {
    throw new ValidationError(`${key} must be an array or null`)
  }
  validateJsonValue(key, value)
}

function settingValueKind(key: string): SettingValueKind {
  if (BOOLEAN_SETTING_KEYS.has(key)) return 'boolean'
  if (NUMBER_SETTING_KEYS.has(key)) return 'number'
  if (STRING_SETTING_KEYS.has(key)) return 'string'
  if (OBJECT_SETTING_KEYS.has(key)) return 'object'
  if (ARRAY_SETTING_KEYS.has(key)) return 'array'
  if (ARRAY_OR_NULL_SETTING_KEYS.has(key)) return 'arrayOrNull'
  return 'json'
}

function validateJsonValue(key: string, value: unknown): void {
  try {
    JSON.stringify(value)
  } catch {
    throw new ValidationError(`${key} must be JSON-serializable`)
  }
  if (value === undefined) {
    throw new ValidationError(`${key} must be JSON-serializable`)
  }
}

function applySettingsPatch(database: unknown, patch: Record<string, unknown>): void {
  if (!database || typeof database !== 'object' || Array.isArray(database)) {
    throw new ValidationError('database must be an object before settings commands can run')
  }

  const target = database as Record<string, unknown>
  for (const [key, value] of Object.entries(patch)) {
    target[key] = value
  }
}

function sendCommandError(
  reply: FastifyReply,
  err: unknown,
): { error: string; currentRevision?: number } {
  if (err instanceof RevisionMismatchError) {
    reply.code(409)
    return { error: 'revision_conflict', currentRevision: err.currentRevision }
  }
  if (err instanceof ValidationError) {
    reply.code(400)
    return { error: err.message }
  }
  if (err instanceof EntityNotFoundError) {
    reply.code(404)
    return { error: err.message }
  }
  throw err
}
