<script lang="ts">
  import { language } from 'src/lang'
  import CheckInput from 'src/lib/UI/GUI/CheckInput.svelte'
  import NumberInput from 'src/lib/UI/GUI/NumberInput.svelte'
  import { getResourceDatabase as getDatabase } from 'src/ts/server/resourceState.svelte'
  import { createServerBackedSettingDraft } from 'src/ts/server/settingsBridge.svelte'
  import { DEFAULT_BARDWIKI_GLOBAL_SETTINGS, type BardWikiGlobalSettings } from '@risuai/protocol'

  const settings = createServerBackedSettingDraft<BardWikiGlobalSettings>('bardWiki', {
    ...DEFAULT_BARDWIKI_GLOBAL_SETTINGS,
  })

  let modelProfiles = $derived(Array.isArray(getDatabase().modelProfiles) ? getDatabase().modelProfiles : [])
  let promptPresets = $derived(Array.isArray(getDatabase().promptPresets) ? getDatabase().promptPresets : [])

  function updateSetting<Key extends keyof BardWikiGlobalSettings>(key: Key, value: BardWikiGlobalSettings[Key]): void {
    settings.value = { ...settings.value, [key]: value }
  }

  function numberValue(event: Event & { currentTarget: HTMLInputElement }): number {
    return event.currentTarget.valueAsNumber
  }
</script>

<section class="flex flex-col gap-4" data-risu-bardwiki-settings>
  <p class="text-sm text-textcolor2">{language.bardWiki.description}</p>

  <CheckInput
    check={settings.value.enabledByDefault}
    onChange={(enabled) => updateSetting('enabledByDefault', enabled)}
    name={language.bardWiki.enabledByDefault} />

  <label class="flex flex-col gap-1 text-textcolor" for="bardwiki-memory-mode">
    <span>{language.bardWiki.memoryMode}</span>
    <select
      id="bardwiki-memory-mode"
      class="border border-darkborderc rounded-md bg-transparent px-3 py-2"
      value={settings.value.memoryMode}
      onchange={(event) =>
        updateSetting('memoryMode', event.currentTarget.value as BardWikiGlobalSettings['memoryMode'])}>
      <option class="bg-darkbg" value="hypa">{language.bardWiki.modeHypa}</option>
      <option class="bg-darkbg" value="bardwiki">{language.bardWiki.modeBardWiki}</option>
      <option class="bg-darkbg" value="hybrid">{language.bardWiki.modeHybrid}</option>
    </select>
  </label>

  <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
    <label class="flex flex-col gap-1 text-textcolor">
      <span>{language.bardWiki.totalTokenBudget}</span>
      <NumberInput
        min={0}
        max={32768}
        fullwidth
        ariaLabel={language.bardWiki.totalTokenBudget}
        value={settings.value.totalTokenBudget}
        onChange={(event) => updateSetting('totalTokenBudget', numberValue(event))} />
    </label>
    <label class="flex flex-col gap-1 text-textcolor">
      <span>{language.bardWiki.maxDocuments}</span>
      <NumberInput
        min={1}
        max={32}
        fullwidth
        ariaLabel={language.bardWiki.maxDocuments}
        value={settings.value.maxDocuments}
        onChange={(event) => updateSetting('maxDocuments', numberValue(event))} />
    </label>
    <label class="flex flex-col gap-1 text-textcolor">
      <span>{language.bardWiki.hybridHypaTokenBudget}</span>
      <NumberInput
        min={0}
        max={32768}
        fullwidth
        ariaLabel={language.bardWiki.hybridHypaTokenBudget}
        value={settings.value.hybridHypaTokenBudget}
        onChange={(event) => updateSetting('hybridHypaTokenBudget', numberValue(event))} />
    </label>
    <label class="flex flex-col gap-1 text-textcolor">
      <span>{language.bardWiki.hybridBardWikiTokenBudget}</span>
      <NumberInput
        min={0}
        max={32768}
        fullwidth
        ariaLabel={language.bardWiki.hybridBardWikiTokenBudget}
        value={settings.value.hybridBardWikiTokenBudget}
        onChange={(event) => updateSetting('hybridBardWikiTokenBudget', numberValue(event))} />
    </label>
    <label class="flex flex-col gap-1 text-textcolor">
      <span>{language.bardWiki.maxLinkHops}</span>
      <NumberInput
        min={0}
        max={2}
        fullwidth
        ariaLabel={language.bardWiki.maxLinkHops}
        value={settings.value.maxLinkHops}
        onChange={(event) => updateSetting('maxLinkHops', numberValue(event))} />
    </label>
    <label class="flex flex-col gap-1 text-textcolor">
      <span>{language.bardWiki.recentMessageCount}</span>
      <NumberInput
        min={1}
        max={50}
        fullwidth
        ariaLabel={language.bardWiki.recentMessageCount}
        value={settings.value.recentMessageCount}
        onChange={(event) => updateSetting('recentMessageCount', numberValue(event))} />
    </label>
  </div>

  <label class="flex flex-col gap-1 text-textcolor" for="bardwiki-model-profile">
    <span>{language.bardWiki.modelProfile}</span>
    <select
      id="bardwiki-model-profile"
      class="border border-darkborderc rounded-md bg-transparent px-3 py-2"
      value={settings.value.modelProfileId ?? ''}
      onchange={(event) => {
        updateSetting('modelProfileId', event.currentTarget.value || null)
      }}>
      <option class="bg-darkbg" value="">{language.bardWiki.useRoleDefault}</option>
      {#each modelProfiles as profile}
        <option class="bg-darkbg" value={profile.id}>{profile.name || profile.id}</option>
      {/each}
    </select>
  </label>

  <label class="flex flex-col gap-1 text-textcolor" for="bardwiki-prompt-preset">
    <span>{language.bardWiki.promptPreset}</span>
    <select
      id="bardwiki-prompt-preset"
      class="border border-darkborderc rounded-md bg-transparent px-3 py-2"
      value={settings.value.promptPresetId ?? ''}
      onchange={(event) => {
        updateSetting('promptPresetId', event.currentTarget.value || null)
      }}>
      <option class="bg-darkbg" value="">{language.bardWiki.useBuiltInPrompt}</option>
      {#each promptPresets as preset}
        <option class="bg-darkbg" value={preset.id}>{preset.name || preset.id}</option>
      {/each}
    </select>
  </label>

  <div class="rounded-md border border-darkborderc p-3">
    <CheckInput
      check={settings.value.confirmationPolicy === 'automatic'}
      onChange={(enabled) => updateSetting('confirmationPolicy', enabled ? 'automatic' : 'manual')}
      name={language.bardWiki.automaticConfirmation} />
    <CheckInput
      check={settings.value.canonicalUpdates}
      onChange={(enabled) => updateSetting('canonicalUpdates', enabled)}
      name={language.bardWiki.canonicalUpdates} />
  </div>
</section>
