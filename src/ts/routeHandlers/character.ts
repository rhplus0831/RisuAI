import { get } from 'svelte/store'
import { characterRoutePath, type AppRoute } from '../routerRoute'
import { charactersResourceState } from '../server/resourceState.svelte'
import { OpenRealmStore, PlaygroundStore, selectedCharID, settingsOpen } from '../stores.svelte'
import { changeChar } from '../characters'
import type { character } from '../storage/database.svelte'

interface CharacterRouteContext {
  isFresh: () => boolean
  replacePath: (path: string) => void
}

export async function applyCharacterRoute(
  route: Extract<AppRoute, { kind: 'character' }>,
  context: CharacterRouteContext,
): Promise<void> {
  if (!context.isFresh()) return

  const index = findRouteCharacterIndex(route.chaId)
  if (index < 0) {
    selectedCharID.set(-1)
    settingsOpen.set(false)
    PlaygroundStore.set(0)
    OpenRealmStore.set(false)
    context.replacePath('/')
    return
  }

  settingsOpen.set(false)
  PlaygroundStore.set(0)
  OpenRealmStore.set(false)

  if (get(selectedCharID) !== index) await changeChar(index, { isFresh: context.isFresh })
  if (!context.isFresh()) return

  const liveIndex = findRouteCharacterIndex(route.chaId)
  if (liveIndex < 0) {
    restoreSelectedCharacterRoute(context.replacePath)
    return
  }
  const liveSelectedIndex = get(selectedCharID)
  if (liveSelectedIndex !== liveIndex || selectedCharacterForRoute(liveSelectedIndex)?.chaId !== route.chaId) {
    restoreSelectedCharacterRoute(context.replacePath)
    return
  }

  if (!route.chatId) return
  const character = selectedCharacterForRoute(liveIndex)
  const chatIndex = character?.chats?.findIndex((chat) => chat.id === route.chatId) ?? -1
  if (!character) return
  if (chatIndex < 0) {
    if (context.isFresh()) context.replacePath(characterRoutePath(route.chaId))
    return
  }
  if (character.chatPage === chatIndex || !context.isFresh()) return

  const { changeChatTo } = await import('../globalApi.svelte')
  if (context.isFresh()) changeChatTo(route.chatId)
}

function restoreSelectedCharacterRoute(replacePath: (path: string) => void): void {
  const selectedCharacter = selectedCharacterForRoute(get(selectedCharID))
  if (!selectedCharacter?.chaId) {
    replacePath('/')
    return
  }

  const selectedChatId = selectedCharacter.chats?.[selectedCharacter.chatPage]?.id
  replacePath(characterRoutePath(selectedCharacter.chaId, selectedChatId))
}

function findRouteCharacterIndex(characterId: string): number {
  return charactersResourceState.status === 'ready' ? uniqueCharacterOwnerIndex(characterId) : -1
}

function uniqueCharacterOwnerIndex(characterId: string): number {
  let ownerIndex = -1
  for (const [index, candidate] of charactersResourceState.characters.entries()) {
    if (candidate?.chaId !== characterId) continue
    if (ownerIndex >= 0) return -1
    ownerIndex = index
  }
  return ownerIndex
}

function selectedCharacterForRoute(selectedIndex: number): character | undefined {
  if (charactersResourceState.status !== 'ready') return undefined
  const owner = charactersResourceState.characters[selectedIndex]
  if (owner?.chaId && uniqueCharacterOwnerIndex(owner.chaId) === selectedIndex) return owner
  return undefined
}
