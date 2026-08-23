<script lang="ts">
  import type { ScriptModelOverrides } from 'src/ts/model/scriptModelOverrides'
  import ScriptModelOverrideSelectors from './ScriptModelOverrideSelectors.svelte'

  interface Props {
    value?: ScriptModelOverrides
  }

  let { value = $bindable({}) }: Props = $props()

  export function currentValue(): ScriptModelOverrides {
    return value
  }
</script>

<ScriptModelOverrideSelectors bind:value />
