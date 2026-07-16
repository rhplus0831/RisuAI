import type { CharacterOrderDragPosition } from 'src/ts/characterCommands'

export interface SidebarOrganizerFolder {
  id: string
  data: readonly string[]
}

export type SidebarOrganizerOrderEntry = string | SidebarOrganizerFolder

export type SidebarOrganizerItemReference =
  | { kind: 'character'; characterId: string }
  | { kind: 'folder'; folderId: string }

export interface SidebarOrganizerMove {
  source: CharacterOrderDragPosition
  target: CharacterOrderDragPosition
}

function isFolder(entry: SidebarOrganizerOrderEntry | undefined): entry is SidebarOrganizerFolder {
  return typeof entry === 'object' && entry !== null && typeof entry.id === 'string' && Array.isArray(entry.data)
}

function findFolder(
  order: readonly SidebarOrganizerOrderEntry[],
  folderId: string,
): SidebarOrganizerFolder | undefined {
  return order.find((entry): entry is SidebarOrganizerFolder => isFolder(entry) && entry.id === folderId)
}

export function resolveSidebarOrganizerPosition(
  order: readonly SidebarOrganizerOrderEntry[],
  reference: SidebarOrganizerItemReference,
): CharacterOrderDragPosition | null {
  for (let rootIndex = 0; rootIndex < order.length; rootIndex += 1) {
    const entry = order[rootIndex]
    if (reference.kind === 'folder') {
      if (isFolder(entry) && entry.id === reference.folderId) return { index: rootIndex }
      continue
    }

    if (typeof entry === 'string') {
      if (entry === reference.characterId) return { index: rootIndex }
      continue
    }

    if (!isFolder(entry)) continue
    const nestedIndex = entry.data.indexOf(reference.characterId)
    if (nestedIndex !== -1) return { folder: entry.id, index: nestedIndex }
  }

  return null
}

export function resolveSidebarOrganizerStep(
  order: readonly SidebarOrganizerOrderEntry[],
  reference: SidebarOrganizerItemReference,
  direction: 'up' | 'down',
): SidebarOrganizerMove | null {
  const source = resolveSidebarOrganizerPosition(order, reference)
  if (!source) return null

  const containerLength = source.folder ? findFolder(order, source.folder)?.data.length : order.length
  if (containerLength === undefined) return null

  if (direction === 'up') {
    if (source.index === 0) return null
    return {
      source,
      target: source.folder ? { folder: source.folder, index: source.index - 1 } : { index: source.index - 1 },
    }
  }

  if (source.index >= containerLength - 1) return null
  // Character-order moves target insertion slots. Moving down one row inserts
  // after the next item, which is two slots beyond the source's current index.
  return {
    source,
    target: source.folder ? { folder: source.folder, index: source.index + 2 } : { index: source.index + 2 },
  }
}

export function resolveSidebarOrganizerMoveToFolder(
  order: readonly SidebarOrganizerOrderEntry[],
  reference: SidebarOrganizerItemReference,
  folderId: string,
): SidebarOrganizerMove | null {
  if (reference.kind !== 'character') return null

  const source = resolveSidebarOrganizerPosition(order, reference)
  if (!source || source.folder === folderId) return null

  const targetFolder = findFolder(order, folderId)
  if (!targetFolder || targetFolder.data.includes(reference.characterId)) return null

  return {
    source,
    target: { folder: targetFolder.id, index: targetFolder.data.length },
  }
}

export function resolveSidebarOrganizerMoveOut(
  order: readonly SidebarOrganizerOrderEntry[],
  reference: SidebarOrganizerItemReference,
): SidebarOrganizerMove | null {
  if (reference.kind !== 'character') return null

  const source = resolveSidebarOrganizerPosition(order, reference)
  if (!source?.folder) return null

  const folderIndex = order.findIndex((entry) => isFolder(entry) && entry.id === source.folder)
  if (folderIndex === -1) return null

  return {
    source,
    target: { index: folderIndex + 1 },
  }
}

export function resolveSidebarOrganizerCreateFolder(
  order: readonly SidebarOrganizerOrderEntry[],
  reference: SidebarOrganizerItemReference,
  partnerCharacterId: string,
): SidebarOrganizerMove | null {
  if (reference.kind !== 'character' || reference.characterId === partnerCharacterId) return null

  const source = resolveSidebarOrganizerPosition(order, reference)
  if (!source) return null

  const targetIndex = order.findIndex((entry) => entry === partnerCharacterId)
  if (targetIndex === -1) return null

  return {
    source,
    target: { index: targetIndex },
  }
}

export function sidebarOrganizerFolderTargetIds(
  order: readonly SidebarOrganizerOrderEntry[],
  reference: SidebarOrganizerItemReference,
): string[] {
  if (reference.kind !== 'character') return []

  const source = resolveSidebarOrganizerPosition(order, reference)
  if (!source) return []

  return order.flatMap((entry) =>
    isFolder(entry) && entry.id !== source.folder && !entry.data.includes(reference.characterId) ? [entry.id] : [],
  )
}

export function sidebarOrganizerFolderPartnerIds(
  order: readonly SidebarOrganizerOrderEntry[],
  reference: SidebarOrganizerItemReference,
): string[] {
  if (reference.kind !== 'character' || !resolveSidebarOrganizerPosition(order, reference)) return []
  return order.flatMap((entry) => (typeof entry === 'string' && entry !== reference.characterId ? [entry] : []))
}
