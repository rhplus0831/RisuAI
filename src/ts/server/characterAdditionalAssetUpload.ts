import { createLatestOperationGuard, type LatestOperationToken, type OperationTargetKey } from './staleStateGuards'

export type CharacterAdditionalAssetEntry = [string, string, string]

export interface CharacterAdditionalAssetUploadTarget {
  readonly characterId: string
  readonly characterIndex?: number
  readonly additionalAssetsSnapshot: string
}

export interface CharacterAdditionalAssetUploadOperation extends CharacterAdditionalAssetUploadTarget {
  readonly token: LatestOperationToken<string>
}

export interface CharacterAdditionalAssetUploadFreshness {
  readonly currentCharacterId: string | null | undefined
  readonly rowCharacterId?: string | null | undefined
  readonly draftCharacterId?: string | null | undefined
  readonly additionalAssets: readonly CharacterAdditionalAssetEntry[] | null | undefined
}

const additionalAssetUploadGuard = createLatestOperationGuard<string>()

function snapshotJson(value: unknown): string {
  const snapshot = JSON.stringify(value)
  return snapshot === undefined ? '__undefined__' : snapshot
}

function normalizeAdditionalAssets(
  additionalAssets: readonly CharacterAdditionalAssetEntry[] | null | undefined,
): CharacterAdditionalAssetEntry[] {
  return additionalAssets ? additionalAssets.map((asset) => [...asset] as CharacterAdditionalAssetEntry) : []
}

function additionalAssetsSnapshot(additionalAssets: readonly CharacterAdditionalAssetEntry[] | null | undefined) {
  return snapshotJson(normalizeAdditionalAssets(additionalAssets))
}

function matchesTargetId(id: OperationTargetKey | null | undefined, target: string): boolean {
  return id === target
}

export function captureCharacterAdditionalAssetUploadTarget(input: {
  characterId: string | null | undefined
  characterIndex?: number
  additionalAssets: readonly CharacterAdditionalAssetEntry[] | null | undefined
}): CharacterAdditionalAssetUploadTarget | null {
  if (!input.characterId) return null
  return {
    characterId: input.characterId,
    characterIndex: input.characterIndex,
    additionalAssetsSnapshot: additionalAssetsSnapshot(input.additionalAssets),
  }
}

export function beginCharacterAdditionalAssetUpload(
  target: CharacterAdditionalAssetUploadTarget,
): CharacterAdditionalAssetUploadOperation {
  return {
    ...target,
    token: additionalAssetUploadGuard.issue(target.characterId),
  }
}

export function clearCharacterAdditionalAssetUpload(operation: CharacterAdditionalAssetUploadOperation): void {
  additionalAssetUploadGuard.clear(operation.token)
}

export function isFreshCharacterAdditionalAssetUpload(
  operation: CharacterAdditionalAssetUploadOperation,
  freshness: CharacterAdditionalAssetUploadFreshness,
): boolean {
  if (!additionalAssetUploadGuard.isLatest(operation.token)) return false
  if (!matchesTargetId(freshness.currentCharacterId, operation.characterId)) return false
  if (freshness.rowCharacterId !== undefined && !matchesTargetId(freshness.rowCharacterId, operation.characterId)) {
    return false
  }
  if (freshness.draftCharacterId !== undefined && !matchesTargetId(freshness.draftCharacterId, operation.characterId)) {
    return false
  }
  return additionalAssetsSnapshot(freshness.additionalAssets) === operation.additionalAssetsSnapshot
}

export function appendFreshCharacterAdditionalAssets(input: {
  operation: CharacterAdditionalAssetUploadOperation
  freshness: CharacterAdditionalAssetUploadFreshness
  entries: readonly CharacterAdditionalAssetEntry[]
}): CharacterAdditionalAssetEntry[] | null {
  if (!isFreshCharacterAdditionalAssetUpload(input.operation, input.freshness)) return null
  return [...normalizeAdditionalAssets(input.freshness.additionalAssets), ...normalizeAdditionalAssets(input.entries)]
}
