<script lang="ts">
  import { FileMusicIcon, PlusIcon } from '@lucide/svelte'
  import { setCharacterByIndex, type character } from 'src/ts/storage/database.svelte'
  import { getFileSrc, saveAsset } from 'src/ts/globalApi.svelte'
  import { DBState, selectedCharID } from 'src/ts/stores.svelte'
  import { selectMultipleFile } from 'src/ts/util'
  import {
    appendFreshCharacterAdditionalAssets,
    beginCharacterAdditionalAssetUpload,
    captureCharacterAdditionalAssetUploadTarget,
    clearCharacterAdditionalAssetUpload,
    isFreshCharacterAdditionalAssetUpload,
    type CharacterAdditionalAssetEntry,
    type CharacterAdditionalAssetUploadOperation,
  } from 'src/ts/server/characterAdditionalAssetUpload'
  interface Props {
    currentCharacter: character
    onSelect: (additionalAsset: [string, string, string]) => void
  }

  const { currentCharacter, onSelect }: Props = $props()
  const QUICK_ADD_ADDITIONAL_ASSET_EXTENSIONS = ['png', 'webp', 'mp4', 'mp3', 'gif']
  type SelectedAdditionalAssetFile = NonNullable<Awaited<ReturnType<typeof selectMultipleFile>>>[number]

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

  function additionalAssetExtension(name: string): string {
    return name.split('.').pop()?.toLowerCase() ?? ''
  }

  function currentQuickAddAdditionalAssetUploadTarget() {
    if (currentCharacter.type !== 'character' || !currentCharacter.chaId) return null

    return captureCharacterAdditionalAssetUploadTarget({
      characterId: currentCharacter.chaId,
      additionalAssets: currentCharacter.additionalAssets,
    })
  }

  function findAdditionalAssetUploadCharacter(characterId: string): {
    index: number
    character: character | undefined
  } {
    const index = DBState.db.characters?.findIndex((candidate) => candidate.chaId === characterId) ?? -1
    return {
      index,
      character: index >= 0 ? DBState.db.characters[index] : undefined,
    }
  }

  function quickAddAdditionalAssetUploadFreshness(operation: CharacterAdditionalAssetUploadOperation) {
    const live = findAdditionalAssetUploadCharacter(operation.characterId)

    return {
      currentCharacterId: DBState.db.characters?.[$selectedCharID]?.chaId,
      rowCharacterId: live.character?.chaId ?? null,
      additionalAssets: live.character?.additionalAssets,
    }
  }

  function isCurrentQuickAddAdditionalAssetUpload(operation: CharacterAdditionalAssetUploadOperation): boolean {
    return isFreshCharacterAdditionalAssetUpload(operation, quickAddAdditionalAssetUploadFreshness(operation))
  }

  async function uploadAdditionalAssetEntries(
    files: readonly SelectedAdditionalAssetFile[],
    operation: CharacterAdditionalAssetUploadOperation,
  ): Promise<CharacterAdditionalAssetEntry[] | null> {
    const entries: CharacterAdditionalAssetEntry[] = []

    for (const file of files) {
      if (!isCurrentQuickAddAdditionalAssetUpload(operation)) return null

      const extension = additionalAssetExtension(file.name)
      const assetPath = await saveAsset(file.data, '', extension)
      if (!isCurrentQuickAddAdditionalAssetUpload(operation)) return null

      entries.push([file.name, assetPath, extension])
    }

    return entries
  }

  function applyQuickAddAdditionalAssetEntries(
    operation: CharacterAdditionalAssetUploadOperation,
    entries: readonly CharacterAdditionalAssetEntry[],
  ): void {
    const live = findAdditionalAssetUploadCharacter(operation.characterId)
    const nextAdditionalAssets = appendFreshCharacterAdditionalAssets({
      operation,
      freshness: {
        currentCharacterId: DBState.db.characters?.[$selectedCharID]?.chaId,
        rowCharacterId: live.character?.chaId ?? null,
        additionalAssets: live.character?.additionalAssets,
      },
      entries,
    })
    if (!nextAdditionalAssets || !live.character || live.index < 0) return

    const nextCharacter = cloneCharacter(live.character)
    nextCharacter.additionalAssets = nextAdditionalAssets
    setCharacterByIndex(live.index, nextCharacter)
  }

  async function uploadQuickAddAdditionalAssets(): Promise<void> {
    const target = currentQuickAddAdditionalAssetUploadTarget()
    if (!target) return

    let operation: CharacterAdditionalAssetUploadOperation | null = null
    try {
      const files = await selectMultipleFile(QUICK_ADD_ADDITIONAL_ASSET_EXTENSIONS, {
        onFilesSelected: () => {
          operation = beginCharacterAdditionalAssetUpload(target)
        },
      })
      if (!files || files.length === 0 || !operation) return

      const activeOperation = operation
      const entries = await uploadAdditionalAssetEntries(files, activeOperation)
      if (!entries || entries.length === 0) return

      applyQuickAddAdditionalAssetEntries(activeOperation, entries)
    } finally {
      if (operation) {
        clearCharacterAdditionalAssetUpload(operation)
      }
    }
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
      await uploadQuickAddAdditionalAssets()
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
