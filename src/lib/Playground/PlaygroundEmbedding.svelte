<script lang="ts">
  import { language } from 'src/lang'
  import TextInput from '../UI/GUI/TextInput.svelte'
  import SecretInput from '../UI/GUI/SecretInput.svelte'
  import OptionInput from '../UI/GUI/OptionInput.svelte'
  import SelectInput from '../UI/GUI/SelectInput.svelte'
  import Button from '../UI/GUI/Button.svelte'
  import { HypaProcesser } from 'src/ts/process/memory/hypamemory'
  import { createServerBackedSettingDraft } from 'src/ts/server/settingsBridge.svelte'
  import { alertError } from 'src/ts/alert'

  let query = $state('')
  let model = $state('MiniLM')
  let data: string[] = $state([])
  let dataresult: [string, number][] = $state([])
  let running = $state(false)
  let runAbort: AbortController | undefined
  let displayedInputSignature: string | undefined = $state()
  const hypaV3KeyDraft = createServerBackedSettingDraft<string>('hypaV3Key', '')
  const hypaCustomSettingsDraft = createServerBackedSettingDraft<Record<string, any>>('hypaCustomSettings', {
    url: '',
    key: '',
    model: '',
  })

  const readString = (value: unknown): string => (typeof value === 'string' ? value : '')

  const captureRunInput = () => {
    const input = {
      model,
      customEmbeddingUrl: readString(hypaCustomSettingsDraft.value.url),
      openAiKey: readString(hypaV3KeyDraft.value),
      customKey: readString(hypaCustomSettingsDraft.value.key),
      customModel: readString(hypaCustomSettingsDraft.value.model),
      query,
      data: [...data],
    }

    return {
      ...input,
      signature: JSON.stringify(input),
    }
  }

  $effect(() => {
    const currentInputSignature = captureRunInput().signature
    if (displayedInputSignature && displayedInputSignature !== currentInputSignature) {
      displayedInputSignature = undefined
      dataresult = []
    }
  })

  const run = async () => {
    if (running) return
    const input = captureRunInput()
    const abort = new AbortController()
    runAbort = abort
    running = true
    displayedInputSignature = undefined
    dataresult = []
    try {
      const processer = new HypaProcesser(input.model as any, input.customEmbeddingUrl, {
        openAIKey: input.openAiKey,
        customKey: input.customKey,
        customModel: input.customModel,
        signal: abort.signal,
      })
      await processer.addText(input.data)
      const result = await processer.similaritySearchScored(input.query)
      if (captureRunInput().signature !== input.signature) return
      displayedInputSignature = input.signature
      dataresult = result
    } catch (error) {
      if (abort.signal.aborted) return
      alertError(error)
    } finally {
      if (runAbort === abort) {
        runAbort = undefined
        running = false
      }
    }
  }

  $effect(() => () => runAbort?.abort())
</script>

<h2 class="text-4xl text-textcolor my-6 font-black relative">{language.embedding}</h2>

<span class="text-textcolor text-lg">Model</span>
<SelectInput bind:value={model} className="mb-4" disabled={running} ariaLabel={language.playground.embeddingModel}>
  {#if 'gpu' in navigator}
    <OptionInput value="MiniLMGPU">MiniLM L6 v2 (GPU)</OptionInput>
    <OptionInput value="nomicGPU">Nomic Embed Text v1.5 (GPU)</OptionInput>
    <OptionInput value="bgeSmallEnGPU">BGE Small English (GPU)</OptionInput>
    <OptionInput value="bgem3GPU">BGE Medium 3 (GPU)</OptionInput>
    <OptionInput value="multiMiniLMGPU">Multilingual MiniLM L12 v2 (GPU)</OptionInput>
    <OptionInput value="bgeM3KoGPU">BGE Medium 3 Korean (GPU)</OptionInput>
  {/if}
  <OptionInput value="MiniLM">MiniLM L6 v2 (CPU)</OptionInput>
  <OptionInput value="nomic">Nomic Embed Text v1.5 (CPU)</OptionInput>
  <OptionInput value="bgeSmallEn">BGE Small English (CPU)</OptionInput>
  <OptionInput value="bgem3">BGE Medium 3 (CPU)</OptionInput>
  <OptionInput value="multiMiniLM">Multilingual MiniLM L12 v2 (CPU)</OptionInput>
  <OptionInput value="bgeM3Ko">BGE Medium 3 Korean (CPU)</OptionInput>
  <OptionInput value="openai3small">OpenAI text-embedding-3-small</OptionInput>
  <OptionInput value="openai3large">OpenAI text-embedding-3-large</OptionInput>
  <OptionInput value="ada">OpenAI Ada</OptionInput>
  <OptionInput value="custom">Custom (OpenAI-compatible)</OptionInput>
</SelectInput>

{#if model === 'openai3small' || model === 'openai3large' || model === 'ada'}
  <span class="text-textcolor text-lg">OpenAI API Key</span>
  <SecretInput
    size="sm"
    marginBottom
    ownerKey="hypaV3Key"
    bind:value={hypaV3KeyDraft.value}
    disabled={running}
    ariaLabel={language.playground.embeddingOpenAIKey} />
{/if}

{#if model === 'custom'}
  <span class="text-textcolor text-lg">URL</span>
  <TextInput
    size="sm"
    marginBottom
    bind:value={hypaCustomSettingsDraft.value.url}
    disabled={running}
    ariaLabel={language.playground.embeddingCustomUrl} />
  <span class="text-textcolor text-lg">Key/Password</span>
  <SecretInput
    size="sm"
    marginBottom
    ownerKey="hypaCustomSettings.key"
    bind:value={hypaCustomSettingsDraft.value.key}
    disabled={running}
    ariaLabel={language.playground.embeddingCustomKey} />
  <span class="text-textcolor text-lg">Request Model</span>
  <TextInput
    size="sm"
    marginBottom
    bind:value={hypaCustomSettingsDraft.value.model}
    disabled={running}
    ariaLabel={language.playground.embeddingRequestModel} />
{/if}

<div class="mb-4"></div>

<span class="text-textcolor text-lg">Query</span>
<TextInput bind:value={query} size="lg" fullwidth disabled={running} ariaLabel={language.playground.embeddingQuery} />

<span class="text-textcolor text-lg mt-6">Data</span>
{#each data as item, i}
  <TextInput
    bind:value={data[i]}
    size="lg"
    fullwidth
    marginBottom
    disabled={running}
    ariaLabel={language.playground.embeddingData(i + 1)} />
{/each}
<Button
  styled="outlined"
  disabled={running}
  onclick={() => {
    data.push('')
    data = data
  }}>
  <span aria-hidden="true">+</span>
  <span class="sr-only">{language.playground.embeddingAddData}</span>
</Button>

<span class="text-textcolor text-lg mt-6">Result</span>
{#if dataresult.length === 0}
  <span class="text-textcolor2 text-lg">No result</span>
{/if}
{#each dataresult as [item, score]}
  <div class="flex justify-between">
    <span>{item}</span>
    <span>{score.toFixed(2)}</span>
  </div>
{/each}

<Button
  className="mt-6 flex justify-center"
  size="lg"
  disabled={running}
  onclick={() => {
    run()
  }}>
  <span class:sr-only={running}>{language.run?.toLocaleUpperCase()}</span>
  {#if running}
    <div class="loadmove" aria-hidden="true"></div>
  {/if}
</Button>
