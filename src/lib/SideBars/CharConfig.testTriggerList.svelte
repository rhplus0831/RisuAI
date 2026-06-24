<script lang="ts">
  import type { triggerscript } from 'src/ts/storage/database.svelte'

  interface Props {
    value?: triggerscript[]
    lowLevelAble?: boolean
  }

  let { value = $bindable([]), lowLevelAble = false }: Props = $props()
</script>

<div data-testid="trigger-count" data-low-level={lowLevelAble}>{value.length}</div>
