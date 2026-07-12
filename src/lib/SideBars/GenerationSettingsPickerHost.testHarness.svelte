<script lang="ts">
  import {
    closePersonaListModal,
    closePresetListModal,
    openPersonaList,
    openPresetList,
    personaListModalStore,
    presetListModalStore,
    selectedCharID,
  } from 'src/ts/stores.svelte'
  import { getDatabase } from 'src/ts/storage/database.svelte'
  import Botpreset from '../Setting/botpreset.svelte'
  import ListedPersona from '../Setting/listedPersona.svelte'
  import Toggles from './Toggles.svelte'
</script>

{#if $selectedCharID >= 0 && getDatabase().characters?.[$selectedCharID]}
  <Toggles chara={getDatabase().characters[$selectedCharID]} noContainer />
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
