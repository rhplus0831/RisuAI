<script lang="ts">
  import { loadoutModalStore, openPresetListModal } from 'src/ts/stores.svelte'
  import Button from '../UI/GUI/Button.svelte'
  import { language } from 'src/lang'
  import { getFullSettingsData } from 'src/ts/setting/utils'
  import SettingRenderer from '../Setting/SettingRenderer.svelte'
  import type { CustomSideBarItem, Database } from 'src/ts/storage/database.svelte'
  import { settingsResourceState } from 'src/ts/server/resourceState.svelte'

  const settingsById = $derived.by(() => new Map(getFullSettingsData().map((setting) => [setting.id, setting])))
  const sidebarSettings = $derived.by(() => {
    if (settingsResourceState.status === 'error' || settingsResourceState.groupStatuses.sidebar !== 'ready') {
      return undefined
    }
    return settingsResourceState.value as Partial<Database>
  })
  const sidebarItems = $derived.by(() => {
    const items = sidebarSettings?.customSidebarItems
    return Array.isArray(items)
      ? items.filter((item): item is CustomSideBarItem => {
          if (!item || typeof item !== 'object' || Array.isArray(item)) return false
          if (!['model', 'loadout', 'setting'].includes(item.type)) return false
          if (typeof item.id !== 'string' || typeof item.subType !== 'string' || typeof item.label !== 'string') {
            return false
          }
          return item.type !== 'setting' || settingsById.has(item.subType)
        })
      : []
  })
</script>

<div class="rounded-sm flex flex-col w-full gap-2">
  {#each sidebarItems as item}
    {#if item.type === 'model'}
      <Button onclick={() => openPresetListModal('global', 'model')}>{language.modelPresets}</Button>
    {:else if item.type === 'loadout'}
      <Button
        onclick={() => {
          loadoutModalStore.open = !loadoutModalStore.open
        }}>{sidebarSettings?.lastLoadedLoadoutName || language.loadouts}</Button>
    {:else if item.type === 'setting'}
      {@const settingItem = settingsById.get(item.subType)}
      {#if settingItem}
        <SettingRenderer items={[settingItem]} />
      {/if}
    {/if}
  {/each}
</div>
