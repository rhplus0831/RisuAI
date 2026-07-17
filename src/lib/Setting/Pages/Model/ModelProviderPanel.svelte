<script lang="ts">
  import { AlertTriangleIcon } from '@lucide/svelte'
  import { language } from 'src/lang'
  import TextInput from 'src/lib/UI/GUI/TextInput.svelte'
  import { FIRST_CLASS_MODEL_PROFILE_PROVIDER_IDS } from 'src/ts/model/modelProfileResolver'
  import type { ModelProfileSecretDraft } from 'src/ts/model/modelProfileSecrets'
  import { AnthropicModels } from 'src/ts/model/providers/anthropic'
  import { GoogleModels } from 'src/ts/model/providers/google'
  import { OpenAIModels } from 'src/ts/model/providers/openai'
  import { LLMFlags, LLMFormat, LLMTokenizer, type LLMFlags as LLMFlagValue } from 'src/ts/model/types'
  import KeyValueRowsEditor from './KeyValueRowsEditor.svelte'
  import SecretField from './SecretField.svelte'

  interface KeyValueRow {
    key: string
    value: string
  }

  interface ModelOption {
    id: string
    label: string
  }

  interface Props {
    providerId: string
    modelId: string
    requestModel: string
    apiKeyDraft: ModelProfileSecretDraft
    baseUrl: string
    extraHeadersRows: KeyValueRow[]
    additionalParamRows: KeyValueRow[]
    ollamaRequestFormat: string
    ollamaModelSource: string
    ollamaThinkingMode: string
    vertexProjectId: string
    vertexRegion: string
    vertexClientEmail: string
    vertexPrivateKeyDraft: ModelProfileSecretDraft
    customTokenizer: string
    customFlags: LLMFlagValue[]
  }

  let {
    providerId = $bindable(),
    modelId = $bindable(),
    requestModel = $bindable(),
    apiKeyDraft = $bindable(),
    baseUrl = $bindable(),
    extraHeadersRows = $bindable(),
    additionalParamRows = $bindable(),
    ollamaRequestFormat = $bindable(),
    ollamaModelSource = $bindable(),
    ollamaThinkingMode = $bindable(),
    vertexProjectId = $bindable(),
    vertexRegion = $bindable(),
    vertexClientEmail = $bindable(),
    vertexPrivateKeyDraft = $bindable(),
    customTokenizer = $bindable(),
    customFlags = $bindable(),
  }: Props = $props()

  const firstClassProviderIds = new Set<string>(FIRST_CLASS_MODEL_PROFILE_PROVIDER_IDS)
  const fixedModelProviderIds = new Set<string>(['custom-api', 'debug-echo'])
  const ollamaModelOptions: ModelOption[] = [
    { id: 'ollama-hosted', label: language.modelProfiles.ollamaLocal },
    { id: 'ollama-cloud', label: language.modelProfiles.ollamaCloud },
  ]
  const openAIModelOptions = modelOptions(OpenAIModels)
  const anthropicModelOptions = modelOptions(AnthropicModels)
  const googleModelOptions = modelOptions(GoogleModels)
  const vertexModelOptions = modelOptions(
    GoogleModels.map((model) => ({
      ...model,
      id: `${model.id}-vertex`,
      name: `${model.name} Vertex`,
      fullName: `${model.fullName ?? model.name} Vertex`,
    })),
  )
  const tokenizerOptions = [
    { label: 'Tiktoken (cl100k_base)', value: String(LLMTokenizer.tiktokenCl100kBase) },
    { label: 'Tiktoken (o200k_base)', value: String(LLMTokenizer.tiktokenO200Base) },
  ]
  const flagOptions = Object.entries(LLMFlags).map(([label, flag]) => ({
    label,
    flag: flag as LLMFlagValue,
  }))

  let baseUrlIncludesSuffix = $derived(baseUrl.toLowerCase().includes('/chat/completions'))

  $effect(() => {
    if (fixedModelProviderIds.has(providerId) && modelId !== providerId) {
      modelId = providerId
    }
  })

  $effect(() => {
    if (providerId !== 'ollama') return
    if (modelId !== 'ollama-cloud' && modelId !== 'ollama-hosted') {
      modelId = 'ollama-hosted'
    }
    const nextSource = modelId === 'ollama-cloud' ? 'cloud' : 'local'
    if (ollamaModelSource !== nextSource) {
      ollamaModelSource = nextSource
    }
    if (modelId === 'ollama-hosted' && ollamaRequestFormat !== String(LLMFormat.Ollama)) {
      ollamaRequestFormat = String(LLMFormat.Ollama)
    }
  })

  function modelOptions(models: Array<{ id: string; name: string; fullName?: string }>): ModelOption[] {
    const seen = new Set<string>()
    const out: ModelOption[] = []
    for (const model of models) {
      if (!model.id || seen.has(model.id)) continue
      seen.add(model.id)
      out.push({ id: model.id, label: model.fullName ?? model.name ?? model.id })
    }
    return out
  }

  function knownModelValue(options: ModelOption[]): string {
    return options.some((option) => option.id === modelId) ? modelId : ''
  }

  function setCustomFlag(flag: LLMFlagValue, enabled: boolean): void {
    const nextFlags = enabled ? [...customFlags, flag] : customFlags.filter((item) => item !== flag)
    customFlags = [...new Set(nextFlags)]
  }
</script>

{#if !providerId}
  <div class="rounded-md border border-darkborderc p-3 text-sm text-textcolor2">
    {language.modelProfiles.compatibilityEditNotice}
  </div>
{:else if !firstClassProviderIds.has(providerId)}
  <div class="rounded-md border border-darkborderc p-3 text-sm text-textcolor2">
    {language.modelProfiles.unsupportedProviderEditNotice(providerId)}
  </div>
{:else}
  <div class="flex flex-col gap-4">
    {#if providerId === 'openai'}
      <div class="grid gap-3 md:grid-cols-2">
        <label class="flex flex-col gap-1">
          <span class="text-sm text-textcolor2">{language.modelProfiles.knownModel}</span>
          <select
            class="rounded-md border border-darkborderc bg-transparent px-2 py-1 text-sm text-textcolor shadow-xs transition-colors duration-200 focus:border-borderc focus:outline-hidden focus:ring-2 focus:ring-borderc"
            value={knownModelValue(openAIModelOptions)}
            onchange={(event) => {
              if (event.currentTarget.value) modelId = event.currentTarget.value
            }}>
            <option value="" class="bg-darkbg">{language.modelProfiles.manualModelOption}</option>
            {#each openAIModelOptions as option (option.id)}
              <option value={option.id} class="bg-darkbg">{option.label}</option>
            {/each}
          </select>
        </label>
        <label class="flex flex-col gap-1">
          <span class="text-sm text-textcolor2">{language.modelProfiles.modelColumn}</span>
          <TextInput size="sm" fullwidth bind:value={modelId} placeholder={language.modelProfiles.modelPlaceholder} />
        </label>
        <label class="flex flex-col gap-1">
          <span class="text-sm text-textcolor2">{language.modelProfiles.requestModelColumn}</span>
          <TextInput
            size="sm"
            fullwidth
            bind:value={requestModel}
            placeholder={language.modelProfiles.requestModelPlaceholder} />
        </label>
        <SecretField
          label={language.modelProfiles.apiKeyLabel}
          bind:value={apiKeyDraft}
          placeholder={language.modelProfiles.savedSecretPlaceholder} />
      </div>
    {:else if providerId === 'anthropic'}
      <div class="grid gap-3 md:grid-cols-2">
        <label class="flex flex-col gap-1">
          <span class="text-sm text-textcolor2">{language.modelProfiles.knownModel}</span>
          <select
            class="rounded-md border border-darkborderc bg-transparent px-2 py-1 text-sm text-textcolor shadow-xs transition-colors duration-200 focus:border-borderc focus:outline-hidden focus:ring-2 focus:ring-borderc"
            value={knownModelValue(anthropicModelOptions)}
            onchange={(event) => {
              if (event.currentTarget.value) modelId = event.currentTarget.value
            }}>
            <option value="" class="bg-darkbg">{language.modelProfiles.manualModelOption}</option>
            {#each anthropicModelOptions as option (option.id)}
              <option value={option.id} class="bg-darkbg">{option.label}</option>
            {/each}
          </select>
        </label>
        <label class="flex flex-col gap-1">
          <span class="text-sm text-textcolor2">{language.modelProfiles.modelColumn}</span>
          <TextInput size="sm" fullwidth bind:value={modelId} placeholder={language.modelProfiles.modelPlaceholder} />
        </label>
        <label class="flex flex-col gap-1">
          <span class="text-sm text-textcolor2">{language.modelProfiles.requestModelColumn}</span>
          <TextInput
            size="sm"
            fullwidth
            bind:value={requestModel}
            placeholder={language.modelProfiles.requestModelPlaceholder} />
        </label>
        <SecretField
          label={language.modelProfiles.apiKeyLabel}
          bind:value={apiKeyDraft}
          placeholder={language.modelProfiles.savedSecretPlaceholder} />
      </div>
    {:else if providerId === 'google'}
      <div class="grid gap-3 md:grid-cols-2">
        <label class="flex flex-col gap-1">
          <span class="text-sm text-textcolor2">{language.modelProfiles.knownModel}</span>
          <select
            class="rounded-md border border-darkborderc bg-transparent px-2 py-1 text-sm text-textcolor shadow-xs transition-colors duration-200 focus:border-borderc focus:outline-hidden focus:ring-2 focus:ring-borderc"
            value={knownModelValue(googleModelOptions)}
            onchange={(event) => {
              if (event.currentTarget.value) modelId = event.currentTarget.value
            }}>
            <option value="" class="bg-darkbg">{language.modelProfiles.manualModelOption}</option>
            {#each googleModelOptions as option (option.id)}
              <option value={option.id} class="bg-darkbg">{option.label}</option>
            {/each}
          </select>
        </label>
        <label class="flex flex-col gap-1">
          <span class="text-sm text-textcolor2">{language.modelProfiles.modelColumn}</span>
          <TextInput size="sm" fullwidth bind:value={modelId} placeholder={language.modelProfiles.modelPlaceholder} />
        </label>
        <label class="flex flex-col gap-1">
          <span class="text-sm text-textcolor2">{language.modelProfiles.requestModelColumn}</span>
          <TextInput
            size="sm"
            fullwidth
            bind:value={requestModel}
            placeholder={language.modelProfiles.requestModelPlaceholder} />
        </label>
        <SecretField
          label={language.modelProfiles.apiKeyLabel}
          bind:value={apiKeyDraft}
          placeholder={language.modelProfiles.savedSecretPlaceholder} />
      </div>
    {:else if providerId === 'vertex'}
      <div class="grid gap-3 md:grid-cols-2">
        <label class="flex flex-col gap-1">
          <span class="text-sm text-textcolor2">{language.modelProfiles.knownModel}</span>
          <select
            class="rounded-md border border-darkborderc bg-transparent px-2 py-1 text-sm text-textcolor shadow-xs transition-colors duration-200 focus:border-borderc focus:outline-hidden focus:ring-2 focus:ring-borderc"
            value={knownModelValue(vertexModelOptions)}
            onchange={(event) => {
              if (event.currentTarget.value) modelId = event.currentTarget.value
            }}>
            <option value="" class="bg-darkbg">{language.modelProfiles.manualModelOption}</option>
            {#each vertexModelOptions as option (option.id)}
              <option value={option.id} class="bg-darkbg">{option.label}</option>
            {/each}
          </select>
        </label>
        <label class="flex flex-col gap-1">
          <span class="text-sm text-textcolor2">{language.modelProfiles.modelColumn}</span>
          <TextInput size="sm" fullwidth bind:value={modelId} placeholder={language.modelProfiles.modelPlaceholder} />
        </label>
        <label class="flex flex-col gap-1">
          <span class="text-sm text-textcolor2">{language.modelProfiles.requestModelColumn}</span>
          <TextInput
            size="sm"
            fullwidth
            bind:value={requestModel}
            placeholder={language.modelProfiles.requestModelPlaceholder} />
        </label>
        <label class="flex flex-col gap-1">
          <span class="text-sm text-textcolor2">{language.modelProfiles.vertexProjectId}</span>
          <TextInput size="sm" fullwidth bind:value={vertexProjectId} />
        </label>
        <label class="flex flex-col gap-1">
          <span class="text-sm text-textcolor2">{language.modelProfiles.vertexRegion}</span>
          <TextInput size="sm" fullwidth bind:value={vertexRegion} />
        </label>
        <label class="flex flex-col gap-1">
          <span class="text-sm text-textcolor2">{language.modelProfiles.vertexClientEmail}</span>
          <TextInput size="sm" fullwidth bind:value={vertexClientEmail} />
        </label>
        <SecretField
          label={language.modelProfiles.vertexPrivateKey}
          bind:value={vertexPrivateKeyDraft}
          placeholder={language.modelProfiles.savedSecretPlaceholder} />
      </div>
    {:else if providerId === 'custom-api'}
      <div class="grid gap-3 md:grid-cols-2">
        <label class="flex flex-col gap-1 md:col-span-2">
          <span class="text-sm text-textcolor2">{language.modelProfiles.baseUrlLabel}</span>
          <TextInput size="sm" fullwidth bind:value={baseUrl} placeholder={language.modelProfiles.baseUrlPlaceholder} />
        </label>
        {#if baseUrlIncludesSuffix}
          <div class="flex gap-2 rounded-md border border-yellow-600 p-2 text-sm text-yellow-300 md:col-span-2">
            <AlertTriangleIcon size={16} class="mt-0.5 shrink-0" />
            <span>{language.modelProfiles.customApiChatCompletionsWarning}</span>
          </div>
        {/if}
        <label class="flex flex-col gap-1">
          <span class="text-sm text-textcolor2">{language.modelProfiles.requestModelColumn}</span>
          <TextInput
            size="sm"
            fullwidth
            bind:value={requestModel}
            placeholder={language.modelProfiles.requestModelPlaceholder} />
        </label>
        <SecretField
          label={language.modelProfiles.apiKeyOptionalLabel}
          bind:value={apiKeyDraft}
          placeholder={language.modelProfiles.savedSecretPlaceholder} />
      </div>

      <div class="grid gap-4 md:grid-cols-2">
        <div class="flex flex-col gap-2">
          <h4 class="text-sm font-semibold">{language.modelProfiles.extraHeaders}</h4>
          <KeyValueRowsEditor
            bind:rows={extraHeadersRows}
            keyPlaceholder={language.modelProfiles.headerNamePlaceholder}
            valuePlaceholder={language.modelProfiles.headerValuePlaceholder}
            addLabel={language.modelProfiles.addHeader}
            emptyLabel={language.modelProfiles.noExtraHeaders} />
        </div>

        <div class="flex flex-col gap-2">
          <h4 class="text-sm font-semibold">{language.modelProfiles.additionalParams}</h4>
          <KeyValueRowsEditor
            bind:rows={additionalParamRows}
            keyPlaceholder={language.modelProfiles.paramNamePlaceholder}
            valuePlaceholder={language.modelProfiles.paramValuePlaceholder}
            addLabel={language.modelProfiles.addParam}
            emptyLabel={language.modelProfiles.noAdditionalParams} />
        </div>
      </div>

      <div class="grid gap-3 md:grid-cols-2">
        <label class="flex flex-col gap-1">
          <span class="text-sm text-textcolor2">{language.modelProfiles.customTokenizer}</span>
          <select
            class="rounded-md border border-darkborderc bg-transparent px-2 py-1 text-sm text-textcolor shadow-xs transition-colors duration-200 focus:border-borderc focus:outline-hidden focus:ring-2 focus:ring-borderc"
            bind:value={customTokenizer}>
            <option value="" class="bg-darkbg">{language.modelProfiles.defaultTokenizer}</option>
            {#each tokenizerOptions as option (option.value)}
              <option value={option.value} class="bg-darkbg">{option.label}</option>
            {/each}
          </select>
        </label>
        <div class="flex flex-col gap-2">
          <span class="text-sm text-textcolor2">{language.modelProfiles.customApiFlags}</span>
          <div
            data-model-custom-api-flags
            class="grid max-h-56 grid-cols-1 gap-2 overflow-y-auto rounded-md border border-darkborderc p-2 sm:grid-cols-2">
            {#each flagOptions as option (option.flag)}
              <label class="flex min-w-0 items-center gap-2 text-sm text-textcolor2">
                <input
                  type="checkbox"
                  class="h-4 w-4"
                  checked={customFlags.includes(option.flag)}
                  onchange={(event) => {
                    setCustomFlag(option.flag, event.currentTarget.checked)
                  }} />
                <span class="min-w-0 break-all">{option.label}</span>
              </label>
            {/each}
          </div>
        </div>
      </div>
    {:else if providerId === 'ollama'}
      <div class="grid gap-3 md:grid-cols-2">
        <label class="flex flex-col gap-1">
          <span class="text-sm text-textcolor2">{language.modelProfiles.knownModel}</span>
          <select
            class="rounded-md border border-darkborderc bg-transparent px-2 py-1 text-sm text-textcolor shadow-xs transition-colors duration-200 focus:border-borderc focus:outline-hidden focus:ring-2 focus:ring-borderc"
            value={knownModelValue(ollamaModelOptions)}
            onchange={(event) => {
              if (event.currentTarget.value) modelId = event.currentTarget.value
            }}>
            {#each ollamaModelOptions as option (option.id)}
              <option value={option.id} class="bg-darkbg">{option.label}</option>
            {/each}
          </select>
        </label>
        <label class="flex flex-col gap-1">
          <span class="text-sm text-textcolor2">{language.modelProfiles.requestModelColumn}</span>
          <TextInput
            size="sm"
            fullwidth
            bind:value={requestModel}
            placeholder={language.modelProfiles.ollamaModelPlaceholder} />
        </label>
        {#if modelId === 'ollama-cloud'}
          <SecretField
            label={language.modelProfiles.apiKeyLabel}
            bind:value={apiKeyDraft}
            placeholder={language.modelProfiles.savedSecretPlaceholder} />
          <label class="flex flex-col gap-1">
            <span class="text-sm text-textcolor2">{language.modelProfiles.ollamaRequestFormat}</span>
            <select
              class="rounded-md border border-darkborderc bg-transparent px-2 py-1 text-sm text-textcolor shadow-xs transition-colors duration-200 focus:border-borderc focus:outline-hidden focus:ring-2 focus:ring-borderc"
              bind:value={ollamaRequestFormat}>
              <option value={String(LLMFormat.Ollama)} class="bg-darkbg">
                {language.modelProfiles.ollamaNativeFormat}
              </option>
              <option value={String(LLMFormat.OpenAICompatible)} class="bg-darkbg">
                {language.modelProfiles.ollamaOpenAIFormat}
              </option>
              <option value={String(LLMFormat.OpenAIResponseAPI)} class="bg-darkbg">
                {language.modelProfiles.ollamaResponsesFormat}
              </option>
              <option value={String(LLMFormat.Anthropic)} class="bg-darkbg">
                {language.modelProfiles.ollamaAnthropicFormat}
              </option>
            </select>
          </label>
        {:else}
          <label class="flex flex-col gap-1">
            <span class="text-sm text-textcolor2">{language.modelProfiles.baseUrlLabel}</span>
            <TextInput
              size="sm"
              fullwidth
              bind:value={baseUrl}
              placeholder={language.modelProfiles.ollamaBaseUrlPlaceholder} />
          </label>
          <SecretField
            label={language.modelProfiles.apiKeyOptionalLabel}
            bind:value={apiKeyDraft}
            placeholder={language.modelProfiles.savedSecretPlaceholder} />
        {/if}
        {#if modelId !== 'ollama-cloud' || ollamaRequestFormat === String(LLMFormat.Ollama)}
          <label class="flex flex-col gap-1">
            <span class="text-sm text-textcolor2">{language.modelProfiles.ollamaThinkingMode}</span>
            <select
              class="rounded-md border border-darkborderc bg-transparent px-2 py-1 text-sm text-textcolor shadow-xs transition-colors duration-200 focus:border-borderc focus:outline-hidden focus:ring-2 focus:ring-borderc"
              bind:value={ollamaThinkingMode}>
              <option value="off" class="bg-darkbg">{language.modelProfiles.ollamaThinkingOff}</option>
              <option value="on" class="bg-darkbg">{language.modelProfiles.ollamaThinkingOn}</option>
              <option value="low" class="bg-darkbg">{language.modelProfiles.ollamaThinkingLow}</option>
              <option value="medium" class="bg-darkbg">{language.modelProfiles.ollamaThinkingMedium}</option>
              <option value="high" class="bg-darkbg">{language.modelProfiles.ollamaThinkingHigh}</option>
            </select>
          </label>
        {/if}
      </div>
    {:else if providerId === 'debug-echo'}
      <div class="grid gap-3 md:grid-cols-2">
        <label class="flex flex-col gap-1">
          <span class="text-sm text-textcolor2">{language.modelProfiles.baseUrlLabel}</span>
          <TextInput size="sm" fullwidth bind:value={baseUrl} placeholder={language.modelProfiles.baseUrlPlaceholder} />
        </label>
        <label class="flex flex-col gap-1">
          <span class="text-sm text-textcolor2">{language.modelProfiles.requestModelColumn}</span>
          <TextInput
            size="sm"
            fullwidth
            bind:value={requestModel}
            placeholder={language.modelProfiles.requestModelPlaceholder} />
        </label>
      </div>
    {/if}
  </div>
{/if}
