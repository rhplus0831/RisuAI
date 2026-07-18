<script lang="ts">
  import type { SettingItem, SettingContext } from 'src/ts/setting/types'
  import { UNINITIALIZED, getLabel, getSettingValue, setSettingValue } from 'src/ts/setting/utils'
  import { untrack } from 'svelte'
  import SelectInput from 'src/lib/UI/GUI/SelectInput.svelte'
  import OptionInput from 'src/lib/UI/GUI/OptionInput.svelte'
  import Help from 'src/lib/Others/Help.svelte'
  import { language } from 'src/lang'

  interface Props {
    item: SettingItem
    ctx: SettingContext
  }

  let { item, ctx }: Props = $props()

  let localValue: any = $state(untrack(() => getSettingValue(item, ctx)))
  let label = $derived(getLabel(item))

  // Filter out conditionally hidden options.
  let processedOptions = $derived(
    (item.options?.selectOptions ?? []).filter((opt) => !opt.condition || opt.condition(ctx)),
  )

  function resolveConfiguredFallback(value: unknown, availableOptions: typeof processedOptions): unknown {
    if (availableOptions.some((option) => option.value === value)) return value

    const fallbackValue = item.options?.selectFallbackValue
    if (fallbackValue === undefined) return value
    return availableOptions.find((option) => option.value === fallbackValue)?.value ?? value
  }

  function resolveInitialValue(value: unknown, availableOptions: typeof processedOptions): unknown {
    const configuredOptions = item.options?.selectOptions ?? []

    // A value that is part of the control's full option set may only be hidden
    // by the current context. Keep that durable value until the option set
    // changes after mount or the user explicitly chooses another option.
    if (configuredOptions.some((option) => option.value === value)) return value

    return resolveConfiguredFallback(value, availableOptions)
  }

  // Sync: DB → local (one-way read)
  $effect(() => {
    localValue = resolveInitialValue(getSettingValue(item, ctx), processedOptions)
  })

  // Write-back: local → DB (guarded — only fires on actual user changes)
  $effect(() => {
    const val = localValue
    if (val === UNINITIALIZED) return
    untrack(() => {
      if (val !== getSettingValue(item, ctx)) {
        setSettingValue(item, val, ctx)
      }
    })
  })

  let hasObservedInitialOptions = false

  // Reset value if current selection becomes hidden
  $effect(() => {
    const availableOptions = processedOptions
    if (!hasObservedInitialOptions) {
      // Persisted values can come from a newer client or a temporarily hidden
      // option. Do not coerce them on mount: the final option may be an action.
      hasObservedInitialOptions = true
      return
    }

    const currentValue = untrack(() => localValue)
    if (
      availableOptions.length > 0 &&
      currentValue !== undefined &&
      !availableOptions.some((o) => o.value === currentValue)
    ) {
      const configuredFallback = resolveConfiguredFallback(currentValue, availableOptions)
      if (configuredFallback !== currentValue) {
        localValue = configuredFallback
        return
      }
      localValue = availableOptions[availableOptions.length - 1].value
    }
  })
</script>

<span class="text-textcolor {item.classes ?? 'mt-4'}">
  {label}
  {#if item.helpKey}<Help key={item.helpKey as any} />{/if}
</span>
<SelectInput bind:value={localValue} ariaLabel={label}>
  {#each processedOptions as opt}
    <OptionInput value={opt.value}>
      {opt.labelKey ? (language as any)[opt.labelKey] : opt.label}
    </OptionInput>
  {/each}
</SelectInput>
