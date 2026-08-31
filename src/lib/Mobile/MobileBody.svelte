<script lang="ts" module>
  import { selectCharacterOwner } from 'src/ts/characterState'
  import { isServerCharacterShell, type character } from 'src/ts/storage/database.svelte'

  interface MobileSelectedCharacterInput {
    ownerCharacters: readonly character[]
    ownerStatus: 'idle' | 'loading' | 'ready' | 'error'
    ownerSelectedIndex: number
    compatibilitySelectedIndex: number
    readCompatibilityCharacters: () => readonly character[]
  }

  export function resolveMobileSelectedCharacter({
    ownerCharacters,
    ownerStatus,
    ownerSelectedIndex,
    compatibilitySelectedIndex,
    readCompatibilityCharacters,
  }: MobileSelectedCharacterInput): character | undefined {
    if (ownerStatus === 'ready') {
      return selectCharacterOwner(ownerCharacters, ownerSelectedIndex)
    }
    if (ownerStatus !== 'idle' && ownerStatus !== 'loading') return undefined

    const compatibilityCharacters = readCompatibilityCharacters()
    const compatibilityCandidate = compatibilityCharacters[compatibilitySelectedIndex]
    const compatibilityCharacter = compatibilityCandidate?.chaId
      ? selectCharacterOwner(compatibilityCharacters, compatibilitySelectedIndex)
      : compatibilityCandidate
    if (compatibilityCandidate?.chaId && !compatibilityCharacter) return undefined

    const characterId = compatibilityCharacter?.chaId ?? ownerCharacters[compatibilitySelectedIndex]?.chaId
    if (!characterId) {
      const owner = ownerCharacters[compatibilitySelectedIndex]
      return owner && !isServerCharacterShell(owner) ? owner : compatibilityCharacter
    }

    const ownerIndex = ownerCharacters.findIndex((candidate) => candidate?.chaId === characterId)
    const owner = selectCharacterOwner(ownerCharacters, ownerIndex)
    if (ownerIndex >= 0 && !owner) return undefined
    return owner && !isServerCharacterShell(owner) ? owner : compatibilityCharacter
  }

  export function shouldRenderMobileChat(selectedCharacter: character | undefined): boolean {
    return selectedCharacter !== undefined
  }
</script>

<script lang="ts">
  import { MobileGUIStack, MobileSideBar, selectedCharID } from 'src/ts/stores.svelte'
  import Settings from '../Setting/Settings.svelte'
  import RealmMain from '../UI/Realm/RealmMain.svelte'
  import MobileCharacters from './MobileCharacters.svelte'
  import ChatScreen from '../ChatScreens/ChatScreen.svelte'
  import CharConfig from '../SideBars/CharConfig.svelte'
  import { WrenchIcon } from '@lucide/svelte'
  import { language } from 'src/lang'
  import SideChatList from '../SideBars/SideChatList.svelte'
  import DevTool from '../SideBars/DevTool.svelte'
  import { isLite } from 'src/ts/lite'

  import { charactersResourceState, getResourceDatabase as getDatabase } from 'src/ts/server/resourceState.svelte'

  let selectedMobileCharacter = $derived(
    resolveMobileSelectedCharacter({
      ownerCharacters: charactersResourceState.characters,
      ownerStatus: charactersResourceState.status,
      ownerSelectedIndex: charactersResourceState.currentChar,
      compatibilitySelectedIndex: $selectedCharID,
      readCompatibilityCharacters: () =>
        charactersResourceState.status === 'idle' || charactersResourceState.status === 'loading'
          ? getDatabase().characters
          : [],
    }),
  )
</script>

{#if $MobileSideBar > 0 && !$isLite}
  <div
    class="w-full px-2 py-1 text-textcolor2 border-b border-b-darkborderc bg-darkbg flex justify-start items-center gap-2">
    <button
      class="flex-1 border-r border-r-darkborderc"
      class:text-textcolor={$MobileSideBar === 1}
      onclick={() => {
        $MobileSideBar = 1
      }}>
      {language.Chat}
    </button>
    <button
      class="flex-1 border-r border-r-darkborderc"
      class:text-textcolor={$MobileSideBar === 2}
      onclick={() => {
        $MobileSideBar = 2
      }}>
      {language.character}
    </button>
    <button
      type="button"
      aria-label={language.tools}
      class:text-textcolor={$MobileSideBar === 3}
      onclick={() => {
        $MobileSideBar = 3
      }}>
      <WrenchIcon size={18} />
    </button>
  </div>
{/if}
<div class="w-full flex-1 overflow-y-auto bg-bgcolor relative">
  {#if $MobileSideBar > 0}
    <div class="w-full flex flex-col p-2 mt-2 h-full">
      {#if $MobileSideBar === 1}
        {#if selectedMobileCharacter}
          <SideChatList chara={selectedMobileCharacter} />
        {/if}
      {:else if $MobileSideBar === 2}
        <CharConfig />
      {:else if $MobileSideBar === 3}
        <DevTool />
      {/if}
    </div>
  {:else if shouldRenderMobileChat(selectedMobileCharacter)}
    <ChatScreen />
  {:else if $MobileGUIStack === 0}
    <RealmMain />
  {:else if $MobileGUIStack === 1}
    <MobileCharacters />
  {:else if $MobileGUIStack === 2}
    <Settings />
  {/if}
</div>
