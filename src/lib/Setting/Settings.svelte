<script lang="ts">
  import {
    AccessibilityIcon,
    ActivityIcon,
    PackageIcon,
    BotIcon,
    BoxIcon,
    CodeIcon,
    ContactIcon,
    HardDrive,
    LanguagesIcon,
    MonitorIcon,
    Sailboat,
    CircleXIcon,
    KeyboardIcon,
    SparkleIcon,
    ArrowLeftIcon,
    WorkflowIcon,
  } from '@lucide/svelte'
  import { language } from 'src/lang'
  import DisplaySettings from './Pages/DisplaySettings.svelte'
  import UserSettings from './Pages/UserSettings.svelte'
  import BotSettings from './Pages/BotSettings.svelte'
  import OtherBotSettings from './Pages/OtherBotSettings.svelte'
  import PluginSettings from './Pages/PluginSettings.svelte'
  import AdvancedSettings from './Pages/AdvancedSettings.svelte'
  import AgentPresetSettings from './Pages/AgentPresetSettings.svelte'
  import { additionalSettingsMenu, easyPanelStore, MobileGUI, SettingsMenuIndex } from 'src/ts/stores.svelte'
  import { getResourceDatabase as getDatabase } from 'src/ts/server/resourceState.svelte'
  import Communities from './Pages/Communities.svelte'
  import GlobalLoreBookSettings from './Pages/GlobalLoreBookSettings.svelte'
  import Lorepreset from './lorepreset.svelte'
  import GlobalRegex from './Pages/GlobalRegex.svelte'
  import LanguageSettings from './Pages/LanguageSettings.svelte'
  import AccessibilitySettings from './Pages/AccessibilitySettings.svelte'
  import PersonaSettings from './Pages/PersonaSettings.svelte'
  import PromptSettings from './Pages/PromptSettings.svelte'
  import ThanksPage from './Pages/ThanksPage.svelte'
  import ModuleSettings from './Pages/Module/ModuleSettings.svelte'
  import { isLite } from 'src/ts/lite'
  import HotkeySettings from './Pages/HotkeySettings.svelte'
  import PluginDefinedIcon from '../Others/PluginDefinedIcon.svelte'
  import { alertConfirm } from 'src/ts/alert'
  import { navigate } from 'src/ts/router'

  let openLoreList = $state(false)
  let supporterConfirmOpen = $state(false)
  let viewportWidth = $state(window.innerWidth)
  let splitSettingsLayout = $derived(viewportWidth >= 700 && !$MobileGUI)
  let mobileSettingsLayout = $derived(!splitSettingsLayout)

  function updateViewportWidth(): void {
    viewportWidth = window.innerWidth
  }

  $effect(() => {
    if (splitSettingsLayout && $SettingsMenuIndex === -1) {
      $SettingsMenuIndex = 17
    }
  })

  async function openSupporterThanks() {
    if ($SettingsMenuIndex === 77 || supporterConfirmOpen) return

    if (getDatabase().doNotWarnExternalServers) {
      navigate('/settings/supporter')
      return
    }

    supporterConfirmOpen = true
    try {
      if (await alertConfirm(language.sendExternalServerWarning)) {
        navigate('/settings/supporter')
      }
    } finally {
      supporterConfirmOpen = false
    }
  }

  function navButtonClass(active: boolean): Record<string, boolean> {
    return {
      'flex min-h-9 w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:text-textcolor': true,
      'hover:bg-bgcolor': !$MobileGUI,
      'hover:bg-darkbg': $MobileGUI,
      'bg-bgcolor text-textcolor': active && !$MobileGUI,
      'bg-darkbg text-textcolor': active && $MobileGUI,
      'text-textcolor2': !active,
    }
  }

  function goBackToSettingsList() {
    navigate('/settings', { replace: true })
  }
</script>

<svelte:window onresize={updateViewportWidth} />

<div
  class="h-full w-full flex justify-center rs-setting-cont"
  class:bg-bgcolor={$MobileGUI}
  class:setting-bg={!$MobileGUI}>
  <div class="h-full max-w-(--breakpoint-lg) w-full flex relative rs-setting-cont-2">
    {#if splitSettingsLayout || $SettingsMenuIndex === -1}
      <div
        class="flex h-full flex-col gap-4 overflow-y-auto relative rs-setting-cont-3 shrink-0 px-3 py-4 pt-8"
        class:w-full={mobileSettingsLayout}
        class:bg-darkbg={!$MobileGUI}
        class:bg-bgcolor={$MobileGUI}>
        {#if !$isLite}
          <div class="flex flex-col gap-1">
            <span class="px-2 text-xs font-semibold uppercase text-textcolor2">{language.settingsGroupChatSetup}</span>
            <button
              class={navButtonClass($SettingsMenuIndex === 17)}
              onclick={() => {
                navigate('/settings/model')
              }}>
              <ActivityIcon size={20} />
              <span>{language.settingsNavModelProfiles}</span>
            </button>
            <button
              class={navButtonClass($SettingsMenuIndex === 18 || $SettingsMenuIndex === 13)}
              onclick={() => {
                navigate('/settings/prompt-settings')
              }}>
              <SparkleIcon size={20} />
              <span>{language.settingsNavPromptPresets}</span>
            </button>
            <button
              class={navButtonClass($SettingsMenuIndex === 19)}
              onclick={() => {
                navigate('/settings/agent-presets')
              }}>
              <WorkflowIcon size={20} />
              <span>{language.settingsNavAgentPresets}</span>
            </button>
            {#if getDatabase().botPresets?.length > 0}
              <button
                class={navButtonClass($SettingsMenuIndex === 1)}
                onclick={() => {
                  navigate('/settings/bot-preset')
                }}>
                <BotIcon size={20} />
                <span>{language.settingsNavLegacyBotPresets}</span>
              </button>
            {/if}
            <button
              class={navButtonClass($SettingsMenuIndex === 12)}
              onclick={() => {
                navigate('/settings/persona')
              }}>
              <ContactIcon size={20} />
              <span>{language.settingsNavUserPersona}</span>
            </button>
          </div>

          <div class="flex flex-col gap-1">
            <span class="px-2 text-xs font-semibold uppercase text-textcolor2"
              >{language.settingsGroupCapabilities}</span>
            <button
              class={navButtonClass($SettingsMenuIndex === 2)}
              onclick={() => {
                navigate('/settings/other-bots')
              }}>
              <Sailboat size={20} />
              <span>{language.settingsNavMediaMemory}</span>
            </button>
            <button
              class={navButtonClass($SettingsMenuIndex === 14)}
              onclick={() => {
                navigate('/settings/modules')
              }}>
              <PackageIcon size={20} />
              <span>{language.settingsNavModules}</span>
            </button>
            <button
              class={navButtonClass($SettingsMenuIndex === 4)}
              onclick={() => {
                navigate('/settings/plugins')
              }}>
              <CodeIcon size={20} />
              <span>{language.settingsNavPlugins}</span>
            </button>
          </div>
        {/if}

        <div class="flex flex-col gap-1">
          <span class="px-2 text-xs font-semibold uppercase text-textcolor2">{language.settingsGroupInterface}</span>
          {#if !$isLite}
            <button
              class={navButtonClass($SettingsMenuIndex === 3)}
              onclick={() => {
                navigate('/settings/display')
              }}>
              <MonitorIcon size={20} />
              <span>{language.settingsNavDisplayAudio}</span>
            </button>
          {/if}
          <button
            class={navButtonClass($SettingsMenuIndex === 10)}
            onclick={() => {
              navigate('/settings/language')
            }}>
            <LanguagesIcon size={20} />
            <span>{language.settingsNavLanguage}</span>
          </button>
          {#if !$isLite}
            <button
              class={navButtonClass($SettingsMenuIndex === 11)}
              onclick={() => {
                navigate('/settings/accessibility')
              }}>
              <AccessibilityIcon size={20} />
              <span>{language.settingsNavAccessibility}</span>
            </button>
          {/if}
          <button
            class={navButtonClass($SettingsMenuIndex === 15)}
            onclick={() => {
              navigate('/settings/hotkeys')
            }}>
            <KeyboardIcon size={20} />
            <span>{language.settingsNavKeyboardShortcuts}</span>
          </button>
        </div>

        <div class="flex flex-col gap-1">
          <span class="px-2 text-xs font-semibold uppercase text-textcolor2">{language.settingsGroupData}</span>
          <button
            class={navButtonClass($SettingsMenuIndex === 0)}
            onclick={() => {
              navigate('/settings/backup')
            }}>
            <HardDrive size={20} />
            <span>{language.settingsNavBackups}</span>
          </button>
        </div>

        {#if !$isLite}
          <div class="flex flex-col gap-1">
            <span class="px-2 text-xs font-semibold uppercase text-textcolor2"
              >{language.settingsGroupAboutAdvanced}</span>
            <button
              class={navButtonClass($SettingsMenuIndex === 6)}
              onclick={() => {
                navigate('/settings/advanced')
              }}>
              <ActivityIcon size={20} />
              <span>{language.settingsNavAdvanced}</span>
            </button>
            <button class={navButtonClass($SettingsMenuIndex === 77)} onclick={openSupporterThanks}>
              <BoxIcon size={20} />
              <span>{language.settingsNavSupporters}</span>
            </button>
            {#each additionalSettingsMenu as menu}
              <button class={navButtonClass(false)} onclick={menu.callback}>
                <PluginDefinedIcon ico={menu} />
                <span>{menu.name}</span>
              </button>
            {/each}

            {#if getDatabase().enableRisuaiProTools}
              <button
                class={navButtonClass($SettingsMenuIndex === 16)}
                onclick={() => {
                  easyPanelStore.open = true
                }}>
                <!-- From Lucide Icons, licensed under MIT/ISC License, modified to fit the design. see license from bundled lucide icons. -->
                <svg width={20} height={20}>
                  <defs>
                    <linearGradient id={`grad1`} x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" style="stop-color:#587bff" />
                      <stop offset="100%" style="stop-color:#00a1ad" />
                    </linearGradient>
                  </defs>
                  <SparkleIcon color="url(#grad1)" size={20} />
                </svg>
                <span>{language.settingsNavEasyPanel}</span>
              </button>
            {/if}
          </div>
        {/if}
        {#if mobileSettingsLayout && !$MobileGUI}
          <button
            class="absolute top-2 right-2 hover:text-green-500 text-textcolor"
            onclick={() => {
              navigate('/')
            }}>
            <CircleXIcon size={getDatabase().settingsCloseButtonSize} />
          </button>
        {/if}
      </div>
    {/if}
    {#if splitSettingsLayout || $SettingsMenuIndex !== -1}
      {#key $SettingsMenuIndex}
        <div
          class="grow py-6 px-4 bg-bgcolor flex flex-col text-textcolor overflow-y-auto relative rs-setting-cont-4 min-w-0"
          class:pt-12={mobileSettingsLayout && $SettingsMenuIndex !== -1}>
          {#if mobileSettingsLayout && $SettingsMenuIndex !== -1}
            <button
              class="absolute top-2 left-2 hover:text-green-500 text-textcolor"
              title={language.goback}
              data-risu-settings-mobile-back
              onclick={goBackToSettingsList}>
              <ArrowLeftIcon size={getDatabase().settingsCloseButtonSize} />
              <span class="sr-only">{language.goback}</span>
            </button>
          {/if}
          {#if $SettingsMenuIndex === 0}
            <UserSettings />
          {:else if $SettingsMenuIndex === 1}
            {#if getDatabase().botPresets?.length > 0}
              <BotSettings
                settingsKind="legacy"
                goPromptTemplate={() => {
                  navigate('/settings/prompt')
                }} />
            {:else}
              <BotSettings settingsKind="model" />
            {/if}
          {:else if $SettingsMenuIndex === 2}
            <OtherBotSettings />
          {:else if $SettingsMenuIndex === 3}
            <DisplaySettings />
          {:else if $SettingsMenuIndex === 4}
            <PluginSettings />
          {:else if $SettingsMenuIndex === 6}
            <AdvancedSettings />
          {:else if $SettingsMenuIndex === 7}
            <Communities />
          {:else if $SettingsMenuIndex === 8}
            <GlobalLoreBookSettings bind:openLoreList />
          {:else if $SettingsMenuIndex === 9}
            <GlobalRegex />
          {:else if $SettingsMenuIndex === 10}
            <LanguageSettings />
          {:else if $SettingsMenuIndex === 11}
            <AccessibilitySettings />
          {:else if $SettingsMenuIndex === 12}
            <PersonaSettings />
          {:else if $SettingsMenuIndex === 14}
            <ModuleSettings />
          {:else if $SettingsMenuIndex === 13}
            <PromptSettings
              onGoBack={() => {
                navigate('/settings/prompt-settings')
              }} />
          {:else if $SettingsMenuIndex === 15}
            <HotkeySettings />
          {:else if $SettingsMenuIndex === 17}
            <BotSettings settingsKind="model" />
          {:else if $SettingsMenuIndex === 18}
            <BotSettings
              settingsKind="prompt"
              goPromptTemplate={() => {
                navigate('/settings/prompt')
              }} />
          {:else if $SettingsMenuIndex === 19}
            <AgentPresetSettings />
          {:else if $SettingsMenuIndex === 77}
            <ThanksPage />
          {/if}
        </div>
      {/key}
      {#if !$MobileGUI}
        <button
          class="absolute top-2 right-2 hover:text-green-500 text-textcolor"
          onclick={() => {
            navigate('/')
          }}>
          <CircleXIcon size={getDatabase().settingsCloseButtonSize} />
        </button>
      {/if}
    {/if}
  </div>
</div>
{#if openLoreList}
  <Lorepreset
    close={() => {
      openLoreList = false
    }} />
{/if}

<style>
  .setting-bg {
    background: linear-gradient(to right, var(--risu-theme-darkbg) 50%, var(--risu-theme-bgcolor) 50%);
  }
</style>
