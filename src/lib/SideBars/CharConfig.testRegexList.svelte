<script lang="ts">
  import type { customscript } from 'src/ts/storage/database.svelte'

  interface Props {
    value?: customscript[]
  }

  let { value = $bindable([]) }: Props = $props()
</script>

<div data-testid="regex-count">{value.length}</div>
