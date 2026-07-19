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
    selectedCharID,
  } from 'src/ts/stores.svelte'
  import { getDatabase } from 'src/ts/storage/database.svelte'
  import Botpreset from '../Setting/botpreset.svelte'
  import ListedPersona from '../Setting/listedPersona.svelte'
  import Toggles from './Toggles.svelte'
  import ChatGenerationTogglePresetDialog from './ChatGenerationTogglePresetDialog.svelte'
</script>

{#if $selectedCharID >= 0 && getDatabase().characters?.[$selectedCharID]}
  <Toggles chara={getDatabase().characters[$selectedCharID]} noContainer />
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
