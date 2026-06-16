<script lang="ts">
  import { language } from 'src/lang'
  import Accordion from 'src/lib/UI/Accordion.svelte'
  import CheckInput from 'src/lib/UI/GUI/CheckInput.svelte'
  import AllSeperateParameters from 'src/lib/Others/AllSeperateParameters.svelte'
  import { createServerBackedSettingDraft } from 'src/ts/server/settingsBridge.svelte'
  import { createPromptPresetModelOverrideDraft } from 'src/ts/promptPresetModelOverrides.svelte'
  import type { SeparateParameters } from 'src/ts/storage/database.svelte'

  type SeparateParameterSettings = {
    memory: SeparateParameters
    emotion: SeparateParameters
    translate: SeparateParameters
    otherAx: SeparateParameters
    overrides: Record<string, SeparateParameters>
  }

  type BaseSeparateParameterKey = Exclude<keyof SeparateParameterSettings, 'overrides'>

  interface Props {
    promptPresetModelOverrideMode?: boolean
  }

  let { promptPresetModelOverrideMode = false }: Props = $props()

  const modelSeperateParametersEnabledDraft = createServerBackedSettingDraft<boolean>(
    'seperateParametersEnabled',
    false,
  )
  const modelSeperateParametersDraft = createServerBackedSettingDraft<SeparateParameterSettings>('seperateParameters', {
    memory: {},
    emotion: {},
    translate: {},
    otherAx: {},
    overrides: {},
  })
  const promptSeperateParametersEnabledDraft = createPromptPresetModelOverrideDraft<boolean>(
    'seperateParametersEnabled',
    false,
  )
  const promptSeperateParametersDraft = createPromptPresetModelOverrideDraft<SeparateParameterSettings>(
    'seperateParameters',
    {
      memory: {},
      emotion: {},
      translate: {},
      otherAx: {},
      overrides: {},
    },
  )

  let seperateParametersEnabledDraft = $derived(
    promptPresetModelOverrideMode ? promptSeperateParametersEnabledDraft : modelSeperateParametersEnabledDraft,
  )
  let seperateParametersDraft = $derived(
    promptPresetModelOverrideMode ? promptSeperateParametersDraft : modelSeperateParametersDraft,
  )

  const baseSeparateParameterKeys: BaseSeparateParameterKey[] = ['memory', 'emotion', 'translate', 'otherAx']
  const paramLabels: Record<BaseSeparateParameterKey, string> = {
    memory: 'longTermMemory',
    emotion: 'emotionImage',
    translate: 'translator',
    otherAx: 'others',
  }
</script>

<Accordion name={language.seperateParameters} styled>
  <CheckInput bind:check={seperateParametersEnabledDraft.value} name={language.seperateParametersEnabled} />
  {#if seperateParametersEnabledDraft.value}
    {#each baseSeparateParameterKeys as param}
      <Accordion name={language[paramLabels[param]] ?? param} styled>
        <AllSeperateParameters bind:value={seperateParametersDraft.value[param]} paramKey={param} />
      </Accordion>
    {/each}
  {/if}
</Accordion>
