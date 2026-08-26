<script lang="ts">
  import type { customscript } from 'src/ts/storage/database.svelte'
  import type { RegexDisplayActivationGate } from 'src/ts/process/regexDisplayActivation'
  import RegexList from './RegexList.svelte'

  interface Props {
    initialValue: customscript[]
    initialOwnerKey?: string
    beforeDisplayActivation?: RegexDisplayActivationGate
  }

  let { initialValue, initialOwnerKey = 'preset-a', beforeDisplayActivation }: Props = $props()
  // svelte-ignore state_referenced_locally
  let value = $state(initialValue)
  // svelte-ignore state_referenced_locally
  let ownerKey = $state(initialOwnerKey)

  export function replaceOwner(nextOwnerKey: string, nextValue: customscript[]): void {
    ownerKey = nextOwnerKey
    value = nextValue
  }

  export function getValue(): customscript[] {
    return value
  }

  export function patchScript(index: number, patch: Partial<customscript>): void {
    if (!value[index]) return
    Object.assign(value[index], patch)
  }
</script>

<RegexList bind:value {ownerKey} {beforeDisplayActivation} buttons />
