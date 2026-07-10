import { createLatestOperationGuard, type LatestOperationToken, type OperationTargetKey } from './staleStateGuards'

export interface CharacterNotificationImageUploadTarget {
  readonly characterId: string
  readonly characterIndex?: number
  readonly draftCharacterId?: string | null
  readonly rowImageSnapshot: string
  readonly draftImageSnapshot: string
}

export interface CharacterNotificationImageUploadOperation extends CharacterNotificationImageUploadTarget {
  readonly token: LatestOperationToken<string>
}

export interface CharacterNotificationImageUploadFreshness {
  readonly currentCharacterId: string | null | undefined
  readonly rowCharacterId?: string | null | undefined
  readonly draftCharacterId?: string | null | undefined
  readonly rowNotificationImage: unknown
  readonly draftNotificationImage: unknown
}

const notificationImageUploadGuard = createLatestOperationGuard<string>()

function snapshotJson(value: unknown): string {
  const snapshot = JSON.stringify(value)
  return snapshot === undefined ? '__undefined__' : snapshot
}

function matchesTargetId(id: OperationTargetKey | null | undefined, target: string): boolean {
  return id === target
}

function matchesCapturedId(id: OperationTargetKey | null | undefined, target: string | null | undefined): boolean {
  return id === target
}

export function captureCharacterNotificationImageUploadTarget(input: {
  characterId: string | null | undefined
  characterIndex?: number
  draftCharacterId?: string | null | undefined
  rowNotificationImage: unknown
  draftNotificationImage: unknown
}): CharacterNotificationImageUploadTarget | null {
  if (!input.characterId) return null

  return {
    characterId: input.characterId,
    characterIndex: input.characterIndex,
    draftCharacterId: input.draftCharacterId,
    rowImageSnapshot: snapshotJson(input.rowNotificationImage),
    draftImageSnapshot: snapshotJson(input.draftNotificationImage),
  }
}

export function beginCharacterNotificationImageUpload(
  target: CharacterNotificationImageUploadTarget,
): CharacterNotificationImageUploadOperation {
  return {
    ...target,
    token: notificationImageUploadGuard.issue(target.characterId),
  }
}

export function clearCharacterNotificationImageUpload(operation: CharacterNotificationImageUploadOperation): void {
  notificationImageUploadGuard.clear(operation.token)
}

export function invalidateCharacterNotificationImageUpload(characterId: string | null | undefined): void {
  if (!characterId) return
  const invalidation = notificationImageUploadGuard.issue(characterId)
  notificationImageUploadGuard.clear(invalidation)
}

export function isFreshCharacterNotificationImageUpload(
  operation: CharacterNotificationImageUploadOperation,
  freshness: CharacterNotificationImageUploadFreshness,
): boolean {
  if (!notificationImageUploadGuard.isLatest(operation.token)) return false
  if (!matchesTargetId(freshness.currentCharacterId, operation.characterId)) return false
  if (operation.characterIndex !== undefined && !matchesTargetId(freshness.rowCharacterId, operation.characterId)) {
    return false
  }
  if (
    operation.draftCharacterId !== undefined &&
    !matchesCapturedId(freshness.draftCharacterId, operation.draftCharacterId)
  ) {
    return false
  }
  if (snapshotJson(freshness.rowNotificationImage) !== operation.rowImageSnapshot) return false
  return snapshotJson(freshness.draftNotificationImage) === operation.draftImageSnapshot
}

export function applyFreshCharacterNotificationImageUpload(input: {
  operation: CharacterNotificationImageUploadOperation
  freshness: CharacterNotificationImageUploadFreshness
  image: string
}): string | null {
  if (!isFreshCharacterNotificationImageUpload(input.operation, input.freshness)) return null
  return input.image
}
