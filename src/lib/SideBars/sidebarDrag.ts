import type { CharacterOrderDragPosition } from 'src/ts/characterCommands'
import { hasDragType, RISU_SIDEBAR_DRAG_TYPE } from 'src/ts/dragTypes'

type SidebarCharacterOrderEntry =
  | string
  | {
      id?: string
      data?: readonly string[]
    }

type SidebarCharacterDragSnapshot = {
  position: CharacterOrderDragPosition
  orderSignature: string
}

function characterOrderStructureSignature(
  characterOrder: readonly SidebarCharacterOrderEntry[] | null | undefined,
): string {
  if (!Array.isArray(characterOrder)) return '[]'

  return JSON.stringify(
    characterOrder.map((entry) =>
      typeof entry === 'string' ? ['character', entry] : ['folder', entry?.id ?? '', ...(entry?.data ?? [])],
    ),
  )
}

function hasCharacterOrderPosition(
  characterOrder: readonly SidebarCharacterOrderEntry[] | null | undefined,
  position: CharacterOrderDragPosition,
): boolean {
  if (!Array.isArray(characterOrder)) return false

  if (!position.folder) {
    return characterOrder[position.index] !== undefined
  }

  const folder = characterOrder.find(
    (entry) => typeof entry !== 'string' && entry?.id === position.folder && Array.isArray(entry.data),
  )
  return !!folder && typeof folder !== 'string' && folder.data?.[position.index] !== undefined
}

export function isSidebarCharacterDrag(types: ArrayLike<string> | null | undefined): boolean {
  return hasDragType(types, RISU_SIDEBAR_DRAG_TYPE)
}

export function createSidebarCharacterDragController() {
  let activeDrag: SidebarCharacterDragSnapshot | null = null

  return {
    begin(
      position: CharacterOrderDragPosition,
      characterOrder: readonly SidebarCharacterOrderEntry[] | null | undefined,
    ): boolean {
      if (!hasCharacterOrderPosition(characterOrder, position)) {
        activeDrag = null
        return false
      }

      activeDrag = {
        position: { ...position },
        orderSignature: characterOrderStructureSignature(characterOrder),
      }
      return true
    },

    clear(): void {
      activeDrag = null
    },

    consume(
      types: ArrayLike<string> | null | undefined,
      characterOrder: readonly SidebarCharacterOrderEntry[] | null | undefined,
    ): CharacterOrderDragPosition | null {
      const drag = activeDrag
      activeDrag = null

      if (!drag || !isSidebarCharacterDrag(types)) return null
      if (characterOrderStructureSignature(characterOrder) !== drag.orderSignature) return null
      if (!hasCharacterOrderPosition(characterOrder, drag.position)) return null

      return { ...drag.position }
    },
  }
}
