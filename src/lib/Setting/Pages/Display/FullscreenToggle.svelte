<script lang="ts">
  import { onMount } from 'svelte'
  import { language } from 'src/lang'
  import Check from 'src/lib/UI/GUI/CheckInput.svelte'
  import { toggleFullscreen } from 'src/ts/globalApi.svelte'

  let fullscreen = $state(false)
  let transitionPending = false

  function syncFromBrowser(): void {
    fullscreen = document.fullscreenElement !== null
  }

  async function requestFullscreenState(enabled: boolean): Promise<void> {
    if (transitionPending) {
      syncFromBrowser()
      return
    }

    transitionPending = true
    fullscreen = enabled
    try {
      await toggleFullscreen(enabled)
    } catch {
      // The browser remains authoritative when a gesture or permission check rejects.
    } finally {
      transitionPending = false
      syncFromBrowser()
    }
  }

  onMount(() => {
    syncFromBrowser()
    document.addEventListener('fullscreenchange', syncFromBrowser)
    document.addEventListener('fullscreenerror', syncFromBrowser)

    return () => {
      document.removeEventListener('fullscreenchange', syncFromBrowser)
      document.removeEventListener('fullscreenerror', syncFromBrowser)
    }
  })
</script>

<div class="flex items-center mt-2">
  <Check check={fullscreen} name={language.fullscreen} onChange={requestFullscreenState} />
</div>
