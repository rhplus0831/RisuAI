<script lang="ts">
  import TriggerV2List from './TriggerV2List.svelte'
  import type { triggerscript } from 'src/ts/process/triggers'

  interface Props {
    initialValue: triggerscript[]
  }

  let { initialValue }: Props = $props()
  // svelte-ignore state_referenced_locally
  let value = $state(initialValue)

  export function setEffectField(triggerIndex: number, effectIndex: number, field: string, nextValue: string): void {
    const effect = value[triggerIndex]?.effect[effectIndex]
    if (!effect) return
    const effectRecord = effect as unknown as Record<string, unknown>
    effectRecord[field] = nextValue
  }
</script>

<TriggerV2List bind:value />
