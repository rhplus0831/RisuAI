<script module lang="ts">
  let nextTranslatorPresetFlushId = 1
</script>

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
    type ServerCommandTransportOptions,
    type TranslatorPresetPatchOptimisticAcknowledgement,
    type TranslatorPresetSnapshot,
  } from 'src/ts/server/commands'
  import { registerPendingBridgePatchFlusher } from 'src/ts/server/pendingBridgeFlushRegistry'
  import { dispatchDurableMutation } from 'src/ts/server/durableMutationDispatch'
  import {
    acknowledgePendingMutation,
    isPendingMutationCurrent,
    stagePendingMutation,
    type DurableMutationIntent,
    type PendingMutationHandle,
  } from 'src/ts/server/pendingMutationOutbox'
  import {
    captureCollectionProjectionEpoch,
    captureSettingsGroupProjectionEpoch,
    hasCollectionProjectionEpochChanged,
    markCollectionAcknowledgementTainted,
    markSettingsGroupAcknowledgementTainted,
  } from 'src/ts/server/resourceState.svelte'
  import { getServerResourceApplyEpoch, withTrustedResourceWrite } from 'src/ts/server/resourceWriteGuard.svelte'
  import { applyAttemptedFieldRollback, mergeProjectionIntoDirtyDraft } from 'src/ts/server/staleStateGuards'
  import {
    TRANSLATOR_PRESET_SELECTION_MUTATION_KEY,
    translatorPresetOwnerMutationKey,
  } from 'src/ts/server/translatorPresetMutationKeys'
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
    durableAttempted: TranslatorPresetSnapshot
    collectionProjectionEpoch: number
    languageSettingsProjectionEpoch: number
    selectedPresetId: string | null
    intent: DurableMutationIntent | null
    outbox: PendingMutationHandle | null
  }

  interface TranslatorPresetCreateAttempt {
    operationId: number
    attemptedPreset: TranslatorPreset & { id: string }
    draftPreset: TranslatorPreset & { id: string }
    previousSelectedPresetId: string | null
    collectionProjectionEpoch: number
  }

  interface TranslatorPresetSelectionAttempt {
    operationId: number
    previousSelectedPresetId: string | null
    attemptedPresetId: string
  }

  interface TranslatorPresetDeleteAttempt {
    operationId: number
    deletedPreset: TranslatorPreset & { id: string }
    previousIndex: number
    previousSiblingPresetId: string | null
    nextSiblingPresetId: string | null
    attemptedSelectedPreset: TranslatorPreset & { id: string }
    collectionProjectionEpoch: number
  }

  type PendingTranslatorPresetStructuralMutation =
    | { kind: 'create'; attempt: TranslatorPresetCreateAttempt }
    | { kind: 'select'; attempt: TranslatorPresetSelectionAttempt }
    | { kind: 'delete'; attempt: TranslatorPresetDeleteAttempt }

  const translatorPresetUpdateDelayMs = 250
  const translatorPresetDirtyFieldNames: readonly TranslatorPresetDirtyField[] = ['name', 'prompt', 'maxResponse']
  const pendingTranslatorPresetUpdates = new Map<string, PendingTranslatorPresetUpdate>()
  const translatorPresetDirtyFieldsById = new Map<string, Map<TranslatorPresetDirtyField, unknown>>()
  const translatorPresetRollbackBaselinesById = new Map<string, Map<TranslatorPresetDirtyField, unknown>>()
  const unsettledTranslatorPresetFieldsById = new Map<string, Map<TranslatorPresetDirtyField, number>>()
  const pendingTranslatorPresetStructuralMutations: PendingTranslatorPresetStructuralMutation[] = []
  const translatorPresetCreateOutcomesById = new Map<string, 'pending' | 'succeeded' | 'failed'>()
  let nextTranslatorPresetStructuralOperationId = 1
  let confirmedTranslatorPresetSelectionId: string | null | undefined

  function translatorPresetRecord(preset: TranslatorPreset): Record<string, unknown> {
    return preset as unknown as Record<string, unknown>
  }

  function translatorPresetFromRecord(preset: Record<string, unknown>): TranslatorPreset {
    return preset as unknown as TranslatorPreset
  }
  let translatorPresetUpdateDispatchChain: Promise<ServerCommandResult> = Promise.resolve({ status: 'unavailable' })
  let previousResourceApplyEpoch = getServerResourceApplyEpoch()
  let previousTranslatorPresetCollectionProjectionEpoch = captureCollectionProjectionEpoch('translatorPresets')
  let previousLanguageSettingsProjectionEpoch = captureSettingsGroupProjectionEpoch('language')
  let confirmedTranslatorPresetCollection: TranslatorPreset[] | undefined

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

  function currentSelectedTranslatorPresetId(): string | null {
    return getDatabase().translatorPresets?.[getDatabase().translatorPresetId]?.id ?? null
  }

  function translatorPresetOwnerDependencyKeys(...presetIds: Array<string | null | undefined>): string[] {
    return Array.from(
      new Set(
        presetIds.filter((presetId): presetId is string => Boolean(presetId)).map(translatorPresetOwnerMutationKey),
      ),
    )
  }

  function projectedSelectedTranslatorPresetId(): string | null {
    const selectedIndex = getDatabase().translatorPresetId
    if (Number.isInteger(selectedIndex) && selectedIndex >= 0) {
      const projectedPresetId = confirmedTranslatorPresetCollection?.[selectedIndex]?.id
      if (projectedPresetId) return projectedPresetId
    }
    return currentSelectedTranslatorPresetId()
  }

  function confirmedSelectedTranslatorPresetId(): string | null {
    if (confirmedTranslatorPresetSelectionId === undefined) {
      confirmedTranslatorPresetSelectionId = currentSelectedTranslatorPresetId()
      confirmedTranslatorPresetCollection = cloneJsonValue(getDatabase().translatorPresets ?? [])
    }
    return confirmedTranslatorPresetSelectionId
  }

  function absorbUnreconciledTranslatorPresetProjectionEpochs(): void {
    const collectionProjectionEpoch = captureCollectionProjectionEpoch('translatorPresets')
    if (collectionProjectionEpoch !== previousTranslatorPresetCollectionProjectionEpoch) {
      previousTranslatorPresetCollectionProjectionEpoch = collectionProjectionEpoch
      confirmedTranslatorPresetCollection = cloneJsonValue(getDatabase().translatorPresets ?? [])
    }

    const languageSettingsProjectionEpoch = captureSettingsGroupProjectionEpoch('language')
    if (languageSettingsProjectionEpoch !== previousLanguageSettingsProjectionEpoch) {
      previousLanguageSettingsProjectionEpoch = languageSettingsProjectionEpoch
      confirmedTranslatorPresetSelectionId = projectedSelectedTranslatorPresetId()
    }
  }

  function settleConfirmedTranslatorPresetCreate(attempt: TranslatorPresetCreateAttempt): void {
    const presets = cloneJsonValue(confirmedTranslatorPresetCollection ?? getDatabase().translatorPresets ?? [])
    if (!presets.some((preset) => preset.id === attempt.attemptedPreset.id)) {
      presets.push(cloneJsonValue(attempt.attemptedPreset))
    }
    confirmedTranslatorPresetCollection = presets
    confirmedTranslatorPresetSelectionId = attempt.attemptedPreset.id
  }

  function settleConfirmedTranslatorPresetDelete(attempt: TranslatorPresetDeleteAttempt): void {
    confirmedTranslatorPresetCollection = cloneJsonValue(
      (confirmedTranslatorPresetCollection ?? getDatabase().translatorPresets ?? []).filter(
        (preset) => preset.id !== attempt.deletedPreset.id,
      ),
    )
    confirmedTranslatorPresetSelectionId = attempt.attemptedSelectedPreset.id
  }

  function registerPendingTranslatorPresetStructuralMutation(
    mutation: PendingTranslatorPresetStructuralMutation,
  ): void {
    pendingTranslatorPresetStructuralMutations.push(mutation)
  }

  function removePendingTranslatorPresetStructuralMutation(operationId: number): void {
    const index = pendingTranslatorPresetStructuralMutations.findIndex(
      (mutation) => mutation.attempt.operationId === operationId,
    )
    if (index !== -1) pendingTranslatorPresetStructuralMutations.splice(index, 1)
  }

  function hasPendingTranslatorPresetStructuralMutation(operationId: number): boolean {
    return pendingTranslatorPresetStructuralMutations.some((mutation) => mutation.attempt.operationId === operationId)
  }

  function hasPendingTranslatorPresetCreate(presetId: string): boolean {
    return pendingTranslatorPresetStructuralMutations.some(
      (mutation) => mutation.kind === 'create' && mutation.attempt.attemptedPreset.id === presetId,
    )
  }

  function updatePendingTranslatorPresetCreateDraft(presetId: string, patch: TranslatorPresetSnapshot): void {
    for (const mutation of pendingTranslatorPresetStructuralMutations) {
      if (mutation.kind !== 'create' || mutation.attempt.attemptedPreset.id !== presetId) continue
      mutation.attempt.draftPreset = {
        ...mutation.attempt.draftPreset,
        ...cloneJsonValue(patch),
        id: presetId,
      }
    }
  }

  function cancelPendingTranslatorPresetUpdates(presetId: string): void {
    const pending = pendingTranslatorPresetUpdates.get(presetId)
    if (pending?.timer) clearTimeout(pending.timer)
    if (pending?.outbox) void acknowledgePendingMutation(pending.outbox)
    pendingTranslatorPresetUpdates.delete(presetId)
    translatorPresetDirtyFieldsById.delete(presetId)
    translatorPresetRollbackBaselinesById.delete(presetId)
  }

  function retainPendingTranslatorPresetUpdateForReplay(presetId: string): void {
    const pending = pendingTranslatorPresetUpdates.get(presetId)
    if (pending?.timer) clearTimeout(pending.timer)
    pendingTranslatorPresetUpdates.delete(presetId)
    translatorPresetDirtyFieldsById.delete(presetId)
    translatorPresetRollbackBaselinesById.delete(presetId)
  }

  function translatorPresetRollbackInsertionIndex(
    presets: readonly TranslatorPreset[],
    attempt: TranslatorPresetDeleteAttempt,
  ): number {
    if (attempt.nextSiblingPresetId) {
      const nextIndex = presets.findIndex((preset) => preset.id === attempt.nextSiblingPresetId)
      if (nextIndex !== -1) return nextIndex
    }
    if (attempt.previousSiblingPresetId) {
      const previousIndex = presets.findIndex((preset) => preset.id === attempt.previousSiblingPresetId)
      if (previousIndex !== -1) return previousIndex + 1
    }
    return Math.min(Math.max(attempt.previousIndex, 0), presets.length)
  }

  function reassertPendingTranslatorPresetStructuralMutations(): void {
    if (pendingTranslatorPresetStructuralMutations.length === 0) return

    withTrustedResourceWrite(() => {
      const presets = cloneJsonValue(getDatabase().translatorPresets ?? [])
      let selectedPresetId = currentSelectedTranslatorPresetId()

      for (const mutation of pendingTranslatorPresetStructuralMutations) {
        if (mutation.kind === 'create') {
          const presetId = mutation.attempt.attemptedPreset.id
          if (!presets.some((preset) => preset.id === presetId)) {
            presets.push(cloneJsonValue(mutation.attempt.draftPreset))
          }
          selectedPresetId = presetId
          continue
        }

        if (mutation.kind === 'select') {
          if (presets.some((preset) => preset.id === mutation.attempt.attemptedPresetId)) {
            selectedPresetId = mutation.attempt.attemptedPresetId
          }
          continue
        }

        const deletedIndex = presets.findIndex((preset) => preset.id === mutation.attempt.deletedPreset.id)
        if (deletedIndex !== -1) presets.splice(deletedIndex, 1)
        if (presets.some((preset) => preset.id === mutation.attempt.attemptedSelectedPreset.id)) {
          selectedPresetId = mutation.attempt.attemptedSelectedPreset.id
        } else if (selectedPresetId === mutation.attempt.deletedPreset.id) {
          selectedPresetId = presets[0]?.id ?? null
        }
      }

      getDatabase().translatorPresets = presets
      const selectedIndex = selectedPresetId ? presets.findIndex((preset) => preset.id === selectedPresetId) : -1
      getDatabase().translatorPresetId = selectedIndex === -1 ? 0 : selectedIndex
      syncCurrentTranslatorPreset()
    })
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
    const rollbackBaselines = translatorPresetRollbackBaselinesById.get(presetId)

    for (const field of fields) {
      if (snapshotJson(dirtyFields.get(field)) === snapshotJson(values[field])) {
        dirtyFields.delete(field)
        rollbackBaselines?.delete(field)
      }
    }

    if (dirtyFields.size === 0) {
      translatorPresetDirtyFieldsById.delete(presetId)
    }
    if (rollbackBaselines?.size === 0) translatorPresetRollbackBaselinesById.delete(presetId)
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

  function advanceTranslatorPresetRollbackBaselines(
    presetId: string,
    attempted: TranslatorPresetSnapshot,
    fields: readonly TranslatorPresetDirtyField[],
  ): void {
    const dirtyFields = translatorPresetDirtyFieldsById.get(presetId)
    let rollbackBaselines = translatorPresetRollbackBaselinesById.get(presetId)

    for (const field of fields) {
      if (!dirtyFields?.has(field)) {
        rollbackBaselines?.delete(field)
        continue
      }
      if (!rollbackBaselines) {
        rollbackBaselines = new Map()
        translatorPresetRollbackBaselinesById.set(presetId, rollbackBaselines)
      }
      rollbackBaselines.set(field, cloneJsonValue(attempted[field]))
    }

    if (rollbackBaselines?.size === 0) translatorPresetRollbackBaselinesById.delete(presetId)
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
    presetId: string,
    preset: TranslatorPreset,
    presetIndex: number,
    dirtyFields: Map<TranslatorPresetDirtyField, unknown>,
  ): void {
    let rollbackBaselines = translatorPresetRollbackBaselinesById.get(presetId)
    for (const [field, value] of Array.from(dirtyFields.entries())) {
      if (projectionMatchesTranslatorPresetDirtyValue(preset, presetIndex, field, value)) {
        dirtyFields.delete(field)
        rollbackBaselines?.delete(field)
        continue
      }

      if (!rollbackBaselines) {
        rollbackBaselines = new Map()
        translatorPresetRollbackBaselinesById.set(presetId, rollbackBaselines)
      }
      rollbackBaselines.set(field, cloneJsonValue(preset[field]))
    }
    if (rollbackBaselines?.size === 0) translatorPresetRollbackBaselinesById.delete(presetId)
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
        translatorPresetRollbackBaselinesById.delete(presetId)
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

  function reconcileTranslatorPresetProjectionEpoch(authoritativePresetIds: ReadonlySet<string>): void {
    if (translatorPresetDirtyFieldsById.size === 0) return

    const presets = getDatabase().translatorPresets ?? []
    for (const [presetId, dirtyFields] of Array.from(translatorPresetDirtyFieldsById.entries())) {
      if (!authoritativePresetIds.has(presetId) && hasPendingTranslatorPresetCreate(presetId)) continue
      const presetIndex = presets.findIndex((preset) => preset.id === presetId)
      if (presetIndex === -1) {
        translatorPresetDirtyFieldsById.delete(presetId)
        translatorPresetRollbackBaselinesById.delete(presetId)
        continue
      }

      clearTranslatorPresetDirtyFieldsMatchingProjection(presetId, presets[presetIndex], presetIndex, dirtyFields)
      if (dirtyFields.size === 0) {
        translatorPresetDirtyFieldsById.delete(presetId)
        continue
      }

      reassertDirtyTranslatorPresetFields(presetId, dirtyFields)
    }
  }

  function reassertAllDirtyTranslatorPresetFields(): void {
    for (const [presetId, dirtyFields] of translatorPresetDirtyFieldsById) {
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
    const rollbackPrevious = { ...previous } as Record<string, unknown>
    const rollbackBaselines = translatorPresetRollbackBaselinesById.get(presetId)
    for (const field of rollbackFields) {
      if (rollbackBaselines?.has(field)) rollbackPrevious[field] = cloneJsonValue(rollbackBaselines.get(field))
    }

    withTrustedResourceWrite(() => {
      const presetIndex = getDatabase().translatorPresets.findIndex((preset) => preset.id === presetId)
      if (presetIndex === -1) return

      const nextPresets = [...getDatabase().translatorPresets]
      const nextPreset = cloneJsonValue(nextPresets[presetIndex]) as unknown as Record<string, unknown>
      const rolledBackFields = applyAttemptedFieldRollback({
        target: nextPreset,
        previous: rollbackPrevious,
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
      updatePendingTranslatorPresetCreateDraft(presetId, patch)

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
    transport: ServerCommandTransportOptions = {},
  ): Promise<ServerCommandResult<T>> {
    if (!canUseServerCommands()) return Promise.resolve({ status: 'unavailable' })
    return runServerCommand({ command, rollback, ...transport })
  }

  function applyOptimisticTranslatorPresetCreate(preset: TranslatorPreset): TranslatorPresetCreateAttempt | null {
    const attemptedPreset = cloneJsonValue(preset)
    const presetId = attemptedPreset.id
    if (!presetId || presetId.trim().length === 0) return null
    const attemptedPresetWithId = attemptedPreset as TranslatorPreset & { id: string }
    const previousSelectedPresetId = currentSelectedTranslatorPresetId()
    confirmedSelectedTranslatorPresetId()

    const attempt: TranslatorPresetCreateAttempt = {
      operationId: nextTranslatorPresetStructuralOperationId++,
      attemptedPreset: attemptedPresetWithId,
      draftPreset: cloneJsonValue(attemptedPresetWithId),
      previousSelectedPresetId,
      collectionProjectionEpoch: captureCollectionProjectionEpoch('translatorPresets'),
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

    if (applied) {
      translatorPresetCreateOutcomesById.set(presetId, 'pending')
      registerPendingTranslatorPresetStructuralMutation({ kind: 'create', attempt })
    }
    return applied ? attempt : null
  }

  function rollbackOptimisticTranslatorPresetCreate(attempt: TranslatorPresetCreateAttempt): void {
    absorbUnreconciledTranslatorPresetProjectionEpochs()
    removePendingTranslatorPresetStructuralMutation(attempt.operationId)
    translatorPresetCreateOutcomesById.set(attempt.attemptedPreset.id, 'failed')
    markCollectionAcknowledgementTainted('translatorPresets')
    markSettingsGroupAcknowledgementTainted('language')

    withTrustedResourceWrite(() => {
      const presets = getDatabase().translatorPresets ?? []
      const selectedPresetId = presets[getDatabase().translatorPresetId]?.id ?? null
      const selectedAttemptedPreset = selectedPresetId === attempt.attemptedPreset.id
      const preserveAuthoritativePreset =
        hasCollectionProjectionEpochChanged('translatorPresets', attempt.collectionProjectionEpoch) &&
        (confirmedTranslatorPresetCollection?.some((preset) => preset.id === attempt.attemptedPreset.id) ?? false)
      const nextPresets = preserveAuthoritativePreset
        ? [...presets]
        : presets.filter((preset) => preset.id !== attempt.attemptedPreset.id)
      getDatabase().translatorPresets = nextPresets

      if (selectedAttemptedPreset) {
        const confirmedPresetId = confirmedSelectedTranslatorPresetId()
        const confirmedIndex = confirmedPresetId
          ? nextPresets.findIndex((translatorPreset) => translatorPreset.id === confirmedPresetId)
          : -1
        getDatabase().translatorPresetId = confirmedIndex === -1 ? 0 : confirmedIndex
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
    reassertPendingTranslatorPresetStructuralMutations()
  }

  function dispatchCreateTranslatorPreset(
    preset: TranslatorPreset,
    previousSelectedPresetId: string | null,
    rollback?: () => void,
    captureOutbox?: (outbox: PendingMutationHandle) => void,
  ): Promise<ServerCommandResult> {
    if (!canUseServerCommands()) return Promise.resolve({ status: 'unavailable' })
    const attemptedPreset = cloneJsonValue(preset) as TranslatorPresetSnapshot
    const intent: DurableMutationIntent = {
      version: 1,
      requests: [
        {
          method: 'POST',
          path: '/translator-presets',
          body: { preset: attemptedPreset, select: true },
        },
      ],
      dependencyKeys: translatorPresetOwnerDependencyKeys(
        previousSelectedPresetId,
        typeof attemptedPreset.id === 'string' ? attemptedPreset.id : null,
      ),
    }
    const outbox = stagePendingMutation(TRANSLATOR_PRESET_SELECTION_MUTATION_KEY, intent)
    captureOutbox?.(outbox)
    return dispatchDurableMutation(outbox, intent, (transport) =>
      runTranslatorPresetCommand(
        (baseRevision) =>
          createTranslatorPresetCommand({
            baseRevision,
            preset: cloneJsonValue(attemptedPreset),
            select: true,
          }),
        rollback,
        transport,
      ),
    )
  }

  function createTranslatorPresetOptimistically(preset: TranslatorPreset): void {
    const attempt = applyOptimisticTranslatorPresetCreate(preset)
    if (!attempt) return
    let createOutbox: PendingMutationHandle | null = null
    void dispatchCreateTranslatorPreset(
      preset,
      attempt.previousSelectedPresetId,
      () => rollbackOptimisticTranslatorPresetCreate(attempt),
      (outbox) => {
        createOutbox = outbox
      },
    ).then(async (result) => {
      if (result.status !== 'ok') {
        if (hasPendingTranslatorPresetStructuralMutation(attempt.operationId)) {
          rollbackOptimisticTranslatorPresetCreate(attempt)
        }
        const retained = createOutbox ? await isPendingMutationCurrent(createOutbox) : false
        if (retained) retainPendingTranslatorPresetUpdateForReplay(attempt.attemptedPreset.id)
        else cancelPendingTranslatorPresetUpdates(attempt.attemptedPreset.id)
        return
      }
      removePendingTranslatorPresetStructuralMutation(attempt.operationId)
      translatorPresetCreateOutcomesById.set(attempt.attemptedPreset.id, 'succeeded')
      settleConfirmedTranslatorPresetCreate(attempt)
    })
  }

  function applyOptimisticTranslatorPresetSelection(presetId: string): TranslatorPresetSelectionAttempt | null {
    const presets = getDatabase().translatorPresets ?? []
    const presetIndex = presets.findIndex((preset) => preset.id === presetId)
    if (presetIndex === -1) return null
    const previousSelectedPresetId = currentSelectedTranslatorPresetId()
    confirmedSelectedTranslatorPresetId()

    const attempt: TranslatorPresetSelectionAttempt = {
      operationId: nextTranslatorPresetStructuralOperationId++,
      previousSelectedPresetId,
      attemptedPresetId: presetId,
    }
    let applied = false

    withTrustedResourceWrite(() => {
      const livePresetIndex = getDatabase().translatorPresets?.findIndex((preset) => preset.id === presetId) ?? -1
      if (livePresetIndex === -1) return

      getDatabase().translatorPresetId = livePresetIndex
      syncCurrentTranslatorPreset()
      applied = true
    })

    if (applied) registerPendingTranslatorPresetStructuralMutation({ kind: 'select', attempt })
    return applied ? attempt : null
  }

  function rollbackOptimisticTranslatorPresetSelection(attempt: TranslatorPresetSelectionAttempt): void {
    absorbUnreconciledTranslatorPresetProjectionEpochs()
    removePendingTranslatorPresetStructuralMutation(attempt.operationId)
    markSettingsGroupAcknowledgementTainted('language')

    withTrustedResourceWrite(() => {
      const presets = getDatabase().translatorPresets ?? []
      const selectedPresetId = presets[getDatabase().translatorPresetId]?.id ?? null
      if (selectedPresetId !== attempt.attemptedPresetId) return

      const confirmedPresetId = confirmedSelectedTranslatorPresetId()
      if (confirmedPresetId === attempt.attemptedPresetId) return
      const confirmedSelectedPresetIndex = confirmedPresetId
        ? presets.findIndex((preset) => preset.id === confirmedPresetId)
        : -1
      if (confirmedSelectedPresetIndex === -1) return

      getDatabase().translatorPresetId = confirmedSelectedPresetIndex
      syncCurrentTranslatorPreset()
    })
    reassertPendingTranslatorPresetStructuralMutations()
  }

  function dispatchSelectTranslatorPreset(
    presetId: string,
    previousSelectedPresetId: string | null,
    rollback?: () => void,
  ): Promise<ServerCommandResult> {
    if (!canUseServerCommands()) return Promise.resolve({ status: 'unavailable' })
    const intent: DurableMutationIntent = {
      version: 1,
      requests: [
        {
          method: 'POST',
          path: '/translator-presets/select',
          body: { presetId },
        },
      ],
      dependencyKeys: translatorPresetOwnerDependencyKeys(previousSelectedPresetId, presetId),
    }
    const outbox = stagePendingMutation(TRANSLATOR_PRESET_SELECTION_MUTATION_KEY, intent)
    return dispatchDurableMutation(outbox, intent, (transport) =>
      runTranslatorPresetCommand(
        (baseRevision) =>
          selectTranslatorPresetCommand({
            baseRevision,
            presetId,
          }),
        rollback,
        transport,
      ),
    )
  }

  function dispatchOptimisticTranslatorPresetSelection(attempt: TranslatorPresetSelectionAttempt): void {
    void dispatchSelectTranslatorPreset(attempt.attemptedPresetId, attempt.previousSelectedPresetId, () =>
      rollbackOptimisticTranslatorPresetSelection(attempt),
    ).then((result) => {
      if (result.status !== 'ok') {
        if (hasPendingTranslatorPresetStructuralMutation(attempt.operationId)) {
          rollbackOptimisticTranslatorPresetSelection(attempt)
        }
        return
      }
      removePendingTranslatorPresetStructuralMutation(attempt.operationId)
      confirmedTranslatorPresetSelectionId = attempt.attemptedPresetId
    })
  }

  function applyOptimisticTranslatorPresetDelete(
    presetId: string,
    latestOptimisticPreset?: TranslatorPreset,
  ): TranslatorPresetDeleteAttempt | null {
    const collectionProjectionEpoch = captureCollectionProjectionEpoch('translatorPresets')
    confirmedSelectedTranslatorPresetId()
    let attempt: TranslatorPresetDeleteAttempt | null = null

    withTrustedResourceWrite(() => {
      const presets = getDatabase().translatorPresets ?? []
      const previousIndex = presets.findIndex((preset) => preset.id === presetId)
      const selectedPresetId = presets[getDatabase().translatorPresetId]?.id
      if (previousIndex === -1 || presets.length <= 1 || selectedPresetId !== presetId) return

      const currentPreset = presets[previousIndex]
      const deletedPreset = cloneJsonValue(
        latestOptimisticPreset && isCanonicalTranslatorPreset(latestOptimisticPreset, presetId)
          ? latestOptimisticPreset
          : currentPreset,
      )
      if (!deletedPreset.id) return
      const nextPresets = [...presets]
      nextPresets.splice(previousIndex, 1)
      const attemptedSelectedPreset = nextPresets[0]
      if (!attemptedSelectedPreset?.id) return

      getDatabase().translatorPresets = nextPresets
      getDatabase().translatorPresetId = 0
      syncCurrentTranslatorPreset()
      attempt = {
        operationId: nextTranslatorPresetStructuralOperationId++,
        deletedPreset: deletedPreset as TranslatorPreset & { id: string },
        previousIndex,
        previousSiblingPresetId: presets[previousIndex - 1]?.id ?? null,
        nextSiblingPresetId: presets[previousIndex + 1]?.id ?? null,
        attemptedSelectedPreset: cloneJsonValue(attemptedSelectedPreset) as TranslatorPreset & { id: string },
        collectionProjectionEpoch,
      }
    })

    if (attempt) registerPendingTranslatorPresetStructuralMutation({ kind: 'delete', attempt })
    return attempt
  }

  function rollbackOptimisticTranslatorPresetDelete(attempt: TranslatorPresetDeleteAttempt): void {
    absorbUnreconciledTranslatorPresetProjectionEpochs()
    removePendingTranslatorPresetStructuralMutation(attempt.operationId)
    markCollectionAcknowledgementTainted('translatorPresets')
    markSettingsGroupAcknowledgementTainted('language')

    if (
      translatorPresetCreateOutcomesById.get(attempt.deletedPreset.id) === 'failed' &&
      !confirmedTranslatorPresetCollection?.some((preset) => preset.id === attempt.deletedPreset.id)
    ) {
      reassertPendingTranslatorPresetStructuralMutations()
      return
    }
    if (
      hasCollectionProjectionEpochChanged('translatorPresets', attempt.collectionProjectionEpoch) &&
      !confirmedTranslatorPresetCollection?.some((preset) => preset.id === attempt.deletedPreset.id)
    ) {
      reassertPendingTranslatorPresetStructuralMutations()
      return
    }

    const authoritativePreset = hasCollectionProjectionEpochChanged(
      'translatorPresets',
      attempt.collectionProjectionEpoch,
    )
      ? confirmedTranslatorPresetCollection?.find((preset) => preset.id === attempt.deletedPreset.id)
      : undefined
    const restoredPreset = cloneJsonValue(authoritativePreset ?? attempt.deletedPreset)

    withTrustedResourceWrite(() => {
      const presets = getDatabase().translatorPresets ?? []
      const selectedPreset = presets[getDatabase().translatorPresetId]
      const selectedPresetId = selectedPreset?.id ?? null
      const selectedProjectionMatchesAttempt = selectedPresetId === attempt.attemptedSelectedPreset.id

      const nextPresets = [...presets]
      if (!nextPresets.some((preset) => preset.id === attempt.deletedPreset.id)) {
        nextPresets.splice(
          translatorPresetRollbackInsertionIndex(nextPresets, attempt),
          0,
          cloneJsonValue(restoredPreset),
        )
      }

      getDatabase().translatorPresets = nextPresets
      if (selectedProjectionMatchesAttempt) {
        const confirmedPresetId = confirmedSelectedTranslatorPresetId()
        const confirmedSelectedPresetIndex = confirmedPresetId
          ? nextPresets.findIndex((preset) => preset.id === confirmedPresetId)
          : -1
        getDatabase().translatorPresetId = confirmedSelectedPresetIndex === -1 ? 0 : confirmedSelectedPresetIndex
        syncCurrentTranslatorPreset()
        return
      }

      const preservedSelectedPresetIndex = nextPresets.findIndex((preset) => preset.id === selectedPresetId)
      if (preservedSelectedPresetIndex !== -1) {
        getDatabase().translatorPresetId = preservedSelectedPresetIndex
        return
      }

      const confirmedPresetId = confirmedSelectedTranslatorPresetId()
      const confirmedSelectedPresetIndex = confirmedPresetId
        ? nextPresets.findIndex((preset) => preset.id === confirmedPresetId)
        : -1
      getDatabase().translatorPresetId = confirmedSelectedPresetIndex === -1 ? 0 : confirmedSelectedPresetIndex
      syncCurrentTranslatorPreset()
    })
    if (!authoritativePreset) {
      const confirmedPreset = confirmedTranslatorPresetCollection?.find((preset) => preset.id === restoredPreset.id)
      if (confirmedPreset) {
        const restoredDirtyPatch: TranslatorPresetSnapshot = {}
        for (const field of translatorPresetDirtyFieldNames) {
          if (snapshotJson(confirmedPreset[field]) !== snapshotJson(restoredPreset[field])) {
            restoredDirtyPatch[field] = cloneJsonValue(restoredPreset[field]) as never
          }
        }
        markTranslatorPresetDirtyFields(restoredPreset.id!, restoredDirtyPatch)
      }
    }
    reassertPendingTranslatorPresetStructuralMutations()
  }

  function dispatchDeleteTranslatorPreset(
    presetId: string,
    selectPresetId: string | undefined,
    rollback?: () => void,
  ): Promise<ServerCommandResult> {
    return runTranslatorPresetCommand(
      (baseRevision) =>
        deleteTranslatorPresetCommand({
          baseRevision,
          presetId,
          selectPresetId,
        }),
      rollback,
    )
  }

  function translatorPresetDeleteDurableIntent(
    presetId: string,
    selectPresetId: string | undefined,
  ): DurableMutationIntent {
    return {
      version: 1,
      requests: [
        {
          method: 'DELETE',
          path: `/translator-presets/${encodeURIComponent(presetId)}`,
          body: selectPresetId ? { selectPresetId } : {},
        },
      ],
      dependencyKeys: [translatorPresetOwnerMutationKey(presetId)],
    }
  }

  function dispatchDurableDeleteTranslatorPreset(
    presetId: string,
    selectPresetId: string | undefined,
    rollback: () => void,
  ): Promise<ServerCommandResult> {
    const intent = translatorPresetDeleteDurableIntent(presetId, selectPresetId)
    const outbox = stagePendingMutation(TRANSLATOR_PRESET_SELECTION_MUTATION_KEY, intent)
    return dispatchDurableMutation(outbox, intent, (transport) =>
      runServerCommand({
        command: (baseRevision) =>
          deleteTranslatorPresetCommand({
            baseRevision,
            presetId,
            selectPresetId,
          }),
        rollback,
        ...transport,
      }),
    )
  }

  function deleteTranslatorPresetOptimistically(presetId: string, latestOptimisticPreset?: TranslatorPreset): void {
    const attempt = applyOptimisticTranslatorPresetDelete(presetId, latestOptimisticPreset)
    if (!attempt) return
    void dispatchDurableDeleteTranslatorPreset(presetId, attempt.attemptedSelectedPreset.id, () =>
      rollbackOptimisticTranslatorPresetDelete(attempt),
    ).then((result) => {
      if (result.status !== 'ok') {
        if (hasPendingTranslatorPresetStructuralMutation(attempt.operationId)) {
          rollbackOptimisticTranslatorPresetDelete(attempt)
        }
        return
      }
      removePendingTranslatorPresetStructuralMutation(attempt.operationId)
      settleConfirmedTranslatorPresetDelete(attempt)
    })
  }

  function dispatchPendingTranslatorPresetUpdate(
    pending: PendingTranslatorPresetUpdate,
    options: ServerCommandTransportOptions = {},
  ): Promise<ServerCommandResult> {
    if (pending.timer) {
      clearTimeout(pending.timer)
      pending.timer = null
    }
    pendingTranslatorPresetUpdates.delete(pending.presetId)

    const commandPresetId = pending.presetId
    const commandPatch = pending.patch
    const commandPrevious = pending.previous
    const commandAttempted = pending.attempted
    const commandIntent = pending.intent
    const commandOutbox = pending.outbox
    const commandFields = translatorPresetPatchDirtyFields(commandPatch)
    if (!commandIntent || !commandOutbox || commandFields.length === 0) {
      if (commandOutbox) void acknowledgePendingMutation(commandOutbox)
      return Promise.resolve({ status: 'unavailable' })
    }
    const currentPreset = currentTranslatorPresetById(commandPresetId)
    if (!currentPreset || !isCanonicalTranslatorPreset(currentPreset, commandPresetId)) {
      void acknowledgePendingMutation(commandOutbox)
      translatorPresetDirtyFieldsById.delete(commandPresetId)
      translatorPresetRollbackBaselinesById.delete(commandPresetId)
      return Promise.resolve({ status: 'unavailable' })
    }
    const optimisticAcknowledgement = translatorPresetPatchOptimisticAcknowledgement(pending)
    markTranslatorPresetFieldsUnsettled(commandPresetId, commandFields)

    let rollbackRan = false
    const rollback = () => {
      rollbackRan = true
      markCollectionAcknowledgementTainted('translatorPresets')
      markSettingsGroupAcknowledgementTainted('language')
      restoreTranslatorPresetUpdateState(commandPresetId, commandPrevious, commandAttempted, commandPatch)
    }
    const dispatch = () =>
      dispatchDurableMutation(commandOutbox, commandIntent, (transport) =>
        runServerCommand({
          command: (baseRevision) =>
            updateTranslatorPresetCommand(
              {
                baseRevision,
                presetId: commandPresetId,
                patch: commandPatch,
                optimisticAcknowledgement,
              },
              options.signal,
              options.keepalive,
            ),
          rollback,
          ...options,
          ...transport,
        }),
      )
    const dispatchAndSettle = async () => {
      const result = await dispatch()
      if (result.status === 'ok') {
        advanceTranslatorPresetRollbackBaselines(commandPresetId, commandAttempted, commandFields)
      } else if (!rollbackRan) {
        rollback()
      }
      return result
    }

    translatorPresetUpdateDispatchChain = translatorPresetUpdateDispatchChain
      .then(dispatchAndSettle, dispatchAndSettle)
      .finally(() => {
        clearTranslatorPresetFieldsUnsettled(commandPresetId, commandFields)
      })
    return translatorPresetUpdateDispatchChain
  }

  async function flushPendingTranslatorPresetUpdates(options: ServerCommandTransportOptions = {}): Promise<void> {
    if (!canUseServerCommands()) return
    for (const pending of Array.from(pendingTranslatorPresetUpdates.values())) {
      void dispatchPendingTranslatorPresetUpdate(pending, options)
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
      durableAttempted: {},
      collectionProjectionEpoch: captureCollectionProjectionEpoch('translatorPresets'),
      languageSettingsProjectionEpoch: captureSettingsGroupProjectionEpoch('language'),
      selectedPresetId: selectedTranslatorPresetId(),
      intent: null,
      outbox: null,
    }
    const previousPreset = translatorPresetFromSnapshot(previous, presetId)
    const currentPreset = currentTranslatorPresetById(presetId)
    if (
      !previousPreset ||
      !currentPreset ||
      !isCanonicalTranslatorPreset(previousPreset, presetId) ||
      !isCanonicalTranslatorPreset(currentPreset, presetId) ||
      !isValidTranslatorPresetPatch(patch)
    ) {
      cancelPendingTranslatorPresetUpdates(presetId)
      return
    }
    const pendingPatch = pending.patch as Record<string, unknown>
    const pendingPrevious = pending.previous as Record<string, unknown>
    const pendingAttempted = pending.attempted as Record<string, unknown>
    const pendingDurableAttempted = pending.durableAttempted as Record<string, unknown>
    let rollbackBaselines = translatorPresetRollbackBaselinesById.get(presetId)

    for (const field of translatorPresetPatchDirtyFields(patch)) {
      if (!rollbackBaselines) {
        rollbackBaselines = new Map()
        translatorPresetRollbackBaselinesById.set(presetId, rollbackBaselines)
      }
      if (!rollbackBaselines.has(field)) {
        rollbackBaselines.set(field, cloneJsonValue(previousPreset?.[field]))
      }
      if (!(field in pendingPrevious)) {
        pendingPrevious[field] = cloneJsonValue(previousPreset?.[field])
        if (pending.outbox && !(field in pendingDurableAttempted)) {
          pendingDurableAttempted[field] = cloneJsonValue(previousPreset?.[field])
        }
      }

      const attemptedValue = cloneJsonValue(patch[field])
      pendingAttempted[field] = attemptedValue
      if (snapshotJson(attemptedValue) === snapshotJson(pendingPrevious[field])) {
        if (!isTranslatorPresetFieldUnsettled(presetId, field)) {
          clearTranslatorPresetDirtyFieldsMatchingValues(presetId, { [field]: attemptedValue }, [field])
        }
      }
    }

    const netChangedFields = changedTranslatorPresetPatchFields(pending.previous, pending.attempted)
    const changedFromDurableFields = pending.outbox
      ? changedTranslatorPresetPatchFields(pending.durableAttempted, pending.attempted)
      : new Set<TranslatorPresetDirtyField>()
    const closureFields = new Set<TranslatorPresetDirtyField>([
      ...translatorPresetPatchDirtyFields(pending.patch),
      ...netChangedFields,
      ...changedFromDurableFields,
    ])
    for (const field of translatorPresetDirtyFieldNames) {
      if (closureFields.has(field)) pendingPatch[field] = cloneJsonValue(pendingAttempted[field])
      else delete pendingPatch[field]
    }

    if (pending.timer) clearTimeout(pending.timer)
    if (translatorPresetPatchDirtyFields(pending.patch).length === 0) {
      if (pending.outbox) void acknowledgePendingMutation(pending.outbox)
      pending.intent = null
      pending.outbox = null
      pending.timer = null
      pendingTranslatorPresetUpdates.delete(presetId)
      return
    }

    pending.intent = translatorPresetUpdateDurableIntent(presetId, pending.patch)
    pending.outbox = stagePendingMutation(translatorPresetOwnerMutationKey(presetId), pending.intent, pending.outbox)
    pending.durableAttempted = cloneJsonValue(pending.attempted)

    pendingTranslatorPresetUpdates.set(presetId, pending)
    if (netChangedFields.size === 0 && changedFromDurableFields.size > 0) {
      void dispatchPendingTranslatorPresetUpdate(pending)
      return
    }
    pending.timer = setTimeout(() => {
      void dispatchPendingTranslatorPresetUpdate(pending)
    }, translatorPresetUpdateDelayMs)
  }

  function changedTranslatorPresetPatchFields(
    left: TranslatorPresetSnapshot,
    right: TranslatorPresetSnapshot,
  ): Set<TranslatorPresetDirtyField> {
    const changed = new Set<TranslatorPresetDirtyField>()
    for (const field of translatorPresetDirtyFieldNames) {
      const leftPresent = Object.prototype.hasOwnProperty.call(left, field)
      const rightPresent = Object.prototype.hasOwnProperty.call(right, field)
      if (leftPresent !== rightPresent || snapshotJson(left[field]) !== snapshotJson(right[field])) {
        changed.add(field)
      }
    }
    return changed
  }

  function isCanonicalTranslatorPreset(preset: TranslatorPreset, presetId: string): boolean {
    return (
      preset.id === presetId &&
      presetId.trim().length > 0 &&
      typeof preset.name === 'string' &&
      typeof preset.prompt === 'string' &&
      typeof preset.maxResponse === 'number' &&
      Number.isFinite(preset.maxResponse)
    )
  }

  function isValidTranslatorPresetPatch(patch: TranslatorPresetSnapshot): boolean {
    const fields = translatorPresetPatchDirtyFields(patch)
    return (
      fields.length > 0 &&
      fields.length === Object.keys(patch).length &&
      fields.every((field) => {
        const value = patch[field]
        return field === 'maxResponse' ? typeof value === 'number' && Number.isFinite(value) : typeof value === 'string'
      })
    )
  }

  function translatorPresetUpdateDurableIntent(
    presetId: string,
    patch: TranslatorPresetSnapshot,
  ): DurableMutationIntent {
    return {
      version: 1,
      requests: [
        {
          method: 'PATCH',
          path: `/translator-presets/${encodeURIComponent(presetId)}`,
          body: { patch: cloneJsonValue(patch) },
        },
      ],
      dependencyKeys: [TRANSLATOR_PRESET_SELECTION_MUTATION_KEY],
    }
  }

  $effect(() => {
    const resourceApplyEpoch = getServerResourceApplyEpoch()
    if (resourceApplyEpoch === previousResourceApplyEpoch) return

    previousResourceApplyEpoch = resourceApplyEpoch
    const translatorPresetCollectionProjectionEpoch = captureCollectionProjectionEpoch('translatorPresets')
    const collectionProjectionChanged =
      translatorPresetCollectionProjectionEpoch !== previousTranslatorPresetCollectionProjectionEpoch
    previousTranslatorPresetCollectionProjectionEpoch = translatorPresetCollectionProjectionEpoch
    const languageSettingsProjectionEpoch = captureSettingsGroupProjectionEpoch('language')
    const languageProjectionChanged = languageSettingsProjectionEpoch !== previousLanguageSettingsProjectionEpoch
    previousLanguageSettingsProjectionEpoch = languageSettingsProjectionEpoch
    untrack(() => {
      if (!collectionProjectionChanged && !languageProjectionChanged) return
      const authoritativePresetIds = collectionProjectionChanged
        ? new Set((getDatabase().translatorPresets ?? []).flatMap((preset) => (preset.id ? [preset.id] : [])))
        : null
      if (collectionProjectionChanged) {
        confirmedTranslatorPresetCollection = cloneJsonValue(getDatabase().translatorPresets ?? [])
      }
      if (languageProjectionChanged) {
        confirmedTranslatorPresetSelectionId = projectedSelectedTranslatorPresetId()
      } else if (pendingTranslatorPresetStructuralMutations.length === 0) {
        confirmedTranslatorPresetSelectionId = currentSelectedTranslatorPresetId()
      }
      reassertPendingTranslatorPresetStructuralMutations()
      if (authoritativePresetIds) reconcileTranslatorPresetProjectionEpoch(authoritativePresetIds)
      else reassertAllDirtyTranslatorPresetFields()
    })
  })

  const unregisterPendingTranslatorPresetFlush = registerPendingBridgePatchFlusher(
    `translator-preset-settings:${nextTranslatorPresetFlushId++}`,
    (options) => {
      void flushPendingTranslatorPresetUpdates(options)
    },
  )

  onDestroy(() => {
    unsubscribeLocalEffectApplied()
    unregisterPendingTranslatorPresetFlush()
    void flushPendingTranslatorPresetUpdates()
  })
</script>

<span class="text-textcolor mt-4">Preset</span>
<select
  aria-label="Preset"
  class={'border border-darkborderc focus:border-borderc rounded-md shadow-xs text-textcolor bg-transparent focus:ring-borderc focus:ring-2 focus:outline-hidden transition-colors duration-200 text-md px-4 py-2 mb-1'}
  bind:value={
    () => getDatabase().translatorPresetId,
    (value) => {
      const presetIndex = Number(value)
      const presetId = getDatabase().translatorPresets[presetIndex]?.id ?? null
      if (!canUseServerCommands()) {
        getDatabase().translatorPresetId = presetIndex
        syncCurrentTranslatorPreset()
        if (presetId) dispatchSelectTranslatorPreset(presetId, null)
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
    type="button"
    aria-label={`${language.add}: ${language.presets}`}
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
        dispatchCreateTranslatorPreset(getDatabase().translatorPresets[getDatabase().translatorPresetId], null)
      } else {
        createTranslatorPresetOptimistically(newPreset)
      }
    }}>
    <PlusIcon size={24} />
  </button>

  <button
    type="button"
    aria-label={`${language.edit}: ${getDatabase().translatorPresets[getDatabase().translatorPresetId]?.name ?? language.presets}`}
    class="mr-2 text-textcolor2 hover:text-green-500 cursor-pointer"
    onclick={async () => {
      const presets = getDatabase().translatorPresets

      if (presets.length === 0) {
        alertError('There must be at least one preset.')
        return
      }

      const id = getDatabase().translatorPresetId
      const preset = presets[id]
      const presetId = preset?.id
      if (!presetId) return
      const newName = await alertInput(`Enter new name for ${preset.name}`, [], preset.name)

      if (!newName || newName.trim().length === 0) return

      const targetPreset = currentTranslatorPresetById(presetId)
      if (!targetPreset) return
      const previous = currentTranslatorPresetStateSnapshot()
      if (!canUseServerCommands()) {
        targetPreset.name = newName
        getDatabase().translatorPresets = [...getDatabase().translatorPresets]
        if (getDatabase().translatorPresets[getDatabase().translatorPresetId]?.id === presetId) {
          syncCurrentTranslatorPreset()
        }
      } else {
        markTranslatorPresetDirtyFields(presetId, { name: newName })
        applyTranslatorPresetPatchToDatabase(presetId, { name: newName })
      }
      queueTranslatorPresetUpdate(presetId, { name: newName }, previous)
    }}>
    <PencilIcon size={24} />
  </button>

  <button
    type="button"
    aria-label={`${language.remove}: ${getDatabase().translatorPresets[getDatabase().translatorPresetId]?.name ?? language.presets}`}
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

      const presetId = preset.id
      const latestOptimisticPreset = presetId ? cloneJsonValue(currentTranslatorPresetById(presetId) ?? preset) : null
      await flushPendingTranslatorPresetUpdates()
      if (!canUseServerCommands()) {
        normalizeTranslatorPresets()
      }
      if (!canUseServerCommands()) {
        getDatabase().translatorPresetId = 0
        presets.splice(id, 1)
        getDatabase().translatorPresets = presets
        normalizeTranslatorPresets()
        const selectPresetId = getDatabase().translatorPresets[getDatabase().translatorPresetId]?.id
        if (presetId) {
          dispatchDeleteTranslatorPreset(presetId, selectPresetId)
        }
      } else {
        if (presetId) deleteTranslatorPresetOptimistically(presetId, latestOptimisticPreset ?? undefined)
      }
    }}>
    <TrashIcon size={24} />
  </button>

  <div class="ml-2 mr-4 w-px h-full bg-darkborderc"></div>

  <button
    type="button"
    aria-label={`${language.export}: ${getDatabase().translatorPresets[getDatabase().translatorPresetId]?.name ?? language.presets}`}
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
    type="button"
    aria-label={`${language.import}: ${language.presets}`}
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
          dispatchCreateTranslatorPreset(getDatabase().translatorPresets[getDatabase().translatorPresetId], null)
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
    ariaLabel={language.translationResponseSize}
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
    ariaLabel={language.translatorPrompt}
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
