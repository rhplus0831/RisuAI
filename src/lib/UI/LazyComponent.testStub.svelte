<script lang="ts">
  let { label = 'Loaded' }: { label?: string } = $props()
</script>

<div data-testid="lazy-component-loaded" class="lazy-component-loaded">{label}</div>

<style>
  .lazy-component-loaded {
    display: block;
  }
</style>
