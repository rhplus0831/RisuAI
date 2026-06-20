<script lang="ts">
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
      touched: true,
    }
  }
</script>

<label class="flex flex-col gap-1">
  <span class="text-sm text-textcolor2">{label}</span>
  <input
    class="w-full rounded-md border border-darkborderc bg-transparent px-2 py-1 text-sm text-textcolor shadow-xs transition-colors duration-200 focus:border-borderc focus:outline-hidden focus:ring-2 focus:ring-borderc"
    type="password"
    autocomplete="new-password"
    value={value.value}
    placeholder={value.hasExistingSecret && !value.touched ? placeholder : ''}
    oninput={(event) => {
      updateValue(event.currentTarget.value)
    }} />
</label>
