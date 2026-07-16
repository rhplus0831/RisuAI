<script lang="ts">
  import { CopyIcon, PencilIcon, PlusIcon, TrashIcon } from '@lucide/svelte'
  import { language } from 'src/lang'
  import Button from 'src/lib/UI/GUI/Button.svelte'
  import {
    resolveModelProfileByProfileId,
    type FirstClassModelProfileProviderId,
  } from 'src/ts/model/modelProfileResolver'
  import {
    normalizeModelRoleProfiles,
    type ModelProfileRecord,
    type ModelRoleProfileBinding,
  } from 'src/ts/model/modelProfileRecords'
  import { MODEL_ROLES, modelRoleProfileInheritSource, type ModelRole } from 'src/ts/model/modelRoles'
  import { getModelInfo } from 'src/ts/model/modellist'
  import {
    createModelProfileDurably,
    deleteModelProfileDurably,
    duplicateModelProfileDurably,
    updateModelProfileDurably,
  } from 'src/ts/model/modelProfileMutations'
  import type { ModelProfileSnapshot, ServerCommandResult } from 'src/ts/server/commands'
  import { getDatabase } from 'src/ts/storage/database.svelte'
  import { MASKED_PROVIDER_SECRET } from 'src/ts/providerSecretMask'
  import ModelProfileEditorDrawer from './ModelProfileEditorDrawer.svelte'
  import ModelRuntimeDefaultsEditor from './ModelRuntimeDefaultsEditor.svelte'

  type EditorMode = 'create' | 'edit' | null
  type QueuedProfileMutation =
    | { kind: 'create'; baselineIds: string[]; attemptedProfile: ModelProfileSnapshot }
    | { kind: 'update'; profileId: string; attemptedProfile: ModelProfileSnapshot }
    | { kind: 'duplicate'; baselineIds: string[]; attemptedProfile: ModelProfileSnapshot }
    | { kind: 'delete'; profileId: string }

  let editorMode = $state<EditorMode>(null)
  let editingProfileId = $state<string | null>(null)
  let editingProfileBaseline = $state<ModelProfileRecord | null>(null)
  let editorKey = $state(0)
  let busy = $state(false)
  let queuedMutation = $state<QueuedProfileMutation | null>(null)
  let commandError = $state('')
  let commandNotice = $state('')

  let profiles = $derived(getDatabase().modelProfiles ?? [])
  let mutationQueued = $derived(queuedMutation !== null)
  let editingProfile = $derived(
    editingProfileId ? profiles.find((profile) => profile.id === editingProfileId) : undefined,
  )

  $effect(() => {
    if (!queuedMutation || !queuedProfileMutationApplied(queuedMutation, profiles)) return
    queuedMutation = null
    commandNotice = ''
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

  function openCreateEditor(): void {
    if (busy || mutationQueued) return
    editorMode = 'create'
    editingProfileId = null
    editingProfileBaseline = null
    editorKey += 1
    commandError = ''
    commandNotice = ''
  }

  function openEditEditor(profile: ModelProfileRecord): void {
    if (busy || mutationQueued) return
    editorMode = 'edit'
    editingProfileId = profile.id
    editingProfileBaseline = cloneJsonValue(profile)
    editorKey += 1
    commandError = ''
    commandNotice = ''
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

  function queuedProfileMutationApplied(queued: QueuedProfileMutation, currentProfiles: ModelProfileRecord[]): boolean {
    if (queued.kind === 'delete') return !currentProfiles.some((profile) => profile.id === queued.profileId)
    if (queued.kind === 'update') {
      const profile = currentProfiles.find((candidate) => candidate.id === queued.profileId)
      return (
        !!profile && profileProjectionFingerprint(profile) === profileProjectionFingerprint(queued.attemptedProfile)
      )
    }

    const baselineIds = new Set(queued.baselineIds)
    const attemptedFingerprint = profileProjectionFingerprint(queued.attemptedProfile, true)
    return currentProfiles.some(
      (profile) => !baselineIds.has(profile.id) && profileProjectionFingerprint(profile, true) === attemptedFingerprint,
    )
  }

  function profileProjectionFingerprint(profile: ModelProfileSnapshot, omitId = false): string {
    const snapshot = cloneJsonValue(profile) as Record<string, unknown>
    if (omitId) delete snapshot.id
    const providerOptions = snapshot.providerOptions
    if (providerOptions && typeof providerOptions === 'object' && !Array.isArray(providerOptions)) {
      const options = providerOptions as Record<string, unknown>
      if (typeof options.apiKey === 'string' && options.apiKey !== '') options.apiKey = MASKED_PROVIDER_SECRET
      const vertex = options.vertex
      if (vertex && typeof vertex === 'object' && !Array.isArray(vertex)) {
        const vertexOptions = vertex as Record<string, unknown>
        if (typeof vertexOptions.privateKey === 'string' && vertexOptions.privateKey !== '') {
          vertexOptions.privateKey = MASKED_PROVIDER_SECRET
        }
      }
    }
    return JSON.stringify(canonicalJsonValue(snapshot))
  }

  function canonicalJsonValue(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonicalJsonValue)
    if (!value || typeof value !== 'object') return value
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalJsonValue(child)]),
    )
  }

  function commandErrorMessage(result: Exclude<ServerCommandResult, { status: 'ok' }>): string {
    return result.status === 'conflict'
      ? language.modelProfiles.commandConflict
      : result.status === 'error'
        ? result.error
        : language.modelProfiles.commandUnavailable
  }

  function settleQueuedMutation(queued: QueuedProfileMutation): void {
    queuedMutation = cloneJsonValue(queued)
    commandNotice = language.modelProfiles.commandQueued
  }

  async function saveEditor(profile: ModelProfileSnapshot): Promise<void> {
    const modeAtSave = editorMode
    const profileIdAtSave = editingProfileId
    if (!modeAtSave || busy || mutationQueued) return
    commandError = ''
    commandNotice = ''
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
    const queuedAttempt: QueuedProfileMutation =
      modeAtSave === 'create'
        ? {
            kind: 'create',
            baselineIds: profiles.map((candidate) => candidate.id),
            attemptedProfile: cloneJsonValue(profile),
          }
        : {
            kind: 'update',
            profileId: profileIdForUpdate,
            attemptedProfile: cloneJsonValue(profile),
          }
    const outcome =
      modeAtSave === 'create'
        ? await createModelProfileDurably(profile)
        : await updateModelProfileDurably(profileIdForUpdate, profile, expectedProfileForUpdate!)

    busy = false
    if (outcome.status === 'accepted') {
      closeEditor()
      return
    }
    if (outcome.status === 'queued') {
      closeEditor()
      settleQueuedMutation(queuedAttempt)
      return
    }
    commandError = commandErrorMessage(outcome.result)
  }

  async function duplicateProfile(profile: ModelProfileRecord): Promise<void> {
    if (busy || mutationQueued) return
    busy = true
    commandError = ''
    commandNotice = ''
    const queuedAttempt: QueuedProfileMutation = {
      kind: 'duplicate',
      baselineIds: profiles.map((candidate) => candidate.id),
      attemptedProfile: { ...cloneJsonValue(profile), name: language.modelProfiles.copyName(profile.name) },
    }
    const outcome = await duplicateModelProfileDurably(profile.id, language.modelProfiles.copyName(profile.name), true)
    busy = false
    if (outcome.status === 'accepted') return
    if (outcome.status === 'queued') {
      settleQueuedMutation(queuedAttempt)
      return
    }
    commandError = commandErrorMessage(outcome.result)
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
    const usedByRoles = rolesUsingProfile(profile.id)
    const message =
      usedByRoles.length > 0
        ? language.modelProfiles.deleteProfileReassignConfirm(profile.name, roleListLabel(usedByRoles))
        : language.modelProfiles.deleteProfileConfirm(profile.name)
    if (!window.confirm(message)) return

    busy = true
    commandError = ''
    commandNotice = ''
    const outcome = await deleteModelProfileDurably(profile.id, deleteReassignments(profile.id))
    busy = false
    if (outcome.status === 'accepted') return
    if (outcome.status === 'queued') {
      settleQueuedMutation({ kind: 'delete', profileId: profile.id })
      return
    }
    commandError = commandErrorMessage(outcome.result)
  }
</script>

<section class="flex flex-col gap-4">
  <ModelRuntimeDefaultsEditor />

  {#if commandError}
    <div class="rounded-md border border-draculared p-3 text-sm text-draculared">{commandError}</div>
  {/if}
  {#if commandNotice}
    <div class="rounded-md border border-selected p-3 text-sm text-textcolor" data-model-profile-command-notice>
      {commandNotice}
    </div>
  {/if}

  <div class="flex flex-wrap items-center justify-between gap-2">
    <div>
      <h3 class="text-lg font-semibold">{language.modelProfiles.profilesTabTitle}</h3>
      <span class="text-sm text-textcolor2">{language.modelProfiles.profilesTabDescription}</span>
    </div>
    <Button size="sm" disabled={busy || mutationQueued} onclick={openCreateEditor}>
      <span class="inline-flex items-center gap-2"><PlusIcon size={16} />{language.modelProfiles.createProfile}</span>
    </Button>
  </div>

  {#if profiles.length === 0}
    <div class="rounded-md border border-darkborderc p-4 text-sm text-textcolor2">
      {language.modelProfiles.noProfiles}
    </div>
  {:else}
    <div class="overflow-x-auto rounded-md border border-darkborderc">
      <table class="w-full min-w-[52rem] text-sm">
        <thead class="bg-darkbg text-left text-xs uppercase text-textcolor2">
          <tr>
            <th class="px-3 py-2 font-medium">{language.modelProfiles.profileNameColumn}</th>
            <th class="px-3 py-2 font-medium">{language.modelProfiles.providerColumn}</th>
            <th class="px-3 py-2 font-medium">{language.modelProfiles.modelColumn}</th>
            <th class="px-3 py-2 font-medium">{language.modelProfiles.requestModelColumn}</th>
            <th class="px-3 py-2 font-medium">{language.modelProfiles.fallbackColumn}</th>
            <th class="px-3 py-2 font-medium">{language.modelProfiles.statusColumn}</th>
            <th class="px-3 py-2 font-medium">{language.modelProfiles.usedByColumn}</th>
            <th class="px-3 py-2 font-medium">{language.modelProfiles.actionsColumn}</th>
          </tr>
        </thead>
        <tbody>
          {#each profiles as profile (profile.id)}
            {@const usedByRoles = rolesUsingProfile(profile.id)}
            <tr class="border-t border-darkborderc align-top">
              <td class="px-3 py-3">
                <span class="block font-medium">{profile.name}</span>
                <span class="block text-xs text-textcolor2">{profile.id}</span>
              </td>
              <td class="px-3 py-3">{providerLabel(profile.providerId)}</td>
              <td class="px-3 py-3">{modelLabel(profile)}</td>
              <td class="px-3 py-3">{requestModelLabel(profile)}</td>
              <td class="px-3 py-3 text-textcolor2">{fallbackCount(profile)}</td>
              <td class="px-3 py-3">{statusLabel(profile)}</td>
              <td class="px-3 py-3 text-textcolor2">{roleListLabel(usedByRoles)}</td>
              <td class="px-3 py-3">
                <div class="flex flex-wrap gap-2">
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
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}

  {#if editorMode}
    {#key editorKey}
      <ModelProfileEditorDrawer
        mode={editorMode}
        profile={editingProfileBaseline ?? editingProfile}
        {profiles}
        usedByRoles={editingProfile ? rolesUsingProfile(editingProfile.id) : []}
        statusText={editingProfile ? statusLabel(editingProfile) : language.modelProfiles.statusBuckets.incomplete}
        {busy}
        {commandError}
        onSave={saveEditor}
        onCancel={closeEditor} />
    {/key}
  {/if}
</section>
