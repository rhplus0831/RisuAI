<script lang="ts">
  import type {
    ModelProfileOrderEntry,
    ModelProfileRecord,
    ModelProfileRecordFallbackRef,
  } from 'src/ts/model/modelProfileRecords'
  import ModelFallbackEditor from './ModelFallbackEditor.svelte'

  interface Props {
    initialValue?: ModelProfileRecordFallbackRef[]
    profileId?: string
    profiles?: ModelProfileRecord[]
    profileOrder?: ModelProfileOrderEntry[]
  }

  let {
    initialValue = [{ mode: 'model', modelId: 'initial-model' }],
    profileId = '',
    profiles = [],
    profileOrder = [],
  }: Props = $props()

  // svelte-ignore state_referenced_locally
  let value = $state<ModelProfileRecordFallbackRef[]>(initialValue.map((fallback) => ({ ...fallback })))

  export function currentValue(): ModelProfileRecordFallbackRef[] {
    return value
  }
</script>

<ModelFallbackEditor {profileId} {profiles} {profileOrder} bind:value />
