<script lang="ts">
  import { ParseMarkdown } from 'src/ts/parser/parser.svelte'
  import { language } from 'src/lang'
  import TextAreaInput from '../UI/GUI/TextAreaInput.svelte'
  let input = $state('')
  let output = $state('')
  let parseEpoch = 0
  const onInput = async () => {
    const epoch = ++parseEpoch
    const source = input
    try {
      const parsed = await ParseMarkdown(source)
      if (epoch === parseEpoch) {
        output = parsed
      }
    } catch (e) {
      if (epoch === parseEpoch) {
        output = `Error: ${e}`
      }
    }
  }
</script>

<h2 class="text-4xl text-textcolor my-6 font-black relative">Full Parser</h2>

<span class="text-textcolor text-lg">Input</span>

<TextAreaInput {onInput} bind:value={input} optimaizedInput={false} ariaLabel={language.input} />

<span class="text-textcolor text-lg">Output HTML</span>

<TextAreaInput value={output} ariaLabel={language.playground.outputHtml} />
