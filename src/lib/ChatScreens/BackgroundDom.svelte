<script lang="ts">
  import { untrack } from 'svelte'
  import { ParseMarkdown, risuChatParser } from 'src/ts/parser/parser.svelte'
  import { getDatabase, type character } from 'src/ts/storage/database.svelte'
  import {
    moduleBackgroundEmbedding,
    ReloadGUIPointer,
    selIdState,
    VariableReloadGUIPointer,
  } from 'src/ts/stores.svelte'
  import { RegexDisplayReloadPointer } from 'src/ts/process/regexDisplayReload'

  interface BackgroundParseInput {
    selectedId: number
    characterKey: string
    html: string
    moduleEmbedding: string
    reloadKey: string
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
    const selectedCharacter = getDatabase().characters?.[selectedId] as character | undefined
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
  let backgroundReloadKey = $derived(`${$ReloadGUIPointer}|${$VariableReloadGUIPointer}|${$RegexDisplayReloadPointer}`)
  let backgroundParseInput: BackgroundParseInput = $derived({
    selectedId: selIdState.selId,
    characterKey: backgroundCharacterKey,
    html: backgroundHTML,
    moduleEmbedding,
    reloadKey: backgroundReloadKey,
  })

  function parseBackground(input: BackgroundParseInput): Promise<string> {
    return untrack(() => {
      const currentChar = getDatabase().characters?.[input.selectedId] as character | undefined
      const source = (input.html || '') + '\n' + (input.moduleEmbedding || '')
      return ParseMarkdown(risuChatParser(source, { chara: currentChar }), currentChar, 'back')
    })
  }

  let parsedBackground = $derived.by(() => {
    const input = backgroundParseInput
    if (input.selectedId < 0 || (!input.html && !input.moduleEmbedding)) {
      return Promise.resolve('')
    }
    return parseBackground(input)
  })
</script>

{#if backgroundParseInput.html || backgroundParseInput.moduleEmbedding}
  {#if backgroundParseInput.selectedId > -1}
    <div class="absolute top-0 left-0 w-full h-full">
      {#await parsedBackground then md}
        {@html md}
      {/await}
    </div>
  {/if}
{/if}
