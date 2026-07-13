<script lang="ts">
  import Check from 'src/lib/UI/GUI/CheckInput.svelte'
  import { language } from 'src/lang'
  import Help from 'src/lib/Others/Help.svelte'

  import { customProviderStore } from 'src/ts/plugins/plugins.svelte'
  import { downloadFile } from 'src/ts/globalApi.svelte'
  import { tokenizeAccurate, tokenizerList } from 'src/ts/tokenizer'
  import DropList from 'src/lib/SideBars/DropList.svelte'
  import { PlusIcon, TrashIcon, HardDriveUploadIcon, DownloadIcon, UploadIcon } from '@lucide/svelte'
  import TextInput from 'src/lib/UI/GUI/TextInput.svelte'
  import NumberInput from 'src/lib/UI/GUI/NumberInput.svelte'
  import SliderInput from 'src/lib/UI/GUI/SliderInput.svelte'
  import TextAreaInput from 'src/lib/UI/GUI/TextAreaInput.svelte'
  import Button from 'src/lib/UI/GUI/Button.svelte'
  import SelectInput from 'src/lib/UI/GUI/SelectInput.svelte'
  import OptionInput from 'src/lib/UI/GUI/OptionInput.svelte'
  import CheckInput from 'src/lib/UI/GUI/CheckInput.svelte'
  import SegmentedControl from 'src/lib/UI/GUI/SegmentedControl.svelte'
  import { getOpenRouterModels, toModelGridItem as orToGridItem } from 'src/ts/model/openrouter'
  import { getNanoGPTModels, getNanoGPTSubscriptionModels, toModelGridItem as ngToGridItem } from 'src/ts/model/nanogpt'
  import { getOllamaModels } from 'src/ts/model/ollama'
  import ModelGrid from 'src/lib/UI/ModelGrid.svelte'
  import NanoGPTDashboard from 'src/lib/UI/NanoGPTDashboard.svelte'
  import NanoGPTProviderPicker from 'src/lib/UI/NanoGPTProviderPicker.svelte'
  import type { ModelGridPinnedItem } from 'src/ts/model/modelGrid'
  import OobaSettings from './OobaSettings.svelte'
  import Accordion from 'src/lib/UI/Accordion.svelte'
  import OpenrouterSettings from './OpenrouterSettings.svelte'
  import ChatFormatSettings from './ChatFormatSettings.svelte'
  import PromptSettings from './PromptSettings.svelte'
  import { openPresetListModal } from 'src/ts/stores.svelte'
  import { selectSingleFile } from 'src/ts/util'
  import { getDatabase, updatePromptPreset, type PromptPreset } from 'src/ts/storage/database.svelte'
  import { alertError } from 'src/ts/alert'
  import { getModelInfo, LLMFlags, LLMFormat } from 'src/ts/model/modellist'
  import { resolveModelProfileUiState } from 'src/ts/model/modelProfileUiState'
  import RegexList from 'src/lib/SideBars/Scripts/RegexList.svelte'
  import SettingRenderer from '../SettingRenderer.svelte'
  import { allBasicParameterItems } from 'src/ts/setting/botSettingsParamsData'
  import SeparateParametersSection from './SeparateParametersSection.svelte'
  import ModelRoleList from './Model/ModelRoleList.svelte'
  import ModelSettingsShell from './Model/ModelSettingsShell.svelte'
  import { onDestroy, onMount, untrack } from 'svelte'
  import { createServerBackedSettingDraft, watchServerBackedSettings } from 'src/ts/server/settingsBridge.svelte'
  import { getServerResourceApplyEpoch, withTrustedResourceWrite } from 'src/ts/server/resourceWriteGuard.svelte'
  import {
    canUseServerCommands,
    enablePromptItemsCommand,
    patchPromptSettingsCommand,
    runServerCommand,
    type SettingsPatch,
  } from 'src/ts/server/commands'
  import {
    currentPluginWatchSuppressionVersion,
    currentPluginStateSnapshot,
    dispatchSelectPluginProvider,
  } from 'src/ts/pluginCommands'
  import {
    currentPromptTemplateOwnerId,
    ensurePromptTemplateHydrated,
    isPromptTemplateHydrated,
    promptTemplateHydratedStore,
  } from 'src/ts/server/promptTemplateHydration'
  import { mirrorTopLevelPresetField } from 'src/ts/presetFieldMirror'
  import {
    createPromptPresetModelOverrideDraft,
    promptPresetModelOverrideEnabled,
    setPromptPresetModelOverrideEnabled,
  } from 'src/ts/promptPresetModelOverrides.svelte'
  import { promptPresetModelOverrideFieldForDatabaseKey, resolvePromptPresetRegexField } from 'src/ts/presetSplit'
  import {
    capturePromptItemOptimisticAcknowledgement,
    capturePromptTemplateOwnerMutationFence,
    promptTemplateOwnerCommandId,
    runPromptTemplateOwnerCommand,
    runPromptTemplateOwnerRollback,
  } from 'src/ts/server/promptTemplateBridge.svelte'
  import {
    beginPromptPresetIconUpload,
    capturePromptPresetIconUploadTarget,
    clearPromptPresetIconUpload,
    isFreshPromptPresetIconUpload,
    resolveFreshPromptPresetIconUploadIndex,
    type PromptPresetIconUploadOperation,
  } from 'src/ts/server/promptPresetIconUpload'
  import {
    beginBiasImport,
    captureBiasImportTarget,
    clearBiasImport,
    isFreshBiasImport,
    parseBiasImport,
    resolveFreshBiasImportValue,
    type BiasImportOperation,
  } from 'src/ts/server/biasImport'

  const stopServerSettingsWatch = watchServerBackedSettings(['proxyRequestModel', 'useLegacyGUI'])
  onDestroy(stopServerSettingsWatch)
  const pendingPromptFieldPatch = {
    patch: {} as SettingsPatch,
    previous: {} as SettingsPatch,
    attempted: {} as SettingsPatch,
    timer: null as ReturnType<typeof setTimeout> | null,
  }
  const PROMPT_SETTINGS_COMMAND_KEYS = new Set<string>([
    'mainPrompt',
    'jailbreak',
    'globalNote',
    'formatingOrder',
    'promptPreprocess',
    'presetRegex',
    'promptSettings',
    'jsonSchemaEnabled',
    'jsonSchema',
    'strictJsonSchema',
    'extractJson',
    'customPromptTemplateToggle',
    'templateDefaultVariables',
    'OAIPrediction',
    'autoSuggestPrompt',
    'systemContentReplacement',
    'systemRoleReplacement',
    'outputImageModal',
    'fallbackModels',
    'fallbackWhenBlankResponse',
    'doNotChangeFallbackModels',
  ])
  const oobaDraft = createServerBackedSettingDraft<Record<string, any>>('ooba', { formating: {} })
  const promptOobaDraft = createPromptPresetModelOverrideDraft<Record<string, any>>('ooba', { formating: {} })
  const localStopStringsDraft = createServerBackedSettingDraft<string[] | null>('localStopStrings', null)
  const promptLocalStopStringsDraft = createPromptPresetModelOverrideDraft<string[] | null>('localStopStrings', null)
  const NAIsettingsDraft = createServerBackedSettingDraft<Record<string, any>>('NAIsettings', {})
  const promptNAIsettingsDraft = createPromptPresetModelOverrideDraft<Record<string, any>>('NAIsettings', {})
  const ainconfigDraft = createServerBackedSettingDraft<Record<string, any>>('ainconfig', {})
  const promptAinconfigDraft = createPromptPresetModelOverrideDraft<Record<string, any>>('ainconfig', {})
  const biasDraft = createPromptFieldDraft<Array<[string, number]>>('bias', [])
  const additionalParamsDraft = createServerBackedSettingDraft<Array<[string, string]>>('additionalParams', [])
  const promptAdditionalParamsDraft = createPromptPresetModelOverrideDraft<Array<[string, string]>>(
    'additionalParams',
    [],
  )
  const googleDraft = createServerBackedSettingDraft<Record<string, string>>('google', {
    accessToken: '',
    projectId: '',
  })
  const vertexClientEmailDraft = createServerBackedSettingDraft<string>('vertexClientEmail', '')
  const vertexPrivateKeyDraft = createServerBackedSettingDraft<string>('vertexPrivateKey', '')
  const vertexAccessTokenDraft = createServerBackedSettingDraft<string>('vertexAccessToken', '')
  const vertexAccessTokenExpiresDraft = createServerBackedSettingDraft<number>('vertexAccessTokenExpires', 0)
  const vertexRegionDraft = createServerBackedSettingDraft<string>('vertexRegion', 'global')
  const novellistAPIDraft = createServerBackedSettingDraft<string>('novellistAPI', '')
  const mancerHeaderDraft = createServerBackedSettingDraft<string>('mancerHeader', '')
  const claudeAPIKeyDraft = createServerBackedSettingDraft<string>('claudeAPIKey', '')
  const mistralKeyDraft = createServerBackedSettingDraft<string>('mistralKey', '')
  const novelaiDraft = createServerBackedSettingDraft<Record<string, string>>('novelai', {
    token: '',
    model: '',
  })
  const forceReplaceUrlDraft = createServerBackedSettingDraft<string>('forceReplaceUrl', '')
  const proxyKeyDraft = createServerBackedSettingDraft<string>('proxyKey', '')
  const customProxyRequestModelDraft = createServerBackedSettingDraft<string>('customProxyRequestModel', '')
  const customAPIFormatDraft = createServerBackedSettingDraft<LLMFormat>('customAPIFormat', LLMFormat.OpenAICompatible)
  const cohereAPIKeyDraft = createServerBackedSettingDraft<string>('cohereAPIKey', '')
  const ollamaURLDraft = createServerBackedSettingDraft<string>('ollamaURL', '')
  const ollamaInputModeDraft = createServerBackedSettingDraft<'list' | 'manual'>('ollamaInputMode', 'list')
  const ollamaCloudModelDraft = createServerBackedSettingDraft<string>('ollamaCloudModel', '')
  const ollamaModelSourceDraft = createServerBackedSettingDraft<'local' | 'cloud'>('ollamaModelSource', 'local')
  const ollamaCloudModelNameDraft = createServerBackedSettingDraft<string>('ollamaCloudModelName', '')
  const ollamaApiKeyDraft = createServerBackedSettingDraft<string>('ollamaApiKey', '')
  const ollamaRequestFormatDraft = createServerBackedSettingDraft<LLMFormat>('ollamaRequestFormat', LLMFormat.Ollama)
  const ollamaModelDraft = createServerBackedSettingDraft<string>('ollamaModel', '')
  const ollamaModelNameDraft = createServerBackedSettingDraft<string>('ollamaModelName', '')
  const ollamaThinkingModeDraft = createServerBackedSettingDraft<'auto' | 'off' | 'on' | 'low' | 'medium' | 'high'>(
    'ollamaThinkingMode',
    'auto',
  )
  const useStreamingDraft = createServerBackedSettingDraft<boolean>('useStreaming', false)
  const streamGeminiThoughtsDraft = createServerBackedSettingDraft<boolean>('streamGeminiThoughts', false)
  const nanogptKeyDraft = createServerBackedSettingDraft<string>('nanogptKey', '')
  const nanogptUseSubscriptionEndpointDraft = createServerBackedSettingDraft<boolean>(
    'nanogptUseSubscriptionEndpoint',
    false,
  )
  const nanogptSubscriptionStateDraft = createServerBackedSettingDraft<string>('nanogptSubscriptionState', '')
  const nanogptRequestModelDraft = createServerBackedSettingDraft<string>('nanogptRequestModel', '')
  const nanogptRequestModelNameDraft = createServerBackedSettingDraft<string>('nanogptRequestModelName', '')
  const nanogptProviderDraft = createServerBackedSettingDraft<string>('nanogptProvider', '')
  const openrouterKeyDraft = createServerBackedSettingDraft<string>('openrouterKey', '')
  const openrouterRequestModelDraft = createServerBackedSettingDraft<string>('openrouterRequestModel', '')
  const customTokenizerDraft = createServerBackedSettingDraft<string>('customTokenizer', '')
  const openAIKeyDraft = createServerBackedSettingDraft<string>('openAIKey', '')
  const OaiCompAPIKeysDraft = createServerBackedSettingDraft<Record<string, string>>('OaiCompAPIKeys', {})
  const reverseProxyOobaModeDraft = createServerBackedSettingDraft<boolean>('reverseProxyOobaMode', false)
  const NAIadventureDraft = createPromptFieldDraft<boolean>('NAIadventure', false)
  const NAIappendNameDraft = createPromptFieldDraft<boolean>('NAIappendName', false)
  const koboldURLDraft = createServerBackedSettingDraft<string>('koboldURL', '')
  const echoMessageDraft = createServerBackedSettingDraft<string>('echoMessage', '')
  const echoDelayDraft = createServerBackedSettingDraft<number>('echoDelay', 0)
  const hordeConfigDraft = createServerBackedSettingDraft<Record<string, string>>('hordeConfig', {
    apiKey: '',
    model: '',
    softPrompt: '',
  })
  const textgenWebUIStreamURLDraft = createServerBackedSettingDraft<string>('textgenWebUIStreamURL', '')
  const textgenWebUIBlockingURLDraft = createServerBackedSettingDraft<string>('textgenWebUIBlockingURL', '')
  const enableCustomFlagsDraft = createServerBackedSettingDraft<boolean>('enableCustomFlags', false)
  const customFlagsDraft = createServerBackedSettingDraft<LLMFlags[]>('customFlags', [])
  const promptEnableCustomFlagsDraft = createPromptPresetModelOverrideDraft<boolean>('enableCustomFlags', false)
  const promptCustomFlagsDraft = createPromptPresetModelOverrideDraft<LLMFlags[]>('customFlags', [])
  const moduleIntergrationDraft = createPromptFieldDraft<string>('moduleIntergration', '')
  const modelToolsDraft = createServerBackedSettingDraft<string[]>('modelTools', [])
  const promptModelToolsDraft = createPromptPresetModelOverrideDraft<string[]>('modelTools', [])
  const presetRegexDraft = createPromptFieldDraft<any[]>('presetRegex', [])
  const mainPromptDraft = createPromptFieldDraft<string>('mainPrompt', '')
  const jailbreakDraft = createPromptFieldDraft<string>('jailbreak', '')
  const globalNoteDraft = createPromptFieldDraft<string>('globalNote', '')
  const formatingOrderDraft = createPromptFieldDraft<string[]>('formatingOrder', [])
  const promptPreprocessDraft = createPromptFieldDraft<boolean>('promptPreprocess', false)
  let currentPluginProviderDraft = $state(getDatabase().currentPluginProvider ?? '')
  let promptTemplateHydrated = $derived($promptTemplateHydratedStore && isPromptTemplateHydrated())
  let selectedPromptPreset = $derived(getDatabase().promptPresets?.[getDatabase().promptPresetsId])
  let selectedPromptPresetOwnsPromptTemplate = $derived(selectedPromptPresetHasOwnPromptTemplate())
  const PROMPT_PRESET_ICON_SIZE = 48
  type SelectedPromptPresetIconFile = NonNullable<Awaited<ReturnType<typeof selectSingleFile>>>

  let initializedPluginProviderWatch = false
  let previousPluginProvider = ''
  let lastPluginWatchSuppressionVersion = currentPluginWatchSuppressionVersion()
  let suppressPluginProviderDraftDispatch = false
  $effect(() => {
    const provider = getDatabase().currentPluginProvider ?? ''
    const suppressionVersion = currentPluginWatchSuppressionVersion()
    const draftProvider = untrack(() => currentPluginProviderDraft)
    if (provider !== draftProvider) {
      suppressPluginProviderDraftDispatch = true
      currentPluginProviderDraft = provider
      queueMicrotask(() => {
        suppressPluginProviderDraftDispatch = false
      })
    }
    if (!initializedPluginProviderWatch || suppressionVersion !== lastPluginWatchSuppressionVersion) {
      initializedPluginProviderWatch = true
      lastPluginWatchSuppressionVersion = suppressionVersion
      previousPluginProvider = provider
      return
    }
  })
  $effect(() => {
    const provider = currentPluginProviderDraft
    if (!canUseServerCommands()) {
      getDatabase().currentPluginProvider = provider
      previousPluginProvider = provider
      return
    }
    if (suppressPluginProviderDraftDispatch) return
    if (provider === previousPluginProvider) return
    const previous = currentPluginStateSnapshot()
    previous.currentPluginProvider = previousPluginProvider
    withTrustedResourceWrite(() => {
      getDatabase().currentPluginProvider = provider
    })
    const mirroredToPreset = mirrorTopLevelPresetField('currentPluginProvider', provider)
    previousPluginProvider = provider
    if (!mirroredToPreset) {
      untrack(() => dispatchSelectPluginProvider(provider, previous))
    }
  })

  const openrouterPinnedItems: ModelGridPinnedItem[] = [
    { id: 'risu/free', displayName: 'Free Auto', providerName: 'Risu' },
    { id: 'openrouter/auto', displayName: 'OpenRouter Auto', providerName: 'OpenRouter' },
  ]

  // Reset model selection and display name when subscription mode toggles
  let _nanogptSubModeInitialized = false
  $effect(() => {
    const _sub = nanogptUseSubscriptionEndpointDraft.value
    if (!_nanogptSubModeInitialized) {
      _nanogptSubModeInitialized = true
      return
    }
    nanogptRequestModelDraft.value = ''
    nanogptRequestModelNameDraft.value = ''
  })

  // Reset provider selection to Auto when the model or subscription mode changes
  let _nanogptProviderResetInitialized = false
  $effect(() => {
    const _model = nanogptRequestModelDraft.value
    const _sub = nanogptUseSubscriptionEndpointDraft.value
    if (!_nanogptProviderResetInitialized) {
      _nanogptProviderResetInitialized = true
      return
    }
    nanogptProviderDraft.value = ''
  })

  // Reset subscription mode (and related state) when API key is cleared
  let _nanogptKeyInitialized = false
  $effect(() => {
    const _key = nanogptKeyDraft.value
    if (!_nanogptKeyInitialized) {
      _nanogptKeyInitialized = true
      return
    }
    if (!_key) {
      nanogptUseSubscriptionEndpointDraft.value = false
      nanogptSubscriptionStateDraft.value = ''
      nanogptRequestModelDraft.value = ''
      nanogptRequestModelNameDraft.value = ''
      nanogptProviderDraft.value = ''
    }
  })

  let tokens = $state({
    mainPrompt: 0,
    jailbreak: 0,
    globalNote: 0,
  })

  type BotSettingsKind = 'legacy' | 'model' | 'prompt'

  interface Props {
    goPromptTemplate?: () => void
    settingsKind?: BotSettingsKind
  }

  let { goPromptTemplate = () => {}, settingsKind = 'legacy' }: Props = $props()

  let promptParameterOverrideMode = $derived(
    settingsKind === 'prompt' && promptPresetModelOverrideEnabled('parameters'),
  )
  let promptOwnsOthers = $derived(settingsKind === 'prompt')
  let activeOobaDraft = $derived(promptParameterOverrideMode ? promptOobaDraft : oobaDraft)
  let activeLocalStopStringsDraft = $derived(
    promptParameterOverrideMode ? promptLocalStopStringsDraft : localStopStringsDraft,
  )
  let activeNAIsettingsDraft = $derived(promptParameterOverrideMode ? promptNAIsettingsDraft : NAIsettingsDraft)
  let activeAinconfigDraft = $derived(promptParameterOverrideMode ? promptAinconfigDraft : ainconfigDraft)
  let activeAdditionalParamsDraft = $derived(promptOwnsOthers ? promptAdditionalParamsDraft : additionalParamsDraft)
  let activeEnableCustomFlagsDraft = $derived(promptOwnsOthers ? promptEnableCustomFlagsDraft : enableCustomFlagsDraft)
  let activeCustomFlagsDraft = $derived(promptOwnsOthers ? promptCustomFlagsDraft : customFlagsDraft)
  let activeModelToolsDraft = $derived(promptOwnsOthers ? promptModelToolsDraft : modelToolsDraft)

  function defaultSubmenuForKind(kind: BotSettingsKind): number {
    if (kind === 'model') return 0
    if (kind === 'prompt') return 2
    return getDatabase().useLegacyGUI ? -1 : 0
  }

  // svelte-ignore state_referenced_locally
  let submenu = $state(defaultSubmenuForKind(settingsKind))
  let availableSubmenus = $derived.by(() => {
    if (settingsKind === 'model') return [0, 1]
    if (settingsKind === 'prompt') return promptParameterOverrideMode ? [1, 2, 3] : [2, 3]
    return [0, 1, 2, 3]
  })
  let pageTitle = $derived(
    settingsKind === 'model' ? language.model : settingsKind === 'prompt' ? language.prompt : language.chatBot,
  )
  let showSubmenuSwitcher = $derived(submenu !== -1 && availableSubmenus.length > 1)
  let showPromptExtras = $derived(settingsKind !== 'model')
  let showModelOthersControls = $derived(settingsKind !== 'model')
  let showModelPresetButton = $derived(settingsKind !== 'prompt' && submenu !== -1)
  let showPromptPresetButton = $derived(settingsKind === 'legacy' && submenu === -1)
  let showLegacyMigrationButton = $derived(settingsKind === 'legacy' && getDatabase().botPresets?.length > 0)
  let selectedPromptPresetName = $derived(selectedPromptPreset?.name?.trim() || language.promptPresets)
  let parameterItems = $derived.by(() =>
    promptParameterOverrideMode
      ? allBasicParameterItems.filter((item) => {
          const key = item.bindPath?.split('.')[0] ?? item.bindKey
          return typeof key === 'string' && !!promptPresetModelOverrideFieldForDatabaseKey(key)
        })
      : allBasicParameterItems,
  )
  let previousPromptTemplateOwnerHydrationSelection = promptTemplatePresetSelectionSignature()

  $effect(() => {
    if (!availableSubmenus.includes(submenu)) {
      submenu = defaultSubmenuForKind(settingsKind)
    }
  })

  function hasSubmenu(id: number): boolean {
    return availableSubmenus.includes(id)
  }

  function isLastSubmenu(id: number): boolean {
    return availableSubmenus[availableSubmenus.length - 1] === id
  }

  function openPromptPresetList(): void {
    openPresetListModal('global', 'prompt')
  }

  function sectionVisible(id: number): boolean {
    return submenu === id || (submenu === -1 && hasSubmenu(id))
  }

  async function loadTokenize() {
    tokens.mainPrompt = await tokenizeAccurate(mainPromptDraft.value, true)
    tokens.jailbreak = await tokenizeAccurate(jailbreakDraft.value, true)
    tokens.globalNote = await tokenizeAccurate(globalNoteDraft.value, true)
  }

  function toggleCustomFlag(flag: number): void {
    const typedFlag = flag as LLMFlags
    const flags = activeCustomFlagsDraft.value ?? []
    activeCustomFlagsDraft.value = flags.includes(typedFlag)
      ? flags.filter((candidate) => candidate !== typedFlag)
      : [...flags, typedFlag]
  }

  function customFlagEnabled(flag: number): boolean {
    return (activeCustomFlagsDraft.value ?? []).includes(flag as LLMFlags)
  }

  function toggleModelTool(tool: string): void {
    const tools = activeModelToolsDraft.value ?? []
    activeModelToolsDraft.value = tools.includes(tool)
      ? tools.filter((candidate) => candidate !== tool)
      : [...tools, tool]
  }

  function createPromptFieldDraft<T>(key: string, fallback: T): { value: T } {
    const initialValue = currentPromptFieldValue(key, fallback)
    const draft = $state<{ value: T }>({ value: cloneJsonValue(initialValue) })
    let initialized = false
    let suppressDraftDispatch = false
    let previousServerSnapshot = snapshotJson(initialValue)
    let previousDraftDispatchSnapshot = snapshotJson(initialValue)
    let previousResourceApplyEpoch = getServerResourceApplyEpoch()
    let previousOwnerSignature = promptFieldOwnerSignature()
    let dirty = false

    $effect(() => {
      const resourceApplyEpoch = getServerResourceApplyEpoch()
      const resourceApplyChanged = resourceApplyEpoch !== previousResourceApplyEpoch
      const ownerSignature = promptFieldOwnerSignature()
      const serverValue = currentPromptFieldValue(key, fallback)
      const serverSnapshot = snapshotJson(serverValue)
      const draftSnapshot = snapshotJson(draft.value)

      if (ownerSignature !== previousOwnerSignature) {
        dirty = false
        suppressDraftDispatch = true
        previousDraftDispatchSnapshot = serverSnapshot
        draft.value = cloneJsonValue(serverValue)
        queueMicrotask(() => {
          suppressDraftDispatch = false
        })
      } else {
        if (resourceApplyChanged && dirty && serverSnapshot === draftSnapshot) {
          dirty = false
        }

        if (serverSnapshot !== previousServerSnapshot && serverSnapshot !== draftSnapshot) {
          suppressDraftDispatch = true
          if (resourceApplyChanged && dirty) {
            reassertDirtyPromptFieldDraftValue(key, draft.value)
          } else {
            dirty = false
            previousDraftDispatchSnapshot = serverSnapshot
            draft.value = cloneJsonValue(serverValue)
          }
          queueMicrotask(() => {
            suppressDraftDispatch = false
          })
        }
      }

      previousResourceApplyEpoch = resourceApplyEpoch
      previousOwnerSignature = ownerSignature
      previousServerSnapshot = dirty ? snapshotJson(draft.value) : serverSnapshot
    })

    $effect(() => {
      const snapshot = snapshotJson(draft.value)
      if (!initialized) {
        initialized = true
        previousDraftDispatchSnapshot = snapshot
        return
      }
      if (suppressDraftDispatch) {
        previousDraftDispatchSnapshot = snapshot
        return
      }
      if (snapshot === previousDraftDispatchSnapshot) return
      dirty = true
      previousDraftDispatchSnapshot = snapshot

      untrack(() => {
        const attempted = cloneJsonValue(draft.value)
        const previous = cloneJsonValue((getDatabase() as unknown as Record<string, unknown>)[key])
        withTrustedResourceWrite(() => {
          // Re-read inside the trusted write to get the mutable projection.
          const target = getDatabase() as unknown as Record<string, unknown>
          target[key] = attempted
        })
        const mirroredToPreset = writeSelectedPromptPresetField(key, attempted)
        if (!mirroredToPreset && PROMPT_SETTINGS_COMMAND_KEYS.has(key)) {
          queuePromptFieldPatch({ [key]: attempted }, { [key]: previous })
        }
        previousServerSnapshot = snapshot
      })
    })

    return draft
  }

  function promptFieldOwnerSignature(): string {
    const selectedIndex = getDatabase().promptPresetsId
    const selectedId =
      Number.isInteger(selectedIndex) && selectedIndex >= 0
        ? getDatabase().promptPresets?.[selectedIndex]?.id
        : undefined
    return selectedId ? `preset:${selectedId}` : 'root'
  }

  function reassertDirtyPromptFieldDraftValue<T>(key: string, value: T): void {
    withTrustedResourceWrite(() => {
      const target = getDatabase() as unknown as Record<string, unknown>
      target[key] = cloneJsonValue(value)
      const selectedIndex = getDatabase().promptPresetsId
      const preset = getDatabase().promptPresets?.[selectedIndex] as Record<string, unknown> | undefined
      if (!preset) return
      preset[key] = cloneJsonValue(value)
      if (key === 'presetRegex') preset.regex = []
    })
  }

  function queuePromptFieldPatch(patch: SettingsPatch, previous: SettingsPatch): void {
    if (!canUseServerCommands()) return
    for (const [key, value] of Object.entries(patch)) {
      if (!(key in pendingPromptFieldPatch.previous)) {
        pendingPromptFieldPatch.previous[key] = previous[key]
      }
      if (snapshotJson(value) === snapshotJson(pendingPromptFieldPatch.previous[key])) {
        delete pendingPromptFieldPatch.patch[key]
        delete pendingPromptFieldPatch.previous[key]
        delete pendingPromptFieldPatch.attempted[key]
        continue
      }
      pendingPromptFieldPatch.patch[key] = value
      pendingPromptFieldPatch.attempted[key] = value
    }

    if (pendingPromptFieldPatch.timer) clearTimeout(pendingPromptFieldPatch.timer)
    if (Object.keys(pendingPromptFieldPatch.patch).length === 0) {
      pendingPromptFieldPatch.timer = null
      return
    }
    pendingPromptFieldPatch.timer = setTimeout(() => {
      dispatchPendingPromptFieldPatch()
    }, 250)
  }

  function flushPendingPromptFieldPatch(): void {
    dispatchPendingPromptFieldPatch()
  }

  function dispatchPendingPromptFieldPatch(): void {
    if (pendingPromptFieldPatch.timer) {
      clearTimeout(pendingPromptFieldPatch.timer)
      pendingPromptFieldPatch.timer = null
    }

    const commandPatch = pendingPromptFieldPatch.patch
    const commandPrevious = pendingPromptFieldPatch.previous
    const commandAttempted = pendingPromptFieldPatch.attempted
    pendingPromptFieldPatch.patch = {}
    pendingPromptFieldPatch.previous = {}
    pendingPromptFieldPatch.attempted = {}

    if (Object.keys(commandPatch).length === 0) return

    void runServerCommand({
      command: (baseRevision) =>
        patchPromptSettingsCommand({
          baseRevision,
          patch: commandPatch,
        }),
      rollback: () => rollbackPromptFields(commandPrevious, commandAttempted),
    })
  }

  function rollbackPromptFields(previous: SettingsPatch, attempted: SettingsPatch): void {
    withTrustedResourceWrite(() => {
      const target = getDatabase() as unknown as Record<string, unknown>
      for (const [key, previousValue] of Object.entries(previous)) {
        if (snapshotJson(target[key]) === snapshotJson(attempted[key])) {
          target[key] = cloneJsonValue(previousValue)
        }
      }
    })
  }

  function currentPromptFieldValue<T>(key: string, fallback: T): T {
    const preset = getDatabase().promptPresets?.[getDatabase().promptPresetsId] as Record<string, unknown> | undefined
    if (preset) {
      if (key === 'presetRegex') {
        const regexField = resolvePromptPresetRegexField(preset)
        if (regexField.present) return regexField.value as T
      }
      if (Object.prototype.hasOwnProperty.call(preset, key)) return preset[key] as T
    }
    const target = getDatabase() as unknown as Record<string, unknown> | undefined
    const value = target?.[key]
    return value === undefined ? fallback : (value as T)
  }

  function writeSelectedPromptPresetField<T>(key: string, value: T): boolean {
    if (value === undefined) return false
    const selectedIndex = getDatabase().promptPresetsId
    if (selectedIndex < 0) return false
    const preset = getDatabase().promptPresets?.[selectedIndex] as Record<string, unknown> | undefined
    if (!preset) return false
    if (snapshotJson(preset[key]) === snapshotJson(value)) return false
    updatePromptPreset(selectedIndex, { [key]: cloneJsonValue(value) } as Partial<PromptPreset>)
    return true
  }

  function selectedPromptPresetHasOwnPromptTemplate(): boolean {
    const preset = getDatabase().promptPresets?.[getDatabase().promptPresetsId] as Record<string, unknown> | undefined
    return !!preset && Object.prototype.hasOwnProperty.call(preset, 'promptTemplate')
  }

  function promptTemplatePresetSelectionSignature(): string {
    const selectedIndex = getDatabase().promptPresetsId
    const selectedId =
      Number.isInteger(selectedIndex) && selectedIndex >= 0 ? getDatabase().promptPresets?.[selectedIndex]?.id : null
    return `${selectedIndex}:${selectedId ?? ''}`
  }

  function snapshotPromptTemplateOwnerProjection(ownerId: string | null): {
    hasTemplate: boolean
    template: unknown
  } {
    if (ownerId === null) {
      if (!Object.prototype.hasOwnProperty.call(getDatabase(), 'promptTemplate')) {
        return { hasTemplate: false, template: undefined }
      }
      return { hasTemplate: true, template: cloneJsonValue(getDatabase().promptTemplate) }
    }
    const preset = getDatabase().promptPresets?.[getDatabase().promptPresetsId] as Record<string, unknown> | undefined
    if (preset?.id !== ownerId || !Object.prototype.hasOwnProperty.call(preset, 'promptTemplate')) {
      return { hasTemplate: false, template: undefined }
    }
    return { hasTemplate: true, template: cloneJsonValue(preset.promptTemplate) }
  }

  function setSelectedPromptPresetTemplateProjection(enabled: boolean, template: unknown = []): void {
    withTrustedResourceWrite(() => {
      const preset = getDatabase().promptPresets?.[getDatabase().promptPresetsId] as Record<string, unknown> | undefined
      if (preset) {
        if (enabled) {
          preset.promptTemplate = cloneJsonValue(Array.isArray(template) ? template : [])
        } else {
          delete preset.promptTemplate
        }
      }
      if (enabled) {
        getDatabase().promptTemplate = cloneJsonValue(Array.isArray(template) ? template : [])
      } else {
        delete (getDatabase() as unknown as Record<string, unknown>).promptTemplate
      }
    })
  }

  function restoreSelectedPromptPresetTemplateProjection(snapshot: { hasTemplate: boolean; template: unknown }): void {
    setSelectedPromptPresetTemplateProjection(snapshot.hasTemplate, snapshot.template)
  }

  async function setSelectedPromptTemplateEnabled(enabled: boolean): Promise<void> {
    const ownerId = currentPromptTemplateOwnerId()
    if (!(await ensurePromptTemplateHydrated({ promptPresetId: ownerId }))) return
    if (ownerId !== currentPromptTemplateOwnerId()) return

    const projectionFence = capturePromptTemplateOwnerMutationFence(ownerId)
    const previous = snapshotPromptTemplateOwnerProjection(ownerId)
    setSelectedPromptPresetTemplateProjection(enabled)
    const attempted = snapshotPromptTemplateOwnerProjection(ownerId)
    const optimisticAcknowledgement = capturePromptItemOptimisticAcknowledgement(projectionFence)
    if (!canUseServerCommands()) return

    void runServerCommand({
      command: (baseRevision) =>
        runPromptTemplateOwnerCommand(ownerId, () =>
          enablePromptItemsCommand({
            baseRevision,
            promptPresetId: promptTemplateOwnerCommandId(ownerId),
            enabled,
            optimisticAcknowledgement,
          }),
        ),
      rollback: () =>
        runPromptTemplateOwnerRollback(
          ownerId,
          () => {
            if (snapshotJson(snapshotPromptTemplateOwnerProjection(ownerId)) !== snapshotJson(attempted)) return false
            restoreSelectedPromptPresetTemplateProjection(previous)
            return true
          },
          projectionFence,
        ),
    })
  }

  function currentPromptPresetIconUploadTarget() {
    const selectedIndex = getDatabase().promptPresetsId
    return capturePromptPresetIconUploadTarget({
      presetIndex: selectedIndex,
      preset: getDatabase().promptPresets?.[selectedIndex],
    })
  }

  function promptPresetIconUploadFreshness(operation: PromptPresetIconUploadOperation) {
    const selectedPreset = getDatabase().promptPresets?.[getDatabase().promptPresetsId]
    const rowPreset = getDatabase().promptPresets?.[operation.presetIndex]

    return {
      selectedPresetId: selectedPreset?.id,
      rowPresetId: rowPreset?.id ?? null,
      image: rowPreset?.image,
    }
  }

  function isCurrentPromptPresetIconUpload(operation: PromptPresetIconUploadOperation): boolean {
    return isFreshPromptPresetIconUpload(operation, promptPresetIconUploadFreshness(operation))
  }

  function currentBiasImportFreshness() {
    const selectedPreset = getDatabase().promptPresets?.[getDatabase().promptPresetsId]
    return {
      selectedPromptPresetId: selectedPreset?.id,
      bias: biasDraft.value,
    }
  }

  async function importBiasJson(): Promise<void> {
    const target = captureBiasImportTarget(currentBiasImportFreshness())
    if (!target) return

    let operation: BiasImportOperation | null = null
    const beginImport = () => {
      operation ??= beginBiasImport(target)
    }

    try {
      const selected = await selectSingleFile(['json'], { onFileSelected: beginImport })
      if (!selected) return

      beginImport()
      if (!operation) return

      const importedBias = parseBiasImport(new TextDecoder().decode(selected.data))
      if (importedBias === null) {
        if (isFreshBiasImport(operation, currentBiasImportFreshness())) {
          alertError(language.errors.noData)
        }
        return
      }

      const freshBias = resolveFreshBiasImportValue({
        operation,
        freshness: currentBiasImportFreshness(),
        bias: importedBias,
      })
      if (freshBias === null) return

      biasDraft.value = freshBias
    } finally {
      if (operation) {
        clearBiasImport(operation)
      }
    }
  }

  async function resizePromptPresetIconFile(
    file: SelectedPromptPresetIconFile,
    operation: PromptPresetIconUploadOperation,
  ): Promise<string | null> {
    if (!isCurrentPromptPresetIconUpload(operation)) return null

    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) return null

    const img = new Image()
    //@ts-expect-error Uint8Array buffer type (ArrayBufferLike) is incompatible with BlobPart's ArrayBuffer
    const blob = new Blob([file.data], { type: 'image/png' })
    const objectUrl = URL.createObjectURL(blob)

    try {
      img.src = objectUrl
      await img.decode()
      if (!isCurrentPromptPresetIconUpload(operation)) return null

      canvas.width = PROMPT_PRESET_ICON_SIZE
      canvas.height = PROMPT_PRESET_ICON_SIZE
      ctx.drawImage(img, 0, 0, PROMPT_PRESET_ICON_SIZE, PROMPT_PRESET_ICON_SIZE)
      const data = canvas.toDataURL('image/jpeg', 0.7)

      if (!isCurrentPromptPresetIconUpload(operation)) return null
      return data
    } finally {
      URL.revokeObjectURL(objectUrl)
    }
  }

  async function uploadSelectedPromptPresetIcon(): Promise<void> {
    const target = currentPromptPresetIconUploadTarget()
    if (!target) return

    const selected = await selectSingleFile(['png', 'jpg', 'jpeg', 'webp'])
    if (!selected) return

    const operation = beginPromptPresetIconUpload(target)
    try {
      if (!isCurrentPromptPresetIconUpload(operation)) return

      const data = await resizePromptPresetIconFile(selected, operation)
      if (!data) return

      const updateIndex = resolveFreshPromptPresetIconUploadIndex({
        operation,
        freshness: promptPresetIconUploadFreshness(operation),
      })
      if (updateIndex === null) return

      updatePromptPreset(updateIndex, { image: data }) // The 48×48 JPEG data URL is small enough to keep inline.
    } finally {
      clearPromptPresetIconUpload(operation)
    }
  }

  function snapshotJson(value: unknown): string {
    const snapshot = JSON.stringify(value)
    return snapshot === undefined ? '__undefined__' : snapshot
  }

  function cloneJsonValue<T>(value: T): T {
    if (value === undefined) return value
    return JSON.parse(JSON.stringify(value)) as T
  }

  function usesTextgenStreamUrl(model: string): boolean {
    return model === 'textgen_webui' || model === 'mancer'
  }

  $effect(() => {
    mainPromptDraft.value
    jailbreakDraft.value
    globalNoteDraft.value
    void loadTokenize()
  })

  $effect.pre(() => {
    if (usesTextgenStreamUrl(getDatabase().aiModel) || usesTextgenStreamUrl(getDatabase().subModel)) {
      useStreamingDraft.value = textgenWebUIStreamURLDraft.value.startsWith('wss://')
    }
  })

  $effect(() => {
    const selection = promptTemplatePresetSelectionSignature()
    if (selection === previousPromptTemplateOwnerHydrationSelection) return
    previousPromptTemplateOwnerHydrationSelection = selection
    untrack(() => {
      const ownerId = currentPromptTemplateOwnerId()
      void ensurePromptTemplateHydrated({ promptPresetId: ownerId })
    })
  })

  function clearVertexToken() {
    vertexAccessTokenDraft.value = ''
    vertexAccessTokenExpiresDraft.value = 0
    console.log('Vertex AI token cleared')
  }

  onMount(() => {
    void ensurePromptTemplateHydrated({ promptPresetId: currentPromptTemplateOwnerId() })
  })

  onDestroy(() => {
    flushPendingPromptFieldPatch()
  })

  let modelInfo = $derived(getModelInfo(getDatabase().aiModel))
  let subModelInfo = $derived(getModelInfo(getDatabase().subModel))
  let modelProfileUiState = $derived.by(() =>
    resolveModelProfileUiState({
      database: getDatabase(),
      lookupModelInfo: (_database, id) => getModelInfo(id),
    }),
  )
  let effectiveRoleApiKeyModels = $derived(modelProfileUiState.apiKeyModels)
  let usesGoogleCloudProvider = $derived(modelProfileUiState.usesGoogleCloudProvider)
  let usesVertexAIProvider = $derived(modelProfileUiState.usesVertexAIProvider)
  let usesNovelListProvider = $derived(modelProfileUiState.usesNovelListProvider)
  let usesAnthropicProvider = $derived(modelProfileUiState.usesAnthropicProvider)
  let usesMistralProvider = $derived(modelProfileUiState.usesMistralProvider)
  let usesNovelAIProvider = $derived(modelProfileUiState.usesNovelAIProvider)
  let usesCohereProvider = $derived(modelProfileUiState.usesCohereProvider)
  let usesOpenAIProvider = $derived(modelProfileUiState.usesOpenAIProvider)
  let usesStreamingModel = $derived(modelProfileUiState.usesStreamingModel)
  let usesGeminiThinkingModel = $derived(modelProfileUiState.usesGeminiThinkingModel)
  let usesMancerModel = $derived(modelProfileUiState.usesMancerModel)
  let usesReverseProxyModel = $derived(modelProfileUiState.usesReverseProxyModel)
  let usesOllamaLocal = $derived(modelProfileUiState.usesOllamaLocal)
  let usesOllamaCloud = $derived(modelProfileUiState.usesOllamaCloud)
  let usesNanoGPTModel = $derived(modelProfileUiState.usesNanoGPTModel)
  let usesOpenRouterModel = $derived(modelProfileUiState.usesOpenRouterModel)
  let usesCustomModel = $derived(modelProfileUiState.usesCustomModel)
  let usesKoboldModel = $derived(modelProfileUiState.usesKoboldModel)
  let usesEchoModel = $derived(modelProfileUiState.usesEchoModel)
  let usesHordeModel = $derived(modelProfileUiState.usesHordeModel)
  let usesTextgenWebUIModel = $derived(modelProfileUiState.usesTextgenWebUIModel)
  let usesOobaModel = $derived(modelProfileUiState.usesOobaModel)
  let nanogptInputMode = $state<'list' | 'manual'>(
    getDatabase().nanogptRequestModel && !getDatabase().nanogptRequestModelName ? 'manual' : 'list',
  )
  // svelte-ignore state_referenced_locally
  let prevNanogptInputMode = nanogptInputMode
  $effect(() => {
    if (nanogptInputMode !== prevNanogptInputMode) {
      nanogptRequestModelDraft.value = ''
      nanogptRequestModelNameDraft.value = ''
      prevNanogptInputMode = nanogptInputMode
    }
  })

  function getNanoGPTModelCatalogs(apiKey: string) {
    return Promise.all([getNanoGPTModels({ apiKey }), getNanoGPTSubscriptionModels(apiKey)])
  }
</script>

{#if settingsKind === 'model'}
  <ModelSettingsShell />
{:else}
  <h2 class="mb-2 text-2xl font-bold mt-2">{pageTitle}</h2>

  {#if settingsKind === 'prompt'}
    <div class="flex flex-col gap-2 rounded-md border border-darkborderc p-3 mb-4">
      <Check
        check={promptParameterOverrideMode}
        name={language.overrideModelParameters}
        onChange={(enabled) => {
          setPromptPresetModelOverrideEnabled('parameters', enabled)
        }} />
      <Button onclick={openPromptPresetList} className="w-full text-left">
        <span class="block w-full truncate">{selectedPromptPresetName}</span>
      </Button>
    </div>
  {/if}

  {#if showSubmenuSwitcher}
    <div class="flex w-full rounded-md border border-darkborderc mb-4">
      {#if hasSubmenu(0)}
        <button
          onclick={() => {
            submenu = 0
          }}
          class="p-2 flex-1 border-darkborderc"
          class:border-r={!isLastSubmenu(0)}
          class:bg-darkbutton={submenu === 0}>
          <span>{language.model}</span>
        </button>
      {/if}
      {#if hasSubmenu(1)}
        <button
          onclick={() => {
            submenu = 1
          }}
          class="p-2 flex-1 border-darkborderc"
          class:border-r={!isLastSubmenu(1)}
          class:bg-darkbutton={submenu === 1}>
          <span>{language.parameters}</span>
        </button>
      {/if}
      {#if hasSubmenu(2)}
        <button
          onclick={() => {
            submenu = 2
          }}
          class="p-2 flex-1 border-darkborderc"
          class:border-r={!isLastSubmenu(2)}
          class:bg-darkbutton={submenu === 2}>
          <span>{language.prompt}</span>
        </button>
      {/if}
      {#if hasSubmenu(3)}
        <button
          onclick={() => {
            submenu = 3
          }}
          class="p-2 flex-1 border-darkborderc"
          class:border-r={!isLastSubmenu(3)}
          class:bg-darkbutton={submenu === 3}>
          <span>{language.others}</span>
        </button>
      {/if}
    </div>
  {/if}

  {#if sectionVisible(0)}
    <ModelRoleList />

    {#if usesGoogleCloudProvider}
      <span class="text-textcolor">GoogleAI API Key</span>
      <TextInput
        marginBottom={true}
        size={'sm'}
        placeholder="..."
        hideText
        bind:value={googleDraft.value.accessToken} />
    {/if}
    {#if usesVertexAIProvider}
      <span class="text-textcolor">Project ID</span>
      <TextInput
        marginBottom={true}
        size={'sm'}
        placeholder="..."
        bind:value={googleDraft.value.projectId}
        oninput={clearVertexToken} />
      <span class="text-textcolor">Vertex Client Email</span>
      <TextInput
        marginBottom={true}
        size={'sm'}
        placeholder="..."
        bind:value={vertexClientEmailDraft.value}
        oninput={clearVertexToken} />
      <span class="text-textcolor">Vertex Private Key</span>
      <TextInput
        marginBottom={true}
        size={'sm'}
        placeholder="..."
        hideText
        bind:value={vertexPrivateKeyDraft.value}
        oninput={clearVertexToken} />
      <span class="text-textcolor">Region</span>
      <SelectInput
        value={vertexRegionDraft.value}
        onchange={(e) => {
          vertexRegionDraft.value = e.currentTarget.value
          clearVertexToken()
        }}>
        <OptionInput value={'global'}>global</OptionInput>
        <OptionInput value={'us-central1'}>us-central1</OptionInput>
        <OptionInput value={'us-west1'}>us-west1</OptionInput>
      </SelectInput>
    {/if}
    {#if usesNovelListProvider}
      <span class="text-textcolor">NovelList {language.apiKey}</span>
      <TextInput hideText marginBottom={true} size={'sm'} placeholder="..." bind:value={novellistAPIDraft.value} />
    {/if}
    {#if usesMancerModel}
      <span class="text-textcolor">Mancer {language.apiKey}</span>
      <TextInput hideText marginBottom={true} size={'sm'} placeholder="..." bind:value={mancerHeaderDraft.value} />
    {/if}
    {#if usesAnthropicProvider}
      <span class="text-textcolor">Claude {language.apiKey}</span>
      <TextInput hideText marginBottom={true} size={'sm'} placeholder="..." bind:value={claudeAPIKeyDraft.value} />
    {/if}
    {#if usesMistralProvider}
      <span class="text-textcolor">Mistral {language.apiKey}</span>
      <TextInput hideText marginBottom={true} size={'sm'} placeholder="..." bind:value={mistralKeyDraft.value} />
    {/if}
    {#if usesNovelAIProvider}
      <span class="text-textcolor">NovelAI Bearer Token</span>
      <TextInput hideText bind:value={novelaiDraft.value.token} />
    {/if}
    {#if usesReverseProxyModel}
      <span class="text-textcolor mt-2">URL <Help key="forceUrl" /></span>
      <TextInput marginBottom={false} size={'sm'} bind:value={forceReplaceUrlDraft.value} placeholder="https//..." />
      <span class="text-textcolor mt-4"> {language.proxyAPIKey}</span>
      <TextInput
        hideText
        marginBottom={false}
        size={'sm'}
        placeholder="leave it blank if it hasn't password"
        bind:value={proxyKeyDraft.value} />
      <span class="text-textcolor mt-4"> {language.proxyRequestModel}</span>
      <TextInput marginBottom={false} size={'sm'} bind:value={customProxyRequestModelDraft.value} placeholder="Name" />
      <span class="text-textcolor mt-4"> {language.format}</span>
      <SelectInput
        value={customAPIFormatDraft.value.toString()}
        onchange={(e) => {
          customAPIFormatDraft.value = parseInt(e.currentTarget.value) as LLMFormat
        }}>
        <OptionInput value={LLMFormat.OpenAICompatible.toString()}>OpenAI Compatible</OptionInput>
        <OptionInput value={LLMFormat.OpenAIResponseAPI.toString()}>OpenAI Response API</OptionInput>
        <OptionInput value={LLMFormat.Anthropic.toString()}>Anthropic Claude</OptionInput>
        <OptionInput value={LLMFormat.Mistral.toString()}>Mistral</OptionInput>
        <OptionInput value={LLMFormat.GoogleCloud.toString()}>Google Cloud</OptionInput>
        <OptionInput value={LLMFormat.Cohere.toString()}>Cohere</OptionInput>
      </SelectInput>
    {/if}
    {#if usesCohereProvider}
      <span class="text-textcolor mt-4">Cohere {language.apiKey}</span>
      <TextInput hideText marginBottom={false} size={'sm'} bind:value={cohereAPIKeyDraft.value} />
    {/if}
    {#if usesOllamaLocal || usesOllamaCloud}
      {#if usesOllamaLocal}
        <span class="text-textcolor mt-4">Ollama URL</span>
        <TextInput marginBottom={false} size={'sm'} bind:value={ollamaURLDraft.value} />
      {/if}

      {#if usesOllamaCloud}
        <span class="text-textcolor mt-4">Ollama {language.model}</span>
        <SegmentedControl
          bind:value={ollamaInputModeDraft.value}
          options={[
            { value: 'list', label: (language as any).nanoGPTSelectFromList || 'Select from List' },
            { value: 'manual', label: (language as any).nanoGPTManualInput || 'Manual Input' },
          ]}
          size="md" />

        {#if ollamaInputModeDraft.value === 'manual'}
          <TextInput
            marginBottom={false}
            size={'sm'}
            bind:value={ollamaCloudModelDraft.value}
            placeholder="Model"
            oninput={() => (ollamaCloudModelNameDraft.value = '')} />
        {:else}
          {#await getOllamaModels(ollamaURLDraft.value, 'cloud', ollamaApiKeyDraft.value)}
            <ModelGrid bind:value={ollamaCloudModelDraft.value} loading={true} />
          {:then cloudModels}
            <ModelGrid
              bind:value={ollamaCloudModelDraft.value}
              items={cloudModels ?? []}
              selectedLabelOverride={ollamaCloudModelDraft.value
                ? `Cloud / ${ollamaCloudModelNameDraft.value || ollamaCloudModelDraft.value}`
                : undefined}
              onselect={(_id, name) => {
                ollamaModelSourceDraft.value = 'cloud'
                ollamaCloudModelNameDraft.value = name
              }} />
          {/await}
        {/if}

        <span class="text-textcolor mt-4">Ollama {language.apiKey}</span>
        <TextInput hideText marginBottom={false} size={'sm'} bind:value={ollamaApiKeyDraft.value} />

        <span class="text-textcolor mt-4">Ollama {language.format}</span>
        <SelectInput
          value={ollamaRequestFormatDraft.value.toString()}
          onchange={(e) => {
            ollamaRequestFormatDraft.value = parseInt(e.currentTarget.value) as LLMFormat
          }}>
          <OptionInput value={LLMFormat.Ollama.toString()}>Ollama SDK</OptionInput>
          <OptionInput value={LLMFormat.OpenAICompatible.toString()}>OpenAI Compatible</OptionInput>
          <OptionInput value={LLMFormat.OpenAIResponseAPI.toString()}>OpenAI Response API</OptionInput>
          <OptionInput value={LLMFormat.Anthropic.toString()}>Anthropic Claude</OptionInput>
        </SelectInput>

        <div class="mt-2">
          <CheckInput bind:check={useStreamingDraft.value} name={`Response ${language.streaming}`} />
        </div>
      {/if}

      {#if usesOllamaLocal}
        <span class="text-textcolor mt-4">Ollama Model</span>
        <TextInput
          marginBottom={false}
          size={'sm'}
          bind:value={ollamaModelDraft.value}
          placeholder="Model"
          oninput={() => {
            ollamaModelSourceDraft.value = 'local'
            ollamaModelNameDraft.value = ''
          }} />
      {/if}

      {#if usesOllamaLocal || (usesOllamaCloud && ollamaRequestFormatDraft.value === LLMFormat.Ollama)}
        <span class="text-textcolor mt-4">Ollama Thinking</span>
        <SelectInput bind:value={ollamaThinkingModeDraft.value}>
          <OptionInput value="auto">Auto</OptionInput>
          <OptionInput value="off">Off</OptionInput>
          <OptionInput value="on">On</OptionInput>
          <OptionInput value="low">Low</OptionInput>
          <OptionInput value="medium">Medium</OptionInput>
          <OptionInput value="high">High</OptionInput>
        </SelectInput>
      {/if}
    {/if}
    {#if usesNanoGPTModel}
      <span class="text-textcolor mt-4">NanoGPT {language.apiKey}</span>
      <TextInput hideText marginBottom={false} size={'sm'} bind:value={nanogptKeyDraft.value} />

      <NanoGPTDashboard apiKey={nanogptKeyDraft.value} />

      {#if nanogptSubscriptionStateDraft.value === 'active' || nanogptSubscriptionStateDraft.value === 'grace'}
        <div class="flex items-center mt-3">
          <CheckInput
            bind:check={nanogptUseSubscriptionEndpointDraft.value}
            name={language.nanoGPTUseSubscriptionEndpoint} />
        </div>
      {/if}

      <span class="text-textcolor mt-4">NanoGPT {language.model}</span>
      <SegmentedControl
        bind:value={nanogptInputMode}
        options={[
          { value: 'list', label: (language as any).nanoGPTSelectFromList || 'Select from List' },
          { value: 'manual', label: (language as any).nanoGPTManualInput || 'Manual Input' },
        ]}
        size="md" />

      {#if nanogptInputMode === 'manual'}
        <TextInput
          marginBottom={false}
          size={'sm'}
          bind:value={nanogptRequestModelDraft.value}
          placeholder={(language as any).nanoGPTManualModelSelect || 'Manual Model Select'}
          oninput={() => (nanogptRequestModelNameDraft.value = '')} />
      {:else}
        {#await getNanoGPTModelCatalogs(nanogptKeyDraft.value)}
          <ModelGrid bind:value={nanogptRequestModelDraft.value} loading={true} />
        {:then [regular, sub]}
          <ModelGrid
            bind:value={nanogptRequestModelDraft.value}
            items={nanogptUseSubscriptionEndpointDraft.value
              ? (sub ?? []).map(ngToGridItem)
              : (regular ?? []).map(ngToGridItem)}
            showSubBadge={nanogptUseSubscriptionEndpointDraft.value}
            selectedLabelOverride={nanogptRequestModelDraft.value && !nanogptRequestModelNameDraft.value
              ? nanogptRequestModelDraft.value
              : undefined}
            onselect={(_id, name) => {
              nanogptRequestModelNameDraft.value = name
            }} />
          {#if !nanogptUseSubscriptionEndpointDraft.value}
            <NanoGPTProviderPicker
              apiKey={nanogptKeyDraft.value}
              modelId={nanogptRequestModelDraft.value}
              bind:value={nanogptProviderDraft.value} />
          {/if}
        {/await}
      {/if}
    {/if}
    {#if usesOpenRouterModel}
      <span class="text-textcolor mt-4">OpenRouter {language.apiKey}</span>
      <TextInput hideText marginBottom={false} size={'sm'} bind:value={openrouterKeyDraft.value} />

      <span class="text-textcolor mt-4">OpenRouter {language.model}</span>
      {#await getOpenRouterModels({ apiKey: openrouterKeyDraft.value })}
        <ModelGrid bind:value={openrouterRequestModelDraft.value} pinnedItems={openrouterPinnedItems} loading={true} />
      {:then m}
        <ModelGrid
          bind:value={openrouterRequestModelDraft.value}
          items={(m ?? []).map(orToGridItem)}
          pinnedItems={openrouterPinnedItems} />
      {/await}
    {/if}
    {#if usesOpenRouterModel || usesReverseProxyModel}
      <span class="text-textcolor">{language.tokenizer}</span>
      <SelectInput bind:value={customTokenizerDraft.value}>
        {#each tokenizerList as entry}
          <OptionInput value={entry[0]}>{entry[1]}</OptionInput>
        {/each}
      </SelectInput>
    {/if}
    {#if usesOpenAIProvider}
      <span class="text-textcolor">OpenAI {language.apiKey} <Help key="oaiapikey" /></span>
      <TextInput
        hideText
        marginBottom={false}
        size={'sm'}
        bind:value={openAIKeyDraft.value}
        placeholder="sk-XXXXXXXXXXXXXXXXXXXX" />
    {/if}

    {#each effectiveRoleApiKeyModels as apiKeyModel (apiKeyModel.keyIdentifier)}
      <span class="text-textcolor">{apiKeyModel.name} {language.apiKey}</span>
      <TextInput
        hideText
        marginBottom={false}
        size={'sm'}
        bind:value={OaiCompAPIKeysDraft.value[apiKeyModel.keyIdentifier]}
        placeholder="..." />
    {/each}

    <div class="py-2 flex flex-col gap-2 mb-4">
      {#if !usesOllamaCloud && usesStreamingModel}
        <Check bind:check={useStreamingDraft.value} name={`Response ${language.streaming}`} />

        {#if useStreamingDraft.value && usesGeminiThinkingModel}
          <Check bind:check={streamGeminiThoughtsDraft.value} name={`Stream Gemini Thoughts`} />
        {/if}
      {/if}

      {#if usesReverseProxyModel}
        <Check bind:check={reverseProxyOobaModeDraft.value} name={`${language.reverseProxyOobaMode}`} />
      {/if}
      {#if usesNovelAIProvider}
        <Check bind:check={NAIadventureDraft.value} name={language.textAdventureNAI} />

        <Check bind:check={NAIappendNameDraft.value} name={language.appendNameNAI} />
      {/if}
    </div>

    {#if usesCustomModel}
      <span class="text-textcolor mt-2">{language.plugin}</span>
      <SelectInput className="mt-2 mb-4" bind:value={currentPluginProviderDraft}>
        <OptionInput value="">None</OptionInput>
        {#each $customProviderStore as plugin}
          <OptionInput value={plugin}>{plugin}</OptionInput>
        {/each}
      </SelectInput>
    {/if}

    {#if usesKoboldModel}
      <span class="text-textcolor">Kobold URL</span>
      <TextInput marginBottom={true} bind:value={koboldURLDraft.value} />
    {/if}

    {#if usesEchoModel}
      <span class="text-textcolor mt-2">Echo Message</span>
      <TextAreaInput
        margin="bottom"
        bind:value={echoMessageDraft.value}
        placeholder={"The message you want to receive as the bot's response\n(e.g., Lumi tilts her head, her white hair sliding down as her pretty green and aqua eyes sparkle…)"} />
      <span class="text-textcolor mt-2">Echo Delay (Seconds)</span>
      <NumberInput marginBottom={true} bind:value={echoDelayDraft.value} min={0} />
    {/if}

    {#if usesHordeModel}
      <span class="text-textcolor">Horde {language.apiKey}</span>
      <TextInput hideText marginBottom={true} bind:value={hordeConfigDraft.value.apiKey} />
    {/if}
    {#if usesTextgenWebUIModel || usesMancerModel}
      <span class="text-textcolor mt-2">Blocking {language.providerURL}</span>
      <TextInput marginBottom={true} bind:value={textgenWebUIBlockingURLDraft.value} placeholder="https://..." />
      <span class="text-draculared text-xs mb-2">You must use textgen webui with --public-api</span>
      <span class="text-textcolor mt-2">Stream {language.providerURL}</span>
      <TextInput marginBottom={true} bind:value={textgenWebUIStreamURLDraft.value} placeholder="wss://..." />
      <span class="text-draculared text-xs mb-2"
        >To reach a local WebUI from the browser, use ngrok or other tunnels.</span>
      <span class="text-draculared text-xs mb-2"
        >Warning: For Ooba version over 1.7, use "Ooba" as model, and use url like
        http://127.0.0.1:5000/v1/chat/completions</span>
    {/if}
    {#if usesOobaModel}
      <span class="text-textcolor mt-2">Ooba {language.providerURL}</span>
      <TextInput marginBottom={true} bind:value={textgenWebUIBlockingURLDraft.value} placeholder="https://..." />
    {/if}
    {#if usesHordeModel || usesKoboldModel}
      <ChatFormatSettings />
    {/if}
  {/if}

  {#if sectionVisible(1)}
    <SettingRenderer
      items={parameterItems}
      {modelInfo}
      {subModelInfo}
      presetMirrorTarget={promptParameterOverrideMode ? 'promptModelOverrides' : 'auto'} />
    {#if getDatabase().aiModel === 'textgen_webui' || getDatabase().aiModel === 'mancer' || getDatabase().aiModel.startsWith('local_') || getDatabase().aiModel.startsWith('hf:::')}
      <span class="text-textcolor">Repetition Penalty</span>
      <SliderInput
        min={1}
        max={1.5}
        step={0.01}
        fixed={2}
        marginBottom
        bind:value={activeOobaDraft.value.repetition_penalty} />
      <span class="text-textcolor">Length Penalty</span>
      <SliderInput
        min={-5}
        max={5}
        step={0.05}
        marginBottom
        fixed={2}
        bind:value={activeOobaDraft.value.length_penalty} />
      <span class="text-textcolor">Top K</span>
      <SliderInput min={0} max={100} step={1} marginBottom bind:value={activeOobaDraft.value.top_k} />
      <span class="text-textcolor">Top P</span>
      <SliderInput min={0} max={1} step={0.01} marginBottom fixed={2} bind:value={activeOobaDraft.value.top_p} />
      <span class="text-textcolor">Typical P</span>
      <SliderInput min={0} max={1} step={0.01} marginBottom fixed={2} bind:value={activeOobaDraft.value.typical_p} />
      <span class="text-textcolor">Top A</span>
      <SliderInput min={0} max={1} step={0.01} marginBottom fixed={2} bind:value={activeOobaDraft.value.top_a} />
      <span class="text-textcolor">No Repeat n-gram Size</span>
      <SliderInput min={0} max={20} step={1} marginBottom bind:value={activeOobaDraft.value.no_repeat_ngram_size} />
      <div class="flex items-center mt-4">
        <Check bind:check={activeOobaDraft.value.do_sample} name={'Do Sample'} />
      </div>
      <div class="flex items-center mt-4">
        <Check bind:check={activeOobaDraft.value.add_bos_token} name={'Add BOS Token'} />
      </div>
      <div class="flex items-center mt-4">
        <Check bind:check={activeOobaDraft.value.ban_eos_token} name={'Ban EOS Token'} />
      </div>
      <div class="flex items-center mt-4">
        <Check bind:check={activeOobaDraft.value.skip_special_tokens} name={'Skip Special Tokens'} />
      </div>
      <div class="flex items-center mt-4">
        <Check
          check={!!activeLocalStopStringsDraft.value}
          name={language.customStopWords}
          onChange={() => {
            if (!activeLocalStopStringsDraft.value) {
              activeLocalStopStringsDraft.value = []
            } else {
              activeLocalStopStringsDraft.value = null
            }
          }} />
      </div>
      {#if activeLocalStopStringsDraft.value}
        <div class="flex flex-col p-2 rounded-sm border border-selected mt-2 gap-1">
          <div class="p-2">
            <button
              class="font-medium flex justify-center items-center h-full cursor-pointer hover:text-green-500 w-full"
              onclick={() => {
                const localStopStrings = activeLocalStopStringsDraft.value ?? []
                localStopStrings.push('')
                activeLocalStopStringsDraft.value = localStopStrings
              }}><PlusIcon /></button>
          </div>
          {#each activeLocalStopStringsDraft.value as stopString, i}
            <div class="flex w-full">
              <div class="grow">
                <TextInput marginBottom bind:value={activeLocalStopStringsDraft.value[i]} fullwidth fullh />
              </div>
              <div>
                <button
                  class="font-medium flex justify-center items-center h-full cursor-pointer hover:text-green-500 w-full"
                  onclick={() => {
                    const localStopStrings = activeLocalStopStringsDraft.value ?? []
                    localStopStrings.splice(i, 1)
                    activeLocalStopStringsDraft.value = localStopStrings
                  }}><TrashIcon /></button>
              </div>
            </div>
          {/each}
        </div>
      {/if}
      <div class="flex flex-col p-3 rounded-md border-selected border mt-4">
        <ChatFormatSettings />
      </div>
      <Check bind:check={activeOobaDraft.value.formating.useName} name={language.useNamePrefix} />
    {:else if modelInfo.format === LLMFormat.NovelAI}
      <div class="flex flex-col p-3 bg-darkbg mt-4">
        <span class="text-textcolor">Starter</span>
        <TextInput bind:value={activeNAIsettingsDraft.value.starter} placeholder={'⁂'} />
        <span class="text-textcolor">Seperator</span>
        <TextInput bind:value={activeNAIsettingsDraft.value.seperator} placeholder={'\\n'} />
      </div>
      <span class="text-textcolor">Top P</span>
      <SliderInput min={0} max={1} step={0.01} marginBottom fixed={2} bind:value={activeNAIsettingsDraft.value.topP} />
      <span class="text-textcolor">Top K</span>
      <SliderInput min={0} max={100} step={1} marginBottom bind:value={activeNAIsettingsDraft.value.topK} />
      <span class="text-textcolor">Top A</span>
      <SliderInput min={0} max={1} step={0.01} marginBottom fixed={2} bind:value={activeNAIsettingsDraft.value.topA} />
      <span class="text-textcolor">Tailfree Sampling</span>
      <SliderInput
        min={0}
        max={1}
        step={0.001}
        marginBottom
        fixed={3}
        bind:value={activeNAIsettingsDraft.value.tailFreeSampling} />
      <span class="text-textcolor">Typical P</span>
      <SliderInput
        min={0}
        max={1}
        step={0.01}
        marginBottom
        fixed={2}
        bind:value={activeNAIsettingsDraft.value.typicalp} />
      <span class="text-textcolor">Repetition Penalty</span>
      <SliderInput
        min={0}
        max={3}
        step={0.01}
        marginBottom
        fixed={2}
        bind:value={activeNAIsettingsDraft.value.repetitionPenalty} />
      <span class="text-textcolor">Repetition Penalty Range</span>
      <SliderInput
        min={0}
        max={8192}
        step={1}
        marginBottom
        fixed={0}
        bind:value={activeNAIsettingsDraft.value.repetitionPenaltyRange} />
      <span class="text-textcolor">Repetition Penalty Slope</span>
      <SliderInput
        min={0}
        max={10}
        step={0.01}
        marginBottom
        fixed={2}
        bind:value={activeNAIsettingsDraft.value.repetitionPenaltySlope} />
      <span class="text-textcolor">Frequency Penalty</span>
      <SliderInput
        min={-2}
        max={2}
        step={0.01}
        marginBottom
        fixed={2}
        bind:value={activeNAIsettingsDraft.value.frequencyPenalty} />
      <span class="text-textcolor">Presence Penalty</span>
      <SliderInput
        min={-2}
        max={2}
        step={0.01}
        marginBottom
        fixed={2}
        bind:value={activeNAIsettingsDraft.value.presencePenalty} />
      <span class="text-textcolor">Mirostat LR</span>
      <SliderInput
        min={0}
        max={1}
        step={0.01}
        marginBottom
        fixed={2}
        bind:value={activeNAIsettingsDraft.value.mirostat_lr} />
      <span class="text-textcolor">Mirostat Tau</span>
      <SliderInput
        min={0}
        max={6}
        step={0.01}
        marginBottom
        fixed={2}
        bind:value={activeNAIsettingsDraft.value.mirostat_tau} />
      <span class="text-textcolor">Cfg Scale</span>
      <SliderInput
        min={1}
        max={3}
        step={0.01}
        marginBottom
        fixed={2}
        bind:value={activeNAIsettingsDraft.value.cfg_scale} />
    {:else if modelInfo.format === LLMFormat.NovelList}
      <span class="text-textcolor">Top P</span>
      <SliderInput min={0} max={2} step={0.01} marginBottom fixed={2} bind:value={activeAinconfigDraft.value.top_p} />
      <span class="text-textcolor">Reputation Penalty</span>
      <SliderInput min={0} max={2} step={0.01} marginBottom fixed={2} bind:value={activeAinconfigDraft.value.rep_pen} />
      <span class="text-textcolor">Reputation Penalty Range</span>
      <SliderInput
        min={0}
        max={2048}
        step={1}
        marginBottom
        fixed={2}
        bind:value={activeAinconfigDraft.value.rep_pen_range} />
      <span class="text-textcolor">Reputation Penalty Slope</span>
      <SliderInput
        min={0}
        max={10}
        step={0.1}
        marginBottom
        fixed={2}
        bind:value={activeAinconfigDraft.value.rep_pen_slope} />
      <span class="text-textcolor">Top K</span>
      <SliderInput min={1} max={500} step={1} marginBottom fixed={2} bind:value={activeAinconfigDraft.value.top_k} />
      <span class="text-textcolor">Top A</span>
      <SliderInput min={0} max={1} step={0.01} marginBottom fixed={2} bind:value={activeAinconfigDraft.value.top_a} />
      <span class="text-textcolor">Typical P</span>
      <SliderInput
        min={0}
        max={1}
        step={0.01}
        marginBottom
        fixed={2}
        bind:value={activeAinconfigDraft.value.typical_p} />
    {:else}
      <!-- Standard parameters come from SettingRenderer. -->
    {/if}

    {#if (getDatabase().reverseProxyOobaMode && usesReverseProxyModel) || usesOobaModel}
      <OobaSettings instructionMode={usesOobaModel} />
    {/if}

    {#if usesOpenRouterModel}
      <OpenrouterSettings apiKey={openrouterKeyDraft.value} />
    {/if}

    <SeparateParametersSection promptPresetModelOverrideMode={promptParameterOverrideMode} />
  {/if}

  {#if sectionVisible(3)}
    {#if showPromptExtras}
      <Accordion styled name="Bias " help="bias">
        <table class="contain w-full max-w-full tabler">
          <tbody>
            <tr>
              <th class="font-medium">Bias</th>
              <th class="font-medium">{language.value}</th>
              <th>
                <button
                  class="font-medium cursor-pointer hover:text-green-500 w-full flex justify-center items-center"
                  onclick={() => {
                    biasDraft.value = [...biasDraft.value, ['', 0]]
                  }}><PlusIcon /></button>
              </th>
            </tr>
            {#if biasDraft.value.length === 0}
              <tr>
                <td colspan="3" class="text-textcolor2">{language.noBias}</td>
              </tr>
            {/if}
            {#each biasDraft.value as bias, i}
              <tr>
                <td class="font-medium truncate">
                  <TextInput bind:value={biasDraft.value[i][0]} size="lg" fullwidth />
                </td>
                <td class="font-medium truncate">
                  <NumberInput bind:value={biasDraft.value[i][1]} max={100} min={-101} size="lg" fullwidth />
                </td>
                <td>
                  <button
                    class="font-medium flex justify-center items-center h-full cursor-pointer hover:text-green-500 w-full"
                    onclick={() => {
                      biasDraft.value = biasDraft.value.filter((_, index) => index !== i)
                    }}><TrashIcon /></button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
        <div class="text-textcolor2 mt-2 flex items-center gap-2">
          <button
            class="font-medium cursor-pointer hover:text-textcolor gap-2"
            onclick={() => {
              const data = JSON.stringify(biasDraft.value, null, 2)
              downloadFile('bias.json', data)
            }}><DownloadIcon /></button>
          <button class="font-medium cursor-pointer hover:text-textcolor" onclick={importBiasJson}
            ><HardDriveUploadIcon /></button>
        </div>
      </Accordion>
    {/if}

    {#if showModelOthersControls && usesReverseProxyModel}
      <Accordion styled name="{language.additionalParams} " help="additionalParams">
        <table class="contain w-full max-w-full tabler">
          <tbody>
            <tr>
              <th class="font-medium">{language.key}</th>
              <th class="font-medium">{language.value}</th>
              <th>
                <button
                  class="font-medium cursor-pointer hover:text-green-500 w-full flex justify-center items-center"
                  onclick={() => {
                    activeAdditionalParamsDraft.value = [...activeAdditionalParamsDraft.value, ['', '']]
                  }}><PlusIcon /></button>
              </th>
            </tr>
            {#if activeAdditionalParamsDraft.value.length === 0}
              <tr class="text-textcolor2">
                <td colspan="3">{language.noData}</td>
              </tr>
            {/if}
            {#each activeAdditionalParamsDraft.value as additionalParams, i}
              <tr>
                <td class="font-medium truncate">
                  <TextInput bind:value={activeAdditionalParamsDraft.value[i][0]} size="lg" fullwidth />
                </td>
                <td class="font-medium truncate">
                  <TextInput bind:value={activeAdditionalParamsDraft.value[i][1]} size="lg" fullwidth />
                </td>
                <td>
                  <button
                    class="font-medium flex justify-center items-center h-full cursor-pointer hover:text-green-500 w-full"
                    onclick={() => {
                      activeAdditionalParamsDraft.value = activeAdditionalParamsDraft.value.filter(
                        (_, index) => index !== i,
                      )
                    }}><TrashIcon /></button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </Accordion>
    {/if}

    {#if showPromptExtras}
      <Accordion styled name={language.promptTemplate}>
        {#if !promptTemplateHydrated}
          <span class="text-textcolor2">{language.loading}</span>
        {:else if selectedPromptPresetOwnsPromptTemplate}
          <Check check={true} name={language.usePromptTemplate} onChange={setSelectedPromptTemplateEnabled} />
          {#if submenu !== -1}
            <PromptSettings
              mode="inline"
              subMenu={1}
              promptPresetModelOverrideMode={promptOwnsOthers}
              showPromptModelOverrideFields={true} />
          {/if}
        {:else}
          <Check check={false} name={language.usePromptTemplate} onChange={setSelectedPromptTemplateEnabled} />
        {/if}
      </Accordion>
    {/if}

    {#snippet CustomFlagButton(name: string, flag: number)}
      <Button
        className="mt-2"
        onclick={(e) => {
          toggleCustomFlag(flag)
        }}
        styled={customFlagEnabled(flag) ? 'primary' : 'outlined'}>
        {name}
      </Button>
    {/snippet}

    {#if showModelOthersControls}
      <Accordion styled name={language.customFlags}>
        <Check bind:check={activeEnableCustomFlagsDraft.value} name={language.enableCustomFlags} />

        {#if activeEnableCustomFlagsDraft.value}
          {@render CustomFlagButton('hasImageInput', 0)}
          {@render CustomFlagButton('hasImageOutput', 1)}
          {@render CustomFlagButton('hasAudioInput', 2)}
          {@render CustomFlagButton('hasAudioOutput', 3)}
          {@render CustomFlagButton('hasPrefill', 4)}
          {@render CustomFlagButton('hasCache', 5)}
          {@render CustomFlagButton('hasFullSystemPrompt', 6)}
          {@render CustomFlagButton('hasFirstSystemPrompt', 7)}
          {@render CustomFlagButton('hasStreaming', 8)}
          {@render CustomFlagButton('requiresAlternateRole', 9)}
          {@render CustomFlagButton('mustStartWithUserInput', 10)}
          {@render CustomFlagButton('hasVideoInput', 12)}
          {@render CustomFlagButton('OAICompletionTokens', 13)}
          {@render CustomFlagButton('DeveloperRole', 14)}
          {@render CustomFlagButton('geminiThinking', 15)}
          {@render CustomFlagButton('geminiBlockOff', 16)}
          {@render CustomFlagButton('deepSeekPrefix', 17)}
          {@render CustomFlagButton('deepSeekThinkingInput', 18)}
          {@render CustomFlagButton('deepSeekThinkingOutput', 19)}
          {@render CustomFlagButton('noCivilIntegrity', 20)}
          {@render CustomFlagButton('claudeThinking', 21)}
          {@render CustomFlagButton('claudeAdaptiveThinking', 22)}
          {@render CustomFlagButton('deepSeekThinkingToggle', 24)}
        {/if}
      </Accordion>
    {/if}

    {#if showPromptExtras}
      <Accordion styled name={language.moduleIntergration} help="moduleIntergration">
        <TextAreaInput bind:value={moduleIntergrationDraft.value} fullwidth height={'32'} autocomplete="off" />
      </Accordion>
    {/if}

    {#if showModelOthersControls}
      <Accordion styled name={language.tools}>
        <Check
          name={language.search}
          check={(activeModelToolsDraft.value ?? []).includes('search')}
          onChange={() => {
            toggleModelTool('search')
          }} />
      </Accordion>
    {/if}

    {#if showPromptExtras}
      <Accordion styled name={language.regexScript}>
        <RegexList bind:value={presetRegexDraft.value} buttons />
      </Accordion>

      <Accordion styled name={language.icon}>
        <div class="p-2 rounded-md border border-darkborderc flex flex-col items-center gap-2">
          <span>
            {language.preview}
          </span>
          <div class="flex items-center justify-center gap-2">
            {#if selectedPromptPreset?.image}
              <img src={selectedPromptPreset.image} alt="icon" class="w-6 h-6 rounded-md" decoding="async" />
              <span class="text-textcolor2">{selectedPromptPreset.name}</span>
            {:else}
              <span class="text-textcolor2">{language.noImages}</span>
            {/if}
          </div>
        </div>
        <button
          class="mt-2 text-textcolor2 hover:text-textcolor focus-within:text-textcolor"
          onclick={uploadSelectedPromptPresetIcon}>
          <UploadIcon />
        </button>
      </Accordion>
    {/if}
  {/if}

  {#if showModelPresetButton}
    <Button
      onclick={() => {
        openPresetListModal('global', 'model')
      }}
      className="mt-4">{language.modelPresets}</Button>
  {/if}

  {#if sectionVisible(2)}
    {#if !promptTemplateHydrated}
      <span class="text-textcolor2">{language.loading}</span>
    {:else if !selectedPromptPresetOwnsPromptTemplate}
      <span class="text-textcolor">{language.mainPrompt} <Help key="mainprompt" /></span>
      <TextAreaInput fullwidth autocomplete="off" height={'32'} bind:value={mainPromptDraft.value}></TextAreaInput>
      <span class="text-textcolor2 mb-6 text-sm mt-2">{tokens.mainPrompt} {language.tokens}</span>
      <span class="text-textcolor">{language.jailbreakPrompt} <Help key="jailbreak" /></span>
      <TextAreaInput fullwidth autocomplete="off" height={'32'} bind:value={jailbreakDraft.value}></TextAreaInput>
      <span class="text-textcolor2 mb-6 text-sm mt-2">{tokens.jailbreak} {language.tokens}</span>
      <span class="text-textcolor">{language.globalNote} <Help key="globalNote" /></span>
      <TextAreaInput fullwidth autocomplete="off" height={'32'} bind:value={globalNoteDraft.value}></TextAreaInput>
      <span class="text-textcolor2 mb-6 text-sm mt-2">{tokens.globalNote} {language.tokens}</span>
      <span class="text-textcolor mb-2 mt-4">{language.formatingOrder} <Help key="formatOrder" /></span>
      <DropList bind:list={formatingOrderDraft.value} />
      <div class="flex items-center mt-4">
        <Check bind:check={promptPreprocessDraft.value} name={language.promptPreprocess} />
      </div>
    {:else if submenu === 2}
      <PromptSettings mode="inline" />
    {/if}
  {/if}

  {#if promptTemplateHydrated && selectedPromptPresetOwnsPromptTemplate && submenu === -1}
    <div class="mt-2">
      <Button onclick={goPromptTemplate} size="sm">{language.promptTemplate}</Button>
    </div>
  {/if}
  {#if showPromptPresetButton}
    <Button onclick={openPromptPresetList} className="mt-4">{selectedPromptPresetName}</Button>
  {/if}
  {#if showLegacyMigrationButton}
    <Button
      onclick={() => {
        openPresetListModal('global', 'legacy')
      }}
      className="mt-2">{language.legacyBotPresetMigration}</Button>
  {/if}
{/if}
