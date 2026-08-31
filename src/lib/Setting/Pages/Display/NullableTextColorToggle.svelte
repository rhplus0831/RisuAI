<script lang="ts">
  import { language } from 'src/lang'
  import { settingsResourceState } from 'src/ts/server/resourceState.svelte'
  import Check from 'src/lib/UI/GUI/CheckInput.svelte'
  import { applyServerBackedSetting } from 'src/ts/server/settingsBridge.svelte'

  interface Props {
    field: 'textScreenColor' | 'textScreenBorder'
    labelKey: 'textBackgrounds' | 'textScreenBorder'
    defaultColor: string
  }

  let { field, labelKey, defaultColor }: Props = $props()
  let displaySettings = $derived(
    settingsResourceState.groupStatuses.display === 'ready' ? settingsResourceState.value : undefined,
  )
  let currentValue = $derived(displaySettings?.[field])
</script>

{#if currentValue}
  <div class="flex items-center mt-2">
    <Check
      check={true}
      onChange={() => {
        applyServerBackedSetting(field, null)
      }}
      name={language[labelKey]}
      hiddenName />
    <input
      type="color"
      class="style2 text-sm mr-2"
      aria-label={language[labelKey]}
      value={currentValue}
      onchange={(e) => {
        applyServerBackedSetting(field, e.currentTarget.value)
      }} />
    <span>{language[labelKey]}</span>
  </div>
{:else}
  <div class="flex items-center mt-2">
    <Check
      check={false}
      disabled={!displaySettings}
      onChange={() => {
        applyServerBackedSetting(field, defaultColor)
      }}
      name={language[labelKey]} />
  </div>
{/if}
