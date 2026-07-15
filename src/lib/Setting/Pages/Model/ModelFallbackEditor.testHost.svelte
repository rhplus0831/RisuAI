<script lang="ts">
  import type { ModelProfileRecordFallbackRef } from 'src/ts/model/modelProfileRecords'
  import ModelFallbackEditor from './ModelFallbackEditor.svelte'

  let value = $state<ModelProfileRecordFallbackRef[]>([{ mode: 'model', modelId: 'initial-model' }])

  export function currentValue(): ModelProfileRecordFallbackRef[] {
    return value
  }
</script>

<ModelFallbackEditor profiles={[]} bind:value />
