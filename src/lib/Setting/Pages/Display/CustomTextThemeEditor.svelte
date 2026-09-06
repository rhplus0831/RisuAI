<script lang="ts">
  import { settingsResourceState } from 'src/ts/server/resourceState.svelte'
  import { updateTextThemeAndCSS } from 'src/ts/gui/colorscheme'
  import ColorInput from 'src/lib/UI/GUI/ColorInput.svelte'
  import { applyServerBackedSetting } from 'src/ts/server/settingsOwner.svelte'

  const colors = [
    ['FontColorStandard', 'Normal Text', false],
    ['FontColorItalic', 'Italic Text', false],
    ['FontColorBold', 'Bold Text', false],
    ['FontColorItalicBold', 'Italic Bold Text', false],
    ['FontColorQuote1', 'Single Quote Text', true],
    ['FontColorQuote2', 'Double Quote Text', true],
  ] as const

  let displaySettings = $derived(
    settingsResourceState.groupStatuses.display === 'ready' ? settingsResourceState.value : undefined,
  )
  let customTextTheme = $derived(displaySettings?.customTextTheme)

  function setTextThemeValue(key: (typeof colors)[number][0], value: string) {
    if (!customTextTheme) return
    applyServerBackedSetting('customTextTheme', {
      ...customTextTheme,
      [key]: value,
    })
    updateTextThemeAndCSS()
  }
</script>

{#if displaySettings?.textTheme === 'custom' && customTextTheme}
  {#each colors as color}
    <div class="flex items-center mt-2">
      <ColorInput
        nullable={color[2]}
        value={customTextTheme[color[0]]}
        ariaLabel={color[1]}
        oninput={updateTextThemeAndCSS}
        onchange={(value) => setTextThemeValue(color[0], value)} />
      <span class="ml-2">{color[1]}</span>
    </div>
  {/each}
{/if}
