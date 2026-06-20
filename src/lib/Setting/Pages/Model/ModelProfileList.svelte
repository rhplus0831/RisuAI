<script lang="ts">
  import { CopyIcon, PencilIcon, PlusIcon, SaveIcon, TrashIcon, XIcon } from '@lucide/svelte'
  import { language } from 'src/lang'
  import Button from 'src/lib/UI/GUI/Button.svelte'
  import OptionInput from 'src/lib/UI/GUI/OptionInput.svelte'
  import SelectInput from 'src/lib/UI/GUI/SelectInput.svelte'
  import TextInput from 'src/lib/UI/GUI/TextInput.svelte'
  import {
    FIRST_CLASS_MODEL_PROFILE_PROVIDER_IDS,
    resolveModelProfileByProfileId,
    type FirstClassModelProfileProviderId,
  } from 'src/ts/model/modelProfileResolver'
  import {
    normalizeModelRuntimeDefaults,
    normalizeModelRoleProfiles,
    type ModelProfileRecord,
    type ModelProfileRecordProviderOptions,
    type ModelRoleProfileBinding,
  } from 'src/ts/model/modelProfileRecords'
  import { MODEL_ROLES, modelRoleProfileInheritSource, type ModelRole } from 'src/ts/model/modelRoles'
  import { getModelInfo } from 'src/ts/model/modellist'
  import {
    createModelProfileCommand,
    deleteModelProfileCommand,
    duplicateModelProfileCommand,
    runServerCommand,
    updateModelProfileCommand,
    type ModelProfileSnapshot,
  } from 'src/ts/server/commands'
  import { DBState } from 'src/ts/stores.svelte'

  type EditorMode = 'create' | 'edit' | null

  let editorMode = $state<EditorMode>(null)
  let editingProfileId = $state<string | null>(null)
  let draftName = $state('')
  let draftProviderId = $state('')
  let draftModelId = $state('')
  let draftRequestModel = $state('')
  let busy = $state(false)
  let commandError = $state('')

  let profiles = $derived(DBState.db.modelProfiles ?? [])
  let runtimeDefaults = $derived(normalizeModelRuntimeDefaults(DBState.db.modelRuntimeDefaults))
  let runtimeDefaultCount = $derived(Object.keys(runtimeDefaults).length)

  function cloneJsonValue<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T
  }

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
      database: DBState.db,
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
    const bindings = normalizeModelRoleProfiles(DBState.db.modelRoleProfiles)
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
    editorMode = 'create'
    editingProfileId = null
    draftName = language.modelProfiles.newProfileDefaultName
    draftProviderId = ''
    draftModelId = ''
    draftRequestModel = ''
    commandError = ''
  }

  function openEditEditor(profile: ModelProfileRecord): void {
    editorMode = 'edit'
    editingProfileId = profile.id
    draftName = profile.name
    draftProviderId = profile.providerId ?? ''
    draftModelId = profile.modelId ?? ''
    draftRequestModel = profile.providerOptions?.requestModel ?? ''
    commandError = ''
  }

  function closeEditor(): void {
    editorMode = null
    editingProfileId = null
    commandError = ''
  }

  function providerOptionsForSave(existing?: ModelProfileRecord): ModelProfileRecordProviderOptions | undefined {
    const providerOptions = cloneJsonValue(existing?.providerOptions ?? {})
    const requestModel = draftRequestModel.trim()
    if (requestModel) {
      providerOptions.requestModel = requestModel
    } else {
      delete providerOptions.requestModel
    }
    return Object.keys(providerOptions).length > 0 ? providerOptions : undefined
  }

  function profileSnapshotForSave(existing?: ModelProfileRecord): ModelProfileSnapshot {
    const providerId = draftProviderId.trim()
    const modelId = draftModelId.trim()
    const profile: ModelProfileSnapshot = {
      ...(existing ? cloneJsonValue(existing) : {}),
      name: draftName.trim() || existing?.name || language.modelProfiles.newProfileDefaultName,
    }
    if (providerId) {
      profile.providerId = providerId
    } else {
      delete profile.providerId
    }
    if (modelId) {
      profile.modelId = modelId
    } else {
      delete profile.modelId
    }

    const providerOptions = providerOptionsForSave(existing)
    if (providerOptions) {
      profile.providerOptions = providerOptions
    } else {
      delete profile.providerOptions
    }
    return profile
  }

  async function saveEditor(): Promise<void> {
    if (!editorMode || busy) return
    busy = true
    commandError = ''
    const existing = editingProfileId ? profiles.find((profile) => profile.id === editingProfileId) : undefined
    const profile = profileSnapshotForSave(existing)
    const result =
      editorMode === 'edit' && existing
        ? await runServerCommand({
            command: (baseRevision) =>
              updateModelProfileCommand({
                baseRevision,
                profileId: existing.id,
                profile,
              }),
          })
        : await runServerCommand({
            command: (baseRevision) =>
              createModelProfileCommand({
                baseRevision,
                profile,
              }),
          })

    busy = false
    if (result.status === 'ok') {
      closeEditor()
      return
    }
    commandError =
      result.status === 'conflict'
        ? language.modelProfiles.commandConflict
        : result.status === 'error'
          ? result.error
          : language.modelProfiles.commandUnavailable
  }

  async function duplicateProfile(profile: ModelProfileRecord): Promise<void> {
    if (busy) return
    busy = true
    commandError = ''
    const result = await runServerCommand({
      command: (baseRevision) =>
        duplicateModelProfileCommand({
          baseRevision,
          profileId: profile.id,
          name: language.modelProfiles.copyName(profile.name),
          includeSecrets: false,
        }),
    })
    busy = false
    if (result.status === 'ok') return
    commandError =
      result.status === 'conflict'
        ? language.modelProfiles.commandConflict
        : result.status === 'error'
          ? result.error
          : language.modelProfiles.commandUnavailable
  }

  function deleteReassignments(profileId: string): Partial<Record<ModelRole, ModelRoleProfileBinding>> {
    const reassignments: Partial<Record<ModelRole, ModelRoleProfileBinding>> = {}
    for (const role of rolesUsingProfile(profileId)) {
      reassignments[role] = modelRoleProfileInheritSource(role) ? { mode: 'inherit' } : { mode: 'legacy' }
    }
    return reassignments
  }

  async function deleteProfile(profile: ModelProfileRecord): Promise<void> {
    if (busy) return
    const usedByRoles = rolesUsingProfile(profile.id)
    const message =
      usedByRoles.length > 0
        ? language.modelProfiles.deleteProfileReassignConfirm(profile.name, roleListLabel(usedByRoles))
        : language.modelProfiles.deleteProfileConfirm(profile.name)
    if (!window.confirm(message)) return

    busy = true
    commandError = ''
    const result = await runServerCommand({
      command: (baseRevision) =>
        deleteModelProfileCommand({
          baseRevision,
          profileId: profile.id,
          reassignments: deleteReassignments(profile.id),
        }),
    })
    busy = false
    if (result.status === 'ok') return
    commandError =
      result.status === 'conflict'
        ? language.modelProfiles.commandConflict
        : result.status === 'error'
          ? result.error
          : language.modelProfiles.commandUnavailable
  }
</script>

<section class="flex flex-col gap-4">
  <div class="rounded-md border border-darkborderc p-3">
    <div class="flex flex-col gap-1">
      <h3 class="text-lg font-semibold">{language.modelProfiles.runtimeDefaultsTitle}</h3>
      <span class="text-sm text-textcolor2">{language.modelProfiles.runtimeDefaultsPlaceholder}</span>
    </div>
    <div class="mt-3 text-sm text-textcolor2">
      {runtimeDefaultCount === 0
        ? language.modelProfiles.runtimeDefaultsEmpty
        : language.modelProfiles.runtimeDefaultsSummary(runtimeDefaultCount)}
    </div>
  </div>

  {#if commandError}
    <div class="rounded-md border border-draculared p-3 text-sm text-draculared">{commandError}</div>
  {/if}

  <div class="flex flex-wrap items-center justify-between gap-2">
    <div>
      <h3 class="text-lg font-semibold">{language.modelProfiles.profilesTabTitle}</h3>
      <span class="text-sm text-textcolor2">{language.modelProfiles.profilesTabDescription}</span>
    </div>
    <Button size="sm" onclick={openCreateEditor}>
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
                  <Button size="sm" styled="outlined" disabled={busy} onclick={() => openEditEditor(profile)}>
                    <span class="inline-flex items-center gap-1"
                      ><PencilIcon size={14} />{language.modelProfiles.edit}</span>
                  </Button>
                  <Button size="sm" styled="outlined" disabled={busy} onclick={() => duplicateProfile(profile)}>
                    <span class="inline-flex items-center gap-1"
                      ><CopyIcon size={14} />{language.modelProfiles.duplicate}</span>
                  </Button>
                  <Button size="sm" styled="danger" disabled={busy} onclick={() => deleteProfile(profile)}>
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
    <div class="rounded-md border border-selected p-3">
      <div class="mb-3 flex items-center justify-between gap-2">
        <h4 class="text-base font-semibold">
          {editorMode === 'create' ? language.modelProfiles.createProfile : language.modelProfiles.editProfile}
        </h4>
        <Button size="sm" styled="outlined" disabled={busy} onclick={closeEditor}>
          <span class="inline-flex items-center gap-1"><XIcon size={14} />{language.modelProfiles.cancel}</span>
        </Button>
      </div>

      <div class="grid gap-3 md:grid-cols-2">
        <label class="flex flex-col gap-1">
          <span class="text-sm text-textcolor2">{language.modelProfiles.profileNameColumn}</span>
          <TextInput size="sm" fullwidth bind:value={draftName} />
        </label>
        <label class="flex flex-col gap-1">
          <span class="text-sm text-textcolor2">{language.modelProfiles.providerColumn}</span>
          <SelectInput size="sm" className="w-full" bind:value={draftProviderId}>
            <OptionInput value="">{language.modelProfiles.compatibilityProvider}</OptionInput>
            {#each FIRST_CLASS_MODEL_PROFILE_PROVIDER_IDS as providerId (providerId)}
              <OptionInput value={providerId}>{providerLabel(providerId)}</OptionInput>
            {/each}
          </SelectInput>
        </label>
        <label class="flex flex-col gap-1">
          <span class="text-sm text-textcolor2">{language.modelProfiles.modelColumn}</span>
          <TextInput
            size="sm"
            fullwidth
            bind:value={draftModelId}
            placeholder={language.modelProfiles.modelPlaceholder} />
        </label>
        <label class="flex flex-col gap-1">
          <span class="text-sm text-textcolor2">{language.modelProfiles.requestModelColumn}</span>
          <TextInput
            size="sm"
            fullwidth
            bind:value={draftRequestModel}
            placeholder={language.modelProfiles.requestModelPlaceholder} />
        </label>
      </div>

      <div class="mt-3 flex justify-end">
        <Button size="sm" disabled={busy} onclick={saveEditor}>
          <span class="inline-flex items-center gap-2"
            ><SaveIcon size={16} />{busy ? language.modelProfiles.saving : language.modelProfiles.save}</span>
        </Button>
      </div>
    </div>
  {/if}
</section>
