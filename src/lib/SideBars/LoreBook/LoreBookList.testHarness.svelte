<script lang="ts">
  import type { loreBook } from 'src/ts/storage/database.svelte'
  import LoreBookList from './LoreBookList.svelte'

  interface Props {
    initialEntries?: loreBook[]
  }

  let { initialEntries = [] }: Props = $props()
  let entries = $state<loreBook[]>([])
  let initialized = false

  function cloneEntries(value: loreBook[]): loreBook[] {
    return JSON.parse(JSON.stringify(value ?? []))
  }

  function handleCollectionChange(nextEntries: loreBook[]): void {
    entries = cloneEntries(nextEntries)
  }

  $effect(() => {
    if (initialized) return
    initialized = true
    entries = cloneEntries(initialEntries)
  })

  export function setEntries(nextEntries: loreBook[]): void {
    entries = cloneEntries(nextEntries)
  }

  export function getEntries(): loreBook[] {
    return cloneEntries(entries)
  }
</script>

<LoreBookList bind:externalLoreBooks={entries} onCollectionChange={handleCollectionChange} />
