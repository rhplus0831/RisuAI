<script lang="ts">
  import { DownloadIcon, HardDriveUploadIcon, PencilIcon, PlusIcon, TrashIcon } from '@lucide/svelte'
  import Help from 'src/lib/Others/Help.svelte'
  import NumberInput from 'src/lib/UI/GUI/NumberInput.svelte'
  import TextAreaInput from 'src/lib/UI/GUI/TextAreaInput.svelte'
  import { alertConfirm, alertError, alertInput, alertNormal } from 'src/ts/alert'
  import { downloadFile } from 'src/ts/globalApi.svelte'
  import { DBState } from 'src/ts/stores.svelte'
  import {
    canUseServerCommands,
    createTranslatorPresetCommand,
    deleteTranslatorPresetCommand,
    runServerCommand,
    selectTranslatorPresetCommand,
    updateTranslatorPresetCommand,
    type ServerCommandResult,
    type TranslatorPresetSnapshot,
  } from 'src/ts/server/commands'
  import {
    getServerProjectionApplyEpoch,
    withTrustedServerProjectionWrite,
  } from 'src/ts/server/projectionWriteGuard.svelte'
  import { applyAttemptedFieldRollback, mergeProjectionIntoDirtyDraft } from 'src/ts/server/staleStateGuards'
  import {
    createTranslatorPreset,
    decodeTranslatorPresetFile,
    defaultTranslatorPrompt,
    encodeTranslatorPresetFile,
    getTranslatorPresetDownloadName,
    normalizeTranslatorPresetState,
    syncCurrentTranslatorPresetToLegacyFields,
    translatorPresetImportExtensions,
  } from 'src/ts/translator/presets'
  import { selectSingleFile } from 'src/ts/util'
  import { language } from 'src/lang'
  import { onDestroy, untrack } from 'svelte'

  type TranslatorPreset = (typeof DBState.db.translatorPresets)[number]
  type TranslatorPresetDirtyField = 'name' | 'prompt' | 'maxResponse'

  interface TranslatorPresetStateSnapshot {
    translatorPresets: TranslatorPreset[]
    translatorPresetId: number
    translatorPrompt: string
    translatorMaxResponse: number
  }

  interface PendingTranslatorPresetUpdate {
    timer: ReturnType<typeof setTimeout> | null
    presetId: string
    patch: TranslatorPresetSnapshot
    previous: TranslatorPresetStateSnapshot | null
    attempted: TranslatorPresetStateSnapshot | null
  }

  const translatorPresetUpdateDelayMs = 250
  const translatorPresetDirtyFieldNames: readonly TranslatorPresetDirtyField[] = ['name', 'prompt', 'maxResponse']
  const pendingTranslatorPresetUpdates = new Map<string, PendingTranslatorPresetUpdate>()
  const translatorPresetDirtyFieldsById = new Map<string, Map<TranslatorPresetDirtyField, unknown>>()
  let translatorPresetUpdateDispatchChain: Promise<ServerCommandResult> = Promise.resolve({ status: 'unavailable' })
  let previousProjectionApplyEpoch = getServerProjectionApplyEpoch()

  function cloneJsonValue<T>(value: T): T {
    if (value === undefined) return value
    return JSON.parse(JSON.stringify(value)) as T
  }

  function snapshotJson(value: unknown): string {
    const snapshot = JSON.stringify(value)
    return snapshot === undefined ? '__undefined__' : snapshot
  }

  function currentTranslatorPresetStateSnapshot(): TranslatorPresetStateSnapshot {
    return {
      translatorPresets: cloneJsonValue(DBState.db.translatorPresets ?? []),
      translatorPresetId: DBState.db.translatorPresetId,
      translatorPrompt: DBState.db.translatorPrompt,
      translatorMaxResponse: DBState.db.translatorMaxResponse,
    }
  }

  function restoreTranslatorPresetState(snapshot: TranslatorPresetStateSnapshot): void {
    withTrustedServerProjectionWrite(() => {
      DBState.db.translatorPresets = cloneJsonValue(snapshot.translatorPresets)
      DBState.db.translatorPresetId = snapshot.translatorPresetId
      DBState.db.translatorPrompt = snapshot.translatorPrompt
      DBState.db.translatorMaxResponse = snapshot.translatorMaxResponse
    })
  }

  function translatorPresetFromSnapshot(
    snapshot: TranslatorPresetStateSnapshot | null,
    presetId: string,
  ): TranslatorPreset | null {
    return snapshot?.translatorPresets.find((preset) => preset.id === presetId) ?? null
  }

  function currentTranslatorPresetById(presetId: string): TranslatorPreset | null {
    return DBState.db.translatorPresets?.find((preset) => preset.id === presetId) ?? null
  }

  function isTranslatorPresetDirtyField(key: string): key is TranslatorPresetDirtyField {
    return translatorPresetDirtyFieldNames.includes(key as TranslatorPresetDirtyField)
  }

  function translatorPresetPatchDirtyFields(patch: TranslatorPresetSnapshot): TranslatorPresetDirtyField[] {
    return Object.keys(patch).filter(isTranslatorPresetDirtyField)
  }

  function markTranslatorPresetDirtyFields(presetId: string, patch: TranslatorPresetSnapshot): void {
    const dirtyPatchFields = translatorPresetPatchDirtyFields(patch)
    if (dirtyPatchFields.length === 0) return

    let dirtyFields = translatorPresetDirtyFieldsById.get(presetId)
    if (!dirtyFields) {
      dirtyFields = new Map()
      translatorPresetDirtyFieldsById.set(presetId, dirtyFields)
    }

    for (const field of dirtyPatchFields) {
      dirtyFields.set(field, cloneJsonValue(patch[field]))
    }
  }

  function clearTranslatorPresetDirtyFieldsMatchingValues(
    presetId: string,
    values: Record<string, unknown>,
    fields: Iterable<TranslatorPresetDirtyField>,
  ): void {
    const dirtyFields = translatorPresetDirtyFieldsById.get(presetId)
    if (!dirtyFields) return

    for (const field of fields) {
      if (snapshotJson(dirtyFields.get(field)) === snapshotJson(values[field])) {
        dirtyFields.delete(field)
      }
    }

    if (dirtyFields.size === 0) {
      translatorPresetDirtyFieldsById.delete(presetId)
    }
  }

  function translatorPresetDirtyRollbackFields(
    presetId: string,
    attemptedPreset: TranslatorPreset,
    patch: TranslatorPresetSnapshot,
  ): TranslatorPresetDirtyField[] {
    const dirtyFields = translatorPresetDirtyFieldsById.get(presetId)
    if (!dirtyFields) return []

    return translatorPresetPatchDirtyFields(patch).filter(
      (field) =>
        dirtyFields.has(field) && snapshotJson(dirtyFields.get(field)) === snapshotJson(attemptedPreset[field]),
    )
  }

  function projectionMatchesTranslatorPresetDirtyValue(
    preset: TranslatorPreset,
    presetIndex: number,
    field: TranslatorPresetDirtyField,
    value: unknown,
  ): boolean {
    if (snapshotJson(preset[field]) !== snapshotJson(value)) return false
    if (DBState.db.translatorPresetId !== presetIndex) return true
    if (field === 'prompt') return snapshotJson(DBState.db.translatorPrompt) === snapshotJson(value)
    if (field === 'maxResponse') return snapshotJson(DBState.db.translatorMaxResponse) === snapshotJson(value)
    return true
  }

  function clearTranslatorPresetDirtyFieldsMatchingProjection(
    preset: TranslatorPreset,
    presetIndex: number,
    dirtyFields: Map<TranslatorPresetDirtyField, unknown>,
  ): void {
    for (const [field, value] of Array.from(dirtyFields.entries())) {
      if (projectionMatchesTranslatorPresetDirtyValue(preset, presetIndex, field, value)) {
        dirtyFields.delete(field)
      }
    }
  }

  function reassertDirtyTranslatorPresetFields(
    presetId: string,
    dirtyFields: ReadonlyMap<TranslatorPresetDirtyField, unknown>,
  ): void {
    if (dirtyFields.size === 0) return

    withTrustedServerProjectionWrite(() => {
      const presets = DBState.db.translatorPresets ?? []
      const presetIndex = presets.findIndex((preset) => preset.id === presetId)
      if (presetIndex === -1) {
        translatorPresetDirtyFieldsById.delete(presetId)
        return
      }

      const projectionPreset = presets[presetIndex]
      const dirtyFieldSet = new Set(dirtyFields.keys())
      const dirtyDraft = cloneJsonValue(projectionPreset) as Record<string, unknown>
      for (const [field, value] of dirtyFields) {
        dirtyDraft[field] = cloneJsonValue(value)
      }

      presets[presetIndex] = mergeProjectionIntoDirtyDraft({
        draft: dirtyDraft,
        projection: projectionPreset as Record<string, unknown>,
        dirtyFields: dirtyFieldSet,
      }) as TranslatorPreset

      if (DBState.db.translatorPresetId === presetIndex) {
        syncCurrentTranslatorPreset()
      }
    })
  }

  function reconcileTranslatorPresetProjectionEpoch(): void {
    if (translatorPresetDirtyFieldsById.size === 0) return

    const presets = DBState.db.translatorPresets ?? []
    for (const [presetId, dirtyFields] of Array.from(translatorPresetDirtyFieldsById.entries())) {
      const presetIndex = presets.findIndex((preset) => preset.id === presetId)
      if (presetIndex === -1) {
        translatorPresetDirtyFieldsById.delete(presetId)
        continue
      }

      clearTranslatorPresetDirtyFieldsMatchingProjection(presets[presetIndex], presetIndex, dirtyFields)
      if (dirtyFields.size === 0) {
        translatorPresetDirtyFieldsById.delete(presetId)
        continue
      }

      reassertDirtyTranslatorPresetFields(presetId, dirtyFields)
    }
  }

  function restoreTranslatorPresetUpdateState(
    presetId: string,
    previous: TranslatorPresetStateSnapshot | null,
    attempted: TranslatorPresetStateSnapshot | null,
    patch: TranslatorPresetSnapshot,
  ): void {
    const attemptedPreset = translatorPresetFromSnapshot(attempted, presetId)
    const previousPreset = translatorPresetFromSnapshot(previous, presetId)
    const currentPreset = currentTranslatorPresetById(presetId)

    if (!attemptedPreset || !previousPreset || !currentPreset) {
      return
    }

    const rollbackFields = translatorPresetDirtyRollbackFields(presetId, attemptedPreset, patch)
    if (rollbackFields.length === 0) return

    withTrustedServerProjectionWrite(() => {
      const presetIndex = DBState.db.translatorPresets.findIndex((preset) => preset.id === presetId)
      if (presetIndex === -1) return

      const nextPresets = [...DBState.db.translatorPresets]
      const nextPreset = cloneJsonValue(nextPresets[presetIndex]) as Record<string, unknown>
      const rolledBackFields = applyAttemptedFieldRollback({
        target: nextPreset,
        previous: previousPreset as Record<string, unknown>,
        attempted: attemptedPreset as Record<string, unknown>,
        keys: rollbackFields,
      }) as TranslatorPresetDirtyField[]
      if (rolledBackFields.length === 0) return

      nextPresets[presetIndex] = nextPreset as TranslatorPreset
      DBState.db.translatorPresets = nextPresets

      if (DBState.db.translatorPresetId === presetIndex) {
        syncCurrentTranslatorPreset()
      }

      clearTranslatorPresetDirtyFieldsMatchingValues(
        presetId,
        attemptedPreset as Record<string, unknown>,
        rolledBackFields,
      )
    })
  }

  function createClientTranslatorPresetId(): string {
    return crypto.randomUUID()
  }

  function normalizeTranslatorPresets() {
    normalizeTranslatorPresetState(DBState.db)
  }

  function syncCurrentTranslatorPreset() {
    syncCurrentTranslatorPresetToLegacyFields(DBState.db)
  }

  function applyTranslatorPresetPatchToDBState(presetId: string, patch: TranslatorPresetSnapshot): void {
    withTrustedServerProjectionWrite(() => {
      const presets = DBState.db.translatorPresets ?? []
      const presetIndex = presets.findIndex((preset) => preset.id === presetId)
      if (presetIndex === -1) return

      const nextPreset = {
        ...presets[presetIndex],
        ...cloneJsonValue(patch),
      } as TranslatorPreset
      const nextPresets = [...presets]
      nextPresets[presetIndex] = nextPreset
      DBState.db.translatorPresets = nextPresets

      if (DBState.db.translatorPresetId === presetIndex) {
        syncCurrentTranslatorPreset()
      }
    })
  }

  function selectedTranslatorPresetId(): string | null {
    if (!canUseServerCommands()) {
      normalizeTranslatorPresets()
    }
    return DBState.db.translatorPresets[DBState.db.translatorPresetId]?.id ?? null
  }

  function runTranslatorPresetCommand<T extends Record<string, unknown>>(
    command: (baseRevision: number) => Promise<ServerCommandResult<T>>,
    rollback?: () => void,
  ): void {
    if (!canUseServerCommands()) return
    void runServerCommand({ command, rollback })
  }

  function dispatchCreateTranslatorPreset(preset: TranslatorPreset, previous: TranslatorPresetStateSnapshot): void {
    runTranslatorPresetCommand(
      (baseRevision) =>
        createTranslatorPresetCommand({
          baseRevision,
          preset: cloneJsonValue(preset) as TranslatorPresetSnapshot,
          select: true,
        }),
      () => restoreTranslatorPresetState(previous),
    )
  }

  function dispatchSelectTranslatorPreset(presetId: string, previous: TranslatorPresetStateSnapshot): void {
    runTranslatorPresetCommand(
      (baseRevision) =>
        selectTranslatorPresetCommand({
          baseRevision,
          presetId,
        }),
      () => restoreTranslatorPresetState(previous),
    )
  }

  function dispatchDeleteTranslatorPreset(
    presetId: string,
    selectPresetId: string | undefined,
    previous: TranslatorPresetStateSnapshot,
  ): void {
    runTranslatorPresetCommand(
      (baseRevision) =>
        deleteTranslatorPresetCommand({
          baseRevision,
          presetId,
          selectPresetId,
        }),
      () => restoreTranslatorPresetState(previous),
    )
  }

  function dispatchPendingTranslatorPresetUpdate(pending: PendingTranslatorPresetUpdate): Promise<ServerCommandResult> {
    if (pending.timer) {
      clearTimeout(pending.timer)
      pending.timer = null
    }
    pendingTranslatorPresetUpdates.delete(pending.presetId)

    const commandPresetId = pending.presetId
    const commandPatch = pending.patch
    const commandPrevious = pending.previous
    const commandAttempted = pending.attempted

    const dispatch = () =>
      runServerCommand({
        command: (baseRevision) =>
          updateTranslatorPresetCommand({
            baseRevision,
            presetId: commandPresetId,
            patch: commandPatch,
          }),
        rollback: () => {
          restoreTranslatorPresetUpdateState(commandPresetId, commandPrevious, commandAttempted, commandPatch)
        },
      })

    translatorPresetUpdateDispatchChain = translatorPresetUpdateDispatchChain.then(dispatch, dispatch)
    return translatorPresetUpdateDispatchChain
  }

  async function flushPendingTranslatorPresetUpdates(): Promise<void> {
    if (!canUseServerCommands()) return
    for (const pending of Array.from(pendingTranslatorPresetUpdates.values())) {
      await dispatchPendingTranslatorPresetUpdate(pending)
    }
    await translatorPresetUpdateDispatchChain
  }

  function queueTranslatorPresetUpdate(
    presetId: string,
    patch: TranslatorPresetSnapshot,
    previous: TranslatorPresetStateSnapshot,
  ): void {
    if (!canUseServerCommands()) return

    const pending = pendingTranslatorPresetUpdates.get(presetId) ?? {
      timer: null,
      presetId,
      patch: {},
      previous: null,
      attempted: null,
    }
    pending.previous ??= previous
    pending.attempted = currentTranslatorPresetStateSnapshot()
    pending.patch = {
      ...pending.patch,
      ...patch,
    }
    pendingTranslatorPresetUpdates.set(presetId, pending)

    if (pending.timer) clearTimeout(pending.timer)
    pending.timer = setTimeout(() => {
      void dispatchPendingTranslatorPresetUpdate(pending)
    }, translatorPresetUpdateDelayMs)
  }

  $effect(() => {
    const projectionApplyEpoch = getServerProjectionApplyEpoch()
    if (projectionApplyEpoch === previousProjectionApplyEpoch) return

    previousProjectionApplyEpoch = projectionApplyEpoch
    untrack(() => reconcileTranslatorPresetProjectionEpoch())
  })

  onDestroy(() => {
    void flushPendingTranslatorPresetUpdates()
  })
</script>

<span class="text-textcolor mt-4">Preset</span>
<select
  class={'border border-darkborderc focus:border-borderc rounded-md shadow-xs text-textcolor bg-transparent focus:ring-borderc focus:ring-2 focus:outline-hidden transition-colors duration-200 text-md px-4 py-2 mb-1'}
  bind:value={
    () => DBState.db.translatorPresetId,
    (value) => {
      const presetIndex = Number(value)
      const presetId = DBState.db.translatorPresets[presetIndex]?.id ?? null
      if (!canUseServerCommands()) {
        const previous = currentTranslatorPresetStateSnapshot()
        DBState.db.translatorPresetId = presetIndex
        syncCurrentTranslatorPreset()
        if (presetId) dispatchSelectTranslatorPreset(presetId, previous)
      } else if (presetId) {
        void flushPendingTranslatorPresetUpdates().finally(() => {
          const previous = currentTranslatorPresetStateSnapshot()
          dispatchSelectTranslatorPreset(presetId, previous)
        })
      }
    }
  }>
  {#each DBState.db.translatorPresets as preset, i}
    <option class="bg-darkbg appearance-none" value={i}>{preset.name}</option>
  {/each}
</select>

<div class="flex items-center mb-4">
  <button
    class="mr-2 text-textcolor2 hover:text-green-500 cursor-pointer"
    onclick={async () => {
      await flushPendingTranslatorPresetUpdates()
      const previous = currentTranslatorPresetStateSnapshot()
      const newPreset = createTranslatorPreset()
      newPreset.id = createClientTranslatorPresetId()
      if (!canUseServerCommands()) {
        const presets = DBState.db.translatorPresets
        presets.push(newPreset)
        DBState.db.translatorPresets = presets
        DBState.db.translatorPresetId = DBState.db.translatorPresets.length - 1
        normalizeTranslatorPresets()
        dispatchCreateTranslatorPreset(DBState.db.translatorPresets[DBState.db.translatorPresetId], previous)
      } else {
        dispatchCreateTranslatorPreset(newPreset, previous)
      }
    }}>
    <PlusIcon size={24} />
  </button>

  <button
    class="mr-2 text-textcolor2 hover:text-green-500 cursor-pointer"
    onclick={async () => {
      const presets = DBState.db.translatorPresets

      if (presets.length === 0) {
        alertError('There must be at least one preset.')
        return
      }

      const id = DBState.db.translatorPresetId
      const preset = presets[id]
      const newName = await alertInput(`Enter new name for ${preset.name}`, [], preset.name)

      if (!newName || newName.trim().length === 0) return

      const previous = currentTranslatorPresetStateSnapshot()
      const presetId = selectedTranslatorPresetId()
      if (!canUseServerCommands()) {
        preset.name = newName
        DBState.db.translatorPresets = presets
        syncCurrentTranslatorPreset()
      } else if (presetId) {
        markTranslatorPresetDirtyFields(presetId, { name: newName })
        applyTranslatorPresetPatchToDBState(presetId, { name: newName })
      }
      if (presetId) queueTranslatorPresetUpdate(presetId, { name: newName }, previous)
    }}>
    <PencilIcon size={24} />
  </button>

  <button
    class="mr-2 text-textcolor2 hover:text-green-500 cursor-pointer"
    onclick={async () => {
      const presets = DBState.db.translatorPresets

      if (presets.length <= 1) {
        alertError('There must be at least one preset.')
        return
      }

      const id = DBState.db.translatorPresetId
      const preset = presets[id]
      const confirmed = await alertConfirm(`${language.removeConfirm}${preset.name}`)

      if (!confirmed) return

      await flushPendingTranslatorPresetUpdates()
      if (!canUseServerCommands()) {
        normalizeTranslatorPresets()
      }
      const previous = currentTranslatorPresetStateSnapshot()
      const presetId = preset.id
      let selectPresetId: string | undefined
      if (!canUseServerCommands()) {
        DBState.db.translatorPresetId = 0
        presets.splice(id, 1)
        DBState.db.translatorPresets = presets
        normalizeTranslatorPresets()
        selectPresetId = DBState.db.translatorPresets[DBState.db.translatorPresetId]?.id
      } else {
        const nextPresets = cloneJsonValue(presets)
        nextPresets.splice(id, 1)
        selectPresetId = nextPresets[0]?.id
      }
      if (presetId) {
        dispatchDeleteTranslatorPreset(presetId, selectPresetId, previous)
      }
    }}>
    <TrashIcon size={24} />
  </button>

  <div class="ml-2 mr-4 w-px h-full bg-darkborderc"></div>

  <button
    class="mr-2 text-textcolor2 hover:text-green-500 cursor-pointer"
    onclick={async () => {
      try {
        const presets = DBState.db.translatorPresets

        if (presets.length === 0) {
          alertError('There must be at least one preset.')
          return
        }

        const preset = presets[DBState.db.translatorPresetId]
        await downloadFile(getTranslatorPresetDownloadName(preset.name), await encodeTranslatorPresetFile(preset))
        alertNormal(language.successExport)
      } catch (error) {
        alertError(`${error}`)
      }
    }}>
    <DownloadIcon size={24} />
  </button>

  <button
    class="mr-2 text-textcolor2 hover:text-green-500 cursor-pointer"
    onclick={async () => {
      try {
        const selectedFile = await selectSingleFile(translatorPresetImportExtensions)

        if (!selectedFile) return

        const newPreset = await decodeTranslatorPresetFile(selectedFile.data)
        newPreset.id = createClientTranslatorPresetId()
        await flushPendingTranslatorPresetUpdates()
        const previous = currentTranslatorPresetStateSnapshot()
        if (!canUseServerCommands()) {
          const presets = DBState.db.translatorPresets

          presets.push(newPreset)
          DBState.db.translatorPresets = presets
          DBState.db.translatorPresetId = DBState.db.translatorPresets.length - 1
          normalizeTranslatorPresets()
          dispatchCreateTranslatorPreset(DBState.db.translatorPresets[DBState.db.translatorPresetId], previous)
        } else {
          dispatchCreateTranslatorPreset(newPreset, previous)
        }

        alertNormal(language.successImport)
      } catch (error) {
        alertError(`${error}`)
      }
    }}>
    <HardDriveUploadIcon size={24} />
  </button>
</div>

{#if DBState.db.translatorPresets?.[DBState.db.translatorPresetId]}
  {@const preset = DBState.db.translatorPresets[DBState.db.translatorPresetId]}
  <span class="text-textcolor mt-4">{language.translationResponseSize}</span>
  <NumberInput
    min={0}
    max={2048}
    marginBottom={true}
    bind:value={
      () => preset.maxResponse,
      (value) => {
        const previous = currentTranslatorPresetStateSnapshot()
        const presetId = selectedTranslatorPresetId()
        if (!canUseServerCommands()) {
          preset.maxResponse = value
          syncCurrentTranslatorPreset()
        } else if (presetId) {
          markTranslatorPresetDirtyFields(presetId, { maxResponse: value })
          applyTranslatorPresetPatchToDBState(presetId, { maxResponse: value })
        }
        if (presetId) queueTranslatorPresetUpdate(presetId, { maxResponse: value }, previous)
      }
    } />
  <span class="text-textcolor mt-4">{language.translatorPrompt} <Help key="translatorPrompt" /></span>
  <TextAreaInput
    bind:value={
      () => preset.prompt,
      (value) => {
        const previous = currentTranslatorPresetStateSnapshot()
        const presetId = selectedTranslatorPresetId()
        if (!canUseServerCommands()) {
          preset.prompt = value
          syncCurrentTranslatorPreset()
        } else if (presetId) {
          markTranslatorPresetDirtyFields(presetId, { prompt: value })
          applyTranslatorPresetPatchToDBState(presetId, { prompt: value })
        }
        if (presetId) queueTranslatorPresetUpdate(presetId, { prompt: value }, previous)
      }
    }
    placeholder={defaultTranslatorPrompt} />
{/if}
