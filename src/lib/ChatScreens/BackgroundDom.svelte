<script lang="ts">
  import { untrack } from 'svelte'
  import { ParseMarkdown, risuChatParser } from 'src/ts/parser/parser.svelte'
  import { getSelectedCharacterOwner, selectCharacterOwner } from 'src/ts/characterState'
  import { charactersResourceState, getChatMetadataOwnerState } from 'src/ts/server/resourceState.svelte'
  import type { character } from 'src/ts/storage/database.svelte'
  import {
    moduleBackgroundEmbedding,
    ReloadGUIPointer,
    selIdState,
    VariableReloadGUIPointer,
  } from 'src/ts/stores.svelte'
  import {
    RegexDisplayReloadPointer,
    RegexDisplayReloadScope,
    regexDisplayReloadTokenForContext,
  } from 'src/ts/process/regexDisplayReload'

  interface BackgroundParseInput {
    characterId: string
    ownerKey: string
    characterKey: string
    html: string
    moduleEmbedding: string
    reloadKey: string
  }

  function stableId(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0
  }

  function selectedBackgroundCharacterOwner(): character | undefined {
    const status = charactersResourceState.status
    if (status === 'ready') {
      const owner = getSelectedCharacterOwner()
      if (!stableId(owner?.chaId) || charactersResourceState.rowStatuses[owner.chaId] === 'error') return undefined
      return owner
    }
    if (status !== 'idle' && status !== 'loading') return undefined

    const owner = getSelectedCharacterOwner()
    if (stableId(owner?.chaId) && charactersResourceState.rowStatuses[owner.chaId] !== 'error') return owner
    const compatibilityOwner = selectCharacterOwner(charactersResourceState.characters, selIdState.selId)
    if (
      stableId(compatibilityOwner?.chaId) &&
      charactersResourceState.rowStatuses[compatibilityOwner.chaId] !== 'error'
    ) {
      return compatibilityOwner
    }
    return undefined
  }

  function selectedBackgroundChatId(selectedCharacter: character | undefined): string | undefined {
    const chatId = selectedCharacter?.chats?.[selectedCharacter.chatPage]?.id
    if (!stableId(chatId)) return undefined
    return getChatMetadataOwnerState(chatId)?.chatId === chatId ? chatId : undefined
  }

  function backgroundCharacterSignature(selectedCharacter: character | undefined) {
    if (!selectedCharacter) return ''

    return JSON.stringify({
      chaId: selectedCharacter.chaId,
      name: selectedCharacter.name ?? '',
      nickname: selectedCharacter.nickname ?? '',
      desc: selectedCharacter.desc ?? '',
      personality: selectedCharacter.personality ?? '',
      scenario: selectedCharacter.scenario ?? '',
      exampleMessage: selectedCharacter.exampleMessage ?? '',
      additionalAssets: selectedCharacter.additionalAssets ?? [],
      emotionImages: selectedCharacter.emotionImages ?? [],
    })
  }

  let backgroundHTML = $state('')
  let backgroundCharacterKey = $state('')
  let selectedCharacter = $derived(selectedBackgroundCharacterOwner())
  let selectedChatId = $derived(selectedBackgroundChatId(selectedCharacter))

  $effect(() => {
    const nextHTML = selectedCharacter?.backgroundHTML ?? ''
    const nextCharacterKey = backgroundCharacterSignature(selectedCharacter)

    if (backgroundHTML !== nextHTML) {
      backgroundHTML = nextHTML
    }
    if (backgroundCharacterKey !== nextCharacterKey) {
      backgroundCharacterKey = nextCharacterKey
    }
  })

  let moduleEmbedding = $derived($moduleBackgroundEmbedding ?? '')
  let regexDisplayReloadToken = $derived(
    regexDisplayReloadTokenForContext($RegexDisplayReloadPointer, $RegexDisplayReloadScope, {
      characterId: selectedCharacter?.chaId,
      chatId: selectedChatId,
    }),
  )
  let backgroundReloadKey = $derived(`${$ReloadGUIPointer}|${$VariableReloadGUIPointer}|${regexDisplayReloadToken}`)
  let backgroundOwner = $derived(selectedCharacter?.chaId ?? '')
  let backgroundParseInput: BackgroundParseInput = $derived({
    characterId: selectedCharacter?.chaId ?? '',
    ownerKey: backgroundOwner,
    characterKey: backgroundCharacterKey,
    html: backgroundHTML,
    moduleEmbedding,
    reloadKey: backgroundReloadKey,
  })

  let latestBackgroundParseInput: BackgroundParseInput | undefined
  let retainedBackground = $state('')
  let retainedBackgroundOwner = $state('')

  function parseBackground(input: BackgroundParseInput): Promise<string> {
    latestBackgroundParseInput = input
    return untrack(() => {
      const currentChar = selectedCharacter
      const source = (input.html || '') + '\n' + (input.moduleEmbedding || '')
      return ParseMarkdown(risuChatParser(source, { chara: currentChar }), currentChar, 'back')
    }).then((parsed) => {
      if (latestBackgroundParseInput === input) {
        retainedBackground = parsed
        retainedBackgroundOwner = input.ownerKey
      }
      return parsed
    })
  }

  let parsedBackground = $derived.by(() => {
    const input = backgroundParseInput
    if (!input.characterId || (!input.html && !input.moduleEmbedding)) {
      latestBackgroundParseInput = input
      return Promise.resolve('')
    }
    return parseBackground(input)
  })
  let pendingBackground = $derived(backgroundParseInput.ownerKey === retainedBackgroundOwner ? retainedBackground : '')
</script>

{#if backgroundParseInput.html || backgroundParseInput.moduleEmbedding}
  {#if backgroundParseInput.characterId}
    <div class="absolute top-0 left-0 w-full h-full">
      {#await parsedBackground}
        {@html pendingBackground}
      {:then md}
        {@html md}
      {/await}
    </div>
  {/if}
{/if}
