import { describe, expect, it } from 'vitest'
import {
  isCreateModuleFolderPayload,
  isPatchModuleFolderPayload,
  isReorderModuleFoldersPayload,
  isReorderModulesWithFoldersPayload,
  normalizeModuleFolders,
} from './moduleOrganization'

describe('module organization protocol', () => {
  it('accepts canonical folder and complete organization payloads', () => {
    expect(isCreateModuleFolderPayload({ folder: { id: 'folder-a', name: 'Writing' } })).toBe(true)
    expect(isPatchModuleFolderPayload({ patch: { name: 'Tools' } })).toBe(true)
    expect(isReorderModuleFoldersPayload({ folderIds: ['folder-b', 'folder-a'] })).toBe(true)
    expect(
      isReorderModulesWithFoldersPayload({
        moduleIds: ['module-b', 'module-a'],
        folderByModuleId: { 'module-a': null, 'module-b': 'folder-b' },
      }),
    ).toBe(true)
  })

  it('rejects unknown fields, blank strings, duplicates, and malformed assignments', () => {
    expect(isCreateModuleFolderPayload({ folder: { id: 'folder-a', name: 'A', color: 'red' } })).toBe(false)
    expect(isPatchModuleFolderPayload({ patch: { name: '  ' } })).toBe(false)
    expect(isReorderModuleFoldersPayload({ folderIds: ['folder-a', 'folder-a'] })).toBe(false)
    expect(isReorderModulesWithFoldersPayload({ moduleIds: ['module-a'], folderByModuleId: { 'module-a': 1 } })).toBe(
      false,
    )
    expect(
      isReorderModulesWithFoldersPayload({
        moduleIds: ['module-a', 'module-b'],
        folderByModuleId: { 'module-a': null },
      }),
    ).toBe(false)
  })

  it('repairs imported folders by trimming names and dropping malformed or duplicate rows', () => {
    expect(
      normalizeModuleFolders([
        { id: 'folder-a', name: '  Writing  ' },
        { id: 'folder-a', name: 'Duplicate' },
        { id: ' bad ', name: 'Bad id' },
        { id: 'folder-b', name: '' },
      ]),
    ).toEqual([{ id: 'folder-a', name: 'Writing' }])
  })
})
