<script lang="ts">
  let { value = $bindable(), ownerKey = '', lowLevelAble = false } = $props()
</script>

<span data-testid="trigger-child" data-owner={ownerKey} data-low-level={lowLevelAble}>{JSON.stringify(value)}</span>
