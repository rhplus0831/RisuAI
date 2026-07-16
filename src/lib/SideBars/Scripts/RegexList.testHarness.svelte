<script lang="ts">
  import type { customscript } from 'src/ts/storage/database.svelte'
  import RegexList from './RegexList.svelte'

  interface Props {
    initialValue: customscript[]
    initialOwnerKey?: string
  }

  let { initialValue, initialOwnerKey = 'preset-a' }: Props = $props()
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
</script>

<RegexList bind:value {ownerKey} buttons />
