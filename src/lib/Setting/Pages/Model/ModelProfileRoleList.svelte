<script lang="ts">
  import { language } from 'src/lang'
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
  let applyQueued = $derived(pendingMutations.length > 0)

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
        if (pending.projection.kind === 'role-bindings') {
          restoreBindingsIfCurrent(pending.projection.bindings)
        }
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

  function bindingCanBeSaved(role: ModelRole, binding: ModelRoleProfileBinding): boolean {
    if (binding.mode === 'profile' && !profileIdSet.has(binding.profileId)) return false
    return role !== 'memory' || uiState.roleStatuses.memory.bucket !== 'unsupported'
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
    if (snapshotBinding(bindingFor(role)) === snapshotBinding(binding)) return
    draftBindings = {
      ...draftBindings,
      [role]: binding,
    }
    commandError = ''
    if (bindingCanBeSaved(role, binding)) void applyBinding(role, binding)
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

  function restoreBindingsIfCurrent(bindings: Partial<Record<ModelRole, ModelRoleProfileBinding>>): void {
    const restored = cloneJsonValue(draftBindings)
    let changed = false
    for (const [rawRole, attemptedBinding] of Object.entries(bindings)) {
      if (!attemptedBinding) continue
      const role = rawRole as ModelRole
      if (snapshotBinding(restored[role]) !== snapshotBinding(attemptedBinding)) continue
      restored[role] = cloneJsonValue(serverBaselineBindings[role])
      changed = true
    }
    if (changed) draftBindings = restored
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

  async function applyBinding(role: ModelRole, binding: ModelRoleProfileBinding): Promise<void> {
    applying = true
    commandError = ''
    const bindings: Partial<Record<ModelRole, ModelRoleProfileBinding>> = {
      [role]: cloneJsonValue(binding),
    }
    const modelPresetId = selectedModelPresetId()
    const pendingToken = beginPendingModelMutation('model-profiles', {
      kind: 'role-bindings',
      bindings,
    })
    if (!pendingToken) {
      restoreBindingsIfCurrent(bindings)
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
      restoreBindingsIfCurrent(bindings)
    } catch {
      finishPendingModelMutation(pendingToken)
      commandError = commandErrorMessage({ status: 'unavailable' })
      restoreBindingsIfCurrent(bindings)
    } finally {
      applying = false
    }
  }
</script>

<section class="flex flex-col gap-3">
  <div class="mt-2 flex flex-col gap-1">
    <h3 class="text-lg font-semibold">{language.modelProfiles.rolesTabTitle}</h3>
    <span class="text-sm text-textcolor2">{language.modelProfiles.rolesTabDescription}</span>
  </div>

  {#if commandError}
    <div class="rounded-md border border-draculared p-3 text-sm text-draculared">{commandError}</div>
  {/if}
  <div class="flex flex-col gap-2">
    {#each MODEL_ROLES as role (role)}
      {@const binding = bindingFor(role)}
      {@const inheritedSource = modelRoleProfileInheritSource(role)}
      <article class="risu-card flex flex-col gap-2 text-sm">
        <div class="flex flex-wrap items-center gap-2">
          <span class="font-medium">{roleLabel(role)}</span>
          <span class="rounded-sm bg-white/10 px-2 py-1 text-xs">
            {statusLabel(role)}
          </span>
          <span class="ml-auto text-xs text-textcolor2">{fallbackCount(role)}</span>
        </div>
        <span class="text-xs text-textcolor2">{roleDescription(role)}</span>
        <div class="flex flex-wrap gap-2">
          <div class="flex flex-1 basis-full sm:basis-0">
            <SelectInput
              size="sm"
              className="w-full"
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
          </div>
          {#if binding.mode === 'profile'}
            <div class="flex flex-1 basis-full sm:basis-0">
              <SelectInput
                size="sm"
                className="w-full"
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
            </div>
          {/if}
        </div>
        <span class="break-all text-xs text-textcolor2">
          {effectiveProfileName(role)} ({uiState.resolvedProfiles[role].profileId}) · {providerModelSummary(role)}
          {#if binding.mode === 'inherit'}
            · {inheritedSourceLabel(role)}{/if}
        </span>
      </article>
    {/each}
  </div>
</section>
