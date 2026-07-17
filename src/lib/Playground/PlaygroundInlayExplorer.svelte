<script lang="ts">
  import { onDestroy } from 'svelte'
  import { SvelteSet } from 'svelte/reactivity'

  import { language } from 'src/lang'
  import { alertConfirm, alertError } from 'src/ts/alert'
  import { getInlayAssetBlob, listInlayAssets, removeInlayAsset, type InlayAsset } from 'src/ts/process/files/inlays'
  import { subscribeServerInlayCatalog } from 'src/ts/server/inlayCatalog'
  import Button from '../UI/GUI/Button.svelte'
  import CheckInput from '../UI/GUI/CheckInput.svelte'

  const PAGE_SIZE = 36

  let allAssets = $state<[string, InlayAsset][]>([])
  let displayCount = $state(PAGE_SIZE)
  let loading = $state(true)
  let loadError = $state('')
  let loadMoreSentinel: HTMLDivElement | null = $state(null)
  // Object URLs to revoke on teardown.
  let previewURLs = $state<Map<string, string>>(new Map())
  let selection = $state<Set<string>>(new SvelteSet())
  const previewLoadRuns = new Map<string, number>()
  let assetLoadRun = 0
  let destroyed = false
  let deletionBusy = $state(false)
  let unsubscribeCatalog = () => {}

  const displayedAssets = $derived(allAssets.slice(0, displayCount))
  const hasMore = $derived(displayCount < allAssets.length)
  const hasSelection = $derived(selection.size > 0)

  const getPreviewURL = async (id: string) => {
    if (previewURLs.has(id)) return previewURLs.get(id)!
    const run = (previewLoadRuns.get(id) ?? 0) + 1
    previewLoadRuns.set(id, run)
    try {
      const result = await getInlayAssetBlob(id)
      if (result && !destroyed && previewLoadRuns.get(id) === run) {
        const url = URL.createObjectURL(result.data)
        previewURLs.set(id, url)
        return url
      }
    } catch (error) {
      console.warn(`Failed to load inlay preview ${id}:`, error)
    }
    return previewURLs.get(id) ?? null
  }

  const toggleSelect = (id: string) => {
    if (selection.has(id)) {
      selection.delete(id)
    } else {
      selection.add(id)
    }
  }

  const selectAll = () => {
    allAssets.forEach(([id]) => selection.add(id))
  }

  const deselectAll = () => {
    selection.clear()
  }

  const releasePreview = (id: string) => {
    previewLoadRuns.set(id, (previewLoadRuns.get(id) ?? 0) + 1)
    const url = previewURLs.get(id)
    if (url) URL.revokeObjectURL(url)
    previewURLs.delete(id)
  }

  const deleteAsset = async (id: string, name: string) => {
    if (deletionBusy) return
    deletionBusy = true
    try {
      if (!(await alertConfirm(language.playground.inlayDeleteConfirm.replace('{name}', name)))) return
      await removeInlayAsset(id)
    } catch (error) {
      alertError(error)
      return
    } finally {
      deletionBusy = false
    }
    releasePreview(id)
    selection.delete(id)
    allAssets = allAssets.filter(([assetId]) => assetId !== id)
  }

  const deleteSelected = async () => {
    if (selection.size === 0 || deletionBusy) return
    deletionBusy = true
    try {
      if (
        !(await alertConfirm(
          language.playground.inlayDeleteMultipleConfirm.replace('{count}', selection.size.toString()),
        ))
      ) {
        return
      }
      const selectedIds = [...selection]
      const results = await Promise.allSettled(selectedIds.map((id) => removeInlayAsset(id)))
      const deletedIds = new Set<string>()
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          const id = selectedIds[index]
          deletedIds.add(id)
          releasePreview(id)
          selection.delete(id)
        }
      })
      allAssets = allAssets.filter(([assetId]) => !deletedIds.has(assetId))

      const failedResult = results.find((result) => result.status === 'rejected')
      if (failedResult?.status === 'rejected') {
        alertError(failedResult.reason)
      }
    } finally {
      deletionBusy = false
    }
  }

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const getAssetSize = (asset: InlayAsset) => {
    if (typeof asset.size === 'number') return formatSize(asset.size)
    if (asset.data instanceof Blob) {
      return formatSize(asset.data.size)
    }
    if (typeof asset.data === 'string') return formatSize(asset.data.length * 0.75) // base64 estimate
    return formatSize(0)
  }

  let observer: IntersectionObserver | null = null
  $effect(() => {
    if (!loadMoreSentinel || !hasMore) {
      observer?.disconnect()
      return
    }

    const loadMore = () => {
      if (!hasMore || loading) {
        return
      }

      loading = true
      displayCount += PAGE_SIZE
      queueMicrotask(() => {
        loading = false
      })
    }

    observer?.disconnect()
    unsubscribeCatalog()
    observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          loadMore()
        }
      },
      {
        root: null,
        rootMargin: '200px 0px',
        threshold: 0,
      },
    )
    observer.observe(loadMoreSentinel)

    return () => {
      observer?.disconnect()
      observer = null
    }
  })

  onDestroy(() => {
    destroyed = true
    assetLoadRun += 1
    previewLoadRuns.clear()
    previewURLs.forEach((url) => URL.revokeObjectURL(url))
    observer?.disconnect()
  })

  const loadAssets = async () => {
    const run = ++assetLoadRun
    loading = true
    loadError = ''
    try {
      const assets = await listInlayAssets()
      if (destroyed || run !== assetLoadRun) return
      const nextIds = new Set(assets.map(([id]) => id))
      for (const id of previewURLs.keys()) {
        if (!nextIds.has(id)) releasePreview(id)
      }
      allAssets = assets
      selection.clear()
      displayCount = PAGE_SIZE
    } catch (error) {
      if (destroyed || run !== assetLoadRun) return
      loadError = error instanceof Error ? error.message : String(error)
    } finally {
      if (!destroyed && run === assetLoadRun) {
        loading = false
      }
    }
  }
  unsubscribeCatalog = subscribeServerInlayCatalog(() => {
    if (!destroyed) void loadAssets()
  })
  void loadAssets()
</script>

<h2 class="text-4xl text-textcolor mt-6 font-black relative">
  {language.playground.inlayExplorer}
</h2>

<header class="flex flex-wrap gap-4 py-6 items-center sticky top-0 bg-bgcolor">
  <span class="text-textcolor2"
    >{language.playground.inlayTotalAssets.replace('{count}', allAssets.length.toString())}</span>
  {#if allAssets.length > 0}
    <div class="ml-auto flex max-w-full flex-wrap justify-end gap-2">
      {#if hasSelection}
        <Button onclick={deleteSelected} disabled={deletionBusy} styled="danger" size="sm"
          >{language.playground.inlayDeleteSelected}</Button>
        <Button onclick={deselectAll} disabled={deletionBusy} styled="primary" size="sm"
          >{language.playground.inlayDeselectAll} ({selection.size})</Button>
      {:else}
        <Button onclick={selectAll} disabled={deletionBusy} styled="primary" size="sm"
          >{language.playground.inlaySelectAll}</Button>
      {/if}
    </div>
  {/if}
</header>

{#if loadError}
  <div class="flex flex-col items-center gap-3 py-12 text-center" role="alert">
    <p class="text-lg text-textcolor">{language.playground.inlayLoadError}</p>
    <p class="text-sm text-textcolor2">{loadError}</p>
    <Button onclick={loadAssets} styled="outlined" size="sm">{language.retry}</Button>
  </div>
{:else if loading && allAssets.length === 0}
  <div class="py-12 text-center text-textcolor2">{language.loading}</div>
{:else if allAssets.length === 0}
  <div class="text-center py-12 text-textcolor2">
    <p class="text-lg">{language.playground.inlayEmpty}</p>
    <p class="text-sm mt-2">{language.playground.inlayEmptyDesc}</p>
  </div>
{:else}
  <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
    {#each displayedAssets as [id, asset] (id)}
      {#key selection.has(id)}
        <div class="border border-darkborderc rounded-lg p-4 bg-darkbg">
          <div class="flex items-center gap-2 mb-3">
            <CheckInput
              check={selection.has(id)}
              name={language.playground.inlaySelectAsset(asset.name)}
              hiddenName
              margin={false}
              onChange={() => toggleSelect(id)} />
            <span class="px-2 py-1 text-xs rounded bg-darkbutton text-textcolor2">
              {asset.type}
            </span>
          </div>
          <div class="mb-3">
            {#if asset.type === 'image'}
              {#await getPreviewURL(id) then url}
                {#if url}
                  <img alt={asset.name} class="w-full h-40 object-contain rounded bg-black/20" src={url} />
                {:else}
                  <div class="flex h-40 items-center justify-center rounded bg-black/20 text-sm text-textcolor2">
                    {language.playground.inlayPreviewUnavailable}
                  </div>
                {/if}
              {/await}
            {:else if asset.type === 'video'}
              {#await getPreviewURL(id) then url}
                {#if url}
                  <video class="w-full h-40 object-contain rounded bg-black/20" controls src={url}>
                    <track kind="captions" />
                  </video>
                {:else}
                  <div class="flex h-40 items-center justify-center rounded bg-black/20 text-sm text-textcolor2">
                    {language.playground.inlayPreviewUnavailable}
                  </div>
                {/if}
              {/await}
            {:else if asset.type === 'audio'}
              {#await getPreviewURL(id) then url}
                {#if url}
                  <audio class="w-full" controls src={url}>
                    <track kind="captions" />
                  </audio>
                {:else}
                  <div class="flex h-40 items-center justify-center rounded bg-black/20 text-sm text-textcolor2">
                    {language.playground.inlayPreviewUnavailable}
                  </div>
                {/if}
              {/await}
            {/if}
          </div>

          <div class="flex justify-between items-start mb-2">
            <div class="flex-1 min-w-0">
              <p class="text-textcolor font-medium truncate" title={asset.name}>{asset.name}</p>
              {#if asset.name !== id}
                <p class="text-textcolor2 text-xs truncate" title={id}>{id}</p>
              {/if}
            </div>
          </div>

          <div class="text-textcolor2 text-sm mb-3">
            {#if asset.width && asset.height}
              <span>{asset.width}x{asset.height} • </span>
            {/if}
            <span>{getAssetSize(asset)}</span>
          </div>

          <Button onclick={() => deleteAsset(id, asset.name)} disabled={deletionBusy} styled="danger" size="sm"
            >{language.playground.inlayDelete}</Button>
        </div>
      {/key}
    {/each}
  </div>

  {#if hasMore}
    <div bind:this={loadMoreSentinel} class="h-12 flex items-center justify-center text-textcolor2 text-sm">
      {language.loading}...
    </div>
  {/if}
{/if}
