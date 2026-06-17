import { createLatestOperationGuard, type LatestOperationToken } from './staleStateGuards'

const BIAS_IMPORT_TARGET = 'biasImport' as const

export type BiasImportValue = Array<[string, number]>

export interface BiasImportTarget {
  readonly selectedPromptPresetId: string
  readonly biasSnapshot: string
}

export interface BiasImportOperation extends BiasImportTarget {
  readonly token: LatestOperationToken<typeof BIAS_IMPORT_TARGET>
}

export interface BiasImportFreshness {
  readonly selectedPromptPresetId: string | null | undefined
  readonly bias: unknown
}

const biasImportGuard = createLatestOperationGuard<typeof BIAS_IMPORT_TARGET>()

function snapshotJson(value: unknown): string {
  const snapshot = JSON.stringify(value)
  return snapshot === undefined ? '__undefined__' : snapshot
}

function nonBlankId(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

export function parseBiasImport(source: string): BiasImportValue | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch {
    return null
  }

  return Array.isArray(parsed) ? (parsed as BiasImportValue) : null
}

export function captureBiasImportTarget(freshness: BiasImportFreshness): BiasImportTarget | null {
  const selectedPromptPresetId = nonBlankId(freshness.selectedPromptPresetId)
  if (!selectedPromptPresetId) return null

  return {
    selectedPromptPresetId,
    biasSnapshot: snapshotJson(freshness.bias),
  }
}

export function beginBiasImport(target: BiasImportTarget): BiasImportOperation {
  return {
    ...target,
    token: biasImportGuard.issue(BIAS_IMPORT_TARGET),
  }
}

export function clearBiasImport(operation: BiasImportOperation): void {
  biasImportGuard.clear(operation.token)
}

export function isFreshBiasImport(operation: BiasImportOperation, freshness: BiasImportFreshness): boolean {
  if (!biasImportGuard.isLatest(operation.token)) return false
  if (nonBlankId(freshness.selectedPromptPresetId) !== operation.selectedPromptPresetId) return false
  return snapshotJson(freshness.bias) === operation.biasSnapshot
}

export function resolveFreshBiasImportValue(input: {
  operation: BiasImportOperation
  freshness: BiasImportFreshness
  bias: BiasImportValue
}): BiasImportValue | null {
  if (!isFreshBiasImport(input.operation, input.freshness)) return null
  return input.bias
}
