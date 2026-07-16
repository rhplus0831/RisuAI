<script lang="ts">
  import { language } from 'src/lang'
  import { getDatabase } from 'src/ts/storage/database.svelte'
  import { changeColorScheme, colorSchemeList } from 'src/ts/gui/colorscheme'
  import SelectInput from 'src/lib/UI/GUI/SelectInput.svelte'
  import OptionInput from 'src/lib/UI/GUI/OptionInput.svelte'

  const onSchemeInputChange = (e: Event) => {
    changeColorScheme((e.target as HTMLInputElement).value)
  }
</script>

<span class="text-textcolor mt-4">{language.colorScheme}</span>
<SelectInput
  className="mt-2"
  value={getDatabase().colorSchemeName}
  ariaLabel={language.colorScheme}
  onchange={onSchemeInputChange}>
  {#each colorSchemeList as scheme}
    <OptionInput value={scheme}>{scheme}</OptionInput>
  {/each}
  <OptionInput value="custom">Custom</OptionInput>
</SelectInput>
