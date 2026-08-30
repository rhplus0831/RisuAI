<script lang="ts">
  import { language } from 'src/lang'
  import Help from 'src/lib/Others/Help.svelte'
  import LoreBookSetting from 'src/lib/SideBars/LoreBook/LoreBookSetting.svelte'

  import { getResourceDatabase } from 'src/ts/server/resourceState.svelte'
  import { lorebookPageIndexFromSnapshot, lorebookPageOwnerState } from 'src/ts/server/lorebookPageOwner.svelte'
  interface Props {
    openLoreList?: boolean
  }

  let { openLoreList = $bindable(false) }: Props = $props()
  let database = $derived(getResourceDatabase())
  let lorebookPage = $derived(lorebookPageIndexFromSnapshot($lorebookPageOwnerState) ?? 0)
  let selectedLorebook = $derived(database.loreBook?.[lorebookPage])
</script>

<h2 class="mb-2 text-2xl font-bold mt-2">{language.globalLoreBook} <Help key="lorebook" /></h2>
<button
  onclick={() => {
    openLoreList = true
  }}
  class="mt-4 drop-shadow-lg p-3 flex justify-center items-center ml-2 mr-2 rounded-lg bg-selected mb-4"
  >{selectedLorebook?.name ?? language.loreBook}</button>

<LoreBookSetting globalMode />
