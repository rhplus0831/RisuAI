import type { OnnxModelFiles } from 'src/ts/process/transformers'

import { createLatestOperationGuard, type LatestOperationToken, type OperationTargetKey } from './staleStateGuards'

export type CharacterTtsAssetUploadKind = 'vits-model' | 'gptsovits-ref-audio'

export interface CharacterGptSoVitsRefAudioData {
  readonly fileName: string
  readonly assetId: string
}

export interface CharacterTtsAssetUploadTarget {
  readonly characterId: string
  readonly characterIndex?: number
  readonly draftCharacterId?: string | null
  readonly kind: CharacterTtsAssetUploadKind
  readonly ttsMode: string | null | undefined
  readonly fieldSnapshot: string
}

export interface CharacterTtsAssetUploadOperation extends CharacterTtsAssetUploadTarget {
  readonly token: LatestOperationToken<string>
}

export interface CharacterTtsAssetUploadFreshness {
  readonly currentCharacterId: string | null | undefined
  readonly rowCharacterId?: string | null | undefined
  readonly draftCharacterId?: string | null | undefined
  readonly ttsMode: string | null | undefined
  readonly vits?: OnnxModelFiles | null | undefined
  readonly refAudioData?: CharacterGptSoVitsRefAudioData | null | undefined
}

const characterTtsAssetUploadGuard = createLatestOperationGuard<string>()

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

function operationTargetKey(target: Pick<CharacterTtsAssetUploadTarget, 'characterId' | 'kind'>): string {
  return `${target.kind}:${target.characterId}`
}

function targetFieldSnapshot(input: {
  kind: CharacterTtsAssetUploadKind
  vits?: OnnxModelFiles | null | undefined
  refAudioData?: CharacterGptSoVitsRefAudioData | null | undefined
}): string {
  switch (input.kind) {
    case 'vits-model':
      return snapshotJson(input.vits)
    case 'gptsovits-ref-audio':
      return snapshotJson(input.refAudioData)
  }
}

export function captureCharacterTtsAssetUploadTarget(input: {
  characterId: string | null | undefined
  characterIndex?: number
  draftCharacterId?: string | null | undefined
  kind: CharacterTtsAssetUploadKind
  ttsMode: string | null | undefined
  vits?: OnnxModelFiles | null | undefined
  refAudioData?: CharacterGptSoVitsRefAudioData | null | undefined
}): CharacterTtsAssetUploadTarget | null {
  if (!input.characterId) return null

  return {
    characterId: input.characterId,
    characterIndex: input.characterIndex,
    draftCharacterId: input.draftCharacterId,
    kind: input.kind,
    ttsMode: input.ttsMode,
    fieldSnapshot: targetFieldSnapshot(input),
  }
}

export function beginCharacterTtsAssetUpload(target: CharacterTtsAssetUploadTarget): CharacterTtsAssetUploadOperation {
  return {
    ...target,
    token: characterTtsAssetUploadGuard.issue(operationTargetKey(target)),
  }
}

export function clearCharacterTtsAssetUpload(operation: CharacterTtsAssetUploadOperation): void {
  characterTtsAssetUploadGuard.clear(operation.token)
}

export function isFreshCharacterTtsAssetUpload(
  operation: CharacterTtsAssetUploadOperation,
  freshness: CharacterTtsAssetUploadFreshness,
): boolean {
  if (!characterTtsAssetUploadGuard.isLatest(operation.token)) return false
  if (!matchesTargetId(freshness.currentCharacterId, operation.characterId)) return false
  if (freshness.rowCharacterId !== undefined && !matchesTargetId(freshness.rowCharacterId, operation.characterId)) {
    return false
  }
  if (
    operation.draftCharacterId !== undefined &&
    !matchesCapturedId(freshness.draftCharacterId, operation.draftCharacterId)
  ) {
    return false
  }
  if (freshness.ttsMode !== operation.ttsMode) return false

  return (
    targetFieldSnapshot({ kind: operation.kind, vits: freshness.vits, refAudioData: freshness.refAudioData }) ===
    operation.fieldSnapshot
  )
}

export function applyFreshCharacterVitsModelRegistration(input: {
  operation: CharacterTtsAssetUploadOperation
  freshness: CharacterTtsAssetUploadFreshness
  model: OnnxModelFiles
}): OnnxModelFiles | null {
  if (input.operation.kind !== 'vits-model') return null
  if (!isFreshCharacterTtsAssetUpload(input.operation, input.freshness)) return null
  return input.model
}

export function applyFreshCharacterGptSoVitsReferenceAudioUpload(input: {
  operation: CharacterTtsAssetUploadOperation
  freshness: CharacterTtsAssetUploadFreshness
  refAudioData: CharacterGptSoVitsRefAudioData
}): CharacterGptSoVitsRefAudioData | null {
  if (input.operation.kind !== 'gptsovits-ref-audio') return null
  if (!isFreshCharacterTtsAssetUpload(input.operation, input.freshness)) return null
  return input.refAudioData
}
