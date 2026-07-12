<script lang="ts">
  import { MobileGUI, selectedCharID } from 'src/ts/stores.svelte'
  import { language } from 'src/lang'
  import { getDatabase, type character } from 'src/ts/storage/database.svelte'
  import CheckInput from '../UI/GUI/CheckInput.svelte'
  import SelectInput from '../UI/GUI/SelectInput.svelte'
  import OptionInput from '../UI/GUI/OptionInput.svelte'
  import TextAreaInput from '../UI/GUI/TextAreaInput.svelte'
  import TextInput from '../UI/GUI/TextInput.svelte'
  import Accordion from '../UI/Accordion.svelte'
  import ChatGenerationSettingsControls from './ChatGenerationSettingsControls.svelte'
  import ChatGenerationResetDefaultsButton from './ChatGenerationResetDefaultsButton.svelte'
  import ChatGenerationTogglePresets from './ChatGenerationTogglePresets.svelte'
  import CustomSideBar from './CustomSidebar.svelte'
  import {
    compareChatGenerationTogglePresetToActiveState,
    getChatGenerationTogglePresets,
  } from 'src/ts/chatGenerationTogglePresets'
  import { setCharacterInputTranslationHook, setCharacterSupaMemory } from 'src/ts/characterCommands'
  import {
    ensureActiveChatSidebarToggleDefaults,
    resolveActiveChatGenerationSettings,
    saveActiveChatJailbreakToggleGenerationSettings,
    saveActiveChatSidebarToggleGenerationSettings,
  } from 'src/ts/activeChatGenerationSettings'
  import type {
    ChatGenerationDisplayedSidebarToggle,
    ChatGenerationRequiredSidebarToggle,
    ChatGenerationSidebarToggleLayout,
  } from 'src/ts/chatGenerationSettings'

  type GroupedSidebarToggleGroup = Omit<ChatGenerationSidebarToggleLayout, 'kind'> & {
    kind: 'group'
    children: GroupedSidebarToggle[]
  }

  type GroupedSidebarToggleLayout = Omit<ChatGenerationSidebarToggleLayout, 'kind'> & {
    kind: Exclude<ChatGenerationSidebarToggleLayout['kind'], 'group'>
  }

  type GroupedSidebarToggle =
    | ChatGenerationRequiredSidebarToggle
    | GroupedSidebarToggleLayout
    | GroupedSidebarToggleGroup

  interface Props {
    chara?: character
    noContainer?: boolean
  }

  let { chara = $bindable(), noContainer }: Props = $props()

  let selectedTogglePresetId = $state('')

  let activeGenerationSettings = $derived.by(() =>
    resolveActiveChatGenerationSettings({
      selectedCharIndex: $selectedCharID,
    }),
  )

  let hasJailbreakPrompt = $derived.by(() => activeGenerationSettings.readiness.requirements.jailbreakToggle.displayed)

  let displayedSidebarToggles = $derived.by(() => groupSidebarToggles(activeGenerationSettings.displayedSidebarToggles))
  let togglePresets = $derived.by(() => getChatGenerationTogglePresets())
  let selectedTogglePreset = $derived.by(() => togglePresets.find((preset) => preset.id === selectedTogglePresetId))
  let selectedTogglePresetComparison = $derived.by(() =>
    selectedTogglePreset
      ? compareChatGenerationTogglePresetToActiveState(selectedTogglePreset, activeGenerationSettings)
      : null,
  )

  $effect(() => {
    ensureActiveChatSidebarToggleDefaults(activeGenerationSettings)
  })

  function getJailbreakToggleValue(): boolean {
    return activeGenerationSettings.settings?.jailbreakToggle === true
  }

  function setJailbreakToggleValue(value: boolean): void {
    saveActiveChatJailbreakToggleGenerationSettings(value)
  }

  function getToggleValue(key: string): string {
    return activeGenerationSettings.settings?.sidebarToggles?.[key] ?? ''
  }

  function setToggleValue(key: string, value: string): void {
    saveActiveChatSidebarToggleGenerationSettings(key, value)
  }

  function setSupaMemoryValue(value: boolean): void {
    if (!chara?.chaId) return
    setCharacterSupaMemory(chara.chaId, value)
  }

  function setInputTranslationHookValue(value: boolean): void {
    if (!chara?.chaId) return
    setCharacterInputTranslationHook(chara.chaId, value)
  }

  function isSidebarTogglePresetDifferent(key: string): boolean {
    return selectedTogglePresetComparison?.differingSidebarToggleKeys.has(key) === true
  }

  function isJailbreakTogglePresetDifferent(): boolean {
    return selectedTogglePresetComparison?.jailbreakToggleDiffers === true
  }

  function groupSidebarToggles(items: ChatGenerationDisplayedSidebarToggle[]): GroupedSidebarToggle[] {
    const grouped: GroupedSidebarToggle[] = []
    const stack: GroupedSidebarToggleGroup[] = []

    for (const item of items) {
      if (item.kind === 'group') {
        const group: GroupedSidebarToggleGroup = { ...item, kind: 'group', children: [] }
        appendGroupedToggle(grouped, stack, group)
        stack.push(group)
        continue
      }
      if (item.kind === 'groupEnd') {
        stack.pop()
        continue
      }
      appendGroupedToggle(grouped, stack, item as GroupedSidebarToggle)
    }

    return grouped
  }

  function appendGroupedToggle(
    grouped: GroupedSidebarToggle[],
    stack: GroupedSidebarToggleGroup[],
    item: GroupedSidebarToggle,
  ): void {
    const parent = stack.at(-1)
    if (parent) {
      parent.children.push(item)
    } else {
      grouped.push(item)
    }
  }
</script>

{#snippet toggles(items: GroupedSidebarToggle[], reverse: boolean = false)}
  {#each items as toggle, index}
    {#if toggle.kind === 'group'}
      {#if toggle.children.length > 0}
        <div class="w-full" data-risu-generation-toggle-group data-risu-toggle-label={toggle.label}>
          <Accordion styled name={toggle.label}>
            {@render toggles(toggle.children, reverse)}
          </Accordion>
        </div>
      {/if}
    {:else if toggle.kind === 'caption'}
      <div class="w-full mt-1 text-xs text-textcolor2" data-risu-generation-toggle-caption>
        {toggle.label}
      </div>
    {:else if toggle.kind === 'divider'}
      {#if index === 0 || items[index - 1]?.kind !== 'divider' || items[index - 1]?.label !== toggle.label}
        <div class="w-full min-h-5 flex gap-2 mt-2 items-center" class:justify-end={!reverse}>
          {#if toggle.label}
            <span class="shrink-0">{toggle.label}</span>
          {/if}
          <hr class="border-t border-darkborderc m-0 grow" />
        </div>
      {/if}
    {:else if toggle.kind === 'groupEnd'}
      <!-- groupEnd only closes groups while building the display tree. -->
    {:else if toggle.kind === 'select'}
      <div
        class="w-full flex gap-2 mt-2 items-center"
        class:justify-end={$MobileGUI}
        data-risu-generation-toggle-control
        data-risu-toggle-key={toggle.key}
        data-risu-toggle-kind={toggle.kind}
        data-risu-input-kind="select"
        data-risu-toggle-preset-different={isSidebarTogglePresetDifferent(toggle.key) ? 'true' : 'false'}
        class:bg-red-900={isSidebarTogglePresetDifferent(toggle.key)}
        class:rounded-sm={isSidebarTogglePresetDifferent(toggle.key)}>
        <span>{toggle.label}</span>
        <SelectInput
          className="w-32"
          bind:value={() => getToggleValue(toggle.key), (value) => setToggleValue(toggle.key, String(value))}>
          {#each toggle.options as option, i}
            <OptionInput value={i.toString()}>{option}</OptionInput>
          {/each}
        </SelectInput>
      </div>
    {:else if toggle.kind === 'text'}
      <div
        class="w-full flex gap-2 mt-2 items-center"
        class:justify-end={$MobileGUI}
        data-risu-generation-toggle-control
        data-risu-toggle-key={toggle.key}
        data-risu-toggle-kind={toggle.kind}
        data-risu-input-kind="text"
        data-risu-toggle-preset-different={isSidebarTogglePresetDifferent(toggle.key) ? 'true' : 'false'}
        class:bg-red-900={isSidebarTogglePresetDifferent(toggle.key)}
        class:rounded-sm={isSidebarTogglePresetDifferent(toggle.key)}>
        <span>{toggle.label}</span>
        <TextInput
          className="w-32"
          bind:value={() => getToggleValue(toggle.key), (value) => setToggleValue(toggle.key, value)} />
      </div>
    {:else if toggle.kind === 'textarea'}
      <div
        class="w-full flex gap-2 mt-2 items-start"
        class:justify-end={$MobileGUI}
        data-risu-generation-toggle-control
        data-risu-toggle-key={toggle.key}
        data-risu-toggle-kind={toggle.kind}
        data-risu-input-kind="textarea"
        data-risu-toggle-preset-different={isSidebarTogglePresetDifferent(toggle.key) ? 'true' : 'false'}
        class:bg-red-900={isSidebarTogglePresetDifferent(toggle.key)}
        class:rounded-sm={isSidebarTogglePresetDifferent(toggle.key)}>
        <span class="mt-1.5">{toggle.label}</span>
        <TextAreaInput
          className="w-32"
          height="20"
          bind:value={() => getToggleValue(toggle.key), (value) => setToggleValue(toggle.key, value)} />
      </div>
    {:else}
      <div
        class="w-full flex mt-2 items-center"
        class:justify-end={$MobileGUI}
        data-risu-generation-toggle-control
        data-risu-toggle-key={toggle.key}
        data-risu-toggle-kind={toggle.kind}
        data-risu-input-kind="checkbox"
        data-risu-selected={getToggleValue(toggle.key) === '1' ? 'true' : 'false'}
        data-risu-toggle-preset-different={isSidebarTogglePresetDifferent(toggle.key) ? 'true' : 'false'}
        class:bg-red-900={isSidebarTogglePresetDifferent(toggle.key)}
        class:rounded-sm={isSidebarTogglePresetDifferent(toggle.key)}>
        <CheckInput
          check={getToggleValue(toggle.key) === '1'}
          {reverse}
          name={toggle.label}
          onChange={(check) => {
            setToggleValue(toggle.key, check ? '1' : '0')
          }} />
      </div>
    {/if}
  {/each}
{/snippet}

{#if !noContainer && displayedSidebarToggles.length > 4}
  <div class="border-darkborderc p-2 border rounded-sm flex flex-col items-start mt-2">
    <ChatGenerationSettingsControls />
    <CustomSideBar />

    {#if hasJailbreakPrompt}
      <div
        class="flex mt-2 items-center w-full"
        class:justify-end={$MobileGUI}
        data-risu-generation-jailbreak-control
        data-risu-toggle-key="jailbreakToggle"
        data-risu-toggle-kind="jailbreak"
        data-risu-input-kind="checkbox"
        data-risu-selected={getJailbreakToggleValue() ? 'true' : 'false'}
        data-risu-toggle-preset-different={isJailbreakTogglePresetDifferent() ? 'true' : 'false'}
        class:bg-red-900={isJailbreakTogglePresetDifferent()}
        class:rounded-sm={isJailbreakTogglePresetDifferent()}>
        <CheckInput
          bind:check={() => getJailbreakToggleValue(), setJailbreakToggleValue}
          name={language.jailbreakToggle}
          reverse />
      </div>
    {/if}

    {@render toggles(displayedSidebarToggles, true)}
    {#if chara && getDatabase().hypaV3}
      <div class="flex mt-2 items-center w-full" class:justify-end={$MobileGUI} data-risu-hypa-memory-toggle>
        <CheckInput check={chara.supaMemory} reverse name={language.ToggleHypaMemory} onChange={setSupaMemoryValue} />
      </div>
    {/if}
    {#if chara}
      <div class="flex mt-2 items-center w-full" class:justify-end={$MobileGUI} data-risu-input-translation-hook-toggle>
        <CheckInput
          check={chara.useInputTranslationHook}
          reverse
          name={language.useInputTranslationHook}
          onChange={setInputTranslationHookValue} />
      </div>
    {/if}
    <ChatGenerationResetDefaultsButton />
    <ChatGenerationTogglePresets bind:selectedPresetId={selectedTogglePresetId} />
  </div>
{:else}
  <ChatGenerationSettingsControls />
  <CustomSideBar />

  {#if hasJailbreakPrompt}
    <div
      class="flex mt-2 items-center"
      data-risu-generation-jailbreak-control
      data-risu-toggle-key="jailbreakToggle"
      data-risu-toggle-kind="jailbreak"
      data-risu-input-kind="checkbox"
      data-risu-selected={getJailbreakToggleValue() ? 'true' : 'false'}
      data-risu-toggle-preset-different={isJailbreakTogglePresetDifferent() ? 'true' : 'false'}
      class:bg-red-900={isJailbreakTogglePresetDifferent()}
      class:rounded-sm={isJailbreakTogglePresetDifferent()}>
      <CheckInput
        bind:check={() => getJailbreakToggleValue(), setJailbreakToggleValue}
        name={language.jailbreakToggle} />
    </div>
  {/if}
  {@render toggles(displayedSidebarToggles)}
  {#if chara && getDatabase().hypaV3}
    <div class="flex mt-2 items-center" data-risu-hypa-memory-toggle>
      <CheckInput check={chara.supaMemory} name={language.ToggleHypaMemory} onChange={setSupaMemoryValue} />
    </div>
  {/if}
  {#if chara}
    <div class="flex mt-2 items-center" data-risu-input-translation-hook-toggle>
      <CheckInput
        check={chara.useInputTranslationHook}
        name={language.useInputTranslationHook}
        onChange={setInputTranslationHookValue} />
    </div>
  {/if}
  <ChatGenerationResetDefaultsButton />
  <ChatGenerationTogglePresets bind:selectedPresetId={selectedTogglePresetId} />
{/if}
