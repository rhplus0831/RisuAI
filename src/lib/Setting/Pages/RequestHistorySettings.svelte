<script lang="ts">
  import { onMount } from 'svelte'
  import { language } from 'src/lang'
  import Button from 'src/lib/UI/GUI/Button.svelte'
  import NumberInput from 'src/lib/UI/GUI/NumberInput.svelte'
  import { alertConfirm } from 'src/ts/alert'
  import { persistServerBackedSettingsPatchWithSettlement } from 'src/ts/server/settingsOwner.svelte'
  import {
    deleteRequestHistoryRecord,
    getRequestHistoryRecord,
    listRequestHistory,
    type RequestHistoryRecord,
    type RequestHistoryRecordSummary,
  } from 'src/ts/server/requestHistory'

  const MAX_LIMIT = 10_000

  let records = $state<RequestHistoryRecordSummary[]>([])
  let limitDraft = $state(20)
  let savedLimit = $state(20)
  let selected = $state<Set<string>>(new Set())
  let expandedId = $state<string | null>(null)
  let expandedRecord = $state<RequestHistoryRecord | null>(null)
  let loading = $state(true)
  let loadingDetail = $state(false)
  let savingLimit = $state(false)
  let deleting = $state(false)
  let error = $state('')
  let queuedLimitSave = $state(false)
  let controller: AbortController | null = null
  let stopQueuedSettlement: (() => void) | null = null

  onMount(() => {
    controller = new AbortController()
    void refreshHistory(true)
    return () => {
      controller?.abort()
      stopQueuedSettlement?.()
    }
  })

  async function refreshHistory(syncLimit: boolean): Promise<void> {
    loading = true
    error = ''
    const result = await listRequestHistory(controller?.signal)
    loading = false
    if (result.status === 'error') {
      if (!controller?.signal.aborted) error = result.error
      return
    }
    records = result.value.records
    savedLimit = result.value.limit
    if (syncLimit && !queuedLimitSave) limitDraft = result.value.limit
    selected = new Set([...selected].filter((id) => records.some((record) => record.id === id)))
    if (expandedId && !records.some((record) => record.id === expandedId)) closeDetail()
  }

  async function saveLimit(): Promise<void> {
    if (savingLimit || queuedLimitSave) return
    const normalized = normalizeLimit(limitDraft)
    limitDraft = normalized
    if (normalized === savedLimit && !queuedLimitSave) return
    savingLimit = true
    error = ''
    const receipt = await persistServerBackedSettingsPatchWithSettlement({ requestHistoryLimit: normalized })
    savingLimit = false
    if (receipt.status !== 'queued') {
      if (receipt.status === 'failed') {
        error = language.requestHistoryLimitSaveFailed
        limitDraft = savedLimit
      } else {
        queuedLimitSave = false
        savedLimit = normalized
        await refreshHistory(true)
      }
      return
    }

    queuedLimitSave = true
    stopQueuedSettlement = receipt.subscribeSettlement((settlement) => {
      stopQueuedSettlement = null
      queuedLimitSave = false
      if (settlement === 'accepted') {
        savedLimit = normalized
        void refreshHistory(true)
      } else {
        error = language.requestHistoryLimitSaveFailed
        limitDraft = savedLimit
      }
    })
    await refreshHistory(false)
  }

  function toggleSelected(id: string, checked: boolean): void {
    const next = new Set(selected)
    if (checked) next.add(id)
    else next.delete(id)
    selected = next
  }

  async function toggleDetail(id: string): Promise<void> {
    if (expandedId === id) {
      closeDetail()
      return
    }
    expandedId = id
    expandedRecord = null
    loadingDetail = true
    error = ''
    const result = await getRequestHistoryRecord(id, controller?.signal)
    loadingDetail = false
    if (result.status === 'error') {
      if (!controller?.signal.aborted) error = result.error
      if (expandedId === id) closeDetail()
      return
    }
    if (expandedId === id) expandedRecord = result.value
  }

  function closeDetail(): void {
    expandedId = null
    expandedRecord = null
    loadingDetail = false
  }

  async function deleteSelected(): Promise<void> {
    const ids = [...selected]
    if (ids.length === 0 || deleting) return
    if (!(await alertConfirm(language.requestHistoryDeleteConfirm(ids.length)))) return
    deleting = true
    error = ''
    const removed = new Set<string>()
    for (const id of ids) {
      const result = await deleteRequestHistoryRecord(id, controller?.signal)
      if (result.status === 'ok') removed.add(id)
      else if (!controller?.signal.aborted) error = result.error
    }
    records = records.filter((record) => !removed.has(record.id))
    selected = new Set([...selected].filter((id) => !removed.has(id)))
    if (expandedId && removed.has(expandedId)) closeDetail()
    deleting = false
  }

  function normalizeLimit(value: number): number {
    return typeof value === 'number' && Number.isFinite(value)
      ? Math.max(0, Math.min(MAX_LIMIT, Math.trunc(value)))
      : savedLimit
  }

  function formatDate(value: number): string {
    return new Date(value).toLocaleString()
  }

  function formatDuration(record: RequestHistoryRecordSummary): string {
    if (record.completedAt === undefined) return language.requestHistoryDurationPending
    const seconds = Math.max(0, record.completedAt - record.startedAt) / 1_000
    return language.requestHistoryDuration(seconds.toFixed(2))
  }

  function profileLabel(record: RequestHistoryRecordSummary): string {
    return record.profile.name || record.profile.id || record.profile.modelId || language.requestHistoryUnknownProfile
  }

  function json(value: unknown): string {
    try {
      return JSON.stringify(value, null, 2)
    } catch {
      return String(value)
    }
  }
</script>

<div class="mx-auto flex w-full max-w-5xl flex-col gap-5">
  <div>
    <h2 class="text-2xl font-bold">{language.requestHistoryTitle}</h2>
    <p class="mt-1 text-sm text-textcolor2">{language.requestHistoryDescription}</p>
  </div>

  <section class="rounded-lg border border-darkborderc bg-darkbg/40 p-4">
    <label class="mb-2 block font-semibold" for="request-history-limit">{language.requestHistoryLimit}</label>
    <p class="mb-3 text-sm text-textcolor2">{language.requestHistoryLimitDescription}</p>
    <div class="flex flex-wrap items-center gap-2">
      <NumberInput
        id="request-history-limit"
        min={0}
        max={MAX_LIMIT}
        step={1}
        disabled={savingLimit || queuedLimitSave}
        bind:value={limitDraft} />
      <Button size="sm" disabled={savingLimit || queuedLimitSave} onclick={saveLimit}>
        {savingLimit ? language.requestHistorySaving : language.requestHistorySaveLimit}
      </Button>
      <Button size="sm" styled="outlined" disabled={loading} onclick={() => refreshHistory(true)}>
        {language.requestHistoryRefresh}
      </Button>
    </div>
    {#if limitDraft === 0}
      <p class="mt-2 text-sm text-textcolor2">{language.requestHistoryDisabledHint}</p>
    {/if}
    {#if queuedLimitSave}
      <p class="mt-2 text-sm text-textcolor2">{language.settingsSaveQueued}</p>
    {/if}
  </section>

  <div class="flex flex-wrap items-center justify-between gap-2">
    <p class="text-sm text-textcolor2">{language.requestHistoryRecordCount(records.length)}</p>
    <Button styled="danger" size="sm" disabled={selected.size === 0 || deleting} onclick={deleteSelected}>
      {deleting ? language.requestHistoryDeleting : language.requestHistoryDeleteSelected(selected.size)}
    </Button>
  </div>

  {#if error}
    <div role="alert" class="rounded-md border border-red-600 bg-red-950/40 p-3 text-sm text-red-200">{error}</div>
  {/if}

  {#if loading}
    <p class="py-8 text-center text-textcolor2">{language.requestHistoryLoading}</p>
  {:else if records.length === 0}
    <p class="rounded-lg border border-darkborderc py-10 text-center text-textcolor2">
      {language.requestHistoryEmpty}
    </p>
  {:else}
    <div class="flex flex-col gap-2">
      {#each records as record (record.id)}
        <article class="overflow-hidden rounded-lg border border-darkborderc bg-darkbg/30">
          <div class="flex items-stretch">
            <label class="flex shrink-0 items-center px-3" aria-label={language.requestHistorySelectRecord}>
              <input
                type="checkbox"
                checked={selected.has(record.id)}
                onchange={(event) => toggleSelected(record.id, event.currentTarget.checked)} />
            </label>
            <button
              class="flex min-w-0 grow items-center gap-3 p-3 text-left hover:bg-bgcolor/50"
              aria-expanded={expandedId === record.id}
              onclick={() => toggleDetail(record.id)}>
              <span
                class="rounded px-2 py-1 text-xs font-semibold uppercase"
                class:bg-green-700={record.status === 'success'}
                class:bg-red-700={record.status === 'error'}
                class:bg-amber-700={record.status === 'cancelled'}
                class:bg-slate-600={record.status === 'pending'}>{record.status}</span>
              <span class="min-w-0 grow">
                <span class="block truncate font-semibold">{profileLabel(record)}</span>
                <span class="block truncate text-xs text-textcolor2">
                  {record.source} · {record.profile.requestModel || record.profile.modelId}
                  {#if record.context?.chatName}
                    · {record.context.chatName}{/if}
                </span>
              </span>
              <span class="shrink-0 text-right text-xs text-textcolor2">
                <time class="block" datetime={new Date(record.startedAt).toISOString()}>
                  {formatDate(record.startedAt)}
                </time>
                <span class="mt-0.5 block" data-risu-request-history-duration>{formatDuration(record)}</span>
              </span>
            </button>
          </div>

          {#if expandedId === record.id}
            <div class="border-t border-darkborderc p-4">
              {#if loadingDetail}
                <p class="text-sm text-textcolor2">{language.requestHistoryLoadingDetail}</p>
              {:else if expandedRecord}
                <div class="grid gap-4">
                  <div class="grid gap-3 md:grid-cols-2">
                    <div>
                      <h3 class="mb-1 text-sm font-semibold">{language.requestHistoryProfile}</h3>
                      <pre class="history-code">{json(expandedRecord.profile)}</pre>
                    </div>
                    <div>
                      <h3 class="mb-1 text-sm font-semibold">{language.requestHistoryContext}</h3>
                      <pre class="history-code">{json(expandedRecord.context ?? {})}</pre>
                    </div>
                  </div>
                  <div>
                    <h3 class="mb-1 text-sm font-semibold">{language.requestHistoryToggles}</h3>
                    <pre class="history-code">{json(expandedRecord.toggles ?? {})}</pre>
                  </div>
                  <div>
                    <h3 class="mb-1 text-sm font-semibold">{language.requestHistoryPrompt}</h3>
                    <pre class="history-code max-h-96">{json(expandedRecord.prompt)}</pre>
                  </div>
                  <div>
                    <h3 class="mb-1 text-sm font-semibold">{language.requestHistoryResponse}</h3>
                    <pre class="history-code max-h-96">{expandedRecord.response}</pre>
                  </div>
                  <div>
                    <h3 class="mb-1 text-sm font-semibold">{language.requestHistoryMetadata}</h3>
                    <pre class="history-code max-h-96">{json(expandedRecord.metadata)}</pre>
                  </div>
                  <div>
                    <h3 class="mb-1 text-sm font-semibold">{language.requestHistoryApiMetadata}</h3>
                    <pre class="history-code max-h-96">{json(expandedRecord.apiMetadata)}</pre>
                  </div>
                  {#if expandedRecord.error}
                    <div>
                      <h3 class="mb-1 text-sm font-semibold">{language.requestHistoryError}</h3>
                      <pre class="history-code text-red-200">{expandedRecord.error}</pre>
                    </div>
                  {/if}
                </div>
              {/if}
            </div>
          {/if}
        </article>
      {/each}
    </div>
  {/if}
</div>

<style>
  .history-code {
    overflow: auto;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    border: 1px solid var(--risu-theme-darkborderc);
    border-radius: 0.375rem;
    background: color-mix(in srgb, var(--risu-theme-bgcolor) 70%, transparent);
    padding: 0.75rem;
    font-size: 0.75rem;
    line-height: 1.35;
  }
</style>
