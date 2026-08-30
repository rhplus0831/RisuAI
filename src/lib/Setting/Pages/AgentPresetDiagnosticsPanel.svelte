<script lang="ts">
  import { language } from 'src/lang'
  import Button from 'src/lib/UI/GUI/Button.svelte'
  import {
    collectAgentPresetDiagnosticRuns,
    type AgentPresetDiagnosticRun,
    type AgentPresetStepDiagnostic,
  } from 'src/ts/agentPresetDiagnostics'
  import { ensureAllChatsHydrated } from 'src/ts/server/chatMessageHydration.svelte'
  import { charactersResourceState } from 'src/ts/server/resourceState.svelte'

  interface Props {
    presetId: string
  }

  let { presetId }: Props = $props()

  let open = $state(false)
  let loading = $state(false)
  let loaded = $state(false)
  let loadError = $state('')
  let selectedRunKey = $state('')

  let collection = $derived(
    open || loaded
      ? collectAgentPresetDiagnosticRuns(
          { characters: readDiagnosticCharacterOwners(charactersResourceState.characters) },
          presetId,
        )
      : { runs: [], total: 0 },
  )
  let selectedRun = $derived(
    collection.runs.find((candidate) => candidate.key === selectedRunKey) ?? collection.runs[0],
  )
  let summary = $derived(summaryText())

  $effect(() => {
    const runs = collection.runs
    if (!runs.some((candidate) => candidate.key === selectedRunKey)) {
      selectedRunKey = runs[0]?.key ?? ''
    }
  })

  function summaryText(): string {
    if (collection.total > 0) return language.agentPresets.diagnosticsAvailable(collection.total)
    if (loading) return language.agentPresets.diagnosticsLoading
    if (loaded) return language.agentPresets.diagnosticsPending
    return language.agentPresets.diagnosticsDescription
  }

  function togglePanel(): void {
    if (open) {
      open = false
      return
    }
    open = true
    if (!loaded) void loadDiagnostics()
  }

  async function loadDiagnostics(): Promise<void> {
    if (!presetId || loading) return
    loading = true
    loadError = ''
    try {
      await ensureAllChatsHydrated({ strict: true })
      loaded = true
    } catch (error) {
      loadError = error instanceof Error ? error.message : String(error)
    } finally {
      loading = false
    }
  }

  function runLocation(run: AgentPresetDiagnosticRun): string {
    const character = run.characterName || run.characterId || language.agentPresets.diagnosticsUnknownCharacter
    const chat = run.chatName || run.chatId || language.agentPresets.diagnosticsUnknownChat
    return `${character} · ${chat}`
  }

  function runTime(run: AgentPresetDiagnosticRun): string {
    if (run.messageTime === undefined) return language.agentPresets.diagnosticsUnknownTime
    return new Date(run.messageTime).toLocaleString()
  }

  function runStatus(run: AgentPresetDiagnosticRun): string {
    if (run.diagnostic.failure || run.diagnostic.steps.some((step) => step.status === 'failed')) {
      return language.agentPresets.diagnosticStepStatuses.failed
    }
    if (run.diagnostic.status !== 'ready') return diagnosticStatusLabel(run.diagnostic.status)
    if (run.diagnostic.steps.some((step) => step.status === 'skipped')) {
      return language.agentPresets.diagnosticsCompletedWithSkips
    }
    return language.agentPresets.diagnosticStepStatuses.success
  }

  function diagnosticStatusLabel(status: string): string {
    if (status === 'ready') return language.agentPresets.statusReady
    if (status === 'disabled') return language.agentPresets.statusDisabled
    if (status === 'invalid') return language.agentPresets.statusInvalid
    if (status === 'incomplete') return language.agentPresets.statusIncomplete
    if (status === 'model_not_ready') return language.agentPresets.statusModelNotReady
    if (status === 'missing') return language.agentPresets.missingSelectedShort
    return humanize(status) || language.agentPresets.diagnosticsUnknown
  }

  function runStatusClass(run: AgentPresetDiagnosticRun): string {
    if (run.diagnostic.failure || run.diagnostic.steps.some((step) => step.status === 'failed')) {
      return 'border-draculared text-draculared'
    }
    if (run.diagnostic.status === 'invalid' || run.diagnostic.status === 'missing') {
      return 'border-draculared text-draculared'
    }
    if (run.diagnostic.status === 'incomplete' || run.diagnostic.status === 'model_not_ready') {
      return 'border-yellow-600 text-yellow-500'
    }
    if (run.diagnostic.status !== 'ready') return 'border-darkborderc text-textcolor2'
    if (run.diagnostic.steps.some((step) => step.status === 'skipped')) {
      return 'border-yellow-600 text-yellow-500'
    }
    return 'border-green-600 text-green-500'
  }

  function stepStatusLabel(status: string): string {
    if (status === 'success') return language.agentPresets.diagnosticStepStatuses.success
    if (status === 'failed') return language.agentPresets.diagnosticStepStatuses.failed
    if (status === 'skipped') return language.agentPresets.diagnosticStepStatuses.skipped
    return humanize(status) || language.agentPresets.diagnosticStepStatuses.unknown
  }

  function stepStatusClass(status: string): string {
    if (status === 'success') return 'border-green-600 text-green-500'
    if (status === 'failed') return 'border-draculared text-draculared'
    if (status === 'skipped') return 'border-yellow-600 text-yellow-500'
    return 'border-darkborderc text-textcolor2'
  }

  function stepPhaseLabel(phase?: string): string {
    if (phase === 'beforeMain') return language.agentPresets.beforeMain
    if (phase === 'afterMain') return language.agentPresets.afterMain
    return phase ? humanize(phase) : language.agentPresets.diagnosticsUnknown
  }

  function stepModel(step: AgentPresetStepDiagnostic): string | undefined {
    return step.requestModel || step.modelId
  }

  function stepProfile(step: AgentPresetStepDiagnostic): string | undefined {
    return step.profileName || step.profileId
  }

  function phaseCounts(run: AgentPresetDiagnosticRun): string {
    const beforeMain = run.diagnostic.beforeMainStepCount
    const afterMain = run.diagnostic.afterMainStepCount
    if (beforeMain === undefined || afterMain === undefined) return language.agentPresets.diagnosticsUnknown
    return language.agentPresets.phaseSummary(beforeMain, afterMain)
  }

  function booleanLabel(value?: boolean): string {
    if (value === true) return language.agentPresets.diagnosticsYes
    if (value === false) return language.agentPresets.diagnosticsNo
    return language.agentPresets.diagnosticsUnknown
  }

  function numberLabel(value?: number): string {
    return value === undefined ? language.agentPresets.diagnosticsUnknown : value.toLocaleString()
  }

  function durationLabel(value?: number): string {
    if (value === undefined) return language.agentPresets.diagnosticsUnknown
    if (value < 1_000) return `${Math.round(value)} ms`
    return `${(value / 1_000).toFixed(2)} s`
  }

  function humanize(value?: string): string {
    if (!value) return ''
    return value.replaceAll('_', ' ').replace(/([a-z])([A-Z])/g, '$1 $2')
  }

  function readDiagnosticCharacterOwners(value: unknown): DiagnosticCharacter[] {
    if (!Array.isArray(value)) return []
    const characterIds = new Set<string>()
    const chatIds = new Set<string>()
    for (const candidate of value) {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return []
      const character = candidate as DiagnosticCharacter
      if (character.chaId !== undefined) {
        if (
          typeof character.chaId !== 'string' ||
          character.chaId.trim() !== character.chaId ||
          character.chaId.length === 0
        ) {
          return []
        }
        if (characterIds.has(character.chaId)) return []
        characterIds.add(character.chaId)
      }
      if (character.chats !== undefined && !Array.isArray(character.chats)) return []

      for (const chat of character.chats ?? []) {
        if (chat?.id !== undefined) {
          if (typeof chat.id !== 'string' || chat.id.trim() !== chat.id || chat.id.length === 0) return []
          if (chatIds.has(chat.id)) return []
          chatIds.add(chat.id)
        }
      }
    }
    return value as DiagnosticCharacter[]
  }

  interface DiagnosticCharacter {
    chaId?: string
    chats?: readonly DiagnosticChat[]
  }

  interface DiagnosticChat {
    id?: string
  }
</script>

<section class="rounded-md border border-darkborderc p-3" data-risu-agent-preset-diagnostics>
  <div class="flex flex-wrap items-center justify-between gap-3">
    <div>
      <h4 class="text-base font-semibold">{language.agentPresets.diagnostics}</h4>
      <p class="text-sm text-textcolor2" aria-live="polite">{summary}</p>
    </div>
    <span data-risu-agent-preset-open-diagnostics>
      <Button
        size="sm"
        styled="outlined"
        disabled={!presetId}
        ariaExpanded={open}
        ariaControls="agent-preset-diagnostics-panel"
        onclick={togglePanel}>
        {open ? language.agentPresets.closeDiagnostics : language.agentPresets.openDiagnostics}
      </Button>
    </span>
  </div>

  {#if open}
    <div
      id="agent-preset-diagnostics-panel"
      class="mt-3 border-t border-darkborderc pt-3"
      data-risu-agent-preset-diagnostics-panel>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h5 class="text-sm font-semibold">{language.agentPresets.diagnosticsHistory}</h5>
          <span class="text-xs text-textcolor2">{language.agentPresets.diagnosticsRunCount(collection.total)}</span>
        </div>
        {#if loadError}
          <Button size="sm" styled="outlined" disabled={loading} onclick={loadDiagnostics}>
            {language.agentPresets.retryDiagnostics}
          </Button>
        {/if}
      </div>

      {#if loading}
        <div class="mt-3 rounded-md border border-darkborderc bg-darkbg p-3 text-sm text-textcolor2" role="status">
          {language.agentPresets.diagnosticsLoading}
        </div>
      {/if}

      {#if loadError}
        <div class="mt-3 rounded-md border border-draculared p-3 text-sm text-draculared" role="alert">
          <span class="block font-medium">{language.agentPresets.diagnosticsLoadError}</span>
          <span class="mt-1 block break-words text-xs">{loadError}</span>
        </div>
      {/if}

      {#if collection.total > collection.runs.length}
        <p class="mt-3 text-xs text-textcolor2">
          {language.agentPresets.diagnosticsLimited(collection.runs.length, collection.total)}
        </p>
      {/if}

      {#if collection.runs.length === 0 && !loading}
        <div
          class="mt-3 rounded-md border border-darkborderc p-3 text-sm text-textcolor2"
          data-risu-agent-preset-diagnostics-empty>
          {language.agentPresets.diagnosticsPending}
        </div>
      {:else if collection.runs.length > 0}
        <div class="mt-3 grid min-h-0 gap-3 lg:grid-cols-[minmax(14rem,18rem)_minmax(0,1fr)]">
          <ol class="flex max-h-96 flex-col gap-2 overflow-y-auto pr-1" data-risu-agent-preset-diagnostics-runs>
            {#each collection.runs as run (run.key)}
              <li>
                <button
                  type="button"
                  class="w-full rounded-md border p-2 text-left transition-colors hover:bg-darkbutton"
                  class:border-selected={selectedRun?.key === run.key}
                  class:border-darkborderc={selectedRun?.key !== run.key}
                  class:bg-darkbutton={selectedRun?.key === run.key}
                  aria-pressed={selectedRun?.key === run.key}
                  data-risu-agent-preset-diagnostic-run
                  onclick={() => {
                    selectedRunKey = run.key
                  }}>
                  <span class="block truncate text-sm font-medium">{runLocation(run)}</span>
                  <span class="mt-0.5 block text-xs text-textcolor2">{runTime(run)}</span>
                  <span class={`mt-1 inline-block rounded-sm border px-1.5 py-0.5 text-xs ${runStatusClass(run)}`}>
                    {runStatus(run)}
                  </span>
                </button>
              </li>
            {/each}
          </ol>

          {#if selectedRun}
            <article class="min-w-0 rounded-md border border-darkborderc p-3" data-risu-agent-preset-diagnostic-details>
              <div class="flex flex-wrap items-start justify-between gap-2">
                <div class="min-w-0">
                  <h5 class="truncate text-base font-semibold">{runLocation(selectedRun)}</h5>
                  <span class="text-xs text-textcolor2">{runTime(selectedRun)}</span>
                </div>
                <span class={`rounded-sm border px-2 py-1 text-xs ${runStatusClass(selectedRun)}`}>
                  {runStatus(selectedRun)}
                </span>
              </div>

              <section class="mt-3" data-risu-agent-preset-diagnostic-overview>
                <h6 class="text-sm font-semibold">{language.agentPresets.diagnosticsOverview}</h6>
                <dl class="mt-2 grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
                  <div class="min-w-0">
                    <dt class="text-xs text-textcolor2">{language.agentPresets.diagnosticsPlanStatus}</dt>
                    <dd>{diagnosticStatusLabel(selectedRun.diagnostic.status)}</dd>
                  </div>
                  <div class="min-w-0">
                    <dt class="text-xs text-textcolor2">{language.agentPresets.diagnosticsPresetVersion}</dt>
                    <dd>{numberLabel(selectedRun.diagnostic.presetVersion)}</dd>
                  </div>
                  <div class="min-w-0">
                    <dt class="text-xs text-textcolor2">{language.agentPresets.diagnosticsPhaseCounts}</dt>
                    <dd>{phaseCounts(selectedRun)}</dd>
                  </div>
                  <div class="min-w-0">
                    <dt class="text-xs text-textcolor2">{language.agentPresets.maxConcurrency}</dt>
                    <dd>{selectedRun.diagnostic.maxConcurrency ?? language.agentPresets.unlimited}</dd>
                  </div>
                  <div class="min-w-0">
                    <dt class="text-xs text-textcolor2">{language.agentPresets.diagnosticsFinalTextModified}</dt>
                    <dd>{booleanLabel(selectedRun.diagnostic.finalTextModified)}</dd>
                  </div>
                  <div class="min-w-0">
                    <dt class="text-xs text-textcolor2">{language.agentPresets.diagnosticsFinalOutputComposed}</dt>
                    <dd>{booleanLabel(selectedRun.diagnostic.finalOutputComposed)}</dd>
                  </div>
                  <div class="min-w-0">
                    <dt class="text-xs text-textcolor2">{language.agentPresets.diagnosticsModel}</dt>
                    <dd class="break-words">{selectedRun.model ?? language.agentPresets.diagnosticsUnknown}</dd>
                  </div>
                  <div class="min-w-0 sm:col-span-2">
                    <dt class="text-xs text-textcolor2">{language.agentPresets.diagnosticsGenerationId}</dt>
                    <dd class="break-all">{selectedRun.generationId ?? language.agentPresets.diagnosticsUnknown}</dd>
                  </div>
                  <div class="min-w-0 sm:col-span-2">
                    <dt class="text-xs text-textcolor2">{language.agentPresets.diagnosticsPromptOutputKeys}</dt>
                    <dd class="mt-1 flex flex-wrap gap-1">
                      {#if selectedRun.diagnostic.promptOutputKeys.length === 0}
                        {language.agentPresets.diagnosticsNoPromptOutputKeys}
                      {:else}
                        {#each selectedRun.diagnostic.promptOutputKeys as outputKey (outputKey)}
                          <code class="rounded-sm bg-darkbg px-1.5 py-0.5 text-xs">{outputKey}</code>
                        {/each}
                      {/if}
                    </dd>
                  </div>
                </dl>
              </section>

              {#if selectedRun.diagnostic.failure}
                <section class="mt-3 rounded-md border border-draculared p-3" data-risu-agent-preset-run-failure>
                  <h6 class="text-sm font-semibold text-draculared">{language.agentPresets.diagnosticsRunFailure}</h6>
                  {#if selectedRun.diagnostic.failure.message}
                    <p class="mt-1 whitespace-pre-wrap break-words text-sm">{selectedRun.diagnostic.failure.message}</p>
                  {/if}
                  <p class="mt-1 text-xs text-textcolor2">
                    {selectedRun.diagnostic.failure.stepName ??
                      selectedRun.diagnostic.failure.stepId ??
                      language.agentPresets.diagnosticsStepUnknown}
                    · {stepPhaseLabel(selectedRun.diagnostic.failure.phase)}
                    {#if selectedRun.diagnostic.failure.failureKind}
                      · {humanize(selectedRun.diagnostic.failure.failureKind)}
                    {/if}
                    {#if selectedRun.diagnostic.failure.failurePolicyOutcome}
                      · {humanize(selectedRun.diagnostic.failure.failurePolicyOutcome)}
                    {/if}
                  </p>
                </section>
              {/if}

              {#if selectedRun.diagnostic.mainOutputPreview !== undefined}
                <section class="mt-3" data-risu-agent-preset-main-output-preview>
                  <div class="flex flex-wrap items-center justify-between gap-2">
                    <h6 class="text-sm font-semibold">{language.agentPresets.diagnosticsMainOutputPreview}</h6>
                    {#if selectedRun.diagnostic.mainOutputChars !== undefined}
                      <span class="text-xs text-textcolor2">
                        {numberLabel(selectedRun.diagnostic.mainOutputChars)}
                        {language.agentPresets.diagnosticsOutputChars}
                      </span>
                    {/if}
                  </div>
                  <pre
                    class="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-md border border-darkborderc bg-darkbg p-3 text-xs">{selectedRun
                      .diagnostic.mainOutputPreview}</pre>
                </section>
              {/if}

              <section class="mt-4" data-risu-agent-preset-step-diagnostics>
                <h6 class="text-sm font-semibold">{language.agentPresets.diagnosticsStepResults}</h6>
                {#if selectedRun.diagnostic.steps.length === 0}
                  <p class="mt-2 text-sm text-textcolor2">{language.agentPresets.diagnosticsNoStepResults}</p>
                {:else}
                  <ol class="mt-2 flex flex-col gap-3">
                    {#each selectedRun.diagnostic.steps as step, stepIndex (`${step.stepId ?? step.outputKey ?? stepIndex}:${stepIndex}`)}
                      <li class="rounded-md border border-darkborderc p-3" data-risu-agent-preset-diagnostic-step>
                        <div class="flex flex-wrap items-start justify-between gap-2">
                          <div class="min-w-0">
                            <span class="block truncate text-sm font-medium">
                              {step.stepName ?? step.stepId ?? language.agentPresets.diagnosticsStepUnknown}
                            </span>
                            <span class="text-xs text-textcolor2">
                              {stepPhaseLabel(step.phase)} · {language.agentPresets.outputKey}:
                              {step.outputKey ?? language.agentPresets.diagnosticsUnknown}
                            </span>
                          </div>
                          <span class={`rounded-sm border px-2 py-1 text-xs ${stepStatusClass(step.status)}`}>
                            {stepStatusLabel(step.status)}
                          </span>
                        </div>

                        <dl class="mt-3 grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
                          <div>
                            <dt class="text-xs text-textcolor2">{language.agentPresets.diagnosticsDuration}</dt>
                            <dd>{durationLabel(step.durationMs)}</dd>
                          </div>
                          <div>
                            <dt class="text-xs text-textcolor2">{language.agentPresets.diagnosticsInputChars}</dt>
                            <dd>{numberLabel(step.inputChars)}</dd>
                          </div>
                          <div>
                            <dt class="text-xs text-textcolor2">{language.agentPresets.diagnosticsOutputChars}</dt>
                            <dd>{numberLabel(step.outputChars)}</dd>
                          </div>
                          <div>
                            <dt class="text-xs text-textcolor2">{language.agentPresets.outputFormatLabel}</dt>
                            <dd>
                              {step.outputFormat
                                ? humanize(step.outputFormat)
                                : language.agentPresets.diagnosticsUnknown}
                            </dd>
                          </div>
                          <div>
                            <dt class="text-xs text-textcolor2">{language.agentPresets.destinationLabel}</dt>
                            <dd>
                              {step.destination ? humanize(step.destination) : language.agentPresets.diagnosticsUnknown}
                            </dd>
                          </div>
                          <div>
                            <dt class="text-xs text-textcolor2">{language.agentPresets.failurePolicyLabel}</dt>
                            <dd>
                              {step.failurePolicy
                                ? humanize(step.failurePolicy)
                                : language.agentPresets.diagnosticsUnknown}
                            </dd>
                          </div>
                          {#if step.provider}
                            <div>
                              <dt class="text-xs text-textcolor2">{language.agentPresets.diagnosticsProvider}</dt>
                              <dd class="break-words">{step.provider}</dd>
                            </div>
                          {/if}
                          {#if stepProfile(step)}
                            <div>
                              <dt class="text-xs text-textcolor2">{language.agentPresets.diagnosticsProfile}</dt>
                              <dd class="break-words">{stepProfile(step)}</dd>
                            </div>
                          {/if}
                          {#if stepModel(step)}
                            <div>
                              <dt class="text-xs text-textcolor2">{language.agentPresets.diagnosticsStepModel}</dt>
                              <dd class="break-words">{stepModel(step)}</dd>
                            </div>
                          {/if}
                          {#if step.parseStatus}
                            <div>
                              <dt class="text-xs text-textcolor2">{language.agentPresets.diagnosticsParseStatus}</dt>
                              <dd>{humanize(step.parseStatus)}</dd>
                            </div>
                          {/if}
                        </dl>

                        {#if step.status === 'failed' || step.status === 'skipped'}
                          <div
                            class="mt-3 rounded-md border p-2 text-sm"
                            class:border-draculared={step.status === 'failed'}
                            class:text-draculared={step.status === 'failed'}
                            class:border-yellow-600={step.status === 'skipped'}
                            class:text-yellow-500={step.status === 'skipped'}>
                            {#if step.error}<p class="whitespace-pre-wrap break-words">{step.error}</p>{/if}
                            <p class="mt-1 text-xs">
                              {#if step.failureKind}{humanize(step.failureKind)}{/if}
                              {#if step.failurePolicyOutcome}
                                · {humanize(step.failurePolicyOutcome)}{/if}
                              {#if step.reason}
                                · {humanize(step.reason)}{/if}
                            </p>
                          </div>
                        {/if}

                        {#if step.outputPreview !== undefined}
                          <section class="mt-3" data-risu-agent-preset-step-output-preview>
                            <div class="flex flex-wrap items-center justify-between gap-2">
                              <h6 class="text-xs font-semibold">{language.agentPresets.diagnosticsOutputPreview}</h6>
                              {#if step.outputTruncated}
                                <span class="text-xs text-yellow-500"
                                  >{language.agentPresets.diagnosticsTruncated}</span>
                              {/if}
                            </div>
                            <pre
                              class="mt-1 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-md border border-darkborderc bg-darkbg p-2 text-xs">{step.outputPreview}</pre>
                          </section>
                        {/if}

                        {#if step.preparedInputSections.length > 0}
                          <section class="mt-3">
                            <h6 class="text-xs font-semibold">{language.agentPresets.diagnosticsPreparedInputs}</h6>
                            <ul class="mt-1 flex flex-col gap-1 text-xs text-textcolor2">
                              {#each step.preparedInputSections as section, sectionIndex (`${section.scope ?? section.sourceLabel ?? sectionIndex}:${sectionIndex}`)}
                                <li>
                                  {section.sourceLabel ?? section.scope ?? language.agentPresets.diagnosticsUnknown} ·
                                  {numberLabel(section.charCount)}
                                  {language.agentPresets.diagnosticsInputChars}
                                  {#if section.truncated}
                                    · {language.agentPresets.diagnosticsTruncated}{/if}
                                </li>
                              {/each}
                            </ul>
                          </section>
                        {/if}

                        {#if step.preparedInputDiagnostics.length > 0}
                          <section class="mt-3">
                            <h6 class="text-xs font-semibold">
                              {language.agentPresets.diagnosticsPreparedInputIssues}
                            </h6>
                            <ul class="mt-1 flex list-disc flex-col gap-1 pl-4 text-xs text-textcolor2">
                              {#each step.preparedInputDiagnostics as inputDiagnostic, diagnosticIndex (`${inputDiagnostic.scope ?? inputDiagnostic.reason ?? diagnosticIndex}:${diagnosticIndex}`)}
                                <li>
                                  {inputDiagnostic.message ??
                                    inputDiagnostic.sourceLabel ??
                                    inputDiagnostic.scope ??
                                    language.agentPresets.diagnosticsUnknown}
                                  {#if inputDiagnostic.reason}
                                    ({humanize(inputDiagnostic.reason)}){/if}
                                </li>
                              {/each}
                            </ul>
                          </section>
                        {/if}
                      </li>
                    {/each}
                  </ol>
                {/if}
              </section>
            </article>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</section>
