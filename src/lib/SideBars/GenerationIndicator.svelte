<script lang="ts">
  import { LoaderCircleIcon } from '@lucide/svelte'

  interface Props {
    label: string
  }

  let { label }: Props = $props()
</script>

<span
  class="absolute right-0 top-0 z-10 flex h-5 w-5 items-center justify-center rounded-full border-2 border-bgcolor bg-green-500 text-white shadow"
  role="status"
  aria-label={label}
  title={label}
  data-risu-generation-indicator>
  <LoaderCircleIcon size={12} class="risu-ongoing-pulse animate-spin" aria-hidden="true" />
</span>
