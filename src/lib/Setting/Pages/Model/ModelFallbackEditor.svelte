<script lang="ts">
  import { PlusIcon, TrashIcon } from '@lucide/svelte'
  import { language } from 'src/lang'
  import Button from 'src/lib/UI/GUI/Button.svelte'
  import TextInput from 'src/lib/UI/GUI/TextInput.svelte'
  import {
    isModelProfileDividerSelectValue,
    modelProfileDividerSelectValue,
    modelProfileListItems,
    type ModelProfileOrderEntry,
    type ModelProfileRecord,
    type ModelProfileRecordFallbackRef,
  } from 'src/ts/model/modelProfileRecords'
  import { confirmSettingsItemRemoval } from 'src/ts/setting/confirmSettingsItemRemoval'

  interface Props {
    profileId?: string
    profiles: ModelProfileRecord[]
    profileOrder?: ModelProfileOrderEntry[]
    value: ModelProfileRecordFallbackRef[]
  }

  type ProfileOption = { kind: 'profile'; id: string; name: string } | { kind: 'divider'; id: string }

  let { profileId = '', profiles = [], profileOrder = [], value = $bindable([]) }: Props = $props()
  let profileItems = $derived(modelProfileListItems(profiles, profileOrder))

  function profileName(id: string): string {
    return profiles.find((profile) => profile.id === id)?.name ?? language.modelProfiles.missingProfile(id)
  }

  function usedProfileIds(exceptIndex = -1): Set<string> {
    return new Set(
      value.flatMap((fallback, index) =>
        index !== exceptIndex && fallback.mode === 'profile' ? [fallback.profileId] : [],
      ),
    )
  }

  function profileOptions(index: number): ProfileOption[] {
    const current = value[index]
    const currentProfileId = current?.mode === 'profile' ? current.profileId : ''
    const used = usedProfileIds(index)
    const options = profileItems.flatMap<ProfileOption>((item) => {
      if (item.kind === 'divider') return [{ kind: 'divider' as const, id: item.id }]
      const profile = item.profile
      if (profile.id === profileId || (profile.id !== currentProfileId && used.has(profile.id))) return []
      return [{ kind: 'profile' as const, id: profile.id, name: profile.name }]
    })
    if (currentProfileId && !options.some((option) => option.kind === 'profile' && option.id === currentProfileId)) {
      options.unshift({ kind: 'profile', id: currentProfileId, name: profileName(currentProfileId) })
    }
    return options
  }

  function firstAvailableProfileId(): string {
    const used = usedProfileIds()
    return (
      profileItems.flatMap((item) =>
        item.kind === 'profile' && item.profile.id !== profileId && !used.has(item.profile.id) ? [item.profile.id] : [],
      )[0] ?? ''
    )
  }

  function setFallback(index: number, fallback: ModelProfileRecordFallbackRef): void {
    value = value.map((item, itemIndex) => (itemIndex === index ? fallback : item))
  }

  function setFallbackMode(index: number, mode: ModelProfileRecordFallbackRef['mode']): void {
    if (mode === 'profile') {
      const profileFallbackId = profileOptions(index)[0]?.id ?? firstAvailableProfileId()
      setFallback(index, { mode: 'profile', profileId: profileFallbackId })
      return
    }
    setFallback(index, { mode: 'model', modelId: '' })
  }

  function addProfileFallback(): void {
    const fallbackProfileId = firstAvailableProfileId()
    if (!fallbackProfileId) return
    value = [...value, { mode: 'profile', profileId: fallbackProfileId }]
  }

  function addRawModelFallback(): void {
    value = [...value, { mode: 'model', modelId: '' }]
  }

  function removeFallback(index: number): void {
    if (!confirmSettingsItemRemoval()) return
    value = value.filter((_, itemIndex) => itemIndex !== index)
  }

  function handleFallbackProfileChange(index: number, previousProfileId: string, event: Event): void {
    const select = event.currentTarget
    if (!(select instanceof HTMLSelectElement)) return
    if (isModelProfileDividerSelectValue(select.value)) {
      select.value = previousProfileId
      return
    }
    setFallback(index, { mode: 'profile', profileId: select.value })
  }

  let canAddProfileFallback = $derived(firstAvailableProfileId() !== '')
</script>

<div class="flex flex-col gap-3">
  {#each value as fallback, index}
    <div class="grid gap-2 rounded-md border border-darkborderc p-2 md:grid-cols-[10rem_minmax(0,1fr)_2.25rem]">
      <select
        class="rounded-md border border-darkborderc bg-transparent px-2 py-1 text-sm text-textcolor shadow-xs transition-colors duration-200 focus:border-borderc focus:outline-hidden focus:ring-2 focus:ring-borderc"
        aria-label={language.modelProfiles.fallbackModeLabel(index + 1)}
        value={fallback.mode}
        onchange={(event) => {
          setFallbackMode(index, event.currentTarget.value === 'model' ? 'model' : 'profile')
        }}>
        <option value="profile" class="bg-darkbg">{language.modelProfiles.fallbackProfileMode}</option>
        <option value="model" class="bg-darkbg">{language.modelProfiles.fallbackRawModelMode}</option>
      </select>

      {#if fallback.mode === 'profile'}
        <select
          class="min-w-0 rounded-md border border-darkborderc bg-transparent px-2 py-1 text-sm text-textcolor shadow-xs transition-colors duration-200 focus:border-borderc focus:outline-hidden focus:ring-2 focus:ring-borderc"
          aria-label={language.modelProfiles.fallbackProfileLabel(index + 1)}
          value={fallback.profileId}
          onchange={(event) => handleFallbackProfileChange(index, fallback.profileId, event)}>
          {#each profileOptions(index) as option (`${option.kind}:${option.id}`)}
            {#if option.kind === 'divider'}
              <option
                value={modelProfileDividerSelectValue(option.id)}
                data-model-profile-divider="true"
                class="bg-darkbg">---</option>
            {:else}
              <option value={option.id} class="bg-darkbg">{option.name}</option>
            {/if}
          {/each}
        </select>
      {:else}
        <TextInput
          size="sm"
          fullwidth
          value={fallback.modelId}
          ariaLabel={language.modelProfiles.fallbackModelLabel(index + 1)}
          placeholder={language.modelProfiles.modelPlaceholder}
          oninput={(event) => {
            setFallback(index, { mode: 'model', modelId: event.currentTarget.value })
          }} />
      {/if}

      <button
        type="button"
        class="flex h-9 w-9 items-center justify-center rounded-md bg-red-700 text-white hover:bg-red-500"
        aria-label={language.modelProfiles.removeFallbackLabel(index + 1)}
        onclick={() => {
          removeFallback(index)
        }}>
        <TrashIcon size={16} />
      </button>
    </div>
  {/each}

  {#if value.length === 0}
    <span class="text-sm text-textcolor2">{language.modelProfiles.noFallbacks}</span>
  {/if}

  <div class="flex flex-wrap gap-2">
    <Button size="sm" styled="outlined" disabled={!canAddProfileFallback} onclick={addProfileFallback}>
      <span class="inline-flex items-center gap-2"
        ><PlusIcon size={16} />{language.modelProfiles.addFallbackProfile}</span>
    </Button>
    <Button size="sm" styled="outlined" onclick={addRawModelFallback}>
      <span class="inline-flex items-center gap-2"
        ><PlusIcon size={16} />{language.modelProfiles.addRawModelFallback}</span>
    </Button>
  </div>
</div>
