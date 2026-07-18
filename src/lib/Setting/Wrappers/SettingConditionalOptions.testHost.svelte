<script lang="ts">
  import type { SettingContext, SettingItem } from 'src/ts/setting/types'
  import SettingSegmented from './SettingSegmented.svelte'
  import SettingSelect from './SettingSelect.svelte'

  interface Props {
    initialContext: SettingContext
    item: SettingItem
    kind: 'segmented' | 'select'
  }

  let { initialContext, item, kind }: Props = $props()
  const readInitialContext = () => initialContext
  let ctx = $state(readInitialContext())

  export function replaceContext(nextContext: SettingContext): void {
    ctx = nextContext
  }
</script>

{#if kind === 'select'}
  <SettingSelect {item} {ctx} />
{:else}
  <SettingSegmented {item} {ctx} />
{/if}
