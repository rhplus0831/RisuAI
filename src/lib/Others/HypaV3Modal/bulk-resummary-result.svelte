<script lang="ts">
  import { LanguagesIcon, RefreshCw, CheckIcon, XIcon } from '@lucide/svelte'
  import { language } from 'src/lang'
  import type { BulkResummaryState } from './types'
  import { handleDualAction } from './utils'

  interface Props {
    bulkResummaryState: BulkResummaryState
    onToggleTranslation: (regenerate: boolean) => void
    onReroll: () => void
    onApply: () => void
    onCancel: () => void
  }

  let { bulkResummaryState, onToggleTranslation, onReroll, onApply, onCancel }: Props = $props()
</script>

<!-- Bulk Resummarize Result Section -->
{#if bulkResummaryState}
  <div class="sticky bottom-0 p-4 bg-zinc-900 border-t border-zinc-700 rounded-b-lg">
    <div class="flex flex-col gap-3">
      <div class="flex justify-between items-center">
        <h3 id="hypav3-resummary-result-label" class="text-sm font-medium text-zinc-300">
          {language.hypaV3Modal.reSummarizeResult}
        </h3>
        <div class="flex items-center gap-2">
          <!-- Translate Button -->
          <button
            class="p-2 text-zinc-400 hover:text-zinc-200 transition-colors {bulkResummaryState.isProcessing ||
            !bulkResummaryState.result
              ? 'opacity-50 cursor-not-allowed'
              : ''}"
            aria-label={language.hypaV3Modal.toggleResummaryTranslationAction}
            aria-pressed={bulkResummaryState.translation !== null}
            disabled={bulkResummaryState.isProcessing || !bulkResummaryState.result}
            title={language.hypaV3Modal.toggleResummaryTranslationAction}
            use:handleDualAction={{
              onMainAction: () => onToggleTranslation(false),
              onAlternativeAction: () => onToggleTranslation(true),
            }}>
            <LanguagesIcon class="w-4 h-4" />
          </button>

          <!-- Reroll Button -->
          <button
            class="p-2 rounded transition-colors {bulkResummaryState.isProcessing
              ? 'text-zinc-600 cursor-not-allowed'
              : 'text-orange-400 hover:text-orange-300'}"
            aria-label={language.hypaV3Modal.retryResummaryAction}
            onclick={onReroll}
            disabled={bulkResummaryState.isProcessing}
            title={language.hypaV3Modal.retryResummaryAction}>
            <RefreshCw class="w-4 h-4" />
          </button>

          <!-- Apply Button -->
          <button
            class="p-2 rounded transition-colors {bulkResummaryState.isProcessing || !bulkResummaryState.result
              ? 'text-zinc-600 cursor-not-allowed'
              : 'text-green-400 hover:text-green-300'}"
            aria-label={language.hypaV3Modal.applyResummaryAction}
            onclick={onApply}
            disabled={bulkResummaryState.isProcessing || !bulkResummaryState.result}
            title={language.hypaV3Modal.applyResummaryAction}>
            <CheckIcon class="w-4 h-4" />
          </button>

          <!-- Cancel Button -->
          <button
            class="p-2 rounded-sm transition-colors text-zinc-400 hover:text-zinc-200"
            aria-label={language.hypaV3Modal.cancelResummaryAction}
            onclick={onCancel}
            title={language.hypaV3Modal.cancelResummaryAction}>
            <XIcon class="w-4 h-4" />
          </button>
        </div>
      </div>

      <!-- Result Content -->
      {#if bulkResummaryState.isProcessing}
        <div class="text-center py-4 text-zinc-400">
          <RefreshCw class="w-6 h-6 animate-spin inline mr-2" />
          {language.hypaV3Modal.reSummarizing}
        </div>
      {:else if bulkResummaryState.result}
        <textarea
          class="p-3 w-full min-h-32 resize-vertical rounded-sm border border-zinc-700 focus:outline-hidden focus:ring-2 focus:ring-zinc-500 transition-colors text-zinc-200 bg-zinc-800"
          aria-labelledby="hypav3-resummary-result-label"
          readonly
          value={bulkResummaryState.result}></textarea>

        <!-- Translation Result -->
        {#if bulkResummaryState.translation}
          <div class="mt-3">
            <div id="hypav3-resummary-translation-label" class="mb-2 text-sm text-zinc-400">
              {language.hypaV3Modal.translationLabel}
            </div>
            <textarea
              class="p-3 w-full min-h-32 resize-vertical rounded-sm border border-zinc-700 focus:outline-hidden transition-colors text-zinc-200 bg-zinc-800"
              aria-labelledby="hypav3-resummary-translation-label"
              readonly
              value={bulkResummaryState.translation}></textarea>
          </div>
        {/if}
      {/if}
    </div>
  </div>
{/if}
