<script lang="ts">
  import { language } from 'src/lang'
  import { getDatabase } from 'src/ts/storage/database.svelte'
  import {
    changeColorScheme,
    colorSchemeList,
    colorSchemePresets,
    defaultColorScheme,
    type ColorScheme,
  } from 'src/ts/gui/colorscheme'

  const paletteStyle = (scheme: ColorScheme) => {
    const { bgcolor, darkbg, borderc, selected } = scheme

    return `background: conic-gradient(from 45deg, ${bgcolor} 0deg 90deg, ${darkbg} 90deg 180deg, ${borderc} 180deg 270deg, ${selected} 270deg 360deg);`
  }
</script>

<span class="text-textcolor mt-4">{language.colorScheme}</span>
<div
  class="mt-3 grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-x-2 gap-y-5"
  role="group"
  aria-label={language.colorScheme}>
  {#each colorSchemeList as scheme}
    {@const selected = getDatabase().colorSchemeName === scheme}
    {@const label = language.colorSchemePresetNames[scheme]}
    <button
      type="button"
      class="risu-card relative flex min-h-28 flex-col items-center justify-center gap-2 pt-6 text-center transition-colors hover:bg-darkbutton focus:outline-hidden focus:ring-2 focus:ring-borderc"
      class:border-borderc={selected}
      class:bg-selected={selected}
      class:border-darkborderc={!selected}
      aria-pressed={selected}
      aria-label={label}
      title={label}
      onclick={() => changeColorScheme(scheme)}>
      <span
        class="absolute -top-3 left-3 max-w-[calc(100%-1.5rem)] truncate rounded-full bg-darkbutton px-2 py-1 text-xs text-textcolor shadow-sm">
        {label}
      </span>
      <span class="palette-wheel relative h-14 w-14 overflow-hidden rounded-full shadow-sm" aria-hidden="true">
        <span class="palette-wheel-fill" style={paletteStyle(colorSchemePresets[scheme])}></span>
      </span>
    </button>
  {/each}

  <button
    type="button"
    class="risu-card relative flex min-h-28 flex-col items-center justify-center gap-2 pt-6 text-center transition-colors hover:bg-darkbutton focus:outline-hidden focus:ring-2 focus:ring-borderc"
    class:border-borderc={getDatabase().colorSchemeName === 'custom'}
    class:bg-selected={getDatabase().colorSchemeName === 'custom'}
    class:border-darkborderc={getDatabase().colorSchemeName !== 'custom'}
    aria-pressed={getDatabase().colorSchemeName === 'custom'}
    aria-label={language.colorSchemePresetNames.custom}
    title={language.colorSchemePresetNames.custom}
    onclick={() => changeColorScheme('custom')}>
    <span
      class="absolute -top-3 left-3 max-w-[calc(100%-1.5rem)] truncate rounded-full bg-darkbutton px-2 py-1 text-xs text-textcolor shadow-sm">
      {language.colorSchemePresetNames.custom}
    </span>
    <span class="palette-wheel relative h-14 w-14 overflow-hidden rounded-full shadow-sm" aria-hidden="true">
      <span class="palette-wheel-fill" style={paletteStyle(getDatabase().customColorScheme ?? defaultColorScheme)}
      ></span>
    </span>
  </button>
</div>

<style>
  .palette-wheel {
    box-shadow:
      inset 0 0 0 1px color-mix(in srgb, var(--risu-theme-textcolor) 20%, transparent),
      0 1px 2px rgb(0 0 0 / 0.15);
  }

  .palette-wheel-fill {
    position: absolute;
    inset: -1px;
    border-radius: inherit;
  }
</style>
