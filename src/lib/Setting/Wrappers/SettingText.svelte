<script lang="ts">
  import type { SettingItem, SettingContext } from 'src/ts/setting/types'
  import { getLabel, getSettingWriteOwnerKey } from 'src/ts/setting/utils'
  import { createSettingInputDraft } from 'src/ts/setting/inputDraft.svelte'
  import TextInput from 'src/lib/UI/GUI/TextInput.svelte'
  import SecretInput from 'src/lib/UI/GUI/SecretInput.svelte'
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
  let ownerKey = $derived(getSettingWriteOwnerKey(item, ctx))
  let label = $derived(getLabel(item))
</script>

<span class="text-textcolor {item.classes ?? ''}">
  {label}
  {#if item.helpKey}<Help key={item.helpKey as any} />{/if}
</span>
{#if item.options?.hideText}
  <SecretInput
    marginBottom={true}
    size="sm"
    bind:value={draft.value}
    {ownerKey}
    ariaLabel={label}
    placeholder={item.options?.placeholder} />
{:else}
  <TextInput
    marginBottom={true}
    size="sm"
    bind:value={draft.value}
    ariaLabel={label}
    placeholder={item.options?.placeholder} />
{/if}
