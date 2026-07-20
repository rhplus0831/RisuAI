<script lang="ts">
  import { XIcon } from '@lucide/svelte'
  import { language } from 'src/lang'
  import type { InputHook } from 'src/ts/storage/database.svelte'
  import { modalFocusTrap } from 'src/ts/gui/modalFocusTrap'

  interface Props {
    kind: 'draft' | 'btw'
    hooks: InputHook[]
    selectedId?: string
    close: () => void
    select: (hook: InputHook | null) => void | Promise<void>
  }

  let { kind, hooks, selectedId, close, select }: Props = $props()

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    close()
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  data-modal-root
  data-testid="default-chat-input-hook-dialog"
  class="fixed inset-0 z-[60] flex items-center justify-center bg-black/50"
  onclick={(event) => event.target === event.currentTarget && close()}>
  <div
    use:modalFocusTrap
    class="flex max-h-full min-w-72 max-w-[calc(100vw-2rem)] flex-col overflow-y-auto rounded-md bg-darkbg p-4 text-textcolor"
    role="dialog"
    aria-modal="true"
    aria-labelledby="default-chat-input-hook-dialog-title"
    tabindex="-1"
    onkeydown={handleKeydown}>
    <div class="mb-3 flex items-center gap-4">
      <h2 id="default-chat-input-hook-dialog-title" class="m-0 text-lg">
        {kind === 'draft' ? language.inputHookDraftDialogTitle : language.inputHookBtwDialogTitle}
      </h2>
      <button
        data-modal-initial-focus
        type="button"
        class="ml-auto text-textcolor2 transition-colors hover:text-green-500"
        aria-label={language.close}
        onclick={close}>
        <XIcon size={22} />
      </button>
    </div>

    {#if kind === 'draft'}
      <button
        type="button"
        data-testid="default-chat-input-hook-option-none"
        aria-pressed={!selectedId}
        class="w-full border-t border-darkborderc p-2 text-left transition-colors hover:bg-selected"
        onclick={() => select(null)}>
        {language.inputHookNone}
      </button>
    {/if}
    {#each hooks as hook (hook.id)}
      <button
        type="button"
        data-testid={`default-chat-input-hook-option-${hook.id}`}
        aria-pressed={kind === 'draft' && selectedId === hook.id}
        class="w-full border-t border-darkborderc p-2 text-left transition-colors hover:bg-selected"
        onclick={() => select(hook)}>
        {hook.name}
      </button>
    {/each}
  </div>
</div>
