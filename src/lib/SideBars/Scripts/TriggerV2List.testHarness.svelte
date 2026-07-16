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

  export function replaceValue(nextValue: triggerscript[]): void {
    value = nextValue
  }

  export function replaceTrigger(triggerIndex: number, nextTrigger: triggerscript): void {
    if (triggerIndex < 0 || triggerIndex >= value.length) return
    value[triggerIndex] = nextTrigger
  }

  export function replaceEffects(triggerIndex: number, nextEffects: triggerscript['effect']): void {
    const trigger = value[triggerIndex]
    if (!trigger) return
    trigger.effect = nextEffects
  }

  export function replaceEffect(
    triggerIndex: number,
    effectIndex: number,
    nextEffect: triggerscript['effect'][number],
  ): void {
    const effects = value[triggerIndex]?.effect
    if (!effects || effectIndex < 0 || effectIndex >= effects.length) return
    effects[effectIndex] = nextEffect
  }

  export function getValue(): triggerscript[] {
    return value
  }
</script>

<TriggerV2List bind:value {ownerKey} />
