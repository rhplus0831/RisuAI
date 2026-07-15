<script lang="ts">
  import { Template } from '@huggingface/jinja'
  import { language } from 'src/lang'
  import TextAreaInput from '../UI/GUI/TextAreaInput.svelte'
  let input = $state('')
  let json = $state(
    JSON.stringify(
      {
        messages: [
          {
            role: 'user',
            content: "Hello, I'm a user!",
          },
          {
            role: 'assistant',
            content: "Hello, I'm a bot!",
          },
        ],
        eos_token: '',
        bos_token: '',
      },
      null,
      4,
    ),
  )
  let output = $state('')
  const onInput = () => {
    try {
      const template = new Template(input)
      const values = JSON.parse(json)
      output = template.render(values)
    } catch (e) {
      console.error(e.stack)
      output = `Error: ${e}`
    }
  }
</script>

<h2 class="text-4xl text-textcolor my-6 font-black relative">Jinja</h2>

<span class="text-textcolor text-lg">Jinja</span>

<TextAreaInput {onInput} bind:value={input} ariaLabel={language.playground.jinjaTemplate} />

<span class="text-textcolor text-lg">Data (JSON)</span>

<TextAreaInput {onInput} bind:value={json} ariaLabel={language.playground.jinjaData} />

<span class="text-textcolor text-lg">Result</span>

<TextAreaInput value={output} ariaLabel={language.playground.result} />
