<script lang="ts">
  import { openPersonaListModal, openPresetListModal, selectedCharID } from 'src/ts/stores.svelte'
  import { language } from 'src/lang'
  import { alertError, alertNormal } from 'src/ts/alert'
  import {
    resolveActiveChatGenerationSettings,
    saveActiveChatGenerationSettingsSelectionWithOutcome,
  } from 'src/ts/activeChatGenerationSettings'
  import { captureActiveChatTarget } from 'src/ts/chatCommands'
  import Button from '../UI/GUI/Button.svelte'
  import SelectInput from '../UI/GUI/SelectInput.svelte'

  type NamedGenerationReference = {
    name?: string
    note?: string
  }

  let activeGenerationSettings = $derived.by(() =>
    resolveActiveChatGenerationSettings({
      selectedCharIndex: $selectedCharID,
    }),
  )

  let modelPresetName = $derived.by(
    () =>
      (activeGenerationSettings.modelPreset as NamedGenerationReference | undefined)?.name ||
      language.chatGenerationModelPresetUnconfigured,
  )

  let promptPresetName = $derived.by(
    () =>
      (activeGenerationSettings.promptPreset as NamedGenerationReference | undefined)?.name ||
      language.chatGenerationPromptPresetUnconfigured,
  )

  let personaName = $derived.by(
    () =>
      (activeGenerationSettings.persona as NamedGenerationReference | undefined)?.name ||
      language.chatGenerationPersonaUnconfigured,
  )

  let personaNote = $derived.by(() => {
    const note = (activeGenerationSettings.persona as NamedGenerationReference | undefined)?.note
    return typeof note === 'string' && note.trim().length > 0 ? note : ''
  })

  let agentPresets = $derived(
    Array.isArray(activeGenerationSettings.db.agentPresets) ? activeGenerationSettings.db.agentPresets : [],
  )
  let selectedAgentPresetId = $derived(activeGenerationSettings.effectiveAgentPresetId ?? '')
  let selectedAgentPresetMissing = $derived(!!selectedAgentPresetId && !activeGenerationSettings.agentPreset)
  let agentPresetSaveOperation = 0
  let agentPresetSaveStates = $state<Record<string, { operation: number; status: 'pending' | 'queued' | 'failed' }>>({})
  let agentPresetSaveStatus = $derived(
    (activeGenerationSettings.identity.chatId &&
      agentPresetSaveStates[activeGenerationSettings.identity.chatId]?.status) ||
      'idle',
  )
  let agentPresetName = $derived.by(() => {
    const name = (activeGenerationSettings.agentPreset as NamedGenerationReference | undefined)?.name
    if (name && name.trim().length > 0) return name
    return selectedAgentPresetMissing ? language.agentPresets.missingSelectedShort : language.agentPresets.noSelected
  })

  async function saveAgentPresetSelection(agentPresetId: string): Promise<void> {
    const target = captureActiveChatTarget()
    const chatId = target?.chatId
    if (!chatId) return
    const operation = ++agentPresetSaveOperation
    agentPresetSaveStates[chatId] = { operation, status: 'pending' }
    const persistence = saveActiveChatGenerationSettingsSelectionWithOutcome(
      { agentPresetId },
      {
        expectedTarget: target,
      },
    )
    if (!persistence) {
      if (agentPresetSaveStates[chatId]?.operation === operation) delete agentPresetSaveStates[chatId]
      return
    }
    const result = await persistence.settlement
    if (agentPresetSaveStates[chatId]?.operation !== operation) return
    if (result.status === 'accepted') {
      delete agentPresetSaveStates[chatId]
    } else {
      agentPresetSaveStates[chatId].status = result.status
    }
    if (result.status === 'queued') {
      alertNormal(language.settingsSaveQueued)
    } else if (result.status === 'failed') {
      alertError(language.chatGenerationSettingsSaveFailed(result.error))
    }
  }
</script>

<div
  class="rounded-sm flex flex-col w-full gap-2"
  data-risu-generation-settings-picker-controls
  data-risu-picker-mode="active-chat-generation-settings">
  <div
    data-risu-generation-picker-control
    data-risu-picker-kind="model"
    data-risu-picker-mode="active-chat-generation-settings"
    data-risu-picker-selected-id={activeGenerationSettings.settings?.modelPresetId ?? ''}>
    <Button
      className="flex w-full min-w-0 justify-start text-left"
      onclick={() => {
        openPresetListModal('active-chat-generation-settings', 'model', captureActiveChatTarget())
      }}>
      <div class="flex-1 flex-col flex text-left min-w-0">
        <span class="truncate">{modelPresetName}</span>
      </div>
    </Button>
  </div>

  <div
    data-risu-generation-picker-control
    data-risu-picker-kind="prompt"
    data-risu-picker-mode="active-chat-generation-settings"
    data-risu-picker-selected-id={activeGenerationSettings.settings?.promptPresetId ?? ''}>
    <Button
      className="flex w-full min-w-0 justify-start text-left"
      onclick={() => {
        openPresetListModal('active-chat-generation-settings', 'prompt', captureActiveChatTarget())
      }}>
      <div class="flex-1 flex-col flex text-left min-w-0">
        <span class="truncate">{promptPresetName}</span>
      </div>
    </Button>
  </div>

  <div
    data-risu-generation-picker-control
    data-risu-picker-kind="agent-preset"
    data-risu-picker-mode="active-chat-generation-settings"
    data-risu-persistence-status={agentPresetSaveStatus}
    data-risu-picker-selected-id={selectedAgentPresetId}>
    <label class="flex w-full min-w-0 flex-col gap-1 text-left text-sm">
      <span class="text-xs font-medium text-textcolor2">{language.agentPresets.chatSelectionLabel}</span>
      <SelectInput
        value={selectedAgentPresetId}
        className="w-full"
        disabled={agentPresetSaveStatus === 'pending'}
        onchange={(event) => {
          void saveAgentPresetSelection(event.currentTarget.value)
        }}>
        <option value="">{language.agentPresets.noSelected}</option>
        {#if selectedAgentPresetMissing}
          <option value={selectedAgentPresetId}>{language.agentPresets.missingSelected(selectedAgentPresetId)}</option>
        {/if}
        {#each agentPresets as preset (preset.id)}
          <option value={preset.id}>{preset.name}</option>
        {/each}
      </SelectInput>
      <span class="truncate text-xs text-textcolor2">{agentPresetName}</span>
      {#if selectedAgentPresetMissing}
        <span class="text-xs text-draculared" data-risu-generation-picker-agent-preset-error>
          {language.agentPresets.missingSelected(selectedAgentPresetId)}
        </span>
      {/if}
    </label>
  </div>

  <div
    data-risu-generation-picker-control
    data-risu-picker-kind="persona"
    data-risu-picker-mode="active-chat-generation-settings"
    data-risu-picker-selected-id={activeGenerationSettings.settings?.personaId ?? ''}>
    <Button
      className="flex w-full min-w-0 justify-start text-left"
      onclick={() => {
        openPersonaListModal('active-chat-generation-settings', captureActiveChatTarget())
      }}>
      <div class="flex-1 flex-col flex text-left min-w-0">
        <span class="truncate">{personaName}</span>
      </div>
    </Button>
    {#if personaNote}
      <span class="mt-1 text-sm opacity-75 whitespace-pre-wrap break-words" data-risu-generation-picker-persona-note
        >{personaNote}</span>
    {/if}
  </div>
</div>
