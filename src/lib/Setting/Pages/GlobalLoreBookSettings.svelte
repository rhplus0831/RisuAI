<script lang="ts">
  import { language } from 'src/lang'
  import Help from 'src/lib/Others/Help.svelte'
  import LoreBookSetting from 'src/lib/SideBars/LoreBook/LoreBookSetting.svelte'

  import { collectionsResourceState } from 'src/ts/server/resourceState.svelte'
  import { lorebookPageIndexFromSnapshot, lorebookPageOwnerState } from 'src/ts/server/lorebookPageOwner.svelte'
  interface Props {
    openLoreList?: boolean
  }

  let { openLoreList = $bindable(false) }: Props = $props()
  let lorebooks = $derived(
    collectionsResourceState.statuses.loreBook === 'ready'
      ? readLorebooks(collectionsResourceState.values.loreBook)
      : [],
  )
  let lorebookPage = $derived(
    $lorebookPageOwnerState.status === 'ready' ? (lorebookPageIndexFromSnapshot($lorebookPageOwnerState) ?? 0) : -1,
  )
  let selectedLorebook = $derived(lorebooks[lorebookPage])

  function readLorebooks(value: unknown): Array<{ id: string; name?: string }> {
    if (!Array.isArray(value)) return []
    const ids = new Set<string>()
    for (const lorebook of value) {
      if (!lorebook || typeof lorebook !== 'object' || Array.isArray(lorebook)) return []
      const id = (lorebook as { id?: unknown }).id
      if (typeof id !== 'string' || id.trim() !== id || id.length === 0 || ids.has(id)) return []
      ids.add(id)
    }
    return value as Array<{ id: string; name?: string }>
  }
</script>

<h2 class="mb-2 text-2xl font-bold mt-2">{language.globalLoreBook} <Help key="lorebook" /></h2>
<button
  onclick={() => {
    openLoreList = true
  }}
  class="mt-4 drop-shadow-lg p-3 flex justify-center items-center ml-2 mr-2 rounded-lg bg-selected mb-4"
  >{selectedLorebook?.name ?? language.loreBook}</button>

<LoreBookSetting globalMode />
