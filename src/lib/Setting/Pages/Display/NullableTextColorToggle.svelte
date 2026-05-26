<script lang="ts">
  import { language } from 'src/lang'
  import { DBState } from 'src/ts/stores.svelte'
  import Check from 'src/lib/UI/GUI/CheckInput.svelte'
  import { applyServerBackedSetting } from 'src/ts/server/settingsBridge.svelte'

  interface Props {
    field: 'textScreenColor' | 'textScreenBorder'
    labelKey: 'textBackgrounds' | 'textScreenBorder'
    defaultColor: string
  }

  let { field, labelKey, defaultColor }: Props = $props()
  let currentValue = $derived(DBState.db[field])
</script>

{#if currentValue}
  <div class="flex items-center mt-2">
    <Check
      check={true}
      onChange={() => {
        applyServerBackedSetting(field, null)
      }}
      name={language[labelKey]}
      hiddenName
    />
    <input
      type="color"
      class="style2 text-sm mr-2"
      value={currentValue}
      oninput={(e) => {
        applyServerBackedSetting(field, e.currentTarget.value)
      }}
    />
    <span>{language[labelKey]}</span>
  </div>
{:else}
  <div class="flex items-center mt-2">
    <Check
      check={false}
      onChange={() => {
        applyServerBackedSetting(field, defaultColor)
      }}
      name={language[labelKey]}
    />
  </div>
{/if}
