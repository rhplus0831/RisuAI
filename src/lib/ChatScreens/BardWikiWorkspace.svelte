<script lang="ts">
  import { BookOpenIcon, HistoryIcon, RotateCcwIcon, XIcon } from '@lucide/svelte'
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

  interface Props {
    chatId: string
    close?: () => void
  }

  type LoadState = 'idle' | 'loading' | 'ready' | 'unavailable' | 'error'

  let { chatId, close = () => {} }: Props = $props()
  let chatLoadState = $state<LoadState>('idle')
  let chatLoadError = $state('')
  let selectedDocumentId = $state<string | null>(null)
  let documentLoadState = $state<LoadState>('idle')
  let documentLoadError = $state('')
  let versionsVisible = $state(false)
  let versionsLoadState = $state<LoadState>('idle')
  let versionsLoadError = $state('')
  let chatRequest = 0
  let documentRequest = 0
  let versionsRequest = 0

  let chatResource = $derived($bardWikiResource.chats[chatId] ?? null)
  let documentKey = $derived(
    selectedDocumentId === null ? null : bardWikiDocumentResourceKey(chatId, selectedDocumentId),
  )
  let documentResource = $derived(documentKey === null ? null : ($bardWikiResource.documents[documentKey] ?? null))
  let versionsResource = $derived(documentKey === null ? null : ($bardWikiResource.versions[documentKey] ?? null))

  function readFailure(result: { status: string; error?: string }): { state: LoadState; error: string } {
    if (result.status === 'unavailable') return { state: 'unavailable', error: language.bardWiki.unavailable }
    return { state: 'error', error: result.error || language.bardWiki.loadFailed }
  }

  async function loadChat(): Promise<void> {
    const request = ++chatRequest
    const targetChatId = chatId
    selectedDocumentId = null
    documentRequest += 1
    versionsRequest += 1
    documentLoadState = 'idle'
    versionsLoadState = 'idle'
    versionsVisible = false
    chatLoadState = 'loading'
    chatLoadError = ''
    const result = await loadBardWikiChatResource(targetChatId)
    if (request !== chatRequest || targetChatId !== chatId) return
    if (result.status === 'ok') {
      chatLoadState = 'ready'
      return
    }
    const failure = readFailure(result)
    chatLoadState = failure.state
    chatLoadError = failure.error
  }

  async function selectDocument(documentId: string): Promise<void> {
    const request = ++documentRequest
    const targetChatId = chatId
    selectedDocumentId = documentId
    versionsVisible = false
    versionsRequest += 1
    versionsLoadState = 'idle'
    documentLoadState = 'loading'
    documentLoadError = ''
    const result = await loadBardWikiDocumentResource(targetChatId, documentId)
    if (request !== documentRequest || targetChatId !== chatId || selectedDocumentId !== documentId) return
    if (result.status === 'ok') {
      documentLoadState = 'ready'
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

  function handleDialogKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    close()
  }

  $effect(() => {
    chatId
    void loadChat()
  })
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  use:modalBackdropDismiss={close}
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
        data-modal-initial-focus
        type="button"
        aria-label={language.close}
        class="rounded-md p-2 text-textcolor2 transition-colors hover:bg-selected hover:text-textcolor"
        onclick={close}><XIcon /></button>
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
      <div class="grid min-h-0 grow grid-cols-1 md:grid-cols-[minmax(13rem,18rem)_1fr]">
        <aside class="flex min-h-0 flex-col border-b border-darkborderc md:border-r md:border-b-0">
          <div class="flex items-center justify-between gap-3 p-3">
            <h3 class="m-0 text-base">{language.bardWiki.documents}</h3>
            <span class="text-xs text-textcolor2"
              >{language.bardWiki.enabledForChat}: {chatResource.effectiveSettings.enabledByDefault
                ? language.bardWiki.enabled
                : language.bardWiki.disabled}</span>
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
          {#if selectedDocumentId === null}
            <p class="text-textcolor2">{language.bardWiki.noDocumentSelected}</p>
          {:else if documentLoadState === 'loading'}
            <p role="status" aria-live="polite">{language.bardWiki.documentLoading}</p>
          {:else if documentLoadState === 'error' || documentLoadState === 'unavailable'}
            <div role="alert">
              <p>{documentLoadError || language.bardWiki.documentLoadFailed}</p>
              <button
                class="rounded-md border border-darkborderc px-3 py-2 hover:bg-selected"
                onclick={() => void selectDocument(selectedDocumentId!)}>{language.retry}</button>
            </div>
          {:else if documentResource}
            <article class="flex flex-col gap-4" data-testid="bardwiki-document-detail">
              <div>
                <h3 class="m-0 text-xl">{documentResource.document.title}</h3>
                <p class="m-0 text-sm text-textcolor2">{documentResource.document.logicalPath}</p>
              </div>
              <dl class="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-sm">
                <dt>{language.bardWiki.kind}</dt>
                <dd>{documentResource.document.kind}</dd>
                <dt>{language.bardWiki.contextPolicy}</dt>
                <dd>{documentResource.document.contextPolicy}</dd>
                <dt>{language.bardWiki.reviewState}</dt>
                <dd>{documentResource.document.reviewState}</dd>
                <dt>{language.bardWiki.aliases}</dt>
                <dd>{documentResource.document.aliases.join(', ') || '—'}</dd>
              </dl>
              <section>
                <h4 class="mb-2 mt-0">{language.bardWiki.markdownSource}</h4>
                <pre
                  class="max-w-full overflow-x-auto whitespace-pre-wrap rounded-md border border-darkborderc bg-bgcolor p-3 text-sm">{documentResource
                    .document.markdown}</pre>
              </section>
              <button
                type="button"
                aria-expanded={versionsVisible}
                class="flex w-fit items-center gap-2 rounded-md border border-darkborderc px-3 py-2 hover:bg-selected"
                onclick={() => void toggleVersions()}
                ><HistoryIcon size={18} />{versionsVisible
                  ? language.bardWiki.hideVersions
                  : language.bardWiki.showVersions}</button>
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
                              >{language.bardWiki.versionLabel(version.version)} · {version.actor} · {version.reason}</summary>
                            <pre
                              class="mt-2 max-w-full overflow-x-auto whitespace-pre-wrap rounded-md border border-darkborderc bg-bgcolor p-3 text-sm">{version.markdown}</pre>
                          </details>
                        </li>
                      {/each}
                    </ol>
                  {/if}
                </section>
              {/if}
            </article>
          {/if}
        </main>
      </div>
    {/if}
  </div>
</div>
