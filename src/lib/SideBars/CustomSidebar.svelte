<script lang="ts">
  import { DBState, loadoutModalStore } from 'src/ts/stores.svelte'
  import Button from '../UI/GUI/Button.svelte'
  import { language } from 'src/lang'
  import { getFullSettingsData } from 'src/ts/setting/utils'
  import ModelList from '../UI/ModelList.svelte'
  import SettingRenderer from '../Setting/SettingRenderer.svelte'
  import { createServerBackedSettingDraft } from 'src/ts/server/settingsBridge.svelte'

  const aiModelDraft = createServerBackedSettingDraft<string>('aiModel', '')
</script>

<div class="rounded-sm flex flex-col w-full gap-2">
  {#each DBState.db.customSidebarItems as item}
    {#if item.type === 'model'}
      <ModelList bind:value={aiModelDraft.value} noMargin />
    {:else if item.type === 'loadout'}
      <Button
        onclick={() => {
          loadoutModalStore.open = !loadoutModalStore.open
        }}>{DBState.db.lastLoadedLoadoutName || language.loadouts}</Button
      >
    {:else if item.type === 'setting'}
      <SettingRenderer items={[getFullSettingsData().find((s) => s.id === item.subType)]} />
    {/if}
  {/each}
</div>
