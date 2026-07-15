<script lang="ts">
  import { untrack } from 'svelte'

  import ColorPicker from 'svelte-awesome-color-picker'
  import { language } from 'src/lang'
  interface Props {
    value?: string
    nullable?: boolean
    ariaLabel: string
    oninput?: () => void
    onchange?: (value: string) => void
  }

  let { value = $bindable('#000000'), nullable = false, ariaLabel, oninput, onchange }: Props = $props()
  let initialized = false

  $effect(() => {
    //this is for updating
    const currentValue = value

    untrack(() => {
      oninput?.()
      if (!initialized) {
        initialized = true
        return
      }
      onchange?.(currentValue)
    })
  })
</script>

<div class="cl rounded-full bg-white">
  <ColorPicker
    label={ariaLabel}
    texts={{ label: { withoutColor: `${language.disable}: ${ariaLabel}` } }}
    bind:hex={value}
    {nullable} />
</div>

<style>
  .cl {
    --cp-bg-color: var(--risu-theme-bgcolor);
    --cp-border-color: var(--risu-theme-darkborderc);
    --cp-text-color: var(--risu-theme-textcolor);
    --cp-input-color: #555;
    --cp-button-hover-color: #777;
  }

  .cl :global(.color-picker > label) {
    gap: 0;
    font-size: 0;
  }
</style>
