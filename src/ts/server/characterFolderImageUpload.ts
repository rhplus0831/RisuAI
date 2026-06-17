import { createLatestOperationGuard, type LatestOperationToken } from './staleStateGuards'

export interface CharacterFolderImageRecord {
  readonly id?: string | null
  readonly name?: string | null
  readonly color?: string | null
  readonly data?: readonly string[] | null
  readonly imgFile?: string | null
  readonly img?: string | null
}

export type CharacterFolderImageOrderEntry = string | CharacterFolderImageRecord | null | undefined

export interface CharacterFolderImageUploadTarget {
  readonly folderId: string
  readonly imageSnapshot: string
}

export interface CharacterFolderImageUploadOperation extends CharacterFolderImageUploadTarget {
  readonly token: LatestOperationToken<string>
}

export interface CharacterFolderImageUploadPatch {
  readonly imgFile: string | null
  readonly img: string
}

const characterFolderImageUploadGuard = createLatestOperationGuard<string>()

function snapshotJson(value: unknown): string {
  const snapshot = JSON.stringify(value)
  return snapshot === undefined ? '__undefined__' : snapshot
}

function imageSnapshot(folder: CharacterFolderImageRecord): string {
  return snapshotJson({
    imgFile: folder.imgFile,
    img: folder.img,
  })
}

function isFolderRecord(value: CharacterFolderImageOrderEntry): value is CharacterFolderImageRecord {
  return !!value && typeof value === 'object' && Array.isArray(value.data)
}

function findFolderById(
  characterOrder: readonly CharacterFolderImageOrderEntry[] | null | undefined,
  folderId: string,
): CharacterFolderImageRecord | null {
  if (!Array.isArray(characterOrder)) return null

  for (const entry of characterOrder) {
    if (isFolderRecord(entry) && entry.id === folderId) {
      return entry
    }
  }
  return null
}

export function captureCharacterFolderImageUploadTarget(input: {
  characterOrder: readonly CharacterFolderImageOrderEntry[] | null | undefined
  folderId: string | null | undefined
}): CharacterFolderImageUploadTarget | null {
  const folderId = input.folderId?.trim()
  if (!folderId) return null

  const folder = findFolderById(input.characterOrder, folderId)
  if (!folder) return null

  return {
    folderId,
    imageSnapshot: imageSnapshot(folder),
  }
}

export function beginCharacterFolderImageUpload(
  target: CharacterFolderImageUploadTarget,
): CharacterFolderImageUploadOperation {
  return {
    ...target,
    token: characterFolderImageUploadGuard.issue(target.folderId),
  }
}

export function clearCharacterFolderImageUpload(operation: CharacterFolderImageUploadOperation): void {
  characterFolderImageUploadGuard.clear(operation.token)
}

export function isFreshCharacterFolderImageUpload(input: {
  operation: CharacterFolderImageUploadOperation
  characterOrder: readonly CharacterFolderImageOrderEntry[] | null | undefined
}): boolean {
  if (!characterFolderImageUploadGuard.isLatest(input.operation.token)) return false

  const folder = findFolderById(input.characterOrder, input.operation.folderId)
  if (!folder) return false

  return imageSnapshot(folder) === input.operation.imageSnapshot
}

export function resolveFreshCharacterFolderImageUploadPatch(input: {
  operation: CharacterFolderImageUploadOperation
  characterOrder: readonly CharacterFolderImageOrderEntry[] | null | undefined
  patch: CharacterFolderImageUploadPatch
}): CharacterFolderImageUploadPatch | null {
  if (
    !isFreshCharacterFolderImageUpload({
      operation: input.operation,
      characterOrder: input.characterOrder,
    })
  ) {
    return null
  }

  return {
    imgFile: input.patch.imgFile,
    img: input.patch.img,
  }
}
