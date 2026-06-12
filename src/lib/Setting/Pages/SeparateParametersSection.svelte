<script lang="ts">
  import { language } from 'src/lang'
  import Accordion from 'src/lib/UI/Accordion.svelte'
  import CheckInput from 'src/lib/UI/GUI/CheckInput.svelte'
  import AllSeperateParameters from 'src/lib/Others/AllSeperateParameters.svelte'
  import { createServerBackedSettingDraft } from 'src/ts/server/settingsBridge.svelte'
  import type { SeparateParameters } from 'src/ts/storage/database.svelte'

  type SeparateParameterSettings = {
    memory: SeparateParameters
    emotion: SeparateParameters
    translate: SeparateParameters
    otherAx: SeparateParameters
    overrides: Record<string, SeparateParameters>
  }

  const seperateParametersEnabledDraft = createServerBackedSettingDraft<boolean>('seperateParametersEnabled', false)
  const seperateParametersDraft = createServerBackedSettingDraft<SeparateParameterSettings>('seperateParameters', {
    memory: {},
    emotion: {},
    translate: {},
    otherAx: {},
    overrides: {},
  })

  const paramLabels: Record<string, string> = {
    memory: 'longTermMemory',
    emotion: 'emotionImage',
    translate: 'translator',
    otherAx: 'others',
  }
</script>

<Accordion name={language.seperateParameters} styled>
  <CheckInput bind:check={seperateParametersEnabledDraft.value} name={language.seperateParametersEnabled} />
  {#if seperateParametersEnabledDraft.value}
    {#each Object.keys(seperateParametersDraft.value) as param}
      <Accordion name={language[paramLabels[param]] ?? param} styled>
        <AllSeperateParameters bind:value={seperateParametersDraft.value[param]} paramKey={param} />
      </Accordion>
    {/each}
  {/if}
</Accordion>
