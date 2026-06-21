<script lang="ts">
  import { RotateCcwIcon } from '@lucide/svelte'
  import { language } from 'src/lang'
  import { alertConfirm } from 'src/ts/alert'
  import {
    resolveActiveChatGenerationSettings,
    saveActiveChatGenerationSettingsDefaultValues,
  } from 'src/ts/activeChatGenerationSettings'
  import { selectedCharID } from 'src/ts/stores.svelte'
  import Button from '../UI/GUI/Button.svelte'

  let activeGenerationSettings = $derived.by(() =>
    resolveActiveChatGenerationSettings({
      selectedCharIndex: $selectedCharID,
    }),
  )

  async function resetDefaultValues(): Promise<void> {
    if (!(await alertConfirm(language.chatGenerationResetDefaultsConfirm))) return
    saveActiveChatGenerationSettingsDefaultValues()
  }
</script>

<div class="w-full mt-2" data-risu-generation-reset-defaults data-risu-picker-mode="active-chat-generation-settings">
  <Button
    className="flex w-full min-w-0 justify-start text-left"
    onclick={resetDefaultValues}
    disabled={!activeGenerationSettings.identity.chatId}>
    <div class="flex items-center gap-2 min-w-0">
      <RotateCcwIcon size={16} />
      <span class="truncate">{language.chatGenerationResetDefaults}</span>
    </div>
  </Button>
</div>
