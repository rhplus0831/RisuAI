<script lang="ts">
  import { customSideBarConfigDialogStore } from 'src/ts/stores.svelte'
  import Button from '../UI/GUI/Button.svelte'
  import { language } from 'src/lang'
  import { getFullSettingsData } from 'src/ts/setting/utils'
  import TextInput from '../UI/GUI/TextInput.svelte'
  import type { CustomSideBarItem } from 'src/ts/storage/database.svelte'
  import { createServerBackedSettingDraft } from 'src/ts/server/settingsBridge.svelte'
  import { modalFocusTrap } from 'src/ts/gui/modalFocusTrap'
  import { createNonSecurityUuid } from 'src/ts/nonSecurityUuid'

  let configPage: 'list' | 'add' | 'addSettingsSubmenu' = $state('list')
  let search = $state('')
  const customSidebarItemsDraft = createServerBackedSettingDraft<CustomSideBarItem[]>('customSidebarItems', [])

  function close(): void {
    customSideBarConfigDialogStore.open = false
  }

  function handleDialogKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    close()
  }

  function removeCustomSidebarItem(itemId: string): void {
    customSidebarItemsDraft.value = customSidebarItemsDraft.value.filter((item) => item.id !== itemId)
  }

  function addCustomSidebarItem(item: Omit<CustomSideBarItem, 'id'>): void {
    customSidebarItemsDraft.value = [
      ...customSidebarItemsDraft.value,
      {
        id: createNonSecurityUuid(),
        ...item,
      },
    ]
    configPage = 'list'
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div data-modal-root class="fixed inset-0 bg-black/50 z-50 flex items-center justify-center" onclick={close}>
  <div
    use:modalFocusTrap
    class="bg-darkbg p-4 rounded max-h-full overflow-auto flex flex-col gap-2"
    role="dialog"
    aria-modal="true"
    aria-label={language.customSidebarConfig}
    tabindex="-1"
    onkeydown={handleDialogKeydown}
    onclick={(e) => e.stopPropagation()}>
    {#if configPage === 'list'}
      <div class="m-4 border-darkborderc p-2 border rounded-sm flex flex-col w-xl max-w-full">
        {#if customSidebarItemsDraft.value.length === 0}
          <div class="text-textcolor2">No custom sidebar items configured</div>
        {/if}

        {#each customSidebarItemsDraft.value as item}
          <div class="border-darkborderc p-2 border rounded-sm flex items-start">
            <div class="flex-1">{item.label}</div>

            <button
              class="ml-2"
              onclick={() => {
                removeCustomSidebarItem(item.id)
              }}>
              Delete
            </button>
          </div>
        {/each}
      </div>

      <Button
        onclick={() => {
          configPage = 'add'
        }}>
        Add Item
      </Button>

      <button
        data-modal-initial-focus
        class="rounded-md border border-darkborderc bg-darkbutton px-4 py-2 text-textcolor shadow-xs hover:bg-selected focus:outline-hidden focus:ring-2 focus:ring-selected"
        onclick={close}>
        Close
      </button>
    {/if}

    {#if configPage === 'add'}
      <Button
        onclick={() => {
          addCustomSidebarItem({
            type: 'model',
            subType: 'none',
            label: language.model,
          })
        }}>
        {language.model}
      </Button>

      <Button
        onclick={() => {
          addCustomSidebarItem({
            type: 'loadout',
            subType: 'none',
            label: language.loadouts,
          })
        }}>
        {language.loadouts}
      </Button>

      <Button
        onclick={() => {
          search = ''
          configPage = 'addSettingsSubmenu'
        }}>
        {language.settings}
      </Button>

      <Button
        onclick={() => {
          configPage = 'list'
        }}>
        Back to List
      </Button>
    {/if}

    {#if configPage === 'addSettingsSubmenu'}
      <div class="flex flex-col gap-2">
        <TextInput bind:value={search} placeholder="Search..." />
        <Button
          onclick={() => {
            configPage = 'add'
          }}>
          Back
        </Button>

        {#each getFullSettingsData(search) as type}
          <Button
            onclick={() => {
              addCustomSidebarItem({
                type: 'setting',
                subType: type.id,
                label: language[type.labelKey] || type.id,
              })
            }}>
            {language[type.labelKey] || type.id}
          </Button>
        {/each}
      </div>
    {/if}
  </div>
</div>
