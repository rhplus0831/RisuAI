<script lang="ts">
  import type { SettingItem, SettingContext } from 'src/ts/setting/types'
  import { getLabel } from 'src/ts/setting/utils'
  import { createSettingInputDraft } from 'src/ts/setting/inputDraft.svelte'
  import SliderInput from 'src/lib/UI/GUI/SliderInput.svelte'
  import Help from 'src/lib/Others/Help.svelte'

  interface Props {
    item: SettingItem
    ctx: SettingContext
  }

  let { item, ctx }: Props = $props()

  const draft = createSettingInputDraft<any>(
    () => item,
    () => ctx,
  )
  let label = $derived(getLabel(item))

  let customText = $derived(
    typeof item.options?.customText === 'function' ? item.options.customText(draft.value) : item.options?.customText,
  )
</script>

<span class="text-textcolor {item.classes ?? ''}">
  {label}
  {#if item.helpKey}<Help key={item.helpKey as any} />{/if}
</span>
<SliderInput
  marginBottom={true}
  min={item.options?.min}
  max={item.options?.max}
  step={item.options?.step}
  fixed={item.options?.fixed}
  multiple={item.options?.multiple}
  disableable={item.options?.disableable}
  ariaLabel={label}
  {customText}
  bind:value={draft.value} />
