<script lang="ts">
  import { CircleCheckIcon, Waypoints, XIcon } from '@lucide/svelte'
  import { language } from 'src/lang'
  import Button from 'src/lib/UI/GUI/Button.svelte'
  import TextInput from 'src/lib/UI/GUI/TextInput.svelte'
  import { toggleSelectedCharacterModule, toggleSelectedChatModule } from 'src/ts/moduleCommands'
  import type { RisuModule } from 'src/ts/process/modules'
  import { getResourceDatabase } from 'src/ts/server/resourceState.svelte'
  import { selectedCharID, SettingsMenuIndex, settingsOpen } from 'src/ts/stores.svelte'
  import { modalFocusTrap } from 'src/ts/gui/modalFocusTrap'

  interface Props {
    close?: any
    alertMode?: boolean
  }

  let { close = (i: string) => {}, alertMode = false }: Props = $props()
  let moduleSearch = $state('')

  function sortModules(modules: RisuModule[], search: string) {
    return modules
      .filter((v) => {
        if (search === '') return true
        return v.name.toLowerCase().includes(search.toLowerCase())
      })
      .sort((a, b) => {
        let score = a.name.toLowerCase().localeCompare(b.name.toLowerCase())
        return score
      })
  }
</script>

<div data-modal-root class="fixed inset-0 z-[100] bg-black/50 flex justify-center items-center">
  <div
    use:modalFocusTrap
    class="bg-darkbg p-4 break-any rounded-md flex flex-col max-w-3xl w-full max-h-full overflow-y-auto"
    role="dialog"
    aria-modal="true"
    aria-labelledby="risu-module-chat-menu-title"
    tabindex="-1">
    <div class="flex items-center text-textcolor">
      <h2 id="risu-module-chat-menu-title" class="mt-0 mb-0 text-lg">{language.modules}</h2>
      <div class="grow flex justify-end">
        <button
          class="text-textcolor2 hover:text-green-500 mr-2 cursor-pointer items-center"
          aria-label={language.close}
          onclick={() => {
            close('')
          }}>
          <XIcon size={24} />
        </button>
      </div>
    </div>

    <span class="text-sm text-textcolor2">{language.chatModulesInfo}</span>

    <TextInput className="mt-4" placeholder={language.search} ariaLabel={language.search} bind:value={moduleSearch} />

    <div class="contain w-full max-w-full mt-4 flex flex-col border-selected border-1 rounded-md">
      {#if getResourceDatabase().modules.length === 0}
        <div class="text-textcolor2 p-3">{language.noModules}</div>
      {:else}
        {#each sortModules(getResourceDatabase().modules, moduleSearch) as rmodule, i}
          {#if i !== 0}
            <div class="border-t-1 border-selected"></div>
          {/if}
          <div class="pl-3 py-3 text-left flex items-center">
            {#if rmodule.mcp}
              <Waypoints size={18} class="mr-2" />
            {/if}
            {#if !alertMode && getResourceDatabase().enabledModules.includes(rmodule.id)}
              <span class="text-textcolor2">{rmodule.name}</span>
            {:else}
              <span class="">{rmodule.name}</span>
            {/if}
            <div class="grow flex justify-end">
              {#if alertMode}
                <button
                  class={'text-textcolor2 mr-2 cursor-pointer hover:text-blue-500 transition-colors'}
                  aria-label={`${language.select}: ${rmodule.name}`}
                  onclick={async (e) => {
                    e.stopPropagation()

                    close(rmodule.id)
                  }}>
                  <CircleCheckIcon size={18} />
                </button>
              {:else if getResourceDatabase().enabledModules.includes(rmodule.id)}
                <button class="mr-2 text-textcolor2 cursor-not-allowed" aria-labelledby="disabled"> </button>
              {:else}
                <button
                  class={getResourceDatabase().characters[$selectedCharID].chats[
                    getResourceDatabase().characters[$selectedCharID].chatPage
                  ].modules?.includes(rmodule.id)
                    ? 'mr-2 cursor-pointer text-blue-500'
                    : getResourceDatabase().characters[$selectedCharID]?.modules?.includes(rmodule.id)
                      ? 'mr-2 cursor-pointer text-violet-500'
                      : 'text-textcolor2 hover:text-blue-400 mr-2 cursor-pointer'}
                  onclick={async (e) => {
                    e.stopPropagation()
                    toggleSelectedChatModule(rmodule.id)
                  }}
                  oncontextmenu={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    toggleSelectedCharacterModule(rmodule.id)
                  }}>
                  <CircleCheckIcon size={18} />
                </button>
              {/if}
            </div>
          </div>
        {/each}
      {/if}
    </div>
    <div>
      <Button
        className="mt-4 grow-0"
        size="sm"
        onclick={() => {
          $SettingsMenuIndex = 14
          $settingsOpen = true
          close('')
        }}>{language.edit}</Button>
    </div>
  </div>
</div>

<style>
  .break-any {
    word-break: normal;
    overflow-wrap: anywhere;
  }
</style>
