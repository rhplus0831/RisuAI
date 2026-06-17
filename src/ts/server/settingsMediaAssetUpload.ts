import { createLatestOperationGuard, type LatestOperationToken } from './staleStateGuards'

export type SettingsMediaAssetUploadTargetId = 'nai-character-reference' | 'nai-i2i-base' | 'wavespeed-reference'

export interface SettingsMediaAssetUploadFieldKeys {
  readonly image: string
  readonly base64image: string
}

export type SettingsMediaAssetUploadConfig = Record<string, unknown>
export type SettingsMediaAssetUploadContext = Record<string, unknown>

export interface SettingsMediaAssetUploadTarget {
  readonly targetId: SettingsMediaAssetUploadTargetId
  readonly fieldKeys: SettingsMediaAssetUploadFieldKeys
  readonly fieldsSnapshot: string
  readonly contextSnapshot: string
}

export interface SettingsMediaAssetUploadOperation extends SettingsMediaAssetUploadTarget {
  readonly token: LatestOperationToken<SettingsMediaAssetUploadTargetId>
}

export interface SettingsMediaAssetUploadFreshness {
  readonly config: SettingsMediaAssetUploadConfig | null | undefined
  readonly context: SettingsMediaAssetUploadContext
}

const settingsMediaAssetUploadGuard = createLatestOperationGuard<SettingsMediaAssetUploadTargetId>()

function snapshotJson(value: unknown): string {
  const snapshot = JSON.stringify(value)
  return snapshot === undefined ? '__undefined__' : snapshot
}

function normalizeConfig(config: SettingsMediaAssetUploadConfig | null | undefined): SettingsMediaAssetUploadConfig {
  return config ? { ...config } : {}
}

function assetFieldSnapshot(
  config: SettingsMediaAssetUploadConfig | null | undefined,
  fieldKeys: SettingsMediaAssetUploadFieldKeys,
): string {
  const source = normalizeConfig(config)
  return snapshotJson({
    [fieldKeys.image]: source[fieldKeys.image],
    [fieldKeys.base64image]: source[fieldKeys.base64image],
  })
}

export function captureSettingsMediaAssetUploadTarget(input: {
  targetId: SettingsMediaAssetUploadTargetId
  fieldKeys: SettingsMediaAssetUploadFieldKeys
  config: SettingsMediaAssetUploadConfig | null | undefined
  context: SettingsMediaAssetUploadContext
}): SettingsMediaAssetUploadTarget {
  return {
    targetId: input.targetId,
    fieldKeys: input.fieldKeys,
    fieldsSnapshot: assetFieldSnapshot(input.config, input.fieldKeys),
    contextSnapshot: snapshotJson(input.context),
  }
}

export function beginSettingsMediaAssetUpload(
  target: SettingsMediaAssetUploadTarget,
): SettingsMediaAssetUploadOperation {
  return {
    ...target,
    token: settingsMediaAssetUploadGuard.issue(target.targetId),
  }
}

export function clearSettingsMediaAssetUpload(operation: SettingsMediaAssetUploadOperation): void {
  settingsMediaAssetUploadGuard.clear(operation.token)
}

export function isFreshSettingsMediaAssetUpload(
  operation: SettingsMediaAssetUploadOperation,
  freshness: SettingsMediaAssetUploadFreshness,
): boolean {
  if (!settingsMediaAssetUploadGuard.isLatest(operation.token)) return false
  if (assetFieldSnapshot(freshness.config, operation.fieldKeys) !== operation.fieldsSnapshot) return false
  return snapshotJson(freshness.context) === operation.contextSnapshot
}

export function applyFreshSettingsMediaAssetUpload(input: {
  operation: SettingsMediaAssetUploadOperation
  freshness: SettingsMediaAssetUploadFreshness
  image: unknown
  base64Image: unknown
}): SettingsMediaAssetUploadConfig | null {
  if (!isFreshSettingsMediaAssetUpload(input.operation, input.freshness)) return null

  return {
    ...normalizeConfig(input.freshness.config),
    [input.operation.fieldKeys.image]: input.image,
    [input.operation.fieldKeys.base64image]: input.base64Image,
  }
}
