import { describe, expect, it } from 'vitest'
import {
  resolveSidebarOrganizerCreateFolder,
  resolveSidebarOrganizerMoveOut,
  resolveSidebarOrganizerMoveToFolder,
  resolveSidebarOrganizerPosition,
  resolveSidebarOrganizerStep,
  sidebarOrganizerFolderPartnerIds,
  sidebarOrganizerFolderTargetIds,
  type SidebarOrganizerItemReference,
  type SidebarOrganizerOrderEntry,
} from './sidebarOrganizer'

const alpha: SidebarOrganizerItemReference = { kind: 'character', characterId: 'alpha' }
const beta: SidebarOrganizerItemReference = { kind: 'character', characterId: 'beta' }
const folderOne: SidebarOrganizerItemReference = { kind: 'folder', folderId: 'folder-1' }

function baseOrder(): SidebarOrganizerOrderEntry[] {
  return ['alpha', { id: 'folder-1', data: ['beta', 'gamma'] }, 'delta', { id: 'folder-2', data: ['epsilon'] }]
}

describe('sidebar organizer stable positions', () => {
  it('resolves character and folder IDs against the current order', () => {
    expect(resolveSidebarOrganizerPosition(baseOrder(), alpha)).toEqual({ index: 0 })
    expect(resolveSidebarOrganizerPosition(baseOrder(), beta)).toEqual({ folder: 'folder-1', index: 0 })
    expect(resolveSidebarOrganizerPosition(baseOrder(), folderOne)).toEqual({ index: 1 })

    const refreshedOrder: SidebarOrganizerOrderEntry[] = [
      { id: 'folder-2', data: ['epsilon', 'alpha'] },
      'delta',
      { id: 'folder-1', data: ['gamma', 'beta'] },
    ]
    expect(resolveSidebarOrganizerPosition(refreshedOrder, alpha)).toEqual({ folder: 'folder-2', index: 1 })
    expect(resolveSidebarOrganizerPosition(refreshedOrder, beta)).toEqual({ folder: 'folder-1', index: 1 })
    expect(resolveSidebarOrganizerPosition(refreshedOrder, folderOne)).toEqual({ index: 2 })
  })

  it('uses insertion-slot targets for top-level and nested one-step moves', () => {
    const order = baseOrder()

    expect(resolveSidebarOrganizerStep(order, alpha, 'up')).toBeNull()
    expect(resolveSidebarOrganizerStep(order, alpha, 'down')).toEqual({
      source: { index: 0 },
      target: { index: 2 },
    })
    expect(resolveSidebarOrganizerStep(order, beta, 'up')).toBeNull()
    expect(resolveSidebarOrganizerStep(order, { kind: 'character', characterId: 'gamma' }, 'up')).toEqual({
      source: { folder: 'folder-1', index: 1 },
      target: { folder: 'folder-1', index: 0 },
    })
    expect(resolveSidebarOrganizerStep(order, { kind: 'character', characterId: 'gamma' }, 'down')).toBeNull()
  })

  it('moves characters into and out of folders using stable folder IDs', () => {
    const order = baseOrder()

    expect(resolveSidebarOrganizerMoveToFolder(order, alpha, 'folder-2')).toEqual({
      source: { index: 0 },
      target: { folder: 'folder-2', index: 1 },
    })
    expect(resolveSidebarOrganizerMoveToFolder(order, beta, 'folder-1')).toBeNull()
    expect(resolveSidebarOrganizerMoveOut(order, beta)).toEqual({
      source: { folder: 'folder-1', index: 0 },
      target: { index: 2 },
    })
    expect(resolveSidebarOrganizerMoveOut(order, alpha)).toBeNull()
    expect(sidebarOrganizerFolderTargetIds(order, beta)).toEqual(['folder-2'])
  })

  it('creates folders only with a distinct character that is still top-level', () => {
    const order = baseOrder()

    expect(resolveSidebarOrganizerCreateFolder(order, beta, 'delta')).toEqual({
      source: { folder: 'folder-1', index: 0 },
      target: { index: 2 },
    })
    expect(resolveSidebarOrganizerCreateFolder(order, alpha, 'alpha')).toBeNull()
    expect(resolveSidebarOrganizerCreateFolder(order, alpha, 'gamma')).toBeNull()
    expect(sidebarOrganizerFolderPartnerIds(order, beta)).toEqual(['alpha', 'delta'])

    const refreshedOrder: SidebarOrganizerOrderEntry[] = [{ id: 'folder-1', data: ['beta', 'delta'] }, 'alpha']
    expect(resolveSidebarOrganizerCreateFolder(refreshedOrder, beta, 'delta')).toBeNull()
  })
})
