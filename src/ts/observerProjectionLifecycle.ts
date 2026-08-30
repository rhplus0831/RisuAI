import { clearObserverRouteIntent } from './observerRouteIntent'
import {
  observerShellLifecycleStore,
  setObserverShellLifecycleMode,
  type ObserverProjectionDiscardReason,
} from './observerShellLifecycle.svelte'
import { clearCharacterShellHydrationState } from './server/characterShellHydration.svelte'
import { resetChatHydration } from './server/chatMessageHydration.svelte'
import { clearAppliedServerResourceRevision, clearCachedServerCommandRevision } from './server/commands'
import { resetLorebookHydration } from './server/lorebookBridge.svelte'
import { lorebookPageOwner } from './server/lorebookPageOwner.svelte'
import { resetPromptTemplateHydration } from './server/promptTemplateHydration'
import { clearResourceCache } from './server/resourceCache'
import { resetServerResourceState } from './server/resourceState.svelte'
import { withServerResourceApply } from './server/resourceWriteGuard.svelte'
import { selectedCharID } from './stores.svelte'

/**
 * Drop observer-era local intent and optional detail identities whenever their
 * authentication or database ownership scope is no longer valid. Only auth
 * loss blanks the authenticated shell immediately; replacement refreshes keep
 * the old shell visible until their authoritative snapshot is ready.
 */
export async function discardObserverProjectionState(reason: ObserverProjectionDiscardReason): Promise<void> {
  clearObserverRouteIntent()
  clearCharacterShellHydrationState()
  resetChatHydration()
  resetLorebookHydration()
  lorebookPageOwner.reset()
  resetPromptTemplateHydration()
  await clearResourceCache()

  if (reason === 'auth-loss') {
    withServerResourceApply(() => resetServerResourceState())
    selectedCharID.set(-1)
    clearCachedServerCommandRevision()
    clearAppliedServerResourceRevision()
    setObserverShellLifecycleMode('auth-lost')
  }
  observerShellLifecycleStore.update((state) => ({ ...state, lastDiscardReason: reason }))
}
