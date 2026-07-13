<script lang="ts">
  import { SaveIcon, XIcon } from '@lucide/svelte'
  import { language } from 'src/lang'
  import Accordion from 'src/lib/UI/Accordion.svelte'
  import Button from 'src/lib/UI/GUI/Button.svelte'
  import OptionInput from 'src/lib/UI/GUI/OptionInput.svelte'
  import SelectInput from 'src/lib/UI/GUI/SelectInput.svelte'
  import TextInput from 'src/lib/UI/GUI/TextInput.svelte'
  import {
    FIRST_CLASS_MODEL_PROFILE_PROVIDER_IDS,
    type FirstClassModelProfileProviderId,
  } from 'src/ts/model/modelProfileResolver'
  import {
    normalizeModelProfileRuntimeOptions,
    type ModelProfileRecord,
    type ModelProfileRecordFallbackRef,
    type ModelProfileRecordProviderOptions,
    type ModelProfileRecordRuntimeOptions,
  } from 'src/ts/model/modelProfileRecords'
  import {
    createModelProfileSecretDraft,
    modelProfileSecretValueForSave,
    type ModelProfileSecretDraft,
  } from 'src/ts/model/modelProfileSecrets'
  import type { ModelRole } from 'src/ts/model/modelRoles'
  import { LLMFormat, type LLMFlags as LLMFlagValue, type LLMTokenizer as LLMTokenizerValue } from 'src/ts/model/types'
  import type { ModelProfileSnapshot } from 'src/ts/server/commands'
  import ModelFallbackEditor from './ModelFallbackEditor.svelte'
  import ModelProviderPanel from './ModelProviderPanel.svelte'
  import ModelRuntimeOptionsEditor from './ModelRuntimeOptionsEditor.svelte'

  interface KeyValueRow {
    key: string
    value: string
  }

  interface Props {
    mode: 'create' | 'edit'
    profile?: ModelProfileRecord
    profiles: ModelProfileRecord[]
    usedByRoles: ModelRole[]
    statusText: string
    busy?: boolean
    commandError?: string
    onSave: (profile: ModelProfileSnapshot) => void | Promise<void>
    onCancel: () => void
  }

  let {
    mode,
    profile,
    profiles = [],
    usedByRoles = [],
    statusText,
    busy = false,
    commandError = '',
    onSave,
    onCancel,
  }: Props = $props()

  const firstClassProviderIds = new Set<string>(FIRST_CLASS_MODEL_PROFILE_PROVIDER_IDS)
  const fixedModelProviderIds = new Set<string>(['custom-api', 'debug-echo'])
  // svelte-ignore state_referenced_locally
  const initialProfile = profile

  let draftName = $state(initialProfile?.name ?? language.modelProfiles.newProfileDefaultName)
  let providerId = $state(initialProviderId())
  let modelId = $state(initialModelId())
  let requestModel = $state(initialProfile?.providerOptions?.requestModel ?? '')
  let apiKeyDraft = $state<ModelProfileSecretDraft>(
    createModelProfileSecretDraft(initialProfile?.providerOptions?.apiKey),
  )
  let baseUrl = $state(initialProfile?.providerOptions?.baseUrl ?? '')
  let extraHeadersRows = $state<KeyValueRow[]>(recordToRows(initialProfile?.providerOptions?.extraHeaders))
  let additionalParamRows = $state<KeyValueRow[]>(paramsToRows(initialProfile?.providerOptions?.additionalParams))
  let ollamaRequestFormat = $state(
    String(initialProfile?.providerOptions?.ollama?.requestFormat ?? LLMFormat.OpenAICompatible),
  )
  let ollamaModelSource = $state(initialProfile?.providerOptions?.ollama?.modelSource ?? '')
  let ollamaThinkingMode = $state(initialProfile?.providerOptions?.ollama?.thinkingMode ?? 'off')
  let vertexProjectId = $state(initialProfile?.providerOptions?.vertex?.projectId ?? '')
  let vertexRegion = $state(initialProfile?.providerOptions?.vertex?.region ?? '')
  let vertexClientEmail = $state(initialProfile?.providerOptions?.vertex?.clientEmail ?? '')
  let vertexPrivateKeyDraft = $state<ModelProfileSecretDraft>(
    createModelProfileSecretDraft(initialProfile?.providerOptions?.vertex?.privateKey),
  )
  let customTokenizer = $state(
    initialProfile?.providerOptions?.customApi?.tokenizer === undefined
      ? ''
      : String(initialProfile.providerOptions.customApi.tokenizer),
  )
  let customFlags = $state<LLMFlagValue[]>([...(initialProfile?.providerOptions?.customApi?.flags ?? [])])
  let runtimeOptions = $state<ModelProfileRecordRuntimeOptions>(cloneJsonValue(initialProfile?.runtimeOptions ?? {}))
  let fallbacks = $state<ModelProfileRecordFallbackRef[]>(cloneJsonValue(initialProfile?.fallbacks ?? []))
  let initialSnapshot = $state('')

  let canEditProviderFields = $derived(
    mode === 'create' || (!!initialProfile?.providerId && firstClassProviderIds.has(initialProfile.providerId)),
  )
  let providerIsFirstClass = $derived(firstClassProviderIds.has(providerId))
  let drawerTitle = $derived(
    mode === 'create' ? language.modelProfiles.createProfile : language.modelProfiles.editProfile,
  )
  let usedByText = $derived(
    usedByRoles.length === 0
      ? language.modelProfiles.notUsedByRoles
      : usedByRoles.map((role) => language.modelRoles.roles[role]).join(', '),
  )
  let isDirty = $derived(initialSnapshot !== '' && initialSnapshot !== snapshot(snapshotForSave()))
  let canSave = $derived(!busy && (mode === 'create' || isDirty))

  $effect(() => {
    if (!initialSnapshot) initialSnapshot = snapshot(snapshotForSave())
  })

  function initialProviderId(): string {
    if (mode === 'create') return 'openai'
    return initialProfile?.providerId ?? ''
  }

  function initialModelId(): string {
    if (mode === 'create') return ''
    return initialProfile?.modelId ?? ''
  }

  function cloneJsonValue<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T
  }

  function snapshot(value: unknown): string {
    return JSON.stringify(value ?? {})
  }

  function recordToRows(value: Record<string, string> | undefined): KeyValueRow[] {
    if (!value) return []
    return Object.entries(value).map(([key, rowValue]) => ({ key, value: rowValue }))
  }

  function paramsToRows(value: Array<[string, string]> | undefined): KeyValueRow[] {
    return (value ?? []).map(([key, rowValue]) => ({ key, value: rowValue }))
  }

  function rowsToRecord(rows: KeyValueRow[]): Record<string, string> | undefined {
    const out: Record<string, string> = {}
    for (const row of rows) {
      const key = row.key.trim()
      if (!key) continue
      out[key] = row.value.trim()
    }
    return Object.keys(out).length > 0 ? out : undefined
  }

  function rowsToParams(rows: KeyValueRow[]): Array<[string, string]> | undefined {
    const out: Array<[string, string]> = []
    for (const row of rows) {
      const key = row.key.trim()
      if (!key) continue
      out.push([key, row.value.trim()])
    }
    return out.length > 0 ? out : undefined
  }

  function removeEmptyProviderOptions(
    options: ModelProfileRecordProviderOptions,
  ): ModelProfileRecordProviderOptions | undefined {
    return Object.keys(options).length > 0 ? options : undefined
  }

  function setProviderId(nextProviderId: string): void {
    providerId = nextProviderId
    if (fixedModelProviderIds.has(nextProviderId)) {
      modelId = nextProviderId
    } else if (fixedModelProviderIds.has(modelId)) {
      modelId = ''
    }
    if (nextProviderId === 'ollama' && !modelId) {
      modelId = 'ollama-hosted'
    }
  }

  function secretValue(draft: ModelProfileSecretDraft): string | undefined {
    return modelProfileSecretValueForSave(draft)
  }

  function firstClassProviderOptionsForSave(
    nextProviderId: FirstClassModelProfileProviderId,
  ): ModelProfileRecordProviderOptions | undefined {
    if (nextProviderId === 'vertex') {
      const privateKey = secretValue(vertexPrivateKeyDraft)
      const vertex: NonNullable<ModelProfileRecordProviderOptions['vertex']> = {}
      if (vertexProjectId.trim()) vertex.projectId = vertexProjectId.trim()
      if (vertexRegion.trim()) vertex.region = vertexRegion.trim()
      if (vertexClientEmail.trim()) vertex.clientEmail = vertexClientEmail.trim()
      if (privateKey) vertex.privateKey = privateKey

      const options: ModelProfileRecordProviderOptions = {}
      if (requestModel.trim()) options.requestModel = requestModel.trim()
      if (Object.keys(vertex).length > 0) options.vertex = vertex
      return removeEmptyProviderOptions(options)
    }

    if (nextProviderId === 'custom-api') {
      const options: ModelProfileRecordProviderOptions = {}
      const apiKey = secretValue(apiKeyDraft)
      const headers = rowsToRecord(extraHeadersRows)
      const params = rowsToParams(additionalParamRows)
      const customApi: NonNullable<ModelProfileRecordProviderOptions['customApi']> = {}
      const tokenizer = Number(customTokenizer)
      if (customTokenizer !== '' && Number.isFinite(tokenizer)) customApi.tokenizer = tokenizer as LLMTokenizerValue
      if (customFlags.length > 0) customApi.flags = customFlags
      if (baseUrl.trim()) options.baseUrl = baseUrl.trim()
      if (requestModel.trim()) options.requestModel = requestModel.trim()
      if (apiKey) options.apiKey = apiKey
      if (headers) options.extraHeaders = headers
      if (params) options.additionalParams = params
      if (Object.keys(customApi).length > 0) options.customApi = customApi
      return removeEmptyProviderOptions(options)
    }

    if (nextProviderId === 'debug-echo') {
      const options: ModelProfileRecordProviderOptions = {}
      if (baseUrl.trim()) options.baseUrl = baseUrl.trim()
      if (requestModel.trim()) options.requestModel = requestModel.trim()
      return removeEmptyProviderOptions(options)
    }

    if (nextProviderId === 'ollama') {
      const options: ModelProfileRecordProviderOptions = {}
      const apiKey = secretValue(apiKeyDraft)
      const ollama: NonNullable<ModelProfileRecordProviderOptions['ollama']> = {}
      const requestFormatNumber = Number(ollamaRequestFormat)
      const isCloud = modelId === 'ollama-cloud'
      if (apiKey) options.apiKey = apiKey
      if (requestModel.trim()) options.requestModel = requestModel.trim()
      if (!isCloud && baseUrl.trim()) {
        options.baseUrl = baseUrl.trim()
        ollama.url = baseUrl.trim()
      }
      if (isCloud && Number.isFinite(requestFormatNumber)) {
        ollama.requestFormat = requestFormatNumber as LLMFormat
      } else {
        ollama.requestFormat = LLMFormat.Ollama
      }
      if (ollamaModelSource.trim()) {
        ollama.modelSource = ollamaModelSource.trim()
      } else {
        ollama.modelSource = isCloud ? 'cloud' : 'local'
      }
      if (ollamaThinkingMode.trim()) ollama.thinkingMode = ollamaThinkingMode.trim()
      if (Object.keys(ollama).length > 0) options.ollama = ollama
      return removeEmptyProviderOptions(options)
    }

    const options: ModelProfileRecordProviderOptions = {}
    const apiKey = secretValue(apiKeyDraft)
    if (apiKey) options.apiKey = apiKey
    if (requestModel.trim()) options.requestModel = requestModel.trim()
    return removeEmptyProviderOptions(options)
  }

  function sanitizedFallbacks(): ModelProfileRecordFallbackRef[] | undefined {
    const seen = new Set<string>()
    const rows: ModelProfileRecordFallbackRef[] = []
    for (const fallback of fallbacks) {
      if (fallback.mode === 'profile') {
        const fallbackProfileId = fallback.profileId.trim()
        const key = `profile:${fallbackProfileId}`
        if (!fallbackProfileId || fallbackProfileId === initialProfile?.id || seen.has(key)) continue
        rows.push({ mode: 'profile', profileId: fallbackProfileId })
        seen.add(key)
        continue
      }
      const fallbackModelId = fallback.modelId.trim()
      const key = `model:${fallbackModelId}`
      if (!fallbackModelId || seen.has(key)) continue
      rows.push({ mode: 'model', modelId: fallbackModelId })
      seen.add(key)
    }
    return rows.length > 0 ? rows : undefined
  }

  function snapshotForSave(): ModelProfileSnapshot {
    const next: ModelProfileSnapshot = initialProfile ? cloneJsonValue(initialProfile) : { name: '' }
    next.name = draftName.trim() || initialProfile?.name || language.modelProfiles.newProfileDefaultName

    if (!canEditProviderFields || !providerIsFirstClass) {
      return next
    }

    const nextProviderId = providerId as FirstClassModelProfileProviderId
    next.providerId = nextProviderId
    next.modelId = fixedModelProviderIds.has(nextProviderId) ? nextProviderId : modelId.trim()
    if (!next.modelId) delete next.modelId

    const providerOptions = firstClassProviderOptionsForSave(nextProviderId)
    if (providerOptions) {
      next.providerOptions = providerOptions
    } else {
      delete next.providerOptions
    }

    const normalizedRuntimeOptions = normalizeModelProfileRuntimeOptions(runtimeOptions)
    if (normalizedRuntimeOptions) {
      next.runtimeOptions = normalizedRuntimeOptions
    } else {
      delete next.runtimeOptions
    }

    const nextFallbacks = sanitizedFallbacks()
    if (nextFallbacks) {
      next.fallbacks = nextFallbacks
    } else {
      delete next.fallbacks
    }

    return next
  }

  function requestClose(): void {
    if (isDirty && !window.confirm(language.modelProfiles.discardProfileChangesConfirm)) return
    onCancel()
  }

  async function saveProfile(): Promise<void> {
    if (!canSave) return
    await onSave(snapshotForSave())
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="fixed inset-0 z-50 flex justify-end bg-black/50" role="button" tabindex="0" onclick={requestClose}>
  <div
    class="flex h-full w-full max-w-3xl flex-col border-l border-darkborderc bg-bgcolor text-textcolor shadow-xl"
    role="dialog"
    aria-modal="true"
    aria-label={drawerTitle}
    tabindex="-1"
    onclick={(event) => {
      event.stopPropagation()
    }}>
    <div class="flex items-start justify-between gap-3 border-b border-darkborderc p-4">
      <div class="min-w-0">
        <h3 class="truncate text-xl font-semibold">{drawerTitle}</h3>
        <span class="text-sm text-textcolor2">{language.modelProfiles.usedByColumn}: {usedByText}</span>
      </div>
      <button
        type="button"
        class="flex h-9 w-9 shrink-0 items-center justify-center rounded-md hover:bg-darkbutton"
        aria-label={language.modelRoles.close}
        onclick={requestClose}>
        <XIcon size={20} />
      </button>
    </div>

    <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
      {#if commandError}
        <div class="rounded-md border border-draculared p-3 text-sm text-draculared">{commandError}</div>
      {/if}

      <section class="rounded-md border border-darkborderc p-3">
        <div class="grid gap-3 md:grid-cols-2">
          <label class="flex flex-col gap-1">
            <span class="text-sm text-textcolor2">{language.modelProfiles.profileNameColumn}</span>
            <TextInput size="sm" fullwidth bind:value={draftName} />
          </label>

          {#if canEditProviderFields}
            <label class="flex flex-col gap-1">
              <span class="text-sm text-textcolor2">{language.modelProfiles.providerColumn}</span>
              <SelectInput
                size="sm"
                className="w-full"
                value={providerId}
                onchange={(event) => {
                  setProviderId(String(event.currentTarget.value))
                }}>
                {#each FIRST_CLASS_MODEL_PROFILE_PROVIDER_IDS as optionProviderId (optionProviderId)}
                  <OptionInput value={optionProviderId}>
                    {language.modelProfiles.providerNames[optionProviderId]}
                  </OptionInput>
                {/each}
              </SelectInput>
            </label>
          {:else}
            <div class="flex flex-col gap-1">
              <span class="text-sm text-textcolor2">{language.modelProfiles.providerColumn}</span>
              <span class="rounded-md border border-darkborderc px-2 py-1 text-sm text-textcolor2">
                {initialProfile?.providerId
                  ? language.modelProfiles.unsupportedProviderLabel(initialProfile.providerId)
                  : language.modelProfiles.compatibilityProvider}
              </span>
            </div>
          {/if}
        </div>

        {#if mode === 'edit'}
          <div class="mt-3 rounded-md bg-darkbg px-3 py-2 text-sm text-textcolor2">
            {language.modelProfiles.statusColumn}: {statusText}
          </div>
        {/if}
      </section>

      <section class="rounded-md border border-darkborderc p-3">
        <div class="mb-3 flex flex-col gap-1">
          <h4 class="text-base font-semibold">{language.modelProfiles.providerConfiguration}</h4>
        </div>
        <ModelProviderPanel
          bind:providerId
          bind:modelId
          bind:requestModel
          bind:apiKeyDraft
          bind:baseUrl
          bind:extraHeadersRows
          bind:additionalParamRows
          bind:ollamaRequestFormat
          bind:ollamaModelSource
          bind:ollamaThinkingMode
          bind:vertexProjectId
          bind:vertexRegion
          bind:vertexClientEmail
          bind:vertexPrivateKeyDraft
          bind:customTokenizer
          bind:customFlags />
      </section>

      {#if canEditProviderFields && providerIsFirstClass}
        <Accordion styled name={language.modelProfiles.runtimeOverridesTitle}>
          <ModelRuntimeOptionsEditor bind:value={runtimeOptions} />
        </Accordion>

        <Accordion styled name={language.modelProfiles.fallbacksTitle}>
          <ModelFallbackEditor profileId={initialProfile?.id} {profiles} bind:value={fallbacks} />
        </Accordion>
      {:else}
        <div class="rounded-md border border-darkborderc p-3 text-sm text-textcolor2">
          {language.modelProfiles.compatibilityRuntimeNotice}
        </div>
      {/if}
    </div>

    <div class="flex flex-wrap items-center justify-end gap-2 border-t border-darkborderc p-4">
      <Button size="sm" styled="outlined" disabled={busy} onclick={requestClose}>
        <span class="inline-flex items-center gap-1"><XIcon size={14} />{language.modelProfiles.cancel}</span>
      </Button>
      <Button size="sm" disabled={!canSave} onclick={saveProfile}>
        <span class="inline-flex items-center gap-2"
          ><SaveIcon size={16} />{busy ? language.modelProfiles.saving : language.modelProfiles.save}</span>
      </Button>
    </div>
  </div>
</div>
