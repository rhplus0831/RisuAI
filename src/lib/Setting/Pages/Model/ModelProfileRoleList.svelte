<script lang="ts">
  import { language } from 'src/lang'
  import Button from 'src/lib/UI/GUI/Button.svelte'
  import OptionInput from 'src/lib/UI/GUI/OptionInput.svelte'
  import SelectInput from 'src/lib/UI/GUI/SelectInput.svelte'
  import { resolveModelProfileUiState } from 'src/ts/model/modelProfileUiState'
  import {
    normalizeModelRoleProfiles,
    type ModelRoleProfileBinding,
    type ModelRoleProfileMap,
  } from 'src/ts/model/modelProfileRecords'
  import { MODEL_ROLES, modelRoleProfileInheritSource, type ModelRole } from 'src/ts/model/modelRoles'
  import { getModelInfo } from 'src/ts/model/modellist'
  import { ProviderNames } from 'src/ts/model/types'
  import {
    beginPendingModelMutation,
    finishPendingModelMutation,
    getPendingModelMutations,
    isPendingModelMutationProjectionApplied,
    retainPendingModelMutation,
    subscribePendingModelMutations,
    updateModelRoleProfilesDurably,
  } from 'src/ts/model/modelProfileMutations'
  import type { ServerCommandResult } from 'src/ts/server/commands'
  import { getDatabase, type Database } from 'src/ts/storage/database.svelte'

  type BindingMode = ModelRoleProfileBinding['mode']

  let draftBindings = $state<ModelRoleProfileMap>(normalizeModelRoleProfiles(undefined))
  let serverBaselineBindings = $state<ModelRoleProfileMap>(normalizeModelRoleProfiles(undefined))
  let lastServerSnapshot = $state('')
  let applying = $state(false)
  let pendingMutations = $state(getPendingModelMutations('model-profiles'))
  let commandError = $state('')

  let profiles = $derived(getDatabase().modelProfiles ?? [])
  let profileIdSet = $derived(new Set(profiles.map((profile) => profile.id)))
  let resolverDatabase = $derived.by<Database>(() => ({
    ...getDatabase(),
    modelRoleProfiles: draftBindings,
  }))
  let uiState = $derived.by(() =>
    resolveModelProfileUiState({
      database: resolverDatabase,
      lookupModelInfo: (_database, id) => getModelInfo(id),
    }),
  )
  let changedBindings = $derived.by(() => collectChangedBindings())
  let hasChanges = $derived(Object.keys(changedBindings).length > 0)
  let applyQueued = $derived(pendingMutations.length > 0)
  let canApply = $derived(hasChanges && changedBindingsAreValid(changedBindings) && !applying && !applyQueued)

  $effect(() => {
    return subscribePendingModelMutations('model-profiles', (pending) => {
      pendingMutations = pending
    })
  })

  $effect(() => {
    const normalized = normalizeModelRoleProfiles(getDatabase().modelRoleProfiles)
    const snapshot = snapshotBindings(normalized)
    if (snapshot === lastServerSnapshot) return

    draftBindings = rebaseDraftBindings(serverBaselineBindings, draftBindings, normalized)
    serverBaselineBindings = cloneJsonValue(normalized)
    lastServerSnapshot = snapshot
    commandError = ''
  })

  $effect(() => {
    for (const pending of pendingMutations) {
      if (pending.phase === 'discarded') {
        commandError = language.modelProfiles.commandReplayDiscarded
        finishPendingModelMutation(pending.token)
        continue
      }
      if (pending.phase === 'dispatching' || pending.projection.kind !== 'role-bindings') continue
      if (isPendingModelMutationProjectionApplied(pending.projection, getDatabase())) {
        finishPendingModelMutation(pending.token)
      }
    }
  })

  function cloneJsonValue<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T
  }

  function snapshotBinding(binding: ModelRoleProfileBinding): string {
    return JSON.stringify(binding)
  }

  function snapshotBindings(bindings: ModelRoleProfileMap): string {
    return JSON.stringify(MODEL_ROLES.map((role) => [role, bindings[role]]))
  }

  function rebaseDraftBindings(
    previousServer: ModelRoleProfileMap,
    localDraft: ModelRoleProfileMap,
    nextServer: ModelRoleProfileMap,
  ): ModelRoleProfileMap {
    const rebased = cloneJsonValue(localDraft)
    for (const role of MODEL_ROLES) {
      if (snapshotBinding(localDraft[role]) === snapshotBinding(previousServer[role])) {
        rebased[role] = cloneJsonValue(nextServer[role])
      }
    }
    return rebased
  }

  function collectChangedBindings(): Partial<Record<ModelRole, ModelRoleProfileBinding>> {
    const changes: Partial<Record<ModelRole, ModelRoleProfileBinding>> = {}
    for (const role of MODEL_ROLES) {
      if (snapshotBinding(draftBindings[role]) !== snapshotBinding(serverBaselineBindings[role])) {
        changes[role] = draftBindings[role]
      }
    }
    return changes
  }

  function changedBindingsAreValid(bindings: Partial<Record<ModelRole, ModelRoleProfileBinding>>): boolean {
    return Object.entries(bindings).every(([role, binding]) => {
      if (binding?.mode === 'profile' && !profileIdSet.has(binding.profileId)) return false
      return role !== 'memory' || uiState.roleStatuses.memory.bucket !== 'unsupported'
    })
  }

  function roleLabel(role: ModelRole): string {
    return language.modelRoles.roles[role]
  }

  function roleDescription(role: ModelRole): string {
    return language.modelRoles.descriptions[role]
  }

  function bindingFor(role: ModelRole): ModelRoleProfileBinding {
    return draftBindings[role] ?? { mode: 'legacy' }
  }

  function profileName(profileId: string): string {
    return profiles.find((profile) => profile.id === profileId)?.name ?? profileId
  }

  function effectiveProfileName(role: ModelRole): string {
    const resolved = uiState.resolvedProfiles[role]
    if (resolved.source.profileName) return resolved.source.profileName
    if (resolved.source.kind === 'durable-profile') return profileName(resolved.profileId)
    if (resolved.status.bucket === 'compatibility') return language.modelProfiles.compatibilityProfile
    return resolved.profileId || language.none
  }

  function inheritedSourceLabel(role: ModelRole): string {
    const source = modelRoleProfileInheritSource(role)
    const binding = bindingFor(role)
    if (binding.mode !== 'inherit' || !source) return language.modelProfiles.noInheritedSource
    return language.modelRoles.sourceInherited(roleLabel(source))
  }

  function modelName(modelId: string): string {
    return getModelInfo(modelId)?.fullName || modelId || language.none
  }

  function providerName(role: ModelRole): string {
    const resolved = uiState.resolvedProfiles[role]
    if (resolved.status.providerId) return language.modelProfiles.providerNames[resolved.status.providerId]
    if (resolved.providerOptions.provider) return resolved.providerOptions.provider
    return ProviderNames.get(resolved.modelInfo.provider) ?? language.none
  }

  function providerModelSummary(role: ModelRole): string {
    const resolved = uiState.resolvedProfiles[role]
    const requestModel = resolved.requestModel.trim() || language.none
    return `${providerName(role)} / ${modelName(resolved.modelId)} / ${requestModel}`
  }

  function statusLabel(role: ModelRole): string {
    const status = uiState.roleStatuses[role]
    const bucket = language.modelProfiles.statusBuckets[status.bucket]
    if (status.reasons.length === 0) return bucket
    return `${bucket}: ${status.reasons.map((reason) => language.modelProfiles.statusReasons[reason] ?? reason).join(', ')}`
  }

  function fallbackCount(role: ModelRole): string {
    return language.modelRoles.fallbackCount(uiState.resolvedProfiles[role].fallbacks.length)
  }

  function profileOptionsForBinding(binding: ModelRoleProfileBinding): Array<{ id: string; name: string }> {
    const options = profiles.map((profile) => ({ id: profile.id, name: profile.name }))
    if (binding.mode === 'profile' && binding.profileId && !profileIdSet.has(binding.profileId)) {
      options.unshift({
        id: binding.profileId,
        name: language.modelProfiles.missingProfile(binding.profileId),
      })
    }
    return options
  }

  function firstProfileId(): string {
    return profiles[0]?.id ?? ''
  }

  function setBinding(role: ModelRole, binding: ModelRoleProfileBinding): void {
    if (applying || applyQueued) return
    draftBindings = {
      ...draftBindings,
      [role]: binding,
    }
    commandError = ''
  }

  function setBindingMode(role: ModelRole, mode: BindingMode): void {
    if (mode === 'inherit') {
      setBinding(role, { mode: 'inherit' })
      return
    }
    if (mode === 'profile') {
      const current = bindingFor(role)
      setBinding(role, {
        mode: 'profile',
        profileId: current.mode === 'profile' ? current.profileId : firstProfileId(),
      })
      return
    }
    setBinding(role, { mode: 'legacy' })
  }

  function setBindingProfile(role: ModelRole, profileId: string): void {
    setBinding(role, { mode: 'profile', profileId })
  }

  function resetDraft(): void {
    if (applying || applyQueued) return
    const normalized = normalizeModelRoleProfiles(getDatabase().modelRoleProfiles)
    draftBindings = cloneJsonValue(normalized)
    serverBaselineBindings = cloneJsonValue(normalized)
    lastServerSnapshot = snapshotBindings(normalized)
    commandError = ''
  }

  function selectedModelPresetId(): string | null {
    const database = getDatabase()
    const preset = database.modelPresets?.[database.modelPresetsId]
    return typeof preset?.id === 'string' && preset.id.trim() ? preset.id : null
  }

  function commandErrorMessage(result: Exclude<ServerCommandResult, { status: 'ok' }>): string {
    return result.status === 'conflict'
      ? language.modelProfiles.commandConflict
      : result.status === 'error'
        ? result.error
        : language.modelProfiles.commandUnavailable
  }

  async function applyDraft(): Promise<void> {
    if (!canApply) return
    applying = true
    commandError = ''
    const bindings = cloneJsonValue(changedBindings)
    const modelPresetId = selectedModelPresetId()
    const pendingToken = beginPendingModelMutation('model-profiles', {
      kind: 'role-bindings',
      bindings,
    })
    if (!pendingToken) {
      applying = false
      return
    }
    try {
      const outcome = await updateModelRoleProfilesDurably(bindings, modelPresetId)
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
      applying = false
    }
  }
</script>

<section class="flex flex-col gap-3">
  <div class="flex flex-col gap-1">
    <h3 class="text-lg font-semibold">{language.modelProfiles.rolesTabTitle}</h3>
    <span class="text-sm text-textcolor2">{language.modelProfiles.rolesTabDescription}</span>
  </div>

  {#if commandError}
    <div class="rounded-md border border-draculared p-3 text-sm text-draculared">{commandError}</div>
  {/if}
  <div class="flex flex-wrap items-center justify-between gap-2">
    <span class="text-sm text-textcolor2">
      {hasChanges ? language.modelProfiles.unsavedRoleChanges : language.modelProfiles.noUnsavedRoleChanges}
    </span>
    <div class="flex gap-2">
      <Button size="sm" styled="outlined" disabled={!hasChanges || applying || applyQueued} onclick={resetDraft}>
        {language.modelProfiles.cancel}
      </Button>
      <Button size="sm" disabled={!canApply} onclick={applyDraft}>
        {applying ? language.modelProfiles.applying : language.modelProfiles.apply}
      </Button>
    </div>
  </div>

  <div class="overflow-x-auto rounded-md border border-darkborderc">
    <table class="w-full min-w-[56rem] text-sm">
      <thead class="bg-darkbg text-left text-xs uppercase text-textcolor2">
        <tr>
          <th class="px-3 py-2 font-medium">{language.modelProfiles.roleColumn}</th>
          <th class="px-3 py-2 font-medium">{language.modelProfiles.bindingModeColumn}</th>
          <th class="px-3 py-2 font-medium">{language.modelProfiles.inheritedSourceColumn}</th>
          <th class="px-3 py-2 font-medium">{language.modelProfiles.effectiveProfileColumn}</th>
          <th class="px-3 py-2 font-medium">{language.modelProfiles.providerModelColumn}</th>
          <th class="px-3 py-2 font-medium">{language.modelProfiles.statusColumn}</th>
          <th class="px-3 py-2 font-medium">{language.modelProfiles.fallbackColumn}</th>
        </tr>
      </thead>
      <tbody>
        {#each MODEL_ROLES as role (role)}
          {@const binding = bindingFor(role)}
          {@const inheritedSource = modelRoleProfileInheritSource(role)}
          <tr class="border-t border-darkborderc align-top">
            <td class="px-3 py-3">
              <span class="block font-medium">{roleLabel(role)}</span>
              <span class="block text-xs text-textcolor2">{roleDescription(role)}</span>
            </td>
            <td class="px-3 py-3">
              <SelectInput
                size="sm"
                ariaLabel={`${roleLabel(role)}: ${language.modelProfiles.bindingModeColumn}`}
                disabled={applying || applyQueued}
                value={binding.mode}
                onchange={(event) => setBindingMode(role, event.currentTarget.value as BindingMode)}>
                <OptionInput value="profile">{language.modelProfiles.bindingModes.profile}</OptionInput>
                {#if inheritedSource}
                  <OptionInput value="inherit">{language.modelProfiles.bindingModes.inherit}</OptionInput>
                {/if}
                <OptionInput value="legacy">{language.modelProfiles.bindingModes.legacy}</OptionInput>
              </SelectInput>
              {#if binding.mode === 'profile'}
                <SelectInput
                  size="sm"
                  className="mt-2 w-full"
                  ariaLabel={`${roleLabel(role)}: ${language.modelProfiles.effectiveProfileColumn}`}
                  disabled={applying || applyQueued}
                  value={binding.profileId}
                  onchange={(event) => setBindingProfile(role, event.currentTarget.value)}>
                  {#if profiles.length === 0}
                    <OptionInput value="">{language.modelProfiles.noProfiles}</OptionInput>
                  {/if}
                  {#each profileOptionsForBinding(binding) as profile (profile.id)}
                    <OptionInput value={profile.id}>{profile.name}</OptionInput>
                  {/each}
                </SelectInput>
              {/if}
            </td>
            <td class="px-3 py-3 text-textcolor2">{inheritedSourceLabel(role)}</td>
            <td class="px-3 py-3">
              <span class="block">{effectiveProfileName(role)}</span>
              <span class="block text-xs text-textcolor2">{uiState.resolvedProfiles[role].profileId}</span>
            </td>
            <td class="px-3 py-3">{providerModelSummary(role)}</td>
            <td class="px-3 py-3">
              <span class="rounded-sm border border-darkborderc px-2 py-1 text-xs">
                {statusLabel(role)}
              </span>
            </td>
            <td class="px-3 py-3 text-textcolor2">{fallbackCount(role)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</section>
