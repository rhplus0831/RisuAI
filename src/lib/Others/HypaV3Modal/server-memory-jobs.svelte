<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import { RefreshCwIcon, XIcon } from '@lucide/svelte'
  import {
    cancelServerMemoryJob,
    listServerMemoryJobs,
    type ServerMemoryJob,
  } from 'src/ts/process/request/serverMemory'
  import { subscribeServerMemoryJobEvents } from 'src/ts/server/memoryJobEvents'
  import {
    createMemoryJobRefreshController,
    type MemoryJobRefreshController,
  } from 'src/ts/server/memoryJobRefresh'

  interface Props {
    chatId: string
  }

  let { chatId }: Props = $props()

  let jobs = $state<ServerMemoryJob[]>([])
  let loading = $state(false)
  let error = $state<string | null>(null)
  let cancellingJobIds = $state(new Set<string>())
  let lastLoadedAt = $state<string | null>(null)
  let refreshController: MemoryJobRefreshController | null = null
  let unsubscribeMemoryEvents: (() => void) | null = null

  const activeJobs = $derived(
    jobs.filter((job) => job.status === 'pending' || job.status === 'running'),
  )

  function kindLabel(kind: ServerMemoryJob['kind']): string {
    switch (kind) {
      case 'chunk':
        return 'Chunk'
      case 'embed':
        return 'Embed'
      case 'summarize':
        return 'Summarize'
    }
  }

  function statusClass(status: ServerMemoryJob['status']): string {
    if (status === 'running') return 'text-emerald-300 bg-emerald-950/60 border-emerald-800'
    if (status === 'pending') return 'text-sky-300 bg-sky-950/60 border-sky-800'
    return 'text-zinc-300 bg-zinc-950/60 border-zinc-700'
  }

  function formatTime(value: string): string {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return value
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  function setCancelling(jobId: string, cancelling: boolean): void {
    const next = new Set(cancellingJobIds)
    if (cancelling) {
      next.add(jobId)
    } else {
      next.delete(jobId)
    }
    cancellingJobIds = next
  }

  function refreshJobs(): Promise<void> {
    return refreshController?.refresh() ?? Promise.resolve()
  }

  async function cancelJob(jobId: string): Promise<void> {
    if (cancellingJobIds.has(jobId)) return

    setCancelling(jobId, true)
    const result = await cancelServerMemoryJob(jobId)
    setCancelling(jobId, false)

    if (result.status === 'ok') {
      await refreshJobs()
      return
    }

    error =
      result.status === 'unavailable' ? 'Server memory jobs are unavailable.' : result.error
    await refreshJobs()
  }

  $effect(() => {
    refreshController?.setChatId(chatId)
  })

  onMount(() => {
    refreshController = createMemoryJobRefreshController({
      chatId,
      listJobs: (currentChatId, signal) =>
        listServerMemoryJobs({ chatId: currentChatId }, signal),
      onJobs: (nextJobs, loadedAt) => {
        jobs = nextJobs
        error = null
        lastLoadedAt = loadedAt
      },
      onError: (message) => {
        jobs = []
        error = message
      },
      onClear: () => {
        jobs = []
        error = null
        lastLoadedAt = null
      },
      onLoading: (nextLoading) => {
        loading = nextLoading
      },
    })
    unsubscribeMemoryEvents = subscribeServerMemoryJobEvents((event) => {
      if (event.chatId === chatId) {
        void refreshJobs()
      }
    })
    void refreshJobs()
  })

  onDestroy(() => {
    unsubscribeMemoryEvents?.()
    unsubscribeMemoryEvents = null
    refreshController?.dispose()
    refreshController = null
  })
</script>

<section class="rounded-lg border border-zinc-700 bg-zinc-800/50 p-3 sm:p-4">
  <div class="flex items-center justify-between gap-3">
    <div class="min-w-0">
      <h2 class="text-sm font-semibold text-zinc-200">Server memory jobs</h2>
      <p class="mt-1 text-xs text-zinc-500">
        {#if loading}
          Refreshing...
        {:else if lastLoadedAt}
          Updated {formatTime(lastLoadedAt)}
        {:else}
          Waiting for server status
        {/if}
      </p>
    </div>

    <button
      class="shrink-0 rounded-sm p-2 text-zinc-400 transition-colors hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
      tabindex="-1"
      disabled={loading}
      onclick={() => void refreshJobs()}
      title="Refresh jobs"
    >
      <RefreshCwIcon class="h-4 w-4 {loading ? 'animate-spin' : ''}" />
    </button>
  </div>

  {#if error}
    <div class="mt-3 rounded-sm border border-rose-900/70 bg-rose-950/40 px-3 py-2 text-sm text-rose-200">
      {error}
    </div>
  {:else if activeJobs.length === 0}
    <div class="mt-3 rounded-sm border border-zinc-700 bg-zinc-900/60 px-3 py-2 text-sm text-zinc-400">
      No pending or running memory jobs.
    </div>
  {:else}
    <div class="mt-3 flex flex-col gap-2">
      {#each activeJobs as job (job.id)}
        <div
          class="flex flex-col gap-3 rounded-sm border border-zinc-700 bg-zinc-900/70 p-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <span class="text-sm font-medium text-zinc-100">{kindLabel(job.kind)}</span>
              <span class="rounded-sm border px-2 py-0.5 text-xs {statusClass(job.status)}">
                {job.status}
              </span>
              <span class="text-xs text-zinc-500">
                attempt {job.attemptCount}/{job.maxAttempts}
              </span>
            </div>
            <div class="mt-1 truncate text-xs text-zinc-500" title={job.id}>
              {job.id}
            </div>
          </div>

          <button
            class="inline-flex items-center justify-center gap-2 rounded-sm border border-rose-900/80 px-3 py-2 text-sm text-rose-200 transition-colors hover:bg-rose-950/60 disabled:cursor-not-allowed disabled:opacity-50"
            tabindex="-1"
            disabled={cancellingJobIds.has(job.id)}
            onclick={() => void cancelJob(job.id)}
            title="Cancel job"
          >
            <XIcon class="h-4 w-4" />
            {cancellingJobIds.has(job.id) ? 'Cancelling' : 'Cancel'}
          </button>
        </div>
      {/each}
    </div>
  {/if}
</section>
