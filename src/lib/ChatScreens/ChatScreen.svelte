<script lang="ts" module>
  export function resolveSelectedCharacterForDisplay<T>(
    owner: T | undefined,
    resourceStatus: string,
    aggregate: T | undefined,
  ): T | undefined {
    return owner ?? (resourceStatus === 'ready' ? undefined : aggregate)
  }
</script>

<script lang="ts">
  import { getCustomBackground, getEmotionForCharacter, getSelectedCharacterOwner } from '../../ts/characterState'

  import { getDatabase, isServerCharacterShell } from 'src/ts/storage/database.svelte'
  import { charactersResourceState } from 'src/ts/server/resourceState.svelte'
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
  let selectedCharacter = $derived(
    $selectedCharID >= 0
      ? resolveSelectedCharacterForDisplay(
          getSelectedCharacterOwner(),
          charactersResourceState.status,
          getDatabase().characters?.[$selectedCharID],
        )
      : undefined,
  )
  let selectedChatId = $derived(selectedCharacter?.chats?.[selectedCharacter.chatPage]?.id ?? null)
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
  const externalStyles = $derived.by(() => {
    const database = getDatabase()
    return (
      'background: ' +
      (database.textScreenColor ? database.textScreenColor + '80' : 'rgba(0,0,0,0.8)') +
      ';\n' +
      (database.textBorder ? 'text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000;' : '') +
      (database.textScreenRounded ? 'border-radius: 2rem; padding: 1rem;' : '') +
      (database.textScreenBorder ? `border: 0.3rem solid ${database.textScreenBorder};` : '')
    )
  })
  let bgImg = $state('')
  let lastBg = $state('')
  const loadLatestBackground = createLatestBackgroundLoader(getCustomBackground)
  $effect.pre(() => {
    ;(async () => {
      const customBackground = getDatabase().customBackground
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
{:else if getDatabase().theme === 'waifu'}
  <div class="grow h-full flex justify-center relative" style={bgImg.length < 4 ? wallPaper : bgImg}>
    <SideBarArrow />
    <BackgroundDom />
    {#if $selectedCharID >= 0}
      {#if selectedCharacter?.viewScreen !== 'none'}
        <div class="h-full mr-10 flex justify-end halfw" style:width="{42 * (getDatabase().waifuWidth2 / 100)}rem">
          <TransitionImage classType="waifu" src={getEmotionForCharacter(selectedCharacter, $CharEmotion, 'plain')} />
        </div>
      {/if}
    {/if}
    <div
      class="h-full w-2xl"
      style:width="{42 * (getDatabase().waifuWidth / 100)}rem"
      class:halfwp={$selectedCharID >= 0 && selectedCharacter?.viewScreen !== 'none'}>
      <DefaultChatScreen
        route={visibleRoute}
        customStyle={`${externalStyles}backdrop-filter: blur(4px);`}
        bind:openChatList
        bind:openModuleList
        bind:openBardWiki />
    </div>
  </div>
{:else if getDatabase().theme === 'waifuMobile'}
  <div class="grow h-full relative" style={bgImg.length < 4 ? wallPaper : bgImg}>
    <SideBarArrow />
    <BackgroundDom />
    <div
      class="w-full absolute z-10 bottom-0 left-0"
      class:per33={$selectedCharID >= 0 && selectedCharacter?.viewScreen !== 'none'}
      class:h-full={!($selectedCharID >= 0 && selectedCharacter?.viewScreen !== 'none')}>
      <DefaultChatScreen
        route={visibleRoute}
        customStyle={`${externalStyles}backdrop-filter: blur(4px);`}
        bind:openChatList
        bind:openModuleList
        bind:openBardWiki />
    </div>
    {#if $selectedCharID >= 0}
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
    <div style={bgImg} class="h-full w-full" class:max-w-6xl={getDatabase().classicMaxWidth}>
      {#if $selectedCharID >= 0}
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
