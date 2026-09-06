import { writable } from 'svelte/store'

export type ObserverShellLifecycleMode =
  | 'waiting'
  | 'retrying'
  | 'takeover-denied'
  | 'unavailable'
  | 'writer-lost'
  | 'offline'
  | 'auth-lost'
  | 'promoted'

export type ObserverProjectionDiscardReason = 'auth-loss' | 'database-replacement' | 'lineage-change'

export interface ObserverShellLifecycleState {
  mode: ObserverShellLifecycleMode
  lastDiscardReason: ObserverProjectionDiscardReason | null
}

const initialState: ObserverShellLifecycleState = {
  mode: 'waiting',
  lastDiscardReason: null,
}

export const observerShellLifecycleStore = writable<ObserverShellLifecycleState>(initialState)

export function setObserverShellLifecycleMode(mode: ObserverShellLifecycleMode): void {
  observerShellLifecycleStore.update((state) => (state.mode === mode ? state : { ...state, mode }))
}

export function resetObserverShellLifecycleForTests(): void {
  observerShellLifecycleStore.set(initialState)
}
