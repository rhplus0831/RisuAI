<script lang="ts">
  import Check from 'src/lib/UI/GUI/CheckInput.svelte'
  import { language } from 'src/lang'
  import Help from 'src/lib/Others/Help.svelte'

  import { DBState } from 'src/ts/stores.svelte'
  import { customProviderStore } from 'src/ts/plugins/plugins.svelte'
  import { downloadFile } from 'src/ts/globalApi.svelte'
  import { tokenizeAccurate, tokenizerList } from 'src/ts/tokenizer'
  import ModelList from 'src/lib/UI/ModelList.svelte'
  import DropList from 'src/lib/SideBars/DropList.svelte'
  import {
    PlusIcon,
    TrashIcon,
    HardDriveUploadIcon,
    DownloadIcon,
    UploadIcon,
  } from '@lucide/svelte'
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
  import {
    getNanoGPTModels,
    getNanoGPTSubscriptionModels,
    toModelGridItem as ngToGridItem,
  } from 'src/ts/model/nanogpt'
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
  import { openPresetList } from 'src/ts/stores.svelte'
  import { selectSingleFile } from 'src/ts/util'
  import { updatePreset } from 'src/ts/storage/database.svelte'
  import { getModelInfo, LLMFlags, LLMFormat, LLMProvider } from 'src/ts/model/modellist'
  import RegexList from 'src/lib/SideBars/Scripts/RegexList.svelte'
  import SettingRenderer from '../SettingRenderer.svelte'
  import { allBasicParameterItems } from 'src/ts/setting/botSettingsParamsData'
  import SeparateParametersSection from './SeparateParametersSection.svelte'
  import AuxModelSelectors from './Model/AuxModelSelectors.svelte'
  import { onDestroy, untrack } from 'svelte'
  import {
    createServerBackedSettingDraft,
    watchServerBackedSettings,
  } from 'src/ts/server/settingsBridge.svelte'
  import { withTrustedServerProjectionWrite } from 'src/ts/server/projectionWriteGuard.svelte'
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

  const stopServerSettingsWatch = watchServerBackedSettings([
    'proxyRequestModel',
    'hideApiKey',
    'useLegacyGUI',
  ])
  onDestroy(stopServerSettingsWatch)
  const pendingPromptFieldPatch = {
    patch: {} as SettingsPatch,
    previous: {} as SettingsPatch,
    attempted: {} as SettingsPatch,
    timer: null as ReturnType<typeof setTimeout> | null,
  }
  const oobaDraft = createServerBackedSettingDraft<Record<string, any>>('ooba', { formating: {} })
  const localStopStringsDraft = createServerBackedSettingDraft<string[] | null>(
    'localStopStrings',
    null,
  )
  const NAIsettingsDraft = createServerBackedSettingDraft<Record<string, any>>('NAIsettings', {})
  const ainconfigDraft = createServerBackedSettingDraft<Record<string, any>>('ainconfig', {})
  const biasDraft = createServerBackedSettingDraft<Array<[string, number]>>('bias', [])
  const additionalParamsDraft = createServerBackedSettingDraft<Array<[string, string]>>(
    'additionalParams',
    [],
  )
  const aiModelDraft = createServerBackedSettingDraft<string>('aiModel', '')
  const subModelDraft = createServerBackedSettingDraft<string>('subModel', '')
  const googleDraft = createServerBackedSettingDraft<Record<string, string>>('google', {
    accessToken: '',
    projectId: '',
  })
  const vertexClientEmailDraft = createServerBackedSettingDraft<string>('vertexClientEmail', '')
  const vertexPrivateKeyDraft = createServerBackedSettingDraft<string>('vertexPrivateKey', '')
  const vertexAccessTokenDraft = createServerBackedSettingDraft<string>('vertexAccessToken', '')
  const vertexAccessTokenExpiresDraft = createServerBackedSettingDraft<number>(
    'vertexAccessTokenExpires',
    0,
  )
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
  const customProxyRequestModelDraft = createServerBackedSettingDraft<string>(
    'customProxyRequestModel',
    '',
  )
  const customAPIFormatDraft = createServerBackedSettingDraft<LLMFormat>(
    'customAPIFormat',
    LLMFormat.OpenAICompatible,
  )
  const cohereAPIKeyDraft = createServerBackedSettingDraft<string>('cohereAPIKey', '')
  const ollamaURLDraft = createServerBackedSettingDraft<string>('ollamaURL', '')
  const ollamaInputModeDraft = createServerBackedSettingDraft<'list' | 'manual'>(
    'ollamaInputMode',
    'list',
  )
  const ollamaCloudModelDraft = createServerBackedSettingDraft<string>('ollamaCloudModel', '')
  const ollamaModelSourceDraft = createServerBackedSettingDraft<'local' | 'cloud'>(
    'ollamaModelSource',
    'local',
  )
  const ollamaCloudModelNameDraft = createServerBackedSettingDraft<string>(
    'ollamaCloudModelName',
    '',
  )
  const ollamaApiKeyDraft = createServerBackedSettingDraft<string>('ollamaApiKey', '')
  const ollamaRequestFormatDraft = createServerBackedSettingDraft<LLMFormat>(
    'ollamaRequestFormat',
    LLMFormat.Ollama,
  )
  const ollamaModelDraft = createServerBackedSettingDraft<string>('ollamaModel', '')
  const ollamaModelNameDraft = createServerBackedSettingDraft<string>('ollamaModelName', '')
  const ollamaThinkingModeDraft = createServerBackedSettingDraft<
    'auto' | 'off' | 'on' | 'low' | 'medium' | 'high'
  >('ollamaThinkingMode', 'auto')
  const useStreamingDraft = createServerBackedSettingDraft<boolean>('useStreaming', false)
  const streamGeminiThoughtsDraft = createServerBackedSettingDraft<boolean>(
    'streamGeminiThoughts',
    false,
  )
  const nanogptKeyDraft = createServerBackedSettingDraft<string>('nanogptKey', '')
  const nanogptUseSubscriptionEndpointDraft = createServerBackedSettingDraft<boolean>(
    'nanogptUseSubscriptionEndpoint',
    false,
  )
  const nanogptSubscriptionStateDraft = createServerBackedSettingDraft<string>(
    'nanogptSubscriptionState',
    '',
  )
  const nanogptRequestModelDraft = createServerBackedSettingDraft<string>('nanogptRequestModel', '')
  const nanogptRequestModelNameDraft = createServerBackedSettingDraft<string>(
    'nanogptRequestModelName',
    '',
  )
  const nanogptProviderDraft = createServerBackedSettingDraft<string>('nanogptProvider', '')
  const openrouterKeyDraft = createServerBackedSettingDraft<string>('openrouterKey', '')
  const openrouterRequestModelDraft = createServerBackedSettingDraft<string>(
    'openrouterRequestModel',
    '',
  )
  const customTokenizerDraft = createServerBackedSettingDraft<string>('customTokenizer', '')
  const openAIKeyDraft = createServerBackedSettingDraft<string>('openAIKey', '')
  const OaiCompAPIKeysDraft = createServerBackedSettingDraft<Record<string, string>>(
    'OaiCompAPIKeys',
    {},
  )
  const reverseProxyOobaModeDraft = createServerBackedSettingDraft<boolean>(
    'reverseProxyOobaMode',
    false,
  )
  const NAIadventureDraft = createServerBackedSettingDraft<boolean>('NAIadventure', false)
  const NAIappendNameDraft = createServerBackedSettingDraft<boolean>('NAIappendName', false)
  const koboldURLDraft = createServerBackedSettingDraft<string>('koboldURL', '')
  const echoMessageDraft = createServerBackedSettingDraft<string>('echoMessage', '')
  const echoDelayDraft = createServerBackedSettingDraft<number>('echoDelay', 0)
  const hordeConfigDraft = createServerBackedSettingDraft<Record<string, string>>('hordeConfig', {
    apiKey: '',
    model: '',
    softPrompt: '',
  })
  const textgenWebUIStreamURLDraft = createServerBackedSettingDraft<string>(
    'textgenWebUIStreamURL',
    '',
  )
  const textgenWebUIBlockingURLDraft = createServerBackedSettingDraft<string>(
    'textgenWebUIBlockingURL',
    '',
  )
  const enableCustomFlagsDraft = createServerBackedSettingDraft<boolean>('enableCustomFlags', false)
  const customFlagsDraft = createServerBackedSettingDraft<LLMFlags[]>('customFlags', [])
  const moduleIntergrationDraft = createServerBackedSettingDraft<string>('moduleIntergration', '')
  const modelToolsDraft = createServerBackedSettingDraft<string[]>('modelTools', [])
  const presetRegexDraft = createPromptFieldDraft<any[]>('presetRegex', [])
  const mainPromptDraft = createPromptFieldDraft<string>('mainPrompt', '')
  const jailbreakDraft = createPromptFieldDraft<string>('jailbreak', '')
  const globalNoteDraft = createPromptFieldDraft<string>('globalNote', '')
  const formatingOrderDraft = createPromptFieldDraft<string[]>('formatingOrder', [])
  const promptPreprocessDraft = createPromptFieldDraft<boolean>('promptPreprocess', false)
  let currentPluginProviderDraft = $state(DBState.db.currentPluginProvider ?? '')

  let initializedPluginProviderWatch = false
  let previousPluginProvider = ''
  let lastPluginWatchSuppressionVersion = currentPluginWatchSuppressionVersion()
  let suppressPluginProviderDraftDispatch = false
  $effect(() => {
    const provider = DBState.db.currentPluginProvider ?? ''
    const suppressionVersion = currentPluginWatchSuppressionVersion()
    const draftProvider = untrack(() => currentPluginProviderDraft)
    if (provider !== draftProvider) {
      suppressPluginProviderDraftDispatch = true
      currentPluginProviderDraft = provider
      queueMicrotask(() => {
        suppressPluginProviderDraftDispatch = false
      })
    }
    if (
      !initializedPluginProviderWatch ||
      suppressionVersion !== lastPluginWatchSuppressionVersion
    ) {
      initializedPluginProviderWatch = true
      lastPluginWatchSuppressionVersion = suppressionVersion
      previousPluginProvider = provider
      return
    }
  })
  $effect(() => {
    const provider = currentPluginProviderDraft
    if (!canUseServerCommands()) {
      DBState.db.currentPluginProvider = provider
      previousPluginProvider = provider
      return
    }
    if (suppressPluginProviderDraftDispatch) return
    if (provider === previousPluginProvider) return
    const previous = currentPluginStateSnapshot()
    previous.currentPluginProvider = previousPluginProvider
    withTrustedServerProjectionWrite(() => {
      DBState.db.currentPluginProvider = provider
    })
    previousPluginProvider = provider
    untrack(() => dispatchSelectPluginProvider(provider, previous))
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

  interface Props {
    goPromptTemplate?: any
  }

  let { goPromptTemplate = () => {} }: Props = $props()

  async function loadTokenize() {
    tokens.mainPrompt = await tokenizeAccurate(mainPromptDraft.value, true)
    tokens.jailbreak = await tokenizeAccurate(jailbreakDraft.value, true)
    tokens.globalNote = await tokenizeAccurate(globalNoteDraft.value, true)
  }

  function toggleCustomFlag(flag: number): void {
    const typedFlag = flag as LLMFlags
    const flags = customFlagsDraft.value ?? []
    customFlagsDraft.value = flags.includes(typedFlag)
      ? flags.filter((candidate) => candidate !== typedFlag)
      : [...flags, typedFlag]
  }

  function customFlagEnabled(flag: number): boolean {
    return (customFlagsDraft.value ?? []).includes(flag as LLMFlags)
  }

  function toggleModelTool(tool: string): void {
    const tools = modelToolsDraft.value ?? []
    modelToolsDraft.value = tools.includes(tool)
      ? tools.filter((candidate) => candidate !== tool)
      : [...tools, tool]
  }

  function createPromptFieldDraft<T>(key: string, fallback: T): { value: T } {
    const initialValue = currentPromptFieldValue(key, fallback)
    const draft = $state<{ value: T }>({ value: cloneJsonValue(initialValue) })
    let initialized = false
    let suppressDraftDispatch = false
    let previousServerSnapshot = snapshotJson(initialValue)

    $effect(() => {
      const serverValue = currentPromptFieldValue(key, fallback)
      const serverSnapshot = snapshotJson(serverValue)
      const draftSnapshot = snapshotJson(draft.value)

      if (serverSnapshot !== previousServerSnapshot && serverSnapshot !== draftSnapshot) {
        suppressDraftDispatch = true
        draft.value = cloneJsonValue(serverValue)
        queueMicrotask(() => {
          suppressDraftDispatch = false
        })
      }

      previousServerSnapshot = serverSnapshot
    })

    $effect(() => {
      const snapshot = snapshotJson(draft.value)
      if (!initialized) {
        initialized = true
        return
      }
      if (suppressDraftDispatch) return

      untrack(() => {
        const attempted = cloneJsonValue(draft.value)
        const previous = cloneJsonValue((DBState.db as unknown as Record<string, unknown>)[key])
        withTrustedServerProjectionWrite(() => {
          // Re-read inside the trusted write to get the mutable projection.
          const target = DBState.db as unknown as Record<string, unknown>
          target[key] = attempted
        })
        queuePromptFieldPatch({ [key]: attempted }, { [key]: previous })
        previousServerSnapshot = snapshot
      })
    })

    return draft
  }

  function queuePromptFieldPatch(patch: SettingsPatch, previous: SettingsPatch): void {
    if (!canUseServerCommands()) return
    for (const [key, value] of Object.entries(patch)) {
      if (!(key in pendingPromptFieldPatch.previous)) {
        pendingPromptFieldPatch.previous[key] = previous[key]
      }
      pendingPromptFieldPatch.patch[key] = value
      pendingPromptFieldPatch.attempted[key] = value
    }

    if (pendingPromptFieldPatch.timer) clearTimeout(pendingPromptFieldPatch.timer)
    pendingPromptFieldPatch.timer = setTimeout(() => {
      pendingPromptFieldPatch.timer = null
      const commandPatch = pendingPromptFieldPatch.patch
      const commandPrevious = pendingPromptFieldPatch.previous
      const commandAttempted = pendingPromptFieldPatch.attempted
      pendingPromptFieldPatch.patch = {}
      pendingPromptFieldPatch.previous = {}
      pendingPromptFieldPatch.attempted = {}

      void runServerCommand({
        command: (baseRevision) =>
          patchPromptSettingsCommand({
            baseRevision,
            patch: commandPatch,
          }),
        rollback: () => rollbackPromptFields(commandPrevious, commandAttempted),
      })
    }, 250)
  }

  function rollbackPromptFields(previous: SettingsPatch, attempted: SettingsPatch): void {
    withTrustedServerProjectionWrite(() => {
      const target = DBState.db as unknown as Record<string, unknown>
      for (const [key, previousValue] of Object.entries(previous)) {
        if (snapshotJson(target[key]) === snapshotJson(attempted[key])) {
          target[key] = cloneJsonValue(previousValue)
        }
      }
    })
  }

  function currentPromptFieldValue<T>(key: string, fallback: T): T {
    const target = DBState.db as unknown as Record<string, unknown> | undefined
    const value = target?.[key]
    return value === undefined ? fallback : (value as T)
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

  $effect.pre(() => {
    if (DBState.db.aiModel === 'textgen_webui' || DBState.db.subModel === 'mancer') {
      useStreamingDraft.value = textgenWebUIStreamURLDraft.value.startsWith('wss://')
    }
  })

  function clearVertexToken() {
    vertexAccessTokenDraft.value = ''
    vertexAccessTokenExpiresDraft.value = 0
    console.log('Vertex AI token cleared')
  }

  onDestroy(() => {
    if (pendingPromptFieldPatch.timer) {
      clearTimeout(pendingPromptFieldPatch.timer)
    }
  })

  let submenu = $state(DBState.db.useLegacyGUI ? -1 : 0)
  let modelInfo = $derived(getModelInfo(DBState.db.aiModel))
  let subModelInfo = $derived(getModelInfo(DBState.db.subModel))
  let nanogptInputMode = $state<'list' | 'manual'>(
    DBState.db.nanogptRequestModel && !DBState.db.nanogptRequestModelName ? 'manual' : 'list',
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

  let usesOllamaLocal = $derived(
    DBState.db.aiModel === 'ollama-hosted' || DBState.db.subModel === 'ollama-hosted',
  )
  let usesOllamaCloud = $derived(
    DBState.db.aiModel === 'ollama-cloud' || DBState.db.subModel === 'ollama-cloud',
  )
</script>

<h2 class="mb-2 text-2xl font-bold mt-2">{language.chatBot}</h2>

{#if submenu !== -1}
  <div class="flex w-full rounded-md border border-darkborderc mb-4">
    <button
      onclick={() => {
        submenu = 0
      }}
      class="p-2 flex-1 border-r border-darkborderc"
      class:bg-darkbutton={submenu === 0}
    >
      <span>{language.model}</span>
    </button>
    <button
      onclick={() => {
        submenu = 1
      }}
      class="p2 flex-1 border-r border-darkborderc"
      class:bg-darkbutton={submenu === 1}
    >
      <span>{language.parameters}</span>
    </button>
    <button
      onclick={() => {
        submenu = 2
      }}
      class="p-2 flex-1 border-r border-darkborderc"
      class:bg-darkbutton={submenu === 2}
    >
      <span>{language.prompt}</span>
    </button>
    <button
      onclick={() => {
        submenu = 3
      }}
      class="p-2 flex-1"
      class:bg-darkbutton={submenu === 3}
    >
      <span>{language.others}</span>
    </button>
  </div>
{/if}

{#if submenu === 0 || submenu === -1}
  <span class="text-textcolor mt-4">{language.model} <Help key="model" /></span>
  <ModelList bind:value={aiModelDraft.value} />

  <span class="text-textcolor mt-2">{language.submodel} <Help key="submodel" /></span>
  <ModelList bind:value={subModelDraft.value} />

  {#if modelInfo.provider === LLMProvider.GoogleCloud || subModelInfo.provider === LLMProvider.GoogleCloud}
    <span class="text-textcolor">GoogleAI API Key</span>
    <TextInput
      marginBottom={true}
      size={'sm'}
      placeholder="..."
      hideText={DBState.db.hideApiKey}
      bind:value={googleDraft.value.accessToken}
    />
  {/if}
  {#if modelInfo.provider === LLMProvider.VertexAI || subModelInfo.provider === LLMProvider.VertexAI}
    <span class="text-textcolor">Project ID</span>
    <TextInput
      marginBottom={true}
      size={'sm'}
      placeholder="..."
      bind:value={googleDraft.value.projectId}
      oninput={clearVertexToken}
    />
    <span class="text-textcolor">Vertex Client Email</span>
    <TextInput
      marginBottom={true}
      size={'sm'}
      placeholder="..."
      bind:value={vertexClientEmailDraft.value}
      oninput={clearVertexToken}
    />
    <span class="text-textcolor">Vertex Private Key</span>
    <TextInput
      marginBottom={true}
      size={'sm'}
      placeholder="..."
      hideText={DBState.db.hideApiKey}
      bind:value={vertexPrivateKeyDraft.value}
      oninput={clearVertexToken}
    />
    <span class="text-textcolor">Region</span>
    <SelectInput
      value={vertexRegionDraft.value}
      onchange={(e) => {
        vertexRegionDraft.value = e.currentTarget.value
        clearVertexToken()
      }}
    >
      <OptionInput value={'global'}>global</OptionInput>
      <OptionInput value={'us-central1'}>us-central1</OptionInput>
      <OptionInput value={'us-west1'}>us-west1</OptionInput>
    </SelectInput>
  {/if}
  {#if modelInfo.provider === LLMProvider.NovelList || subModelInfo.provider === LLMProvider.NovelList}
    <span class="text-textcolor">NovelList {language.apiKey}</span>
    <TextInput
      hideText={DBState.db.hideApiKey}
      marginBottom={true}
      size={'sm'}
      placeholder="..."
      bind:value={novellistAPIDraft.value}
    />
  {/if}
  {#if DBState.db.aiModel.startsWith('mancer') || DBState.db.subModel.startsWith('mancer')}
    <span class="text-textcolor">Mancer {language.apiKey}</span>
    <TextInput
      hideText={DBState.db.hideApiKey}
      marginBottom={true}
      size={'sm'}
      placeholder="..."
      bind:value={mancerHeaderDraft.value}
    />
  {/if}
  {#if modelInfo.provider === LLMProvider.Anthropic || subModelInfo.provider === LLMProvider.Anthropic || modelInfo.provider === LLMProvider.AWS || subModelInfo.provider === LLMProvider.AWS}
    <span class="text-textcolor">Claude {language.apiKey}</span>
    <TextInput
      hideText={DBState.db.hideApiKey}
      marginBottom={true}
      size={'sm'}
      placeholder="..."
      bind:value={claudeAPIKeyDraft.value}
    />
  {/if}
  {#if modelInfo.provider === LLMProvider.Mistral || subModelInfo.provider === LLMProvider.Mistral}
    <span class="text-textcolor">Mistral {language.apiKey}</span>
    <TextInput
      hideText={DBState.db.hideApiKey}
      marginBottom={true}
      size={'sm'}
      placeholder="..."
      bind:value={mistralKeyDraft.value}
    />
  {/if}
  {#if modelInfo.provider === LLMProvider.NovelAI || subModelInfo.provider === LLMProvider.NovelAI}
    <span class="text-textcolor">NovelAI Bearer Token</span>
    <TextInput bind:value={novelaiDraft.value.token} />
  {/if}
  {#if DBState.db.aiModel === 'reverse_proxy' || DBState.db.subModel === 'reverse_proxy'}
    <span class="text-textcolor mt-2">URL <Help key="forceUrl" /></span>
    <TextInput
      marginBottom={false}
      size={'sm'}
      bind:value={forceReplaceUrlDraft.value}
      placeholder="https//..."
    />
    <span class="text-textcolor mt-4"> {language.proxyAPIKey}</span>
    <TextInput
      hideText={DBState.db.hideApiKey}
      marginBottom={false}
      size={'sm'}
      placeholder="leave it blank if it hasn't password"
      bind:value={proxyKeyDraft.value}
    />
    <span class="text-textcolor mt-4"> {language.proxyRequestModel}</span>
    <TextInput
      marginBottom={false}
      size={'sm'}
      bind:value={customProxyRequestModelDraft.value}
      placeholder="Name"
    />
    <span class="text-textcolor mt-4"> {language.format}</span>
    <SelectInput
      value={customAPIFormatDraft.value.toString()}
      onchange={(e) => {
        customAPIFormatDraft.value = parseInt(e.currentTarget.value) as LLMFormat
      }}
    >
      <OptionInput value={LLMFormat.OpenAICompatible.toString()}>OpenAI Compatible</OptionInput>
      <OptionInput value={LLMFormat.OpenAIResponseAPI.toString()}>OpenAI Response API</OptionInput>
      <OptionInput value={LLMFormat.Anthropic.toString()}>Anthropic Claude</OptionInput>
      <OptionInput value={LLMFormat.Mistral.toString()}>Mistral</OptionInput>
      <OptionInput value={LLMFormat.GoogleCloud.toString()}>Google Cloud</OptionInput>
      <OptionInput value={LLMFormat.Cohere.toString()}>Cohere</OptionInput>
    </SelectInput>
  {/if}
  {#if modelInfo.provider === LLMProvider.Cohere || subModelInfo.provider === LLMProvider.Cohere}
    <span class="text-textcolor mt-4">Cohere {language.apiKey}</span>
    <TextInput
      hideText={DBState.db.hideApiKey}
      marginBottom={false}
      size={'sm'}
      bind:value={cohereAPIKeyDraft.value}
    />
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
        size="md"
      />

      {#if ollamaInputModeDraft.value === 'manual'}
        <TextInput
          marginBottom={false}
          size={'sm'}
          bind:value={ollamaCloudModelDraft.value}
          placeholder="Model"
          oninput={() => (ollamaCloudModelNameDraft.value = '')}
        />
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
            }}
          />
        {/await}
      {/if}

      <span class="text-textcolor mt-4">Ollama {language.apiKey}</span>
      <TextInput
        hideText={DBState.db.hideApiKey}
        marginBottom={false}
        size={'sm'}
        bind:value={ollamaApiKeyDraft.value}
      />

      <span class="text-textcolor mt-4">Ollama {language.format}</span>
      <SelectInput
        value={ollamaRequestFormatDraft.value.toString()}
        onchange={(e) => {
          ollamaRequestFormatDraft.value = parseInt(e.currentTarget.value) as LLMFormat
        }}
      >
        <OptionInput value={LLMFormat.Ollama.toString()}>Ollama SDK</OptionInput>
        <OptionInput value={LLMFormat.OpenAICompatible.toString()}>OpenAI Compatible</OptionInput>
        <OptionInput value={LLMFormat.OpenAIResponseAPI.toString()}>
          OpenAI Response API
        </OptionInput>
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
        }}
      />
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
  {#if DBState.db.aiModel === 'nanogpt' || DBState.db.subModel === 'nanogpt'}
    <span class="text-textcolor mt-4">NanoGPT {language.apiKey}</span>
    <TextInput
      hideText={DBState.db.hideApiKey}
      marginBottom={false}
      size={'sm'}
      bind:value={nanogptKeyDraft.value}
    />

    <NanoGPTDashboard apiKey={nanogptKeyDraft.value} />

    {#if nanogptSubscriptionStateDraft.value === 'active' || nanogptSubscriptionStateDraft.value === 'grace'}
      <div class="flex items-center mt-3">
        <CheckInput
          bind:check={nanogptUseSubscriptionEndpointDraft.value}
          name={language.nanoGPTUseSubscriptionEndpoint}
        />
      </div>
    {/if}

    <span class="text-textcolor mt-4">NanoGPT {language.model}</span>
    <SegmentedControl
      bind:value={nanogptInputMode}
      options={[
        { value: 'list', label: (language as any).nanoGPTSelectFromList || 'Select from List' },
        { value: 'manual', label: (language as any).nanoGPTManualInput || 'Manual Input' },
      ]}
      size="md"
    />

    {#if nanogptInputMode === 'manual'}
      <TextInput
        marginBottom={false}
        size={'sm'}
        bind:value={nanogptRequestModelDraft.value}
        placeholder={(language as any).nanoGPTManualModelSelect || 'Manual Model Select'}
        oninput={() => (nanogptRequestModelNameDraft.value = '')}
      />
    {:else}
      {#await Promise.all( [getNanoGPTModels(), getNanoGPTSubscriptionModels(nanogptKeyDraft.value)], )}
        <ModelGrid bind:value={nanogptRequestModelDraft.value} loading={true} />
      {:then [regular, sub]}
        <ModelGrid
          bind:value={nanogptRequestModelDraft.value}
          items={nanogptUseSubscriptionEndpointDraft.value
            ? (sub ?? []).map(ngToGridItem)
            : (regular ?? []).map(ngToGridItem)}
          showSubBadge={nanogptUseSubscriptionEndpointDraft.value}
          selectedLabelOverride={nanogptRequestModelDraft.value &&
          !nanogptRequestModelNameDraft.value
            ? nanogptRequestModelDraft.value
            : undefined}
          onselect={(_id, name) => {
            nanogptRequestModelNameDraft.value = name
          }}
        />
        {#if !nanogptUseSubscriptionEndpointDraft.value}
          <NanoGPTProviderPicker
            apiKey={nanogptKeyDraft.value}
            modelId={nanogptRequestModelDraft.value}
            bind:value={nanogptProviderDraft.value}
          />
        {/if}
      {/await}
    {/if}
  {/if}
  {#if DBState.db.aiModel === 'openrouter' || DBState.db.subModel === 'openrouter'}
    <span class="text-textcolor mt-4">OpenRouter {language.apiKey}</span>
    <TextInput
      hideText={DBState.db.hideApiKey}
      marginBottom={false}
      size={'sm'}
      bind:value={openrouterKeyDraft.value}
    />

    <span class="text-textcolor mt-4">OpenRouter {language.model}</span>
    {#await getOpenRouterModels()}
      <ModelGrid
        bind:value={openrouterRequestModelDraft.value}
        pinnedItems={openrouterPinnedItems}
        loading={true}
      />
    {:then m}
      <ModelGrid
        bind:value={openrouterRequestModelDraft.value}
        items={(m ?? []).map(orToGridItem)}
        pinnedItems={openrouterPinnedItems}
      />
    {/await}
  {/if}
  {#if DBState.db.aiModel === 'openrouter' || DBState.db.aiModel === 'reverse_proxy'}
    <span class="text-textcolor">{language.tokenizer}</span>
    <SelectInput bind:value={customTokenizerDraft.value}>
      {#each tokenizerList as entry}
        <OptionInput value={entry[0]}>{entry[1]}</OptionInput>
      {/each}
    </SelectInput>
  {/if}
  {#if modelInfo.provider === LLMProvider.OpenAI || subModelInfo.provider === LLMProvider.OpenAI}
    <span class="text-textcolor">OpenAI {language.apiKey} <Help key="oaiapikey" /></span>
    <TextInput
      hideText={DBState.db.hideApiKey}
      marginBottom={false}
      size={'sm'}
      bind:value={openAIKeyDraft.value}
      placeholder="sk-XXXXXXXXXXXXXXXXXXXX"
    />
  {/if}

  {#if modelInfo.keyIdentifier}
    <span class="text-textcolor">{modelInfo.name} {language.apiKey}</span>
    <TextInput
      hideText={DBState.db.hideApiKey}
      marginBottom={false}
      size={'sm'}
      bind:value={OaiCompAPIKeysDraft.value[modelInfo.keyIdentifier]}
      placeholder="..."
    />
  {/if}

  {#if subModelInfo.keyIdentifier && subModelInfo.keyIdentifier !== modelInfo.keyIdentifier}
    <span class="text-textcolor">{subModelInfo.name} {language.apiKey}</span>
    <TextInput
      hideText={DBState.db.hideApiKey}
      marginBottom={false}
      size={'sm'}
      bind:value={OaiCompAPIKeysDraft.value[subModelInfo.keyIdentifier]}
      placeholder="..."
    />
  {/if}

  <div class="py-2 flex flex-col gap-2 mb-4">
    {#if !usesOllamaCloud && (modelInfo.flags.includes(LLMFlags.hasStreaming) || subModelInfo.flags.includes(LLMFlags.hasStreaming))}
      <Check bind:check={useStreamingDraft.value} name={`Response ${language.streaming}`} />

      {#if useStreamingDraft.value && (modelInfo.flags.includes(LLMFlags.geminiThinking) || subModelInfo.flags.includes(LLMFlags.geminiThinking))}
        <Check bind:check={streamGeminiThoughtsDraft.value} name={`Stream Gemini Thoughts`} />
      {/if}
    {/if}

    {#if DBState.db.aiModel === 'reverse_proxy' || DBState.db.subModel === 'reverse_proxy'}
      <Check
        bind:check={reverseProxyOobaModeDraft.value}
        name={`${language.reverseProxyOobaMode}`}
      />
    {/if}
    {#if modelInfo.provider === LLMProvider.NovelAI || subModelInfo.provider === LLMProvider.NovelAI}
      <Check bind:check={NAIadventureDraft.value} name={language.textAdventureNAI} />

      <Check bind:check={NAIappendNameDraft.value} name={language.appendNameNAI} />
    {/if}
  </div>

  {#if DBState.db.aiModel === 'custom' || DBState.db.subModel === 'custom'}
    <span class="text-textcolor mt-2">{language.plugin}</span>
    <SelectInput className="mt-2 mb-4" bind:value={currentPluginProviderDraft}>
      <OptionInput value="">None</OptionInput>
      {#each $customProviderStore as plugin}
        <OptionInput value={plugin}>{plugin}</OptionInput>
      {/each}
    </SelectInput>
  {/if}

  {#if DBState.db.aiModel === 'kobold' || DBState.db.subModel === 'kobold'}
    <span class="text-textcolor">Kobold URL</span>
    <TextInput marginBottom={true} bind:value={koboldURLDraft.value} />
  {/if}

  {#if DBState.db.aiModel === 'echo_model' || DBState.db.subModel === 'echo_model'}
    <span class="text-textcolor mt-2">Echo Message</span>
    <TextAreaInput
      margin="bottom"
      bind:value={echoMessageDraft.value}
      placeholder={"The message you want to receive as the bot's response\n(e.g., Lumi tilts her head, her white hair sliding down as her pretty green and aqua eyes sparkle…)"}
    />
    <span class="text-textcolor mt-2">Echo Delay (Seconds)</span>
    <NumberInput marginBottom={true} bind:value={echoDelayDraft.value} min={0} />
  {/if}

  {#if DBState.db.aiModel.startsWith('horde') || DBState.db.subModel.startsWith('horde')}
    <span class="text-textcolor">Horde {language.apiKey}</span>
    <TextInput
      hideText={DBState.db.hideApiKey}
      marginBottom={true}
      bind:value={hordeConfigDraft.value.apiKey}
    />
  {/if}
  {#if DBState.db.aiModel === 'textgen_webui' || DBState.db.subModel === 'textgen_webui' || DBState.db.aiModel === 'mancer' || DBState.db.subModel === 'mancer'}
    <span class="text-textcolor mt-2">Blocking {language.providerURL}</span>
    <TextInput
      marginBottom={true}
      bind:value={textgenWebUIBlockingURLDraft.value}
      placeholder="https://..."
    />
    <span class="text-draculared text-xs mb-2">You must use textgen webui with --public-api</span>
    <span class="text-textcolor mt-2">Stream {language.providerURL}</span>
    <TextInput
      marginBottom={true}
      bind:value={textgenWebUIStreamURLDraft.value}
      placeholder="wss://..."
    />
    <span class="text-draculared text-xs mb-2"
      >To reach a local WebUI from the browser, use ngrok or other tunnels.</span
    >
    <span class="text-draculared text-xs mb-2"
      >Warning: For Ooba version over 1.7, use "Ooba" as model, and use url like
      http://127.0.0.1:5000/v1/chat/completions</span
    >
  {/if}
  {#if DBState.db.aiModel === 'ooba' || DBState.db.subModel === 'ooba'}
    <span class="text-textcolor mt-2">Ooba {language.providerURL}</span>
    <TextInput
      marginBottom={true}
      bind:value={textgenWebUIBlockingURLDraft.value}
      placeholder="https://..."
    />
  {/if}
  {#if DBState.db.aiModel.startsWith('horde') || DBState.db.aiModel === 'kobold'}
    <ChatFormatSettings />
  {/if}

  {#if DBState.db.auxModelUnderModelSettings}
    <AuxModelSelectors />
  {/if}
{/if}

{#if submenu === 1 || submenu === -1}
  <SettingRenderer items={allBasicParameterItems} {modelInfo} {subModelInfo} />
  {#if DBState.db.aiModel === 'textgen_webui' || DBState.db.aiModel === 'mancer' || DBState.db.aiModel.startsWith('local_') || DBState.db.aiModel.startsWith('hf:::')}
    <span class="text-textcolor">Repetition Penalty</span>
    <SliderInput
      min={1}
      max={1.5}
      step={0.01}
      fixed={2}
      marginBottom
      bind:value={oobaDraft.value.repetition_penalty}
    />
    <span class="text-textcolor">Length Penalty</span>
    <SliderInput
      min={-5}
      max={5}
      step={0.05}
      marginBottom
      fixed={2}
      bind:value={oobaDraft.value.length_penalty}
    />
    <span class="text-textcolor">Top K</span>
    <SliderInput min={0} max={100} step={1} marginBottom bind:value={oobaDraft.value.top_k} />
    <span class="text-textcolor">Top P</span>
    <SliderInput
      min={0}
      max={1}
      step={0.01}
      marginBottom
      fixed={2}
      bind:value={oobaDraft.value.top_p}
    />
    <span class="text-textcolor">Typical P</span>
    <SliderInput
      min={0}
      max={1}
      step={0.01}
      marginBottom
      fixed={2}
      bind:value={oobaDraft.value.typical_p}
    />
    <span class="text-textcolor">Top A</span>
    <SliderInput
      min={0}
      max={1}
      step={0.01}
      marginBottom
      fixed={2}
      bind:value={oobaDraft.value.top_a}
    />
    <span class="text-textcolor">No Repeat n-gram Size</span>
    <SliderInput
      min={0}
      max={20}
      step={1}
      marginBottom
      bind:value={oobaDraft.value.no_repeat_ngram_size}
    />
    <div class="flex items-center mt-4">
      <Check bind:check={oobaDraft.value.do_sample} name={'Do Sample'} />
    </div>
    <div class="flex items-center mt-4">
      <Check bind:check={oobaDraft.value.add_bos_token} name={'Add BOS Token'} />
    </div>
    <div class="flex items-center mt-4">
      <Check bind:check={oobaDraft.value.ban_eos_token} name={'Ban EOS Token'} />
    </div>
    <div class="flex items-center mt-4">
      <Check bind:check={oobaDraft.value.skip_special_tokens} name={'Skip Special Tokens'} />
    </div>
    <div class="flex items-center mt-4">
      <Check
        check={!!localStopStringsDraft.value}
        name={language.customStopWords}
        onChange={() => {
          if (!localStopStringsDraft.value) {
            localStopStringsDraft.value = []
          } else {
            localStopStringsDraft.value = null
          }
        }}
      />
    </div>
    {#if localStopStringsDraft.value}
      <div class="flex flex-col p-2 rounded-sm border border-selected mt-2 gap-1">
        <div class="p-2">
          <button
            class="font-medium flex justify-center items-center h-full cursor-pointer hover:text-green-500 w-full"
            onclick={() => {
              const localStopStrings = localStopStringsDraft.value ?? []
              localStopStrings.push('')
              localStopStringsDraft.value = localStopStrings
            }}><PlusIcon /></button
          >
        </div>
        {#each localStopStringsDraft.value as stopString, i}
          <div class="flex w-full">
            <div class="grow">
              <TextInput marginBottom bind:value={localStopStringsDraft.value[i]} fullwidth fullh />
            </div>
            <div>
              <button
                class="font-medium flex justify-center items-center h-full cursor-pointer hover:text-green-500 w-full"
                onclick={() => {
                  const localStopStrings = localStopStringsDraft.value ?? []
                  localStopStrings.splice(i, 1)
                  localStopStringsDraft.value = localStopStrings
                }}><TrashIcon /></button
              >
            </div>
          </div>
        {/each}
      </div>
    {/if}
    <div class="flex flex-col p-3 rounded-md border-selected border mt-4">
      <ChatFormatSettings />
    </div>
    <Check bind:check={oobaDraft.value.formating.useName} name={language.useNamePrefix} />
  {:else if modelInfo.format === LLMFormat.NovelAI}
    <div class="flex flex-col p-3 bg-darkbg mt-4">
      <span class="text-textcolor">Starter</span>
      <TextInput bind:value={NAIsettingsDraft.value.starter} placeholder={'⁂'} />
      <span class="text-textcolor">Seperator</span>
      <TextInput bind:value={NAIsettingsDraft.value.seperator} placeholder={'\\n'} />
    </div>
    <span class="text-textcolor">Top P</span>
    <SliderInput
      min={0}
      max={1}
      step={0.01}
      marginBottom
      fixed={2}
      bind:value={NAIsettingsDraft.value.topP}
    />
    <span class="text-textcolor">Top K</span>
    <SliderInput min={0} max={100} step={1} marginBottom bind:value={NAIsettingsDraft.value.topK} />
    <span class="text-textcolor">Top A</span>
    <SliderInput
      min={0}
      max={1}
      step={0.01}
      marginBottom
      fixed={2}
      bind:value={NAIsettingsDraft.value.topA}
    />
    <span class="text-textcolor">Tailfree Sampling</span>
    <SliderInput
      min={0}
      max={1}
      step={0.001}
      marginBottom
      fixed={3}
      bind:value={NAIsettingsDraft.value.tailFreeSampling}
    />
    <span class="text-textcolor">Typical P</span>
    <SliderInput
      min={0}
      max={1}
      step={0.01}
      marginBottom
      fixed={2}
      bind:value={NAIsettingsDraft.value.typicalp}
    />
    <span class="text-textcolor">Repetition Penalty</span>
    <SliderInput
      min={0}
      max={3}
      step={0.01}
      marginBottom
      fixed={2}
      bind:value={NAIsettingsDraft.value.repetitionPenalty}
    />
    <span class="text-textcolor">Repetition Penalty Range</span>
    <SliderInput
      min={0}
      max={8192}
      step={1}
      marginBottom
      fixed={0}
      bind:value={NAIsettingsDraft.value.repetitionPenaltyRange}
    />
    <span class="text-textcolor">Repetition Penalty Slope</span>
    <SliderInput
      min={0}
      max={10}
      step={0.01}
      marginBottom
      fixed={2}
      bind:value={NAIsettingsDraft.value.repetitionPenaltySlope}
    />
    <span class="text-textcolor">Frequency Penalty</span>
    <SliderInput
      min={-2}
      max={2}
      step={0.01}
      marginBottom
      fixed={2}
      bind:value={NAIsettingsDraft.value.frequencyPenalty}
    />
    <span class="text-textcolor">Presence Penalty</span>
    <SliderInput
      min={-2}
      max={2}
      step={0.01}
      marginBottom
      fixed={2}
      bind:value={NAIsettingsDraft.value.presencePenalty}
    />
    <span class="text-textcolor">Mirostat LR</span>
    <SliderInput
      min={0}
      max={1}
      step={0.01}
      marginBottom
      fixed={2}
      bind:value={NAIsettingsDraft.value.mirostat_lr}
    />
    <span class="text-textcolor">Mirostat Tau</span>
    <SliderInput
      min={0}
      max={6}
      step={0.01}
      marginBottom
      fixed={2}
      bind:value={NAIsettingsDraft.value.mirostat_tau}
    />
    <span class="text-textcolor">Cfg Scale</span>
    <SliderInput
      min={1}
      max={3}
      step={0.01}
      marginBottom
      fixed={2}
      bind:value={NAIsettingsDraft.value.cfg_scale}
    />
  {:else if modelInfo.format === LLMFormat.NovelList}
    <span class="text-textcolor">Top P</span>
    <SliderInput
      min={0}
      max={2}
      step={0.01}
      marginBottom
      fixed={2}
      bind:value={ainconfigDraft.value.top_p}
    />
    <span class="text-textcolor">Reputation Penalty</span>
    <SliderInput
      min={0}
      max={2}
      step={0.01}
      marginBottom
      fixed={2}
      bind:value={ainconfigDraft.value.rep_pen}
    />
    <span class="text-textcolor">Reputation Penalty Range</span>
    <SliderInput
      min={0}
      max={2048}
      step={1}
      marginBottom
      fixed={2}
      bind:value={ainconfigDraft.value.rep_pen_range}
    />
    <span class="text-textcolor">Reputation Penalty Slope</span>
    <SliderInput
      min={0}
      max={10}
      step={0.1}
      marginBottom
      fixed={2}
      bind:value={ainconfigDraft.value.rep_pen_slope}
    />
    <span class="text-textcolor">Top K</span>
    <SliderInput
      min={1}
      max={500}
      step={1}
      marginBottom
      fixed={2}
      bind:value={ainconfigDraft.value.top_k}
    />
    <span class="text-textcolor">Top A</span>
    <SliderInput
      min={0}
      max={1}
      step={0.01}
      marginBottom
      fixed={2}
      bind:value={ainconfigDraft.value.top_a}
    />
    <span class="text-textcolor">Typical P</span>
    <SliderInput
      min={0}
      max={1}
      step={0.01}
      marginBottom
      fixed={2}
      bind:value={ainconfigDraft.value.typical_p}
    />
  {:else}
    <!-- Standard parameters come from SettingRenderer. -->
  {/if}

  {#if (DBState.db.reverseProxyOobaMode && DBState.db.aiModel === 'reverse_proxy') || DBState.db.aiModel === 'ooba'}
    <OobaSettings instructionMode={DBState.db.aiModel === 'ooba'} />
  {/if}

  {#if DBState.db.aiModel.startsWith('openrouter')}
    <OpenrouterSettings />
  {/if}

  <SeparateParametersSection />
{/if}

{#if submenu === 3 || submenu === -1}
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
              }}><PlusIcon /></button
            >
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
              <NumberInput
                bind:value={biasDraft.value[i][1]}
                max={100}
                min={-101}
                size="lg"
                fullwidth
              />
            </td>
            <td>
              <button
                class="font-medium flex justify-center items-center h-full cursor-pointer hover:text-green-500 w-full"
                onclick={() => {
                  biasDraft.value = biasDraft.value.filter((_, index) => index !== i)
                }}><TrashIcon /></button
              >
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
        }}><DownloadIcon /></button
      >
      <button
        class="font-medium cursor-pointer hover:text-textcolor"
        onclick={async () => {
          const sel = await selectSingleFile(['json'])
          const utf8 = new TextDecoder().decode(sel.data)
          if (Array.isArray(JSON.parse(utf8))) {
            biasDraft.value = JSON.parse(utf8)
          }
        }}><HardDriveUploadIcon /></button
      >
    </div>
  </Accordion>

  {#if DBState.db.aiModel === 'reverse_proxy'}
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
                  additionalParamsDraft.value = [...additionalParamsDraft.value, ['', '']]
                }}><PlusIcon /></button
              >
            </th>
          </tr>
          {#if additionalParamsDraft.value.length === 0}
            <tr class="text-textcolor2">
              <td colspan="3">{language.noData}</td>
            </tr>
          {/if}
          {#each additionalParamsDraft.value as additionalParams, i}
            <tr>
              <td class="font-medium truncate">
                <TextInput bind:value={additionalParamsDraft.value[i][0]} size="lg" fullwidth />
              </td>
              <td class="font-medium truncate">
                <TextInput bind:value={additionalParamsDraft.value[i][1]} size="lg" fullwidth />
              </td>
              <td>
                <button
                  class="font-medium flex justify-center items-center h-full cursor-pointer hover:text-green-500 w-full"
                  onclick={() => {
                    additionalParamsDraft.value = additionalParamsDraft.value.filter(
                      (_, index) => index !== i,
                    )
                  }}><TrashIcon /></button
                >
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </Accordion>
  {/if}

  <Accordion styled name={language.promptTemplate}>
    {#if DBState.db.promptTemplate}
      {#if submenu !== -1}
        <PromptSettings mode="inline" subMenu={1} />
      {/if}
    {:else}
      <Check
        check={false}
        name={language.usePromptTemplate}
        onChange={() => {
          withTrustedServerProjectionWrite(() => {
            DBState.db.promptTemplate = []
          })
          if (canUseServerCommands()) {
            void runServerCommand({
              command: (baseRevision) =>
                enablePromptItemsCommand({
                  baseRevision,
                  enabled: true,
                }),
              rollback: () => {
                withTrustedServerProjectionWrite(() => {
                  if (
                    Array.isArray(DBState.db.promptTemplate) &&
                    DBState.db.promptTemplate.length === 0
                  ) {
                    DBState.db.promptTemplate = undefined
                  }
                })
              },
            })
          }
        }}
      />
    {/if}
  </Accordion>

  {#snippet CustomFlagButton(name: string, flag: number)}
    <Button
      className="mt-2"
      onclick={(e) => {
        toggleCustomFlag(flag)
      }}
      styled={customFlagEnabled(flag) ? 'primary' : 'outlined'}
    >
      {name}
    </Button>
  {/snippet}

  <Accordion styled name={language.customFlags}>
    <Check bind:check={enableCustomFlagsDraft.value} name={language.enableCustomFlags} />

    {#if enableCustomFlagsDraft.value}
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

  <Accordion styled name={language.moduleIntergration} help="moduleIntergration">
    <TextAreaInput
      bind:value={moduleIntergrationDraft.value}
      fullwidth
      height={'32'}
      autocomplete="off"
    />
  </Accordion>

  <Accordion styled name={language.tools}>
    <Check
      name={language.search}
      check={(modelToolsDraft.value ?? []).includes('search')}
      onChange={() => {
        toggleModelTool('search')
      }}
    />
  </Accordion>

  <Accordion styled name={language.regexScript}>
    <RegexList bind:value={presetRegexDraft.value} buttons />
  </Accordion>

  <Accordion styled name={language.icon}>
    <div class="p-2 rounded-md border border-darkborderc flex flex-col items-center gap-2">
      <span>
        {language.preview}
      </span>
      <div class="flex items-center justify-center gap-2">
        {#if DBState.db.botPresets[DBState.db.botPresetsId]?.image}
          <img
            src={DBState.db.botPresets[DBState.db.botPresetsId]?.image}
            alt="icon"
            class="w-6 h-6 rounded-md"
            decoding="async"
          />
          <span class="text-textcolor2">{DBState.db.botPresets[DBState.db.botPresetsId]?.name}</span
          >
        {:else}
          <span class="text-textcolor2">{language.noImages}</span>
        {/if}
      </div>
    </div>
    <button
      class="mt-2 text-textcolor2 hover:text-textcolor focus-within:text-textcolor"
      onclick={async () => {
        const sel = await selectSingleFile(['png', 'jpg', 'jpeg', 'webp'])
        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d')
        const img = new Image()
        //@ts-expect-error Uint8Array buffer type (ArrayBufferLike) is incompatible with BlobPart's ArrayBuffer
        const blob = new Blob([sel.data], { type: 'image/png' })
        img.src = URL.createObjectURL(blob)
        await img.decode()
        canvas.width = 48
        canvas.height = 48
        ctx.drawImage(img, 0, 0, 48, 48)
        const data = canvas.toDataURL('image/jpeg', 0.7)
        updatePreset(DBState.db.botPresetsId, { image: data }) //Since its small (max 2304 pixels), its okay to store it directly
      }}
    >
      <UploadIcon />
    </button>
  </Accordion>
  {#if submenu !== -1}
    <Button
      onclick={() => {
        $openPresetList = true
      }}
      className="mt-4">{language.presets}</Button
    >
  {/if}
{/if}

{#if submenu === 2 || submenu === -1}
  {#if !DBState.db.promptTemplate}
    <span class="text-textcolor">{language.mainPrompt} <Help key="mainprompt" /></span>
    <TextAreaInput fullwidth autocomplete="off" height={'32'} bind:value={mainPromptDraft.value}
    ></TextAreaInput>
    <span class="text-textcolor2 mb-6 text-sm mt-2">{tokens.mainPrompt} {language.tokens}</span>
    <span class="text-textcolor">{language.jailbreakPrompt} <Help key="jailbreak" /></span>
    <TextAreaInput fullwidth autocomplete="off" height={'32'} bind:value={jailbreakDraft.value}
    ></TextAreaInput>
    <span class="text-textcolor2 mb-6 text-sm mt-2">{tokens.jailbreak} {language.tokens}</span>
    <span class="text-textcolor">{language.globalNote} <Help key="globalNote" /></span>
    <TextAreaInput fullwidth autocomplete="off" height={'32'} bind:value={globalNoteDraft.value}
    ></TextAreaInput>
    <span class="text-textcolor2 mb-6 text-sm mt-2">{tokens.globalNote} {language.tokens}</span>
    <span class="text-textcolor mb-2 mt-4"
      >{language.formatingOrder} <Help key="formatOrder" /></span
    >
    <DropList bind:list={formatingOrderDraft.value} />
    <div class="flex items-center mt-4">
      <Check bind:check={promptPreprocessDraft.value} name={language.promptPreprocess} />
    </div>
  {:else if submenu === 2}
    <PromptSettings mode="inline" />
  {/if}
{/if}

{#if DBState.db.promptTemplate && submenu === -1}
  <div class="mt-2">
    <Button onclick={goPromptTemplate} size="sm">{language.promptTemplate}</Button>
  </div>
{/if}
{#if submenu === -1}
  <Button
    onclick={() => {
      $openPresetList = true
    }}
    className="mt-4">{language.presets}</Button
  >
{/if}
