<script lang="ts" module>
  export function resolveSelectedCharacterForDisplay<T>(
    owner: T | undefined,
    resourceStatus: string,
    compatibilityOwner: T | undefined,
  ): T | undefined {
    if (resourceStatus === 'ready') return owner
    if (resourceStatus === 'idle' || resourceStatus === 'loading') return compatibilityOwner
    return undefined
  }
</script>

<script lang="ts">
  import {
    getCustomBackground,
    getEmotionForCharacter,
    getSelectedCharacterOwner,
    selectCharacterOwner,
  } from '../../ts/characterState'

  import { isServerCharacterShell, type Database, type character } from 'src/ts/storage/database.svelte'
  import {
    charactersResourceState,
    getChatMetadataOwnerState,
    settingsResourceState,
  } from 'src/ts/server/resourceState.svelte'
  import { CharEmotion, selectedCharID } from '../../ts/stores.svelte'
  import ResizeBox from './ResizeBox.svelte'
  import DefaultChatScreen from './DefaultChatScreen.svelte'
  import defaultWallpaper from '../../etc/bg.jpg'
  import TransitionImage from './TransitionImage.svelte'
  import BackgroundDom from './BackgroundDom.svelte'
  import SideBarArrow from '../UI/GUI/SideBarArrow.svelte'
  import { createLatestBackgroundLoader } from './ChatScreenBackground'
  import LazyComponent from '../UI/LazyComponent.svelte'
  import CharacterShellHydrationGate from './CharacterShellHydrationGate.svelte'
  import { currentRoute, type AppRoute } from 'src/ts/router'
  import { language } from 'src/lang'

  let { route }: { route?: AppRoute } = $props()
  let visibleRoute = $derived(route ?? $currentRoute)

  const loadChatList = () => import('../Others/ChatList.svelte')
  const loadModuleChatMenu = () => import('../Setting/Pages/Module/ModuleChatMenu.svelte')
  const loadBardWikiWorkspace = () => import('./BardWikiWorkspace.svelte')
  let openChatList = $state(false)
  let openModuleList = $state(false)
  let openBardWiki = $state(false)
  let bardWikiChatId = $state<string | null>(null)
  let selectedCharacter = $derived.by(() => {
    // Home, Settings, and non-chat Playground routes intentionally clear the
    // view selection without changing the durable last-selected character.
    // Do not let that retained owner activate the shell-hydration gate over a
    // route that is supposed to render a menu.
    if ($selectedCharID < 0) return undefined
    const status = charactersResourceState.status
    const character = resolveSelectedCharacterForDisplay(
      status === 'ready' ? getSelectedCharacterOwner() : undefined,
      status,
      status === 'idle' || status === 'loading'
        ? selectCharacterOwner(charactersResourceState.characters, $selectedCharID)
        : undefined,
    )
    if (character?.chaId && charactersResourceState.rowStatuses[character.chaId] === 'error') return undefined
    return character
  })

  function stableId(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0
  }

  function uniqueSelectedChatId(characterOwner: character | undefined): string | null {
    const characterId = characterOwner?.chaId
    const chatId = characterOwner?.chats?.[characterOwner.chatPage]?.id
    if (!stableId(characterId) || !stableId(chatId)) return null
    if (charactersResourceState.characters.filter((character) => character?.chaId === characterId).length !== 1) {
      return null
    }
    const matchCount = charactersResourceState.characters.reduce(
      (count, character) => count + (character.chats ?? []).filter((chat) => chat?.id === chatId).length,
      0,
    )
    return matchCount === 1 ? chatId : null
  }

  let selectedChatId = $derived.by(() => {
    const chatId = uniqueSelectedChatId(selectedCharacter)
    if (!chatId) return null
    if (charactersResourceState.status === 'ready') return getChatMetadataOwnerState(chatId)?.chatId ?? null
    if (charactersResourceState.status !== 'idle' && charactersResourceState.status !== 'loading') return null
    return chatId
  })
  let selectedCharacterShellId = $derived(
    isServerCharacterShell(selectedCharacter) ? (selectedCharacter?.chaId ?? null) : null,
  )

  $effect(() => {
    if (!openBardWiki) {
      bardWikiChatId = null
      return
    }
    if (!selectedChatId) {
      openBardWiki = false
      return
    }
    if (bardWikiChatId === null) {
      bardWikiChatId = selectedChatId
      return
    }
    if (bardWikiChatId !== selectedChatId) openBardWiki = false
  })

  const wallPaper = `background: url(${defaultWallpaper})`
  function readDisplaySettings(): Partial<Database> {
    const status = settingsResourceState.groupStatuses.display ?? 'idle'
    if (status === 'ready') return settingsResourceState.value as Partial<Database>
    if (status === 'idle' || status === 'loading') return settingsResourceState.value as Partial<Database>
    return {}
  }

  let displaySettings = $derived(readDisplaySettings())
  let theme = $derived(typeof displaySettings.theme === 'string' ? displaySettings.theme : 'fastify')
  let waifuWidth = $derived(typeof displaySettings.waifuWidth === 'number' ? displaySettings.waifuWidth : 100)
  let waifuWidth2 = $derived(typeof displaySettings.waifuWidth2 === 'number' ? displaySettings.waifuWidth2 : 100)
  let classicMaxWidth = $derived(displaySettings.classicMaxWidth === true)
  const externalStyles = $derived.by(() => {
    const settings = displaySettings
    return (
      'background: ' +
      (settings.textScreenColor ? settings.textScreenColor + '80' : 'rgba(0,0,0,0.8)') +
      ';\n' +
      (settings.textBorder ? 'text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000;' : '') +
      (settings.textScreenRounded ? 'border-radius: 2rem; padding: 1rem;' : '') +
      (settings.textScreenBorder ? `border: 0.3rem solid ${settings.textScreenBorder};` : '')
    )
  })
  let bgImg = $state('')
  let lastBg = $state('')
  const loadLatestBackground = createLatestBackgroundLoader(getCustomBackground)
  $effect.pre(() => {
    ;(async () => {
      const customBackground =
        typeof displaySettings.customBackground === 'string' ? displaySettings.customBackground : ''
      if (customBackground !== lastBg) {
        lastBg = customBackground
        const loadedBackground = await loadLatestBackground(customBackground)
        if (loadedBackground !== undefined) {
          bgImg = loadedBackground
        }
      }
    })()
  })
</script>

{#if selectedCharacterShellId}
  <CharacterShellHydrationGate characterId={selectedCharacterShellId} />
{:else if theme === 'waifu'}
  <div class="grow h-full flex justify-center relative" style={bgImg.length < 4 ? wallPaper : bgImg}>
    <SideBarArrow />
    <BackgroundDom />
    {#if selectedCharacter}
      {#if selectedCharacter?.viewScreen !== 'none'}
        <div class="h-full mr-10 flex justify-end halfw" style:width="{42 * (waifuWidth2 / 100)}rem">
          <TransitionImage classType="waifu" src={getEmotionForCharacter(selectedCharacter, $CharEmotion, 'plain')} />
        </div>
      {/if}
    {/if}
    <div
      class="h-full w-2xl"
      style:width="{42 * (waifuWidth / 100)}rem"
      class:halfwp={selectedCharacter !== undefined && selectedCharacter?.viewScreen !== 'none'}>
      <DefaultChatScreen
        route={visibleRoute}
        customStyle={`${externalStyles}backdrop-filter: blur(4px);`}
        bind:openChatList
        bind:openModuleList
        bind:openBardWiki />
    </div>
  </div>
{:else if theme === 'waifuMobile'}
  <div class="grow h-full relative" style={bgImg.length < 4 ? wallPaper : bgImg}>
    <SideBarArrow />
    <BackgroundDom />
    <div
      class="w-full absolute z-10 bottom-0 left-0"
      class:per33={selectedCharacter !== undefined && selectedCharacter?.viewScreen !== 'none'}
      class:h-full={!(selectedCharacter !== undefined && selectedCharacter?.viewScreen !== 'none')}>
      <DefaultChatScreen
        route={visibleRoute}
        customStyle={`${externalStyles}backdrop-filter: blur(4px);`}
        bind:openChatList
        bind:openModuleList
        bind:openBardWiki />
    </div>
    {#if selectedCharacter}
      {#if selectedCharacter?.viewScreen !== 'none'}
        <div class="h-full w-full absolute bottom-0 left-0 max-w-full">
          <TransitionImage classType="mobile" src={getEmotionForCharacter(selectedCharacter, $CharEmotion, 'plain')} />
        </div>
      {/if}
    {/if}
  </div>
{:else}
  <div class="grow h-full min-w-0 relative justify-center flex">
    <SideBarArrow />
    <BackgroundDom />
    <div style={bgImg} class="h-full w-full" class:max-w-6xl={classicMaxWidth}>
      {#if selectedCharacter}
        {#if selectedCharacter?.viewScreen !== 'none' && !selectedCharacter?.inlayViewScreen}
          <ResizeBox />
        {/if}
      {/if}
      <DefaultChatScreen
        route={visibleRoute}
        customStyle={bgImg.length > 2 ? `${externalStyles}` : ''}
        bind:openChatList
        bind:openModuleList
        bind:openBardWiki />
    </div>
  </div>
{/if}
{#if openChatList}
  <LazyComponent
    loader={loadChatList}
    componentProps={{ close: () => (openChatList = false) }}
    modal
    onDismiss={() => (openChatList = false)}
    testId="chat-list" />
{:else if openModuleList}
  <LazyComponent
    loader={loadModuleChatMenu}
    componentProps={{ close: () => (openModuleList = false) }}
    modal
    onDismiss={() => (openModuleList = false)}
    testId="module-chat-menu" />
{:else if openBardWiki && bardWikiChatId}
  <LazyComponent
    loader={loadBardWikiWorkspace}
    componentProps={{ chatId: bardWikiChatId, close: () => (openBardWiki = false) }}
    modal
    label={language.bardWiki.workspaceTitle}
    onDismiss={() => (openBardWiki = false)}
    testId="bardwiki-workspace" />
{/if}

<style>
  .halfw {
    max-width: calc(50% - 5rem);
  }
  .halfwp {
    max-width: calc(50% - 5rem);
  }
  .per33 {
    height: 33.333333%;
  }
</style>
