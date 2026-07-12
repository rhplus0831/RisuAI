<script lang="ts">
  import { getResourceDatabase as getDatabase } from 'src/ts/server/resourceState.svelte'
  import { updateTextThemeAndCSS } from 'src/ts/gui/colorscheme'
  import ColorInput from 'src/lib/UI/GUI/ColorInput.svelte'
  import { applyServerBackedSetting } from 'src/ts/server/settingsBridge.svelte'

  const colors = [
    ['FontColorStandard', 'Normal Text', false],
    ['FontColorItalic', 'Italic Text', false],
    ['FontColorBold', 'Bold Text', false],
    ['FontColorItalicBold', 'Italic Bold Text', false],
    ['FontColorQuote1', 'Single Quote Text', true],
    ['FontColorQuote2', 'Double Quote Text', true],
  ] as const

  function setTextThemeValue(key: (typeof colors)[number][0], value: string) {
    applyServerBackedSetting('customTextTheme', {
      ...getDatabase().customTextTheme,
      [key]: value,
    })
    updateTextThemeAndCSS()
  }
</script>

{#if getDatabase().textTheme === 'custom'}
  {#each colors as color}
    <div class="flex items-center mt-2">
      <ColorInput
        nullable={color[2]}
        value={getDatabase().customTextTheme[color[0]]}
        oninput={updateTextThemeAndCSS}
        onchange={(value) => setTextThemeValue(color[0], value)} />
      <span class="ml-2">{color[1]}</span>
    </div>
  {/each}
{/if}
