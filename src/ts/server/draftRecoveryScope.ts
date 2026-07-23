export interface DraftRecoveryScope {
  readonly databaseLineage: string
  readonly writerSessionId: string
}

const DRAFT_SCOPE_VALUE_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/

let activeDraftRecoveryScope: DraftRecoveryScope | null = null

/**
 * Bind non-authoritative recovery drafts to authenticated bootstrap metadata.
 * Draft stores intentionally consume this read-only runtime instead of the
 * mutation outbox's private ownership state.
 */
export function initializeDraftRecoveryScope(input: DraftRecoveryScope): DraftRecoveryScope {
  const databaseLineage = normalizeDraftScopeValue(input.databaseLineage, 'database lineage')
  const writerSessionId = normalizeDraftScopeValue(input.writerSessionId, 'writer session')
  activeDraftRecoveryScope = Object.freeze({ databaseLineage, writerSessionId })
  return activeDraftRecoveryScope
}

export function readDraftRecoveryScope(): DraftRecoveryScope | null {
  return activeDraftRecoveryScope
}

export function isCurrentDraftRecoveryScope(scope: DraftRecoveryScope): boolean {
  return (
    activeDraftRecoveryScope?.databaseLineage === scope.databaseLineage &&
    activeDraftRecoveryScope.writerSessionId === scope.writerSessionId
  )
}

export function draftRecoveryScopesEqual(left: DraftRecoveryScope, right: DraftRecoveryScope): boolean {
  return left.databaseLineage === right.databaseLineage && left.writerSessionId === right.writerSessionId
}

export function resetDraftRecoveryScopeForTests(): void {
  activeDraftRecoveryScope = null
}

function normalizeDraftScopeValue(value: string, label: string): string {
  const normalized = value.trim()
  if (!DRAFT_SCOPE_VALUE_PATTERN.test(normalized)) {
    throw new TypeError(`Draft recovery ${label} is invalid`)
  }
  return normalized
}
