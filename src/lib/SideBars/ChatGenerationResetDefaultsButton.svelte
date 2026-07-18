<script lang="ts">
  import { RotateCcwIcon } from '@lucide/svelte'
  import { language } from 'src/lang'
  import { alertConfirm, alertError, alertNormal } from 'src/ts/alert'
  import {
    resolveActiveChatGenerationSettings,
    saveActiveChatGenerationSettingsDefaultValuesWithOutcome,
  } from 'src/ts/activeChatGenerationSettings'
  import { captureActiveChatTarget } from 'src/ts/chatCommands'
  import { selectedCharID } from 'src/ts/stores.svelte'
  import Button from '../UI/GUI/Button.svelte'

  let activeGenerationSettings = $derived.by(() =>
    resolveActiveChatGenerationSettings({
      selectedCharIndex: $selectedCharID,
    }),
  )
  let resetOperation = 0
  let resetSaveStates = $state<Record<string, { operation: number; status: 'pending' | 'queued' | 'failed' }>>({})
  let resetSaveStatus = $derived(
    (activeGenerationSettings.identity.chatId && resetSaveStates[activeGenerationSettings.identity.chatId]?.status) ||
      'idle',
  )

  async function resetDefaultValues(): Promise<void> {
    const target = captureActiveChatTarget()
    if (!(await alertConfirm(language.chatGenerationResetDefaultsConfirm))) return
    const chatId = target?.chatId
    if (!chatId) return
    const operation = ++resetOperation
    resetSaveStates[chatId] = { operation, status: 'pending' }
    const persistence = saveActiveChatGenerationSettingsDefaultValuesWithOutcome({ expectedTarget: target })
    if (!persistence) {
      if (resetSaveStates[chatId]?.operation === operation) delete resetSaveStates[chatId]
      return
    }
    const result = await persistence.settlement
    if (resetSaveStates[chatId]?.operation !== operation) return
    if (result.status === 'accepted') {
      delete resetSaveStates[chatId]
    } else {
      resetSaveStates[chatId].status = result.status
    }
    if (result.status === 'queued') {
      alertNormal(language.settingsSaveQueued)
    } else if (result.status === 'failed') {
      alertError(language.chatGenerationSettingsSaveFailed(result.error))
    }
  }
</script>

<div
  class="w-full mt-2"
  data-risu-generation-reset-defaults
  data-risu-picker-mode="active-chat-generation-settings"
  data-risu-persistence-status={resetSaveStatus}>
  <Button
    className="flex w-full min-w-0 justify-start text-left"
    onclick={resetDefaultValues}
    disabled={!activeGenerationSettings.identity.chatId || resetSaveStatus === 'pending'}>
    <div class="flex items-center gap-2 min-w-0">
      <RotateCcwIcon size={16} />
      <span class="truncate">{language.chatGenerationResetDefaults}</span>
    </div>
  </Button>
</div>
