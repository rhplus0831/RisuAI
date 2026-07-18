<script lang="ts">
  import { Maximize2Icon } from '@lucide/svelte'
  import { onDestroy, onMount, tick } from 'svelte'

  import { language } from 'src/lang'
  import { hotkeyMatches } from 'src/ts/hotkey'
  import {
    closePopupEditorSession,
    isPopupEditorSessionCurrent,
    openPopupEditorSession,
    popUpEditorStore,
  } from 'src/ts/stores.svelte'
  import { longpress } from 'src/ts/gui/longtouch'
  import { sleep } from 'src/ts/util'
  import { getResourceDatabase as getDatabase } from 'src/ts/server/resourceState.svelte'

  let textarea: HTMLTextAreaElement = $state()
  let previousScrollHeight = 0
  let resizeRequest = 0
  let openingPopupEditor = false
  let popupEditorRun = 0
  let activePopupEditorSessionId: number | null = null
  interface Props {
    value?: string
    handleLongPress?: any
    onchange?: () => void
    popupEditor?: boolean
    popupLanguage?: string
    stableHeight?: boolean
    ariaLabel?: string
  }

  let {
    value = $bindable(''),
    handleLongPress = (e: MouseEvent) => {},
    onchange = () => {},
    popupEditor = false,
    popupLanguage = 'markdown',
    stableHeight = false,
    ariaLabel = language.messageInput,
  }: Props = $props()

  function resize() {
    if (!textarea || stableHeight) return
    textarea.style.height = '0px' // Reset the textarea height
    textarea.style.height = `calc(${textarea.scrollHeight}px + 1rem)` // Set the new height
  }

  function handleInput() {
    if (!textarea || stableHeight) return
    if (textarea.scrollHeight !== previousScrollHeight) {
      previousScrollHeight = textarea.scrollHeight
      resize()
    }
  }

  async function openPopupEditor() {
    if (!popupEditor || openingPopupEditor) return
    const run = ++popupEditorRun
    const initialValue = value
    openingPopupEditor = true
    const sessionId = openPopupEditorSession(value, popupLanguage)
    activePopupEditorSessionId = sessionId

    try {
      while (
        run === popupEditorRun &&
        value === initialValue &&
        isPopupEditorSessionCurrent(sessionId) &&
        popUpEditorStore.open
      ) {
        await sleep(100)
      }

      if (run !== popupEditorRun || value !== initialValue) {
        closePopupEditorSession(sessionId)
        return
      }
      if (!isPopupEditorSessionCurrent(sessionId)) return
      value = popUpEditorStore.value
      onchange()
      await tick()
      resize()
    } finally {
      if (activePopupEditorSessionId === sessionId) activePopupEditorSessionId = null
      openingPopupEditor = false
    }
  }

  onMount(() => {
    resize()
  })

  onDestroy(() => {
    popupEditorRun += 1
    if (activePopupEditorSessionId !== null) {
      closePopupEditorSession(activePopupEditorSessionId)
      activePopupEditorSessionId = null
    }
    resizeRequest += 1
  })

  $effect(() => {
    value
    const request = ++resizeRequest

    tick().then(() => {
      if (request !== resizeRequest || !textarea) return
      previousScrollHeight = textarea.scrollHeight
      resize()
    })
  })
</script>

<div class="relative w-full">
  <textarea
    aria-label={ariaLabel}
    bind:this={textarea}
    oninput={handleInput}
    onkeydown={(e) => {
      if (
        popupEditor &&
        (e.ctrlKey || e.shiftKey || e.altKey) &&
        hotkeyMatches(
          getDatabase().hotkeys.find((hk) => hk.action === 'popupEditor'),
          e,
        )
      ) {
        e.preventDefault()
        void openPopupEditor()
      }
    }}
    use:longpress={handleLongPress}
    bind:value
    class="rounded-md p-2 text-textcolor bg-transparent resize-none border border-darkborderc w-full message-edit-area"
    class:overflow-y-auto={stableHeight}
    class:overflow-y-hidden={!stableHeight}
    class:pr-10={popupEditor}
    style:height={stableHeight ? '16rem' : undefined}
    style:min-height={stableHeight ? '12rem' : undefined}
    style:max-height={stableHeight ? '60vh' : undefined}
    style:font-size="{0.875 * (getDatabase().zoomsize / 100)}rem"
    style:line-height="{(getDatabase().lineHeight ?? 1.25) * (getDatabase().zoomsize / 100)}rem"></textarea>

  {#if popupEditor}
    <button
      type="button"
      class="absolute right-1 top-1 z-10 flex h-7 w-7 items-center justify-center rounded-md text-textcolor2 transition-colors hover:bg-darkbutton hover:text-textcolor focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-borderc"
      aria-label={language.hotkeyDesc.popupEditor}
      title={language.hotkeyDesc.popupEditor}
      onclick={() => {
        void openPopupEditor()
      }}>
      <Maximize2Icon size={16} />
    </button>
  {/if}
</div>
