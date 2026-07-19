<script lang="ts">
  import { PencilIcon, TrashIcon, XIcon } from '@lucide/svelte'
  import { untrack } from 'svelte'
  import { get } from 'svelte/store'
  import { language } from 'src/lang'
  import { alertConfirm, alertError, alertInput, alertNormal, alertSelect } from 'src/ts/alert'
  import {
    resolveActiveChatGenerationSettings,
    saveActiveChatGenerationSettingsPatchWithOutcome,
    saveActiveChatGenerationSettingsSelectionWithOutcome,
    type ActiveChatGenerationSettingsState,
  } from 'src/ts/activeChatGenerationSettings'
  import {
    applyChatGenerationTogglePresetWithOutcome,
    compareChatGenerationTogglePresetToActiveState,
    createChatGenerationTogglePresetPickValues,
    deleteChatGenerationTogglePreset,
    getChatGenerationTogglePresetPickEligibility,
    getChatGenerationTogglePresets,
    overwriteCurrentChatGenerationTogglePreset,
    renameChatGenerationTogglePreset,
    saveCurrentChatGenerationTogglePreset,
    sortChatGenerationTogglePresetsBySimilarity,
    type ChatGenerationTogglePreset,
    type ChatGenerationToggleSimilarityToggle,
  } from 'src/ts/chatGenerationTogglePresets'
  import type { ChatGenerationRequiredSidebarToggle } from 'src/ts/chatGenerationSettings'
  import type { ActiveChatTarget, ChatGenerationSettingsSaveOperation } from 'src/ts/chatCommands'
  import { modalFocusTrap } from 'src/ts/gui/modalFocusTrap'
  import { chatGenerationTogglePresetListModalStore, selectedCharID } from 'src/ts/stores.svelte'
  import Button from '../UI/GUI/Button.svelte'
  import TextInput from '../UI/GUI/TextInput.svelte'

  interface Props {
    close?: () => void
    target?: ActiveChatTarget | null
  }

  interface ToggleSource {
    id: string
    name: string
    toggles: ChatGenerationRequiredSidebarToggle[]
  }

  let { close = () => {}, target = null }: Props = $props()
  const openedState = untrack(() => resolveActiveChatGenerationSettings({ selectedCharIndex: get(selectedCharID) }))
  let presetOrder = $state(
    sortChatGenerationTogglePresetsBySimilarity(
      getChatGenerationTogglePresets(),
      similarityToggles(openedState.requiredSidebarToggles, openedState),
    ).map((preset) => preset.id),
  )
  const sources = untrack(() => collectToggleSources(openedState))
  let pickStage = $state<'closed' | 'source' | 'preset'>('closed')
  let pickedSource = $state<ToggleSource | null>(null)
  let pickPresetOrder = $state<string[]>([])
  let editMode = $state(false)
  let writeOperation = 0

  let activeState = $derived.by(() =>
    resolveActiveChatGenerationSettings({
      selectedCharIndex: $selectedCharID,
    }),
  )
  let presets = $derived.by(() => orderedPresets(presetOrder, getChatGenerationTogglePresets()))
  let loadedPresetId = $derived(activeState.settings?.togglePresetId?.trim() ?? '')
  let loadedPreset = $derived.by(() => presets.find((preset) => preset.id === loadedPresetId))
  let loadedComparison = $derived.by(() =>
    loadedPreset ? compareChatGenerationTogglePresetToActiveState(loadedPreset, activeState) : null,
  )
  let persistenceStatus = $derived(
    (activeState.identity.chatId &&
      chatGenerationTogglePresetListModalStore.saveStates[activeState.identity.chatId]?.status) ||
      'idle',
  )
  let saveDisabled = $derived(
    !activeState.identity.chatId ||
      persistenceStatus === 'pending' ||
      (!!loadedPreset && loadedComparison?.hasAnyDifference !== true),
  )
  let applyDisabled = $derived(
    !loadedPreset || persistenceStatus === 'pending' || loadedComparison?.hasAnyDifference !== true,
  )
  let pickPresets = $derived.by(() => orderedPresets(pickPresetOrder, getChatGenerationTogglePresets()))

  async function runSettingsWrite(create: () => ChatGenerationSettingsSaveOperation | null): Promise<boolean> {
    const chatId = target?.chatId
    if (!chatId || persistenceStatus === 'pending') return false
    const operation = ++writeOperation
    chatGenerationTogglePresetListModalStore.saveStates[chatId] = { operation, status: 'pending' }
    const persistence = create()
    if (!persistence) {
      if (chatGenerationTogglePresetListModalStore.saveStates[chatId]?.operation === operation) {
        chatGenerationTogglePresetListModalStore.saveStates[chatId].status = 'failed'
      }
      alertError(language.chatGenerationSettingsSaveFailed(language.chatGenerationSettingsTargetChanged))
      return false
    }
    const result = await persistence.settlement
    if (chatGenerationTogglePresetListModalStore.saveStates[chatId]?.operation !== operation) return false
    if (result.status === 'accepted') {
      delete chatGenerationTogglePresetListModalStore.saveStates[chatId]
      return true
    }
    chatGenerationTogglePresetListModalStore.saveStates[chatId].status = result.status
    if (result.status === 'queued') {
      alertNormal(language.settingsSaveQueued)
      return true
    }
    alertError(language.chatGenerationSettingsSaveFailed(result.error))
    return false
  }

  async function selectPreset(presetId: string): Promise<void> {
    await runSettingsWrite(() =>
      saveActiveChatGenerationSettingsSelectionWithOutcome({ togglePresetId: presetId }, { expectedTarget: target }),
    )
  }

  async function unselectPreset(): Promise<void> {
    if (!loadedPresetId) return
    await selectPreset('')
  }

  async function savePreset(): Promise<void> {
    const existingPreset = loadedPreset
    if (existingPreset) {
      const selectedAction = await alertSelect(
        [language.chatGenerationTogglePresetOverwrite, language.chatGenerationTogglePresetCreateNew],
        language.chatGenerationTogglePresetSaveChoice(existingPreset.name),
      )
      if (selectedAction === null) return
      const selection = Number(selectedAction)
      if (selection === 0) {
        if (
          loadedComparison?.hasToggleTypeMismatch &&
          !(await alertConfirm(language.chatGenerationTogglePresetMismatchOverwriteConfirm))
        ) {
          return
        }
        overwriteCurrentChatGenerationTogglePreset(existingPreset.id, { expectedTarget: target })
        return
      }
      if (selection !== 1) return
    }

    const name = await alertInput(language.chatGenerationTogglePresetNamePrompt)
    if (typeof name !== 'string' || name.trim().length === 0) return
    const preset = saveCurrentChatGenerationTogglePreset(name, { expectedTarget: target })
    if (!preset) return
    presetOrder = [...presetOrder, preset.id]
    await selectPreset(preset.id)
  }

  async function applyPreset(): Promise<void> {
    const presetId = loadedPreset?.id
    if (!presetId || !(await alertConfirm(language.chatGenerationTogglePresetApplyConfirm))) return
    await runSettingsWrite(() => applyChatGenerationTogglePresetWithOutcome(presetId, { expectedTarget: target }))
  }

  async function removePreset(preset: ChatGenerationTogglePreset): Promise<void> {
    if (!(await alertConfirm(language.chatGenerationTogglePresetDeleteConfirm(preset.name)))) return
    deleteChatGenerationTogglePreset(preset.id)
  }

  function renamePreset(preset: ChatGenerationTogglePreset, name: string): void {
    renameChatGenerationTogglePreset(preset.id, name)
  }

  function beginPick(): void {
    pickStage = 'source'
    pickedSource = null
    pickPresetOrder = []
  }

  function chooseSource(source: ToggleSource): void {
    pickedSource = source
    pickPresetOrder = sortChatGenerationTogglePresetsBySimilarity(
      getChatGenerationTogglePresets(),
      similarityToggles(source.toggles, activeState),
    ).map((preset) => preset.id)
    pickStage = 'preset'
  }

  async function pickPreset(preset: ChatGenerationTogglePreset): Promise<void> {
    const source = pickedSource
    if (!source) return
    const values = createChatGenerationTogglePresetPickValues(preset, source.toggles)
    if (!values) return
    const current = activeState.settings?.sidebarToggles ?? {}
    const changedCount = Object.entries(values).filter(([key, value]) => current[key] !== value).length
    if (!(await alertConfirm(language.chatGenerationTogglePresetPickConfirm(source.name, changedCount)))) return
    const saved = await runSettingsWrite(() =>
      saveActiveChatGenerationSettingsPatchWithOutcome({ sidebarToggles: values }, { expectedTarget: target }),
    )
    if (saved) pickStage = 'closed'
  }

  function handleDialogKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    if (persistenceStatus !== 'pending') close()
  }

  function handleBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget && persistenceStatus !== 'pending') close()
  }

  function ineligibilityReasons(preset: ChatGenerationTogglePreset, source: ToggleSource): string[] {
    const eligibility = getChatGenerationTogglePresetPickEligibility(preset, source.toggles)
    const reasons: string[] = []
    if (eligibility.missingSidebarToggleKeys.length > 0) {
      reasons.push(language.chatGenerationTogglePresetPickMissingKeys(eligibility.missingSidebarToggleKeys.length))
    }
    if (eligibility.kindMismatchSidebarToggleKeys.length > 0) {
      reasons.push(
        language.chatGenerationTogglePresetPickKindMismatch(eligibility.kindMismatchSidebarToggleKeys.length),
      )
    }
    return reasons
  }

  function orderedPresets(ids: readonly string[], livePresets: readonly ChatGenerationTogglePreset[]) {
    const byId = new Map(livePresets.map((preset) => [preset.id, preset]))
    return ids.flatMap((id) => {
      const preset = byId.get(id)
      return preset ? [preset] : []
    })
  }

  function similarityToggles(
    toggles: readonly ChatGenerationRequiredSidebarToggle[],
    state: ActiveChatGenerationSettingsState,
  ): ChatGenerationToggleSimilarityToggle[] {
    const values = state.settings?.sidebarToggles ?? {}
    return toggles.map((toggle) => ({ key: toggle.key, kind: toggle.kind, value: values[toggle.key] ?? '' }))
  }

  function collectToggleSources(state: ActiveChatGenerationSettingsState): ToggleSource[] {
    const grouped = new Map<string, ChatGenerationRequiredSidebarToggle[]>()
    for (const toggle of state.requiredSidebarToggles) {
      const sourceId =
        toggle.source === 'preset' ? `preset:${toggle.presetId ?? ''}` : `module:${toggle.moduleId ?? ''}`
      const existing = grouped.get(sourceId)
      if (existing) existing.push(toggle)
      else grouped.set(sourceId, [toggle])
    }

    return [...grouped.entries()].map(([id, toggles]) => {
      const first = toggles[0]
      if (first.source === 'preset') {
        const preset = state.db.promptPresets?.find((candidate) => candidate.id === first.presetId)
        const name = preset?.name?.trim() || first.presetId || ''
        return { id, name: language.chatGenerationTogglePresetPickPromptSource(name), toggles }
      }
      const module = state.db.modules?.find((candidate) => candidate.id === first.moduleId)
      const name = module?.name?.trim() || first.moduleNamespace || first.moduleId || ''
      return { id, name: language.chatGenerationTogglePresetPickModuleSource(name), toggles }
    })
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  data-modal-root
  class="fixed inset-0 z-[60] bg-black/50 flex justify-center items-center"
  onclick={handleBackdropClick}>
  <div
    use:modalFocusTrap
    class="bg-darkbg p-4 break-any rounded-md flex flex-col max-h-full overflow-y-auto toggle-preset-modal"
    data-risu-toggle-preset-dialog
    data-risu-persistence-status={persistenceStatus}
    role="dialog"
    aria-modal="true"
    aria-labelledby="risu-toggle-preset-dialog-title"
    tabindex="-1"
    onkeydown={handleDialogKeydown}>
    <div class="flex items-center text-textcolor mb-4">
      <h2 id="risu-toggle-preset-dialog-title" class="mt-0 mb-0">
        {pickStage === 'source'
          ? language.chatGenerationTogglePresetPickSourceTitle
          : pickStage === 'preset' && pickedSource
            ? language.chatGenerationTogglePresetPickPresetTitle(pickedSource.name)
            : language.chatGenerationTogglePresetDialogTitle}
      </h2>
      <div class="grow flex justify-end">
        <button
          data-modal-initial-focus
          disabled={persistenceStatus === 'pending'}
          class="text-textcolor2 hover:text-green-500 mr-2 cursor-pointer items-center"
          aria-label={language.close}
          onclick={close}>
          <XIcon size={24} />
        </button>
      </div>
    </div>

    {#if pickStage === 'source'}
      <div data-risu-toggle-preset-pick-sources>
        {#if sources.length === 0}
          <span class="text-textcolor2 text-sm">{language.chatGenerationTogglePresetNoSources}</span>
        {/if}
        {#each sources as source (source.id)}
          <button
            type="button"
            class="w-full p-2 text-left border-t border-darkborderc hover:bg-gray-600"
            data-risu-toggle-preset-source-row
            data-risu-source-id={source.id}
            onclick={() => chooseSource(source)}>{source.name}</button>
        {/each}
      </div>
      <div class="mt-3">
        <Button size="sm" onclick={() => (pickStage = 'closed')}>{language.chatGenerationTogglePresetBack}</Button>
      </div>
    {:else if pickStage === 'preset' && pickedSource}
      <div data-risu-toggle-preset-pick-presets>
        {#each pickPresets as preset (preset.id)}
          {@const reasons = ineligibilityReasons(preset, pickedSource)}
          <button
            type="button"
            class="w-full p-2 text-left border-t border-darkborderc hover:bg-gray-600 disabled:opacity-50"
            data-risu-toggle-preset-pick-row
            data-risu-row-id={preset.id}
            data-risu-ineligible-reason={reasons.join('; ')}
            disabled={reasons.length > 0 || persistenceStatus === 'pending'}
            onclick={() => pickPreset(preset)}>
            <span class="block">{preset.name}</span>
            {#each reasons as reason}
              <span class="block text-xs text-draculared">{reason}</span>
            {/each}
          </button>
        {/each}
      </div>
      <div class="mt-3">
        <Button size="sm" onclick={() => (pickStage = 'source')}>{language.chatGenerationTogglePresetBack}</Button>
      </div>
    {:else}
      <div data-risu-toggle-preset-rows>
        {#if presets.length === 0}
          <span class="text-textcolor2 text-sm">{language.chatGenerationTogglePresetNoPresets}</span>
        {/if}
        {#each presets as preset (preset.id)}
          <div
            class="flex items-center text-textcolor border-t border-darkborderc p-2 cursor-pointer"
            class:bg-selected={preset.id === loadedPresetId}
            data-risu-toggle-preset-row
            data-risu-row-id={preset.id}
            data-risu-selected={preset.id === loadedPresetId ? 'true' : 'false'}
            onclick={() => {
              if (!editMode) selectPreset(preset.id)
            }}>
            {#if editMode}
              <div class="min-w-0 grow">
                <TextInput
                  bind:value={() => preset.name, (value) => renamePreset(preset, value)}
                  ariaLabel={`${language.edit}: ${preset.name}`}
                  padding={false} />
              </div>
            {:else}
              <button
                type="button"
                class="flex min-w-0 grow items-center text-left"
                data-risu-toggle-preset-select
                disabled={persistenceStatus === 'pending'}
                aria-pressed={preset.id === loadedPresetId}
                onclick={(event) => {
                  event.stopPropagation()
                  selectPreset(preset.id)
                }}>{preset.name}</button>
            {/if}
            <button
              class="text-textcolor2 hover:text-red-500 cursor-pointer ml-2"
              aria-label={`${language.remove}: ${preset.name}`}
              onclick={(event) => {
                event.stopPropagation()
                removePreset(preset)
              }}>
              <TrashIcon size={18} />
            </button>
          </div>
        {/each}
      </div>

      <div class="flex mt-2 items-center">
        <button
          class="text-textcolor2 hover:text-green-500 cursor-pointer"
          class:text-textcolor={editMode}
          data-risu-toggle-preset-edit
          aria-label={`${language.edit}: ${language.chatGenerationTogglePresetDialogTitle}`}
          aria-pressed={editMode}
          onclick={() => (editMode = !editMode)}><PencilIcon size={18} /></button>
      </div>

      <div class="grid grid-cols-4 gap-1 mt-4" data-risu-toggle-preset-actions>
        <Button size="sm" onclick={savePreset} disabled={saveDisabled}
          >{language.chatGenerationTogglePresetSave}</Button>
        <Button size="sm" onclick={applyPreset} disabled={applyDisabled}
          >{language.chatGenerationTogglePresetApply}</Button>
        <Button size="sm" onclick={unselectPreset} disabled={!loadedPresetId || persistenceStatus === 'pending'}>
          {language.chatGenerationTogglePresetUnselect}
        </Button>
        <Button size="sm" onclick={beginPick} disabled={sources.length === 0 || presets.length === 0}>
          {language.chatGenerationTogglePresetPick}
        </Button>
      </div>
    {/if}
  </div>
</div>

<style>
  .break-any {
    word-break: normal;
    overflow-wrap: anywhere;
  }

  .toggle-preset-modal {
    width: 31rem;
    max-width: min(48rem, calc(100vw - 2rem));
  }
</style>
