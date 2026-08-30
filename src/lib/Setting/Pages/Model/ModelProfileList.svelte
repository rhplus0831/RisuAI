<script lang="ts">
  import { untrack } from 'svelte'
  import { CopyIcon, GripVerticalIcon, MinusIcon, PencilIcon, PlusIcon, TrashIcon } from '@lucide/svelte'
  import { language } from 'src/lang'
  import Button from 'src/lib/UI/GUI/Button.svelte'
  import {
    resolveModelProfileByProfileId,
    type FirstClassModelProfileProviderId,
  } from 'src/ts/model/modelProfileResolver'
  import {
    modelProfileListItemKey,
    modelProfileListItems,
    modelProfileOrderEntryKey,
    normalizeModelProfileOrder,
    normalizeModelRoleProfiles,
    type ModelProfileOrderEntry,
    type ModelProfileRecord,
    type ModelRoleProfileBinding,
  } from 'src/ts/model/modelProfileRecords'
  import { MODEL_ROLES, modelRoleProfileInheritSource, type ModelRole } from '@risuai/shared-core/model-roles'
  import { getModelInfo } from 'src/ts/model/modellist'
  import {
    beginPendingModelMutation,
    createModelProfileDurably,
    deleteModelProfileDurably,
    duplicateModelProfileDurably,
    finishPendingModelMutation,
    getPendingModelMutations,
    isPendingModelMutationProjectionApplied,
    modelProfileProjectionFingerprint as profileProjectionFingerprint,
    retainPendingModelMutation,
    reorderModelProfilesDurably,
    subscribePendingModelMutations,
    updateModelProfileDurably,
    type PendingModelMutationProjection,
  } from 'src/ts/model/modelProfileMutations'
  import type { ModelProfileSnapshot, ServerCommandResult } from 'src/ts/server/commands'
  import type { ProviderCredentialType } from 'src/ts/model/providerCredentialRecords'
  import { getDatabase } from 'src/ts/storage/database.svelte'
  import { createNonSecurityUuid } from 'src/ts/nonSecurityUuid'
  import { internalReorderSortableOptions } from 'src/ts/gui/internalReorderSortable'
  import Sortable, { type SortableEvent } from 'sortablejs'
  import ModelProfileEditorDrawer from './ModelProfileEditorDrawer.svelte'
  import ModelRuntimeDefaultsEditor from './ModelRuntimeDefaultsEditor.svelte'

  interface Props {
    onManageCredentials?: (type: ProviderCredentialType) => void
  }

  let { onManageCredentials = () => {} }: Props = $props()

  type EditorMode = 'create' | 'edit' | null
  type ProfileListPendingProjection = Extract<
    PendingModelMutationProjection,
    { kind: 'profile-create' | 'profile-update' | 'profile-duplicate' | 'profile-delete' | 'profile-reorder' }
  >

  let editorMode = $state<EditorMode>(null)
  let editingProfileId = $state<string | null>(null)
  let editingProfileBaseline = $state<ModelProfileRecord | null>(null)
  let editorKey = $state(0)
  let busy = $state(false)
  let pendingMutations = $state(getPendingModelMutations('model-profiles'))
  let commandError = $state('')
  let profileListElement: HTMLDivElement | undefined = $state()
  let profileSortable: Sortable | null = null

  let profiles = $derived(getDatabase().modelProfiles ?? [])
  let profileOrder = $derived(normalizeModelProfileOrder(getDatabase().modelProfileOrder, profiles))
  let profileItems = $derived(modelProfileListItems(profiles, profileOrder))
  let credentials = $derived(getDatabase().providerCredentials ?? [])
  let mutationQueued = $derived(pendingMutations.length > 0)
  let editingProfile = $derived(
    editingProfileId ? profiles.find((profile) => profile.id === editingProfileId) : undefined,
  )

  $effect(() => {
    return subscribePendingModelMutations('model-profiles', (pending) => {
      pendingMutations = pending
    })
  })

  $effect(() => {
    profileSortable?.option('disabled', busy || mutationQueued)
  })

  $effect(() => {
    if (!profileListElement) return
    const sortable = Sortable.create(profileListElement, {
      ...internalReorderSortableOptions,
      disabled: untrack(() => busy || mutationQueued),
      draggable: '[data-model-profile-sortable-item]',
      handle: '[data-model-profile-drag-handle]',
      onEnd: handleProfileSortEnd,
    })
    profileSortable = sortable
    return () => {
      try {
        sortable.destroy()
      } catch {}
      if (profileSortable === sortable) profileSortable = null
    }
  })

  $effect(() => {
    for (const pending of pendingMutations) {
      if (pending.phase === 'discarded') {
        commandError = language.modelProfiles.commandReplayDiscarded
        finishPendingModelMutation(pending.token)
        continue
      }
      if (pending.phase === 'dispatching' || !isProfileListProjection(pending.projection)) continue
      if (
        isPendingModelMutationProjectionApplied(pending.projection, {
          modelProfiles: profiles,
          modelProfileOrder: profileOrder,
        })
      ) {
        finishPendingModelMutation(pending.token)
      }
    }
  })

  function providerLabel(providerId: string | undefined): string {
    if (!providerId) return language.modelProfiles.compatibilityProvider
    if (providerId in language.modelProfiles.providerNames) {
      return language.modelProfiles.providerNames[providerId as FirstClassModelProfileProviderId]
    }
    return providerId
  }

  function modelLabel(profile: ModelProfileRecord): string {
    const modelId = profile.modelId ?? ''
    return getModelInfo(modelId)?.fullName || modelId || language.none
  }

  function requestModelLabel(profile: ModelProfileRecord): string {
    return profile.providerOptions?.requestModel?.trim() || profile.modelId || language.none
  }

  function fallbackCount(profile: ModelProfileRecord): string {
    return language.modelRoles.fallbackCount(profile.fallbacks?.length ?? 0)
  }

  function statusLabel(profile: ModelProfileRecord): string {
    const resolved = resolveModelProfileByProfileId({
      database: getDatabase(),
      role: 'chatMain',
      profileId: profile.id,
      lookupModelInfo: (_database, id) => getModelInfo(id),
    })
    if (!resolved) return language.modelProfiles.statusBuckets.incomplete
    const bucket = language.modelProfiles.statusBuckets[resolved.status.bucket]
    if (resolved.status.reasons.length === 0) return bucket
    return `${bucket}: ${resolved.status.reasons
      .map((reason) => language.modelProfiles.statusReasons[reason] ?? reason)
      .join(', ')}`
  }

  function rolesUsingProfile(profileId: string): ModelRole[] {
    const bindings = normalizeModelRoleProfiles(getDatabase().modelRoleProfiles)
    return MODEL_ROLES.filter((role) => {
      const binding = bindings[role]
      return binding.mode === 'profile' && binding.profileId === profileId
    })
  }

  function roleListLabel(roles: ModelRole[]): string {
    if (roles.length === 0) return language.modelProfiles.notUsedByRoles
    return roles.map((role) => language.modelRoles.roles[role]).join(', ')
  }

  function modelPresetLabelsUsingProfile(profileId: string): string[] {
    return (getDatabase().modelPresets ?? []).flatMap((preset, index) => {
      const bindings = normalizeModelRoleProfiles(preset.modelRoleProfiles)
      const referencesProfile = MODEL_ROLES.some((role) => {
        const binding = bindings[role]
        return binding.mode === 'profile' && binding.profileId === profileId
      })
      if (!referencesProfile) return []
      return [preset.name?.trim() || language.modelProfiles.defaultPresetName(index + 1)]
    })
  }

  function openCreateEditor(): void {
    if (busy || mutationQueued) return
    editorMode = 'create'
    editingProfileId = null
    editingProfileBaseline = null
    editorKey += 1
    commandError = ''
  }

  function openEditEditor(profile: ModelProfileRecord): void {
    if (busy || mutationQueued) return
    editorMode = 'edit'
    editingProfileId = profile.id
    editingProfileBaseline = cloneJsonValue(profile)
    editorKey += 1
    commandError = ''
  }

  function closeEditor(): void {
    editorMode = null
    editingProfileId = null
    editingProfileBaseline = null
    commandError = ''
  }

  function cloneJsonValue<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T
  }

  function isProfileListProjection(
    projection: PendingModelMutationProjection,
  ): projection is ProfileListPendingProjection {
    return (
      projection.kind === 'profile-create' ||
      projection.kind === 'profile-update' ||
      projection.kind === 'profile-duplicate' ||
      projection.kind === 'profile-delete' ||
      projection.kind === 'profile-reorder'
    )
  }

  function commandErrorMessage(result: Exclude<ServerCommandResult, { status: 'ok' }>): string {
    return result.status === 'conflict'
      ? language.modelProfiles.commandConflict
      : result.status === 'error'
        ? result.error
        : language.modelProfiles.commandUnavailable
  }

  async function saveEditor(profile: ModelProfileSnapshot): Promise<void> {
    const modeAtSave = editorMode
    const profileIdAtSave = editingProfileId
    if (!modeAtSave || busy || mutationQueued) return
    commandError = ''
    let profileIdForUpdate = ''
    let expectedProfileForUpdate: ModelProfileSnapshot | null = null
    if (modeAtSave === 'edit') {
      const existing = profileIdAtSave ? profiles.find((candidate) => candidate.id === profileIdAtSave) : undefined
      if (!existing || !editingProfileBaseline || editingProfileBaseline.id !== profileIdAtSave) {
        commandError = language.modelProfiles.editTargetMissing
        return
      }
      profileIdForUpdate = profileIdAtSave
      expectedProfileForUpdate = cloneJsonValue(editingProfileBaseline)
    }

    busy = true
    const queuedAttempt: ProfileListPendingProjection =
      modeAtSave === 'create'
        ? {
            kind: 'profile-create',
            baselineIds: profiles.map((candidate) => candidate.id),
            attemptedFingerprint: profileProjectionFingerprint(profile, true),
          }
        : {
            kind: 'profile-update',
            profileId: profileIdForUpdate,
            attemptedFingerprint: profileProjectionFingerprint(profile),
          }
    const pendingToken = beginPendingModelMutation('model-profiles', queuedAttempt)
    if (!pendingToken) {
      busy = false
      return
    }
    try {
      const outcome =
        modeAtSave === 'create'
          ? await createModelProfileDurably(profile)
          : await updateModelProfileDurably(profileIdForUpdate, profile, expectedProfileForUpdate!)

      if (outcome.status === 'accepted') {
        finishPendingModelMutation(pendingToken)
        closeEditor()
        return
      }
      if (outcome.status === 'queued') {
        retainPendingModelMutation(pendingToken, outcome.mutationId)
        closeEditor()
        return
      }
      finishPendingModelMutation(pendingToken)
      commandError = commandErrorMessage(outcome.result)
    } catch {
      finishPendingModelMutation(pendingToken)
      commandError = commandErrorMessage({ status: 'unavailable' })
    } finally {
      busy = false
    }
  }

  async function duplicateProfile(profile: ModelProfileRecord): Promise<void> {
    if (busy || mutationQueued) return
    busy = true
    commandError = ''
    const queuedAttempt: ProfileListPendingProjection = {
      kind: 'profile-duplicate',
      baselineIds: profiles.map((candidate) => candidate.id),
      attemptedFingerprint: profileProjectionFingerprint(
        { ...cloneJsonValue(profile), name: language.modelProfiles.copyName(profile.name) },
        true,
      ),
    }
    const pendingToken = beginPendingModelMutation('model-profiles', queuedAttempt)
    if (!pendingToken) {
      busy = false
      return
    }
    try {
      const outcome = await duplicateModelProfileDurably(profile.id, language.modelProfiles.copyName(profile.name))
      if (outcome.status === 'accepted') {
        finishPendingModelMutation(pendingToken)
        return
      }
      if (outcome.status === 'queued') {
        retainPendingModelMutation(pendingToken, outcome.mutationId)
        return
      }
      finishPendingModelMutation(pendingToken)
      commandError = commandErrorMessage(outcome.result)
    } catch {
      finishPendingModelMutation(pendingToken)
      commandError = commandErrorMessage({ status: 'unavailable' })
    } finally {
      busy = false
    }
  }

  async function reorderProfiles(order: ModelProfileOrderEntry[]): Promise<void> {
    if (busy || mutationQueued) return
    busy = true
    commandError = ''
    const pendingToken = beginPendingModelMutation('model-profiles', {
      kind: 'profile-reorder',
      order,
    })
    if (!pendingToken) {
      busy = false
      return
    }
    try {
      const outcome = await reorderModelProfilesDurably(order)
      if (outcome.status === 'accepted') {
        finishPendingModelMutation(pendingToken)
        return
      }
      if (outcome.status === 'queued') {
        retainPendingModelMutation(pendingToken, outcome.mutationId)
        return
      }
      finishPendingModelMutation(pendingToken)
      commandError = commandErrorMessage(outcome.result)
    } catch {
      finishPendingModelMutation(pendingToken)
      commandError = commandErrorMessage({ status: 'unavailable' })
    } finally {
      busy = false
    }
  }

  function handleProfileSortEnd(event: SortableEvent): void {
    const oldIndex = event.oldDraggableIndex
    const newIndex = event.newDraggableIndex
    const orderKey = (event.item as HTMLElement).dataset.modelProfileOrderKey
    restoreProfileSortableDom(event, orderKey)
    if (
      busy ||
      mutationQueued ||
      oldIndex === undefined ||
      newIndex === undefined ||
      oldIndex === newIndex ||
      !orderKey
    ) {
      return
    }
    const sourceIndex = profileOrder.findIndex((entry) => modelProfileOrderEntryKey(entry) === orderKey)
    if (sourceIndex < 0 || newIndex < 0 || newIndex >= profileOrder.length) return
    const reordered = [...profileOrder]
    const [moved] = reordered.splice(sourceIndex, 1)
    if (!moved) return
    reordered.splice(newIndex, 0, moved)
    void reorderProfiles(reordered)
  }

  function restoreProfileSortableDom(event: SortableEvent, orderKey: string | undefined): void {
    if (!orderKey) return
    const originalDropZone = Array.from(event.from.querySelectorAll<HTMLElement>('[data-model-profile-drop-key]')).find(
      (candidate) => candidate.dataset.modelProfileDropKey === orderKey,
    )
    originalDropZone?.after(event.item)
  }

  function addDivider(): void {
    if (busy || mutationQueued) return
    const id = `mpd_${createNonSecurityUuid()}`
    void reorderProfiles([...profileOrder, { kind: 'divider', id }])
  }

  function deleteDivider(dividerId: string): void {
    if (busy || mutationQueued || !window.confirm(language.modelProfiles.deleteDividerConfirm)) return
    void reorderProfiles(profileOrder.filter((entry) => entry.kind !== 'divider' || entry.id !== dividerId))
  }

  function deleteReassignments(profileId: string): Partial<Record<ModelRole, ModelRoleProfileBinding>> {
    const reassignments: Partial<Record<ModelRole, ModelRoleProfileBinding>> = {}
    for (const role of rolesUsingProfile(profileId)) {
      reassignments[role] = modelRoleProfileInheritSource(role) ? { mode: 'inherit' } : { mode: 'legacy' }
    }
    return reassignments
  }

  async function deleteProfile(profile: ModelProfileRecord): Promise<void> {
    if (busy || mutationQueued) return
    const usedByModelPresets = modelPresetLabelsUsingProfile(profile.id)
    if (usedByModelPresets.length > 0) {
      commandError = language.modelProfiles.profileUsedByModelPresets(profile.name, usedByModelPresets.join(', '))
      return
    }
    const usedByRoles = rolesUsingProfile(profile.id)
    const message =
      usedByRoles.length > 0
        ? language.modelProfiles.deleteProfileReassignConfirm(profile.name, roleListLabel(usedByRoles))
        : language.modelProfiles.deleteProfileConfirm(profile.name)
    if (!window.confirm(message)) return

    busy = true
    commandError = ''
    const pendingToken = beginPendingModelMutation('model-profiles', {
      kind: 'profile-delete',
      profileId: profile.id,
    })
    if (!pendingToken) {
      busy = false
      return
    }
    try {
      const outcome = await deleteModelProfileDurably(profile.id, deleteReassignments(profile.id))
      if (outcome.status === 'accepted') {
        finishPendingModelMutation(pendingToken)
        return
      }
      if (outcome.status === 'queued') {
        retainPendingModelMutation(pendingToken, outcome.mutationId)
        return
      }
      finishPendingModelMutation(pendingToken)
      commandError = commandErrorMessage(outcome.result)
    } catch {
      finishPendingModelMutation(pendingToken)
      commandError = commandErrorMessage({ status: 'unavailable' })
    } finally {
      busy = false
    }
  }
</script>

<section class="flex flex-col gap-4">
  <ModelRuntimeDefaultsEditor />

  {#if commandError}
    <div class="rounded-md border border-draculared p-3 text-sm text-draculared">{commandError}</div>
  {/if}
  <div class="mt-4 flex flex-wrap items-center justify-between gap-2">
    <div>
      <h3 class="text-lg font-semibold">{language.modelProfiles.profilesTabTitle}</h3>
      <span class="text-sm text-textcolor2">{language.modelProfiles.profilesTabDescription}</span>
    </div>
    <div class="flex flex-wrap gap-2">
      <Button size="sm" styled="outlined" disabled={busy || mutationQueued} onclick={addDivider}>
        <span class="inline-flex items-center gap-2"><MinusIcon size={16} />{language.modelProfiles.addDivider}</span>
      </Button>
      <Button size="sm" disabled={busy || mutationQueued} onclick={openCreateEditor}>
        <span class="inline-flex items-center gap-2"><PlusIcon size={16} />{language.modelProfiles.createProfile}</span>
      </Button>
    </div>
  </div>

  {#if profileItems.length === 0}
    <div class="rounded-md border border-darkborderc p-4 text-sm text-textcolor2">
      {language.modelProfiles.noProfiles}
    </div>
  {:else}
    <div class="flex flex-col" role="list" bind:this={profileListElement}>
      {#each profileItems as item (modelProfileListItemKey(item))}
        {@const orderKey = modelProfileListItemKey(item)}
        <div role="presentation" data-model-profile-drop-key={orderKey} class="contents"></div>
        {#if item.kind === 'profile'}
          {@const profile = item.profile}
          <article
            class="risu-card flex flex-col gap-2 text-sm"
            role="listitem"
            data-model-profile-row
            data-model-profile-sortable-item
            data-model-profile-order-key={orderKey}
            data-profile-id={profile.id}>
            <div class="flex flex-wrap items-center gap-2">
              <span
                class="flex h-11 w-11 shrink-0 touch-none cursor-grab items-center justify-center text-textcolor2 active:cursor-grabbing"
                title={language.modelProfiles.dragProfile}
                data-model-profile-drag-handle
                aria-hidden="true">
                <GripVerticalIcon size={16} />
              </span>
              <span class="font-medium">{profile.name}</span>
              <span class="rounded-sm bg-white/10 px-2 py-1 text-xs">
                {statusLabel(profile)}
              </span>
              <div class="ml-auto flex flex-wrap gap-2">
                <Button
                  size="sm"
                  styled="outlined"
                  disabled={busy || mutationQueued}
                  onclick={() => openEditEditor(profile)}>
                  <span class="inline-flex items-center gap-1"
                    ><PencilIcon size={14} />{language.modelProfiles.edit}</span>
                </Button>
                <Button
                  size="sm"
                  styled="outlined"
                  disabled={busy || mutationQueued}
                  onclick={() => duplicateProfile(profile)}>
                  <span class="inline-flex items-center gap-1"
                    ><CopyIcon size={14} />{language.modelProfiles.duplicate}</span>
                </Button>
                <Button
                  size="sm"
                  styled="danger"
                  disabled={busy || mutationQueued}
                  onclick={() => deleteProfile(profile)}>
                  <span class="inline-flex items-center gap-1"
                    ><TrashIcon size={14} />{language.modelProfiles.delete}</span>
                </Button>
              </div>
            </div>
            {#if !profile.id.startsWith('mp_')}
              <span class="break-all text-xs text-textcolor2">{profile.id}</span>
            {/if}
            <span class="break-all text-xs text-textcolor2">
              {providerLabel(profile.providerId)} · {modelLabel(profile)} · {requestModelLabel(profile)} ·
              {fallbackCount(profile)}
            </span>
          </article>
        {:else}
          <div
            class="flex items-center rounded-md transition-colors hover:bg-white/5"
            role="listitem"
            data-model-profile-divider-row
            data-model-profile-sortable-item
            data-model-profile-order-key={orderKey}
            data-divider-id={item.id}>
            <span
              class="flex h-11 w-11 shrink-0 touch-none cursor-grab items-center justify-center text-textcolor2 active:cursor-grabbing"
              title={language.modelProfiles.dragDivider}
              data-model-profile-drag-handle
              aria-hidden="true">
              <GripVerticalIcon size={16} />
            </span>
            <button
              type="button"
              class="flex min-h-11 flex-1 cursor-pointer items-center gap-3 px-2 py-3 text-textcolor2"
              aria-label={language.modelProfiles.deleteDividerConfirm}
              disabled={busy || mutationQueued}
              onclick={() => deleteDivider(item.id)}>
              <span class="h-px flex-1 bg-darkborderc"></span>
              <span aria-hidden="true">---</span>
              <span class="h-px flex-1 bg-darkborderc"></span>
            </button>
          </div>
        {/if}
      {/each}
    </div>
  {/if}

  {#if editorMode}
    {#key editorKey}
      <ModelProfileEditorDrawer
        mode={editorMode}
        profile={editingProfileBaseline ?? editingProfile}
        {profiles}
        {profileOrder}
        {credentials}
        statusText={editingProfile ? statusLabel(editingProfile) : language.modelProfiles.statusBuckets.incomplete}
        {busy}
        {commandError}
        onSave={saveEditor}
        onCancel={closeEditor}
        {onManageCredentials} />
    {/key}
  {/if}
</section>
