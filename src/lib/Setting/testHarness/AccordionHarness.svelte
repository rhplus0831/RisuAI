<script lang="ts">
  interface Props {
    name?: string
    children?: import('svelte').Snippet
  }

  let { name = '', children }: Props = $props()
  let open = $state(false)
</script>

<div data-accordion-harness>
  <button
    onclick={() => {
      open = !open
    }}>{name}</button>
  {#if open}
    {@render children?.()}
  {/if}
</div>
