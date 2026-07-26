<script lang="ts">
  import { encodeWithTokenizer } from 'src/ts/tokenizer'
  import { FASTIFY_TOKENIZER_OPTIONS } from 'src/ts/model/tokenizerOptions'
  import TextAreaInput from '../UI/GUI/TextAreaInput.svelte'
  import SelectInput from '../UI/GUI/SelectInput.svelte'
  import { language } from 'src/lang'

  let input = $state('')
  let output = $state('')
  let outputLength = $state(0)
  let time = $state(0)
  let selectedTokenizer = $state('tik')
  let tokenizeEpoch = 0

  const onInput = async () => {
    const epoch = ++tokenizeEpoch
    const source = input
    const tokenizer = selectedTokenizer
    try {
      const start = performance.now()
      const tokenized = await encodeWithTokenizer(source, tokenizer)
      const tokenizedNumArray = Array.from(tokenized)
      if (epoch === tokenizeEpoch) {
        time = performance.now() - start
        outputLength = tokenizedNumArray.length
        output = JSON.stringify(tokenizedNumArray)
      }
    } catch (e) {
      if (epoch === tokenizeEpoch) {
        output = `Error: ${e}`
      }
    }
  }

  const onTokenizerChange = () => {
    if (input) {
      onInput()
    }
  }
</script>

<h2 class="text-4xl text-textcolor my-6 font-black relative">{language.tokenizer}</h2>

<span class="text-textcolor text-lg">Tokenizer</span>

<SelectInput bind:value={selectedTokenizer} onchange={onTokenizerChange} ariaLabel={language.tokenizer}>
  {#each FASTIFY_TOKENIZER_OPTIONS as option (option.value)}
    <option value={option.value} class="bg-bgcolor">{language.tokenizerOptions[option.labelKey]}</option>
  {/each}
</SelectInput>

<span class="text-textcolor text-lg">Input</span>

<TextAreaInput {onInput} bind:value={input} optimaizedInput={false} ariaLabel={language.input} />

<span class="text-textcolor text-lg">Result</span>

<TextAreaInput value={output} ariaLabel={language.playground.result} />

<span class="text-textcolor2 text-lg">{outputLength} {language.tokens}</span>
<span class="text-textcolor2 text-lg">{time} ms</span>
