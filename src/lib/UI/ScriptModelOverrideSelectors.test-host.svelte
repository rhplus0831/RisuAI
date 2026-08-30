<script lang="ts">
  import type { ScriptModelOverrides } from '@risuai/shared-core/script-model-overrides'
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
