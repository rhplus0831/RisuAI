<script lang="ts">
  interface Props {
    isDisabled?: boolean
    isPressed?: boolean
    onClick: () => void
    ariaLabel?: string
    children?: import('svelte').Snippet
  }

  let { isDisabled = false, isPressed, onClick, ariaLabel, children }: Props = $props()
</script>

<button
  disabled={isDisabled}
  onclick={onClick}
  aria-label={ariaLabel}
  aria-pressed={isPressed}
  class="flex h-[56px] w-[56px] cursor-pointer select-none items-center justify-center
   transition-colors rounded-full
   border border-textcolor2 text-gray-300
   hover:border-gray-300
   {isPressed ? 'border-amber-300 text-amber-300' : ''}
   {isDisabled ? 'cursor-not-allowed!' : ''}">
  {@render children?.()}
</button>
