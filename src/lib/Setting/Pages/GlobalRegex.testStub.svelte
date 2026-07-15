<script lang="ts">
  let { value = $bindable(), children }: { value?: unknown[]; children?: import('svelte').Snippet } = $props()
</script>

{@render children?.()}
{#if Array.isArray(value)}
  <div data-testid="global-regex-count">{value.length}</div>
{/if}
