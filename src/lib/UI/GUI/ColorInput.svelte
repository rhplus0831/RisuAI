<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte'

  import ColorPicker from 'svelte-awesome-color-picker'
  import { language } from 'src/lang'
  interface Props {
    value?: string | null
    nullable?: boolean
    ariaLabel: string
    oninput?: () => void
    onchange?: (value: string) => void
  }

  let { value = $bindable('#000000'), nullable = false, ariaLabel, oninput, onchange }: Props = $props()
  let acceptsInput = false
  let pendingChangeTimer: ReturnType<typeof setTimeout> | undefined
  let pendingChangeValue = value ?? ''

  function commitPendingChange() {
    if (pendingChangeTimer === undefined) return
    clearTimeout(pendingChangeTimer)
    pendingChangeTimer = undefined
    onchange?.(pendingChangeValue)
  }

  onDestroy(commitPendingChange)

  onMount(() => {
    void tick().then(() => {
      acceptsInput = true
    })
  })

  function handleInput() {
    if (!acceptsInput) return
    oninput?.()
    pendingChangeValue = value ?? ''
    if (pendingChangeTimer !== undefined) clearTimeout(pendingChangeTimer)
    pendingChangeTimer = setTimeout(commitPendingChange, 250)
  }
</script>

<div class="cl rounded-full bg-white">
  <ColorPicker
    label={ariaLabel}
    texts={{ label: { withoutColor: `${language.disable}: ${ariaLabel}` } }}
    bind:hex={value}
    {nullable}
    onInput={handleInput} />
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
