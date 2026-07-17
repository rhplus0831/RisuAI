import type { SettingItem } from './types'
import { updateHeightMode } from '../gui/heightMode'

export const advancedSettingsItems: SettingItem[] = [
  {
    type: 'header',
    id: 'adv.header',
    labelKey: 'advancedSettings',
    options: { level: 'h2' },
    classes: '!mb-0',
  },
  {
    type: 'header',
    id: 'adv.warn',
    labelKey: 'advancedSettingsWarn',
    options: { level: 'warning' },
  },

  // LoreBook Settings
  {
    id: 'adv.lbDepth',
    type: 'number',
    labelKey: 'loreBookDepth',
    bindKey: 'loreBookDepth',
    options: { min: 0, max: 20 },
    classes: 'mt-4 mb-2',
  },
  {
    id: 'adv.lbToken',
    type: 'number',
    labelKey: 'loreBookToken',
    bindKey: 'loreBookToken',
    options: { min: 0, max: 4096 },
  },

  // Prompts
  {
    id: 'adv.addPrompt',
    type: 'text',
    labelKey: 'additionalPrompt',
    bindKey: 'additionalPrompt',
    helpKey: 'additionalPrompt',
    classes: 'mt-4',
  },
  {
    id: 'adv.descPrefix',
    type: 'text',
    labelKey: 'descriptionPrefix',
    bindKey: 'descriptionPrefix',
  },
  {
    id: 'adv.emoPrompt',
    type: 'text',
    labelKey: 'emotionPrompt',
    bindKey: 'emotionPrompt2',
    helpKey: 'emotionPrompt',
    options: { placeholder: 'Leave it blank to use default' },
  },
  {
    id: 'adv.keiUrl',
    type: 'text',
    fallbackLabel: 'Kei Server URL',
    bindKey: 'keiServerURL',
    options: { placeholder: 'Leave it blank to use default' },
  },
  {
    id: 'adv.presetChain',
    type: 'text',
    labelKey: 'presetChain',
    bindKey: 'presetChain',
    helpKey: 'presetChain',
    options: { placeholder: 'Leave it blank to not use' },
  },

  // Request Settings
  {
    id: 'adv.retries',
    type: 'number',
    labelKey: 'requestretrys',
    bindKey: 'requestRetrys',
    helpKey: 'requestretrys',
    options: { min: 0, max: 20 },
  },
  {
    id: 'adv.genTime',
    type: 'number',
    labelKey: 'genTimes',
    bindKey: 'genTime',
    helpKey: 'genTimes',
    options: { min: 0, max: 4096 },
  },
  {
    id: 'adv.assetAlloc',
    type: 'number',
    labelKey: 'assetMaxDifference',
    bindKey: 'assetMaxDifference',
  },

  // Vision Quality
  {
    id: 'adv.visionQual',
    type: 'select',
    fallbackLabel: 'Vision Quality',
    bindKey: 'gptVisionQuality',
    helpKey: 'gptVisionQuality',
    options: {
      selectOptions: [
        { value: 'low', label: 'Low' },
        { value: 'high', label: 'High' },
      ],
    },
  },

  // Keep Session alive
  {
    id: 'adv.keepSessionAlive',
    type: 'select',
    labelKey: 'keepSessionAlive',
    bindKey: 'keepSessionAlive',
    helpKey: 'keepSessionAlive',
    options: {
      selectOptions: [
        { value: 'off', label: 'Off' },
        { value: 'sound', label: 'Via Sound' },
      ],
    },
  },

  // Height Mode
  {
    id: 'adv.heightMode',
    type: 'select',
    labelKey: 'heightMode',
    bindKey: 'heightMode',
    onChange: () => updateHeightMode(),
    options: {
      selectOptions: [
        { value: 'normal', label: 'Normal' },
        { value: 'percent', label: 'Percent' },
        { value: 'vh', label: 'VH' },
        { value: 'dvh', label: 'DVH' },
        { value: 'svh', label: 'SVH' },
        { value: 'lvh', label: 'LVH' },
      ],
    },
  },

  // Request Location (Non-Node)
  {
    id: 'adv.reqLoc',
    type: 'segmented',
    labelKey: 'requestLocation',
    bindKey: 'requestLocation',
    condition: () => false,
    options: {
      segmentOptions: [
        { value: '', label: 'Default' },
        { value: 'eu', label: 'EU (GDPR)' },
        { value: 'fedramp', label: 'US (FedRAMP)' },
      ],
    },
  },

  // Toggles
  {
    id: 'adv.sayNothing',
    type: 'check',
    labelKey: 'sayNothing',
    bindKey: 'useSayNothing',
    helpKey: 'sayNothing',
    classes: 'mt-4',
  },
  {
    id: 'adv.showUnrec',
    type: 'check',
    labelKey: 'showUnrecommended',
    bindKey: 'showUnrecommended',
    helpKey: 'showUnrecommended',
    classes: 'mt-4',
  },
  {
    id: 'adv.doNotWarnExternalServers',
    type: 'check',
    labelKey: 'doNotWarnExternalServers',
    bindKey: 'doNotWarnExternalServers',
    keywords: ['external', 'server', 'warning'],
    classes: 'mt-4',
  },
  {
    id: 'adv.imgComp',
    type: 'check',
    labelKey: 'imageCompression',
    bindKey: 'imageCompression',
    helpKey: 'imageCompression',
    classes: 'mt-4',
  },
  {
    id: 'adv.useExp',
    type: 'check',
    labelKey: 'useExperimental',
    bindKey: 'useExperimental',
    helpKey: 'useExperimental',
    classes: 'mt-4',
  },

  // Lorebook stubs (EXPERIMENTAL, Fastify-only).
  {
    id: 'adv.lorebookStubsWarn',
    type: 'header',
    fallbackLabel:
      'NOT RECOMMENDED — experimental. "Enable lorebook stubs" lazily loads each ' +
      "character's lorebook from the server instead of shipping it all up front. The " +
      'full client lorebook reader surface has NOT been validated against stubs, so ' +
      'lorebook entries may not appear or save correctly. Requires validation in the ' +
      'real app — leave this off unless you are testing it.',
    options: { level: 'warning' },
    classes: 'mt-4',
  },
  {
    id: 'adv.lorebookStubs',
    type: 'check',
    fallbackLabel: 'Enable lorebook stubs',
    bindKey: 'enableLorebookStubs',
    showExperimental: true,
  },
  {
    id: 'adv.legacyMedia',
    type: 'check',
    labelKey: 'legacyMediaFindings',
    bindKey: 'legacyMediaFindings',
    helpKey: 'legacyMediaFindings',
    classes: 'mt-4',
  },
  {
    id: 'adv.autoFill',
    type: 'check',
    labelKey: 'autoFillRequestURL',
    bindKey: 'autofillRequestUrl',
    helpKey: 'autoFillRequestURL',
    classes: 'mt-4',
  },
  {
    id: 'adv.remIncomp',
    type: 'check',
    labelKey: 'removeIncompleteResponse',
    bindKey: 'removeIncompleteResponse',
    classes: 'mt-4',
  },
  {
    id: 'adv.newOai',
    type: 'check',
    labelKey: 'newOAIHandle',
    bindKey: 'newOAIHandle',
    classes: 'mt-4',
  },
  {
    id: 'adv.noWaitTrans',
    type: 'check',
    labelKey: 'noWaitForTranslate',
    bindKey: 'noWaitForTranslate',
    classes: 'mt-4',
  },
  {
    id: 'adv.newImgBeta',
    type: 'check',
    labelKey: 'newImageHandlingBeta',
    bindKey: 'newImageHandlingBeta',
    classes: 'mt-4',
  },
  {
    id: 'adv.allowExt',
    type: 'check',
    fallbackLabel: 'Allow all in file select',
    bindKey: 'allowAllExtentionFiles',
    classes: 'mt-4',
  },
  {
    id: 'adv.dynamicModelRegistry',
    type: 'check',
    labelKey: 'dynamicModelRegistry',
    bindKey: 'dynamicModelRegistry',
    classes: 'mt-4',
  },
  {
    id: 'adv.disableSeperateParameterChangeOnPresetChange',
    type: 'check',
    labelKey: 'disableSeperateParameterChangeOnPresetChange',
    bindKey: 'disableSeperateParameterChangeOnPresetChange',
    classes: 'mt-4',
  },
  {
    id: 'adv.coldstorage',
    type: 'check',
    labelKey: 'coldStorage',
    bindKey: 'coldstorage',
    classes: 'mt-4',
    helpKey: 'coldstorage',
  },

  // Experimental Section (visible when useExperimental is true)
  {
    id: 'adv.exp.googleToken',
    type: 'check',
    labelKey: 'googleCloudTokenization',
    bindKey: 'googleClaudeTokenizing',
    condition: (ctx) => ctx.db.useExperimental,
    showExperimental: true,
    classes: 'mt-4',
  },
  {
    id: 'adv.exp.cachePoint',
    type: 'check',
    labelKey: 'automaticCachePoint',
    bindKey: 'automaticCachePoint',
    condition: (ctx) => ctx.db.useExperimental,
    helpKey: 'automaticCachePoint',
    showExperimental: true,
    classes: 'mt-4',
  },
  // Unrecommended Section
  {
    id: 'adv.cot',
    type: 'check',
    labelKey: 'cot',
    bindKey: 'chainOfThought',
    condition: (ctx) => ctx.db.showUnrecommended,
    helpKey: 'customChainOfThought',
    helpUnrecommended: true,
    classes: 'mt-4',
  },

  // More Toggles
  {
    id: 'adv.devTools',
    type: 'check',
    labelKey: 'enableDevTools',
    bindKey: 'enableDevTools',
    classes: 'mt-4',
  },
  {
    id: 'adv.scrollToActive',
    type: 'check',
    labelKey: 'enableScrollToActiveChar',
    bindKey: 'enableScrollToActiveChar',
    helpKey: 'enableScrollToActiveChar',
    classes: 'mt-4',
  },

  // Node Specific
  {
    id: 'adv.promptInfo',
    type: 'check',
    labelKey: 'promptInfoInsideChat',
    bindKey: 'promptInfoInsideChat',
    helpKey: 'promptInfoInsideChatDesc',
    classes: 'mt-4',
  },
  {
    id: 'adv.promptTextInfo',
    type: 'check',
    labelKey: 'promptTextInfoInsideChat',
    bindKey: 'promptTextInfoInsideChat',
    condition: (ctx) => ctx.db.promptInfoInsideChat,
    classes: 'mt-4',
  },
  {
    id: 'adv.remoteSave',
    type: 'check',
    labelKey: 'enableRemoteSaving',
    bindKey: 'enableRemoteSaving',
  },

  // Dynamic Assets & Others
  {
    id: 'adv.dynAssets',
    type: 'check',
    labelKey: 'dynamicAssets',
    bindKey: 'dynamicAssets',
    helpKey: 'dynamicAssets',
    classes: 'mt-4',
  },
  {
    id: 'adv.realmOpen',
    type: 'check',
    labelKey: 'realmDirectOpen',
    bindKey: 'realmDirectOpen',
    helpKey: 'realmDirectOpen',
    classes: 'mt-4',
  },
  {
    id: 'adv.cssErr',
    type: 'check',
    labelKey: 'returnCSSError',
    bindKey: 'returnCSSError',
    classes: 'mt-4',
  },
  {
    id: 'adv.claudeCache',
    type: 'check',
    labelKey: 'claude1HourCaching',
    bindKey: 'claude1HourCaching',
    classes: 'mt-4',
  },
  {
    id: 'adv.toolUsage',
    type: 'check',
    labelKey: 'rememberToolUsage',
    bindKey: 'rememberToolUsage',
    classes: 'mt-4',
  },
  {
    id: 'adv.bookmark',
    type: 'check',
    labelKey: 'bookmark',
    bindKey: 'enableBookmark',
    classes: 'mt-4',
  },
  {
    id: 'adv.simpleTool',
    type: 'check',
    labelKey: 'simplifiedToolUse',
    bindKey: 'simplifiedToolUse',
    classes: 'mt-4',
  },
  {
    id: 'adv.tokCache',
    type: 'check',
    labelKey: 'useTokenizerCaching',
    bindKey: 'useTokenizerCaching',
    classes: 'mt-4',
  },
  {
    id: 'adv.devMode',
    type: 'check',
    labelKey: 'pluginDevelopMode',
    bindKey: 'pluginDevelopMode',
    classes: 'mt-4',
  },
  {
    id: 'adv.pluginCompatibilityMode',
    type: 'check',
    labelKey: 'pluginCompatibilityMode',
    bindKey: 'pluginCompatibilityMode',
    helpKey: 'pluginCompatibilityMode',
    helpUnrecommended: true,
    classes: 'mt-4',
  },
  {
    id: 'adv.strictScriptCheck',
    type: 'check',
    labelKey: 'strictScriptCheck',
    bindKey: 'strictScriptCheck',
    helpKey: 'strictScriptCheck',
    keywords: ['lua', 'script', 'alertInput', 'alertSelect', 'alertConfirm'],
    classes: 'mt-4',
  },
  {
    id: 'adv.complexRegexCompatibilityMode',
    type: 'select',
    labelKey: 'complexRegexCompatibilityMode',
    bindKey: 'complexRegexCompatibilityMode',
    helpKey: 'complexRegexCompatibilityMode',
    helpUnrecommended: true,
    classes: 'mt-4',
    options: {
      selectOptions: [
        { value: 'strict', labelKey: 'complexRegexStrictMode' },
        { value: 'worker', labelKey: 'complexRegexWorkerMode' },
      ],
    },
  },
  {
    id: 'adv.complexRegexInputTimeoutMs',
    type: 'number',
    labelKey: 'complexRegexInputTimeoutMs',
    bindKey: 'complexRegexInputTimeoutMs',
    condition: (ctx) => ctx.db.complexRegexCompatibilityMode === 'worker',
    containerClasses: 'pl-7',
    options: { min: 0, max: 60000, step: 1000 },
  },
  {
    id: 'adv.complexRegexOutputTimeoutMs',
    type: 'number',
    labelKey: 'complexRegexOutputTimeoutMs',
    bindKey: 'complexRegexOutputTimeoutMs',
    condition: (ctx) => ctx.db.complexRegexCompatibilityMode === 'worker',
    containerClasses: 'pl-7',
    options: { min: 0, max: 60000, step: 1000 },
  },
  {
    id: 'adv.complexRegexDisplayTimeoutMs',
    type: 'number',
    labelKey: 'complexRegexDisplayTimeoutMs',
    bindKey: 'complexRegexDisplayTimeoutMs',
    condition: (ctx) => ctx.db.complexRegexCompatibilityMode === 'worker',
    containerClasses: 'pl-7',
    options: { min: 0, max: 60000, step: 1000 },
  },

  // More Experimental (Condition: useExperimental)
  {
    id: 'adv.exp.googleTrans',
    type: 'check',
    fallbackLabel: 'New Google Translate Experimental',
    bindKey: 'useExperimentalGoogleTranslator',
    condition: (ctx) => ctx.db.useExperimental,
    helpKey: 'unrecommended',
    helpUnrecommended: true,
    classes: 'mt-4',
  },
  // Dynamic Assets Edit (Condition: dynamicAssets)
  {
    id: 'adv.dynAssetsEdit',
    type: 'check',
    labelKey: 'dynamicAssetsEditDisplay',
    bindKey: 'dynamicAssetsEditDisplay',
    condition: (ctx) => ctx.db.dynamicAssets,
    helpKey: 'dynamicAssetsEditDisplay',
    classes: 'mt-4',
  },

  // Unrecommended Extra (Condition: showUnrecommended)
  {
    id: 'adv.plainFetch',
    type: 'check',
    labelKey: 'forcePlainFetch',
    bindKey: 'usePlainFetch',
    condition: (ctx) => ctx.db.showUnrecommended,
    helpKey: 'forcePlainFetch',
    helpUnrecommended: true,
    classes: 'mt-4',
  },
  {
    id: 'adv.depTrig',
    type: 'check',
    labelKey: 'showDeprecatedTriggerV1',
    bindKey: 'showDeprecatedTriggerV1',
    condition: (ctx) => ctx.db.showUnrecommended,
    helpKey: 'unrecommended',
    helpUnrecommended: true,
    classes: 'mt-4',
  },

  // Custom Components
  { type: 'custom', id: 'adv.banChar', componentId: 'BanCharacterSetSettings' },
  { type: 'custom', id: 'adv.customModels', componentId: 'CustomModelsSettings' },
  { type: 'custom', id: 'adv.export', componentId: 'SettingsExportButtons' },
]
