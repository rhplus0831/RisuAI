<script lang="ts">
  import { PencilIcon, RotateCcwIcon, SaveIcon, XIcon } from '@lucide/svelte'
  import { language } from 'src/lang'
  import Button from 'src/lib/UI/GUI/Button.svelte'
  import {
    normalizeModelRuntimeDefaults,
    type ModelProfileRecordRuntimeOptions,
  } from 'src/ts/model/modelProfileRecords'
  import { updateModelRuntimeDefaultsDurably } from 'src/ts/model/modelProfileMutations'
  import type { ServerCommandResult } from 'src/ts/server/commands'
  import { getDatabase } from 'src/ts/storage/database.svelte'
  import ModelRuntimeOptionsEditor from './ModelRuntimeOptionsEditor.svelte'

  let editing = $state(false)
  let saving = $state(false)
  let queuedRuntimeDefaults = $state<ModelProfileRecordRuntimeOptions | null>(null)
  let commandError = $state('')
  let commandNotice = $state('')
  let draft = $state<ModelProfileRecordRuntimeOptions>({})
  let editBaseline = $state<ModelProfileRecordRuntimeOptions>({})
  let lastServerSnapshot = $state('')

  let runtimeDefaults = $derived(normalizeModelRuntimeDefaults(getDatabase().modelRuntimeDefaults))
  let saveQueued = $derived(queuedRuntimeDefaults !== null)
  let runtimeDefaultCount = $derived(Object.keys(runtimeDefaults).length)
  let draftRuntimeDefaultCount = $derived(Object.keys(normalizeModelRuntimeDefaults(draft)).length)
  let draftChanged = $derived(snapshot(draft) !== snapshot(runtimeDefaults))

  $effect(() => {
    const nextSnapshot = snapshot(runtimeDefaults)
    if (nextSnapshot === lastServerSnapshot) return
    lastServerSnapshot = nextSnapshot
    if (!editing) {
      draft = cloneJsonValue(runtimeDefaults)
      editBaseline = cloneJsonValue(runtimeDefaults)
      commandError = ''
      return
    }

    draft = rebaseDirtyRuntimeDefaults(editBaseline, draft, runtimeDefaults)
    editBaseline = cloneJsonValue(runtimeDefaults)
  })

  $effect(() => {
    if (!queuedRuntimeDefaults || snapshot(queuedRuntimeDefaults) !== snapshot(runtimeDefaults)) return
    queuedRuntimeDefaults = null
    commandNotice = ''
  })

  function cloneJsonValue<T>(value: T): T {
    if (value === undefined) return value
    return JSON.parse(JSON.stringify(value)) as T
  }

  function snapshot(value: unknown): string {
    return JSON.stringify(value ?? {})
  }

  function snapshotValue(value: unknown): string {
    const serialized = JSON.stringify(value)
    return serialized === undefined ? '__undefined__' : serialized
  }

  function rebaseDirtyRuntimeDefaults(
    baseline: ModelProfileRecordRuntimeOptions,
    attempted: ModelProfileRecordRuntimeOptions,
    projection: ModelProfileRecordRuntimeOptions,
  ): ModelProfileRecordRuntimeOptions {
    const baselineRecord = baseline as Record<string, unknown>
    const attemptedRecord = attempted as Record<string, unknown>
    const next = cloneJsonValue(projection) as Record<string, unknown>
    const keys = new Set([...Object.keys(baselineRecord), ...Object.keys(attemptedRecord)])

    for (const key of keys) {
      if (snapshotValue(baselineRecord[key]) === snapshotValue(attemptedRecord[key])) continue
      if (Object.prototype.hasOwnProperty.call(attemptedRecord, key)) {
        next[key] = cloneJsonValue(attemptedRecord[key])
      } else {
        delete next[key]
      }
    }

    return normalizeModelRuntimeDefaults(next)
  }

  function startEditing(): void {
    if (saveQueued) return
    draft = cloneJsonValue(runtimeDefaults)
    editBaseline = cloneJsonValue(runtimeDefaults)
    lastServerSnapshot = snapshot(runtimeDefaults)
    commandError = ''
    commandNotice = ''
    editing = true
  }

  function cancelEditing(): void {
    if (saving) return
    draft = cloneJsonValue(runtimeDefaults)
    editBaseline = cloneJsonValue(runtimeDefaults)
    commandError = ''
    editing = false
  }

  function resetDraft(): void {
    if (saving) return
    draft = {}
    commandError = ''
  }

  function commandErrorMessage(result: Exclude<ServerCommandResult, { status: 'ok' }>): string {
    return result.status === 'conflict'
      ? language.modelProfiles.commandConflict
      : result.status === 'error'
        ? result.error
        : language.modelProfiles.commandUnavailable
  }

  async function saveDefaults(): Promise<void> {
    if (saving || saveQueued) return
    saving = true
    commandError = ''
    commandNotice = ''
    const runtimeDefaultsDraft = cloneJsonValue(normalizeModelRuntimeDefaults(draft))
    const outcome = await updateModelRuntimeDefaultsDurably(runtimeDefaultsDraft)
    saving = false

    if (outcome.status === 'accepted') {
      editing = false
      return
    }
    if (outcome.status === 'queued') {
      editing = false
      queuedRuntimeDefaults = cloneJsonValue(runtimeDefaultsDraft)
      commandNotice = language.modelProfiles.commandQueued
      return
    }
    commandError = commandErrorMessage(outcome.result)
  }
</script>

<section class="rounded-md border border-darkborderc p-3" aria-busy={saving}>
  <fieldset data-model-runtime-defaults-form class="m-0 min-w-0 border-0 p-0" disabled={saving} aria-busy={saving}>
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="flex flex-col gap-1">
        <h3 class="text-lg font-semibold">{language.modelProfiles.runtimeDefaultsTitle}</h3>
        <span class="text-sm text-textcolor2">
          {runtimeDefaultCount === 0
            ? language.modelProfiles.runtimeDefaultsEmpty
            : language.modelProfiles.runtimeDefaultsSummary(runtimeDefaultCount)}
        </span>
      </div>
      {#if editing}
        <div class="flex gap-2">
          <Button size="sm" styled="outlined" disabled={saving || draftRuntimeDefaultCount === 0} onclick={resetDraft}>
            <span class="inline-flex items-center gap-1"
              ><RotateCcwIcon size={14} />{language.modelProfiles.reset}</span>
          </Button>
          <Button size="sm" styled="outlined" disabled={saving} onclick={cancelEditing}>
            <span class="inline-flex items-center gap-1"><XIcon size={14} />{language.modelProfiles.cancel}</span>
          </Button>
          <Button size="sm" disabled={saving || !draftChanged} onclick={saveDefaults}>
            <span class="inline-flex items-center gap-2"
              ><SaveIcon size={16} />{saving ? language.modelProfiles.saving : language.modelProfiles.save}</span>
          </Button>
        </div>
      {:else}
        <Button size="sm" styled="outlined" disabled={saveQueued} onclick={startEditing}>
          <span class="inline-flex items-center gap-2"><PencilIcon size={16} />{language.modelProfiles.edit}</span>
        </Button>
      {/if}
    </div>

    {#if commandError}
      <div class="mt-3 rounded-md border border-draculared p-2 text-sm text-draculared">{commandError}</div>
    {/if}
    {#if commandNotice}
      <div class="mt-3 rounded-md border border-selected p-2 text-sm text-textcolor" data-model-runtime-command-notice>
        {commandNotice}
      </div>
    {/if}

    {#if editing}
      <div class="mt-4">
        <ModelRuntimeOptionsEditor bind:value={draft} />
      </div>
    {/if}
  </fieldset>
</section>
