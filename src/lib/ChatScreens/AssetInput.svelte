<script lang="ts">
  import { FileMusicIcon, PlusIcon } from '@lucide/svelte'
  import { setCharacterByIndex, type character } from 'src/ts/storage/database.svelte'
  import { getFileSrc, saveAsset } from 'src/ts/globalApi.svelte'
  import { DBState } from 'src/ts/stores.svelte'
  import { selectMultipleFile } from 'src/ts/util'
  interface Props {
    currentCharacter: character
    onSelect: (additionalAsset: [string, string, string]) => void
  }

  const { currentCharacter, onSelect }: Props = $props()

  let assetFileExtensions: Record<string, string | undefined> = $state({})
  let assetFilePath: Record<string, string | undefined> = $state({})
  let assetPreviewRun = 0

  const assetSourceKey = $derived(
    currentCharacter.type === 'character'
      ? (currentCharacter.additionalAssets ?? []).map((asset) => `${asset[1]}:${asset[2] ?? ''}`).join('\n')
      : '',
  )

  function cloneCharacter(char: character): character {
    return JSON.parse(JSON.stringify(char)) as character
  }

  $effect(() => {
    assetSourceKey
    const run = ++assetPreviewRun
    const nextExtensions: Record<string, string | undefined> = {}
    assetFilePath = {}
    if (currentCharacter.type === 'character') {
      if (currentCharacter.additionalAssets) {
        for (const additionalAsset of currentCharacter.additionalAssets) {
          const assetPath = additionalAsset[1]
          if (additionalAsset.length > 2 && additionalAsset[2]) {
            nextExtensions[assetPath] = additionalAsset[2]
          } else {
            nextExtensions[assetPath] = assetPath.split('.').pop()
          }
          getFileSrc(assetPath).then((filePath) => {
            if (run !== assetPreviewRun) return
            assetFilePath[assetPath] = filePath
          })
        }
      }
    }
    assetFileExtensions = nextExtensions
  })
</script>

{#if currentCharacter.type === 'character'}
  <button
    class="hover:text-green-500 bg-textcolor2 flex justify-center items-center w-16 h-16 m-1 rounded-md"
    onclick={async () => {
      if (currentCharacter.type === 'character') {
        const da = await selectMultipleFile(['png', 'webp', 'mp4', 'mp3', 'gif'])
        if (!da) {
          return
        }
        const nextAdditionalAssets = [...(currentCharacter.additionalAssets ?? [])]
        for (const f of da) {
          console.log(f)
          const img = f.data
          const name = f.name
          const extension = name.split('.').pop().toLowerCase()
          const imgp = await saveAsset(img, '', extension)
          nextAdditionalAssets.push([name, imgp, extension])
        }
        const characterIndex = DBState.db.characters.findIndex(
          (candidate) => candidate.chaId === currentCharacter.chaId,
        )
        if (characterIndex >= 0) {
          const nextCharacter = cloneCharacter(DBState.db.characters[characterIndex])
          nextCharacter.additionalAssets = nextAdditionalAssets
          setCharacterByIndex(characterIndex, nextCharacter)
        }
      }
    }}>
    <PlusIcon />
  </button>
  {#if currentCharacter.additionalAssets}
    {#each currentCharacter.additionalAssets as additionalAsset (additionalAsset[1])}
      <button
        onclick={() => {
          onSelect(additionalAsset)
        }}>
        {#if assetFilePath[additionalAsset[1]]}
          {#if assetFileExtensions[additionalAsset[1]] === 'mp4'}
            <!-- svelte-ignore a11y_media_has_caption -->
            <video class="w-16 h-16 m-1 rounded-md"
              ><source src={assetFilePath[additionalAsset[1]]} type="video/mp4" /></video>
          {:else if assetFileExtensions[additionalAsset[1]] === 'mp3'}
            <div class="w-16 h-16 m-1 rounded-md bg-slate-500 flex flex-col justify-center items-center">
              <FileMusicIcon />
              <div class="w-16 px-1 text-ellipsis whitespace-nowrap overflow-hidden">
                {additionalAsset[0]}
              </div>
            </div>
          {:else}
            <img src={assetFilePath[additionalAsset[1]]} class="w-16 h-16 m-1 rounded-md" alt={additionalAsset[0]} />
          {/if}
        {/if}
      </button>
    {/each}
  {/if}
{/if}
