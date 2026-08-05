<script lang="ts">
  import { onDestroy, onMount, untrack } from 'svelte'
  import { closePopupEditorSession, popUpEditorStore } from '../../ts/stores.svelte'
  import { getResourceDatabase as getDatabase } from 'src/ts/server/resourceState.svelte'
  import type MonacoEditorType from './MonacoEditor.svelte'
  import { language } from 'src/lang'
  import { risuChatParser } from 'src/ts/parser/parser.svelte'
  import { tokenize } from 'src/ts/tokenizer'
  import Toggles from '../SideBars/Toggles.svelte'
  import { modalBackdropDismiss } from 'src/ts/gui/modalBackdropDismiss'
  import { modalFocusTrap } from 'src/ts/gui/modalFocusTrap'
  import { isMobile } from 'src/ts/platform'
  import Check from 'src/lib/UI/GUI/CheckInput.svelte'
  import { applyServerBackedSetting } from 'src/ts/server/settingsBridge.svelte'

  let languageMode = $state(popUpEditorStore.language || 'markdown')
  let previewing = $state(false)
  let tokens = $state(0)
  let MonacoComponent: typeof MonacoEditorType | null = $state(null)
  let showToggles = $state(false)
  let tokenCountRun = 0
  let monacoLoadPromise: Promise<void> | null = null
  let destroyed = false
  const sessionId = untrack(() => popUpEditorStore.sessionId)
  const monacoSettingKey = isMobile ? 'useMonacoEditorOnMobile' : 'useMonacoEditorOnDesktop'
  let useMonacoEditor = $state(
    untrack(() =>
      isMobile ? (getDatabase().useMonacoEditorOnMobile ?? false) : (getDatabase().useMonacoEditorOnDesktop ?? false),
    ),
  )

  function loadMonacoEditor(): void {
    if (MonacoComponent || monacoLoadPromise) return
    monacoLoadPromise = import('./MonacoEditor.svelte').then((module) => {
      if (!destroyed) MonacoComponent = module.default
    })
  }

  function setUseMonacoEditor(enabled: boolean): void {
    useMonacoEditor = enabled
    applyServerBackedSetting(monacoSettingKey, enabled)
    if (enabled) loadMonacoEditor()
  }

  function close(): void {
    closePopupEditorSession(sessionId)
  }

  function handleDialogKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    close()
  }

  let chatParserValue = $derived.by(() => {
    if (!previewing) {
      return ''
    }

    try {
      $state.snapshot(getDatabase().globalChatVariables)
    } catch (error) {}
    return risuChatParser(popUpEditorStore.value)
  })

  $effect(() => {
    const value = chatParserValue
    const run = ++tokenCountRun
    if (!previewing) {
      return
    }
    tokenize(value)
      .then((toks) => {
        if (run !== tokenCountRun) return
        tokens = toks
      })
      .catch(() => {
        if (run !== tokenCountRun) return
        tokens = 0
      })
  })

  onMount(() => {
    if (useMonacoEditor) loadMonacoEditor()
  })

  onDestroy(() => {
    destroyed = true
    tokenCountRun += 1
  })
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  use:modalBackdropDismiss={close}
  data-modal-root
  class="fixed top-0 left-0 w-full h-full bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
  <div
    use:modalFocusTrap
    class="bg-darkbg rounded-lg p-4 w-11/12 h-11/12 flex flex-col gap-2"
    role="dialog"
    aria-modal="true"
    aria-labelledby="risu-popup-editor-title"
    tabindex="-1"
    onkeydown={handleDialogKeydown}
    onclick={(e) => e.stopPropagation()}>
    <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <h2 id="risu-popup-editor-title" class="text-xl font-bold">{language.hotkeyDesc.popupEditor}</h2>
      <div class="flex flex-wrap items-center gap-2 sm:justify-end">
        {#if !previewing}
          <Check
            check={useMonacoEditor}
            name={language.monacoEditor}
            margin={false}
            className="rounded bg-bgcolor px-2 py-1 text-sm"
            onChange={setUseMonacoEditor} />
        {/if}
        {#if ['markdown', 'cbs'].includes(languageMode)}
          {#if !previewing}
            <select bind:value={languageMode} class="bg-bgcolor border-none rounded px-2 py-1 text-sm">
              <option value="markdown">Markdown</option>
              <option value="cbs" disabled>CBS</option>
            </select>
          {/if}
          <button
            class="bg-blue-500 text-white px-3 py-1 rounded hover:bg-blue-600 transition"
            onclick={() => (previewing = !previewing)}>
            {previewing ? language.edit : language.preview}
          </button>
        {:else}
          <span class="bg-bgcolor border-none rounded px-2 py-1 text-sm">{languageMode}</span>
        {/if}
        <button
          data-modal-initial-focus
          class="bg-red-500 text-white px-3 py-1 rounded hover:bg-red-600 transition"
          aria-label={language.close}
          onclick={close}>
          X
        </button>
      </div>
    </div>
    <div class="flex-1 rounded-md overflow-hidden border border-darkborderc">
      {#if previewing}
        <div class="h-full w-full flex">
          <div class="flex-1 flex flex-col gap-4 overflow-hidden">
            <div class="flex-1 overflow-y-auto overflow-x-auto max-w-full border border-darkborderc bg-bgcolor p-4">
              <pre class="m-0">{chatParserValue}</pre>
            </div>

            <div class="text-sm p-4 text-gray-500 flex overflow-x-auto">
              <button
                class={{
                  'bg-blue-500 text-white hover:bg-blue-600': showToggles,
                  'bg-gray-500 text-white hover:bg-gray-600': !showToggles,
                  'px-3 py-1 rounded transition': true,
                }}
                onclick={() => {
                  showToggles = !showToggles
                }}>{language.customPromptTemplateToggle}</button>

              <span class="ml-4">{language.tokens}: {tokens}</span>
            </div>
          </div>

          {#if showToggles}
            <div class="w-96 border-l border-darkborderc overflow-y-auto p-4">
              <Toggles noContainer />
            </div>
          {/if}
        </div>
      {:else if !useMonacoEditor}
        <textarea
          bind:value={popUpEditorStore.value}
          aria-label={language.plainTextEditor}
          class="w-full h-full resize-none bg-bgcolor text-textcolor font-mono p-4 border-none focus:outline-hidden"
        ></textarea>
      {:else if MonacoComponent}
        <MonacoComponent bind:value={popUpEditorStore.value} language={languageMode} theme="vs-dark" />
      {:else}
        <div class="flex items-center justify-center h-full text-gray-500">{language.loading}</div>
      {/if}
    </div>
  </div>
</div>
