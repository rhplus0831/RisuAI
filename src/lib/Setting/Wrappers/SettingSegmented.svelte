<script lang="ts">
  import type { SettingItem, SettingContext } from 'src/ts/setting/types'
  import { UNINITIALIZED, getLabel, getSettingValue, setSettingValue } from 'src/ts/setting/utils'
  import { untrack } from 'svelte'
  import SegmentedControl from 'src/lib/UI/GUI/SegmentedControl.svelte'
  import Help from 'src/lib/Others/Help.svelte'
  import { language } from 'src/lang'

  interface Props {
    item: SettingItem
    ctx: SettingContext
  }

  let { item, ctx }: Props = $props()

  let localValue: any = $state(untrack(() => getSettingValue(item, ctx)))

  $effect(() => {
    localValue = getSettingValue(item, ctx)
  })

  $effect(() => {
    const val = localValue
    if (val === UNINITIALIZED) return
    untrack(() => {
      if (val !== getSettingValue(item, ctx)) {
        setSettingValue(item, val, ctx)
      }
    })
  })

  // Transform options: filter by condition + resolve labelKey translations
  let processedOptions = $derived(
    (item.options?.segmentOptions ?? [])
      .filter((opt) => !opt.condition || opt.condition(ctx))
      .map((opt) => ({
        value: opt.value,
        label: opt.labelKey ? ((language as any)[opt.labelKey] ?? opt.label ?? '') : (opt.label ?? ''),
      })),
  )

  let hasObservedInitialOptions = false

  // Reset value if current selection becomes hidden due to condition changes
  $effect(() => {
    const availableOptions = processedOptions
    if (!hasObservedInitialOptions) {
      // Persisted values can come from a newer client or an option that is
      // temporarily hidden. Merely opening settings must not rewrite them.
      hasObservedInitialOptions = true
      return
    }

    const currentVal = localValue
    if (
      availableOptions.length > 0 &&
      currentVal !== undefined &&
      !availableOptions.some((o) => o.value === currentVal)
    ) {
      localValue = availableOptions[availableOptions.length - 1].value
    }
  })
</script>

<span class="text-textcolor {item.classes ?? ''}">
  {getLabel(item)}
  {#if item.helpKey}<Help key={item.helpKey as any} />{/if}
</span>
<SegmentedControl bind:value={localValue} options={processedOptions} />
