import { createLatestOperationGuard, type LatestOperationToken, type OperationTargetKey } from './staleStateGuards'

export type CharacterEmotionImageEntry = [string, string]

export interface CharacterEmotionUploadTarget {
  readonly characterId: string
  readonly characterIndex?: number
  readonly emotionImagesSnapshot: string
}

export interface CharacterEmotionUploadOperation extends CharacterEmotionUploadTarget {
  readonly token: LatestOperationToken<string>
}

export interface CharacterEmotionUploadFreshness {
  readonly currentCharacterId: string | null | undefined
  readonly rowCharacterId?: string | null | undefined
  readonly draftCharacterId?: string | null | undefined
  readonly emotionImages: readonly CharacterEmotionImageEntry[] | null | undefined
}

const emotionUploadGuard = createLatestOperationGuard<string>()

function snapshotJson(value: unknown): string {
  const snapshot = JSON.stringify(value)
  return snapshot === undefined ? '__undefined__' : snapshot
}

function normalizeEmotionImages(
  emotionImages: readonly CharacterEmotionImageEntry[] | null | undefined,
): CharacterEmotionImageEntry[] {
  return emotionImages ? emotionImages.map((emotion) => [...emotion] as CharacterEmotionImageEntry) : []
}

function emotionImagesSnapshot(emotionImages: readonly CharacterEmotionImageEntry[] | null | undefined): string {
  return snapshotJson(normalizeEmotionImages(emotionImages))
}

function matchesTargetId(id: OperationTargetKey | null | undefined, target: string): boolean {
  return id === target
}

export function captureCharacterEmotionUploadTarget(input: {
  characterId: string | null | undefined
  characterIndex?: number
  emotionImages: readonly CharacterEmotionImageEntry[] | null | undefined
}): CharacterEmotionUploadTarget | null {
  if (!input.characterId) return null
  return {
    characterId: input.characterId,
    characterIndex: input.characterIndex,
    emotionImagesSnapshot: emotionImagesSnapshot(input.emotionImages),
  }
}

export function beginCharacterEmotionUpload(target: CharacterEmotionUploadTarget): CharacterEmotionUploadOperation {
  return {
    ...target,
    token: emotionUploadGuard.issue(target.characterId),
  }
}

export function clearCharacterEmotionUpload(operation: CharacterEmotionUploadOperation): void {
  emotionUploadGuard.clear(operation.token)
}

export function isFreshCharacterEmotionUpload(
  operation: CharacterEmotionUploadOperation,
  freshness: CharacterEmotionUploadFreshness,
): boolean {
  if (!emotionUploadGuard.isLatest(operation.token)) return false
  if (!matchesTargetId(freshness.currentCharacterId, operation.characterId)) return false
  if (freshness.rowCharacterId !== undefined && !matchesTargetId(freshness.rowCharacterId, operation.characterId)) {
    return false
  }
  if (freshness.draftCharacterId !== undefined && !matchesTargetId(freshness.draftCharacterId, operation.characterId)) {
    return false
  }
  return emotionImagesSnapshot(freshness.emotionImages) === operation.emotionImagesSnapshot
}

export function appendFreshCharacterEmotionImages(input: {
  operation: CharacterEmotionUploadOperation
  freshness: CharacterEmotionUploadFreshness
  entries: readonly CharacterEmotionImageEntry[]
}): CharacterEmotionImageEntry[] | null {
  if (!isFreshCharacterEmotionUpload(input.operation, input.freshness)) return null
  return [...normalizeEmotionImages(input.freshness.emotionImages), ...normalizeEmotionImages(input.entries)]
}
