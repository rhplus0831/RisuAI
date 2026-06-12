<script lang="ts">
  import Check from 'src/lib/UI/GUI/CheckInput.svelte'
  import Accordion from 'src/lib/UI/Accordion.svelte'
  import { language } from 'src/lang'
  import ModelList from 'src/lib/UI/ModelList.svelte'
  import { createServerBackedSettingDraft } from 'src/ts/server/settingsBridge.svelte'

  type AuxModelSettings = {
    memory: string
    translate: string
    emotion: string
    otherAx: string
  }

  const seperateModelsForAxModelsDraft = createServerBackedSettingDraft<boolean>('seperateModelsForAxModels', false)
  const doNotChangeSeperateModelsDraft = createServerBackedSettingDraft<boolean>('doNotChangeSeperateModels', false)
  const seperateModelsDraft = createServerBackedSettingDraft<AuxModelSettings>('seperateModels', {
    memory: '',
    translate: '',
    emotion: '',
    otherAx: '',
  })
</script>

<div class="flex items-center mt-4">
  <Check bind:check={seperateModelsForAxModelsDraft.value} name={language.seperateModelsForAxModels}></Check>
</div>
{#if seperateModelsForAxModelsDraft.value}
  <Check bind:check={doNotChangeSeperateModelsDraft.value} name={language.doNotChangeSeperateModels}></Check>
  <Accordion name={language.axModelsDef} styled>
    <span class="text-textcolor mt-4"> Memory </span>
    <ModelList bind:value={seperateModelsDraft.value.memory} blankable />

    <span class="text-textcolor mt-4"> Translations </span>
    <ModelList bind:value={seperateModelsDraft.value.translate} blankable />

    <span class="text-textcolor mt-4"> Emotion </span>

    <ModelList bind:value={seperateModelsDraft.value.emotion} blankable />

    <span class="text-textcolor mt-4"> OtherAx </span>

    <ModelList bind:value={seperateModelsDraft.value.otherAx} blankable />
  </Accordion>
{/if}
