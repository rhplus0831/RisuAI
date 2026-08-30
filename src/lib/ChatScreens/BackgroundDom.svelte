<script lang="ts">
  import { untrack } from 'svelte'
  import { ParseMarkdown, risuChatParser } from 'src/ts/parser/parser.svelte'
  import { getSelectedCharacterOwner } from 'src/ts/characterState'
  import { getDatabase, type character } from 'src/ts/storage/database.svelte'
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
    selectedId: number
    ownerKey: string
    characterKey: string
    html: string
    moduleEmbedding: string
    reloadKey: string
  }

  function backgroundOwnerKey(selectedId: number, selectedCharacter: character | undefined) {
    return JSON.stringify({ selectedId, chaId: selectedCharacter?.chaId ?? '' })
  }

  function backgroundCharacterSignature(selectedId: number, selectedCharacter: character | undefined) {
    if (!selectedCharacter) {
      return JSON.stringify({ selectedId })
    }

    return JSON.stringify({
      selectedId,
      chaId: selectedCharacter.chaId ?? '',
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

  $effect(() => {
    const selectedId = selIdState.selId
    const selectedCharacter =
      getSelectedCharacterOwner() ?? (getDatabase().characters?.[selectedId] as character | undefined)
    const nextHTML = selectedCharacter?.backgroundHTML ?? ''
    const nextCharacterKey = backgroundCharacterSignature(selectedId, selectedCharacter)

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
      characterId: getDatabase().characters?.[selIdState.selId]?.chaId,
      chatId:
        getDatabase().characters?.[selIdState.selId]?.chats?.[getDatabase().characters?.[selIdState.selId]?.chatPage]
          ?.id,
    }),
  )
  let backgroundReloadKey = $derived(`${$ReloadGUIPointer}|${$VariableReloadGUIPointer}|${regexDisplayReloadToken}`)
  let backgroundOwner = $derived(
    backgroundOwnerKey(selIdState.selId, getDatabase().characters?.[selIdState.selId] as character | undefined),
  )
  let backgroundParseInput: BackgroundParseInput = $derived({
    selectedId: selIdState.selId,
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
      const currentChar = getDatabase().characters?.[input.selectedId] as character | undefined
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
    if (input.selectedId < 0 || (!input.html && !input.moduleEmbedding)) {
      latestBackgroundParseInput = input
      return Promise.resolve('')
    }
    return parseBackground(input)
  })
  let pendingBackground = $derived(backgroundParseInput.ownerKey === retainedBackgroundOwner ? retainedBackground : '')
</script>

{#if backgroundParseInput.html || backgroundParseInput.moduleEmbedding}
  {#if backgroundParseInput.selectedId > -1}
    <div class="absolute top-0 left-0 w-full h-full">
      {#await parsedBackground}
        {@html pendingBackground}
      {:then md}
        {@html md}
      {/await}
    </div>
  {/if}
{/if}
