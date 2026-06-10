<script lang="ts">
  import { DBState, MobileGUI, selectedCharID } from 'src/ts/stores.svelte'
  import { language } from 'src/lang'
  import type { character } from 'src/ts/storage/database.svelte'
  import CheckInput from '../UI/GUI/CheckInput.svelte'
  import SelectInput from '../UI/GUI/SelectInput.svelte'
  import OptionInput from '../UI/GUI/OptionInput.svelte'
  import TextAreaInput from '../UI/GUI/TextAreaInput.svelte'
  import TextInput from '../UI/GUI/TextInput.svelte'
  import CustomSideBar from './CustomSidebar.svelte'
  import { setCharacterSupaMemory } from 'src/ts/characterCommands'
  import {
    resolveActiveChatGenerationSettings,
    saveActiveChatJailbreakToggleGenerationSettings,
    saveActiveChatSidebarToggleGenerationSettings,
  } from 'src/ts/activeChatGenerationSettings'
  import type { ChatGenerationRequiredSidebarToggle } from 'src/ts/chatGenerationSettings'

  interface Props {
    chara?: character
    noContainer?: boolean
  }

  let { chara = $bindable(), noContainer }: Props = $props()

  let activeGenerationSettings = $derived.by(() =>
    resolveActiveChatGenerationSettings({
      selectedCharIndex: $selectedCharID,
    }),
  )

  let hasJailbreakPrompt = $derived.by(
    () => activeGenerationSettings.readiness.requirements.jailbreakToggle.displayed,
  )

  let requiredSidebarToggles = $derived.by(() => activeGenerationSettings.requiredSidebarToggles)

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
</script>

{#snippet toggles(items: ChatGenerationRequiredSidebarToggle[], reverse: boolean = false)}
  {#each items as toggle}
    {#if toggle.kind === 'select'}
      <div class="w-full flex gap-2 mt-2 items-center" class:justify-end={$MobileGUI}>
        <span>{toggle.label}</span>
        <SelectInput
          className="w-32"
          bind:value={
            () => getToggleValue(toggle.key), (value) => setToggleValue(toggle.key, String(value))
          }
        >
          {#each toggle.options as option, i}
            <OptionInput value={i.toString()}>{option}</OptionInput>
          {/each}
        </SelectInput>
      </div>
    {:else if toggle.kind === 'text'}
      <div class="w-full flex gap-2 mt-2 items-center" class:justify-end={$MobileGUI}>
        <span>{toggle.label}</span>
        <TextInput
          className="w-32"
          bind:value={
            () => getToggleValue(toggle.key), (value) => setToggleValue(toggle.key, value)
          }
        />
      </div>
    {:else if toggle.kind === 'textarea'}
      <div class="w-full flex gap-2 mt-2 items-start" class:justify-end={$MobileGUI}>
        <span class="mt-1.5">{toggle.label}</span>
        <TextAreaInput
          className="w-32"
          height="20"
          bind:value={
            () => getToggleValue(toggle.key), (value) => setToggleValue(toggle.key, value)
          }
        />
      </div>
    {:else}
      <div class="w-full flex mt-2 items-center" class:justify-end={$MobileGUI}>
        <CheckInput
          check={getToggleValue(toggle.key) === '1'}
          {reverse}
          name={toggle.label}
          onChange={(check) => {
            setToggleValue(toggle.key, check ? '1' : '0')
          }}
        />
      </div>
    {/if}
  {/each}
{/snippet}

{#if !noContainer && requiredSidebarToggles.length > 4}
  <div
    class="h-48 border-darkborderc p-2 border rounded-sm flex flex-col items-start mt-2 overflow-y-auto"
  >
    <CustomSideBar />

    {#if hasJailbreakPrompt}
      <div class="flex mt-2 items-center w-full" class:justify-end={$MobileGUI}>
        <CheckInput
          bind:check={() => getJailbreakToggleValue(), setJailbreakToggleValue}
          name={language.jailbreakToggle}
          reverse
        />
      </div>
    {/if}

    {@render toggles(requiredSidebarToggles, true)}
    {#if chara && DBState.db.hypaV3}
      <div class="flex mt-2 items-center w-full" class:justify-end={$MobileGUI}>
        <CheckInput
          check={chara.supaMemory}
          reverse
          name={language.ToggleHypaMemory}
          onChange={setSupaMemoryValue}
        />
      </div>
    {/if}
  </div>
{:else}
  <CustomSideBar />

  {#if hasJailbreakPrompt}
    <div class="flex mt-2 items-center">
      <CheckInput
        bind:check={() => getJailbreakToggleValue(), setJailbreakToggleValue}
        name={language.jailbreakToggle}
      />
    </div>
  {/if}
  {@render toggles(requiredSidebarToggles)}
  {#if chara && DBState.db.hypaV3}
    <div class="flex mt-2 items-center">
      <CheckInput
        check={chara.supaMemory}
        name={language.ToggleHypaMemory}
        onChange={setSupaMemoryValue}
      />
    </div>
  {/if}
{/if}
