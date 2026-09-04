<script lang="ts">
  import { untrack } from 'svelte'
  import { ChevronDownIcon, ChevronRightIcon, CircleCheckIcon, Waypoints, XIcon } from '@lucide/svelte'
  import { language } from 'src/lang'
  import Button from 'src/lib/UI/GUI/Button.svelte'
  import TextInput from 'src/lib/UI/GUI/TextInput.svelte'
  import { alertError, alertNormal } from 'src/ts/alert'
  import {
    toggleSelectedCharacterModule,
    toggleSelectedChatModule,
    type ScopedModuleMutationOutcome,
  } from 'src/ts/moduleCommands'
  import type { RisuModule } from 'src/ts/process/modules'
  import type { ServerCommandResult } from 'src/ts/server/commands'
  import {
    charactersResourceState,
    collectionsResourceState,
    getCharacterResourceOwner,
    settingsResourceState,
  } from 'src/ts/server/resourceState.svelte'
  import { selectedCharID, SettingsMenuIndex, settingsOpen } from 'src/ts/stores.svelte'
  import { modalBackdropDismiss } from 'src/ts/gui/modalBackdropDismiss'
  import { modalFocusTrap } from 'src/ts/gui/modalFocusTrap'
  import { resolveActiveModuleStates, type ModuleActivationSource } from 'src/ts/moduleActivation'
  import type { Chat, Database, character } from 'src/ts/storage/database.svelte'
  import type { ModuleFolder } from '@risuai/protocol/module-organization'
  import { groupModulesByFolder, normalizeModuleOrganizationSearch } from 'src/ts/moduleOrganization'

  interface Props {
    close?: any
    alertMode?: boolean
  }

  let { close = (i: string) => {}, alertMode = false }: Props = $props()
  let moduleSearch = $state('')
  let normalizedModuleSearch = $derived(normalizeModuleOrganizationSearch(moduleSearch))
  let nextScopedModuleMutationSequence = 0
  let scopedModuleMutationStates = $state<
    Record<string, { sequence: number; status: 'saving' | 'queued' | 'failed'; error?: string }>
  >({})
  let moduleOwnerSnapshot = $derived(readModuleOwners())
  let moduleOwners = $derived(moduleOwnerSnapshot ?? [])
  let enabledModuleIds = $derived(readEnabledModuleIds())
  let moduleFolders = $derived(readModuleFolders())
  let moduleGroups = $derived(
    groupModulesByFolder(moduleFolders, moduleOwners, {
      search: moduleSearch,
      omitEmptyMatches: true,
    }),
  )
  let collapsedFolderIds = $state<string[]>([])
  let knownFolderIds = $state<string[]>([])
  let selectedCharacter = $derived(selectedCharacterOwner())
  let selectedChat = $derived(selectedCharacter ? uniqueSelectedChatOwner(selectedCharacter) : undefined)
  let scopedModuleOwnerReady = $derived(!!selectedCharacter && !!selectedChat)
  let activeModuleStates = $derived.by(() => {
    const database = moduleActivationOwnerSnapshot()
    return new Map(
      resolveActiveModuleStates(database, selectedCharacter, selectedChat).map((state) => [state.module.id, state]),
    )
  })

  function readUniqueIdCollection<T extends { id: string }>(value: unknown): T[] {
    if (!Array.isArray(value)) return []
    const ids = new Set<string>()
    for (const candidate of value) {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return []
      const id = (candidate as { id?: unknown }).id
      if (typeof id !== 'string' || id.trim() !== id || id.length === 0 || ids.has(id)) return []
      ids.add(id)
    }
    return value as T[]
  }

  function readModuleOwners(): RisuModule[] | null {
    if (collectionsResourceState.statuses.modules !== 'ready') return null
    const value = collectionsResourceState.values.modules
    const modules = readUniqueIdCollection<RisuModule>(value)
    if (!Array.isArray(value) || modules.length !== value.length) return null
    return modules.every((module) => typeof module.name === 'string') ? modules : null
  }

  function readEnabledModuleIds(): string[] {
    if (settingsResourceState.groupStatuses.modules !== 'ready') return []
    const value = settingsResourceState.value.enabledModules
    if (!Array.isArray(value)) return []
    const ids = new Set<string>()
    for (const candidate of value) {
      if (
        typeof candidate !== 'string' ||
        candidate.trim() !== candidate ||
        candidate.length === 0 ||
        ids.has(candidate)
      ) {
        return []
      }
      ids.add(candidate)
    }
    return value
  }

  function readModuleFolders(): ModuleFolder[] {
    if (settingsResourceState.groupStatuses.modules !== 'ready') return []
    const value = settingsResourceState.value.moduleFolders
    if (value === undefined) return []
    const folders = readUniqueIdCollection<ModuleFolder>(value)
    return folders.length === (Array.isArray(value) ? value.length : -1) &&
      folders.every((folder) => typeof folder.name === 'string' && folder.name.trim() !== '')
      ? folders
      : []
  }

  function selectedCharacterOwner(): character | undefined {
    if (charactersResourceState.status !== 'ready') return undefined
    const candidate = charactersResourceState.characters[$selectedCharID]
    if (!candidate?.chaId) return undefined
    return getCharacterResourceOwner(candidate.chaId)
  }

  function uniqueSelectedChatOwner(character: character): Chat | undefined {
    const candidate = character.chats?.[character.chatPage]
    if (!candidate?.id) return undefined
    let owner: Chat | undefined
    for (const chat of character.chats ?? []) {
      if (chat?.id !== candidate.id) continue
      if (owner) return undefined
      owner = chat
    }
    return owner
  }

  function moduleActivationOwnerSnapshot(): Database {
    const settings = settingsResourceState.value
    return {
      modules: moduleOwners,
      enabledModules: enabledModuleIds,
      personas:
        collectionsResourceState.statuses.personas === 'ready'
          ? readUniqueIdCollection(collectionsResourceState.values.personas)
          : [],
      promptPresets:
        collectionsResourceState.statuses.promptPresets === 'ready'
          ? readUniqueIdCollection(collectionsResourceState.values.promptPresets)
          : [],
      agentPresets:
        settingsResourceState.groupStatuses.agents === 'ready' ? readUniqueIdCollection(settings.agentPresets) : [],
      agentPresetDefaultId:
        settingsResourceState.groupStatuses.agents === 'ready' && typeof settings.agentPresetDefaultId === 'string'
          ? settings.agentPresetDefaultId
          : undefined,
      moduleIntergration:
        settingsResourceState.groupStatuses.advanced === 'ready' && typeof settings.moduleIntergration === 'string'
          ? settings.moduleIntergration
          : '',
      selectedPersona:
        settingsResourceState.standaloneStatuses.selectedPersona === 'ready' &&
        Number.isInteger(settings.selectedPersona)
          ? settings.selectedPersona
          : -1,
      selectedPersonaId:
        settingsResourceState.standaloneStatuses.selectedPersonaId === 'ready' &&
        (typeof settings.selectedPersonaId === 'string' || settings.selectedPersonaId === null)
          ? settings.selectedPersonaId
          : null,
    } as Database
  }

  $effect(() => {
    const ids = moduleFolders.map((folder) => folder.id)
    const previousIds = untrack(() => knownFolderIds)
    if (ids.length === previousIds.length && ids.every((id, index) => previousIds[index] === id)) return
    const previousCollapsed = untrack(() => collapsedFolderIds)
    collapsedFolderIds = [
      ...new Set([
        ...previousCollapsed.filter((id) => ids.includes(id)),
        ...ids.filter((id) => !previousIds.includes(id)),
      ]),
    ]
    knownFolderIds = ids
  })

  function toggleFolder(folderId: string): void {
    collapsedFolderIds = collapsedFolderIds.includes(folderId)
      ? collapsedFolderIds.filter((id) => id !== folderId)
      : [...collapsedFolderIds, folderId]
  }

  function hasActivationSource(moduleId: string, source: ModuleActivationSource): boolean {
    return activeModuleStates.get(moduleId)?.sources.includes(source) ?? false
  }

  function isInheritedActive(moduleId: string): boolean {
    return (
      activeModuleStates.get(moduleId)?.sources.some((source) => source !== 'chat' && source !== 'character') ?? false
    )
  }

  function inheritedActivationLabels(moduleId: string): Array<{ source: ModuleActivationSource; label: string }> {
    const labels: Array<{ source: ModuleActivationSource; label: string }> = []
    for (const source of activeModuleStates.get(moduleId)?.sources ?? []) {
      if (source === 'persona') labels.push({ source, label: language.personaModuleLinkActive })
      if (source === 'promptPresetIntegration') {
        labels.push({ source, label: language.promptPresetModuleIntegrationActive })
      }
      if (source === 'agentPresetIntegration') {
        labels.push({ source, label: language.agentPresetModuleIntegrationActive })
      }
      if (source === 'legacyIntegration') labels.push({ source, label: language.moduleIntegrationActive })
    }
    return labels
  }

  function closeMenu(): void {
    close('')
  }

  function handleDialogKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    closeMenu()
  }

  function moduleMutationError(result: Exclude<ServerCommandResult, { status: 'ok' }>): string {
    if (result.status === 'conflict') return language.moduleSave.commandConflict
    if (result.status === 'unavailable') return language.moduleSave.commandUnavailable
    return language.moduleSave.commandError(result.error)
  }

  function thrownMutationError(error: unknown): string {
    return language.moduleSave.commandError(error instanceof Error ? error.message : String(error))
  }

  function isScopedModuleMutationPending(moduleId: string): boolean {
    const status = scopedModuleMutationStates[moduleId]?.status
    return status === 'saving' || status === 'queued'
  }

  function clearScopedModuleMutation(moduleId: string, sequence: number): void {
    if (scopedModuleMutationStates[moduleId]?.sequence === sequence) delete scopedModuleMutationStates[moduleId]
  }

  function failScopedModuleMutation(moduleId: string, sequence: number, error: string): void {
    if (scopedModuleMutationStates[moduleId]?.sequence !== sequence) return
    scopedModuleMutationStates[moduleId] = { sequence, status: 'failed', error }
    alertError(error)
  }

  async function trackScopedModuleMutation(
    moduleId: string,
    dispatch: () => Promise<ScopedModuleMutationOutcome>,
  ): Promise<void> {
    if (isScopedModuleMutationPending(moduleId)) return
    const sequence = ++nextScopedModuleMutationSequence
    scopedModuleMutationStates[moduleId] = { sequence, status: 'saving' }

    try {
      const outcome = await dispatch()
      if (scopedModuleMutationStates[moduleId]?.sequence !== sequence) return
      if (outcome.status === 'accepted') {
        clearScopedModuleMutation(moduleId, sequence)
        return
      }
      if (outcome.status === 'failed') {
        failScopedModuleMutation(moduleId, sequence, moduleMutationError(outcome.result))
        return
      }

      scopedModuleMutationStates[moduleId] = { sequence, status: 'queued' }
      alertNormal(language.moduleSave.queued)
      void outcome.settlement.then(
        (settlement) => {
          if (settlement.status === 'accepted') {
            clearScopedModuleMutation(moduleId, sequence)
          } else {
            failScopedModuleMutation(moduleId, sequence, moduleMutationError(settlement.result))
          }
        },
        (error) => failScopedModuleMutation(moduleId, sequence, thrownMutationError(error)),
      )
    } catch (error) {
      failScopedModuleMutation(moduleId, sequence, thrownMutationError(error))
    }
  }

  function scopedModuleMutationStatus(moduleId: string): string {
    const state = scopedModuleMutationStates[moduleId]
    if (state?.status === 'saving') return language.moduleSave.saving
    if (state?.status === 'queued') return language.moduleSave.queued
    if (state?.status === 'failed') return state.error ?? language.moduleSave.commandUnavailable
    return ''
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  use:modalBackdropDismiss={closeMenu}
  data-modal-root
  class="fixed inset-0 z-[100] bg-black/50 flex justify-center items-center">
  <div
    use:modalFocusTrap
    class="bg-darkbg p-4 break-any rounded-md flex flex-col max-w-3xl w-full max-h-full overflow-y-auto"
    role="dialog"
    aria-modal="true"
    aria-labelledby="risu-module-chat-menu-title"
    tabindex="-1"
    onkeydown={handleDialogKeydown}>
    <div class="flex items-center text-textcolor">
      <h2 id="risu-module-chat-menu-title" class="mt-0 mb-0 text-lg">{language.modules}</h2>
      <div class="grow flex justify-end">
        <button
          data-modal-initial-focus
          class="text-textcolor2 hover:text-green-500 mr-2 cursor-pointer items-center"
          aria-label={language.close}
          onclick={closeMenu}>
          <XIcon size={24} />
        </button>
      </div>
    </div>

    <span class="text-sm text-textcolor2">{language.chatModulesInfo}</span>

    <TextInput className="mt-4" placeholder={language.search} ariaLabel={language.search} bind:value={moduleSearch} />

    <div class="contain w-full max-w-full mt-4 flex flex-col border-selected border-1 rounded-md">
      {#if moduleOwners.length === 0}
        <div class="text-textcolor2 p-3">{language.noModules}</div>
      {:else if moduleGroups.length === 0}
        <div class="text-textcolor2 p-3">{language.moduleFolders.noSearchResults}</div>
      {:else}
        {#each moduleGroups as group (group.folder?.id ?? '__uncategorized__')}
          {@const collapsed =
            !!group.folder && collapsedFolderIds.includes(group.folder.id) && normalizedModuleSearch === ''}
          <section data-risu-module-picker-folder={group.folder?.id ?? 'uncategorized'}>
            <div class="flex items-center gap-2 bg-darkbg px-3 py-2 border-b border-selected">
              {#if group.folder}
                <button
                  aria-label={collapsed
                    ? language.moduleFolders.expand(group.folder.name)
                    : language.moduleFolders.collapse(group.folder.name)}
                  aria-expanded={!collapsed}
                  class="text-textcolor2 hover:text-textcolor"
                  onclick={() => toggleFolder(group.folder!.id)}>
                  {#if collapsed}<ChevronRightIcon size={18} />{:else}<ChevronDownIcon size={18} />{/if}
                </button>
              {/if}
              <span class="font-semibold">{group.folder?.name ?? language.moduleFolders.uncategorized}</span>
              <span class="text-xs text-textcolor2">({group.modules.length})</span>
            </div>
            {#if !collapsed}
              {#each group.modules as rmodule, i (rmodule.id)}
                {@const inheritedLabels = inheritedActivationLabels(rmodule.id)}
                {#if i !== 0}<div class="border-t-1 border-selected"></div>{/if}
                <div class="pl-3 py-3 text-left">
                  <div class="flex items-center">
                    {#if rmodule.mcp}<Waypoints size={18} class="mr-2" />{/if}
                    <span class={!alertMode && isInheritedActive(rmodule.id) ? 'text-textcolor2' : ''}
                      >{rmodule.name}</span>
                    <div class="grow flex justify-end">
                      {#if alertMode}
                        <button
                          class="text-textcolor2 mr-2 cursor-pointer hover:text-blue-500 transition-colors"
                          aria-label={`${language.select}: ${rmodule.name}`}
                          onclick={(event) => {
                            event.stopPropagation()
                            close(rmodule.id)
                          }}><CircleCheckIcon size={18} /></button>
                      {:else if hasActivationSource(rmodule.id, 'global')}
                        <span class="mr-2" aria-hidden="true"></span>
                      {:else if inheritedLabels.length > 0}
                        <span class="mr-2 flex flex-wrap justify-end gap-1">
                          {#each inheritedLabels as activation}
                            <span class="text-xs text-blue-400" data-module-activation-source={activation.source}
                              >{activation.label}</span>
                          {/each}
                        </span>
                      {:else if rmodule.mcp || !scopedModuleOwnerReady}
                        <span class="mr-2" aria-hidden="true"></span>
                      {:else}
                        <button
                          aria-label={`${language.module}: ${rmodule.name}`}
                          aria-pressed={hasActivationSource(rmodule.id, 'chat') ||
                            hasActivationSource(rmodule.id, 'character')}
                          aria-busy={isScopedModuleMutationPending(rmodule.id)}
                          disabled={isScopedModuleMutationPending(rmodule.id)}
                          class={hasActivationSource(rmodule.id, 'chat')
                            ? 'mr-2 cursor-pointer text-blue-500 disabled:cursor-wait disabled:opacity-60'
                            : hasActivationSource(rmodule.id, 'character')
                              ? 'mr-2 cursor-pointer text-violet-500 disabled:cursor-wait disabled:opacity-60'
                              : 'text-textcolor2 hover:text-blue-400 mr-2 cursor-pointer disabled:cursor-wait disabled:opacity-60'}
                          onclick={(event) => {
                            event.stopPropagation()
                            void trackScopedModuleMutation(rmodule.id, () => toggleSelectedChatModule(rmodule.id))
                          }}
                          oncontextmenu={(event) => {
                            event.preventDefault()
                            event.stopPropagation()
                            void trackScopedModuleMutation(rmodule.id, () => toggleSelectedCharacterModule(rmodule.id))
                          }}><CircleCheckIcon size={18} /></button>
                      {/if}
                    </div>
                  </div>
                  {#if !alertMode && scopedModuleMutationStates[rmodule.id]?.status === 'failed'}
                    <div
                      data-module-mutation-status={rmodule.id}
                      class="mt-1 pr-2 text-xs text-draculared"
                      role="alert">
                      {scopedModuleMutationStatus(rmodule.id)}
                    </div>
                  {/if}
                </div>
              {/each}
            {/if}
          </section>
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
