<script lang="ts">
  import TriggerV2List from './TriggerV2List.svelte'
  import type { triggerscript } from 'src/ts/process/triggers'

  interface Props {
    initialValue: triggerscript[]
    initialOwnerKey?: string
  }

  let { initialValue, initialOwnerKey = 'owner-a' }: Props = $props()
  // svelte-ignore state_referenced_locally
  let value = $state(initialValue)
  // svelte-ignore state_referenced_locally
  let ownerKey = $state(initialOwnerKey)

  export function setEffectField(triggerIndex: number, effectIndex: number, field: string, nextValue: string): void {
    const effect = value[triggerIndex]?.effect[effectIndex]
    if (!effect) return
    const effectRecord = effect as unknown as Record<string, unknown>
    effectRecord[field] = nextValue
  }

  export function replaceOwner(nextOwnerKey: string, nextValue: triggerscript[]): void {
    ownerKey = nextOwnerKey
    value = nextValue
  }

  export function getValue(): triggerscript[] {
    return value
  }
</script>

<TriggerV2List bind:value {ownerKey} />
