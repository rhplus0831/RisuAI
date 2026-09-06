import { getModules } from 'src/ts/process/modules'
import { sharedChatReadOwners } from './sharedChatReadOwners.svelte'
import { get } from 'svelte/store'
import { moduleRenderRevision } from 'src/ts/moduleRenderRevision'

const modules = $derived.by(() => {
  get(moduleRenderRevision)
  return getModules({ character: sharedChatReadOwners.character(), chat: sharedChatReadOwners.chat() })
})

export function readChatBodyModules() {
  return modules
}
