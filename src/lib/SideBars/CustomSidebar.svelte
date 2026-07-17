<script lang="ts">
  import { loadoutModalStore } from 'src/ts/stores.svelte'
  import Button from '../UI/GUI/Button.svelte'
  import { language } from 'src/lang'
  import { getFullSettingsData } from 'src/ts/setting/utils'
  import ModelList from '../UI/ModelList.svelte'
  import SettingRenderer from '../Setting/SettingRenderer.svelte'
  import { createServerBackedSettingDraft } from 'src/ts/server/settingsBridge.svelte'
  import { getDatabase, type CustomSideBarItem } from 'src/ts/storage/database.svelte'

  const aiModelDraft = createServerBackedSettingDraft<string>('aiModel', '')
  const settingsById = $derived.by(() => new Map(getFullSettingsData().map((setting) => [setting.id, setting])))
  const sidebarItems = $derived.by(() => {
    const items = getDatabase().customSidebarItems
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
      <ModelList bind:value={aiModelDraft.value} noMargin />
    {:else if item.type === 'loadout'}
      <Button
        onclick={() => {
          loadoutModalStore.open = !loadoutModalStore.open
        }}>{getDatabase().lastLoadedLoadoutName || language.loadouts}</Button>
    {:else if item.type === 'setting'}
      {@const settingItem = settingsById.get(item.subType)}
      {#if settingItem}
        <SettingRenderer items={[settingItem]} />
      {/if}
    {/if}
  {/each}
</div>
