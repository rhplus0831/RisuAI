<script lang="ts">
  import { language } from 'src/lang'
  import TextAreaInput from '../UI/GUI/TextAreaInput.svelte'
  import Button from '../UI/GUI/Button.svelte'
  import { generateAIImage } from 'src/ts/process/stableDiff'
  import { createBlankChar } from 'src/ts/characters'
  import { alertError } from 'src/ts/alert'
  let prompt = $state('')
  let negPrompt = $state('')
  let img = $state('')
  let generatedPrompt = $state('')
  let generatedNegPrompt = $state('')
  let generating = $state(false)
  const run = async () => {
    console.log('running')
    if (generating) {
      return
    }
    generating = true
    const submittedPrompt = prompt
    const submittedNegPrompt = negPrompt
    try {
      const gen = await generateAIImage(submittedPrompt, createBlankChar(), submittedNegPrompt, 'inlay')
      if (gen && prompt === submittedPrompt && negPrompt === submittedNegPrompt) {
        img = gen
        generatedPrompt = submittedPrompt
        generatedNegPrompt = submittedNegPrompt
      }
    } catch (error) {
      alertError(error)
    } finally {
      generating = false
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
