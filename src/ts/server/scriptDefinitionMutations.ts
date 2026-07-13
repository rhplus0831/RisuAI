export type ScriptDefinitionCollectionMutation =
  | { op: 'update'; id: string; patch: Record<string, unknown>; deleteKeys: string[] }
  | { op: 'create'; row: Record<string, unknown>; index: number }
  | { op: 'delete'; id: string }
  | { op: 'reorder'; ids: string[] }

export type ScriptDefinitionMutationPlan =
  | { kind: 'none' }
  | { kind: 'replace' }
  | { kind: 'mutation'; mutation: ScriptDefinitionCollectionMutation }

type DefinitionRow = Record<string, unknown> & { id: string }

/**
 * Stable, constant-size certificate input for a complete definition array.
 * Command requests keep the final array client-only while the server returns
 * its digest, proving that a compact row mutation produced the same state.
 */
export function serializeScriptDefinitionCollectionDigestInput(rows: readonly unknown[]): string {
  return `script-definition-collection-v1:${JSON.stringify(sortJsonValue(rows))}`
}

/**
 * Reduce one definition-array replacement to the single strict mutation the
 * command API can apply safely. Ambiguous or compound edits deliberately keep
 * the full replacement fallback.
 */
export function classifyScriptDefinitionMutation(
  previousRows: readonly unknown[],
  finalRows: readonly unknown[],
): ScriptDefinitionMutationPlan {
  const previous = readUniqueRows(previousRows)
  const final = readUniqueRows(finalRows)
  if (!previous || !final) return { kind: 'replace' }

  const previousIds = previous.map((row) => row.id)
  const finalIds = final.map((row) => row.id)
  const previousById = new Map(previous.map((row) => [row.id, row]))
  const finalById = new Map(final.map((row) => [row.id, row]))
  const addedIds = finalIds.filter((id) => !previousById.has(id))
  const removedIds = previousIds.filter((id) => !finalById.has(id))

  if (addedIds.length === 0 && removedIds.length === 0) {
    const sameOrder = stringArraysEqual(previousIds, finalIds)
    const changedIds = finalIds.filter((id) => !definitionValuesEqual(previousById.get(id), finalById.get(id)))
    if (changedIds.length === 0) {
      return sameOrder ? { kind: 'none' } : { kind: 'mutation', mutation: { op: 'reorder', ids: [...finalIds] } }
    }
    if (!sameOrder || changedIds.length !== 1) return { kind: 'replace' }

    const id = changedIds[0]
    const mutation = buildUpdateMutation(previousById.get(id)!, finalById.get(id)!)
    return mutation ? { kind: 'mutation', mutation } : { kind: 'none' }
  }

  if (addedIds.length === 1 && removedIds.length === 0) {
    const commonFinalIds = finalIds.filter((id) => id !== addedIds[0])
    if (
      stringArraysEqual(previousIds, commonFinalIds) &&
      previousIds.every((id) => definitionValuesEqual(previousById.get(id), finalById.get(id)))
    ) {
      const index = finalIds.indexOf(addedIds[0])
      return {
        kind: 'mutation',
        mutation: { op: 'create', row: cloneDefinedRecord(finalById.get(addedIds[0])!), index },
      }
    }
  }

  if (removedIds.length === 1 && addedIds.length === 0) {
    const commonPreviousIds = previousIds.filter((id) => id !== removedIds[0])
    if (
      stringArraysEqual(commonPreviousIds, finalIds) &&
      finalIds.every((id) => definitionValuesEqual(previousById.get(id), finalById.get(id)))
    ) {
      return { kind: 'mutation', mutation: { op: 'delete', id: removedIds[0] } }
    }
  }

  return { kind: 'replace' }
}

function readUniqueRows(rows: readonly unknown[]): DefinitionRow[] | null {
  if (!Array.isArray(rows)) return null
  const ids = new Set<string>()
  const result: DefinitionRow[] = []
  for (const value of rows) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const row = value as Record<string, unknown>
    if (typeof row.id !== 'string' || row.id.trim() === '' || ids.has(row.id)) return null
    ids.add(row.id)
    result.push(row as DefinitionRow)
  }
  return result
}

function buildUpdateMutation(previous: DefinitionRow, final: DefinitionRow): ScriptDefinitionCollectionMutation | null {
  const patch: Record<string, unknown> = {}
  const deleteKeys: string[] = []
  const keys = new Set([...Object.keys(previous), ...Object.keys(final)])
  keys.delete('id')

  for (const key of keys) {
    const previousHasValue = Object.prototype.hasOwnProperty.call(previous, key) && previous[key] !== undefined
    const finalHasValue = Object.prototype.hasOwnProperty.call(final, key) && final[key] !== undefined
    if (!finalHasValue) {
      if (previousHasValue) deleteKeys.push(key)
      continue
    }
    if (!previousHasValue || !definitionValuesEqual(previous[key], final[key])) {
      patch[key] = cloneDefinedValue(final[key])
    }
  }

  if (Object.keys(patch).length === 0 && deleteKeys.length === 0) return null
  return { op: 'update', id: final.id, patch, deleteKeys }
}

function definitionValuesEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (typeof left !== typeof right || left === null || right === null) return false
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false
    return left.every((value, index) => definitionValuesEqual(value, right[index]))
  }
  if (typeof left !== 'object' || typeof right !== 'object') return false

  const leftRecord = left as Record<string, unknown>
  const rightRecord = right as Record<string, unknown>
  const leftKeys = Object.keys(leftRecord).filter((key) => leftRecord[key] !== undefined)
  const rightKeys = Object.keys(rightRecord).filter((key) => rightRecord[key] !== undefined)
  if (leftKeys.length !== rightKeys.length) return false
  return leftKeys.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(rightRecord, key) &&
      rightRecord[key] !== undefined &&
      definitionValuesEqual(leftRecord[key], rightRecord[key]),
  )
}

function cloneDefinedRecord(value: Record<string, unknown>): Record<string, unknown> {
  return cloneDefinedValue(value) as Record<string, unknown>
}

function cloneDefinedValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => (item === undefined ? null : cloneDefinedValue(item)))
  if (!value || typeof value !== 'object') return value
  const result: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (child !== undefined) result[key] = cloneDefinedValue(child)
  }
  return result
}

function stringArraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue)
  if (!value || typeof value !== 'object') return value

  const sorted = Object.create(null) as Record<string, unknown>
  for (const key of Object.keys(value).sort()) {
    sorted[key] = sortJsonValue((value as Record<string, unknown>)[key])
  }
  return sorted
}
