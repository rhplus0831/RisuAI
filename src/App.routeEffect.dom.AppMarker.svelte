<script lang="ts">
  let { openedData = $bindable(), children, route } = $props()

  void openedData
</script>

<div data-testid="app-marker" data-risu-test-marker="app-marker" data-rendered-route={route?.path}>
  {@render children?.()}
</div>
