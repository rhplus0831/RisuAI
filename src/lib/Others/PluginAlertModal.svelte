<script lang="ts">
  import { language } from 'src/lang'
  import { pluginAlertModalStore } from 'src/ts/stores.svelte'
  import { modalFocusTrap } from 'src/ts/gui/modalFocusTrap'

  const reasons: [string, string][] = $derived.by(() => {
    let v = pluginAlertModalStore.errors.map(
      (error) =>
        [
          language.pluginRisksInuserFriendly[error.userAlertKey],
          language.pluginRisksInuserFriendlyDesc[error.userAlertKey],
        ] as [string, string],
    )

    // Show each user-facing risk reason once, even if several checks reported it.
    v = v.filter((item) => {
      const key = item[0]
      const index = v.findIndex((i) => i[0] === key)
      return index === v.indexOf(item)
    })
    return v
  })

  function closeWithoutInstalling(): void {
    pluginAlertModalStore.open = false
  }

  function handleDialogKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    closeWithoutInstalling()
  }
</script>

{#if pluginAlertModalStore.open}
  <div data-modal-root class="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
    <div
      use:modalFocusTrap
      role="dialog"
      aria-modal="true"
      aria-labelledby="risu-plugin-risk-dialog-title"
      tabindex="-1"
      onkeydown={handleDialogKeydown}
      class="bg-orange-800 rounded-lg shadow-xl max-w-md w-full p-6">
      <h2 id="risu-plugin-risk-dialog-title" class="text-xl font-bold mb-4 text-textcolor">
        {language.pluginRiskDetectedAlert}
      </h2>

      <ul class="list-disc list-inside mb-4 space-y-2 text-gray-300">
        {#each reasons as reason}
          <li>{reason[0]}</li>
          <ul>
            <li class="ml-4 text-sm italic">{reason[1]}</li>
          </ul>
        {/each}
      </ul>

      <details class="mb-4 text-gray-200">
        <summary tabindex="0" class="cursor-pointer text-gray-200 mb-2"> Dev Info </summary>

        {#each pluginAlertModalStore.errors as error}
          <p class="text-gray-200">{error.message}</p>
        {/each}
      </details>

      <div class="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <button
          type="button"
          class="w-full bg-orange-600 hover:bg-orange-500 text-gray-100 font-semibold py-2 px-4 rounded-sm transition-colors sm:w-auto"
          onclick={() => {
            pluginAlertModalStore.open = false
            pluginAlertModalStore.errors = []
          }}>
          {language.continueAnyway}
        </button>

        <button
          type="button"
          data-modal-initial-focus
          class="w-full bg-gray-700 hover:bg-gray-600 text-gray-100 font-semibold py-2 px-4 rounded-sm transition-colors sm:w-auto"
          onclick={closeWithoutInstalling}>
          {language.doNotInstall}
        </button>
      </div>
    </div>
  </div>
{/if}
