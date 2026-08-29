<script lang="ts">
  import { onDestroy } from 'svelte'
  import { BookOpenIcon, HistoryIcon, PlusIcon, RotateCcwIcon, Trash2Icon, XIcon } from '@lucide/svelte'
  import type {
    BardWikiContextPolicy,
    BardWikiDocument,
    BardWikiDocumentKind,
    BardWikiJobSummary,
    BardWikiReceiptSummary,
    BardWikiReviewState,
  } from '@risuai/protocol'
  import { language } from 'src/lang'
  import { modalBackdropDismiss } from 'src/ts/gui/modalBackdropDismiss'
  import { modalFocusTrap } from 'src/ts/gui/modalFocusTrap'
  import {
    bardWikiDocumentResourceKey,
    bardWikiResource,
    loadBardWikiChatResource,
    loadBardWikiDocumentResource,
    loadBardWikiVersionsResource,
  } from 'src/ts/server/bardWikiResource'
  import {
    createBardWikiDocument,
    deleteBardWikiDocument,
    saveBardWikiChatSettings,
    updateBardWikiDocument,
    type BardWikiMutationFailure,
    type BardWikiMutationFinalOutcome,
    type BardWikiMutationOutcome,
  } from 'src/ts/server/bardWikiCommands'
  import { subscribeServerBardWikiJobEvents } from 'src/ts/server/bardWikiJobEvents'
  import { cancelServerBardWikiJob, retryServerBardWikiJob } from 'src/ts/process/request/serverBardWikiJobs'

  interface Props {
    chatId: string
    close?: () => void
  }

  type LoadState = 'idle' | 'loading' | 'ready' | 'unavailable' | 'error'
  type MutationState = 'idle' | 'saving' | 'accepted' | 'queued' | 'conflict' | 'failed'
  type EditorMode = 'idle' | 'create' | 'edit'
  interface DocumentDraft {
    kind: BardWikiDocumentKind
    title: string
    logicalPath: string
    aliases: string
    contextPolicy: BardWikiContextPolicy
    reviewState: BardWikiReviewState
    markdown: string
  }

  const DOCUMENT_KINDS: BardWikiDocumentKind[] = [
    'event',
    'character',
    'location',
    'scene',
    'faction',
    'item',
    'concept',
    'other',
  ]
  const CONTEXT_POLICIES: BardWikiContextPolicy[] = ['never', 'relevant', 'always', 'pinned']
  const REVIEW_STATES: BardWikiReviewState[] = ['active', 'needs_review', 'archived']

  let { chatId, close = () => {} }: Props = $props()
  let chatLoadState = $state<LoadState>('idle')
  let chatLoadError = $state('')
  let selectedDocumentId = $state<string | null>(null)
  let documentLoadState = $state<LoadState>('idle')
  let documentLoadError = $state('')
  let versionsVisible = $state(false)
  let versionsLoadState = $state<LoadState>('idle')
  let versionsLoadError = $state('')
  let editorMode = $state<EditorMode>('idle')
  let documentDraft = $state<DocumentDraft>(emptyDocumentDraft())
  let documentBaseline = $state('')
  let documentMutationState = $state<MutationState>('idle')
  let documentMutationError = $state('')
  let settingsMutationState = $state<MutationState>('idle')
  let settingsMutationError = $state('')
  let jobActionError = $state('')
  let jobActionInstanceIds = $state<Set<string>>(new Set())
  let enabledOverrideDraft = $state<'inherit' | 'enabled' | 'disabled'>('inherit')
  let memoryModeOverrideDraft = $state<'inherit' | 'hypa' | 'bardwiki' | 'hybrid'>('inherit')
  let totalTokenBudgetOverrideDraft = $state('')
  let chatRequest = 0
  let documentRequest = 0
  let versionsRequest = 0
  let documentMutationSequence = 0
  let settingsMutationSequence = 0

  let chatResource = $derived($bardWikiResource.chats[chatId] ?? null)
  let documentKey = $derived(
    selectedDocumentId === null ? null : bardWikiDocumentResourceKey(chatId, selectedDocumentId),
  )
  let documentResource = $derived(documentKey === null ? null : ($bardWikiResource.documents[documentKey] ?? null))
  let versionsResource = $derived(documentKey === null ? null : ($bardWikiResource.versions[documentKey] ?? null))
  let documentDirty = $derived(editorMode !== 'idle' && JSON.stringify(documentDraft) !== documentBaseline)
  let documentMutationPending = $derived(documentMutationState === 'saving' || documentMutationState === 'queued')
  let settingsMutationPending = $derived(settingsMutationState === 'saving' || settingsMutationState === 'queued')

  function emptyDocumentDraft(): DocumentDraft {
    return {
      kind: 'other',
      title: '',
      logicalPath: '',
      aliases: '',
      contextPolicy: 'relevant',
      reviewState: 'active',
      markdown: '',
    }
  }

  function draftFromDocument(document: BardWikiDocument): DocumentDraft {
    return {
      kind: document.kind,
      title: document.title,
      logicalPath: document.logicalPath,
      aliases: document.aliases.join(', '),
      contextPolicy: document.contextPolicy,
      reviewState: document.reviewState,
      markdown: document.markdown,
    }
  }

  function adoptDocumentDraft(document: BardWikiDocument): void {
    documentDraft = draftFromDocument(document)
    documentBaseline = JSON.stringify(documentDraft)
    editorMode = 'edit'
    documentMutationState = 'idle'
    documentMutationError = ''
  }

  function resetEditor(): void {
    selectedDocumentId = null
    documentRequest += 1
    versionsRequest += 1
    versionsVisible = false
    versionsLoadState = 'idle'
    documentLoadState = 'idle'
    editorMode = 'idle'
    documentDraft = emptyDocumentDraft()
    documentBaseline = ''
    documentMutationState = 'idle'
    documentMutationError = ''
  }

  function syncChatSettings(): void {
    const settings = chatResource?.chatSettings
    enabledOverrideDraft =
      settings?.enabledOverride === true ? 'enabled' : settings?.enabledOverride === false ? 'disabled' : 'inherit'
    memoryModeOverrideDraft = settings?.memoryModeOverride ?? 'inherit'
    totalTokenBudgetOverrideDraft =
      settings?.totalTokenBudgetOverride === null || settings?.totalTokenBudgetOverride === undefined
        ? ''
        : String(settings.totalTokenBudgetOverride)
  }

  function readFailure(result: { status: string; error?: string }): { state: LoadState; error: string } {
    if (result.status === 'unavailable') return { state: 'unavailable', error: language.bardWiki.unavailable }
    return { state: 'error', error: result.error || language.bardWiki.loadFailed }
  }

  function mutationFailureMessage(result: BardWikiMutationFailure): string {
    if (result.status === 'conflict' || (result.status === 'error' && result.error.includes('conflict'))) {
      return language.bardWiki.conflictMessage
    }
    if (result.status === 'unavailable') return language.bardWiki.mutationUnavailable
    return result.status === 'error'
      ? language.bardWiki.mutationFailedDetail(result.error)
      : language.bardWiki.mutationFailed
  }

  async function loadChat(reset = true): Promise<boolean> {
    const request = ++chatRequest
    const targetChatId = chatId
    if (reset) resetEditor()
    chatLoadState = 'loading'
    chatLoadError = ''
    const result = await loadBardWikiChatResource(targetChatId)
    if (request !== chatRequest || targetChatId !== chatId) return false
    if (result.status === 'ok') {
      chatLoadState = 'ready'
      syncChatSettings()
      return true
    }
    const failure = readFailure(result)
    chatLoadState = failure.state
    chatLoadError = failure.error
    return false
  }

  function isActiveJob(job: BardWikiJobSummary): boolean {
    return job.status === 'pending' || job.status === 'running'
  }

  function setJobActionPending(instanceId: string, pending: boolean): void {
    const next = new Set(jobActionInstanceIds)
    if (pending) next.add(instanceId)
    else next.delete(instanceId)
    jobActionInstanceIds = next
  }

  async function mutateJob(job: BardWikiJobSummary, action: 'retry' | 'cancel'): Promise<void> {
    if (jobActionInstanceIds.has(job.instanceId)) return
    setJobActionPending(job.instanceId, true)
    jobActionError = ''
    const result = action === 'retry' ? await retryServerBardWikiJob(job.id) : await cancelServerBardWikiJob(job.id)
    if (result.status !== 'ok') {
      jobActionError = language.bardWiki.jobActionFailed(
        result.status === 'error' ? result.error : language.bardWiki.unavailable,
      )
      setJobActionPending(job.instanceId, false)
      return
    }
    await loadChat(false)
    setJobActionPending(job.instanceId, false)
  }

  function jobUpdatedLabel(job: BardWikiJobSummary): string {
    return language.bardWiki.jobUpdated(new Date(job.updatedAt).toLocaleString())
  }

  function receiptSourceLabel(receipt: BardWikiReceiptSummary): string {
    return language.bardWiki.receiptSource(receipt.userMessageId, receipt.assistantMessageId)
  }

  function confirmDiscard(): boolean {
    if (!documentDirty && documentMutationState !== 'queued') return true
    return globalThis.confirm(language.bardWiki.discardUnsavedConfirm)
  }

  function requestClose(): void {
    if (confirmDiscard()) close()
  }

  function beginCreate(): void {
    if (!confirmDiscard()) return
    selectedDocumentId = null
    documentRequest += 1
    versionsRequest += 1
    versionsVisible = false
    documentDraft = emptyDocumentDraft()
    documentBaseline = JSON.stringify(documentDraft)
    editorMode = 'create'
    documentLoadState = 'ready'
    documentMutationState = 'idle'
    documentMutationError = ''
  }

  async function selectDocument(documentId: string, force = false): Promise<void> {
    if (!force && selectedDocumentId !== documentId && !confirmDiscard()) return
    const request = ++documentRequest
    const targetChatId = chatId
    selectedDocumentId = documentId
    editorMode = 'idle'
    versionsVisible = false
    versionsRequest += 1
    versionsLoadState = 'idle'
    documentLoadState = 'loading'
    documentLoadError = ''
    documentMutationState = 'idle'
    documentMutationError = ''
    const result = await loadBardWikiDocumentResource(targetChatId, documentId)
    if (request !== documentRequest || targetChatId !== chatId || selectedDocumentId !== documentId) return
    if (result.status === 'ok') {
      documentLoadState = 'ready'
      adoptDocumentDraft(result.document)
      return
    }
    const failure = readFailure(result)
    documentLoadState = failure.state
    documentLoadError = failure.error
  }

  async function toggleVersions(): Promise<void> {
    versionsVisible = !versionsVisible
    if (!versionsVisible || !selectedDocumentId || versionsResource) return
    const request = ++versionsRequest
    const targetChatId = chatId
    const targetDocumentId = selectedDocumentId
    versionsLoadState = 'loading'
    versionsLoadError = ''
    const result = await loadBardWikiVersionsResource(targetChatId, targetDocumentId)
    if (
      request !== versionsRequest ||
      targetChatId !== chatId ||
      selectedDocumentId !== targetDocumentId ||
      !versionsVisible
    ) {
      return
    }
    if (result.status === 'ok') {
      versionsLoadState = 'ready'
      return
    }
    const failure = readFailure(result)
    versionsLoadState = failure.state
    versionsLoadError = failure.error
  }

  async function settleDocumentMutation(
    sequence: number,
    final: BardWikiMutationFinalOutcome,
    preferredDocumentId: string | null,
  ): Promise<void> {
    if (sequence !== documentMutationSequence) return
    if (final.status === 'failed') {
      documentMutationState = 'failed'
      documentMutationError = mutationFailureMessage(final.result)
      return
    }
    const loaded = await loadChat(false)
    if (sequence !== documentMutationSequence || !loaded) return
    const targetId =
      preferredDocumentId ??
      chatResource?.documents.find(
        (document) => document.logicalPath === documentDraft.logicalPath || document.title === documentDraft.title,
      )?.id ??
      null
    if (targetId) await selectDocument(targetId, true)
    else resetEditor()
    if (sequence === documentMutationSequence) documentMutationState = 'accepted'
  }

  function trackQueuedDocumentMutation(
    sequence: number,
    outcome: Extract<BardWikiMutationOutcome, { status: 'queued' }>,
    preferredDocumentId: string | null,
  ): void {
    documentMutationState = 'queued'
    documentMutationError = ''
    void outcome.settlement.then((final) => settleDocumentMutation(sequence, final, preferredDocumentId))
  }

  async function saveDocument(): Promise<void> {
    if (documentMutationPending) return
    if (!documentDraft.title.trim() || !documentDraft.logicalPath.trim()) {
      documentMutationState = 'failed'
      documentMutationError = language.bardWiki.requiredFields
      return
    }
    const sequence = ++documentMutationSequence
    const payload = {
      kind: documentDraft.kind,
      title: documentDraft.title.trim(),
      logicalPath: documentDraft.logicalPath.trim(),
      aliases: documentDraft.aliases
        .split(',')
        .map((alias) => alias.trim())
        .filter(Boolean),
      contextPolicy: documentDraft.contextPolicy,
      reviewState: documentDraft.reviewState,
      markdown: documentDraft.markdown,
    }
    documentMutationState = 'saving'
    documentMutationError = ''

    let outcome: BardWikiMutationOutcome<{ document: BardWikiDocument }>
    if (editorMode === 'create') {
      outcome = await createBardWikiDocument(chatId, payload)
    } else if (selectedDocumentId && documentResource) {
      outcome = await updateBardWikiDocument(
        chatId,
        selectedDocumentId,
        {
          expectedVersion: documentResource.document.version,
          expectedContentHash: documentResource.document.contentHash,
        },
        payload,
      )
    } else {
      documentMutationState = 'failed'
      documentMutationError = language.bardWiki.documentLoadFailed
      return
    }
    if (sequence !== documentMutationSequence) return
    if (outcome.status === 'accepted') {
      await settleDocumentMutation(sequence, { status: 'accepted' }, outcome.result.document.id)
    } else if (outcome.status === 'queued') {
      trackQueuedDocumentMutation(sequence, outcome, selectedDocumentId)
    } else if (outcome.status === 'conflict') {
      documentMutationState = 'conflict'
      documentMutationError = language.bardWiki.conflictMessage
    } else {
      documentMutationState = 'failed'
      documentMutationError = mutationFailureMessage(outcome.result)
    }
  }

  async function deleteDocument(): Promise<void> {
    if (!selectedDocumentId || !documentResource || documentMutationPending) return
    if (!globalThis.confirm(language.bardWiki.deleteConfirm(documentResource.document.title))) return
    const sequence = ++documentMutationSequence
    const targetDocumentId = selectedDocumentId
    documentMutationState = 'saving'
    documentMutationError = ''
    const outcome = await deleteBardWikiDocument(chatId, targetDocumentId, {
      expectedVersion: documentResource.document.version,
      expectedContentHash: documentResource.document.contentHash,
    })
    if (sequence !== documentMutationSequence) return
    if (outcome.status === 'accepted') {
      await settleDocumentMutation(sequence, { status: 'accepted' }, null)
    } else if (outcome.status === 'queued') {
      trackQueuedDocumentMutation(sequence, outcome, null)
    } else if (outcome.status === 'conflict') {
      documentMutationState = 'conflict'
      documentMutationError = language.bardWiki.conflictMessage
    } else {
      documentMutationState = 'failed'
      documentMutationError = mutationFailureMessage(outcome.result)
    }
  }

  async function retryConflict(): Promise<void> {
    if (!selectedDocumentId) return
    const draft = { ...documentDraft }
    const result = await loadBardWikiDocumentResource(chatId, selectedDocumentId)
    if (result.status !== 'ok') {
      documentMutationState = 'failed'
      documentMutationError = readFailure(result).error
      return
    }
    documentLoadState = 'ready'
    documentDraft = draft
    documentMutationState = 'idle'
    await saveDocument()
  }

  async function discardAndReload(): Promise<void> {
    if (!selectedDocumentId) return
    await selectDocument(selectedDocumentId, true)
  }

  async function saveChatSettings(): Promise<void> {
    if (settingsMutationPending) return
    const totalBudget = totalTokenBudgetOverrideDraft.trim()
    if (
      totalBudget &&
      (!Number.isInteger(Number(totalBudget)) || Number(totalBudget) < 0 || Number(totalBudget) > 32768)
    ) {
      settingsMutationState = 'failed'
      settingsMutationError = language.bardWiki.invalidBudget
      return
    }
    const sequence = ++settingsMutationSequence
    settingsMutationState = 'saving'
    settingsMutationError = ''
    const outcome = await saveBardWikiChatSettings(chatId, {
      enabledOverride: enabledOverrideDraft === 'inherit' ? null : enabledOverrideDraft === 'enabled',
      memoryModeOverride: memoryModeOverrideDraft === 'inherit' ? null : memoryModeOverrideDraft,
      totalTokenBudgetOverride: totalBudget === '' ? null : Number(totalBudget),
    })
    if (sequence !== settingsMutationSequence) return
    if (outcome.status === 'accepted') {
      await loadChat(false)
      settingsMutationState = 'accepted'
    } else if (outcome.status === 'queued') {
      settingsMutationState = 'queued'
      void outcome.settlement.then(async (final) => {
        if (sequence !== settingsMutationSequence) return
        if (final.status === 'accepted') {
          await loadChat(false)
          settingsMutationState = 'accepted'
        } else {
          settingsMutationState = 'failed'
          settingsMutationError = mutationFailureMessage(final.result)
        }
      })
    } else if (outcome.status === 'conflict') {
      settingsMutationState = 'conflict'
      settingsMutationError = language.bardWiki.settingsConflict
    } else {
      settingsMutationState = 'failed'
      settingsMutationError = mutationFailureMessage(outcome.result)
    }
  }

  function mutationStatusText(state: MutationState, error: string): string {
    if (state === 'saving') return language.bardWiki.saving
    if (state === 'accepted') return language.bardWiki.accepted
    if (state === 'queued') return language.bardWiki.queued
    if (state === 'conflict') return error || language.bardWiki.conflictMessage
    if (state === 'failed') return error || language.bardWiki.mutationFailed
    return ''
  }

  function handleDialogKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    requestClose()
  }

  $effect(() => {
    chatId
    documentMutationSequence += 1
    settingsMutationSequence += 1
    settingsMutationState = 'idle'
    jobActionError = ''
    jobActionInstanceIds = new Set()
    void loadChat()
  })

  const unsubscribeBardWikiJobs = subscribeServerBardWikiJobEvents(
    (event) => {
      if (event.chatId === chatId) void loadChat(false)
    },
    () => {
      if (chatLoadState === 'ready') void loadChat(false)
    },
  )

  onDestroy(unsubscribeBardWikiJobs)
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  use:modalBackdropDismiss={requestClose}
  data-modal-root
  data-testid="bardwiki-workspace-dialog-root"
  class="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-2 sm:p-4">
  <div
    use:modalFocusTrap
    role="dialog"
    aria-modal="true"
    aria-labelledby="bardwiki-workspace-title"
    tabindex="-1"
    onkeydown={handleDialogKeydown}
    class="flex h-[min(52rem,calc(100dvh-1rem))] w-full max-w-6xl flex-col overflow-hidden rounded-md border border-darkborderc bg-darkbg text-textcolor sm:h-[min(52rem,calc(100dvh-2rem))]">
    <header class="flex items-start gap-3 border-b border-darkborderc p-4">
      <BookOpenIcon class="mt-1 shrink-0" aria-hidden="true" />
      <div class="min-w-0 grow">
        <h2 id="bardwiki-workspace-title" class="m-0 text-lg">{language.bardWiki.workspaceTitle}</h2>
        <p class="m-0 text-sm text-textcolor2">{language.bardWiki.workspaceDescription}</p>
      </div>
      <button
        type="button"
        disabled={documentMutationPending}
        class="flex items-center gap-2 rounded-md border border-darkborderc px-3 py-2 hover:bg-selected disabled:opacity-50"
        onclick={beginCreate}><PlusIcon size={18} />{language.bardWiki.newDocument}</button>
      <button
        data-modal-initial-focus
        type="button"
        aria-label={language.close}
        class="rounded-md p-2 text-textcolor2 transition-colors hover:bg-selected hover:text-textcolor"
        onclick={requestClose}><XIcon /></button>
    </header>

    {#if chatLoadState === 'loading' || chatLoadState === 'idle'}
      <div class="flex grow items-center justify-center" role="status" aria-live="polite">{language.loading}</div>
    {:else if chatLoadState === 'error' || chatLoadState === 'unavailable'}
      <div class="flex grow flex-col items-center justify-center gap-3 p-6 text-center" role="alert">
        <p>{chatLoadError || language.bardWiki.loadFailed}</p>
        <button
          type="button"
          aria-label={language.bardWiki.retryLoad}
          class="flex items-center gap-2 rounded-md border border-darkborderc px-3 py-2 hover:bg-selected"
          onclick={() => void loadChat()}><RotateCcwIcon size={18} />{language.retry}</button>
      </div>
    {:else if chatResource}
      <details class="border-b border-darkborderc px-4 py-2">
        <summary class="cursor-pointer font-medium">{language.bardWiki.chatOverrides}</summary>
        <div class="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label class="flex flex-col gap-1">
            <span>{language.bardWiki.enabledForChat}</span>
            <select
              class="rounded-md border border-darkborderc bg-darkbg p-2"
              value={enabledOverrideDraft}
              onchange={(event) => (enabledOverrideDraft = event.currentTarget.value as typeof enabledOverrideDraft)}>
              <option value="inherit">{language.bardWiki.inherit}</option>
              <option value="enabled">{language.bardWiki.enabled}</option>
              <option value="disabled">{language.bardWiki.disabled}</option>
            </select>
          </label>
          <label class="flex flex-col gap-1">
            <span>{language.bardWiki.memoryMode}</span>
            <select
              class="rounded-md border border-darkborderc bg-darkbg p-2"
              value={memoryModeOverrideDraft}
              onchange={(event) =>
                (memoryModeOverrideDraft = event.currentTarget.value as typeof memoryModeOverrideDraft)}>
              <option value="inherit">{language.bardWiki.inherit}</option>
              <option value="hypa">{language.bardWiki.modeHypa}</option>
              <option value="bardwiki">{language.bardWiki.modeBardWiki}</option>
              <option value="hybrid">{language.bardWiki.modeHybrid}</option>
            </select>
          </label>
          <label class="flex flex-col gap-1">
            <span>{language.bardWiki.totalTokenBudgetOverride}</span>
            <input
              type="number"
              min="0"
              max="32768"
              class="rounded-md border border-darkborderc bg-transparent p-2"
              placeholder={language.bardWiki.inherit}
              value={totalTokenBudgetOverrideDraft}
              oninput={(event) => (totalTokenBudgetOverrideDraft = event.currentTarget.value)} />
          </label>
        </div>
        <div class="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={settingsMutationPending}
            aria-busy={settingsMutationState === 'saving'}
            class="rounded-md border border-darkborderc px-3 py-2 hover:bg-selected disabled:opacity-50"
            onclick={() => void saveChatSettings()}>{language.bardWiki.saveOverrides}</button>
          <span class="text-sm text-textcolor2" role="status" aria-live="polite"
            >{mutationStatusText(settingsMutationState, settingsMutationError)}</span>
        </div>
      </details>

      <details
        data-testid="bardwiki-activity"
        open={chatResource.jobs.some((job) => isActiveJob(job) || job.status === 'failed')}
        class="border-b border-darkborderc px-4 py-2">
        <summary class="cursor-pointer font-medium">{language.bardWiki.activity}</summary>
        <div class="mt-3 grid gap-4 lg:grid-cols-2">
          <section aria-labelledby="bardwiki-receipts-heading">
            <h3 id="bardwiki-receipts-heading" class="m-0 text-sm font-semibold">{language.bardWiki.receipts}</h3>
            {#if chatResource.receipts.length === 0}
              <p class="text-sm text-textcolor2">{language.bardWiki.noReceipts}</p>
            {:else}
              <ul class="m-0 mt-2 flex list-none flex-col gap-2 p-0">
                {#each chatResource.receipts as receipt (receipt.id)}
                  <li class="rounded-md border border-darkborderc p-2 text-sm">
                    <div class="flex flex-wrap items-center justify-between gap-2">
                      <span>{receiptSourceLabel(receipt)}</span>
                      <span class="text-textcolor2">{language.bardWiki.receiptStates[receipt.state]}</span>
                    </div>
                    {#if receipt.errorSummary}
                      <p class="mb-0 text-red-400" role="alert">{receipt.errorSummary}</p>
                    {/if}
                  </li>
                {/each}
              </ul>
            {/if}
          </section>

          <section aria-labelledby="bardwiki-jobs-heading">
            <div class="flex items-center justify-between gap-2">
              <h3 id="bardwiki-jobs-heading" class="m-0 text-sm font-semibold">{language.bardWiki.jobs}</h3>
              <button
                type="button"
                class="rounded-md border border-darkborderc px-2 py-1 text-sm hover:bg-selected"
                onclick={() => void loadChat(false)}>{language.bardWiki.refreshStatus}</button>
            </div>
            {#if chatResource.jobs.length === 0}
              <p class="text-sm text-textcolor2">{language.bardWiki.noJobs}</p>
            {:else}
              <ul class="m-0 mt-2 flex list-none flex-col gap-2 p-0">
                {#each chatResource.jobs as job (job.instanceId)}
                  <li class="rounded-md border border-darkborderc p-2 text-sm" data-job-instance={job.instanceId}>
                    <div class="flex flex-wrap items-center justify-between gap-2">
                      <span>{language.bardWiki.jobKinds[job.kind]}</span>
                      <span class="text-textcolor2">{language.bardWiki.jobStatuses[job.status]}</span>
                    </div>
                    <p class="my-1 text-xs text-textcolor2">
                      {language.bardWiki.jobAttempt(job.attemptCount, job.maxAttempts)} · {jobUpdatedLabel(job)}
                    </p>
                    {#if job.errorSummary}
                      <p class="my-1 text-red-400" role="alert">{job.errorSummary}</p>
                    {/if}
                    {#if job.status === 'failed'}
                      <button
                        type="button"
                        disabled={jobActionInstanceIds.has(job.instanceId)}
                        class="mt-1 rounded-md border border-darkborderc px-2 py-1 hover:bg-selected disabled:opacity-50"
                        onclick={() => void mutateJob(job, 'retry')}>{language.bardWiki.retryJob}</button>
                    {:else if isActiveJob(job)}
                      <button
                        type="button"
                        disabled={jobActionInstanceIds.has(job.instanceId)}
                        class="mt-1 rounded-md border border-darkborderc px-2 py-1 hover:bg-selected disabled:opacity-50"
                        onclick={() => void mutateJob(job, 'cancel')}>{language.bardWiki.cancelJob}</button>
                    {/if}
                  </li>
                {/each}
              </ul>
            {/if}
            {#if jobActionError}
              <p class="mb-0 text-sm text-red-400" role="alert">{jobActionError}</p>
            {/if}
          </section>
        </div>
      </details>

      <div class="grid min-h-0 grow grid-cols-1 md:grid-cols-[minmax(13rem,18rem)_1fr]">
        <aside class="flex min-h-0 flex-col border-b border-darkborderc md:border-r md:border-b-0">
          <div class="flex items-center justify-between gap-3 p-3">
            <h3 class="m-0 text-base">{language.bardWiki.documents}</h3>
            <span class="text-xs text-textcolor2">{chatResource.documents.length}</span>
          </div>
          {#if chatResource.documents.length === 0}
            <p class="p-4 text-sm text-textcolor2">{language.bardWiki.emptyDocuments}</p>
          {:else}
            <ul
              class="m-0 flex max-h-48 list-none flex-col overflow-y-auto p-2 md:max-h-none md:grow"
              aria-label={language.bardWiki.documents}>
              {#each chatResource.documents as document (document.id)}
                <li>
                  <button
                    type="button"
                    aria-label={language.bardWiki.openDocument(document.title)}
                    aria-pressed={selectedDocumentId === document.id}
                    class="w-full rounded-md p-2 text-left transition-colors hover:bg-selected"
                    class:bg-selected={selectedDocumentId === document.id}
                    onclick={() => void selectDocument(document.id)}>
                    <span class="block truncate font-medium">{document.title}</span>
                    <span class="block truncate text-xs text-textcolor2">{document.logicalPath}</span>
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        </aside>

        <main class="min-h-0 overflow-y-auto p-4">
          {#if editorMode === 'idle' && selectedDocumentId === null}
            <p class="text-textcolor2">{language.bardWiki.noDocumentSelected}</p>
          {:else if documentLoadState === 'loading'}
            <p role="status" aria-live="polite">{language.bardWiki.documentLoading}</p>
          {:else if documentLoadState === 'error' || documentLoadState === 'unavailable'}
            <div role="alert">
              <p>{documentLoadError || language.bardWiki.documentLoadFailed}</p>
              <button
                class="rounded-md border border-darkborderc px-3 py-2 hover:bg-selected"
                onclick={() => selectedDocumentId && void selectDocument(selectedDocumentId, true)}
                >{language.retry}</button>
            </div>
          {:else if editorMode !== 'idle'}
            <form
              class="flex flex-col gap-4"
              data-testid="bardwiki-document-detail"
              onsubmit={(event) => {
                event.preventDefault()
                void saveDocument()
              }}>
              <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label class="flex flex-col gap-1">
                  <span>{language.bardWiki.documentTitle}</span>
                  <input
                    class="rounded-md border border-darkborderc bg-transparent p-2"
                    required
                    bind:value={documentDraft.title} />
                </label>
                <label class="flex flex-col gap-1">
                  <span>{language.bardWiki.logicalPath}</span>
                  <input
                    class="rounded-md border border-darkborderc bg-transparent p-2"
                    required
                    bind:value={documentDraft.logicalPath} />
                </label>
                <label class="flex flex-col gap-1">
                  <span>{language.bardWiki.kind}</span>
                  <select class="rounded-md border border-darkborderc bg-darkbg p-2" bind:value={documentDraft.kind}>
                    {#each DOCUMENT_KINDS as kind}
                      <option value={kind}>{language.bardWiki.documentKinds[kind]}</option>
                    {/each}
                  </select>
                </label>
                <label class="flex flex-col gap-1">
                  <span>{language.bardWiki.aliases}</span>
                  <input
                    class="rounded-md border border-darkborderc bg-transparent p-2"
                    placeholder={language.bardWiki.aliasesHint}
                    bind:value={documentDraft.aliases} />
                </label>
                <label class="flex flex-col gap-1">
                  <span>{language.bardWiki.contextPolicy}</span>
                  <select
                    class="rounded-md border border-darkborderc bg-darkbg p-2"
                    bind:value={documentDraft.contextPolicy}>
                    {#each CONTEXT_POLICIES as policy}
                      <option value={policy}>{language.bardWiki.contextPolicies[policy]}</option>
                    {/each}
                  </select>
                </label>
                <label class="flex flex-col gap-1">
                  <span>{language.bardWiki.reviewState}</span>
                  <select
                    class="rounded-md border border-darkborderc bg-darkbg p-2"
                    bind:value={documentDraft.reviewState}>
                    {#each REVIEW_STATES as state}
                      <option value={state}>{language.bardWiki.reviewStates[state]}</option>
                    {/each}
                  </select>
                </label>
              </div>
              <label class="flex flex-col gap-1">
                <span>{language.bardWiki.markdownSource}</span>
                <textarea
                  class="min-h-64 w-full resize-y rounded-md border border-darkborderc bg-transparent p-3 font-mono text-sm"
                  bind:value={documentDraft.markdown}></textarea>
              </label>

              {#if documentMutationState === 'conflict'}
                <div class="rounded-md border border-yellow-500 p-3" role="alert">
                  <p class="mt-0">{documentMutationError}</p>
                  <div class="flex flex-wrap gap-2">
                    <button
                      type="button"
                      class="rounded-md border border-darkborderc px-3 py-2 hover:bg-selected"
                      onclick={() => void retryConflict()}>{language.bardWiki.keepDraftAndRetry}</button>
                    <button
                      type="button"
                      class="rounded-md border border-darkborderc px-3 py-2 hover:bg-selected"
                      onclick={() => void discardAndReload()}>{language.bardWiki.discardAndReload}</button>
                  </div>
                </div>
              {/if}

              <div class="flex flex-wrap items-center gap-2">
                <button
                  type="submit"
                  disabled={documentMutationPending || !documentDirty}
                  aria-busy={documentMutationState === 'saving'}
                  class="rounded-md border border-darkborderc px-3 py-2 hover:bg-selected disabled:opacity-50"
                  >{editorMode === 'create' ? language.bardWiki.createDocument : language.save}</button>
                {#if editorMode === 'edit'}
                  <button
                    type="button"
                    disabled={documentMutationPending}
                    class="flex items-center gap-2 rounded-md border border-red-500 px-3 py-2 text-red-400 hover:bg-red-500 hover:text-white disabled:opacity-50"
                    onclick={() => void deleteDocument()}><Trash2Icon size={18} />{language.remove}</button>
                  <button
                    type="button"
                    aria-expanded={versionsVisible}
                    class="flex items-center gap-2 rounded-md border border-darkborderc px-3 py-2 hover:bg-selected"
                    onclick={() => void toggleVersions()}
                    ><HistoryIcon size={18} />{versionsVisible
                      ? language.bardWiki.hideVersions
                      : language.bardWiki.showVersions}</button>
                {/if}
                <span class="text-sm text-textcolor2" role="status" aria-live="polite"
                  >{mutationStatusText(documentMutationState, documentMutationError)}</span>
              </div>

              {#if versionsVisible}
                <section aria-label={language.bardWiki.versions}>
                  <h4>{language.bardWiki.versions}</h4>
                  {#if versionsLoadState === 'loading'}
                    <p role="status" aria-live="polite">{language.bardWiki.versionsLoading}</p>
                  {:else if versionsLoadState === 'error' || versionsLoadState === 'unavailable'}
                    <p role="alert">{versionsLoadError || language.bardWiki.versionsLoadFailed}</p>
                  {:else if versionsResource?.versions.length === 0}
                    <p class="text-textcolor2">{language.bardWiki.emptyVersions}</p>
                  {:else if versionsResource}
                    <ol class="flex flex-col gap-2 pl-5">
                      {#each versionsResource.versions as version (version.version)}
                        <li>
                          <details>
                            <summary class="cursor-pointer"
                              >{language.bardWiki.versionLabel(version.version)} · {language.bardWiki.versionActors[
                                version.actor
                              ]} · {language.bardWiki.versionReasons[version.reason]}</summary>
                            <pre
                              class="mt-2 max-w-full overflow-x-auto whitespace-pre-wrap rounded-md border border-darkborderc bg-bgcolor p-3 text-sm">{version.markdown}</pre>
                          </details>
                        </li>
                      {/each}
                    </ol>
                  {/if}
                </section>
              {/if}
            </form>
          {/if}
        </main>
      </div>
    {/if}
  </div>
</div>
