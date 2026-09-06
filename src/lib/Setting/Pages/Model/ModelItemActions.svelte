<script lang="ts">
  import { tick, type Snippet } from 'svelte'
  import { EllipsisIcon } from '@lucide/svelte'

  interface Props {
    label: string
    disabled?: boolean
    children: Snippet<[() => void]>
  }

  let { label, disabled = false, children }: Props = $props()
  let open = $state(false)
  let container = $state<HTMLDivElement>()
  let trigger = $state<HTMLButtonElement>()
  const id = $props.id()

  function close(restoreFocus = true): void {
    open = false
    if (restoreFocus) trigger?.focus()
  }

  async function toggle(): Promise<void> {
    open = !open
    if (open) {
      await tick()
      container?.querySelector<HTMLButtonElement>('[data-model-item-actions] button:not(:disabled)')?.focus()
    }
  }

  function handleOutsidePointer(event: PointerEvent): void {
    if (open && event.target instanceof Node && !container?.contains(event.target)) close(false)
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (!open || event.key !== 'Escape' || !(event.target instanceof Node) || !container?.contains(event.target)) return
    event.preventDefault()
    event.stopPropagation()
    close()
  }

  $effect(() => {
    if (disabled) close(false)
  })
</script>

<svelte:document onpointerdown={handleOutsidePointer} />

<!-- Keyboard events are delegated from the controls inside this disclosure. -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="relative shrink-0"
  bind:this={container}
  role="group"
  aria-label={label}
  onkeydown={handleKeydown}
  onfocusout={(event) => {
    if (open && event.relatedTarget instanceof Node && !container?.contains(event.relatedTarget)) close(false)
  }}>
  <button
    type="button"
    bind:this={trigger}
    class="flex h-11 w-11 items-center justify-center rounded-md text-textcolor2 hover:bg-darkbg hover:text-textcolor focus:ring-2 focus:ring-borderc disabled:opacity-50"
    aria-label={label}
    aria-expanded={open}
    aria-controls={`${id}-actions`}
    {disabled}
    onclick={toggle}>
    <EllipsisIcon size={20} />
  </button>
  {#if open}
    <div
      id={`${id}-actions`}
      data-model-item-actions
      class="absolute right-0 top-full z-20 flex min-w-40 flex-col gap-1 rounded-md border border-darkborderc bg-bgcolor p-1 shadow-lg"
      role="group"
      aria-label={label}>
      {@render children(close)}
    </div>
  {/if}
</div>
