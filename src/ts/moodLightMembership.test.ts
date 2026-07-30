import { describe, expect, it } from 'vitest'
import type { Database } from './storage/database.svelte'
import {
  buildMoodLightManagementTargets,
  filterCharacterOrderForMoodLight,
  moodLightCharacterIsProtected,
  toggleMoodLightManagementTarget,
} from './moodLightMembership'

function database(overrides: Partial<Database> = {}): Database {
  return {
    characters: [
      { chaId: 'normal', name: 'Normal', chats: [] },
      { chaId: 'folder-protected', name: 'Folder Protected', chats: [] },
      { chaId: 'folder-excluded', name: 'Folder Excluded', chats: [] },
      { chaId: 'explicit', name: 'Explicit', chats: [] },
      { chaId: 'root-protected', name: 'Root Protected', chats: [] },
      { chaId: 'trashed-protected', name: 'Trashed Protected', chats: [], trashTime: 1 },
    ],
    characterOrder: [
      'normal',
      {
        id: 'private-folder',
        name: 'Private Folder',
        color: 'blue',
        data: ['folder-protected', 'folder-excluded'],
      },
      { id: 'normal-folder', name: 'Normal Folder', color: '', data: ['explicit'] },
      'root-protected',
    ],
    moodLightMembership: {
      characterIds: ['explicit', 'root-protected', 'trashed-protected'],
      folders: [
        {
          id: 'private-folder',
          characterIds: ['folder-protected', 'folder-excluded'],
          excludedCharacterIds: ['folder-excluded'],
        },
      ],
    },
    ...overrides,
  } as Database
}

describe('Mood Light membership', () => {
  it('partitions root characters, folders, and mixed folder children without leaking folder names', () => {
    const db = database()

    expect(filterCharacterOrderForMoodLight(db, true)).toEqual([
      {
        id: 'private-folder',
        name: 'Private Folder',
        color: 'blue',
        data: ['folder-protected'],
      },
      'explicit',
      'root-protected',
    ])
    expect(filterCharacterOrderForMoodLight(db, false)).toEqual([
      'normal',
      'folder-excluded',
      { id: 'normal-folder', name: 'Normal Folder', color: '', data: [] },
    ])
  })

  it('keeps snapshotted folder bots protected after they leave the live order', () => {
    const db = database({
      characterOrder: ['normal'],
      moodLightMembership: {
        characterIds: [],
        folders: [{ id: 'private-folder', characterIds: ['trashed-protected'], excludedCharacterIds: [] }],
      },
    })

    expect(moodLightCharacterIsProtected(db, 'trashed-protected')).toBe(true)
  })

  it('can move one bot out of a protected folder without unprotecting the folder', () => {
    const db = database()
    const membership = toggleMoodLightManagementTarget(db, {
      kind: 'character',
      id: 'folder-protected',
    })
    const updated = database({ moodLightMembership: membership })

    expect(membership.folders[0]?.excludedCharacterIds).toContain('folder-protected')
    expect(moodLightCharacterIsProtected(updated, 'folder-protected')).toBe(false)
    expect(filterCharacterOrderForMoodLight(updated, false)).toContain('folder-protected')
  })

  it('lists folders and nested bots as stable management targets, hiding trashed bots', () => {
    const targets = buildMoodLightManagementTargets(database())

    expect(targets).toContainEqual({ kind: 'folder', id: 'private-folder', name: 'Private Folder' })
    expect(targets).toContainEqual({
      kind: 'character',
      id: 'folder-protected',
      name: 'Folder Protected',
      folderName: 'Private Folder',
    })
    expect(targets.some((target) => target.id === 'trashed-protected')).toBe(false)
  })

  it('keeps trashed bots protected even though they are no longer manageable', () => {
    expect(moodLightCharacterIsProtected(database(), 'trashed-protected')).toBe(true)
  })
})
