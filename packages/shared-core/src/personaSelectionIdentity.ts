export interface PersonaSelectionIdentityRepairResult {
  changed: boolean
  selectedPersona: number
  selectedPersonaId: string | null
}

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function stablePersonaId(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

function mintDeterministicPersonaId(index: number, usedIds: ReadonlySet<string>): string {
  const base = `persona-${index + 1}`
  if (!usedIds.has(base)) return base

  let suffix = 2
  while (usedIds.has(`${base}-${suffix}`)) suffix += 1
  return `${base}-${suffix}`
}

/**
 * Repairs durable persona row/selection identity at an explicit migration,
 * import, default-initialization, or recovery boundary.
 *
 * Array order is preserved. The first occurrence of every non-blank id keeps
 * that id; later duplicates and missing ids receive deterministic, index-based
 * ids without colliding with a valid id that appears later in the collection.
 * Selection precedence is evaluated against the pre-repair input: one unique
 * stable id, then a valid legacy numeric index, then the first record or null.
 */
export function repairPersonaSelectionIdentity(database: JsonRecord): PersonaSelectionIdentityRepairResult {
  const personas = Array.isArray(database.personas) ? database.personas : []
  const idCounts = new Map<string, number>()
  const firstIndexById = new Map<string, number>()

  for (let index = 0; index < personas.length; index += 1) {
    const persona = personas[index]
    if (!isRecord(persona)) continue
    const id = stablePersonaId(persona.id)
    if (!id) continue
    idCounts.set(id, (idCounts.get(id) ?? 0) + 1)
    if (!firstIndexById.has(id)) firstIndexById.set(id, index)
  }

  const requestedId = stablePersonaId(database.selectedPersonaId)
  let selectedPersona = requestedId && idCounts.get(requestedId) === 1 ? (firstIndexById.get(requestedId) ?? -1) : -1
  if (selectedPersona === -1) {
    const legacyIndex = database.selectedPersona
    if (
      Number.isInteger(legacyIndex) &&
      (legacyIndex as number) >= 0 &&
      (legacyIndex as number) < personas.length &&
      isRecord(personas[legacyIndex as number])
    ) {
      selectedPersona = legacyIndex as number
    }
  }
  if (selectedPersona === -1) selectedPersona = personas.findIndex(isRecord)

  // Reserve every id that will be retained before minting replacements. This
  // prevents an early missing row from stealing a later row's stable id.
  const usedIds = new Set(firstIndexById.keys())
  let changed = false
  for (let index = 0; index < personas.length; index += 1) {
    const persona = personas[index]
    if (!isRecord(persona)) continue
    const id = stablePersonaId(persona.id)
    if (id && firstIndexById.get(id) === index) continue

    const repairedId = mintDeterministicPersonaId(index, usedIds)
    usedIds.add(repairedId)
    persona.id = repairedId
    changed = true
  }

  const selectedPersonaId =
    selectedPersona >= 0 && isRecord(personas[selectedPersona]) ? stablePersonaId(personas[selectedPersona].id) : null
  if (database.selectedPersona !== selectedPersona) {
    database.selectedPersona = selectedPersona
    changed = true
  }
  if (database.selectedPersonaId !== selectedPersonaId) {
    database.selectedPersonaId = selectedPersonaId
    changed = true
  }

  return { changed, selectedPersona, selectedPersonaId }
}

/** Strict normal-runtime compatibility projection: never repairs or falls back. */
export function selectedPersonaIndexFromStableId(database: JsonRecord): number {
  const selectedPersonaId = stablePersonaId(database.selectedPersonaId)
  if (!selectedPersonaId || !Array.isArray(database.personas)) return -1

  let selectedIndex = -1
  for (let index = 0; index < database.personas.length; index += 1) {
    const persona = database.personas[index]
    if (!isRecord(persona) || stablePersonaId(persona.id) !== selectedPersonaId) continue
    if (selectedIndex !== -1) return -1
    selectedIndex = index
  }
  return selectedIndex
}
