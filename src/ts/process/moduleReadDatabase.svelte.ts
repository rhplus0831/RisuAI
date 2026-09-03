import { readActiveModuleDatabase, readActiveModuleSelection } from '../activeChatGenerationSettings'
import { resolveActiveModuleStates } from '../moduleActivation'
import { get } from 'svelte/store'
import { moduleRenderRevision } from '../moduleRenderRevision'

// Validate collection identities once for all display callers. Reading their
// fields inside derived consumers still observes in-place edits and rollback.
const database = $derived.by(() => {
  return readActiveModuleDatabase()
})
const selection = $derived.by(() => {
  return readActiveModuleSelection()
})
const modules = $derived.by(() => {
  get(moduleRenderRevision)
  return resolveActiveModuleStates(database, selection.character, selection.chat).map((state) => state.module)
})

export function getModuleReadDatabase() {
  return database
}

export function getActiveModuleReadModules() {
  return modules
}
