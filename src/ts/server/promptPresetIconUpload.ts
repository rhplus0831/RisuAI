import { createLatestOperationGuard, type LatestOperationToken } from './staleStateGuards'

export interface PromptPresetIconRecord {
  readonly id?: string | null
  readonly image?: unknown
}

export interface PromptPresetIconUploadTarget {
  readonly presetId: string
  readonly presetIndex: number
  readonly imageSnapshot: string
}

export interface PromptPresetIconUploadOperation extends PromptPresetIconUploadTarget {
  readonly token: LatestOperationToken<string>
}

export interface PromptPresetIconUploadFreshness {
  readonly selectedPresetId: string | null | undefined
  readonly rowPresetId: string | null | undefined
  readonly image: unknown
}

const promptPresetIconUploadGuard = createLatestOperationGuard<string>()

function snapshotJson(value: unknown): string {
  const snapshot = JSON.stringify(value)
  return snapshot === undefined ? '__undefined__' : snapshot
}

function matchesTargetId(id: string | null | undefined, target: string): boolean {
  return id === target
}

export function capturePromptPresetIconUploadTarget(input: {
  presetIndex: number
  preset: PromptPresetIconRecord | null | undefined
}): PromptPresetIconUploadTarget | null {
  if (input.presetIndex < 0) return null
  const presetId = input.preset?.id
  if (typeof presetId !== 'string' || !presetId.trim()) return null

  return {
    presetId,
    presetIndex: input.presetIndex,
    imageSnapshot: snapshotJson(input.preset?.image),
  }
}

export function beginPromptPresetIconUpload(target: PromptPresetIconUploadTarget): PromptPresetIconUploadOperation {
  return {
    ...target,
    token: promptPresetIconUploadGuard.issue(target.presetId),
  }
}

export function clearPromptPresetIconUpload(operation: PromptPresetIconUploadOperation): void {
  promptPresetIconUploadGuard.clear(operation.token)
}

export function isFreshPromptPresetIconUpload(
  operation: PromptPresetIconUploadOperation,
  freshness: PromptPresetIconUploadFreshness,
): boolean {
  if (!promptPresetIconUploadGuard.isLatest(operation.token)) return false
  if (!matchesTargetId(freshness.selectedPresetId, operation.presetId)) return false
  if (!matchesTargetId(freshness.rowPresetId, operation.presetId)) return false
  return snapshotJson(freshness.image) === operation.imageSnapshot
}

export function resolveFreshPromptPresetIconUploadIndex(input: {
  operation: PromptPresetIconUploadOperation
  freshness: PromptPresetIconUploadFreshness
}): number | null {
  if (!isFreshPromptPresetIconUpload(input.operation, input.freshness)) return null
  return input.operation.presetIndex
}
