<script lang="ts">
  import {
    closePersonaListModal,
    closePresetListModal,
    closeChatGenerationTogglePresetListModal,
    openPersonaList,
    openPresetList,
    openChatGenerationTogglePresetList,
    personaListModalStore,
    presetListModalStore,
    chatGenerationTogglePresetListModalStore,
  } from 'src/ts/stores.svelte'
  import { charactersResourceState, getCharacterResourceOwner } from 'src/ts/server/resourceState.svelte'
  import Botpreset from '../Setting/botpreset.svelte'
  import ListedPersona from '../Setting/listedPersona.svelte'
  import Toggles from './Toggles.svelte'
  import ChatGenerationTogglePresetDialog from './ChatGenerationTogglePresetDialog.svelte'

  let selectedOwner = $derived.by(() => {
    if (charactersResourceState.status !== 'ready') return undefined
    const candidate = charactersResourceState.characters[charactersResourceState.currentChar]
    return candidate?.chaId ? getCharacterResourceOwner(candidate.chaId) : undefined
  })
</script>

{#if selectedOwner}
  <Toggles chara={selectedOwner} noContainer />
{/if}

{#if $openChatGenerationTogglePresetList}
  <ChatGenerationTogglePresetDialog
    target={chatGenerationTogglePresetListModalStore.target}
    close={closeChatGenerationTogglePresetListModal} />
{/if}

{#if $openPresetList}
  <Botpreset
    mode={presetListModalStore.mode}
    kind={presetListModalStore.kind}
    target={presetListModalStore.target}
    close={closePresetListModal} />
{/if}

{#if $openPersonaList}
  <ListedPersona
    mode={personaListModalStore.mode}
    target={personaListModalStore.target}
    close={closePersonaListModal} />
{/if}
