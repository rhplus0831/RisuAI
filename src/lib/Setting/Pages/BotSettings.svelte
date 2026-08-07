<script module lang="ts">
  let nextBotSettingsFlushId = 1
</script>

<script lang="ts">
  import Check from 'src/lib/UI/GUI/CheckInput.svelte'
  import { language } from 'src/lang'
  import Help from 'src/lib/Others/Help.svelte'

  import { customProviderStore } from 'src/ts/plugins/plugins.svelte'
  import { downloadFile } from 'src/ts/globalApi.svelte'
  import { tokenizeAccurate } from 'src/ts/tokenizer'
  import { FASTIFY_TOKENIZER_OPTIONS } from 'src/ts/model/tokenizerOptions'
  import DropList from 'src/lib/SideBars/DropList.svelte'
  import { PlusIcon, TrashIcon, HardDriveUploadIcon, DownloadIcon, UploadIcon } from '@lucide/svelte'
  import TextInput from 'src/lib/UI/GUI/TextInput.svelte'
  import SecretInput from 'src/lib/UI/GUI/SecretInput.svelte'
  import NumberInput from 'src/lib/UI/GUI/NumberInput.svelte'
  import SliderInput from 'src/lib/UI/GUI/SliderInput.svelte'
  import TextAreaInput from 'src/lib/UI/GUI/TextAreaInput.svelte'
  import Button from 'src/lib/UI/GUI/Button.svelte'
  import SelectInput from 'src/lib/UI/GUI/SelectInput.svelte'
  import OptionInput from 'src/lib/UI/GUI/OptionInput.svelte'
  import CheckInput from 'src/lib/UI/GUI/CheckInput.svelte'
  import SegmentedControl from 'src/lib/UI/GUI/SegmentedControl.svelte'
  import { getOpenRouterModels, toModelGridItem as orToGridItem } from 'src/ts/model/openrouter'
  import { getNanoGPTModelCatalog, toModelGridItem as ngToGridItem } from 'src/ts/model/nanogpt'
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
  import { selectSingleFile } from 'src/ts/filePicker'
  import { getDatabase, updatePromptPreset, type PromptPreset } from 'src/ts/storage/database.svelte'
  import { alertError } from 'src/ts/alert'
  import { getModelInfo, LLMFlags, LLMFormat } from 'src/ts/model/modellist'
  import { resolveModelProfileUiState } from 'src/ts/model/modelProfileUiState'
  import RegexList from 'src/lib/SideBars/Scripts/RegexList.svelte'
  import SettingRenderer from '../SettingRenderer.svelte'
  import { allBasicParameterItems } from 'src/ts/setting/botSettingsParamsData'
  import { reconcileLegacyGuiSubmenu } from 'src/ts/setting/legacyGuiLayout'
  import { confirmSettingsItemRemoval } from 'src/ts/setting/confirmSettingsItemRemoval'
  import SeparateParametersSection from './SeparateParametersSection.svelte'
  import ModelRoleList from './Model/ModelRoleList.svelte'
  import ModelSettingsShell from './Model/ModelSettingsShell.svelte'
  import { onDestroy, onMount, untrack } from 'svelte'
  import { PROMPT_SETTINGS_KEYS } from 'src/ts/promptSettings'
  import { createServerBackedSettingDraft, watchServerBackedSettings } from 'src/ts/server/settingsBridge.svelte'
  import { getServerResourceApplyEpoch, withTrustedResourceWrite } from 'src/ts/server/resourceWriteGuard.svelte'
  import {
    captureSettingsGroupProjectionEpoch,
    hasSettingsGroupProjectionEpochChanged,
    markSettingsGroupAcknowledgementTainted,
  } from 'src/ts/server/resourceState.svelte'
  import {
    canUseServerCommands,
    enablePromptItemsCommand,
    patchPromptSettingsCommand,
    runServerCommand,
    type ServerCommandResult,
    type ServerCommandTransportOptions,
    type SettingsPatch,
  } from 'src/ts/server/commands'
  import { registerPendingBridgePatchFlusher } from 'src/ts/server/pendingBridgeFlushRegistry'
  import { dispatchDurableMutation } from 'src/ts/server/durableMutationDispatch'
  import { SETTINGS_BRIDGE_MUTATION_KEY } from 'src/ts/server/settingsMutationKey'
  import {
    acknowledgePendingMutation,
    stagePendingMutation,
    type DurableMutationIntent,
    type PendingMutationHandle,
  } from 'src/ts/server/pendingMutationOutbox'
  import { subscribeServerCommandLocalEffectApplied } from 'src/ts/server/commandLocalEffectEvents'
  import {
    appliedLocalEffectAcknowledgesSettingDraft,
    serverSettingDraftOwnerKey,
    splitPresetSettingDraftOwnerKey,
  } from 'src/ts/server/settingsDraftAcknowledgement'
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
    dispatchPromptTemplateStructuralMutation,
    flushPendingPromptTemplatePatches,
    promptTemplateOwnerCommandId,
    promptTemplateOwnerMutationKey,
    runPromptTemplateOwnerCommand,
    runPromptTemplateOwnerRollback,
    type PromptTemplateStructuralFinalSettlement,
    type PromptTemplateStructuralMutationOutcome,
    type PromptTemplateStructuralOwnerState,
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
  import { createLatestPromptTokenCounter } from './promptTokenCounter'

  const stopServerSettingsWatch = watchServerBackedSettings(['proxyRequestModel', 'useLegacyGUI'])
  onDestroy(stopServerSettingsWatch)
  const pendingPromptFieldPatch = {
    patch: {} as SettingsPatch,
    previous: {} as SettingsPatch,
    attempted: {} as SettingsPatch,
    durableAttempted: {} as SettingsPatch,
    projectionEpoch: null as number | null,
    intent: null as DurableMutationIntent | null,
    outbox: null as PendingMutationHandle | null,
    timer: null as ReturnType<typeof setTimeout> | null,
  }
  interface PromptFieldPatchAttempt {
    patch: SettingsPatch
    previous: SettingsPatch
    attempted: SettingsPatch
    projectionEpoch: number | null
    settled: boolean
  }
  const unsettledPromptFieldPatches: PromptFieldPatchAttempt[] = []
  const unregisterPendingPromptFieldFlush = registerPendingBridgePatchFlusher(
    `bot-settings-prompt-fields:${nextBotSettingsFlushId++}`,
    flushPendingPromptFieldPatch,
  )
  const PROMPT_SETTINGS_COMMAND_KEYS = new Set<string>(PROMPT_SETTINGS_KEYS)
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
  const halfStreamingDraft = createServerBackedSettingDraft<boolean>('halfStreaming', false)
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

  const PROVIDER_CATALOG_KEY_DEBOUNCE_MS = 400
  let nanogptCatalogApiKey = $state(nanogptKeyDraft.value)
  let openrouterCatalogApiKey = $state(openrouterKeyDraft.value)
  let ollamaCloudCatalogApiKey = $state(ollamaApiKeyDraft.value)

  $effect(() => {
    const nextApiKey = nanogptKeyDraft.value
    if (nextApiKey === nanogptCatalogApiKey) return
    const timer = setTimeout(() => {
      nanogptCatalogApiKey = nextApiKey
    }, PROVIDER_CATALOG_KEY_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  })

  $effect(() => {
    const nextApiKey = openrouterKeyDraft.value
    if (nextApiKey === openrouterCatalogApiKey) return
    const timer = setTimeout(() => {
      openrouterCatalogApiKey = nextApiKey
    }, PROVIDER_CATALOG_KEY_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  })

  $effect(() => {
    const nextApiKey = ollamaApiKeyDraft.value
    if (nextApiKey === ollamaCloudCatalogApiKey) return
    const timer = setTimeout(() => {
      ollamaCloudCatalogApiKey = nextApiKey
    }, PROVIDER_CATALOG_KEY_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  })

  let promptTemplateHydrated = $derived($promptTemplateHydratedStore && isPromptTemplateHydrated())
  let selectedPromptPreset = $derived(getDatabase().promptPresets?.[getDatabase().promptPresetsId])
  let selectedPromptPresetOwnsPromptTemplate = $derived(selectedPromptPresetHasOwnPromptTemplate())
  let selectedPromptTemplateEnabledControl = $state(selectedPromptPresetHasOwnPromptTemplate())
  let promptTemplateToggleMutationState = $state<'idle' | 'saving' | 'queued' | 'failed'>('idle')
  let promptTemplateToggleMutationError = $state('')
  let promptTemplateToggleMutationSequence = 0
  let promptTemplateToggleMutationOwnerId = currentPromptTemplateOwnerId()
  $effect(() => {
    const ownerId = currentPromptTemplateOwnerId()
    if (ownerId !== promptTemplateToggleMutationOwnerId) {
      promptTemplateToggleMutationOwnerId = ownerId
      promptTemplateToggleMutationSequence += 1
      promptTemplateToggleMutationState = 'idle'
      promptTemplateToggleMutationError = ''
    }
    selectedPromptTemplateEnabledControl = selectedPromptPresetOwnsPromptTemplate
  })
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
      previousPluginProvider = provider
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

  function handleNanoGPTSubscriptionModeChange(): void {
    nanogptRequestModelDraft.value = ''
    nanogptRequestModelNameDraft.value = ''
    nanogptProviderDraft.value = ''
  }

  function handleNanoGPTModelSelection(name: string): void {
    nanogptRequestModelNameDraft.value = name
    nanogptProviderDraft.value = ''
  }

  function handleNanoGPTManualModelInput(): void {
    nanogptRequestModelNameDraft.value = ''
    nanogptProviderDraft.value = ''
  }

  function handleNanoGPTApiKeyInput(): void {
    if (nanogptKeyDraft.value) return
    nanogptUseSubscriptionEndpointDraft.value = false
    nanogptSubscriptionStateDraft.value = ''
    nanogptRequestModelDraft.value = ''
    nanogptRequestModelNameDraft.value = ''
    nanogptProviderDraft.value = ''
  }

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
    if (settingsKind !== 'legacy') return
    submenu = reconcileLegacyGuiSubmenu(Boolean(getDatabase().useLegacyGUI), submenu)
  })

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

  const countPromptTokens = createLatestPromptTokenCounter((text) => tokenizeAccurate(text, true))

  async function loadTokenize() {
    const nextTokens = await countPromptTokens({
      mainPrompt: mainPromptDraft.value,
      jailbreak: jailbreakDraft.value,
      globalNote: globalNoteDraft.value,
    })
    if (nextTokens) tokens = nextTokens
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
    let dirtyOwnerKey: string | null = null

    $effect(() => {
      const resourceApplyEpoch = getServerResourceApplyEpoch()
      const resourceApplyChanged = resourceApplyEpoch !== previousResourceApplyEpoch
      const ownerSignature = promptFieldOwnerSignature()
      const serverValue = currentPromptFieldValue(key, fallback)
      const serverSnapshot = snapshotJson(serverValue)
      const draftSnapshot = snapshotJson(draft.value)

      if (ownerSignature !== previousOwnerSignature) {
        clearDirty()
        suppressDraftDispatch = true
        previousDraftDispatchSnapshot = serverSnapshot
        draft.value = cloneJsonValue(serverValue)
        queueMicrotask(() => {
          suppressDraftDispatch = false
        })
      } else {
        if (resourceApplyChanged && dirty && serverSnapshot === draftSnapshot) {
          clearDirty()
        }

        if (serverSnapshot !== previousServerSnapshot && serverSnapshot !== draftSnapshot) {
          suppressDraftDispatch = true
          if (resourceApplyChanged && dirty) {
            reassertDirtyPromptFieldDraftValue(key, draft.value)
          } else {
            clearDirty()
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

    $effect(() =>
      subscribeServerCommandLocalEffectApplied((_event, localEffect) => {
        if (
          !dirty ||
          !appliedLocalEffectAcknowledgesSettingDraft({
            localEffect,
            dirtyOwnerKey,
            currentOwnerKey: currentPromptFieldDraftOwnerKey(key),
            rootKey: key,
            attemptedValue: draft.value,
            currentValue: currentPromptFieldValue(key, fallback),
            splitPresetProjection: 'presetRow',
          })
        ) {
          return
        }
        clearDirty()
      }),
    )

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
        dirtyOwnerKey = mirroredToPreset
          ? currentPromptFieldDraftOwnerKey(key)
          : PROMPT_SETTINGS_COMMAND_KEYS.has(key)
            ? serverSettingDraftOwnerKey(key)
            : `local:${key}`
        if (!mirroredToPreset && PROMPT_SETTINGS_COMMAND_KEYS.has(key)) {
          queuePromptFieldPatch({ [key]: attempted }, { [key]: previous })
        }
        previousServerSnapshot = snapshot
      })
    })

    return draft

    function clearDirty(): void {
      dirty = false
      dirtyOwnerKey = null
    }
  }

  function promptFieldOwnerSignature(): string {
    const selectedIndex = getDatabase().promptPresetsId
    const selectedId =
      Number.isInteger(selectedIndex) && selectedIndex >= 0
        ? getDatabase().promptPresets?.[selectedIndex]?.id
        : undefined
    return selectedId ? `preset:${selectedId}` : 'root'
  }

  function currentPromptFieldDraftOwnerKey(key: string): string {
    const selectedIndex = getDatabase().promptPresetsId
    const selectedId =
      Number.isInteger(selectedIndex) && selectedIndex >= 0
        ? getDatabase().promptPresets?.[selectedIndex]?.id
        : undefined
    return selectedId ? splitPresetSettingDraftOwnerKey('prompt', selectedId, key) : serverSettingDraftOwnerKey(key)
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
        pendingPromptFieldPatch.previous[key] = cloneJsonValue(previous[key])
      }
      pendingPromptFieldPatch.attempted[key] = cloneJsonValue(value)
    }

    if (pendingPromptFieldPatch.timer) clearTimeout(pendingPromptFieldPatch.timer)
    pendingPromptFieldPatch.timer = null
    pendingPromptFieldPatch.projectionEpoch ??= captureSettingsGroupProjectionEpoch('prompt')
    const correctionOnly = refreshPendingPromptFieldDurability()
    if (Object.keys(pendingPromptFieldPatch.patch).length === 0) {
      return
    }
    if (correctionOnly) {
      dispatchPendingPromptFieldPatch()
      return
    }
    pendingPromptFieldPatch.timer = setTimeout(() => {
      dispatchPendingPromptFieldPatch()
    }, 250)
  }

  function flushPendingPromptFieldPatch(options: ServerCommandTransportOptions = {}): void {
    dispatchPendingPromptFieldPatch(options)
  }

  function dispatchPendingPromptFieldPatch(options: ServerCommandTransportOptions = {}): void {
    if (pendingPromptFieldPatch.timer) {
      clearTimeout(pendingPromptFieldPatch.timer)
      pendingPromptFieldPatch.timer = null
    }

    const commandPatch = pendingPromptFieldPatch.patch
    const commandPrevious = pendingPromptFieldPatch.previous
    const commandAttempted = pendingPromptFieldPatch.attempted
    const commandProjectionEpoch = pendingPromptFieldPatch.projectionEpoch
    const commandIntent = pendingPromptFieldPatch.intent
    const commandOutbox = pendingPromptFieldPatch.outbox
    resetPendingPromptFieldPatch()

    if (Object.keys(commandPatch).length === 0 || !commandIntent || !commandOutbox) {
      if (commandOutbox) void acknowledgePendingMutation(commandOutbox)
      return
    }

    const attempt: PromptFieldPatchAttempt = {
      patch: commandPatch,
      previous: commandPrevious,
      attempted: commandAttempted,
      projectionEpoch: commandProjectionEpoch,
      settled: false,
    }
    unsettledPromptFieldPatches.push(attempt)

    void dispatchDurableMutation(commandOutbox, commandIntent, (transport) =>
      runServerCommand({
        command: async (baseRevision) => {
          const result = await patchPromptSettingsCommand(
            {
              baseRevision,
              patch: commandPatch,
              acknowledgeOptimistic: commandProjectionEpoch !== null,
              optimisticProjectionEpoch: commandProjectionEpoch ?? undefined,
            },
            options.signal,
            options.keepalive,
          )
          settlePromptFieldPatchAttempt(attempt, result.status === 'ok')
          return result
        },
        rollback: () => {
          settlePromptFieldPatchAttempt(attempt, false)
          rollbackPromptFields(attempt.previous, attempt.attempted, attempt.projectionEpoch)
        },
        ...options,
        ...transport,
      }),
    ).then((result) => {
      if (!attempt.settled && result.status !== 'ok') settlePromptFieldPatchAttempt(attempt, false)
    })
  }

  function refreshPendingPromptFieldDurability(): boolean {
    const netChangedKeys = changedPromptFieldPatchKeys(
      pendingPromptFieldPatch.previous,
      pendingPromptFieldPatch.attempted,
    )
    const changedFromDurable = pendingPromptFieldPatch.outbox
      ? changedPromptFieldPatchKeys(pendingPromptFieldPatch.durableAttempted, pendingPromptFieldPatch.attempted)
      : new Set<string>()
    const nextPatch: SettingsPatch = {}
    for (const key of new Set([...netChangedKeys, ...changedFromDurable])) {
      if (!Object.prototype.hasOwnProperty.call(pendingPromptFieldPatch.attempted, key)) continue
      const value = pendingPromptFieldPatch.attempted[key]
      if (value === undefined) continue
      nextPatch[key] = cloneJsonValue(value)
    }
    pendingPromptFieldPatch.patch = nextPatch

    if (Object.keys(nextPatch).length === 0) {
      if (pendingPromptFieldPatch.outbox) void acknowledgePendingMutation(pendingPromptFieldPatch.outbox)
      resetPendingPromptFieldPatch()
      return false
    }
    const intent: DurableMutationIntent = {
      version: 1,
      requests: [
        {
          method: 'PATCH',
          path: '/settings/prompt',
          body: { patch: cloneJsonValue(nextPatch) },
        },
      ],
    }
    pendingPromptFieldPatch.intent = intent
    pendingPromptFieldPatch.outbox = stagePendingMutation(
      SETTINGS_BRIDGE_MUTATION_KEY,
      intent,
      pendingPromptFieldPatch.outbox,
    )
    pendingPromptFieldPatch.durableAttempted = cloneJsonValue(pendingPromptFieldPatch.attempted)
    return netChangedKeys.size === 0
  }

  function changedPromptFieldPatchKeys(left: SettingsPatch, right: SettingsPatch): Set<string> {
    const changed = new Set<string>()
    for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
      const leftHas = Object.prototype.hasOwnProperty.call(left, key)
      const rightHas = Object.prototype.hasOwnProperty.call(right, key)
      if (leftHas !== rightHas || snapshotJson(left[key]) !== snapshotJson(right[key])) changed.add(key)
    }
    return changed
  }

  function resetPendingPromptFieldPatch(): void {
    if (pendingPromptFieldPatch.timer) clearTimeout(pendingPromptFieldPatch.timer)
    pendingPromptFieldPatch.patch = {}
    pendingPromptFieldPatch.previous = {}
    pendingPromptFieldPatch.attempted = {}
    pendingPromptFieldPatch.durableAttempted = {}
    pendingPromptFieldPatch.projectionEpoch = null
    pendingPromptFieldPatch.intent = null
    pendingPromptFieldPatch.outbox = null
    pendingPromptFieldPatch.timer = null
  }

  function settlePromptFieldPatchAttempt(attempt: PromptFieldPatchAttempt, accepted: boolean): void {
    if (attempt.settled) return
    attempt.settled = true
    const attemptIndex = unsettledPromptFieldPatches.indexOf(attempt)
    const laterAttempts = attemptIndex < 0 ? [] : unsettledPromptFieldPatches.slice(attemptIndex + 1)
    for (const laterAttempt of laterAttempts) {
      rebasePromptFieldPatchPrevious(laterAttempt.previous, attempt, accepted)
    }
    rebasePromptFieldPatchPrevious(pendingPromptFieldPatch.previous, attempt, accepted)
    if (refreshPendingPromptFieldDurability()) dispatchPendingPromptFieldPatch()
    if (attemptIndex >= 0) unsettledPromptFieldPatches.splice(attemptIndex, 1)
  }

  function rebasePromptFieldPatchPrevious(
    targetPrevious: SettingsPatch,
    settled: PromptFieldPatchAttempt,
    accepted: boolean,
  ): void {
    for (const key of Object.keys(settled.patch)) {
      if (!(key in targetPrevious)) continue
      if (snapshotJson(targetPrevious[key]) !== snapshotJson(settled.attempted[key])) continue
      targetPrevious[key] = cloneJsonValue(accepted ? settled.attempted[key] : settled.previous[key])
    }
  }

  function rollbackPromptFields(
    previous: SettingsPatch,
    attempted: SettingsPatch,
    projectionEpoch: number | null,
  ): void {
    markSettingsGroupAcknowledgementTainted('prompt')
    if (projectionEpoch === null || hasSettingsGroupProjectionEpochChanged('prompt', projectionEpoch)) return
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
    return preset ? Array.isArray(preset.promptTemplate) : Array.isArray(getDatabase().promptTemplate)
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
      if (!Array.isArray(getDatabase().promptTemplate)) {
        return { hasTemplate: false, template: undefined }
      }
      return { hasTemplate: true, template: cloneJsonValue(getDatabase().promptTemplate) }
    }
    const preset = getDatabase().promptPresets?.[getDatabase().promptPresetsId] as Record<string, unknown> | undefined
    if (preset?.id !== ownerId || !Array.isArray(preset.promptTemplate)) {
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

  function promptTemplateToggleOwnerState(snapshot: {
    hasTemplate: boolean
    template: unknown
  }): PromptTemplateStructuralOwnerState {
    return snapshot.hasTemplate
      ? { enabled: true, items: cloneJsonValue(Array.isArray(snapshot.template) ? snapshot.template : []) }
      : { enabled: false }
  }

  function promptTemplateToggleMutationMessage(result: ServerCommandResult): string {
    if (result.status === 'conflict') return language.promptTemplateMutation.commandConflict
    if (result.status === 'unavailable') return language.promptTemplateMutation.commandUnavailable
    if (result.status === 'error') return language.promptTemplateMutation.commandError(result.error)
    return language.promptTemplateMutation.commandUnavailable
  }

  function handlePromptTemplateToggleFinalSettlement(
    sequence: number,
    ownerId: string | null,
    settlement: PromptTemplateStructuralFinalSettlement,
  ): void {
    if (sequence !== promptTemplateToggleMutationSequence || ownerId !== currentPromptTemplateOwnerId()) return
    selectedPromptTemplateEnabledControl = selectedPromptPresetHasOwnPromptTemplate()
    if (settlement === 'accepted') {
      promptTemplateToggleMutationState = 'idle'
      promptTemplateToggleMutationError = ''
      return
    }
    promptTemplateToggleMutationState = 'failed'
    promptTemplateToggleMutationError = language.promptTemplateMutation.replayDiscarded
  }

  function reconcilePromptTemplateToggleOutcome(
    sequence: number,
    outcome: PromptTemplateStructuralMutationOutcome,
  ): void {
    if (sequence !== promptTemplateToggleMutationSequence) return
    if (outcome.status === 'accepted') {
      promptTemplateToggleMutationState = 'idle'
      return
    }
    if (outcome.status === 'queued') {
      promptTemplateToggleMutationState = 'queued'
      return
    }
    promptTemplateToggleMutationState = 'failed'
    promptTemplateToggleMutationError = promptTemplateToggleMutationMessage(outcome.result)
  }

  async function setSelectedPromptTemplateEnabled(enabled: boolean): Promise<void> {
    if (promptTemplateToggleMutationState === 'saving') return
    const ownerId = currentPromptTemplateOwnerId()
    const sequence = ++promptTemplateToggleMutationSequence
    promptTemplateToggleMutationState = 'saving'
    promptTemplateToggleMutationError = ''
    if (!(await ensurePromptTemplateHydrated({ promptPresetId: ownerId }))) {
      if (sequence === promptTemplateToggleMutationSequence) {
        promptTemplateToggleMutationState = 'failed'
        promptTemplateToggleMutationError = language.promptTemplateMutation.commandUnavailable
      }
      return
    }
    if (ownerId !== currentPromptTemplateOwnerId()) return
    if (canUseServerCommands()) flushPendingPromptTemplatePatches()

    const projectionFence = capturePromptTemplateOwnerMutationFence(ownerId)
    const previous = snapshotPromptTemplateOwnerProjection(ownerId)
    setSelectedPromptPresetTemplateProjection(enabled)
    selectedPromptTemplateEnabledControl = enabled
    const attempted = snapshotPromptTemplateOwnerProjection(ownerId)
    const optimisticAcknowledgement = capturePromptItemOptimisticAcknowledgement(projectionFence)
    if (!canUseServerCommands()) return

    const intent: DurableMutationIntent = {
      version: 1,
      requests: [
        {
          method: 'POST',
          path: '/prompt-items/enable',
          body: {
            ...(ownerId ? { promptPresetId: ownerId } : {}),
            enabled,
          },
        },
      ],
    }
    const outbox = stagePendingMutation(promptTemplateOwnerMutationKey(ownerId), intent)
    const outcome = await dispatchPromptTemplateStructuralMutation({
      ownerId,
      operation: {
        kind: 'enable',
        previous: promptTemplateToggleOwnerState(previous),
        attempted: promptTemplateToggleOwnerState(attempted),
      },
      outbox,
      intent,
      dispatch: (transport, rollback) =>
        runServerCommand({
          command: (baseRevision) =>
            runPromptTemplateOwnerCommand(ownerId, () =>
              enablePromptItemsCommand({
                baseRevision,
                promptPresetId: promptTemplateOwnerCommandId(ownerId),
                enabled,
                optimisticAcknowledgement,
              }),
            ),
          rollback,
          ...transport,
        }),
      rollback: () =>
        runPromptTemplateOwnerRollback(
          ownerId,
          () => {
            if (snapshotJson(snapshotPromptTemplateOwnerProjection(ownerId)) !== snapshotJson(attempted)) return false
            restoreSelectedPromptPresetTemplateProjection(previous)
            selectedPromptTemplateEnabledControl = previous.hasTemplate
            return true
          },
          projectionFence,
        ),
      onFinalSettlement: (settlement) => handlePromptTemplateToggleFinalSettlement(sequence, ownerId, settlement),
    })
    reconcilePromptTemplateToggleOutcome(sequence, outcome)
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

    let operation: PromptPresetIconUploadOperation | null = null
    try {
      const selected = await selectSingleFile(['png', 'jpg', 'jpeg', 'webp'], {
        onFileSelected: () => {
          operation = beginPromptPresetIconUpload(target)
        },
      })
      if (!selected || !operation) return

      const activeOperation = operation
      if (!isCurrentPromptPresetIconUpload(activeOperation)) return

      const data = await resizePromptPresetIconFile(selected, activeOperation)
      if (!data) return

      const updateIndex = resolveFreshPromptPresetIconUploadIndex({
        operation: activeOperation,
        freshness: promptPresetIconUploadFreshness(activeOperation),
      })
      if (updateIndex === null) return

      updatePromptPreset(updateIndex, { image: data }) // The 48×48 JPEG data URL is small enough to keep inline.
    } finally {
      if (operation) {
        clearPromptPresetIconUpload(operation)
      }
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

  $effect(() => {
    mainPromptDraft.value
    jailbreakDraft.value
    globalNoteDraft.value
    void loadTokenize()
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
    unregisterPendingPromptFieldFlush()
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
      nanogptProviderDraft.value = ''
      prevNanogptInputMode = nanogptInputMode
    }
  })
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
    <div data-risu-bot-settings-tabs class="flex w-full rounded-md border border-darkborderc mb-4">
      {#if hasSubmenu(0)}
        <button
          aria-pressed={submenu === 0}
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
          aria-pressed={submenu === 1}
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
          aria-pressed={submenu === 2}
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
          aria-pressed={submenu === 3}
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
      <SecretInput
        marginBottom={true}
        size={'sm'}
        placeholder="..."
        ariaLabel="GoogleAI API Key"
        ownerKey="google.accessToken"
        bind:value={googleDraft.value.accessToken} />
    {/if}
    {#if usesVertexAIProvider}
      <span class="text-textcolor">Project ID</span>
      <TextInput
        marginBottom={true}
        size={'sm'}
        placeholder="..."
        ariaLabel="Project ID"
        bind:value={googleDraft.value.projectId}
        oninput={clearVertexToken} />
      <span class="text-textcolor">Vertex Client Email</span>
      <TextInput
        marginBottom={true}
        size={'sm'}
        placeholder="..."
        ariaLabel="Vertex Client Email"
        bind:value={vertexClientEmailDraft.value}
        oninput={clearVertexToken} />
      <span class="text-textcolor">Vertex Private Key</span>
      <SecretInput
        marginBottom={true}
        size={'sm'}
        placeholder="..."
        ariaLabel="Vertex Private Key"
        ownerKey="vertexPrivateKey"
        bind:value={vertexPrivateKeyDraft.value}
        oninput={clearVertexToken} />
      <span class="text-textcolor">Region</span>
      <SelectInput
        ariaLabel="Region"
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
      <SecretInput
        marginBottom={true}
        size={'sm'}
        placeholder="..."
        ariaLabel={`NovelList ${language.apiKey}`}
        ownerKey="novellistAPI"
        bind:value={novellistAPIDraft.value} />
    {/if}
    {#if usesMancerModel}
      <span class="text-textcolor">Mancer {language.apiKey}</span>
      <SecretInput
        marginBottom={true}
        size={'sm'}
        placeholder="..."
        ariaLabel={`Mancer ${language.apiKey}`}
        ownerKey="mancerHeader"
        bind:value={mancerHeaderDraft.value} />
    {/if}
    {#if usesAnthropicProvider}
      <span class="text-textcolor">Claude {language.apiKey}</span>
      <SecretInput
        marginBottom={true}
        size={'sm'}
        placeholder="..."
        ariaLabel={`Claude ${language.apiKey}`}
        ownerKey="claudeAPIKey"
        bind:value={claudeAPIKeyDraft.value} />
    {/if}
    {#if usesMistralProvider}
      <span class="text-textcolor">Mistral {language.apiKey}</span>
      <SecretInput
        marginBottom={true}
        size={'sm'}
        placeholder="..."
        ariaLabel={`Mistral ${language.apiKey}`}
        ownerKey="mistralKey"
        bind:value={mistralKeyDraft.value} />
    {/if}
    {#if usesNovelAIProvider}
      <span class="text-textcolor">NovelAI Bearer Token</span>
      <SecretInput ownerKey="novelai.token" ariaLabel="NovelAI Bearer Token" bind:value={novelaiDraft.value.token} />
    {/if}
    {#if usesReverseProxyModel}
      <span class="text-textcolor mt-2">URL <Help key="forceUrl" /></span>
      <TextInput
        marginBottom={false}
        size={'sm'}
        ariaLabel="URL"
        bind:value={forceReplaceUrlDraft.value}
        placeholder="https//..." />
      <span class="text-textcolor mt-4"> {language.proxyAPIKey}</span>
      <SecretInput
        marginBottom={false}
        size={'sm'}
        placeholder="leave it blank if it hasn't password"
        ariaLabel={language.proxyAPIKey}
        ownerKey="proxyKey"
        bind:value={proxyKeyDraft.value} />
      <span class="text-textcolor mt-4"> {language.proxyRequestModel}</span>
      <TextInput
        marginBottom={false}
        size={'sm'}
        ariaLabel={language.proxyRequestModel}
        bind:value={customProxyRequestModelDraft.value}
        placeholder="Name" />
      <span class="text-textcolor mt-4"> {language.format}</span>
      <SelectInput
        ariaLabel={language.format}
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
      <SecretInput
        ownerKey="cohereAPIKey"
        marginBottom={false}
        size={'sm'}
        ariaLabel={`Cohere ${language.apiKey}`}
        bind:value={cohereAPIKeyDraft.value} />
    {/if}
    {#if usesOllamaLocal || usesOllamaCloud}
      {#if usesOllamaLocal}
        <span class="text-textcolor mt-4">Ollama URL</span>
        <TextInput marginBottom={false} size={'sm'} ariaLabel="Ollama URL" bind:value={ollamaURLDraft.value} />
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
            ariaLabel={`Ollama ${language.model}`}
            bind:value={ollamaCloudModelDraft.value}
            placeholder="Model"
            oninput={() => (ollamaCloudModelNameDraft.value = '')} />
        {:else}
          {#await getOllamaModels(ollamaURLDraft.value, 'cloud', ollamaCloudCatalogApiKey)}
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
        <SecretInput
          ownerKey="ollamaApiKey"
          marginBottom={false}
          size={'sm'}
          ariaLabel={`Ollama ${language.apiKey}`}
          bind:value={ollamaApiKeyDraft.value} />

        <span class="text-textcolor mt-4">Ollama {language.format}</span>
        <SelectInput
          ariaLabel={`Ollama ${language.format}`}
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
          <CheckInput bind:check={halfStreamingDraft.value} name={language.halfStreaming} />
        </div>
      {/if}

      {#if usesOllamaLocal}
        <span class="text-textcolor mt-4">Ollama Model</span>
        <TextInput
          marginBottom={false}
          size={'sm'}
          ariaLabel="Ollama Model"
          bind:value={ollamaModelDraft.value}
          placeholder="Model"
          oninput={() => {
            ollamaModelSourceDraft.value = 'local'
            ollamaModelNameDraft.value = ''
          }} />
      {/if}

      {#if usesOllamaLocal || (usesOllamaCloud && ollamaRequestFormatDraft.value === LLMFormat.Ollama)}
        <span class="text-textcolor mt-4">Ollama Thinking</span>
        <SelectInput ariaLabel="Ollama Thinking" bind:value={ollamaThinkingModeDraft.value}>
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
      <SecretInput
        ownerKey="nanogptKey"
        marginBottom={false}
        size={'sm'}
        ariaLabel={`NanoGPT ${language.apiKey}`}
        oninput={handleNanoGPTApiKeyInput}
        bind:value={nanogptKeyDraft.value} />

      <NanoGPTDashboard apiKey={nanogptCatalogApiKey} currentApiKey={nanogptKeyDraft.value} />

      {#if nanogptSubscriptionStateDraft.value === 'active' || nanogptSubscriptionStateDraft.value === 'grace'}
        <div class="flex items-center mt-3">
          <CheckInput
            bind:check={nanogptUseSubscriptionEndpointDraft.value}
            onChange={handleNanoGPTSubscriptionModeChange}
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
          ariaLabel={`NanoGPT ${language.model}`}
          bind:value={nanogptRequestModelDraft.value}
          placeholder={(language as any).nanoGPTManualModelSelect || 'Manual Model Select'}
          oninput={handleNanoGPTManualModelInput} />
      {:else}
        {#await getNanoGPTModelCatalog(nanogptCatalogApiKey, nanogptUseSubscriptionEndpointDraft.value)}
          <ModelGrid bind:value={nanogptRequestModelDraft.value} loading={true} />
        {:then models}
          <ModelGrid
            bind:value={nanogptRequestModelDraft.value}
            items={(models ?? []).map(ngToGridItem)}
            showSubBadge={nanogptUseSubscriptionEndpointDraft.value}
            selectedLabelOverride={nanogptRequestModelDraft.value && !nanogptRequestModelNameDraft.value
              ? nanogptRequestModelDraft.value
              : undefined}
            onselect={(_id, name) => {
              handleNanoGPTModelSelection(name)
            }} />
          {#if !nanogptUseSubscriptionEndpointDraft.value}
            <NanoGPTProviderPicker
              apiKey={nanogptCatalogApiKey}
              modelId={nanogptRequestModelDraft.value}
              bind:value={nanogptProviderDraft.value} />
          {/if}
        {/await}
      {/if}
    {/if}
    {#if usesOpenRouterModel}
      <span class="text-textcolor mt-4">OpenRouter {language.apiKey}</span>
      <SecretInput
        ownerKey="openrouterKey"
        marginBottom={false}
        size={'sm'}
        ariaLabel={`OpenRouter ${language.apiKey}`}
        bind:value={openrouterKeyDraft.value} />

      <span class="text-textcolor mt-4">OpenRouter {language.model}</span>
      {#await getOpenRouterModels({ apiKey: openrouterCatalogApiKey })}
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
      <SelectInput ariaLabel={language.tokenizer} bind:value={customTokenizerDraft.value}>
        {#each FASTIFY_TOKENIZER_OPTIONS as option (option.value)}
          <OptionInput value={option.value}>{language.tokenizerOptions[option.labelKey]}</OptionInput>
        {/each}
      </SelectInput>
    {/if}
    {#if usesOpenAIProvider}
      <span class="text-textcolor">OpenAI {language.apiKey} <Help key="oaiapikey" /></span>
      <SecretInput
        marginBottom={false}
        size={'sm'}
        ariaLabel={`OpenAI ${language.apiKey}`}
        ownerKey="openAIKey"
        bind:value={openAIKeyDraft.value}
        placeholder="sk-XXXXXXXXXXXXXXXXXXXX" />
    {/if}

    {#each effectiveRoleApiKeyModels as apiKeyModel (apiKeyModel.keyIdentifier)}
      <span class="text-textcolor">{apiKeyModel.name} {language.apiKey}</span>
      <SecretInput
        marginBottom={false}
        size={'sm'}
        ariaLabel={`${apiKeyModel.name} ${language.apiKey}`}
        ownerKey={`OaiCompAPIKeys.${apiKeyModel.keyIdentifier}`}
        bind:value={OaiCompAPIKeysDraft.value[apiKeyModel.keyIdentifier]}
        placeholder="..." />
    {/each}

    <div class="py-2 flex flex-col gap-2 mb-4">
      {#if !usesOllamaCloud && usesStreamingModel}
        <Check bind:check={useStreamingDraft.value} name={`Response ${language.streaming}`} />
        <Check bind:check={halfStreamingDraft.value} name={language.halfStreaming} />

        {#if (useStreamingDraft.value || halfStreamingDraft.value) && usesGeminiThinkingModel}
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
      <SelectInput
        className="mt-2 mb-4"
        ariaLabel={language.plugin}
        value={currentPluginProviderDraft}
        onchange={(event) => {
          currentPluginProviderDraft = event.currentTarget.value
        }}>
        <OptionInput value="">None</OptionInput>
        {#each $customProviderStore as plugin}
          <OptionInput value={plugin}>{plugin}</OptionInput>
        {/each}
      </SelectInput>
    {/if}

    {#if usesKoboldModel}
      <span class="text-textcolor">Kobold URL</span>
      <TextInput marginBottom={true} ariaLabel="Kobold URL" bind:value={koboldURLDraft.value} />
    {/if}

    {#if usesEchoModel}
      <span class="text-textcolor mt-2">Echo Message</span>
      <TextAreaInput
        margin="bottom"
        ariaLabel="Echo Message"
        bind:value={echoMessageDraft.value}
        placeholder={"The message you want to receive as the bot's response\n(e.g., Lumi tilts her head, her white hair sliding down as her pretty green and aqua eyes sparkle…)"} />
      <span class="text-textcolor mt-2">Echo Delay (Seconds)</span>
      <NumberInput marginBottom={true} ariaLabel="Echo Delay (Seconds)" bind:value={echoDelayDraft.value} min={0} />
    {/if}

    {#if usesHordeModel}
      <span class="text-textcolor">Horde {language.apiKey}</span>
      <SecretInput
        ownerKey="hordeConfig.apiKey"
        marginBottom={true}
        ariaLabel={`Horde ${language.apiKey}`}
        bind:value={hordeConfigDraft.value.apiKey} />
    {/if}
    {#if usesTextgenWebUIModel || usesMancerModel}
      <span class="text-textcolor mt-2">Blocking {language.providerURL}</span>
      <TextInput
        marginBottom={true}
        ariaLabel={`Blocking ${language.providerURL}`}
        bind:value={textgenWebUIBlockingURLDraft.value}
        placeholder="https://..." />
      <span class="text-draculared text-xs mb-2">You must use textgen webui with --public-api</span>
      <span class="text-textcolor mt-2">Stream {language.providerURL}</span>
      <TextInput
        marginBottom={true}
        ariaLabel={`Stream ${language.providerURL}`}
        bind:value={textgenWebUIStreamURLDraft.value}
        placeholder="wss://..." />
      <span class="text-draculared text-xs mb-2"
        >To reach a local WebUI from the browser, use ngrok or other tunnels.</span>
      <span class="text-draculared text-xs mb-2"
        >Warning: For Ooba version over 1.7, use "Ooba" as model, and use url like
        http://127.0.0.1:5000/v1/chat/completions</span>
    {/if}
    {#if usesOobaModel}
      <span class="text-textcolor mt-2">Ooba {language.providerURL}</span>
      <TextInput
        marginBottom={true}
        ariaLabel={`Ooba ${language.providerURL}`}
        bind:value={textgenWebUIBlockingURLDraft.value}
        placeholder="https://..." />
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
      <span class="text-textcolor">{language.modelProfiles.runtimeFields.repetitionPenalty}</span>
      <SliderInput
        min={1}
        max={1.5}
        step={0.01}
        fixed={2}
        marginBottom
        bind:value={activeOobaDraft.value.repetition_penalty}
        ariaLabel={language.modelProfiles.runtimeFields.repetitionPenalty} />
      <span class="text-textcolor">{language.modelProfiles.runtimeFields.lengthPenalty}</span>
      <SliderInput
        min={-5}
        max={5}
        step={0.05}
        marginBottom
        fixed={2}
        bind:value={activeOobaDraft.value.length_penalty}
        ariaLabel={language.modelProfiles.runtimeFields.lengthPenalty} />
      <span class="text-textcolor">Top K</span>
      <SliderInput
        min={0}
        max={100}
        step={1}
        marginBottom
        bind:value={activeOobaDraft.value.top_k}
        ariaLabel={language.modelProfiles.runtimeFields.topK} />
      <span class="text-textcolor">Top P</span>
      <SliderInput
        min={0}
        max={1}
        step={0.01}
        marginBottom
        fixed={2}
        bind:value={activeOobaDraft.value.top_p}
        ariaLabel={language.modelProfiles.runtimeFields.topP} />
      <span class="text-textcolor">{language.modelProfiles.runtimeFields.typicalP}</span>
      <SliderInput
        min={0}
        max={1}
        step={0.01}
        marginBottom
        fixed={2}
        bind:value={activeOobaDraft.value.typical_p}
        ariaLabel={language.modelProfiles.runtimeFields.typicalP} />
      <span class="text-textcolor">Top A</span>
      <SliderInput
        min={0}
        max={1}
        step={0.01}
        marginBottom
        fixed={2}
        bind:value={activeOobaDraft.value.top_a}
        ariaLabel={language.modelProfiles.runtimeFields.topA} />
      <span class="text-textcolor">{language.modelProfiles.runtimeFields.noRepeatNgramSize}</span>
      <SliderInput
        min={0}
        max={20}
        step={1}
        marginBottom
        bind:value={activeOobaDraft.value.no_repeat_ngram_size}
        ariaLabel={language.modelProfiles.runtimeFields.noRepeatNgramSize} />
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
              aria-label={`${language.add}: ${language.customStopWords}`}
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
                <TextInput
                  marginBottom
                  ariaLabel={`${language.customStopWords} ${i + 1}`}
                  bind:value={activeLocalStopStringsDraft.value[i]}
                  fullwidth
                  fullh />
              </div>
              <div>
                <button
                  aria-label={`${language.remove}: ${language.customStopWords} ${i + 1}`}
                  class="font-medium flex justify-center items-center h-full cursor-pointer hover:text-green-500 w-full"
                  onclick={() => {
                    if (!confirmSettingsItemRemoval()) return
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
        <TextInput ariaLabel="Starter" bind:value={activeNAIsettingsDraft.value.starter} placeholder={'⁂'} />
        <span class="text-textcolor">Seperator</span>
        <TextInput ariaLabel="Seperator" bind:value={activeNAIsettingsDraft.value.seperator} placeholder={'\\n'} />
      </div>
      <span class="text-textcolor">Top P</span>
      <SliderInput
        min={0}
        max={1}
        step={0.01}
        marginBottom
        fixed={2}
        bind:value={activeNAIsettingsDraft.value.topP}
        ariaLabel={language.modelProfiles.runtimeFields.topP} />
      <span class="text-textcolor">Top K</span>
      <SliderInput
        min={0}
        max={100}
        step={1}
        marginBottom
        bind:value={activeNAIsettingsDraft.value.topK}
        ariaLabel={language.modelProfiles.runtimeFields.topK} />
      <span class="text-textcolor">Top A</span>
      <SliderInput
        min={0}
        max={1}
        step={0.01}
        marginBottom
        fixed={2}
        bind:value={activeNAIsettingsDraft.value.topA}
        ariaLabel={language.modelProfiles.runtimeFields.topA} />
      <span class="text-textcolor">{language.modelProfiles.runtimeFields.tailFreeSampling}</span>
      <SliderInput
        min={0}
        max={1}
        step={0.001}
        marginBottom
        fixed={3}
        bind:value={activeNAIsettingsDraft.value.tailFreeSampling}
        ariaLabel={language.modelProfiles.runtimeFields.tailFreeSampling} />
      <span class="text-textcolor">{language.modelProfiles.runtimeFields.typicalP}</span>
      <SliderInput
        min={0}
        max={1}
        step={0.01}
        marginBottom
        fixed={2}
        bind:value={activeNAIsettingsDraft.value.typicalp}
        ariaLabel={language.modelProfiles.runtimeFields.typicalP} />
      <span class="text-textcolor">{language.modelProfiles.runtimeFields.repetitionPenalty}</span>
      <SliderInput
        min={0}
        max={3}
        step={0.01}
        marginBottom
        fixed={2}
        bind:value={activeNAIsettingsDraft.value.repetitionPenalty}
        ariaLabel={language.modelProfiles.runtimeFields.repetitionPenalty} />
      <span class="text-textcolor">{language.modelProfiles.runtimeFields.repetitionPenaltyRange}</span>
      <SliderInput
        min={0}
        max={8192}
        step={1}
        marginBottom
        fixed={0}
        bind:value={activeNAIsettingsDraft.value.repetitionPenaltyRange}
        ariaLabel={language.modelProfiles.runtimeFields.repetitionPenaltyRange} />
      <span class="text-textcolor">{language.modelProfiles.runtimeFields.repetitionPenaltySlope}</span>
      <SliderInput
        min={0}
        max={10}
        step={0.01}
        marginBottom
        fixed={2}
        bind:value={activeNAIsettingsDraft.value.repetitionPenaltySlope}
        ariaLabel={language.modelProfiles.runtimeFields.repetitionPenaltySlope} />
      <span class="text-textcolor">{language.modelProfiles.runtimeFields.frequencyPenalty}</span>
      <SliderInput
        min={-2}
        max={2}
        step={0.01}
        marginBottom
        fixed={2}
        bind:value={activeNAIsettingsDraft.value.frequencyPenalty}
        ariaLabel={language.modelProfiles.runtimeFields.frequencyPenalty} />
      <span class="text-textcolor">{language.modelProfiles.runtimeFields.presencePenalty}</span>
      <SliderInput
        min={-2}
        max={2}
        step={0.01}
        marginBottom
        fixed={2}
        bind:value={activeNAIsettingsDraft.value.presencePenalty}
        ariaLabel={language.modelProfiles.runtimeFields.presencePenalty} />
      <span class="text-textcolor">{language.modelProfiles.runtimeFields.mirostatLearningRate}</span>
      <SliderInput
        min={0}
        max={1}
        step={0.01}
        marginBottom
        fixed={2}
        bind:value={activeNAIsettingsDraft.value.mirostat_lr}
        ariaLabel={language.modelProfiles.runtimeFields.mirostatLearningRate} />
      <span class="text-textcolor">{language.modelProfiles.runtimeFields.mirostatTau}</span>
      <SliderInput
        min={0}
        max={6}
        step={0.01}
        marginBottom
        fixed={2}
        bind:value={activeNAIsettingsDraft.value.mirostat_tau}
        ariaLabel={language.modelProfiles.runtimeFields.mirostatTau} />
      <span class="text-textcolor">{language.modelProfiles.runtimeFields.cfgScale}</span>
      <SliderInput
        min={1}
        max={3}
        step={0.01}
        marginBottom
        fixed={2}
        bind:value={activeNAIsettingsDraft.value.cfg_scale}
        ariaLabel={language.modelProfiles.runtimeFields.cfgScale} />
    {:else if modelInfo.format === LLMFormat.NovelList}
      <span class="text-textcolor">Top P</span>
      <SliderInput
        min={0}
        max={2}
        step={0.01}
        marginBottom
        fixed={2}
        bind:value={activeAinconfigDraft.value.top_p}
        ariaLabel={language.modelProfiles.runtimeFields.topP} />
      <span class="text-textcolor">{language.modelProfiles.runtimeFields.repetitionPenalty}</span>
      <SliderInput
        min={0}
        max={2}
        step={0.01}
        marginBottom
        fixed={2}
        bind:value={activeAinconfigDraft.value.rep_pen}
        ariaLabel={language.modelProfiles.runtimeFields.repetitionPenalty} />
      <span class="text-textcolor">{language.modelProfiles.runtimeFields.repetitionPenaltyRange}</span>
      <SliderInput
        min={0}
        max={2048}
        step={1}
        marginBottom
        fixed={2}
        bind:value={activeAinconfigDraft.value.rep_pen_range}
        ariaLabel={language.modelProfiles.runtimeFields.repetitionPenaltyRange} />
      <span class="text-textcolor">{language.modelProfiles.runtimeFields.repetitionPenaltySlope}</span>
      <SliderInput
        min={0}
        max={10}
        step={0.1}
        marginBottom
        fixed={2}
        bind:value={activeAinconfigDraft.value.rep_pen_slope}
        ariaLabel={language.modelProfiles.runtimeFields.repetitionPenaltySlope} />
      <span class="text-textcolor">Top K</span>
      <SliderInput
        min={1}
        max={500}
        step={1}
        marginBottom
        fixed={2}
        bind:value={activeAinconfigDraft.value.top_k}
        ariaLabel={language.modelProfiles.runtimeFields.topK} />
      <span class="text-textcolor">Top A</span>
      <SliderInput
        min={0}
        max={1}
        step={0.01}
        marginBottom
        fixed={2}
        bind:value={activeAinconfigDraft.value.top_a}
        ariaLabel={language.modelProfiles.runtimeFields.topA} />
      <span class="text-textcolor">{language.modelProfiles.runtimeFields.typicalP}</span>
      <SliderInput
        min={0}
        max={1}
        step={0.01}
        marginBottom
        fixed={2}
        bind:value={activeAinconfigDraft.value.typical_p}
        ariaLabel={language.modelProfiles.runtimeFields.typicalP} />
    {:else}
      <!-- Standard parameters come from SettingRenderer. -->
    {/if}

    {#if (getDatabase().reverseProxyOobaMode && usesReverseProxyModel) || usesOobaModel}
      <OobaSettings instructionMode={usesOobaModel} />
    {/if}

    {#if usesOpenRouterModel}
      <OpenrouterSettings apiKey={openrouterCatalogApiKey} />
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
                  aria-label={`${language.add}: Bias`}
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
                  <TextInput ariaLabel={`Bias ${i + 1}`} bind:value={biasDraft.value[i][0]} size="lg" fullwidth />
                </td>
                <td class="font-medium truncate">
                  <NumberInput
                    ariaLabel={`${language.value} ${i + 1}`}
                    bind:value={biasDraft.value[i][1]}
                    max={100}
                    min={-101}
                    size="lg"
                    fullwidth />
                </td>
                <td>
                  <button
                    aria-label={`${language.remove}: Bias ${i + 1}`}
                    class="font-medium flex justify-center items-center h-full cursor-pointer hover:text-green-500 w-full"
                    onclick={() => {
                      if (!confirmSettingsItemRemoval()) return
                      biasDraft.value = biasDraft.value.filter((_, index) => index !== i)
                    }}><TrashIcon /></button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
        <div class="text-textcolor2 mt-2 flex items-center gap-2">
          <button
            aria-label={`${language.export}: Bias`}
            class="font-medium cursor-pointer hover:text-textcolor gap-2"
            onclick={() => {
              const data = JSON.stringify(biasDraft.value, null, 2)
              downloadFile('bias.json', data)
            }}><DownloadIcon /></button>
          <button
            aria-label={`${language.import}: Bias`}
            class="font-medium cursor-pointer hover:text-textcolor"
            onclick={importBiasJson}><HardDriveUploadIcon /></button>
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
                  aria-label={`${language.add}: ${language.additionalParams}`}
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
                  <TextInput
                    ariaLabel={`${language.key} ${i + 1}`}
                    bind:value={activeAdditionalParamsDraft.value[i][0]}
                    size="lg"
                    fullwidth />
                </td>
                <td class="font-medium truncate">
                  <TextInput
                    ariaLabel={`${language.value} ${i + 1}`}
                    bind:value={activeAdditionalParamsDraft.value[i][1]}
                    size="lg"
                    fullwidth />
                </td>
                <td>
                  <button
                    aria-label={`${language.remove}: ${language.additionalParams} ${i + 1}`}
                    class="font-medium flex justify-center items-center h-full cursor-pointer hover:text-green-500 w-full"
                    onclick={() => {
                      if (!confirmSettingsItemRemoval()) return
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
        {:else}
          <Check
            bind:check={selectedPromptTemplateEnabledControl}
            name={language.usePromptTemplate}
            disabled={promptTemplateToggleMutationState === 'saving'}
            onChange={setSelectedPromptTemplateEnabled} />
          {#if promptTemplateToggleMutationState === 'failed'}
            <div class="mt-2 text-sm text-red-500" role="alert" data-testid="prompt-template-toggle-mutation-status">
              {promptTemplateToggleMutationError}
            </div>
          {/if}
          {#if selectedPromptPresetOwnsPromptTemplate && submenu !== -1}
            <PromptSettings
              mode="inline"
              subMenu={1}
              promptPresetModelOverrideMode={promptOwnsOthers}
              showPromptModelOverrideFields={true} />
          {/if}
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
          {@render CustomFlagButton('claudeXHighEffort', 23)}
          {@render CustomFlagButton('deepSeekThinkingToggle', 24)}
        {/if}
      </Accordion>
    {/if}

    {#if showPromptExtras}
      <Accordion styled name={language.moduleIntergration} help="moduleIntergration">
        <TextAreaInput
          ariaLabel={language.moduleIntergration}
          bind:value={moduleIntergrationDraft.value}
          fullwidth
          height={'32'}
          autocomplete="off" />
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
        <RegexList bind:value={presetRegexDraft.value} ownerKey={promptFieldOwnerSignature()} buttons />
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
          aria-label={`${language.import}: ${language.icon}`}
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
      <TextAreaInput
        fullwidth
        autocomplete="off"
        height={'32'}
        ariaLabel={language.mainPrompt}
        bind:value={mainPromptDraft.value}></TextAreaInput>
      <span class="text-textcolor2 mb-6 text-sm mt-2">{tokens.mainPrompt} {language.tokens}</span>
      <span class="text-textcolor">{language.jailbreakPrompt} <Help key="jailbreak" /></span>
      <TextAreaInput
        fullwidth
        autocomplete="off"
        height={'32'}
        ariaLabel={language.jailbreakPrompt}
        bind:value={jailbreakDraft.value}></TextAreaInput>
      <span class="text-textcolor2 mb-6 text-sm mt-2">{tokens.jailbreak} {language.tokens}</span>
      <span class="text-textcolor">{language.globalNote} <Help key="globalNote" /></span>
      <TextAreaInput
        fullwidth
        autocomplete="off"
        height={'32'}
        ariaLabel={language.globalNote}
        bind:value={globalNoteDraft.value}></TextAreaInput>
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
