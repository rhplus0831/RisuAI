import type { AppRoute } from '../routerRoute'
import { OpenRealmStore, PlaygroundStore, selectedCharID, settingsOpen } from '../stores.svelte'

export async function applyPlaygroundRoute(
  route: Extract<AppRoute, { kind: 'inlay' | 'playground' }>,
  isFresh: () => boolean,
): Promise<void> {
  if (!isFresh()) return
  settingsOpen.set(false)
  OpenRealmStore.set(false)

  if (route.kind === 'inlay') {
    selectedCharID.set(-1)
    PlaygroundStore.set(14)
    return
  }

  if (route.index === 2) {
    const { openPlaygroundChat } = await import('../playground')
    if (!isFresh()) return
    await openPlaygroundChat({ isFresh })
    return
  }

  selectedCharID.set(-1)
  PlaygroundStore.set(route.index)
}
