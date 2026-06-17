import { createLatestOperationGuard, type LatestOperationToken, type OperationTargetKey } from './staleStateGuards'

export type ModuleAssetEntry = [string, string, string]

export interface ModuleAssetUploadTarget {
  readonly moduleId: string
  readonly assetsSnapshot: string
}

export interface ModuleAssetUploadOperation extends ModuleAssetUploadTarget {
  readonly token: LatestOperationToken<string>
}

export interface ModuleAssetUploadFreshness {
  readonly currentModuleId: string | null | undefined
  readonly assets: readonly ModuleAssetEntry[] | null | undefined
}

const moduleAssetUploadGuard = createLatestOperationGuard<string>()

function snapshotJson(value: unknown): string {
  const snapshot = JSON.stringify(value)
  return snapshot === undefined ? '__undefined__' : snapshot
}

function normalizeModuleAssets(assets: readonly ModuleAssetEntry[] | null | undefined): ModuleAssetEntry[] {
  return assets ? assets.map((asset) => [...asset] as ModuleAssetEntry) : []
}

function moduleAssetsSnapshot(assets: readonly ModuleAssetEntry[] | null | undefined): string {
  return snapshotJson(normalizeModuleAssets(assets))
}

function matchesTargetId(id: OperationTargetKey | null | undefined, target: string): boolean {
  return id === target
}

export function captureModuleAssetUploadTarget(input: {
  moduleId: string | null | undefined
  assets: readonly ModuleAssetEntry[] | null | undefined
}): ModuleAssetUploadTarget | null {
  if (!input.moduleId) return null
  return {
    moduleId: input.moduleId,
    assetsSnapshot: moduleAssetsSnapshot(input.assets),
  }
}

export function beginModuleAssetUpload(target: ModuleAssetUploadTarget): ModuleAssetUploadOperation {
  return {
    ...target,
    token: moduleAssetUploadGuard.issue(target.moduleId),
  }
}

export function clearModuleAssetUpload(operation: ModuleAssetUploadOperation): void {
  moduleAssetUploadGuard.clear(operation.token)
}

export function isFreshModuleAssetUpload(
  operation: ModuleAssetUploadOperation,
  freshness: ModuleAssetUploadFreshness,
): boolean {
  if (!moduleAssetUploadGuard.isLatest(operation.token)) return false
  if (!matchesTargetId(freshness.currentModuleId, operation.moduleId)) return false
  return moduleAssetsSnapshot(freshness.assets) === operation.assetsSnapshot
}

export function appendFreshModuleAssets(input: {
  operation: ModuleAssetUploadOperation
  freshness: ModuleAssetUploadFreshness
  entries: readonly ModuleAssetEntry[]
}): ModuleAssetEntry[] | null {
  if (!isFreshModuleAssetUpload(input.operation, input.freshness)) return null
  return [...normalizeModuleAssets(input.freshness.assets), ...normalizeModuleAssets(input.entries)]
}
