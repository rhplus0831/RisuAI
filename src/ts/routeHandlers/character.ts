import { get } from 'svelte/store'
import { characterRoutePath, type AppRoute } from '../routerRoute'
import { getResourceDatabase as getDatabase } from '../server/resourceState.svelte'
import { OpenRealmStore, PlaygroundStore, selectedCharID, settingsOpen } from '../stores.svelte'

interface CharacterRouteContext {
  isFresh: () => boolean
  replacePath: (path: string) => void
}

export async function applyCharacterRoute(
  route: Extract<AppRoute, { kind: 'character' }>,
  context: CharacterRouteContext,
): Promise<void> {
  const [{ findCharacterIndexbyId }, { changeChar }] = await Promise.all([
    import('../characterState'),
    import('../characters'),
  ])
  if (!context.isFresh()) return

  const index = findCharacterIndexbyId(route.chaId)
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

  const liveIndex = findCharacterIndexbyId(route.chaId)
  if (liveIndex < 0) {
    restoreSelectedCharacterRoute(context.replacePath)
    return
  }
  const liveSelectedIndex = get(selectedCharID)
  if (liveSelectedIndex !== liveIndex || getDatabase().characters?.[liveSelectedIndex]?.chaId !== route.chaId) {
    restoreSelectedCharacterRoute(context.replacePath)
    return
  }

  if (!route.chatId) return
  const character = getDatabase().characters?.[liveIndex]
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
  const selectedCharacter = getDatabase().characters?.[get(selectedCharID)]
  if (!selectedCharacter?.chaId) {
    replacePath('/')
    return
  }

  const selectedChatId = selectedCharacter.chats?.[selectedCharacter.chatPage]?.id
  replacePath(characterRoutePath(selectedCharacter.chaId, selectedChatId))
}
