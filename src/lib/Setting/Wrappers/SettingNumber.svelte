<script lang="ts">
  import type { SettingItem, SettingContext } from 'src/ts/setting/types'
  import { UNINITIALIZED, getLabel, getSettingValue, setSettingValue } from 'src/ts/setting/utils'
  import { untrack } from 'svelte'
  import NumberInput from 'src/lib/UI/GUI/NumberInput.svelte'
  import Help from 'src/lib/Others/Help.svelte'

  interface Props {
    item: SettingItem
    ctx: SettingContext
  }

  let { item, ctx }: Props = $props()

  let localValue: any = $state(untrack(() => getSettingValue(item, ctx)))
  let label = $derived(getLabel(item))

  // Sync: DB → local (one-way read)
  $effect(() => {
    localValue = getSettingValue(item, ctx)
  })

  // Write-back: local → DB (guarded)
  $effect(() => {
    const val = localValue
    if (val === UNINITIALIZED) return
    untrack(() => {
      const currentValue = getSettingValue(item, ctx)
      if (val === undefined || val === null) {
        if (currentValue !== undefined) {
          localValue = currentValue
        }
        return
      }
      if (val !== currentValue) {
        setSettingValue(item, val, ctx)
      }
    })
  })
</script>

<span class="text-textcolor {item.classes ?? ''}">
  {label}
  {#if item.helpKey}<Help key={item.helpKey as any} />{/if}
</span>
<NumberInput
  marginBottom={true}
  size="sm"
  min={item.options?.min}
  max={item.options?.max}
  step={item.options?.step}
  ariaLabel={label}
  bind:value={localValue} />
