<script lang="ts">
  import { ArrowUpRight } from '@lucide/svelte'
  import { openPersonaListModal, openPresetListModal, selectedCharID } from 'src/ts/stores.svelte'
  import { language } from 'src/lang'
  import { alertError, alertNormal } from 'src/ts/alert'
  import {
    activeChatModelPresetRecommendationState,
    resolveActiveChatGenerationSettings,
    saveActiveChatGenerationSettingsSelectionWithOutcome,
  } from 'src/ts/activeChatGenerationSettings'
  import { captureActiveChatTarget } from 'src/ts/chatCommands'
  import { openSettingsRoute, personaSettingsRoutePath } from 'src/ts/router'
  import Button from '../UI/GUI/Button.svelte'
  import SelectInput from '../UI/GUI/SelectInput.svelte'

  type NamedGenerationReference = {
    id?: string
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

  let modelPresetRecommendationState = $derived(activeChatModelPresetRecommendationState(activeGenerationSettings))
  let modelPresetRecommendationMismatch = $derived(modelPresetRecommendationState === 'mismatch')
  let recommendedModelPresetName = $derived.by(() => {
    const recommendedModelPresetId = activeGenerationSettings.promptPreset?.recommendedModelPresetId
    if (typeof recommendedModelPresetId !== 'string' || recommendedModelPresetId.trim().length === 0) return ''
    const preset = activeGenerationSettings.db.modelPresets?.find(
      (candidate) => candidate.id === recommendedModelPresetId,
    )
    return preset?.name?.trim() || recommendedModelPresetId
  })

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

  let personaId = $derived.by(() => {
    const id = (activeGenerationSettings.persona as NamedGenerationReference | undefined)?.id
    return typeof id === 'string' && id.trim().length > 0 ? id : ''
  })

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
    data-risu-picker-selected-id={activeGenerationSettings.settings?.modelPresetId ?? ''}
    data-risu-model-preset-recommendation-state={modelPresetRecommendationState}
    class:bg-red-900={modelPresetRecommendationMismatch}
    class:rounded-sm={modelPresetRecommendationMismatch}>
    <Button
      className="flex w-full min-w-0 justify-start text-left"
      ariaLabel={modelPresetRecommendationMismatch
        ? language.chatGenerationModelPresetRecommendationMismatch(recommendedModelPresetName)
        : modelPresetName}
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
    <div class="flex w-full min-w-0 items-stretch gap-1">
      <Button
        className="flex min-w-0 flex-1 justify-start text-left"
        onclick={() => {
          openPersonaListModal('active-chat-generation-settings', captureActiveChatTarget())
        }}>
        <div class="flex-1 flex-col flex text-left min-w-0">
          <span class="truncate">{personaName}</span>
        </div>
      </Button>
      {#if personaId}
        <div class="flex shrink-0" data-risu-generation-picker-persona-settings>
          <Button
            size="sm"
            className="flex h-full items-center justify-center"
            ariaLabel={`${language.edit} ${personaName}`}
            onclick={() => {
              openSettingsRoute(personaSettingsRoutePath(personaId))
            }}>
            <ArrowUpRight aria-hidden="true" size={18} />
          </Button>
        </div>
      {/if}
    </div>
    {#if personaNote}
      <div class="mt-1 flex flex-col gap-0.5 rounded-md border border-darkborderc bg-darkbg/50 px-2 py-1.5">
        <span class="text-xs font-medium text-textcolor2">{language.personaNote}</span>
        <span class="text-xs whitespace-pre-wrap break-words" data-risu-generation-picker-persona-note
          >{personaNote}</span>
      </div>
    {/if}
  </div>
</div>
