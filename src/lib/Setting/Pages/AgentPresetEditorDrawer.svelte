<script lang="ts">
  import { SaveIcon, XIcon } from '@lucide/svelte'
  import { language } from 'src/lang'
  import Button from 'src/lib/UI/GUI/Button.svelte'
  import CheckInput from 'src/lib/UI/GUI/CheckInput.svelte'
  import NumberInput from 'src/lib/UI/GUI/NumberInput.svelte'
  import TextInput from 'src/lib/UI/GUI/TextInput.svelte'
  import {
    AGENT_PRESET_MAX_CONCURRENCY_MAX,
    AGENT_PRESET_MAX_CONCURRENCY_MIN,
    type AgentPresetRecord,
    type AgentPresetStepPhase,
    type AgentPresetStepRecord,
  } from 'src/ts/agentPresetRecords'
  import type { AgentPresetSnapshot } from 'src/ts/server/commands'

  interface Props {
    mode: 'create' | 'edit'
    preset?: AgentPresetRecord
    busy?: boolean
    commandError?: string
    onSave: (preset: AgentPresetSnapshot) => void | Promise<void>
    onCancel: () => void
  }

  let { mode, preset, busy = false, commandError = '', onSave, onCancel }: Props = $props()

  // svelte-ignore state_referenced_locally
  const initialPreset = preset
  let draftName = $state(initialPreset?.name ?? language.agentPresets.newPresetName)
  let draftDescription = $state(initialPreset?.description ?? '')
  let draftEnabled = $state(initialPreset?.enabled ?? true)
  let limitConcurrency = $state(initialPreset?.maxConcurrency !== undefined)
  let draftMaxConcurrency = $state(initialPreset?.maxConcurrency ?? 4)
  let initialSnapshot = $state('')

  let drawerTitle = $derived(mode === 'create' ? language.agentPresets.createPreset : language.agentPresets.editPreset)
  let beforeMainSteps = $derived(stepsForPhase(initialPreset?.steps ?? [], 'beforeMain'))
  let afterMainSteps = $derived(stepsForPhase(initialPreset?.steps ?? [], 'afterMain'))
  let isDirty = $derived(initialSnapshot !== '' && initialSnapshot !== snapshot(snapshotForSave()))
  let canSave = $derived(draftName.trim().length > 0 && !busy)

  $effect(() => {
    if (!initialSnapshot) initialSnapshot = snapshot(snapshotForSave())
  })

  function snapshot(value: unknown): string {
    return JSON.stringify(value ?? {})
  }

  function stepsForPhase(
    steps: readonly AgentPresetStepRecord[],
    phase: AgentPresetStepPhase,
  ): AgentPresetStepRecord[] {
    return steps.filter((step) => step.phase === phase)
  }

  function clampedMaxConcurrency(): number {
    const rounded = Math.round(Number(draftMaxConcurrency))
    if (!Number.isFinite(rounded)) return AGENT_PRESET_MAX_CONCURRENCY_MIN
    return Math.max(AGENT_PRESET_MAX_CONCURRENCY_MIN, Math.min(AGENT_PRESET_MAX_CONCURRENCY_MAX, rounded))
  }

  function snapshotForSave(): AgentPresetSnapshot {
    const next: AgentPresetSnapshot = {
      name: draftName.trim(),
      enabled: draftEnabled,
    }
    const description = draftDescription.trim()
    if (description) {
      next.description = description
    } else if (mode === 'edit') {
      next.description = null
    }

    if (limitConcurrency) {
      next.maxConcurrency = clampedMaxConcurrency()
    } else if (mode === 'edit') {
      next.maxConcurrency = null
    }

    return next
  }

  function requestClose(): void {
    if (isDirty && !window.confirm(language.agentPresets.discardChangesConfirm)) return
    onCancel()
  }

  function handleBackdropKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' && event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    requestClose()
  }

  function handleDialogKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return
    event.stopPropagation()
    requestClose()
  }

  async function savePreset(): Promise<void> {
    if (!canSave) return
    await onSave(snapshotForSave())
  }
</script>

<div
  class="fixed inset-0 z-50 flex justify-end bg-black/50"
  role="button"
  tabindex="0"
  onclick={requestClose}
  onkeydown={handleBackdropKeydown}>
  <div
    class="flex h-full w-full max-w-2xl flex-col border-l border-darkborderc bg-bgcolor text-textcolor shadow-xl"
    role="dialog"
    aria-modal="true"
    aria-label={drawerTitle}
    tabindex="-1"
    data-risu-agent-preset-editor
    onclick={(event) => {
      event.stopPropagation()
    }}
    onkeydown={handleDialogKeydown}>
    <div class="flex items-start justify-between gap-3 border-b border-darkborderc p-4">
      <div class="min-w-0">
        <h3 class="truncate text-xl font-semibold">{drawerTitle}</h3>
        <span class="text-sm text-textcolor2">{language.agentPresets.editorShellNotice}</span>
      </div>
      <button
        type="button"
        class="flex h-9 w-9 shrink-0 items-center justify-center rounded-md hover:bg-darkbutton"
        aria-label={language.modelRoles.close}
        onclick={requestClose}>
        <XIcon size={20} />
      </button>
    </div>

    <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
      {#if commandError}
        <div class="rounded-md border border-draculared p-3 text-sm text-draculared">{commandError}</div>
      {/if}

      <section class="rounded-md border border-darkborderc p-3">
        <div class="grid gap-3 md:grid-cols-2">
          <label class="flex flex-col gap-1">
            <span class="text-sm font-medium">{language.agentPresets.nameLabel}</span>
            <span data-risu-agent-preset-name-input>
              <TextInput bind:value={draftName} fullwidth placeholder={language.agentPresets.newPresetName} />
            </span>
          </label>
          <div class="flex flex-col gap-3">
            <CheckInput
              bind:check={draftEnabled}
              name={language.agentPresets.enabledLabel}
              onChange={(value) => {
                draftEnabled = value
              }} />
            <CheckInput
              bind:check={limitConcurrency}
              name={language.agentPresets.limitConcurrency}
              onChange={(value) => {
                limitConcurrency = value
              }} />
          </div>
        </div>
        <label class="mt-3 flex flex-col gap-1">
          <span class="text-sm font-medium">{language.agentPresets.descriptionLabel}</span>
          <textarea
            class="min-h-20 rounded-md border border-darkborderc bg-transparent px-3 py-2 text-sm text-textcolor shadow-xs focus:border-borderc focus:outline-hidden focus:ring-2 focus:ring-borderc"
            bind:value={draftDescription}
            placeholder={language.agentPresets.descriptionPlaceholder}
            data-risu-agent-preset-description-input></textarea>
        </label>
        <label class="mt-3 flex max-w-xs flex-col gap-1">
          <span class="text-sm font-medium">{language.agentPresets.maxConcurrency}</span>
          <NumberInput
            bind:value={draftMaxConcurrency}
            min={AGENT_PRESET_MAX_CONCURRENCY_MIN}
            max={AGENT_PRESET_MAX_CONCURRENCY_MAX}
            step={1}
            fullwidth
            disabled={!limitConcurrency} />
        </label>
      </section>

      <section class="rounded-md border border-darkborderc p-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h4 class="text-base font-semibold">{language.agentPresets.stepsTitle}</h4>
          <span class="text-sm text-textcolor2">{language.agentPresets.stepEditorPending}</span>
        </div>

        <div class="mt-3 grid gap-3 md:grid-cols-2">
          <div class="rounded-md border border-darkborderc p-3">
            <h5 class="text-sm font-semibold">{language.agentPresets.beforeMain}</h5>
            {#if beforeMainSteps.length === 0}
              <p class="mt-2 text-sm text-textcolor2">{language.agentPresets.noStepsInPhase}</p>
            {:else}
              <ul class="mt-2 flex flex-col gap-2 text-sm">
                {#each beforeMainSteps as step (step.id)}
                  <li class="rounded-sm border border-darkborderc p-2">
                    <span class="block font-medium">{step.name}</span>
                    <span class="text-xs text-textcolor2">{language.agentPresets.outputKey}: {step.outputKey}</span>
                  </li>
                {/each}
              </ul>
            {/if}
          </div>
          <div class="rounded-md border border-darkborderc p-3">
            <h5 class="text-sm font-semibold">{language.agentPresets.afterMain}</h5>
            {#if afterMainSteps.length === 0}
              <p class="mt-2 text-sm text-textcolor2">{language.agentPresets.noStepsInPhase}</p>
            {:else}
              <ul class="mt-2 flex flex-col gap-2 text-sm">
                {#each afterMainSteps as step (step.id)}
                  <li class="rounded-sm border border-darkborderc p-2">
                    <span class="block font-medium">{step.name}</span>
                    <span class="text-xs text-textcolor2">{language.agentPresets.outputKey}: {step.outputKey}</span>
                  </li>
                {/each}
              </ul>
            {/if}
          </div>
        </div>
      </section>

      <section class="rounded-md border border-darkborderc p-3">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h4 class="text-base font-semibold">{language.agentPresets.diagnostics}</h4>
            <p class="text-sm text-textcolor2">{language.agentPresets.diagnosticsPending}</p>
          </div>
          <Button size="sm" styled="outlined" disabled>{language.agentPresets.openDiagnostics}</Button>
        </div>
      </section>
    </div>

    <div class="flex justify-end gap-2 border-t border-darkborderc p-4">
      <Button size="sm" styled="outlined" disabled={busy} onclick={requestClose}>{language.agentPresets.cancel}</Button>
      <span data-risu-agent-preset-save>
        <Button size="sm" disabled={!canSave} onclick={savePreset}>
          <span class="inline-flex items-center gap-2"><SaveIcon size={16} />{language.agentPresets.save}</span>
        </Button>
      </span>
    </div>
  </div>
</div>
