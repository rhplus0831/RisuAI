<script lang="ts">
  import { MailIcon } from '@lucide/svelte'

  interface Props {
    label: string
    onActivate: () => void
  }

  let { label, onActivate }: Props = $props()

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
  class="absolute right-0 top-0 z-10 flex h-5 w-5 items-center justify-center rounded-full border-2 border-bgcolor bg-blue-500 text-white shadow"
  role="status"
  aria-label={label}
  title={label}
  use:forwardActivation={onActivate}
  data-risu-unread-indicator>
  <MailIcon size={12} aria-hidden="true" />
</span>
