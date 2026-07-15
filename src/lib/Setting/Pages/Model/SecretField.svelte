<script lang="ts">
  import { language } from 'src/lang'
  import type { ModelProfileSecretDraft } from 'src/ts/model/modelProfileSecrets'

  interface Props {
    label: string
    value: ModelProfileSecretDraft
    placeholder?: string
  }

  let { label, value = $bindable(), placeholder = '' }: Props = $props()

  function updateValue(nextValue: string): void {
    value = {
      ...value,
      value: nextValue,
      disposition: nextValue ? 'replace' : 'clear',
    }
  }

  function clearExistingSecret(): void {
    value = {
      ...value,
      value: '',
      disposition: 'clear',
    }
  }
</script>

<div class="flex flex-col gap-1">
  <label class="flex flex-col gap-1">
    <span class="text-sm text-textcolor2">{label}</span>
    <input
      class="w-full rounded-md border border-darkborderc bg-transparent px-2 py-1 text-sm text-textcolor shadow-xs transition-colors duration-200 focus:border-borderc focus:outline-hidden focus:ring-2 focus:ring-borderc"
      type="password"
      autocomplete="new-password"
      value={value.value}
      placeholder={value.hasExistingSecret && value.disposition === 'preserve' ? placeholder : ''}
      oninput={(event) => {
        updateValue(event.currentTarget.value)
      }} />
  </label>
  {#if value.hasExistingSecret && value.disposition === 'preserve'}
    <span class="flex items-center gap-2 text-xs text-textcolor2" data-secret-saved-state>
      <span>{language.secretInput.savedStatus}</span>
      <button
        type="button"
        class="rounded-sm underline underline-offset-2 hover:text-textcolor focus:outline-hidden focus:ring-2 focus:ring-borderc"
        aria-label={language.secretInput.clearSaved}
        onclick={clearExistingSecret}>
        {language.secretInput.clearSaved}
      </button>
    </span>
  {/if}
</div>
