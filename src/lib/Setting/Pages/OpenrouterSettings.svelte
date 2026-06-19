<script lang="ts">
  import { language } from 'src/lang'
  import Accordion from 'src/lib/UI/Accordion.svelte'
  import Check from 'src/lib/UI/GUI/CheckInput.svelte'
  import ChatFormatSettings from './ChatFormatSettings.svelte'
  import OpenrouterProviderList from 'src/lib/UI/OpenrouterProviderList.svelte'
  import { PlusIcon, TrashIcon } from '@lucide/svelte'
  import { getOpenRouterProviders } from 'src/ts/model/openrouter'
  import { createServerBackedSettingDraft } from 'src/ts/server/settingsBridge.svelte'

  type OpenrouterProviderSettings = {
    order: string[]
    only: string[]
    ignore: string[]
  }

  const openrouterFallbackDraft = createServerBackedSettingDraft<boolean>('openrouterFallback', false)
  const openrouterMiddleOutDraft = createServerBackedSettingDraft<boolean>('openrouterMiddleOut', false)
  const useInstructPromptDraft = createServerBackedSettingDraft<boolean>('useInstructPrompt', false)
  const openrouterProviderDraft = createServerBackedSettingDraft<OpenrouterProviderSettings>('openrouterProvider', {
    order: [],
    only: [],
    ignore: [],
  })

  interface Props {
    apiKey?: string | null
  }

  let { apiKey }: Props = $props()
  let providerCatalogContext = $derived(apiKey === undefined ? undefined : { apiKey })

  function addProviderEntry(key: keyof OpenrouterProviderSettings): void {
    openrouterProviderDraft.value = {
      ...openrouterProviderDraft.value,
      [key]: [...(openrouterProviderDraft.value[key] ?? []), ''],
    }
  }

  function removeProviderEntry(key: keyof OpenrouterProviderSettings): void {
    openrouterProviderDraft.value = {
      ...openrouterProviderDraft.value,
      [key]: (openrouterProviderDraft.value[key] ?? []).slice(0, -1),
    }
  }
</script>

<Accordion name={`OpenRouter ${language.settings}`} styled>
  <div class="flex items-center mb-4">
    <Check bind:check={openrouterFallbackDraft.value} name={language.openRouterFallback} />
  </div>
  <div class="flex items-center mb-4">
    <Check bind:check={openrouterMiddleOutDraft.value} name={language.openRouterMiddleOut} />
  </div>
  <div class="flex items-center mb-4">
    <Check bind:check={useInstructPromptDraft.value} name={language.useInstructPrompt} />
  </div>
  {#await getOpenRouterProviders(providerCatalogContext)}
    <Accordion name={language.openRouterProviderOrder} help="openRouterProviderOrder" styled>
      <p>{language.loading}...</p>
    </Accordion>
    <Accordion name={language.openRouterProviderOnly} help="openRouterProviderOnly" styled>
      <p>{language.loading}...</p>
    </Accordion>
    <Accordion name={language.openRouterProviderIgnore} help="openRouterProviderIgnore" styled>
      <p>{language.loading}...</p>
    </Accordion>
  {:then openRouterProviders}
    <Accordion name={language.openRouterProviderOrder} help="openRouterProviderOrder" styled>
      {#each openrouterProviderDraft.value.order as _, i}
        <span class="text-textcolor mt-4">
          {language.provider}
          {i + 1}
        </span>
        <OpenrouterProviderList bind:value={openrouterProviderDraft.value.order[i]} options={openRouterProviders} />
      {/each}
      <div class="flex gap-2">
        <button
          class="bg-selected text-textcolor p-2 rounded-md"
          onclick={() => {
            addProviderEntry('order')
          }}><PlusIcon /></button>
        <button
          class="bg-red-500 text-white p-2 rounded-md"
          onclick={() => {
            removeProviderEntry('order')
          }}><TrashIcon /></button>
      </div>
    </Accordion>

    <Accordion name={language.openRouterProviderOnly} help="openRouterProviderOnly" styled>
      {#each openrouterProviderDraft.value.only as model, i}
        <span class="text-textcolor mt-4">
          {language.provider}
          {i + 1}
        </span>
        <OpenrouterProviderList bind:value={openrouterProviderDraft.value.only[i]} options={openRouterProviders} />
      {/each}
      <div class="flex gap-2">
        <button
          class="bg-selected text-textcolor p-2 rounded-md"
          onclick={() => {
            addProviderEntry('only')
          }}><PlusIcon /></button>
        <button
          class="bg-red-500 text-white p-2 rounded-md"
          onclick={() => {
            removeProviderEntry('only')
          }}><TrashIcon /></button>
      </div>
    </Accordion>

    <Accordion name={language.openRouterProviderIgnore} help="openRouterProviderIgnore" styled>
      {#each openrouterProviderDraft.value.ignore as model, i}
        <span class="text-textcolor mt-4">
          {language.provider}
          {i + 1}
        </span>
        <OpenrouterProviderList bind:value={openrouterProviderDraft.value.ignore[i]} options={openRouterProviders} />
      {/each}
      <div class="flex gap-2">
        <button
          class="bg-selected text-textcolor p-2 rounded-md"
          onclick={() => {
            addProviderEntry('ignore')
          }}><PlusIcon /></button>
        <button
          class="bg-red-500 text-white p-2 rounded-md"
          onclick={() => {
            removeProviderEntry('ignore')
          }}><TrashIcon /></button>
      </div>
    </Accordion>
  {/await}

  {#if useInstructPromptDraft.value}
    <ChatFormatSettings />
  {/if}
</Accordion>
