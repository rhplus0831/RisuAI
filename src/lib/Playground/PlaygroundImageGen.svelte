<script lang="ts">
  import { language } from 'src/lang'
  import TextAreaInput from '../UI/GUI/TextAreaInput.svelte'
  import Button from '../UI/GUI/Button.svelte'
  import { generateAIImage } from 'src/ts/process/stableDiff'
  import { createBlankChar } from 'src/ts/characters'
  import { alertError } from 'src/ts/alert'
  import { onDestroy } from 'svelte'
  let prompt = $state('')
  let negPrompt = $state('')
  let img = $state('')
  let generatedPrompt = $state('')
  let generatedNegPrompt = $state('')
  let generating = $state(false)
  let destroyed = false
  let activeGeneration: AbortController | null = null

  function isAbortError(error: unknown): boolean {
    return !!error && typeof error === 'object' && 'name' in error && error.name === 'AbortError'
  }

  onDestroy(() => {
    destroyed = true
    activeGeneration?.abort()
    activeGeneration = null
  })

  const run = async () => {
    if (generating) {
      return
    }
    const controller = new AbortController()
    activeGeneration = controller
    generating = true
    const submittedPrompt = prompt
    const submittedNegPrompt = negPrompt
    try {
      const gen = await generateAIImage(submittedPrompt, createBlankChar(), submittedNegPrompt, 'inlay', {
        signal: controller.signal,
      })
      if (
        gen &&
        !destroyed &&
        activeGeneration === controller &&
        !controller.signal.aborted &&
        prompt === submittedPrompt &&
        negPrompt === submittedNegPrompt
      ) {
        img = gen
        generatedPrompt = submittedPrompt
        generatedNegPrompt = submittedNegPrompt
      }
    } catch (error) {
      if (!controller.signal.aborted && !isAbortError(error)) {
        alertError(error)
      }
    } finally {
      if (activeGeneration === controller) {
        activeGeneration = null
        if (!destroyed) generating = false
      }
    }
  }
</script>

<h2 class="text-4xl text-textcolor my-6 font-black relative">{language.imageGeneration}</h2>

<span class="text-textcolor text-lg">Prompt</span>
<TextAreaInput bind:value={prompt} ariaLabel={language.prompt} />

<span class="text-textcolor text-lg">Neg. Prompt</span>
<TextAreaInput bind:value={negPrompt} ariaLabel={language.negPrompt} />

{#if img && prompt === generatedPrompt && negPrompt === generatedNegPrompt}
  <span class="text-textcolor text-lg">Generated</span>
  <img src={img} class="max-w-full mt-4" alt="Generated" />
{/if}

<Button className="mt-6 flex justify-center" disabled={generating} onclick={run}>
  <span class:sr-only={generating}>{language.playground.generateImage}</span>
  {#if generating}
    <div class="loadmove" aria-hidden="true"></div>
  {/if}
</Button>
