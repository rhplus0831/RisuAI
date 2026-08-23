<script lang="ts">
  import { onDestroy, type Component } from 'svelte'
  import { language } from 'src/lang'
  import { modalFocusTrap } from 'src/ts/gui/modalFocusTrap'
  import { lazyModalFocusOrigin } from 'src/ts/gui/lazyModalFocusOrigin'

  export type LazyComponentLoader = () => Promise<{ default: Component<any> }>

  interface Props {
    loader: LazyComponentLoader
    componentProps?: Record<string, unknown>
    modal?: boolean
    label?: string
    fill?: boolean
    onDismiss?: () => void
    testId?: string
  }

  type LazyComponentState =
    | { kind: 'idle' | 'pending' }
    | { kind: 'ready'; component: Component<any> }
    | { kind: 'error'; error: unknown }

  let {
    loader,
    componentProps = {},
    modal = false,
    label = language.loading,
    fill = false,
    onDismiss,
    testId = 'lazy-component',
  }: Props = $props()

  let loadState = $state<LazyComponentState>({ kind: 'idle' })
  let activeLoader = $state<LazyComponentLoader | null>(null)
  let retryButton = $state<HTMLButtonElement | null>(null)
  let attempt = 0

  function loadComponent(targetLoader: LazyComponentLoader): void {
    const currentAttempt = ++attempt
    loadState = { kind: 'pending' }
    void targetLoader().then(
      (module) => {
        if (currentAttempt !== attempt) return
        loadState = { kind: 'ready', component: module.default }
      },
      (error: unknown) => {
        if (currentAttempt !== attempt) return
        loadState = { kind: 'error', error }
      },
    )
  }

  function retry(): void {
    loadComponent(loader)
  }

  function handleModalKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || !onDismiss) return
    event.preventDefault()
    event.stopPropagation()
    onDismiss()
  }

  let errorMessage = $derived(
    typeof navigator !== 'undefined' && navigator.onLine === false
      ? language.preloadOfflineError
      : language.preloadStaleError,
  )

  $effect(() => {
    const targetLoader = loader
    if (activeLoader === targetLoader) return
    activeLoader = targetLoader
    loadComponent(targetLoader)
  })

  $effect(() => {
    if (loadState.kind !== 'error' || !retryButton) return
    queueMicrotask(() => {
      if (loadState.kind === 'error' && retryButton?.isConnected) retryButton.focus()
    })
  })

  onDestroy(() => {
    attempt += 1
  })
</script>

<div class:contents={!modal} class:h-full={fill} class:w-full={fill} use:lazyModalFocusOrigin={modal}>
  {#if loadState.kind === 'ready'}
    {@const LoadedComponent = loadState.component}
    <LoadedComponent {...componentProps} />
  {:else if modal}
    <div
      data-modal-root
      data-testid={`${testId}-${loadState.kind}`}
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        use:modalFocusTrap
        role="dialog"
        aria-modal="true"
        aria-label={label}
        aria-busy={loadState.kind === 'pending'}
        tabindex="-1"
        class="flex min-h-32 w-full max-w-md flex-col items-center justify-center gap-3 rounded-md border border-darkborderc bg-bgcolor p-6 text-center text-textcolor2"
        onkeydown={handleModalKeydown}>
        {#if loadState.kind === 'pending'}
          <div role="status" aria-live="polite" aria-busy="true">{language.loading}</div>
        {:else}
          <p role="alert">{errorMessage}</p>
          <div class="flex gap-2">
            <button
              bind:this={retryButton}
              data-modal-initial-focus
              type="button"
              class="rounded-md border border-darkborderc px-3 py-2 text-textcolor hover:bg-selected focus:bg-selected"
              onclick={retry}>{language.retry}</button>
            {#if onDismiss}
              <button
                type="button"
                class="rounded-md border border-darkborderc px-3 py-2 text-textcolor hover:bg-selected focus:bg-selected"
                onclick={onDismiss}>{language.close}</button>
            {/if}
          </div>
        {/if}
      </div>
    </div>
  {:else}
    <div
      data-testid={`${testId}-${loadState.kind}`}
      class="flex min-h-24 w-full items-center justify-center px-6 text-center text-textcolor2"
      class:h-full={fill}
      role={loadState.kind === 'error' ? 'alert' : 'status'}
      aria-live="polite"
      aria-busy={loadState.kind === 'pending'}>
      {#if loadState.kind === 'pending'}
        <span>{language.loading}</span>
      {:else}
        <div class="flex flex-col items-center gap-3">
          <span>{errorMessage}</span>
          <button
            bind:this={retryButton}
            type="button"
            class="rounded-md border border-darkborderc px-3 py-2 text-textcolor hover:bg-selected focus:bg-selected"
            onclick={retry}>{language.retry}</button>
        </div>
      {/if}
    </div>
  {/if}
</div>
