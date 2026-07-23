<script lang="ts">
  import { ListIcon } from '@lucide/svelte'
  import { language } from 'src/lang'
  import Accordion from 'src/lib/UI/Accordion.svelte'
  import Button from 'src/lib/UI/GUI/Button.svelte'
  import SegmentedControl from 'src/lib/UI/GUI/SegmentedControl.svelte'
  import { getModelInfo } from 'src/ts/model/modellist'
  import { normalizeLegacySeperateModels, normalizeModelRoleOverrides, MODEL_ROLES } from 'src/ts/model/modelRoles'
  import { normalizeModelRoleProfiles } from 'src/ts/model/modelProfileRecords'
  import type { ProviderCredentialType } from 'src/ts/model/providerCredentialRecords'
  import { resolveModelProfileUiState } from 'src/ts/model/modelProfileUiState'
  import {
    beginPendingModelMutation,
    convertLegacyModelProfilesDurably,
    finishPendingModelMutation,
    getPendingModelMutations,
    isPendingModelMutationProjectionApplied,
    retainPendingModelMutation,
    subscribePendingModelMutations,
  } from 'src/ts/model/modelProfileMutations'
  import type { ServerCommandResult } from 'src/ts/server/commands'
  import { getDatabase } from 'src/ts/storage/database.svelte'
  import { openPresetListModal } from 'src/ts/stores.svelte'
  import LegacyModelRoleList from './ModelRoleList.svelte'
  import ModelProfileList from './ModelProfileList.svelte'
  import ModelProfileRoleList from './ModelProfileRoleList.svelte'
  import ProviderCredentialList from './ProviderCredentialList.svelte'

  type ModelSettingsTab = 'roles' | 'profiles' | 'credentials'

  let activeTab = $state<ModelSettingsTab>('roles')
  let conversionPromptDeclined = $state(false)
  let converting = $state(false)
  let pendingMutations = $state(getPendingModelMutations('model-profiles'))
  let pendingRuntimeMutations = $state(getPendingModelMutations('model-runtime-defaults'))
  let commandError = $state('')
  let initialCredentialType = $state<ProviderCredentialType | null>(null)
  let credentialTabKey = $state(0)

  let modelProfileUiState = $derived.by(() =>
    resolveModelProfileUiState({
      database: getDatabase(),
      lookupModelInfo: (_database, id) => getModelInfo(id),
    }),
  )
  let modelMutationPending = $derived(pendingMutations.length > 0)
  let conversionQueued = $derived(pendingMutations.some((pending) => pending.projection.kind === 'legacy-conversion'))
  let legacyOnly = $derived(isClearlyLegacyOnly())
  let showConversionPrompt = $derived((legacyOnly || conversionQueued) && !conversionPromptDeclined)
  let showAdvancedLegacySettings = $derived(!modelProfileUiState.allRolesUseDurableProfiles)
  let selectedModelPresetButtonLabel = $derived.by(() => {
    const database = getDatabase()
    const index = database.modelPresetsId ?? -1
    const preset = database.modelPresets?.[index]
    if (!preset) return language.modelPresets

    const name = typeof preset.name === 'string' ? preset.name.trim() : ''
    return name || language.modelProfiles.defaultPresetName(index + 1)
  })
  let legacyMainModel = $derived(getDatabase().aiModel || language.none)
  let legacyAuxModel = $derived(getDatabase().subModel || language.none)

  $effect(() => {
    return subscribePendingModelMutations('model-profiles', (pending) => {
      pendingMutations = pending
    })
  })

  $effect(() => {
    return subscribePendingModelMutations('model-runtime-defaults', (pending) => {
      pendingRuntimeMutations = pending
    })
  })

  $effect(() => {
    if (activeTab !== 'credentials') initialCredentialType = null
  })

  $effect(() => {
    const database = getDatabase()
    for (const pending of [...pendingMutations, ...pendingRuntimeMutations]) {
      if (pending.phase === 'discarded') {
        commandError = language.modelProfiles.commandReplayDiscarded
        finishPendingModelMutation(pending.token)
        continue
      }
      if (pending.phase === 'dispatching') continue
      if (isPendingModelMutationProjectionApplied(pending.projection, database)) {
        finishPendingModelMutation(pending.token)
      }
    }
  })

  function nonBlank(value: unknown): boolean {
    return typeof value === 'string' && value.trim() !== ''
  }

  function hasLegacyModelFields(): boolean {
    const database = getDatabase()
    if (nonBlank(database.aiModel) || nonBlank(database.subModel)) return true

    const roleOverrides = normalizeModelRoleOverrides(database.modelRoles)
    if (Object.values(roleOverrides).some(nonBlank)) return true

    if (database.seperateModelsForAxModels) {
      const separateModels = normalizeLegacySeperateModels(database.seperateModels)
      if (Object.values(separateModels).some(nonBlank)) return true
    }

    return false
  }

  function isClearlyLegacyOnly(): boolean {
    const database = getDatabase()
    if ((database.modelProfiles ?? []).length > 0) return false

    const roleProfiles = normalizeModelRoleProfiles(database.modelRoleProfiles)
    if (!MODEL_ROLES.every((role) => roleProfiles[role].mode === 'legacy')) return false

    return hasLegacyModelFields()
  }

  function commandErrorMessage(result: Exclude<ServerCommandResult, { status: 'ok' }>): string {
    return result.status === 'conflict'
      ? language.modelProfiles.commandConflict
      : result.status === 'error'
        ? result.error
        : language.modelProfiles.commandUnavailable
  }

  async function convertLegacyProfiles(): Promise<void> {
    if (converting || modelMutationPending) return
    converting = true
    commandError = ''
    const baselineIds = (getDatabase().modelProfiles ?? []).map((profile) => profile.id)
    const pendingToken = beginPendingModelMutation('model-profiles', {
      kind: 'legacy-conversion',
      baselineIds,
    })
    if (!pendingToken) {
      converting = false
      return
    }
    try {
      const outcome = await convertLegacyModelProfilesDurably()
      if (outcome.status === 'accepted') {
        finishPendingModelMutation(pendingToken)
        conversionPromptDeclined = false
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
      converting = false
    }
  }

  function manageCredentials(type: ProviderCredentialType): void {
    initialCredentialType = type
    credentialTabKey += 1
    activeTab = 'credentials'
  }
</script>

<h2 class="mb-2 mt-2 text-2xl font-bold">{language.modelProfiles.settingsTitle}</h2>

<section class="flex flex-col gap-4">
  {#if showConversionPrompt}
    <div class="rounded-md border border-selected bg-darkbg p-4">
      <h3 class="text-lg font-semibold">{language.modelProfiles.convertPromptTitle}</h3>
      <p class="mt-1 text-sm text-textcolor2">{language.modelProfiles.convertPromptDescription}</p>
      {#if commandError}
        <div class="mt-3 rounded-md border border-draculared p-2 text-sm text-draculared">{commandError}</div>
      {/if}
      <div class="mt-3 flex flex-wrap gap-2">
        <Button size="sm" disabled={converting || modelMutationPending} onclick={convertLegacyProfiles}>
          {converting ? language.modelProfiles.converting : language.modelProfiles.convertToProfiles}
        </Button>
        <Button
          size="sm"
          styled="outlined"
          disabled={converting || modelMutationPending}
          onclick={() => {
            conversionPromptDeclined = true
          }}>
          {language.modelProfiles.notNow}
        </Button>
      </div>
    </div>
  {:else if legacyOnly}
    <div class="flex flex-wrap items-center justify-between gap-3 rounded-md border border-darkborderc p-3">
      <span class="text-sm text-textcolor2">{language.modelProfiles.convertDeclinedNotice}</span>
      <Button size="sm" disabled={converting || modelMutationPending} onclick={convertLegacyProfiles}>
        {converting ? language.modelProfiles.converting : language.modelProfiles.convertToProfiles}
      </Button>
    </div>
  {/if}

  <SegmentedControl
    bind:value={activeTab}
    options={[
      { value: 'roles', label: language.modelProfiles.rolesTab },
      { value: 'profiles', label: language.modelProfiles.profilesTab },
      { value: 'credentials', label: language.modelProfiles.credentialsTab },
    ]} />

  {#if activeTab === 'roles'}
    <div class="w-full">
      <Button
        size="sm"
        styled="outlined"
        onclick={() => {
          openPresetListModal('global', 'model')
        }}
        className="flex w-full min-w-0 items-center justify-start gap-2 text-left">
        <ListIcon size={16} class="shrink-0" />
        <span class="truncate">{selectedModelPresetButtonLabel}</span>
      </Button>
    </div>
    <ModelProfileRoleList />
  {:else if activeTab === 'profiles'}
    <ModelProfileList onManageCredentials={manageCredentials} />
  {:else}
    {#key credentialTabKey}
      <ProviderCredentialList initialCreateType={initialCredentialType} />
    {/key}
  {/if}

  {#if showAdvancedLegacySettings}
    <Accordion styled name={language.modelProfiles.advancedLegacySettings} className="gap-3">
      <p class="text-sm text-textcolor2">{language.modelProfiles.advancedLegacyDescription}</p>
      <div class="grid gap-2 text-sm md:grid-cols-2">
        <div class="rounded-md border border-darkborderc p-3">
          <span class="block text-xs uppercase text-textcolor2">{language.modelProfiles.legacyMainModel}</span>
          <span>{legacyMainModel}</span>
        </div>
        <div class="rounded-md border border-darkborderc p-3">
          <span class="block text-xs uppercase text-textcolor2">{language.modelProfiles.legacyAuxModel}</span>
          <span>{legacyAuxModel}</span>
        </div>
      </div>
      {#if legacyOnly}
        <div class="flex justify-end">
          <Button size="sm" disabled={converting || modelMutationPending} onclick={convertLegacyProfiles}>
            {converting ? language.modelProfiles.converting : language.modelProfiles.convertToProfiles}
          </Button>
        </div>
      {/if}
      <LegacyModelRoleList />
    </Accordion>
  {/if}
</section>
