<script lang="ts">
  import { language } from 'src/lang'
  import TextInput from 'src/lib/UI/GUI/TextInput.svelte'
  import {
    normalizeModelProfileRuntimeOptions,
    type ModelProfileRecordRuntimeOptions,
  } from 'src/ts/model/modelProfileRecords'
  import { FASTIFY_TOKENIZER_OPTIONS } from 'src/ts/model/tokenizerOptions'
  import { LLMFlags, type LLMFlags as LLMFlagValue } from 'src/ts/model/types'

  type RuntimeKey = keyof ModelProfileRecordRuntimeOptions

  interface RuntimeNumberField {
    key: RuntimeKey
    label: string
    step?: string
    min?: number
    max?: number
    storageScale?: number
  }

  interface RuntimeStringField {
    key: RuntimeKey
    label: string
    multiline?: boolean
  }

  interface RuntimeBooleanField {
    key: RuntimeKey
    label: string
  }

  interface Props {
    value: ModelProfileRecordRuntimeOptions
    scope?: 'defaults' | 'overrides'
  }

  let { value = $bindable({}), scope = 'overrides' }: Props = $props()

  const numberFields: RuntimeNumberField[] = [
    { key: 'maxContext', label: language.modelProfiles.runtimeFields.maxContext, step: '1' },
    { key: 'maxResponse', label: language.modelProfiles.runtimeFields.maxResponse, step: '1' },
    {
      key: 'temperature',
      label: language.modelProfiles.runtimeFields.temperature,
      step: '0.01',
      min: 0,
      max: 2,
      storageScale: 100,
    },
    { key: 'topP', label: language.modelProfiles.runtimeFields.topP, step: '0.01' },
    { key: 'topK', label: language.modelProfiles.runtimeFields.topK, step: '1' },
    { key: 'minP', label: language.modelProfiles.runtimeFields.minP, step: '0.01' },
    { key: 'topA', label: language.modelProfiles.runtimeFields.topA, step: '0.01' },
    { key: 'repetitionPenalty', label: language.modelProfiles.runtimeFields.repetitionPenalty, step: '0.01' },
    {
      key: 'frequencyPenalty',
      label: language.modelProfiles.runtimeFields.frequencyPenalty,
      step: '0.01',
      min: 0,
      max: 2,
      storageScale: 100,
    },
    {
      key: 'presencePenalty',
      label: language.modelProfiles.runtimeFields.presencePenalty,
      step: '0.01',
      min: 0,
      max: 2,
      storageScale: 100,
    },
    { key: 'reasoningEffort', label: language.modelProfiles.runtimeFields.reasoningEffort, step: '1' },
    { key: 'thinkingTokens', label: language.modelProfiles.runtimeFields.thinkingTokens, step: '1' },
    { key: 'verbosity', label: language.modelProfiles.runtimeFields.verbosity, step: '1' },
    { key: 'genTime', label: language.modelProfiles.runtimeFields.genTime, step: '1' },
  ]

  const stringFields: RuntimeStringField[] = [
    { key: 'thinkingType', label: language.modelProfiles.runtimeFields.thinkingType },
    { key: 'deepseekThinkingType', label: language.modelProfiles.runtimeFields.deepseekThinkingType },
    { key: 'adaptiveThinkingEffort', label: language.modelProfiles.runtimeFields.adaptiveThinkingEffort },
    { key: 'deepseekReasoningEffort', label: language.modelProfiles.runtimeFields.deepseekReasoningEffort },
    { key: 'extractJson', label: language.modelProfiles.runtimeFields.extractJson, multiline: true },
    { key: 'jsonSchema', label: language.modelProfiles.runtimeFields.jsonSchema, multiline: true },
  ]

  const booleanFields: RuntimeBooleanField[] = [
    { key: 'halfStreaming', label: language.modelProfiles.runtimeFields.halfStreaming },
    { key: 'useStreaming', label: language.modelProfiles.runtimeFields.useStreaming },
    { key: 'jsonSchemaEnabled', label: language.modelProfiles.runtimeFields.jsonSchemaEnabled },
    { key: 'strictJsonSchema', label: language.modelProfiles.runtimeFields.strictJsonSchema },
    { key: 'outputImageModal', label: language.modelProfiles.runtimeFields.outputImageModal },
    { key: 'enableCustomFlags', label: language.modelProfiles.runtimeFields.enableCustomFlags },
    { key: 'stripCoT', label: language.modelProfiles.runtimeFields.stripCoT },
  ]

  const flagOptions = Object.entries(LLMFlags).map(([label, flag]) => ({
    label,
    flag: flag as LLMFlagValue,
  }))

  function asRecord(): Record<string, unknown> {
    return { ...(value ?? {}) }
  }

  function commit(next: Record<string, unknown>): void {
    value = normalizeModelProfileRuntimeOptions(next) ?? {}
  }

  function deleteRuntimeKey(key: RuntimeKey): void {
    const next = asRecord()
    delete next[key]
    commit(next)
  }

  function setNumber(field: RuntimeNumberField, raw: string): void {
    const trimmed = raw.trim()
    if (!trimmed) {
      deleteRuntimeKey(field.key)
      return
    }
    const numeric = Number(trimmed)
    if (!Number.isFinite(numeric)) return
    const stored =
      field.storageScale && numeric !== -1000
        ? Math.max(
            (field.min ?? Number.NEGATIVE_INFINITY) * field.storageScale,
            Math.min(
              (field.max ?? Number.POSITIVE_INFINITY) * field.storageScale,
              Math.round(numeric * field.storageScale),
            ),
          )
        : numeric
    const next = asRecord()
    next[field.key] = stored
    commit(next)
  }

  function setString(key: RuntimeKey, raw: string): void {
    const trimmed = raw.trim()
    if (!trimmed) {
      deleteRuntimeKey(key)
      return
    }
    const next = asRecord()
    next[key] = raw
    commit(next)
  }

  function setBoolean(key: RuntimeKey, raw: string): void {
    if (raw !== 'true' && raw !== 'false') {
      deleteRuntimeKey(key)
      return
    }
    const next = asRecord()
    next[key] = raw === 'true'
    commit(next)
  }

  function setDefaultCheckbox(key: RuntimeKey, checked: boolean): void {
    const next = asRecord()
    if (checked) {
      next[key] = true
    } else {
      delete next[key]
    }
    commit(next)
  }

  function numberValue(field: RuntimeNumberField): string {
    const item = value?.[field.key]
    if (typeof item !== 'number' || !Number.isFinite(item)) return ''
    if (!field.storageScale || item === -1000) return String(item)
    return String(Number((item / field.storageScale).toFixed(12)))
  }

  function stringValue(key: RuntimeKey): string {
    const item = value?.[key]
    return typeof item === 'string' ? item : ''
  }

  function booleanValue(key: RuntimeKey): string {
    const item = value?.[key]
    return typeof item === 'boolean' ? String(item) : ''
  }

  function modelToolsValue(): string {
    return Array.isArray(value?.modelTools) ? value.modelTools.join(', ') : ''
  }

  function setModelTools(raw: string): void {
    const tools = raw
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
    const next = asRecord()
    if (tools.length > 0) {
      next.modelTools = tools
    } else {
      delete next.modelTools
    }
    commit(next)
  }

  function customFlags(): LLMFlagValue[] {
    return Array.isArray(value?.customFlags) ? value.customFlags : []
  }

  function customFlagEnabled(flag: LLMFlagValue): boolean {
    return customFlags().includes(flag)
  }

  function setCustomFlag(flag: LLMFlagValue, enabled: boolean): void {
    const nextFlags = enabled ? [...customFlags(), flag] : customFlags().filter((item) => item !== flag)
    const uniqueFlags = [...new Set(nextFlags)]
    const next = asRecord()
    if (uniqueFlags.length > 0) {
      next.customFlags = uniqueFlags
    } else {
      delete next.customFlags
    }
    commit(next)
  }
</script>

<div class="flex flex-col gap-4">
  <div>
    <h4 class="mb-2 text-sm font-semibold">{language.modelProfiles.runtimeNumberSection}</h4>
    <div class="grid gap-3 md:grid-cols-2">
      {#each numberFields as field (field.key)}
        <label class="flex flex-col gap-1">
          <span class="text-sm text-textcolor2">{field.label}</span>
          <input
            class="w-full rounded-md border border-darkborderc bg-transparent px-2 py-1 text-sm text-textcolor shadow-xs transition-colors duration-200 focus:border-borderc focus:outline-hidden focus:ring-2 focus:ring-borderc"
            type="number"
            step={field.step}
            min={field.min}
            max={field.max}
            value={numberValue(field)}
            placeholder={language.modelProfiles.runtimeUnset}
            oninput={(event) => {
              setNumber(field, event.currentTarget.value)
            }} />
        </label>
      {/each}
    </div>
  </div>

  <div>
    <h4 class="mb-2 text-sm font-semibold">{language.modelProfiles.runtimeBooleanSection}</h4>
    <div class="grid gap-3 md:grid-cols-2">
      {#each booleanFields as field (field.key)}
        {#if scope === 'defaults' && field.key === 'stripCoT'}
          <label class="flex items-center gap-2 text-sm text-textcolor2">
            <input
              data-runtime-strip-cot
              type="checkbox"
              class="h-4 w-4"
              checked={value?.stripCoT === true}
              onchange={(event) => {
                setDefaultCheckbox(field.key, event.currentTarget.checked)
              }} />
            <span>{field.label}</span>
          </label>
        {:else}
          <label class="flex flex-col gap-1">
            <span class="text-sm text-textcolor2">{field.label}</span>
            <select
              data-runtime-field={field.key}
              class="w-full rounded-md border border-darkborderc bg-transparent px-2 py-1 text-sm text-textcolor shadow-xs transition-colors duration-200 focus:border-borderc focus:outline-hidden focus:ring-2 focus:ring-borderc"
              value={booleanValue(field.key)}
              onchange={(event) => {
                setBoolean(field.key, event.currentTarget.value)
              }}>
              <option value="" class="bg-darkbg">{language.modelProfiles.runtimeUnset}</option>
              <option value="true" class="bg-darkbg">{language.modelProfiles.runtimeTrue}</option>
              <option value="false" class="bg-darkbg">{language.modelProfiles.runtimeFalse}</option>
            </select>
          </label>
        {/if}
      {/each}
    </div>
  </div>

  <div>
    <h4 class="mb-2 text-sm font-semibold">{language.modelProfiles.runtimeTextSection}</h4>
    <div class="grid gap-3">
      {#each stringFields as field (field.key)}
        <label class="flex flex-col gap-1">
          <span class="text-sm text-textcolor2">{field.label}</span>
          {#if field.multiline}
            <textarea
              class="min-h-24 w-full rounded-md border border-darkborderc bg-transparent px-2 py-1 text-sm text-textcolor shadow-xs transition-colors duration-200 focus:border-borderc focus:outline-hidden focus:ring-2 focus:ring-borderc"
              value={stringValue(field.key)}
              placeholder={language.modelProfiles.runtimeUnset}
              oninput={(event) => {
                setString(field.key, event.currentTarget.value)
              }}></textarea>
          {:else}
            <TextInput
              size="sm"
              fullwidth
              value={stringValue(field.key)}
              placeholder={language.modelProfiles.runtimeUnset}
              oninput={(event) => {
                setString(field.key, event.currentTarget.value)
              }} />
          {/if}
        </label>
      {/each}

      <label class="flex flex-col gap-1">
        <span class="text-sm text-textcolor2">{language.modelProfiles.runtimeFields.customTokenizer}</span>
        <select
          data-runtime-tokenizer-picker
          class="w-full rounded-md border border-darkborderc bg-transparent px-2 py-1 text-sm text-textcolor shadow-xs transition-colors duration-200 focus:border-borderc focus:outline-hidden focus:ring-2 focus:ring-borderc"
          value={stringValue('customTokenizer')}
          onchange={(event) => {
            setString('customTokenizer', event.currentTarget.value)
          }}>
          <option value="" class="bg-darkbg">{language.modelProfiles.runtimeUnset}</option>
          {#each FASTIFY_TOKENIZER_OPTIONS as option (option.value)}
            <option value={option.value} class="bg-darkbg">{language.tokenizerOptions[option.labelKey]}</option>
          {/each}
        </select>
      </label>

      <label class="flex flex-col gap-1">
        <span class="text-sm text-textcolor2">{language.modelProfiles.runtimeFields.modelTools}</span>
        <TextInput
          size="sm"
          fullwidth
          value={modelToolsValue()}
          placeholder={language.modelProfiles.commaSeparatedPlaceholder}
          oninput={(event) => {
            setModelTools(event.currentTarget.value)
          }} />
      </label>
    </div>
  </div>

  <div>
    <h4 class="mb-2 text-sm font-semibold">{language.modelProfiles.runtimeCustomFlagsSection}</h4>
    <div class="grid gap-2 sm:grid-cols-2">
      {#each flagOptions as option (option.flag)}
        <label class="flex items-center gap-2 text-sm text-textcolor2">
          <input
            type="checkbox"
            class="h-4 w-4"
            checked={customFlagEnabled(option.flag)}
            onchange={(event) => {
              setCustomFlag(option.flag, event.currentTarget.checked)
            }} />
          <span>{option.label}</span>
        </label>
      {/each}
    </div>
  </div>
</div>
