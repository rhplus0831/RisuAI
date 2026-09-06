<script lang="ts">
  import { onMount } from 'svelte'
  import { HardDrive, RefreshCw } from '@lucide/svelte'
  import { STORAGE_USAGE_CATEGORIES, type StorageUsageResponse } from '@risuai/protocol/storage-usage'
  import { language } from 'src/lang'
  import Button from 'src/lib/UI/GUI/Button.svelte'
  import { fetchStorageUsage } from 'src/ts/server/storageUsage'

  let report = $state<StorageUsageResponse | null>(null)
  let loading = $state(true)
  let failed = $state(false)
  let controller: AbortController | undefined
  let disposed = false
  const colors = {
    database: 'bg-rose-400',
    journal: 'bg-sky-400',
    assets: 'bg-emerald-400',
    backups: 'bg-violet-400',
    legacy: 'bg-amber-400',
    logs: 'bg-cyan-400',
    other: 'bg-slate-400',
  }
  const rows = $derived(
    STORAGE_USAGE_CATEGORIES.map((id) => ({
      id,
      label: language.storageUsage.categories[id],
      description: language.storageUsage.descriptions[id],
      bytes: report?.categories[id] ?? 0,
      color: colors[id],
    })),
  )

  function formatBytes(bytes: number): string {
    const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB']
    const index = bytes > 0 ? Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1) : 0
    return `${(bytes / 1024 ** index).toLocaleString(undefined, { maximumFractionDigits: index === 0 ? 0 : 1 })} ${units[index]}`
  }

  async function refresh(): Promise<void> {
    controller?.abort()
    const request = new AbortController()
    controller = request
    loading = true
    failed = false
    const timeout = setTimeout(() => request.abort(), 60_000)
    try {
      const result = await fetchStorageUsage(request.signal)
      if (!disposed && controller === request && !request.signal.aborted) report = result
    } catch {
      if (!disposed && controller === request) failed = true
    } finally {
      clearTimeout(timeout)
      if (!disposed && controller === request) loading = false
    }
  }

  onMount(() => {
    void refresh()
    return () => {
      disposed = true
      controller?.abort()
    }
  })
</script>

<section
  class="my-5 min-w-0 rounded-lg border border-darkborderc bg-darkbg/30 p-4"
  aria-labelledby="storage-usage-title">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <h3 id="storage-usage-title" class="flex items-center gap-2 text-lg font-semibold">
      <HardDrive size={20} aria-hidden="true" />
      {language.storageUsage.title}
    </h3>
    <Button styled="outlined" size="sm" disabled={loading} onclick={refresh} className="flex items-center gap-2">
      <RefreshCw size={14} aria-hidden="true" class={loading ? 'animate-spin motion-reduce:animate-none' : ''} />
      {failed ? language.storageUsage.retry : language.storageUsage.refresh}
    </Button>
  </div>
  <p class="mt-2 text-sm text-textcolor2">{language.storageUsage.description}</p>
  <p class="mt-3 text-sm text-textcolor2" role="status">
    {#if loading}{language.storageUsage.loading}{/if}
  </p>
  {#if failed}
    <p class="mt-2 text-sm text-draculared" role="alert">
      {report ? language.storageUsage.refreshFailed : language.storageUsage.failed}
    </p>
  {/if}
  {#if report}
    <div class="mt-3 flex flex-wrap items-baseline justify-between gap-2">
      <span class="text-sm text-textcolor2">{language.storageUsage.total}</span>
      <span class="text-2xl font-semibold tabular-nums">{formatBytes(report.totalBytes)}</span>
    </div>
    <div class="my-4 flex h-5 overflow-hidden rounded-full bg-darkborderc" aria-hidden="true">
      {#each rows as row (row.id)}
        {#if row.bytes > 0 && report.totalBytes > 0}
          <div
            class="h-full {row.color}"
            style:width="{(row.bytes / report.totalBytes) * 100}%"
            title="{row.label}: {formatBytes(row.bytes)}">
          </div>
        {/if}
      {/each}
    </div>
    <dl class="divide-y divide-darkborderc">
      {#each rows as row (row.id)}
        <div class="flex items-baseline justify-between gap-4 py-2">
          <dt class="min-w-0">
            <details class="group text-sm">
              <summary
                class="cursor-pointer rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-selected">
                <span class="mr-1 inline-block h-2.5 w-2.5 rounded-sm {row.color}" aria-hidden="true"></span>
                {row.label}
              </summary>
              <p class="mt-1 max-w-lg text-xs leading-relaxed text-textcolor2">{row.description}</p>
            </details>
          </dt>
          <dd class="shrink-0 text-sm tabular-nums">{formatBytes(row.bytes)}</dd>
        </div>
      {/each}
    </dl>
    <div class="mt-4 rounded-md border border-darkborderc p-3">
      <div class="text-sm font-medium">{language.storageUsage.diskTitle}</div>
      <p class="mt-1 text-sm text-textcolor2">
        {report.disk
          ? language.storageUsage.diskAvailable(
              formatBytes(report.disk.availableBytes),
              formatBytes(report.disk.totalBytes),
            )
          : language.storageUsage.diskUnavailable}
      </p>
    </div>
    {#if report.partial}
      <p class="mt-3 text-sm text-amber-400">{language.storageUsage.partial}</p>
    {/if}
    <p class="mt-3 text-xs leading-relaxed text-textcolor2">{language.storageUsage.measurementNote}</p>
    <p class="mt-2 text-xs text-textcolor2">
      {language.storageUsage.measuredAt(new Date(report.measuredAt).toLocaleString())}
    </p>
  {/if}
</section>
