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
  readonly selectedPersona: number
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

function uniquePersonaIdAt(personas: readonly PersonaIconRecord[], index: number): string | null {
  const id = nonBlankPersonaId(personas[index])
  if (!id) return null

  let matches = 0
  for (const persona of personas) {
    if (nonBlankPersonaId(persona) === id) {
      matches += 1
    }
  }
  return matches === 1 ? id : null
}

export function capturePersonaIconUploadTarget(input: PersonaIconUploadFreshness): PersonaIconUploadTarget | null {
  const personas = input.personas ?? []
  const personaId = uniquePersonaIdAt(personas, input.selectedPersona)
  if (!personaId) return null

  return {
    personaId,
    userIconSnapshot: snapshotJson(input.userIcon),
    rowIconSnapshot: snapshotJson(personas[input.selectedPersona]?.icon),
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
  if (uniquePersonaIdAt(personas, freshness.selectedPersona) !== operation.personaId) return null
  if (snapshotJson(freshness.userIcon) !== operation.userIconSnapshot) return null
  if (snapshotJson(personas[freshness.selectedPersona]?.icon) !== operation.rowIconSnapshot) return null
  return freshness.selectedPersona
}

export function isFreshPersonaIconUpload(
  operation: PersonaIconUploadOperation,
  freshness: PersonaIconUploadFreshness,
): boolean {
  return resolveFreshPersonaIconUploadIndex(operation, freshness) !== null
}
