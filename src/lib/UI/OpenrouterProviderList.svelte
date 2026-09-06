<script lang="ts">
  import { ArrowLeft } from '@lucide/svelte'
  import { language } from 'src/lang'
  import { modalBackdropDismiss } from 'src/ts/gui/modalBackdropDismiss'
  import { modalFocusTrap } from 'src/ts/gui/modalFocusTrap'
  import TextInput from './GUI/TextInput.svelte'

  interface Props {
    value?: string
    options?: { name: string; slug: string }[]
    onChange?: (v: string) => void
    onclick?: (
      event: MouseEvent & {
        currentTarget: EventTarget & HTMLDivElement
      },
    ) => any
  }

  let { value = $bindable(''), options = [], onChange = (v) => {}, onclick }: Props = $props()
  let openOptions = $state(false)

  function changeModel(name: string) {
    value = name
    openOptions = false
    onChange(name)
  }

  function closePicker(): void {
    openOptions = false
  }

  function handlePickerKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    closePicker()
  }

  let custom = $state('')
  let providers = $derived(options)
</script>

{#if openOptions}
  <!-- Backdrop click is supplemental to the dialog's Back button and Escape handling. -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    use:modalBackdropDismiss={closePicker}
    data-modal-root
    class="fixed inset-0 bg-black/50 z-50 flex justify-center items-center">
    <div
      use:modalFocusTrap
      class="w-96 max-w-[calc(100vw-1rem)] max-h-[calc(100vh-1rem)] overflow-y-auto overflow-x-hidden bg-bgcolor p-4 rounded-md flex flex-col"
      role="dialog"
      aria-modal="true"
      aria-labelledby="risu-openrouter-provider-picker-title"
      tabindex="-1"
      onkeydown={handlePickerKeydown}
      onclick={(e) => {
        e.stopPropagation()
        onclick?.(e)
      }}>
      <div class="flex items-center gap-3 mb-4">
        <button
          type="button"
          data-modal-initial-focus
          aria-label={language.goback}
          class="flex items-center justify-center p-2 rounded-lg hover:bg-selected transition-colors shrink-0"
          onclick={closePicker}
          title={language.goback}>
          <ArrowLeft size={20} />
        </button>
        <h2 id="risu-openrouter-provider-picker-title" class="font-bold text-xl flex-1">{language.provider}</h2>
      </div>
      <div class="border-t-1 border-y-selected mb-2"></div>

      <TextInput
        ariaLabel={language.provider}
        bind:value={custom}
        onchange={() => {
          changeModel(custom)
        }} />

      {#each providers as provider}
        <button
          type="button"
          class="hover:bg-selected px-6 py-2 text-lg"
          onclick={() => {
            changeModel(provider.slug)
          }}>{provider.name} ({provider.slug})</button>
      {/each}
    </div>
  </div>
{/if}

<button
  type="button"
  aria-label={value ? `${language.provider}: ${value}` : language.provider}
  onclick={() => {
    openOptions = true
  }}
  class="mt-4 drop-shadow-lg p-3 flex justify-center items-center ml-2 mr-2 rounded-lg bg-darkbutton mb-4 border-darkborderc border">
  {value || language.provider}
</button>
