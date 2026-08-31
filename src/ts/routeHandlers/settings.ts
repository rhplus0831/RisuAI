import type { AppRoute } from '../routerRoute'
import { personaSettingsRoutePath } from '../routerRoute'
import { getPersonaOwnerStateSnapshot } from '../server/resourceState.svelte'
import type { Database } from '../storage/database.svelte'
import { OpenRealmStore, PlaygroundStore, SettingsMenuIndex, selectedCharID, settingsOpen } from '../stores.svelte'

interface SettingsRouteContext {
  isFresh: () => boolean
  replacePath: (path: string) => void
}

export async function applySettingsRoute(
  route: Extract<AppRoute, { kind: 'settings' }>,
  context: SettingsRouteContext,
): Promise<void> {
  if (!context.isFresh()) return
  selectedCharID.set(-1)
  settingsOpen.set(true)
  SettingsMenuIndex.set(route.index)
  PlaygroundStore.set(0)
  OpenRealmStore.set(false)
  if (route.index === 12 && route.personaId) await selectRoutedPersona(route.personaId, context)
}

async function selectRoutedPersona(personaId: string, context: SettingsRouteContext): Promise<void> {
  const owner = getPersonaOwnerStateSnapshot()
  const index = uniquePersonaIndex(personaId, owner?.personas)
  if (index < 0) {
    canonicalizePersonaSettingsRoute(context)
    return
  }
  if (owner?.selectedPersonaId === personaId) return

  const { changeUserPersonaWithOutcome } = await import('../persona')
  if (!context.isFresh()) return
  const persistence = changeUserPersonaWithOutcome(index)
  if (!persistence) {
    canonicalizePersonaSettingsRoute(context)
    return
  }

  const status = await persistence
  if (status === 'failed') canonicalizePersonaSettingsRoute(context)
}

function uniquePersonaIndex(personaId: string, personas: Database['personas'] | undefined): number {
  if (!personas) return -1
  let index = -1
  for (const [candidateIndex, persona] of personas.entries()) {
    if (persona?.id !== personaId) continue
    if (index !== -1) return -1
    index = candidateIndex
  }
  return index
}

function canonicalizePersonaSettingsRoute(context: SettingsRouteContext): void {
  if (!context.isFresh()) return
  const owner = getPersonaOwnerStateSnapshot()
  const selectedId = owner?.selectedPersonaId ?? undefined
  const path = selectedId ? personaSettingsRoutePath(selectedId) : '/settings/persona'
  context.replacePath(path)
}
