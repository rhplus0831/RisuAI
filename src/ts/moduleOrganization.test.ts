import { describe, expect, it } from 'vitest'
import { groupModulesByFolder, moveModuleToFolder } from './moduleOrganization'

const folders = [
  { id: 'folder-b', name: 'B' },
  { id: 'folder-a', name: 'A' },
]

const modules = [
  { id: 'one', name: 'One', description: 'first', folderId: 'folder-a' },
  { id: 'two', name: 'Two', description: 'second', folderId: 'missing' },
  { id: 'three', name: 'Three', description: 'needle', folderId: 'folder-a' },
]

describe('module organization', () => {
  it('keeps folder and module order, includes empty folders, and appends Uncategorized', () => {
    expect(
      groupModulesByFolder(folders, modules).map((group) => ({
        folderId: group.folder?.id ?? null,
        moduleIds: group.modules.map((module) => module.id),
      })),
    ).toEqual([
      { folderId: 'folder-b', moduleIds: [] },
      { folderId: 'folder-a', moduleIds: ['one', 'three'] },
      { folderId: null, moduleIds: ['two'] },
    ])
  })

  it('searches names and descriptions and may omit groups without matches', () => {
    expect(groupModulesByFolder(folders, modules, { search: 'NEEDLE', omitEmptyMatches: true })).toEqual([
      { folder: folders[1], modules: [modules[2]] },
    ])
  })

  it('moves a module into a deterministic position in another folder', () => {
    expect(moveModuleToFolder(folders, modules, 'two', 'folder-a', 1)).toEqual([
      { id: 'one', name: 'One', description: 'first', folderId: 'folder-a' },
      { id: 'two', name: 'Two', description: 'second', folderId: 'folder-a' },
      { id: 'three', name: 'Three', description: 'needle', folderId: 'folder-a' },
    ])
  })
})
