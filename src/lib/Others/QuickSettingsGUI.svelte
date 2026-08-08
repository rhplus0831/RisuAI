<script lang="ts">
  import { BotIcon, BrainIcon, PackageIcon } from '@lucide/svelte'
  import { language } from 'src/lang'
  import { QuickSettings } from 'src/ts/stores.svelte'
  import BotSettings from '../Setting/Pages/BotSettings.svelte'
  import OtherBotSettings from '../Setting/Pages/OtherBotSettings.svelte'
  import ModuleSettings from '../Setting/Pages/Module/ModuleSettings.svelte'
</script>

<div class="flex mb-2 gap-2">
  <button
    type="button"
    aria-label={language.chatBot}
    aria-pressed={QuickSettings.index === 0}
    class={QuickSettings.index === 0 ? 'text-textcolor ' : 'text-textcolor2'}
    onclick={() => {
      QuickSettings.index = 0
    }}>
    <BotIcon />
  </button>
  <button
    type="button"
    aria-label={language.settingsNavMemory}
    aria-pressed={QuickSettings.index === 1}
    class={QuickSettings.index === 1 ? 'text-textcolor ' : 'text-textcolor2'}
    onclick={() => {
      QuickSettings.index = 1
    }}>
    <BrainIcon />
  </button>
  <button
    type="button"
    aria-label={language.modules}
    aria-pressed={QuickSettings.index === 2}
    class={QuickSettings.index === 2 ? 'text-textcolor ' : 'text-textcolor2'}
    onclick={() => {
      QuickSettings.index = 2
    }}>
    <PackageIcon />
  </button>
</div>

<div class="py-6 px-4 flex flex-col text-textcolor overflow-y-auto relative rs-setting-cont-5">
  {#if QuickSettings.index === 0}
    <BotSettings />
  {:else if QuickSettings.index === 1}
    <OtherBotSettings />
  {:else if QuickSettings.index === 2}
    <ModuleSettings />
  {/if}
</div>
