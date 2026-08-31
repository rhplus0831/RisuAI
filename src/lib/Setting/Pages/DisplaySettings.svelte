<script lang="ts">
  import { language } from 'src/lang'
  import { settingsResourceState } from 'src/ts/server/resourceState.svelte'
  import SettingRenderer from '../SettingRenderer.svelte'
  import {
    displayOtherSettingsItems,
    displaySizeSettingsItems,
    displayThemeSettingsItems,
  } from 'src/ts/setting/displaySettingsData.svelte'
  import { reconcileLegacyGuiSubmenu } from 'src/ts/setting/legacyGuiLayout'

  let submenu = $state(0)

  $effect(() => {
    if (settingsResourceState.groupStatuses.display !== 'ready') {
      submenu = -1
      return
    }
    submenu = reconcileLegacyGuiSubmenu(Boolean(settingsResourceState.value.useLegacyGUI), submenu)
  })
</script>

<h2 class="mb-2 text-2xl font-bold mt-2">{language.display}</h2>

{#if submenu !== -1}
  <div class="flex w-full rounded-md border border-darkborderc mb-4 overflow-x-auto h-16 min-h-16 overflow-y-clip">
    <button
      aria-pressed={submenu === 0}
      onclick={() => {
        submenu = 0
      }}
      class="p-2 flex-1 border-r border-darkborderc"
      class:bg-darkbutton={submenu === 0}>
      <span>{language.theme}</span>
    </button>
    <button
      aria-pressed={submenu === 1}
      onclick={() => {
        submenu = 1
      }}
      class="p-2 flex-1 border-r border-darkborderc"
      class:bg-darkbutton={submenu === 1}>
      <span>{language.sizeAndSpeed}</span>
    </button>
    <button
      aria-pressed={submenu === 2}
      onclick={() => {
        submenu = 2
      }}
      class="p-2 flex-1 border-r border-darkborderc"
      class:bg-darkbutton={submenu === 2}>
      <span>{language.others}</span>
    </button>
  </div>
{/if}

{#if submenu === 0 || submenu === -1}
  <SettingRenderer items={displayThemeSettingsItems} />
{/if}

{#if submenu === 1 || submenu === -1}
  <SettingRenderer items={displaySizeSettingsItems} />
{/if}

{#if submenu === 2 || submenu === -1}
  <SettingRenderer items={displayOtherSettingsItems} />
{/if}
