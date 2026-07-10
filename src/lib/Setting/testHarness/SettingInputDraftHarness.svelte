<script lang="ts">
  import { createSettingInputDraft } from 'src/ts/setting/inputDraft.svelte'
  import type { SettingContext, SettingItem } from 'src/ts/setting/types'

  interface Props {
    ctx: SettingContext
    item: SettingItem
    kind: 'slider' | 'text'
  }

  let { ctx, item, kind }: Props = $props()
  const draft = createSettingInputDraft<any>(
    () => item,
    () => ctx,
  )
</script>

{#if kind === 'slider'}
  <input data-setting-input-draft type="range" min="0" max="200" bind:value={draft.value} />
{:else}
  <input data-setting-input-draft type="text" bind:value={draft.value} />
{/if}
