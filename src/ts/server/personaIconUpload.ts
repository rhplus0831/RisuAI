import { createLatestOperationGuard, type LatestOperationToken } from './staleStateGuards'

export interface PersonaIconRecord {
  readonly id?: string | null
  readonly icon?: unknown
}

export interface PersonaIconUploadTarget {
  readonly personaId: string
  readonly userIconSnapshot: string
  readonly rowIconSnapshot: string
}

export interface PersonaIconUploadOperation extends PersonaIconUploadTarget {
  readonly token: LatestOperationToken<string>
}

export interface PersonaIconUploadFreshness {
  readonly selectedPersonaId: string | null
  readonly userIcon: unknown
  readonly personas: readonly PersonaIconRecord[] | null | undefined
}

const personaIconUploadGuard = createLatestOperationGuard<string>()

function snapshotJson(value: unknown): string {
  const snapshot = JSON.stringify(value)
  return snapshot === undefined ? '__undefined__' : snapshot
}

function nonBlankPersonaId(persona: PersonaIconRecord | null | undefined): string | null {
  const id = persona?.id
  return typeof id === 'string' && id.trim().length > 0 ? id : null
}

function uniquePersonaIndexById(personas: readonly PersonaIconRecord[], personaId: string | null): number | null {
  if (!personaId) return null
  const seen = new Set<string>()
  let selectedIndex = -1
  for (let index = 0; index < personas.length; index += 1) {
    const id = nonBlankPersonaId(personas[index])
    if (!id || seen.has(id)) return null
    seen.add(id)
    if (id === personaId) selectedIndex = index
  }
  return selectedIndex === -1 ? null : selectedIndex
}

export function capturePersonaIconUploadTarget(input: PersonaIconUploadFreshness): PersonaIconUploadTarget | null {
  const personas = input.personas ?? []
  const selectedIndex = uniquePersonaIndexById(personas, input.selectedPersonaId)
  if (selectedIndex === null || !input.selectedPersonaId) return null

  return {
    personaId: input.selectedPersonaId,
    userIconSnapshot: snapshotJson(input.userIcon),
    rowIconSnapshot: snapshotJson(personas[selectedIndex]?.icon),
  }
}

export function beginPersonaIconUpload(target: PersonaIconUploadTarget): PersonaIconUploadOperation {
  return {
    ...target,
    token: personaIconUploadGuard.issue(target.personaId),
  }
}

export function clearPersonaIconUpload(operation: PersonaIconUploadOperation): void {
  personaIconUploadGuard.clear(operation.token)
}

export function resolveFreshPersonaIconUploadIndex(
  operation: PersonaIconUploadOperation,
  freshness: PersonaIconUploadFreshness,
): number | null {
  if (!personaIconUploadGuard.isLatest(operation.token)) return null
  const personas = freshness.personas ?? []
  if (freshness.selectedPersonaId !== operation.personaId) return null
  const selectedIndex = uniquePersonaIndexById(personas, freshness.selectedPersonaId)
  if (selectedIndex === null) return null
  if (snapshotJson(freshness.userIcon) !== operation.userIconSnapshot) return null
  if (snapshotJson(personas[selectedIndex]?.icon) !== operation.rowIconSnapshot) return null
  return selectedIndex
}

export function isFreshPersonaIconUpload(
  operation: PersonaIconUploadOperation,
  freshness: PersonaIconUploadFreshness,
): boolean {
  return resolveFreshPersonaIconUploadIndex(operation, freshness) !== null
}
