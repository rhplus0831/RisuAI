<script lang="ts">
  import CheckInput from './CheckInput.svelte'
  import NumberInput from './NumberInput.svelte'
  import TextInput from './TextInput.svelte'
  import { language } from 'src/lang'
  interface Props {
    label: string
    value: string | number | boolean | null | undefined
    numberMode?: boolean
    boolMode?: boolean
    marginBottom?: boolean
  }

  let { label, value = $bindable(), numberMode = false, boolMode = false, marginBottom = false }: Props = $props()
</script>

<div class="flex items-center justify-center" class:mb-4={marginBottom} role="group" aria-label={label}>
  <div class="flex justify-center items-center border-darkborderc rounded-l-md rounded-t-md rounded-b-md border h-full">
    <CheckInput
      hiddenName
      name={`${language.enable}: ${label}`}
      check={!(value === null || value === undefined)}
      onChange={() => {
        if (value === null || value === undefined) {
          if (numberMode) {
            value = 0
          } else if (boolMode) {
            value = false
          } else {
            value = ''
          }
        } else {
          value = null
        }
      }} />
  </div>

  {#if value === null || value === undefined}
    <TextInput value={'Using default'} className="flex-1" ariaLabel={`${language.value}: ${label}`} disabled />
  {:else if typeof value === 'string'}
    <TextInput bind:value className="flex-1" ariaLabel={`${language.value}: ${label}`} />
  {:else if typeof value === 'number'}
    <NumberInput bind:value className="flex-1" ariaLabel={`${language.value}: ${label}`} />
  {:else if typeof value === 'boolean'}
    <button
      type="button"
      aria-label={`${language.value}: ${label}: True`}
      class="px-2 py-2 border border-darkborderc flex-1"
      class:text-textcolor2={!value}
      aria-pressed={value}
      onclick={() => (value = true)}>True</button>
    <button
      type="button"
      aria-label={`${language.value}: ${label}: False`}
      class="px-2 py-2 border border-darkborderc flex-1"
      class:text-textcolor2={value}
      aria-pressed={!value}
      onclick={() => (value = false)}>False</button>
  {:else}
    <TextInput value={'Using default'} className="flex-1" ariaLabel={`${language.value}: ${label}`} disabled />
  {/if}
</div>
