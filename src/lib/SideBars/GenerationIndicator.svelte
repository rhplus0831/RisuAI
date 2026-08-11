<script lang="ts">
  import { LoaderCircleIcon, TriangleAlertIcon } from '@lucide/svelte'

  interface Props {
    label: string
    onActivate: () => void
    state?: 'generating' | 'warning'
  }

  let { label, onActivate, state = 'generating' }: Props = $props()

  function forwardActivation(node: HTMLSpanElement, activate: () => void) {
    let currentActivate = activate
    const handleClick = (event: MouseEvent) => {
      event.stopPropagation()
      currentActivate()
    }
    node.addEventListener('click', handleClick)
    return {
      update(nextActivate: () => void) {
        currentActivate = nextActivate
      },
      destroy() {
        node.removeEventListener('click', handleClick)
      },
    }
  }
</script>

<span
  class="absolute right-0 top-0 z-10 flex h-5 w-5 items-center justify-center rounded-full border-2 border-bgcolor text-white shadow"
  class:bg-green-500={state === 'generating'}
  class:bg-yellow-500={state === 'warning'}
  class:text-black={state === 'warning'}
  role="status"
  aria-label={label}
  title={label}
  use:forwardActivation={onActivate}
  data-risu-generation-indicator={state}>
  {#if state === 'warning'}
    <TriangleAlertIcon size={12} aria-hidden="true" />
  {:else}
    <LoaderCircleIcon size={12} class="risu-ongoing-pulse animate-spin" aria-hidden="true" />
  {/if}
</span>
