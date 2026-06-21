import { describe, expect, it } from 'vitest'
import {
  buildSidebarCharacterListSignature,
  createSidebarCharacterListMemo,
  type SidebarCharacterListCharacter,
  type SidebarCharacterListItem,
  type SidebarCharacterOrderEntry,
  type SidebarCharacterOrderFolder,
} from './sidebarCharList'

type TestCharacter = SidebarCharacterListCharacter & {
  chats?: unknown[]
  notes?: string
  lastInteraction?: number
}

function baseCharacters(): TestCharacter[] {
  return [
    {
      chaId: 'alpha',
      name: 'Alpha',
      image: 'alpha.webp',
      chats: [{ id: 'alpha-chat', message: ['hello'] }],
      notes: 'original alpha notes',
    },
    {
      chaId: 'beta',
      name: 'Beta',
      displayName: '베타',
      image: 'beta.webp',
      lastInteraction: 1,
    },
    {
      chaId: 'unused',
      name: 'Unused',
      image: 'unused.webp',
    },
  ]
}

function baseFolder(): SidebarCharacterOrderFolder {
  return {
    id: 'folder-1',
    name: 'Folder One',
    color: 'blue',
    imgFile: 'folder.webp',
    data: ['beta'],
  }
}

function baseOrder(): SidebarCharacterOrderEntry[] {
  return ['alpha', baseFolder(), 'missing-character']
}

function folderItem(items: SidebarCharacterListItem[], index = 1) {
  const item = items[index]
  expect(item.type).toBe('folder')
  return item.type === 'folder' ? item : null
}

describe('sidebar character list signature memo', () => {
  it('L44: preserves sidebar order, folder ids, and drag indices from characterOrder', () => {
    const result = createSidebarCharacterListMemo()(baseOrder(), baseCharacters())

    expect(result.changed).toBe(true)
    expect(result.items).toEqual([
      {
        type: 'normal',
        img: 'alpha.webp',
        index: 0,
        name: 'Alpha',
      },
      {
        type: 'folder',
        folder: [
          {
            type: 'normal',
            img: 'beta.webp',
            index: 1,
            name: '베타',
          },
        ],
        id: 'folder-1',
        name: 'Folder One',
        color: 'blue',
        img: 'folder.webp',
      },
    ])
  })

  it('L44: unrelated character metadata and chat changes reuse the sidebar list', () => {
    const memo = createSidebarCharacterListMemo()
    const first = memo(baseOrder(), baseCharacters())
    const changedCharacters = baseCharacters()
    changedCharacters[0] = {
      ...changedCharacters[0],
      chats: [{ id: 'alpha-chat', message: ['changed transcript'] }],
      notes: 'changed alpha notes',
    }
    changedCharacters[1] = {
      ...changedCharacters[1],
      lastInteraction: 99,
    }

    const second = memo(baseOrder(), changedCharacters)

    expect(second.signature).toBe(first.signature)
    expect(second.changed).toBe(false)
    expect(second.items).toBe(first.items)
  })

  it('L44: character display name image index and order changes rebuild the sidebar list', () => {
    const cases: Array<{
      name: string
      order: SidebarCharacterOrderEntry[]
      characters: TestCharacter[]
      assert: (items: SidebarCharacterListItem[]) => void
    }> = [
      {
        name: 'character display name',
        order: baseOrder(),
        characters: baseCharacters().map((character) =>
          character.chaId === 'beta' ? { ...character, displayName: '베타 변경' } : character,
        ),
        assert: (items) => {
          expect(folderItem(items)?.folder[0]?.name).toBe('베타 변경')
        },
      },
      {
        name: 'character fallback name',
        order: baseOrder(),
        characters: baseCharacters().map((character) =>
          character.chaId === 'alpha' ? { ...character, name: 'Alpha Renamed' } : character,
        ),
        assert: (items) => {
          expect(items[0]).toMatchObject({ type: 'normal', name: 'Alpha Renamed' })
        },
      },
      {
        name: 'character image',
        order: baseOrder(),
        characters: baseCharacters().map((character) =>
          character.chaId === 'alpha' ? { ...character, image: 'alpha-new.webp' } : character,
        ),
        assert: (items) => {
          expect(items[0]).toMatchObject({ type: 'normal', img: 'alpha-new.webp' })
        },
      },
      {
        name: 'character index',
        order: baseOrder(),
        characters: [baseCharacters()[2], baseCharacters()[1], baseCharacters()[0]],
        assert: (items) => {
          expect(items[0]).toMatchObject({ type: 'normal', index: 2, name: 'Alpha' })
        },
      },
      {
        name: 'character order',
        order: [baseFolder(), 'alpha'],
        characters: baseCharacters(),
        assert: (items) => {
          expect(items[0]).toMatchObject({ type: 'folder', id: 'folder-1' })
          expect(items[1]).toMatchObject({ type: 'normal', name: 'Alpha' })
        },
      },
    ]

    for (const testCase of cases) {
      const memo = createSidebarCharacterListMemo()
      const first = memo(baseOrder(), baseCharacters())
      const second = memo(testCase.order, testCase.characters)

      expect(second.changed, testCase.name).toBe(true)
      expect(second.signature, testCase.name).not.toBe(first.signature)
      expect(second.items, testCase.name).not.toBe(first.items)
      testCase.assert(second.items)
    }
  })

  it('L44: folder name color image and data changes rebuild the sidebar list', () => {
    const cases: Array<{
      name: string
      folder: SidebarCharacterOrderFolder
      assert: (items: SidebarCharacterListItem[]) => void
    }> = [
      {
        name: 'folder name',
        folder: { ...baseFolder(), name: 'Renamed Folder' },
        assert: (items) => {
          expect(folderItem(items)?.name).toBe('Renamed Folder')
        },
      },
      {
        name: 'folder color',
        folder: { ...baseFolder(), color: 'green' },
        assert: (items) => {
          expect(folderItem(items)?.color).toBe('green')
        },
      },
      {
        name: 'folder image',
        folder: { ...baseFolder(), imgFile: 'folder-new.webp' },
        assert: (items) => {
          expect(folderItem(items)?.img).toBe('folder-new.webp')
        },
      },
      {
        name: 'folder data',
        folder: { ...baseFolder(), data: ['beta', 'alpha'] },
        assert: (items) => {
          expect(folderItem(items)?.folder.map((character) => character.name)).toEqual(['베타', 'Alpha'])
        },
      },
    ]

    for (const testCase of cases) {
      const memo = createSidebarCharacterListMemo()
      const first = memo(baseOrder(), baseCharacters())
      const second = memo(['alpha', testCase.folder, 'missing-character'], baseCharacters())

      expect(second.changed, testCase.name).toBe(true)
      expect(second.signature, testCase.name).not.toBe(first.signature)
      expect(second.items, testCase.name).not.toBe(first.items)
      testCase.assert(second.items)
    }
  })

  it('L44: signature ignores unreferenced character names and images', () => {
    const first = buildSidebarCharacterListSignature(baseOrder(), baseCharacters())
    const changedCharacters = baseCharacters().map((character) =>
      character.chaId === 'unused' ? { ...character, name: 'Unused Renamed', image: 'unused-new.webp' } : character,
    )
    const second = buildSidebarCharacterListSignature(baseOrder(), changedCharacters)

    expect(second).toBe(first)
  })
})
