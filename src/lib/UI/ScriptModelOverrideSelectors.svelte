<script lang="ts">
  import { language } from 'src/lang'
  import {
    isModelProfileDividerSelectValue,
    modelProfileDividerSelectValue,
    modelProfileListItems,
  } from 'src/ts/model/modelProfileRecords'
  import {
    scriptModelOverrideProfileId,
    updateScriptModelOverrideProfileId,
    type ScriptModelOverrides,
    type ScriptModelRole,
  } from '@risuai/shared-core/script-model-overrides'
  import { settingsResourceState } from 'src/ts/server/resourceState.svelte'
  import type { ModelProfileRecord } from '@risuai/shared-core/model-profile-records'

  interface Props {
    value?: ScriptModelOverrides
  }

  let { value = $bindable() }: Props = $props()
  let profiles = $derived.by(() => {
    if (settingsResourceState.status !== 'ready') return []
    const rows = (settingsResourceState.value.modelProfiles ?? []) as ModelProfileRecord[]
    const ids = rows.map((profile) => profile.id)
    if (ids.some((id) => typeof id !== 'string' || id.trim() === '') || new Set(ids).size !== ids.length) return []
    return rows
  })
  let profileItems = $derived(modelProfileListItems(profiles, settingsResourceState.value.modelProfileOrder))
  let profileIds = $derived(new Set(profiles.map((profile) => profile.id)))

  function selectedProfileId(role: ScriptModelRole): string {
    return scriptModelOverrideProfileId(value, role) ?? ''
  }

  function handleSelection(role: ScriptModelRole, previousProfileId: string, event: Event): void {
    const select = event.currentTarget
    if (!(select instanceof HTMLSelectElement)) return
    if (isModelProfileDividerSelectValue(select.value)) {
      select.value = previousProfileId
      return
    }
    value = updateScriptModelOverrideProfileId(value, role, select.value)
  }
</script>

<section class="flex flex-col gap-2 rounded-md border border-darkborderc p-3" data-script-model-overrides>
  <div>
    <h3 class="font-medium text-textcolor">{language.scriptModelOverrides.title}</h3>
    <p class="text-sm text-textcolor2">{language.scriptModelOverrides.description}</p>
  </div>

  {#each [{ role: 'scriptMain' as const, label: language.scriptModelOverrides.llm }, { role: 'scriptAux' as const, label: language.scriptModelOverrides.axLlm }] as row (row.role)}
    {@const selected = selectedProfileId(row.role)}
    <label class="grid gap-1 sm:grid-cols-[minmax(7rem,auto)_minmax(0,1fr)] sm:items-center">
      <span class="text-sm text-textcolor2">{row.label}</span>
      <select
        class="rounded-md border border-darkborderc bg-transparent px-2 py-1 text-sm text-textcolor focus:border-borderc focus:outline-hidden focus:ring-2 focus:ring-borderc"
        value={selected}
        aria-label={row.label}
        onchange={(event) => handleSelection(row.role, selected, event)}>
        <option value="">{language.scriptModelOverrides.inheritRole}</option>
        {#if selected && !profileIds.has(selected)}
          <option value={selected}>{language.modelProfiles.missingProfile(selected)}</option>
        {/if}
        {#each profileItems as item (`${item.kind}:${item.kind === 'profile' ? item.profile.id : item.id}`)}
          {#if item.kind === 'divider'}
            <option value={modelProfileDividerSelectValue(item.id)} data-model-profile-divider="true">---</option>
          {:else}
            <option value={item.profile.id}>{item.profile.name || item.profile.id}</option>
          {/if}
        {/each}
      </select>
    </label>
  {/each}
</section>
