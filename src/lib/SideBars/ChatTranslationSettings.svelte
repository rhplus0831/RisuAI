<script module lang="ts">
  import { getCanonicalTranslatorPresets, type TranslatorPreset } from '@risuai/shared-core/translator-presets'

  export interface ChatTranslationSettingsOwner {
    translatorPresetId?: string
    autoTranslate?: boolean
    autoTranslateBotOnly?: boolean
    bilingualDisplay?: boolean
    bilingualEmphasis?: 'original' | 'translation'
  }

  export interface TranslatorLanguageSettingsOwner {
    translator: string
    translatorType: string
    translatorPresetId?: string
  }

  function hasOwn(value: Readonly<Record<string, unknown>>, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(value, key)
  }

  export function resolveChatTranslationSettingsOwner(
    metadata: Readonly<Record<string, unknown>> | undefined,
  ): ChatTranslationSettingsOwner | undefined {
    if (!metadata) return undefined

    const translatorPresetId = metadata.translatorPresetId
    if (
      hasOwn(metadata, 'translatorPresetId') &&
      (typeof translatorPresetId !== 'string' || translatorPresetId.trim().length === 0)
    ) {
      return undefined
    }

    for (const key of ['autoTranslate', 'autoTranslateBotOnly', 'bilingualDisplay'] as const) {
      if (hasOwn(metadata, key) && typeof metadata[key] !== 'boolean') return undefined
    }

    const bilingualEmphasis = metadata.bilingualEmphasis
    if (
      hasOwn(metadata, 'bilingualEmphasis') &&
      bilingualEmphasis !== 'original' &&
      bilingualEmphasis !== 'translation'
    ) {
      return undefined
    }

    return {
      ...(typeof translatorPresetId === 'string' ? { translatorPresetId } : {}),
      ...(typeof metadata.autoTranslate === 'boolean' ? { autoTranslate: metadata.autoTranslate } : {}),
      ...(typeof metadata.autoTranslateBotOnly === 'boolean'
        ? { autoTranslateBotOnly: metadata.autoTranslateBotOnly }
        : {}),
      ...(typeof metadata.bilingualDisplay === 'boolean' ? { bilingualDisplay: metadata.bilingualDisplay } : {}),
      ...(bilingualEmphasis === 'original' || bilingualEmphasis === 'translation' ? { bilingualEmphasis } : {}),
    }
  }

  export function resolveTranslatorLanguageSettingsOwner(
    status: string,
    settings: Readonly<Record<string, unknown>>,
  ): TranslatorLanguageSettingsOwner | undefined {
    if (status !== 'ready' || typeof settings.translator !== 'string' || typeof settings.translatorType !== 'string') {
      return undefined
    }
    const translatorPresetId = settings.translatorPresetId
    if (
      translatorPresetId !== undefined &&
      translatorPresetId !== null &&
      (typeof translatorPresetId !== 'string' || translatorPresetId.trim().length === 0)
    ) {
      return undefined
    }
    return {
      translator: settings.translator,
      translatorType: settings.translatorType,
      ...(typeof translatorPresetId === 'string' ? { translatorPresetId } : {}),
    }
  }

  export function resolveTranslatorPresetCollectionOwner(
    status: string,
    presets: unknown,
  ): TranslatorPreset[] | undefined {
    if (status !== 'ready') return undefined
    return (
      getCanonicalTranslatorPresets({ translatorPresets: Array.isArray(presets) ? presets : undefined }) ?? undefined
    )
  }

  export function resolveGlobalTranslatorPresetOwner(
    presets: readonly TranslatorPreset[] | undefined,
    selectedId: string | undefined,
  ): TranslatorPreset | undefined {
    if (!presets || !selectedId) return undefined
    const matches = presets.filter((preset) => preset.id === selectedId)
    return matches.length === 1 ? matches[0] : undefined
  }
</script>

<script lang="ts">
  import { language } from 'src/lang'
  import { alertError, alertNormal } from 'src/ts/alert'
  import {
    setCurrentChatTranslationSettingWithOutcome,
    type ChatTranslationSettingField,
    type ChatTranslationSettingValueByField,
  } from 'src/ts/chatCommands'
  import { getSelectedCharacterOwner } from 'src/ts/characterState'
  import {
    charactersResourceState,
    collectionsResourceState,
    getChatMetadataOwnerSnapshot,
    settingsResourceState,
  } from 'src/ts/server/resourceState.svelte'
  import CheckInput from '../UI/GUI/CheckInput.svelte'
  import OptionInput from '../UI/GUI/OptionInput.svelte'
  import SelectInput from '../UI/GUI/SelectInput.svelte'

  type PersistenceStatus = 'pending' | 'queued' | 'failed'
  type BooleanChatTranslationSettingField = Exclude<
    ChatTranslationSettingField,
    'bilingualEmphasis' | 'translatorPresetId'
  >

  let saveOperation = 0
  let saveStates = $state<
    Partial<Record<ChatTranslationSettingField, { operation: number; status: PersistenceStatus }>>
  >({})
  let currentChatSelection = $derived.by(() => {
    if (charactersResourceState.status !== 'ready') return undefined
    const character = getSelectedCharacterOwner()
    const selectedCharacter = charactersResourceState.currentChar
    const selectedChat = character?.chatPage
    const characterId = character?.chaId
    if (
      typeof characterId !== 'string' ||
      characterId.trim().length === 0 ||
      !Number.isInteger(selectedCharacter) ||
      !Number.isInteger(selectedChat)
    ) {
      return undefined
    }
    const chat = character.chats?.[selectedChat]
    const chatId = chat?.id
    if (typeof chatId !== 'string' || chatId.trim().length === 0) return undefined

    let matchingChatOwners = 0
    for (const candidate of charactersResourceState.characters) {
      for (const candidateChat of candidate.chats ?? []) {
        if (candidateChat?.id === chatId) matchingChatOwners += 1
      }
    }
    if (matchingChatOwners !== 1) return undefined

    // Track optional metadata fields directly so adding or deleting one
    // invalidates the projected snapshot even when it was previously absent.
    void chat.translatorPresetId
    void chat.autoTranslate
    void chat.autoTranslateBotOnly
    void chat.bilingualDisplay
    void chat.bilingualEmphasis
    const metadata = resolveChatTranslationSettingsOwner(getChatMetadataOwnerSnapshot(characterId, chatId)?.metadata)
    if (!metadata) return undefined
    return { characterId, chatId, selectedCharacter, selectedChat, metadata }
  })
  let currentChat = $derived(currentChatSelection?.metadata)
  let translatorSettings = $derived(
    resolveTranslatorLanguageSettingsOwner(
      settingsResourceState.groupStatuses.language ?? 'idle',
      settingsResourceState.value as Readonly<Record<string, unknown>>,
    ),
  )
  let translatorPresets = $derived(
    resolveTranslatorPresetCollectionOwner(
      collectionsResourceState.statuses.translatorPresets ?? 'idle',
      collectionsResourceState.values.translatorPresets,
    ),
  )
  let globalTranslatorPreset = $derived(
    resolveGlobalTranslatorPresetOwner(translatorPresets, translatorSettings?.translatorPresetId),
  )

  function persistenceStatus(field: ChatTranslationSettingField): PersistenceStatus | 'idle' {
    return saveStates[field]?.status ?? 'idle'
  }

  function globalTranslatorPresetName(): string {
    return globalTranslatorPreset?.name ?? language.presets
  }

  function translatorPresetExists(presetId: string | undefined): boolean {
    return !!presetId && !!translatorPresets?.some((preset) => preset.id === presetId)
  }

  async function saveSetting<Field extends ChatTranslationSettingField>(
    field: Field,
    value: ChatTranslationSettingValueByField[Field],
  ): Promise<void> {
    if (!currentChatSelection || saveStates[field]?.status === 'pending') return
    if (field === 'translatorPresetId' && value !== null) {
      if (
        typeof value !== 'string' ||
        !translatorPresets ||
        !globalTranslatorPreset ||
        !translatorPresetExists(value)
      ) {
        return
      }
    }
    const operation = ++saveOperation
    saveStates[field] = { operation, status: 'pending' }
    const persistence = setCurrentChatTranslationSettingWithOutcome(field, value)
    if (!persistence) {
      if (saveStates[field]?.operation === operation) saveStates[field]!.status = 'failed'
      alertError(language.messageMutationFailed)
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

{#snippet persistenceMessage(field: ChatTranslationSettingField)}
  {#if persistenceStatus(field) === 'failed'}
    <span class="text-xs text-textcolor2" role="status">
      {language.mutationStatusFailed}
    </span>
  {/if}
{/snippet}

{#snippet setting(field: BooleanChatTranslationSettingField, label: string)}
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
    {@render persistenceMessage(field)}
  </div>
{/snippet}

{#if translatorSettings && translatorSettings.translator !== ''}
  <div class="mt-2 flex w-full flex-col gap-2" data-risu-chat-translation-settings>
    {#if translatorSettings?.translatorType === 'llm'}
      <div
        class="flex w-full items-end gap-2"
        data-risu-chat-translation-setting="translatorPresetId"
        data-risu-persistence-status={persistenceStatus('translatorPresetId')}
        aria-busy={persistenceStatus('translatorPresetId') === 'pending'}>
        <label class="flex min-w-0 flex-1 flex-col gap-1 text-left text-sm">
          <span class="text-xs font-medium text-textcolor2">{language.translatorPreset}</span>
          <SelectInput
            value={currentChat?.translatorPresetId ?? ''}
            className="w-full"
            ariaLabel={language.translatorPreset}
            disabled={!currentChat ||
              !translatorPresets ||
              !globalTranslatorPreset ||
              persistenceStatus('translatorPresetId') === 'pending'}
            onchange={(event) => void saveSetting('translatorPresetId', event.currentTarget.value || null)}>
            <OptionInput value="">{language.useGlobalSettings} ({globalTranslatorPresetName()})</OptionInput>
            {#if currentChat?.translatorPresetId && !translatorPresetExists(currentChat.translatorPresetId)}
              <OptionInput value={currentChat.translatorPresetId}>
                {language.translatorPresetUnavailable(currentChat.translatorPresetId)}
              </OptionInput>
            {/if}
            {#each translatorPresets ?? [] as preset}
              {#if preset.id}
                <OptionInput value={preset.id}>{preset.name}</OptionInput>
              {/if}
            {/each}
          </SelectInput>
        </label>
        {@render persistenceMessage('translatorPresetId')}
      </div>
    {/if}
    {@render setting('autoTranslate', language.autoTranslation)}
    {@render setting('autoTranslateBotOnly', language.autoTranslateBotOnly)}
    {@render setting('bilingualDisplay', language.bilingualDisplay)}
    {#if currentChat?.bilingualDisplay === true}
      <div
        class="flex w-full items-end gap-2"
        data-risu-chat-translation-setting="bilingualEmphasis"
        data-risu-persistence-status={persistenceStatus('bilingualEmphasis')}
        aria-busy={persistenceStatus('bilingualEmphasis') === 'pending'}>
        <label class="flex min-w-0 flex-1 flex-col gap-1 text-left text-sm">
          <span class="text-xs font-medium text-textcolor2">{language.bilingualEmphasis}</span>
          <SelectInput
            value={currentChat.bilingualEmphasis ?? 'original'}
            className="w-full"
            disabled={persistenceStatus('bilingualEmphasis') === 'pending'}
            onchange={(event) => {
              const value = event.currentTarget.value
              if (value === 'original' || value === 'translation') {
                void saveSetting('bilingualEmphasis', value)
              }
            }}>
            <OptionInput value="original">{language.bilingualEmphasisOriginal}</OptionInput>
            <OptionInput value="translation">{language.bilingualEmphasisTranslation}</OptionInput>
          </SelectInput>
        </label>
        {@render persistenceMessage('bilingualEmphasis')}
      </div>
    {/if}
  </div>
{/if}
