<script lang="ts">
  import {
    closePersonaListModal,
    closePresetListModal,
    DBState,
    openPersonaList,
    openPresetList,
    personaListModalStore,
    presetListModalStore,
    selectedCharID,
  } from 'src/ts/stores.svelte'
  import Botpreset from '../Setting/botpreset.svelte'
  import ListedPersona from '../Setting/listedPersona.svelte'
  import Toggles from './Toggles.svelte'
</script>

{#if $selectedCharID >= 0 && DBState.db.characters?.[$selectedCharID]}
  <Toggles chara={DBState.db.characters[$selectedCharID]} noContainer />
{/if}

{#if $openPresetList}
  <Botpreset mode={presetListModalStore.mode} kind={presetListModalStore.kind} close={closePresetListModal} />
{/if}

{#if $openPersonaList}
  <ListedPersona mode={personaListModalStore.mode} close={closePersonaListModal} />
{/if}
