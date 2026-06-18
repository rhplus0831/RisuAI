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
    scriptMain: SeparateParameters
    scriptAux: SeparateParameters
    overrides: Record<string, SeparateParameters>
  }

  type BaseSeparateParameterKey = 'memory' | 'emotion' | 'translate' | 'otherAx' | 'scriptMain' | 'scriptAux'

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
    scriptMain: {},
    scriptAux: {},
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
      scriptMain: {},
      scriptAux: {},
      overrides: {},
    },
  )

  let seperateParametersEnabledDraft = $derived(
    promptPresetModelOverrideMode ? promptSeperateParametersEnabledDraft : modelSeperateParametersEnabledDraft,
  )
  let seperateParametersDraft = $derived(
    promptPresetModelOverrideMode ? promptSeperateParametersDraft : modelSeperateParametersDraft,
  )

  const baseSeparateParameterKeys: BaseSeparateParameterKey[] = [
    'memory',
    'emotion',
    'translate',
    'otherAx',
    'scriptMain',
    'scriptAux',
  ]
  const paramLabels: Record<BaseSeparateParameterKey, string> = {
    memory: 'longTermMemory',
    emotion: 'emotionImage',
    translate: 'translator',
    otherAx: 'others',
    scriptMain: 'modelRoles.roles.scriptMain',
    scriptAux: 'modelRoles.roles.scriptAux',
  }
</script>

<Accordion name={language.seperateParameters} styled>
  <CheckInput bind:check={seperateParametersEnabledDraft.value} name={language.seperateParametersEnabled} />
  {#if seperateParametersEnabledDraft.value}
    {#each baseSeparateParameterKeys as param}
      {@const labelKey = paramLabels[param]}
      <Accordion
        name={labelKey.includes('.') ? language.modelRoles.roles[param] : (language[labelKey] ?? param)}
        styled>
        <AllSeperateParameters bind:value={seperateParametersDraft.value[param]} paramKey={param} />
      </Accordion>
    {/each}
  {/if}
</Accordion>
