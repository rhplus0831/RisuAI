import { writable, type Readable } from 'svelte/store'

let currentModuleRenderRevision = 0

/**
 * Compact, client-local invalidation signal for module-dependent rendering.
 *
 * Server resource revisions cannot own this contract by themselves because
 * optimistic writes and rollbacks update resident owners before (or without)
 * an authoritative projection apply. Every such render-visible transition
 * must advance this counter instead of embedding the module definition in
 * per-message cache keys.
 */
const moduleRenderRevisionStore = writable(currentModuleRenderRevision)
export const moduleRenderRevision: Readable<number> = {
  subscribe: moduleRenderRevisionStore.subscribe,
}

export function captureModuleRenderRevision(): number {
  return currentModuleRenderRevision
}

export function invalidateModuleRenderRevision(): number {
  currentModuleRenderRevision += 1
  moduleRenderRevisionStore.set(currentModuleRenderRevision)
  return currentModuleRenderRevision
}

export function resetModuleRenderRevisionForTests(): void {
  currentModuleRenderRevision = 0
  moduleRenderRevisionStore.set(currentModuleRenderRevision)
}
