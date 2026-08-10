import { getCharacterDisplayName } from 'src/ts/characterDisplayName'
import type { character, folder } from 'src/ts/storage/database.svelte'

export interface SidebarCharacterListNormal {
  type: 'normal'
  img: string
  index: number
  name: string
}

export type SidebarCharacterListItem =
  | SidebarCharacterListNormal
  | {
      type: 'folder'
      folder: SidebarCharacterListNormal[]
      id: string
      name: string
      color: string
      askBeforeOpening: boolean
      img?: string
    }

export type SidebarCharacterListCharacter = Pick<character, 'chaId' | 'name' | 'displayName' | 'image'>

export type SidebarCharacterOrderFolder = Omit<
  Pick<folder, 'name' | 'color' | 'id' | 'askBeforeOpening' | 'imgFile'>,
  'imgFile'
> & {
  data: readonly string[]
  imgFile?: string | null
}

export type SidebarCharacterOrderEntry = string | SidebarCharacterOrderFolder

export interface SidebarCharacterListSnapshot {
  signature: string
  items: SidebarCharacterListItem[]
  changed: boolean
}

type CharacterIndex = Map<string, number>

function safeOrder(
  characterOrder: readonly SidebarCharacterOrderEntry[] | null | undefined,
): readonly SidebarCharacterOrderEntry[] {
  return Array.isArray(characterOrder) ? characterOrder : []
}

function safeCharacters(
  characters: readonly SidebarCharacterListCharacter[] | null | undefined,
): readonly SidebarCharacterListCharacter[] {
  return Array.isArray(characters) ? characters : []
}

function createCharacterIndex(characters: readonly SidebarCharacterListCharacter[]) {
  const indexById: CharacterIndex = new Map()
  for (let index = 0; index < characters.length; index += 1) {
    const id = characters[index]?.chaId
    if (typeof id === 'string') {
      indexById.set(id, index)
    }
  }
  return indexById
}

function appendString(parts: string[], value: string | null | undefined) {
  const normalized = value ?? ''
  parts.push(String(normalized.length), normalized)
}

function appendCharacterSignature(
  parts: string[],
  id: string,
  characters: readonly SidebarCharacterListCharacter[],
  indexById: CharacterIndex,
) {
  appendString(parts, id)
  const index = indexById.get(id) ?? -1
  parts.push(String(index))
  if (index === -1) {
    return
  }

  const character = characters[index]
  appendString(parts, character.chaId)
  appendString(parts, getCharacterDisplayName(character, ''))
  appendString(parts, character.image)
}

function buildSidebarCharacterListSignatureWithIndex(
  characterOrder: readonly SidebarCharacterOrderEntry[],
  characters: readonly SidebarCharacterListCharacter[],
  indexById: CharacterIndex,
) {
  const parts: string[] = []
  parts.push(String(characterOrder.length))

  for (const item of characterOrder) {
    if (typeof item === 'string') {
      parts.push('c')
      appendCharacterSignature(parts, item, characters, indexById)
      continue
    }

    parts.push('f')
    appendString(parts, item.id)
    appendString(parts, item.name)
    appendString(parts, item.color)
    parts.push(item.askBeforeOpening === true ? '1' : '0')
    appendString(parts, item.imgFile)
    parts.push(String(item.data.length))
    for (const id of item.data) {
      appendCharacterSignature(parts, id, characters, indexById)
    }
  }

  return parts.join('\x1f')
}

function buildSidebarCharacterListItemsWithIndex(
  characterOrder: readonly SidebarCharacterOrderEntry[],
  characters: readonly SidebarCharacterListCharacter[],
  indexById: CharacterIndex,
): SidebarCharacterListItem[] {
  const items: SidebarCharacterListItem[] = []

  const characterListItem = (id: string): SidebarCharacterListNormal | null => {
    const index = indexById.get(id) ?? -1
    if (index === -1) {
      return null
    }

    const character = characters[index]
    return {
      img: character.image ?? '',
      index,
      type: 'normal',
      name: getCharacterDisplayName(character),
    }
  }

  for (const item of characterOrder) {
    if (typeof item === 'string') {
      const characterItem = characterListItem(item)
      if (characterItem) {
        items.push(characterItem)
      }
      continue
    }

    const folderItems: SidebarCharacterListNormal[] = []
    for (const id of item.data) {
      const characterItem = characterListItem(id)
      if (characterItem) {
        folderItems.push(characterItem)
      }
    }
    items.push({
      folder: folderItems,
      type: 'folder',
      id: item.id,
      name: item.name,
      color: item.color,
      askBeforeOpening: item.askBeforeOpening === true,
      img: item.imgFile ?? undefined,
    })
  }

  return items
}

export function buildSidebarCharacterListSignature(
  characterOrder: readonly SidebarCharacterOrderEntry[] | null | undefined,
  characters: readonly SidebarCharacterListCharacter[] | null | undefined,
) {
  const safeCharacterOrder = safeOrder(characterOrder)
  const safeCharacterList = safeCharacters(characters)
  const indexById = createCharacterIndex(safeCharacterList)
  return buildSidebarCharacterListSignatureWithIndex(safeCharacterOrder, safeCharacterList, indexById)
}

export function buildSidebarCharacterListItems(
  characterOrder: readonly SidebarCharacterOrderEntry[] | null | undefined,
  characters: readonly SidebarCharacterListCharacter[] | null | undefined,
) {
  const safeCharacterOrder = safeOrder(characterOrder)
  const safeCharacterList = safeCharacters(characters)
  const indexById = createCharacterIndex(safeCharacterList)
  return buildSidebarCharacterListItemsWithIndex(safeCharacterOrder, safeCharacterList, indexById)
}

export function createSidebarCharacterListMemo() {
  let signature: string | null = null
  let items: SidebarCharacterListItem[] = []

  return (
    characterOrder: readonly SidebarCharacterOrderEntry[] | null | undefined,
    characters: readonly SidebarCharacterListCharacter[] | null | undefined,
  ): SidebarCharacterListSnapshot => {
    const safeCharacterOrder = safeOrder(characterOrder)
    const safeCharacterList = safeCharacters(characters)
    const indexById = createCharacterIndex(safeCharacterList)
    const nextSignature = buildSidebarCharacterListSignatureWithIndex(safeCharacterOrder, safeCharacterList, indexById)

    if (nextSignature === signature) {
      return {
        signature: nextSignature,
        items,
        changed: false,
      }
    }

    signature = nextSignature
    items = buildSidebarCharacterListItemsWithIndex(safeCharacterOrder, safeCharacterList, indexById)
    return {
      signature,
      items,
      changed: true,
    }
  }
}
