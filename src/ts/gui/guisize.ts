import { writable } from 'svelte/store'
import type { Database } from '../storage/database.svelte'
import { settingsResourceState } from '../server/resourceState.svelte'

export let textAreaSize = writable(0)
export let sideBarSize = writable(0)
export let textAreaTextSize = writable(0)

function displaySettingsOwner(): Partial<Database> | undefined {
  const status = settingsResourceState.groupStatuses.display ?? 'idle'
  if (status === 'ready') return settingsResourceState.value as Partial<Database>
  return undefined
}

export function updateGuisize() {
  const db = displaySettingsOwner()
  if (!db) return
  const root = document.querySelector(':root') as HTMLElement
  if (!root) {
    return
  }
  if (typeof db.textAreaSize === 'number' && Number.isFinite(db.textAreaSize)) textAreaSize.set(db.textAreaSize)
  if (typeof db.textAreaTextSize === 'number' && Number.isFinite(db.textAreaTextSize)) {
    textAreaTextSize.set(db.textAreaTextSize)
  }
  if (typeof db.sideBarSize === 'number' && Number.isFinite(db.sideBarSize)) {
    sideBarSize.set(db.sideBarSize)
    root.style.setProperty('--sidebar-size', 24 + 4 * db.sideBarSize + 'rem')
  }
}

export function guiSizeText(num: number) {
  switch (num) {
    case 0:
      return 'Default'
    case 1:
      return 'Big'
    case 2:
      return 'Bigger'
    case 3:
      return 'Huge'
    case 4:
      return 'Huger'
    case 5:
      return 'Hugest'
    case -1:
      return 'Small'
    case -2:
      return 'Smaller'
    case -3:
      return 'Tiny'
    case -4:
      return 'Tinier'
    case -5:
      return 'Tiniest'
    default:
      return 'Default'
  }
}
