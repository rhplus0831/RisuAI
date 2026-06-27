<script lang="ts">
  import type { SettingContext, SettingItem } from 'src/ts/setting/types'

  interface Props {
    item: SettingItem
    ctx: SettingContext
  }

  let { item, ctx }: Props = $props()

  function label(): string {
    return item.fallbackLabel ?? item.labelKey ?? item.id
  }

  function readValue(): unknown {
    if (item.getValue) return item.getValue(ctx.db, ctx)
    if (item.bindKey) return (ctx.db as Record<string, unknown>)[item.bindKey as string]
    return undefined
  }

  function writeValue(value: unknown): void {
    if (item.setValue) {
      item.setValue(ctx.db, value, ctx)
    } else if (item.bindKey) {
      ;(ctx.db as Record<string, unknown>)[item.bindKey as string] = value
    }
    item.onChange?.(value, ctx)
  }

  let value = $state(readValue())
  let options = $derived(
    (item.options?.selectOptions ?? []).filter((option) => !option.condition || option.condition(ctx)),
  )

  $effect(() => {
    value = readValue()
  })

  function commitValue(nextValue: unknown): void {
    value = nextValue
    writeValue(nextValue)
  }

  function handleCheck(event: Event): void {
    commitValue((event.currentTarget as HTMLInputElement).checked)
  }

  function handleText(event: Event): void {
    commitValue((event.currentTarget as HTMLInputElement).value)
  }

  function handleSelect(event: Event): void {
    commitValue((event.currentTarget as HTMLSelectElement).value)
  }
</script>

{#if item.type === 'header'}
  <h2 data-harness-setting={item.id}>{label()}</h2>
{:else if item.type === 'check'}
  <label data-harness-setting={item.id}>
    <input type="checkbox" aria-label={label()} checked={Boolean(value)} onchange={handleCheck} />
    {label()}
  </label>
{:else if item.type === 'text'}
  <label data-harness-setting={item.id}>
    {label()}
    <input
      aria-label={label()}
      placeholder={item.options?.placeholder}
      value={value == null ? '' : String(value)}
      oninput={handleText} />
  </label>
{:else if item.type === 'select'}
  <label data-harness-setting={item.id}>
    {label()}
    <select aria-label={label()} value={value == null ? '' : String(value)} onchange={handleSelect}>
      {#each options as option}
        <option value={option.value}>{option.labelKey ?? option.label}</option>
      {/each}
    </select>
  </label>
{/if}
