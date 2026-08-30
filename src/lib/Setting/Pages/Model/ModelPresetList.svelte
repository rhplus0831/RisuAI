<script lang="ts">
  import { ArrowDownIcon, ArrowUpIcon, CopyIcon, FilePlusIcon, PlusIcon, TrashIcon } from '@lucide/svelte'
  import { language } from 'src/lang'
  import { alertError, alertNormal } from 'src/ts/alert'
  import Button from 'src/lib/UI/GUI/Button.svelte'
  import TextInput from 'src/lib/UI/GUI/TextInput.svelte'
  import { createModelRoleBindingPresetSnapshot } from 'src/ts/model/modelPresetSnapshots'
  import { normalizeModelRoleProfiles, type ModelRoleProfileBinding } from 'src/ts/model/modelProfileRecords'
  import { MODEL_ROLES, modelRoleProfileInheritSource, type ModelRole } from '@risuai/shared-core/model-roles'
  import {
    createModelPreset,
    deleteModelPreset,
    getDatabase,
    reorderModelPresets,
    selectModelPreset,
    updateModelPreset,
    type ModelPreset,
    type PresetMutationOutcome,
    type PromptPreset,
  } from 'src/ts/storage/database.svelte'

  interface Props {
    embedded?: boolean
    afterApply?: () => void
  }

  let { embedded = false, afterApply = () => {} }: Props = $props()

  let newPresetName = $state('')
  let selectionOperation = 0
  let selectionPendingIndex = $state<number | null>(null)
  let selectionError = $state('')
  let rowMutationOperation = 0
  let rowMutationStates = $state<Record<string, { operation: number; status: 'saving' | 'queued' }>>({})
  let rowMutationErrors = $state<Record<string, string>>({})
  let latestRowMutationError = $derived(Object.values(rowMutationErrors).at(-1) ?? '')

  let presets = $derived(getDatabase().modelPresets ?? [])
  let selectedIndex = $derived(getDatabase().modelPresetsId ?? -1)
  let selectedPromptPreset = $derived.by(() => {
    const database = getDatabase()
    return database.promptPresets?.[database.promptPresetsId]
  })
  let selectedPromptPresetOverridesRoles = $derived(hasPresetField(selectedPromptPreset, 'modelRoleProfiles'))

  function cloneJsonValue<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T
  }

  function presetName(preset: ModelPreset | undefined, index: number): string {
    return preset?.name?.trim() || language.modelProfiles.defaultPresetName(index + 1)
  }

  function newPresetFallbackName(): string {
    return language.modelProfiles.defaultPresetName(presets.length + 1)
  }

  function consumeNewPresetName(): string {
    const name = newPresetName.trim() || newPresetFallbackName()
    newPresetName = ''
    return name
  }

  function presetMutationKey(preset: ModelPreset | undefined, index: number): string {
    return `model:${preset?.id ?? `index:${index}`}`
  }

  function observePresetRowMutation(key: string, outcome: Promise<PresetMutationOutcome> | undefined): void {
    if (!outcome) return
    const operation = ++rowMutationOperation
    rowMutationStates[key] = { operation, status: 'saving' }
    delete rowMutationErrors[key]
    void outcome.then(
      (result) => settlePresetRowMutation(key, operation, result),
      () => showPresetRowMutationFailure(key, operation),
    )
  }

  function settlePresetRowMutation(key: string, operation: number, outcome: PresetMutationOutcome): void {
    if (rowMutationStates[key]?.operation !== operation) return
    if (outcome.status === 'accepted') {
      delete rowMutationStates[key]
      return
    }
    if (outcome.status === 'failed') {
      showPresetRowMutationFailure(key, operation)
      return
    }

    rowMutationStates[key] = { operation, status: 'queued' }
    alertNormal(language.presetMutationQueued)
    void outcome.settlement.then(
      (status) => {
        if (rowMutationStates[key]?.operation !== operation) return
        if (status === 'accepted') delete rowMutationStates[key]
        else showPresetRowMutationFailure(key, operation)
      },
      () => showPresetRowMutationFailure(key, operation),
    )
  }

  function showPresetRowMutationFailure(key: string, operation: number): void {
    if (rowMutationStates[key]?.operation !== operation) return
    delete rowMutationStates[key]
    rowMutationErrors[key] = language.presetMutationFailed
    alertError(language.presetMutationFailed)
  }

  function createPresetFromCurrent(): void {
    const name = consumeNewPresetName()
    observePresetRowMutation(
      'model:create-current',
      createModelPreset(createModelRoleBindingPresetSnapshot(getDatabase(), name)),
    )
  }

  function createEmptyPreset(): void {
    const name = consumeNewPresetName()
    observePresetRowMutation(
      'model:create-empty',
      createModelPreset({
        name,
        modelRoleProfiles: cloneJsonValue(createEmptyPresetRoleProfiles()),
      }),
    )
  }

  function createEmptyPresetRoleProfiles() {
    const bindings = normalizeModelRoleProfiles(undefined)
    for (const role of MODEL_ROLES) {
      if (modelRoleProfileInheritSource(role)) {
        bindings[role] = { mode: 'inherit' }
      }
    }
    return bindings
  }

  function renamePreset(index: number, name: string): void {
    const preset = presets[index]
    if (!preset) return
    const nextName = name.trim() || presetName(preset, index)
    if ((preset.name ?? '') === nextName) return
    observePresetRowMutation(presetMutationKey(preset, index), updateModelPreset(index, { name: nextName }))
  }

  function duplicatePreset(index: number): void {
    const preset = presets[index]
    if (!preset) return
    const copy = cloneJsonValue(preset)
    delete copy.id
    copy.name = language.modelProfiles.copyName(presetName(preset, index))
    observePresetRowMutation(presetMutationKey(preset, index), createModelPreset(copy))
  }

  function removePreset(index: number): void {
    const preset = presets[index]
    if (!preset || presets.length <= 1) return
    if (!window.confirm(language.modelProfiles.deleteModelPresetConfirm(presetName(preset, index)))) return
    observePresetRowMutation(presetMutationKey(preset, index), deleteModelPreset(index, 0))
  }

  async function applyPreset(index: number): Promise<void> {
    if (index === selectedIndex) {
      afterApply()
      return
    }
    if (selectionPendingIndex !== null) return

    const operation = ++selectionOperation
    selectionPendingIndex = index
    selectionError = ''
    let outcome: PresetMutationOutcome
    try {
      outcome = await selectModelPreset(index)
    } catch {
      if (operation !== selectionOperation) return
      selectionPendingIndex = null
      selectionError = language.presetSelectionFailed
      alertError(selectionError)
      return
    }
    if (operation !== selectionOperation) return
    selectionPendingIndex = null

    if (outcome.status === 'failed') {
      selectionError = language.presetSelectionFailed
      alertError(selectionError)
      return
    }
    if (outcome.status === 'queued') alertNormal(language.presetSelectionQueued)
    afterApply()
  }

  function isInteractiveKeyboardTarget(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) return false
    const interactive = target.closest('input, textarea, select, button, [contenteditable]')
    if (!interactive) return false
    if (interactive.matches('input, textarea, select, button')) return true
    return interactive.getAttribute('contenteditable')?.toLowerCase() !== 'false'
  }

  function applyPresetFromKeyboard(event: KeyboardEvent, index: number): void {
    if (event.key !== 'Enter' && event.key !== ' ') return
    if (isInteractiveKeyboardTarget(event.target)) return
    event.preventDefault()
    applyPreset(index)
  }

  function movePresetUp(index: number): void {
    if (index <= 0) return
    observePresetRowMutation(presetMutationKey(presets[index], index), reorderModelPresets(index, index - 1))
  }

  function movePresetDown(index: number): void {
    if (index >= presets.length - 1) return
    observePresetRowMutation(presetMutationKey(presets[index], index), reorderModelPresets(index, index + 2))
  }

  function hasPresetField(preset: ModelPreset | PromptPreset | undefined, field: string): boolean {
    return !!preset && Object.prototype.hasOwnProperty.call(preset, field)
  }

  function selectedPromptPresetName(): string {
    return selectedPromptPreset?.name?.trim() || language.promptPresets
  }

  function profileName(profileId: string): string {
    return getDatabase().modelProfiles.find((profile) => profile.id === profileId)?.name ?? profileId
  }

  function bindingLabel(binding: ModelRoleProfileBinding): string {
    if (binding.mode === 'profile') return profileName(binding.profileId)
    if (binding.mode === 'inherit') return language.modelProfiles.bindingModes.inherit
    return language.modelProfiles.bindingModes.legacy
  }

  function chatRoleSummary(preset: ModelPreset): string {
    if (!hasPresetField(preset, 'modelRoleProfiles')) return language.modelProfiles.modelPresetLegacySummary
    const bindings = normalizeModelRoleProfiles(preset.modelRoleProfiles)
    const roles: ModelRole[] = ['chatMain', 'chatAux']
    return roles.map((role) => `${language.modelRoles.roles[role]}: ${bindingLabel(bindings[role])}`).join(' / ')
  }

  function roleBindingSummary(preset: ModelPreset): string {
    if (!hasPresetField(preset, 'modelRoleProfiles')) {
      return legacyModelFieldCount(preset) > 0
        ? language.modelProfiles.modelPresetLegacyFieldSummary(legacyModelFieldCount(preset))
        : language.modelProfiles.modelPresetNoRoleBindings
    }

    const bindings = normalizeModelRoleProfiles(preset.modelRoleProfiles)
    let profileCount = 0
    let inheritCount = 0
    let legacyCount = 0
    let missingCount = 0
    const profileIds = new Set(getDatabase().modelProfiles.map((profile) => profile.id))

    for (const role of MODEL_ROLES) {
      const binding = bindings[role]
      if (binding.mode === 'profile') {
        profileCount += 1
        if (!profileIds.has(binding.profileId)) missingCount += 1
      } else if (binding.mode === 'inherit') {
        inheritCount += 1
      } else {
        legacyCount += 1
      }
    }

    return language.modelProfiles.modelPresetRoleBindingSummary(profileCount, inheritCount, legacyCount, missingCount)
  }

  function legacyModelFieldCount(preset: ModelPreset): number {
    return ['aiModel', 'subModel', 'modelRoles', 'seperateModels', 'fallbackModels'].filter((field) =>
      hasPresetField(preset, field),
    ).length
  }

  function presetBadges(preset: ModelPreset): string[] {
    const badges: string[] = []
    if (hasPresetField(preset, 'modelRoleProfiles')) badges.push(language.modelProfiles.modelPresetRoleBindingsBadge)
    if (hasPresetField(preset, 'modelProfiles')) badges.push(language.modelProfiles.modelPresetEmbeddedProfilesBadge)
    if (hasPresetField(preset, 'modelRuntimeDefaults')) badges.push(language.modelProfiles.modelPresetRuntimeBadge)
    if (legacyModelFieldCount(preset) > 0) badges.push(language.modelProfiles.modelPresetLegacyBadge)
    if (badges.length === 0) badges.push(language.modelProfiles.modelPresetEmptyBadge)
    return badges
  }
</script>

<section class="flex flex-col gap-4">
  {#if !embedded}
    <div class="flex flex-col gap-1">
      <h3 class="text-lg font-semibold">{language.modelProfiles.presetsTabTitle}</h3>
      <span class="text-sm text-textcolor2">{language.modelProfiles.presetsTabDescription}</span>
    </div>
  {/if}

  <div class="flex flex-col gap-2 rounded-md border border-darkborderc p-3 md:flex-row md:items-center">
    <TextInput
      size="sm"
      fullwidth
      bind:value={newPresetName}
      placeholder={newPresetFallbackName()}
      className="md:max-w-72" />
    <Button size="sm" onclick={createPresetFromCurrent}>
      <span class="inline-flex items-center gap-2">
        <PlusIcon size={16} />{language.modelProfiles.saveCurrentRolesAsPreset}
      </span>
    </Button>
    <Button size="sm" styled="outlined" onclick={createEmptyPreset}>
      <span class="inline-flex items-center gap-2">
        <FilePlusIcon size={16} />{language.modelProfiles.createEmptyModelPreset}
      </span>
    </Button>
  </div>

  {#if selectedPromptPresetOverridesRoles}
    <div class="rounded-md border border-darkborderc p-3 text-sm text-textcolor2">
      {language.modelProfiles.promptPresetRoleOverrideNotice(selectedPromptPresetName())}
    </div>
  {/if}

  {#if presets.length === 0}
    <div class="rounded-md border border-darkborderc p-4 text-sm text-textcolor2">
      {language.modelProfiles.noModelPresets}
    </div>
  {:else}
    <div class="flex flex-col gap-2">
      {#each presets as preset, index (preset.id ?? index)}
        <div
          class="risu-card flex cursor-pointer flex-col gap-3 text-sm hover:bg-darkbg"
          class:bg-selected={index === selectedIndex}
          role="button"
          tabindex="0"
          aria-busy={selectionPendingIndex === index ? 'true' : 'false'}
          aria-disabled={selectionPendingIndex !== null ? 'true' : undefined}
          onclick={() => applyPreset(index)}
          onkeydown={(event) => applyPresetFromKeyboard(event, index)}>
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div onclick={(event) => event.stopPropagation()}>
            <TextInput
              size="sm"
              value={presetName(preset, index)}
              ariaLabel={`${language.modelProfiles.profileNameColumn}: ${presetName(preset, index)}`}
              onchange={(event) => renamePreset(index, event.currentTarget.value)}
              fullwidth />
            <span class="mt-1 block break-all text-xs text-textcolor2">{preset.id ?? language.none}</span>
            {#if rowMutationErrors[presetMutationKey(preset, index)]}
              <span data-risu-preset-row-mutation-status role="alert" class="mt-1 block text-xs text-draculared">
                {rowMutationErrors[presetMutationKey(preset, index)]}
              </span>
            {/if}
          </div>
          <div class="flex flex-col gap-1 break-all text-xs text-textcolor2">
            <span>
              <span class="font-medium">{language.modelProfiles.chatRolesColumn}:</span>
              {chatRoleSummary(preset)}
            </span>
            <span>
              <span class="font-medium">{language.modelProfiles.roleBindingsColumn}:</span>
              {roleBindingSummary(preset)}
            </span>
          </div>
          <div class="flex flex-wrap gap-1">
            {#each presetBadges(preset) as badge}
              <span class="rounded-sm bg-white/10 px-2 py-1 text-xs text-textcolor2">{badge}</span>
            {/each}
          </div>
          <div class="flex flex-wrap gap-2">
            <Button
              size="sm"
              styled="outlined"
              onclick={(event) => {
                event.stopPropagation()
                duplicatePreset(index)
              }}>
              <span class="inline-flex items-center gap-1">
                <CopyIcon size={14} />{language.modelProfiles.duplicate}
              </span>
            </Button>
            <Button
              size="sm"
              styled="outlined"
              disabled={index === 0}
              onclick={(event) => {
                event.stopPropagation()
                movePresetUp(index)
              }}>
              <span class="inline-flex items-center gap-1">
                <ArrowUpIcon size={14} />{language.modelProfiles.moveUp}
              </span>
            </Button>
            <Button
              size="sm"
              styled="outlined"
              disabled={index >= presets.length - 1}
              onclick={(event) => {
                event.stopPropagation()
                movePresetDown(index)
              }}>
              <span class="inline-flex items-center gap-1">
                <ArrowDownIcon size={14} />{language.modelProfiles.moveDown}
              </span>
            </Button>
            <Button
              size="sm"
              styled="danger"
              disabled={presets.length <= 1}
              onclick={(event) => {
                event.stopPropagation()
                removePreset(index)
              }}>
              <span class="inline-flex items-center gap-1">
                <TrashIcon size={14} />{language.modelProfiles.delete}
              </span>
            </Button>
          </div>
        </div>
      {/each}
    </div>
  {/if}

  {#if selectionError}
    <span data-risu-preset-selection-status role="alert" class="text-sm text-draculared">{selectionError}</span>
  {/if}
  {#if latestRowMutationError}
    <span data-risu-preset-mutation-status role="alert" class="text-sm text-draculared">
      {latestRowMutationError}
    </span>
  {/if}
</section>
