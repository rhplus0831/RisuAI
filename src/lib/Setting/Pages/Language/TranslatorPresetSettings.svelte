<script lang="ts">
  import { DownloadIcon, HardDriveUploadIcon, PencilIcon, PlusIcon, TrashIcon } from '@lucide/svelte'
  import Help from 'src/lib/Others/Help.svelte'
  import NumberInput from 'src/lib/UI/GUI/NumberInput.svelte'
  import TextAreaInput from 'src/lib/UI/GUI/TextAreaInput.svelte'
  import { alertConfirm, alertError, alertInput, alertNormal } from 'src/ts/alert'
  import { downloadFile } from 'src/ts/globalApi.svelte'
  import { getDatabase } from 'src/ts/storage/database.svelte'
  import {
    canUseServerCommands,
    createTranslatorPresetCommand,
    deleteTranslatorPresetCommand,
    runServerCommand,
    selectTranslatorPresetCommand,
    subscribeServerCommandLocalEffectApplied,
    updateTranslatorPresetCommand,
    type ServerCommandResult,
    type TranslatorPresetPatchOptimisticAcknowledgement,
    type TranslatorPresetSnapshot,
  } from 'src/ts/server/commands'
  import {
    captureCollectionProjectionEpoch,
    captureSettingsGroupProjectionEpoch,
    hasCollectionProjectionEpochChanged,
    hasSettingsGroupProjectionEpochChanged,
    markCollectionAcknowledgementTainted,
    markSettingsGroupAcknowledgementTainted,
  } from 'src/ts/server/resourceState.svelte'
  import { getServerResourceApplyEpoch, withTrustedResourceWrite } from 'src/ts/server/resourceWriteGuard.svelte'
  import {
    applyAttemptedFieldRollback,
    applyAttemptedKeyedListRollback,
    mergeProjectionIntoDirtyDraft,
  } from 'src/ts/server/staleStateGuards'
  import {
    createTranslatorPreset,
    decodeTranslatorPresetFile,
    defaultTranslatorPrompt,
    encodeTranslatorPresetFile,
    getTranslatorPresetDownloadName,
    normalizeTranslatorPresetState,
    syncCurrentTranslatorPresetToLegacyFields,
    translatorPresetImportExtensions,
    type TranslatorPreset,
  } from 'src/ts/translator/presets'
  import { selectSingleFile } from 'src/ts/util'
  import { language } from 'src/lang'
  import { onDestroy, untrack } from 'svelte'

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
    previous: TranslatorPresetSnapshot
    attempted: TranslatorPresetSnapshot
    collectionProjectionEpoch: number
    languageSettingsProjectionEpoch: number
    selectedPresetId: string | null
  }

  interface TranslatorPresetCreateAttempt {
    attemptedPreset: TranslatorPreset & { id: string }
    previousSelectedPresetId: string | null
    attemptedTranslatorPrompt: string
    attemptedTranslatorMaxResponse: number
    collectionProjectionEpoch: number
    languageSettingsProjectionEpoch: number
  }

  interface TranslatorPresetSelectionAttempt {
    attemptedPresetId: string
    previousSelectedPresetId: string | null
    attemptedTranslatorPrompt: string
    attemptedTranslatorMaxResponse: number
    collectionProjectionEpoch: number
    languageSettingsProjectionEpoch: number
  }

  const translatorPresetUpdateDelayMs = 250
  const translatorPresetDirtyFieldNames: readonly TranslatorPresetDirtyField[] = ['name', 'prompt', 'maxResponse']
  const pendingTranslatorPresetUpdates = new Map<string, PendingTranslatorPresetUpdate>()
  const translatorPresetDirtyFieldsById = new Map<string, Map<TranslatorPresetDirtyField, unknown>>()
  const unsettledTranslatorPresetFieldsById = new Map<string, Map<TranslatorPresetDirtyField, number>>()

  function translatorPresetRecord(preset: TranslatorPreset): Record<string, unknown> {
    return preset as unknown as Record<string, unknown>
  }

  function translatorPresetFromRecord(preset: Record<string, unknown>): TranslatorPreset {
    return preset as unknown as TranslatorPreset
  }
  let translatorPresetUpdateDispatchChain: Promise<ServerCommandResult> = Promise.resolve({ status: 'unavailable' })
  let previousResourceApplyEpoch = getServerResourceApplyEpoch()

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
      translatorPresets: cloneJsonValue(getDatabase().translatorPresets ?? []),
      translatorPresetId: getDatabase().translatorPresetId,
      translatorPrompt: getDatabase().translatorPrompt,
      translatorMaxResponse: getDatabase().translatorMaxResponse,
    }
  }

  function translatorPresetFromSnapshot(
    snapshot: TranslatorPresetStateSnapshot | null,
    presetId: string,
  ): TranslatorPreset | null {
    return snapshot?.translatorPresets.find((preset) => preset.id === presetId) ?? null
  }

  function currentTranslatorPresetById(presetId: string): TranslatorPreset | null {
    return getDatabase().translatorPresets?.find((preset) => preset.id === presetId) ?? null
  }

  function isTranslatorPresetDirtyField(key: string): key is TranslatorPresetDirtyField {
    return translatorPresetDirtyFieldNames.includes(key as TranslatorPresetDirtyField)
  }

  function translatorPresetPatchDirtyFields(patch: TranslatorPresetSnapshot): TranslatorPresetDirtyField[] {
    return Object.keys(patch).filter(isTranslatorPresetDirtyField)
  }

  function markTranslatorPresetFieldsUnsettled(presetId: string, fields: readonly TranslatorPresetDirtyField[]): void {
    let unsettledFields = unsettledTranslatorPresetFieldsById.get(presetId)
    if (!unsettledFields) {
      unsettledFields = new Map()
      unsettledTranslatorPresetFieldsById.set(presetId, unsettledFields)
    }

    for (const field of fields) {
      unsettledFields.set(field, (unsettledFields.get(field) ?? 0) + 1)
    }
  }

  function clearTranslatorPresetFieldsUnsettled(presetId: string, fields: readonly TranslatorPresetDirtyField[]): void {
    const unsettledFields = unsettledTranslatorPresetFieldsById.get(presetId)
    if (!unsettledFields) return

    for (const field of fields) {
      const remaining = (unsettledFields.get(field) ?? 0) - 1
      if (remaining > 0) unsettledFields.set(field, remaining)
      else unsettledFields.delete(field)
    }

    if (unsettledFields.size === 0) {
      unsettledTranslatorPresetFieldsById.delete(presetId)
    }
  }

  function isTranslatorPresetFieldUnsettled(presetId: string, field: TranslatorPresetDirtyField): boolean {
    return (unsettledTranslatorPresetFieldsById.get(presetId)?.get(field) ?? 0) > 0
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
    attemptedPreset: TranslatorPresetSnapshot,
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
    if (getDatabase().translatorPresetId !== presetIndex) return true
    if (field === 'prompt') return snapshotJson(getDatabase().translatorPrompt) === snapshotJson(value)
    if (field === 'maxResponse') return snapshotJson(getDatabase().translatorMaxResponse) === snapshotJson(value)
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

    withTrustedResourceWrite(() => {
      const presets = getDatabase().translatorPresets ?? []
      const presetIndex = presets.findIndex((preset) => preset.id === presetId)
      if (presetIndex === -1) {
        translatorPresetDirtyFieldsById.delete(presetId)
        return
      }

      const projectionPreset = presets[presetIndex]
      const dirtyFieldSet = new Set(dirtyFields.keys())
      const dirtyDraft = cloneJsonValue(projectionPreset) as unknown as Record<string, unknown>
      for (const [field, value] of dirtyFields) {
        dirtyDraft[field] = cloneJsonValue(value)
      }

      presets[presetIndex] = translatorPresetFromRecord(
        mergeProjectionIntoDirtyDraft({
          draft: dirtyDraft,
          projection: translatorPresetRecord(projectionPreset),
          dirtyFields: dirtyFieldSet,
        }),
      )

      if (getDatabase().translatorPresetId === presetIndex) {
        syncCurrentTranslatorPreset()
      }
    })
  }

  function reconcileTranslatorPresetProjectionEpoch(): void {
    if (translatorPresetDirtyFieldsById.size === 0) return

    const presets = getDatabase().translatorPresets ?? []
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
    previous: TranslatorPresetSnapshot,
    attempted: TranslatorPresetSnapshot,
    patch: TranslatorPresetSnapshot,
  ): void {
    const currentPreset = currentTranslatorPresetById(presetId)

    if (!currentPreset) return

    const rollbackFields = translatorPresetDirtyRollbackFields(presetId, attempted, patch)
    if (rollbackFields.length === 0) return

    withTrustedResourceWrite(() => {
      const presetIndex = getDatabase().translatorPresets.findIndex((preset) => preset.id === presetId)
      if (presetIndex === -1) return

      const nextPresets = [...getDatabase().translatorPresets]
      const nextPreset = cloneJsonValue(nextPresets[presetIndex]) as unknown as Record<string, unknown>
      const rolledBackFields = applyAttemptedFieldRollback({
        target: nextPreset,
        previous,
        attempted,
        keys: rollbackFields,
      }) as TranslatorPresetDirtyField[]
      if (rolledBackFields.length === 0) return

      nextPresets[presetIndex] = translatorPresetFromRecord(nextPreset)
      getDatabase().translatorPresets = nextPresets

      if (getDatabase().translatorPresetId === presetIndex) {
        syncCurrentTranslatorPreset()
      }

      clearTranslatorPresetDirtyFieldsMatchingValues(presetId, attempted, rolledBackFields)
    })
  }

  function createClientTranslatorPresetId(): string {
    return crypto.randomUUID()
  }

  function normalizeTranslatorPresets() {
    normalizeTranslatorPresetState(getDatabase())
  }

  function syncCurrentTranslatorPreset() {
    syncCurrentTranslatorPresetToLegacyFields(getDatabase())
  }

  function applyTranslatorPresetPatchToDatabase(presetId: string, patch: TranslatorPresetSnapshot): void {
    withTrustedResourceWrite(() => {
      const presets = getDatabase().translatorPresets ?? []
      const presetIndex = presets.findIndex((preset) => preset.id === presetId)
      if (presetIndex === -1) return

      const nextPreset = {
        ...presets[presetIndex],
        ...cloneJsonValue(patch),
      } as TranslatorPreset
      const nextPresets = [...presets]
      nextPresets[presetIndex] = nextPreset
      getDatabase().translatorPresets = nextPresets

      if (getDatabase().translatorPresetId === presetIndex) {
        syncCurrentTranslatorPreset()
      }
    })
  }

  function selectedTranslatorPresetId(): string | null {
    if (!canUseServerCommands()) {
      normalizeTranslatorPresets()
    }
    return getDatabase().translatorPresets[getDatabase().translatorPresetId]?.id ?? null
  }

  function translatorPresetPatchOptimisticAcknowledgement(
    pending: PendingTranslatorPresetUpdate,
  ): TranslatorPresetPatchOptimisticAcknowledgement | undefined {
    const currentPreset = currentTranslatorPresetById(pending.presetId)
    const attemptedPreset = currentPreset
      ? {
          id: currentPreset.id,
          name: currentPreset.name,
          prompt: currentPreset.prompt,
          maxResponse: currentPreset.maxResponse,
        }
      : null
    const attemptedKeys = Object.keys(pending.patch)
    if (
      !attemptedPreset ||
      attemptedPreset.id !== pending.presetId ||
      !pending.selectedPresetId ||
      attemptedKeys.length === 0 ||
      attemptedKeys.some(
        (key) =>
          !isTranslatorPresetDirtyField(key) || snapshotJson(attemptedPreset[key]) !== snapshotJson(pending.patch[key]),
      )
    ) {
      return undefined
    }

    return {
      collectionProjectionEpoch: pending.collectionProjectionEpoch,
      languageSettingsProjectionEpoch: pending.languageSettingsProjectionEpoch,
      selectedPresetId: pending.selectedPresetId,
      attemptedPreset,
    }
  }

  const unsubscribeLocalEffectApplied = subscribeServerCommandLocalEffectApplied((_event, localEffect) => {
    if (localEffect.kind !== 'translatorPresetPatch') return
    clearTranslatorPresetDirtyFieldsMatchingValues(
      localEffect.presetId,
      localEffect.attemptedPatch,
      translatorPresetPatchDirtyFields(localEffect.attemptedPatch),
    )
  })

  function runTranslatorPresetCommand<T extends Record<string, unknown>>(
    command: (baseRevision: number) => Promise<ServerCommandResult<T>>,
    rollback?: () => void,
  ): void {
    if (!canUseServerCommands()) return
    void runServerCommand({ command, rollback })
  }

  function applyOptimisticTranslatorPresetCreate(preset: TranslatorPreset): TranslatorPresetCreateAttempt | null {
    const attemptedPreset = cloneJsonValue(preset)
    const presetId = attemptedPreset.id
    if (!presetId || presetId.trim().length === 0) return null
    const attemptedPresetWithId = attemptedPreset as TranslatorPreset & { id: string }

    const attempt: TranslatorPresetCreateAttempt = {
      attemptedPreset: attemptedPresetWithId,
      previousSelectedPresetId: selectedTranslatorPresetId(),
      attemptedTranslatorPrompt: attemptedPresetWithId.prompt,
      attemptedTranslatorMaxResponse: attemptedPresetWithId.maxResponse,
      collectionProjectionEpoch: captureCollectionProjectionEpoch('translatorPresets'),
      languageSettingsProjectionEpoch: captureSettingsGroupProjectionEpoch('language'),
    }
    let applied = false

    withTrustedResourceWrite(() => {
      const presets = getDatabase().translatorPresets ?? []
      if (presets.some((existingPreset) => existingPreset.id === presetId)) return

      const nextPresets = [...presets, cloneJsonValue(attemptedPresetWithId)]
      getDatabase().translatorPresets = nextPresets
      getDatabase().translatorPresetId = nextPresets.length - 1
      syncCurrentTranslatorPreset()
      applied = true
    })

    return applied ? attempt : null
  }

  function rollbackOptimisticTranslatorPresetCreate(attempt: TranslatorPresetCreateAttempt): void {
    markCollectionAcknowledgementTainted('translatorPresets')
    markSettingsGroupAcknowledgementTainted('language')

    if (hasCollectionProjectionEpochChanged('translatorPresets', attempt.collectionProjectionEpoch)) return

    const languageProjectionChanged = hasSettingsGroupProjectionEpochChanged(
      'language',
      attempt.languageSettingsProjectionEpoch,
    )

    withTrustedResourceWrite(() => {
      const presets = getDatabase().translatorPresets ?? []
      const selectedPresetId = presets[getDatabase().translatorPresetId]?.id ?? null
      const selectedAttemptedPreset = selectedPresetId === attempt.attemptedPreset.id
      const selectedProjectionMatchesAttempt =
        getDatabase().translatorPrompt === attempt.attemptedTranslatorPrompt &&
        getDatabase().translatorMaxResponse === attempt.attemptedTranslatorMaxResponse
      const previousSelectedPresetIndex = attempt.previousSelectedPresetId
        ? presets.findIndex((preset) => preset.id === attempt.previousSelectedPresetId)
        : -1

      if (
        selectedAttemptedPreset &&
        (languageProjectionChanged || !selectedProjectionMatchesAttempt || previousSelectedPresetIndex === -1)
      ) {
        return
      }

      const nextPresets = [...presets]
      const rolledBack = applyAttemptedKeyedListRollback<TranslatorPreset, string>({
        list: nextPresets,
        entries: [
          {
            key: attempt.attemptedPreset.id,
            previous: null,
            attempted: attempt.attemptedPreset,
          },
        ],
        getKey: (translatorPreset) => translatorPreset?.id,
      })
      if (rolledBack.length === 0) return

      getDatabase().translatorPresets = nextPresets

      if (selectedAttemptedPreset) {
        const restoreSelectedPresetIndex = nextPresets.findIndex(
          (translatorPreset) => translatorPreset.id === attempt.previousSelectedPresetId,
        )
        if (restoreSelectedPresetIndex === -1) return
        getDatabase().translatorPresetId = restoreSelectedPresetIndex
        syncCurrentTranslatorPreset()
        return
      }

      if (selectedPresetId) {
        const preservedSelectedPresetIndex = nextPresets.findIndex(
          (translatorPreset) => translatorPreset.id === selectedPresetId,
        )
        if (preservedSelectedPresetIndex !== -1) {
          getDatabase().translatorPresetId = preservedSelectedPresetIndex
        }
      }
    })
  }

  function dispatchCreateTranslatorPreset(preset: TranslatorPreset, rollback?: () => void): void {
    runTranslatorPresetCommand(
      (baseRevision) =>
        createTranslatorPresetCommand({
          baseRevision,
          preset: cloneJsonValue(preset) as TranslatorPresetSnapshot,
          select: true,
        }),
      rollback,
    )
  }

  function createTranslatorPresetOptimistically(preset: TranslatorPreset): void {
    const attempt = applyOptimisticTranslatorPresetCreate(preset)
    if (!attempt) return
    dispatchCreateTranslatorPreset(preset, () => rollbackOptimisticTranslatorPresetCreate(attempt))
  }

  function applyOptimisticTranslatorPresetSelection(presetId: string): TranslatorPresetSelectionAttempt | null {
    const presets = getDatabase().translatorPresets ?? []
    const presetIndex = presets.findIndex((preset) => preset.id === presetId)
    if (presetIndex === -1) return null

    const attemptedPreset = presets[presetIndex]
    const attempt: TranslatorPresetSelectionAttempt = {
      attemptedPresetId: presetId,
      previousSelectedPresetId: presets[getDatabase().translatorPresetId]?.id ?? null,
      attemptedTranslatorPrompt: attemptedPreset.prompt,
      attemptedTranslatorMaxResponse: attemptedPreset.maxResponse,
      collectionProjectionEpoch: captureCollectionProjectionEpoch('translatorPresets'),
      languageSettingsProjectionEpoch: captureSettingsGroupProjectionEpoch('language'),
    }
    let applied = false

    withTrustedResourceWrite(() => {
      const livePresetIndex = getDatabase().translatorPresets?.findIndex((preset) => preset.id === presetId) ?? -1
      if (livePresetIndex === -1) return

      getDatabase().translatorPresetId = livePresetIndex
      syncCurrentTranslatorPreset()
      applied = true
    })

    return applied ? attempt : null
  }

  function rollbackOptimisticTranslatorPresetSelection(attempt: TranslatorPresetSelectionAttempt): void {
    markSettingsGroupAcknowledgementTainted('language')

    if (
      hasCollectionProjectionEpochChanged('translatorPresets', attempt.collectionProjectionEpoch) ||
      hasSettingsGroupProjectionEpochChanged('language', attempt.languageSettingsProjectionEpoch)
    ) {
      return
    }

    withTrustedResourceWrite(() => {
      const presets = getDatabase().translatorPresets ?? []
      const selectedPresetId = presets[getDatabase().translatorPresetId]?.id ?? null
      if (selectedPresetId !== attempt.attemptedPresetId) return
      if (
        snapshotJson(getDatabase().translatorPrompt) !== snapshotJson(attempt.attemptedTranslatorPrompt) ||
        snapshotJson(getDatabase().translatorMaxResponse) !== snapshotJson(attempt.attemptedTranslatorMaxResponse)
      ) {
        return
      }

      if (attempt.previousSelectedPresetId === attempt.attemptedPresetId) return
      const previousSelectedPresetIndex = attempt.previousSelectedPresetId
        ? presets.findIndex((preset) => preset.id === attempt.previousSelectedPresetId)
        : -1
      if (previousSelectedPresetIndex === -1) return

      getDatabase().translatorPresetId = previousSelectedPresetIndex
      syncCurrentTranslatorPreset()
    })
  }

  function dispatchSelectTranslatorPreset(presetId: string, rollback?: () => void): void {
    runTranslatorPresetCommand(
      (baseRevision) =>
        selectTranslatorPresetCommand({
          baseRevision,
          presetId,
        }),
      rollback,
    )
  }

  function dispatchOptimisticTranslatorPresetSelection(attempt: TranslatorPresetSelectionAttempt): void {
    dispatchSelectTranslatorPreset(attempt.attemptedPresetId, () =>
      rollbackOptimisticTranslatorPresetSelection(attempt),
    )
  }

  function dispatchDeleteTranslatorPreset(presetId: string, selectPresetId: string | undefined): void {
    runTranslatorPresetCommand((baseRevision) =>
      deleteTranslatorPresetCommand({
        baseRevision,
        presetId,
        selectPresetId,
      }),
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
    const commandFields = translatorPresetPatchDirtyFields(commandPatch)
    const optimisticAcknowledgement = translatorPresetPatchOptimisticAcknowledgement(pending)
    markTranslatorPresetFieldsUnsettled(commandPresetId, commandFields)

    const dispatch = () =>
      runServerCommand({
        command: (baseRevision) =>
          updateTranslatorPresetCommand({
            baseRevision,
            presetId: commandPresetId,
            patch: commandPatch,
            optimisticAcknowledgement,
          }),
        rollback: () => {
          markCollectionAcknowledgementTainted('translatorPresets')
          markSettingsGroupAcknowledgementTainted('language')
          restoreTranslatorPresetUpdateState(commandPresetId, commandPrevious, commandAttempted, commandPatch)
        },
      })

    translatorPresetUpdateDispatchChain = translatorPresetUpdateDispatchChain.then(dispatch, dispatch).finally(() => {
      clearTranslatorPresetFieldsUnsettled(commandPresetId, commandFields)
    })
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
      previous: {},
      attempted: {},
      collectionProjectionEpoch: captureCollectionProjectionEpoch('translatorPresets'),
      languageSettingsProjectionEpoch: captureSettingsGroupProjectionEpoch('language'),
      selectedPresetId: selectedTranslatorPresetId(),
    }
    const previousPreset = translatorPresetFromSnapshot(previous, presetId)
    const pendingPatch = pending.patch as Record<string, unknown>
    const pendingPrevious = pending.previous as Record<string, unknown>
    const pendingAttempted = pending.attempted as Record<string, unknown>

    for (const field of translatorPresetPatchDirtyFields(patch)) {
      if (!(field in pendingPrevious)) {
        pendingPrevious[field] = cloneJsonValue(previousPreset?.[field])
      }

      const attemptedValue = cloneJsonValue(patch[field])
      if (snapshotJson(attemptedValue) === snapshotJson(pendingPrevious[field])) {
        delete pendingPatch[field]
        delete pendingPrevious[field]
        delete pendingAttempted[field]
        if (!isTranslatorPresetFieldUnsettled(presetId, field)) {
          clearTranslatorPresetDirtyFieldsMatchingValues(presetId, { [field]: attemptedValue }, [field])
        }
        continue
      }

      pendingPatch[field] = attemptedValue
      pendingAttempted[field] = attemptedValue
    }

    if (pending.timer) clearTimeout(pending.timer)
    if (translatorPresetPatchDirtyFields(pending.patch).length === 0) {
      pending.timer = null
      pendingTranslatorPresetUpdates.delete(presetId)
      return
    }

    pendingTranslatorPresetUpdates.set(presetId, pending)
    pending.timer = setTimeout(() => {
      void dispatchPendingTranslatorPresetUpdate(pending)
    }, translatorPresetUpdateDelayMs)
  }

  $effect(() => {
    const resourceApplyEpoch = getServerResourceApplyEpoch()
    if (resourceApplyEpoch === previousResourceApplyEpoch) return

    previousResourceApplyEpoch = resourceApplyEpoch
    untrack(() => reconcileTranslatorPresetProjectionEpoch())
  })

  onDestroy(() => {
    unsubscribeLocalEffectApplied()
    void flushPendingTranslatorPresetUpdates()
  })
</script>

<span class="text-textcolor mt-4">Preset</span>
<select
  class={'border border-darkborderc focus:border-borderc rounded-md shadow-xs text-textcolor bg-transparent focus:ring-borderc focus:ring-2 focus:outline-hidden transition-colors duration-200 text-md px-4 py-2 mb-1'}
  bind:value={
    () => getDatabase().translatorPresetId,
    (value) => {
      const presetIndex = Number(value)
      const presetId = getDatabase().translatorPresets[presetIndex]?.id ?? null
      if (!canUseServerCommands()) {
        getDatabase().translatorPresetId = presetIndex
        syncCurrentTranslatorPreset()
        if (presetId) dispatchSelectTranslatorPreset(presetId)
      } else if (presetId) {
        const attempt = applyOptimisticTranslatorPresetSelection(presetId)
        if (!attempt) return
        void flushPendingTranslatorPresetUpdates().finally(() => {
          dispatchOptimisticTranslatorPresetSelection(attempt)
        })
      }
    }
  }>
  {#each getDatabase().translatorPresets as preset, i}
    <option class="bg-darkbg appearance-none" value={i}>{preset.name}</option>
  {/each}
</select>

<div class="flex items-center mb-4">
  <button
    class="mr-2 text-textcolor2 hover:text-green-500 cursor-pointer"
    onclick={async () => {
      await flushPendingTranslatorPresetUpdates()
      const newPreset = createTranslatorPreset()
      newPreset.id = createClientTranslatorPresetId()
      if (!canUseServerCommands()) {
        const presets = getDatabase().translatorPresets
        presets.push(newPreset)
        getDatabase().translatorPresets = presets
        getDatabase().translatorPresetId = getDatabase().translatorPresets.length - 1
        normalizeTranslatorPresets()
        dispatchCreateTranslatorPreset(getDatabase().translatorPresets[getDatabase().translatorPresetId])
      } else {
        createTranslatorPresetOptimistically(newPreset)
      }
    }}>
    <PlusIcon size={24} />
  </button>

  <button
    class="mr-2 text-textcolor2 hover:text-green-500 cursor-pointer"
    onclick={async () => {
      const presets = getDatabase().translatorPresets

      if (presets.length === 0) {
        alertError('There must be at least one preset.')
        return
      }

      const id = getDatabase().translatorPresetId
      const preset = presets[id]
      const newName = await alertInput(`Enter new name for ${preset.name}`, [], preset.name)

      if (!newName || newName.trim().length === 0) return

      const previous = currentTranslatorPresetStateSnapshot()
      const presetId = selectedTranslatorPresetId()
      if (!canUseServerCommands()) {
        preset.name = newName
        getDatabase().translatorPresets = presets
        syncCurrentTranslatorPreset()
      } else if (presetId) {
        markTranslatorPresetDirtyFields(presetId, { name: newName })
        applyTranslatorPresetPatchToDatabase(presetId, { name: newName })
      }
      if (presetId) queueTranslatorPresetUpdate(presetId, { name: newName }, previous)
    }}>
    <PencilIcon size={24} />
  </button>

  <button
    class="mr-2 text-textcolor2 hover:text-green-500 cursor-pointer"
    onclick={async () => {
      const presets = getDatabase().translatorPresets

      if (presets.length <= 1) {
        alertError('There must be at least one preset.')
        return
      }

      const id = getDatabase().translatorPresetId
      const preset = presets[id]
      const confirmed = await alertConfirm(`${language.removeConfirm}${preset.name}`)

      if (!confirmed) return

      await flushPendingTranslatorPresetUpdates()
      if (!canUseServerCommands()) {
        normalizeTranslatorPresets()
      }
      const presetId = preset.id
      let selectPresetId: string | undefined
      if (!canUseServerCommands()) {
        getDatabase().translatorPresetId = 0
        presets.splice(id, 1)
        getDatabase().translatorPresets = presets
        normalizeTranslatorPresets()
        selectPresetId = getDatabase().translatorPresets[getDatabase().translatorPresetId]?.id
      } else {
        const nextPresets = cloneJsonValue(presets)
        nextPresets.splice(id, 1)
        selectPresetId = nextPresets[0]?.id
      }
      if (presetId) {
        dispatchDeleteTranslatorPreset(presetId, selectPresetId)
      }
    }}>
    <TrashIcon size={24} />
  </button>

  <div class="ml-2 mr-4 w-px h-full bg-darkborderc"></div>

  <button
    class="mr-2 text-textcolor2 hover:text-green-500 cursor-pointer"
    onclick={async () => {
      try {
        const presets = getDatabase().translatorPresets

        if (presets.length === 0) {
          alertError('There must be at least one preset.')
          return
        }

        const preset = presets[getDatabase().translatorPresetId]
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
        if (!canUseServerCommands()) {
          const presets = getDatabase().translatorPresets

          presets.push(newPreset)
          getDatabase().translatorPresets = presets
          getDatabase().translatorPresetId = getDatabase().translatorPresets.length - 1
          normalizeTranslatorPresets()
          dispatchCreateTranslatorPreset(getDatabase().translatorPresets[getDatabase().translatorPresetId])
        } else {
          createTranslatorPresetOptimistically(newPreset)
        }

        alertNormal(language.successImport)
      } catch (error) {
        alertError(`${error}`)
      }
    }}>
    <HardDriveUploadIcon size={24} />
  </button>
</div>

{#if getDatabase().translatorPresets?.[getDatabase().translatorPresetId]}
  {@const preset = getDatabase().translatorPresets[getDatabase().translatorPresetId]}
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
          applyTranslatorPresetPatchToDatabase(presetId, { maxResponse: value })
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
          applyTranslatorPresetPatchToDatabase(presetId, { prompt: value })
        }
        if (presetId) queueTranslatorPresetUpdate(presetId, { prompt: value }, previous)
      }
    }
    placeholder={defaultTranslatorPrompt} />
{/if}
