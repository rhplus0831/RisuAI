<script lang="ts">
  import type { SettingItem, SettingContext } from 'src/ts/setting/types'
  import { getLabel } from 'src/ts/setting/utils'
  import { createSettingInputDraft } from 'src/ts/setting/inputDraft.svelte'
  import TextAreaInput from 'src/lib/UI/GUI/TextAreaInput.svelte'
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
</script>

<span class="text-textcolor {item.classes ?? ''}">
  {label}
  {#if item.helpKey}<Help key={item.helpKey as any} />{/if}
</span>
<TextAreaInput bind:value={draft.value} ariaLabel={label} placeholder={item.options?.placeholder} />
