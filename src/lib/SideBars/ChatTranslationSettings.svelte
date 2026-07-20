<script lang="ts">
  import { language } from 'src/lang'
  import { alertError, alertNormal } from 'src/ts/alert'
  import { setCurrentChatTranslationSettingWithOutcome, type ChatTranslationSettingField } from 'src/ts/chatCommands'
  import { getDatabase } from 'src/ts/storage/database.svelte'
  import { selectedCharID } from 'src/ts/stores.svelte'
  import CheckInput from '../UI/GUI/CheckInput.svelte'

  type PersistenceStatus = 'pending' | 'queued' | 'failed'

  let saveOperation = 0
  let saveStates = $state<
    Partial<Record<ChatTranslationSettingField, { operation: number; status: PersistenceStatus }>>
  >({})
  let currentChat = $derived.by(() => {
    const character = getDatabase().characters?.[$selectedCharID]
    return character?.chats?.[character.chatPage]
  })

  function persistenceStatus(field: ChatTranslationSettingField): PersistenceStatus | 'idle' {
    return saveStates[field]?.status ?? 'idle'
  }

  async function saveSetting(field: ChatTranslationSettingField, value: boolean): Promise<void> {
    if (saveStates[field]?.status === 'pending') return
    const operation = ++saveOperation
    saveStates[field] = { operation, status: 'pending' }
    const persistence = setCurrentChatTranslationSettingWithOutcome(field, value)
    if (!persistence) {
      if (saveStates[field]?.operation === operation) delete saveStates[field]
      return
    }

    const outcome = await persistence
    if (saveStates[field]?.operation !== operation) return
    if (outcome.status === 'accepted') {
      delete saveStates[field]
      return
    }
    if (outcome.status === 'failed') {
      saveStates[field]!.status = 'failed'
      alertError(language.messageMutationFailed)
      return
    }

    saveStates[field]!.status = 'queued'
    alertNormal(language.settingsSaveQueued)
    void outcome.settlement.then((settled) => {
      if (saveStates[field]?.operation !== operation) return
      if (settled.status === 'accepted') {
        delete saveStates[field]
      } else {
        saveStates[field]!.status = 'failed'
        alertError(language.messageMutationFailed)
      }
    })
  }
</script>

{#snippet setting(field: ChatTranslationSettingField, label: string)}
  <div
    class="flex w-full items-center gap-2"
    data-risu-chat-translation-setting={field}
    data-risu-persistence-status={persistenceStatus(field)}
    aria-busy={persistenceStatus(field) === 'pending'}>
    <CheckInput
      check={currentChat?.[field] === true}
      name={label}
      disabled={!currentChat || persistenceStatus(field) === 'pending'}
      onChange={(value) => void saveSetting(field, value)} />
    {#if persistenceStatus(field) === 'queued' || persistenceStatus(field) === 'failed'}
      <span class="text-xs text-textcolor2" role="status">
        {persistenceStatus(field) === 'queued' ? language.mutationStatusQueued : language.mutationStatusFailed}
      </span>
    {/if}
  </div>
{/snippet}

{#if getDatabase().translator !== ''}
  <div class="mt-2 flex w-full flex-col gap-2" data-risu-chat-translation-settings>
    {@render setting('autoTranslate', language.autoTranslation)}
    {@render setting('autoTranslateBotOnly', language.autoTranslateBotOnly)}
    {@render setting('bilingualDisplay', language.bilingualDisplay)}
  </div>
{/if}
