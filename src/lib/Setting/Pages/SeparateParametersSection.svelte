<script lang="ts">
  import { language } from 'src/lang'
  import { DBState } from 'src/ts/stores.svelte'
  import Accordion from 'src/lib/UI/Accordion.svelte'
  import CheckInput from 'src/lib/UI/GUI/CheckInput.svelte'
  import AllSeperateParameters from 'src/lib/Others/AllSeperateParameters.svelte'
  import { onDestroy } from 'svelte'
  import { watchServerBackedSettings } from 'src/ts/server/settingsBridge.svelte'

  const stopServerSettingsWatch = watchServerBackedSettings([
    'seperateParametersEnabled',
    'seperateParameters',
  ])
  onDestroy(stopServerSettingsWatch)

  const paramLabels: Record<string, string> = {
    memory: 'longTermMemory',
    emotion: 'emotionImage',
    translate: 'translator',
    otherAx: 'others',
  }
</script>

<Accordion name={language.seperateParameters} styled>
  <CheckInput
    bind:check={DBState.db.seperateParametersEnabled}
    name={language.seperateParametersEnabled}
  />
  {#if DBState.db.seperateParametersEnabled}
    {#each Object.keys(DBState.db.seperateParameters) as param}
      <Accordion name={language[paramLabels[param]] ?? param} styled>
        <AllSeperateParameters bind:value={DBState.db.seperateParameters[param]} paramKey={param} />
      </Accordion>
    {/each}
  {/if}
</Accordion>
