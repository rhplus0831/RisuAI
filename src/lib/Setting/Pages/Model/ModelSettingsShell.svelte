<script lang="ts">
  import { language } from 'src/lang'
  import Accordion from 'src/lib/UI/Accordion.svelte'
  import Button from 'src/lib/UI/GUI/Button.svelte'
  import SegmentedControl from 'src/lib/UI/GUI/SegmentedControl.svelte'
  import { normalizeLegacySeperateModels, normalizeModelRoleOverrides, MODEL_ROLES } from 'src/ts/model/modelRoles'
  import { normalizeModelRoleProfiles } from 'src/ts/model/modelProfileRecords'
  import { convertLegacyModelProfilesCommand, runServerCommand } from 'src/ts/server/commands'
  import { DBState } from 'src/ts/stores.svelte'
  import LegacyModelRoleList from './ModelRoleList.svelte'
  import ModelPresetList from './ModelPresetList.svelte'
  import ModelProfileList from './ModelProfileList.svelte'
  import ModelProfileRoleList from './ModelProfileRoleList.svelte'

  type ModelSettingsTab = 'roles' | 'profiles' | 'presets'

  let activeTab = $state<ModelSettingsTab>('roles')
  let conversionPromptDeclined = $state(false)
  let converting = $state(false)
  let commandError = $state('')

  let legacyOnly = $derived(isClearlyLegacyOnly())
  let showConversionPrompt = $derived(legacyOnly && !conversionPromptDeclined)

  function nonBlank(value: unknown): boolean {
    return typeof value === 'string' && value.trim() !== ''
  }

  function hasLegacyModelFields(): boolean {
    if (nonBlank(DBState.db.aiModel) || nonBlank(DBState.db.subModel)) return true

    const roleOverrides = normalizeModelRoleOverrides(DBState.db.modelRoles)
    if (Object.values(roleOverrides).some(nonBlank)) return true

    if (DBState.db.seperateModelsForAxModels) {
      const separateModels = normalizeLegacySeperateModels(DBState.db.seperateModels)
      if (Object.values(separateModels).some(nonBlank)) return true
    }

    return false
  }

  function isClearlyLegacyOnly(): boolean {
    if ((DBState.db.modelProfiles ?? []).length > 0) return false

    const roleProfiles = normalizeModelRoleProfiles(DBState.db.modelRoleProfiles)
    if (!MODEL_ROLES.every((role) => roleProfiles[role].mode === 'legacy')) return false

    return hasLegacyModelFields()
  }

  async function convertLegacyProfiles(): Promise<void> {
    if (converting) return
    converting = true
    commandError = ''
    const result = await runServerCommand({
      command: (baseRevision) =>
        convertLegacyModelProfilesCommand({
          baseRevision,
        }),
    })
    converting = false

    if (result.status === 'ok') {
      conversionPromptDeclined = false
      return
    }
    commandError =
      result.status === 'conflict'
        ? language.modelProfiles.commandConflict
        : result.status === 'error'
          ? result.error
          : language.modelProfiles.commandUnavailable
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
        <Button size="sm" disabled={converting} onclick={convertLegacyProfiles}>
          {converting ? language.modelProfiles.converting : language.modelProfiles.convertToProfiles}
        </Button>
        <Button
          size="sm"
          styled="outlined"
          disabled={converting}
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
      <Button size="sm" disabled={converting} onclick={convertLegacyProfiles}>
        {converting ? language.modelProfiles.converting : language.modelProfiles.convertToProfiles}
      </Button>
    </div>
  {/if}

  <SegmentedControl
    bind:value={activeTab}
    options={[
      { value: 'roles', label: language.modelProfiles.rolesTab },
      { value: 'profiles', label: language.modelProfiles.profilesTab },
      { value: 'presets', label: language.modelProfiles.presetsTab },
    ]} />

  {#if activeTab === 'roles'}
    <ModelProfileRoleList />
  {:else if activeTab === 'profiles'}
    <ModelProfileList />
  {:else}
    <ModelPresetList />
  {/if}

  <Accordion styled name={language.modelProfiles.advancedLegacySettings} className="gap-3">
    <p class="text-sm text-textcolor2">{language.modelProfiles.advancedLegacyDescription}</p>
    <div class="grid gap-2 text-sm md:grid-cols-2">
      <div class="rounded-md border border-darkborderc p-3">
        <span class="block text-xs uppercase text-textcolor2">{language.modelProfiles.legacyMainModel}</span>
        <span>{DBState.db.aiModel || language.none}</span>
      </div>
      <div class="rounded-md border border-darkborderc p-3">
        <span class="block text-xs uppercase text-textcolor2">{language.modelProfiles.legacyAuxModel}</span>
        <span>{DBState.db.subModel || language.none}</span>
      </div>
    </div>
    {#if legacyOnly}
      <div class="flex justify-end">
        <Button size="sm" disabled={converting} onclick={convertLegacyProfiles}>
          {converting ? language.modelProfiles.converting : language.modelProfiles.convertToProfiles}
        </Button>
      </div>
    {/if}
    <LegacyModelRoleList />
  </Accordion>
</section>
