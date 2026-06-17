import type { SeparateParameters } from '../storage/database.svelte'
import { createLatestOperationGuard, type LatestOperationToken } from './staleStateGuards'

const SEPERATE_PARAMETERS_IMPORT_TARGET = 'seperateParametersImport' as const

export type SeperateParametersImportSlotKind = 'base' | 'override'

export interface SeperateParametersImportFreshness {
  readonly slotKind: SeperateParametersImportSlotKind
  readonly targetKey: string | null | undefined
  readonly selectedOptionIsParameters: boolean
  readonly byModel: boolean
  readonly activeSelector: string | null | undefined
  readonly targetSlot: unknown
}

export interface SeperateParametersImportTarget {
  readonly slotKind: SeperateParametersImportSlotKind
  readonly targetKey: string
  readonly selectedOptionIsParameters: boolean
  readonly byModel: boolean
  readonly activeSelector: string
  readonly targetSlotSnapshot: string
}

export interface SeperateParametersImportOperation extends SeperateParametersImportTarget {
  readonly token: LatestOperationToken<typeof SEPERATE_PARAMETERS_IMPORT_TARGET>
}

const seperateParametersImportGuard = createLatestOperationGuard<typeof SEPERATE_PARAMETERS_IMPORT_TARGET>()

function snapshotJson(value: unknown): string {
  const snapshot = JSON.stringify(value)
  return snapshot === undefined ? '__undefined__' : snapshot
}

function nonBlankId(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function parseSeperateParametersImport(source: string): SeparateParameters | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch {
    return null
  }

  return isRecord(parsed) ? (parsed as SeparateParameters) : null
}

export function captureSeperateParametersImportTarget(
  freshness: SeperateParametersImportFreshness,
): SeperateParametersImportTarget | null {
  const targetKey = nonBlankId(freshness.targetKey)
  const activeSelector = nonBlankId(freshness.activeSelector)
  if (!freshness.selectedOptionIsParameters || !targetKey || !activeSelector) return null

  return {
    slotKind: freshness.slotKind,
    targetKey,
    selectedOptionIsParameters: freshness.selectedOptionIsParameters,
    byModel: freshness.byModel,
    activeSelector,
    targetSlotSnapshot: snapshotJson(freshness.targetSlot),
  }
}

export function beginSeperateParametersImport(
  target: SeperateParametersImportTarget,
): SeperateParametersImportOperation {
  return {
    ...target,
    token: seperateParametersImportGuard.issue(SEPERATE_PARAMETERS_IMPORT_TARGET),
  }
}

export function clearSeperateParametersImport(operation: SeperateParametersImportOperation): void {
  seperateParametersImportGuard.clear(operation.token)
}

export function isFreshSeperateParametersImport(
  operation: SeperateParametersImportOperation,
  freshness: SeperateParametersImportFreshness,
): boolean {
  if (!seperateParametersImportGuard.isLatest(operation.token)) return false
  if (freshness.slotKind !== operation.slotKind) return false
  if (nonBlankId(freshness.targetKey) !== operation.targetKey) return false
  if (freshness.selectedOptionIsParameters !== operation.selectedOptionIsParameters) return false
  if (freshness.byModel !== operation.byModel) return false
  if (nonBlankId(freshness.activeSelector) !== operation.activeSelector) return false
  return snapshotJson(freshness.targetSlot) === operation.targetSlotSnapshot
}

export function resolveFreshSeperateParametersImportValue(input: {
  operation: SeperateParametersImportOperation
  freshness: SeperateParametersImportFreshness
  imported: SeparateParameters
}): SeparateParameters | null {
  if (!isFreshSeperateParametersImport(input.operation, input.freshness)) return null
  return input.imported
}
