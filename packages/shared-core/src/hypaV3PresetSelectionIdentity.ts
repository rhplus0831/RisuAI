export interface HypaV3PresetSelectionIdentityRepairResult {
  changed: boolean
  hypaV3PresetId: number
  selectedHypaV3PresetId: string | null
}

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function stableHypaV3PresetId(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

function mintDeterministicHypaV3PresetId(index: number, usedIds: ReadonlySet<string>): string {
  const base = `hypa-v3-preset-${index + 1}`
  if (!usedIds.has(base)) return base

  let suffix = 2
  while (usedIds.has(`${base}-${suffix}`)) suffix += 1
  return `${base}-${suffix}`
}

/**
 * Repairs durable Hypa V3 preset row/selection identity at an explicit
 * migration, import, default-initialization, or recovery boundary.
 *
 * Array order is preserved. The first occurrence of every non-blank id keeps
 * that id; later duplicates and missing ids receive deterministic, index-based
 * ids without colliding with a valid id that appears later in the collection.
 * Selection precedence is evaluated against the pre-repair input: one unique
 * stable id, then a valid legacy numeric index, then the first record or null.
 */
export function repairHypaV3PresetSelectionIdentity(database: JsonRecord): HypaV3PresetSelectionIdentityRepairResult {
  const presets = Array.isArray(database.hypaV3Presets) ? database.hypaV3Presets : []
  const idCounts = new Map<string, number>()
  const firstIndexById = new Map<string, number>()

  for (let index = 0; index < presets.length; index += 1) {
    const preset = presets[index]
    if (!isRecord(preset)) continue
    const id = stableHypaV3PresetId(preset.id)
    if (!id) continue
    idCounts.set(id, (idCounts.get(id) ?? 0) + 1)
    if (!firstIndexById.has(id)) firstIndexById.set(id, index)
  }

  const requestedId = stableHypaV3PresetId(database.selectedHypaV3PresetId)
  let hypaV3PresetId = requestedId && idCounts.get(requestedId) === 1 ? (firstIndexById.get(requestedId) ?? -1) : -1
  if (hypaV3PresetId === -1) {
    const legacyIndex = database.hypaV3PresetId
    if (
      Number.isInteger(legacyIndex) &&
      (legacyIndex as number) >= 0 &&
      (legacyIndex as number) < presets.length &&
      isRecord(presets[legacyIndex as number])
    ) {
      hypaV3PresetId = legacyIndex as number
    }
  }
  if (hypaV3PresetId === -1) hypaV3PresetId = presets.findIndex(isRecord)

  // Reserve every id that will be retained before minting replacements. This
  // prevents an early missing row from stealing a later row's stable id.
  const usedIds = new Set(firstIndexById.keys())
  let changed = false
  for (let index = 0; index < presets.length; index += 1) {
    const preset = presets[index]
    if (!isRecord(preset)) continue
    const id = stableHypaV3PresetId(preset.id)
    if (id && firstIndexById.get(id) === index) continue

    const repairedId = mintDeterministicHypaV3PresetId(index, usedIds)
    usedIds.add(repairedId)
    preset.id = repairedId
    changed = true
  }

  const selectedHypaV3PresetId =
    hypaV3PresetId >= 0 && isRecord(presets[hypaV3PresetId]) ? stableHypaV3PresetId(presets[hypaV3PresetId].id) : null
  if (database.hypaV3PresetId !== hypaV3PresetId) {
    database.hypaV3PresetId = hypaV3PresetId
    changed = true
  }
  if (database.selectedHypaV3PresetId !== selectedHypaV3PresetId) {
    database.selectedHypaV3PresetId = selectedHypaV3PresetId
    changed = true
  }

  return { changed, hypaV3PresetId, selectedHypaV3PresetId }
}

/** Strict normal-runtime compatibility projection: never repairs or falls back. */
export function hypaV3PresetIndexFromStableId(database: JsonRecord): number {
  const selectedHypaV3PresetId = stableHypaV3PresetId(database.selectedHypaV3PresetId)
  if (!selectedHypaV3PresetId || !Array.isArray(database.hypaV3Presets)) return -1

  let selectedIndex = -1
  for (let index = 0; index < database.hypaV3Presets.length; index += 1) {
    const preset = database.hypaV3Presets[index]
    if (!isRecord(preset) || stableHypaV3PresetId(preset.id) !== selectedHypaV3PresetId) continue
    if (selectedIndex !== -1) return -1
    selectedIndex = index
  }
  return selectedIndex
}
