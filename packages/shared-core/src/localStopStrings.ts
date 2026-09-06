/** The optional override preserves the difference between unset, disabled and an empty list. */
export function isLocalStopStrings(value: unknown): value is string[] | null | undefined {
  return (
    value === undefined || value === null || (Array.isArray(value) && value.every((entry) => typeof entry === 'string'))
  )
}

/**
 * Some converted presets retained MessagePack's undefined extension (type 0,
 * one zero byte) as JSON. Repair only the two observed encodings, and only
 * this known field. Deleting it restores inheritance; assigning null would
 * introduce an explicit override instead.
 */
export function repairLegacyLocalStopStrings(owner: unknown): boolean {
  if (!isRecord(owner) || !Object.hasOwn(owner, 'localStopStrings')) return false
  const value = owner.localStopStrings
  if (!isRecord(value) || Object.keys(value).length !== 2) return false
  const legacyExtension = value.ext === 0 && isZeroByte(value.data)
  const bufferExtension =
    value.type === 0 &&
    isRecord(value.data) &&
    Object.keys(value.data).length === 2 &&
    value.data.type === 'Buffer' &&
    isZeroByte(value.data.data)
  if (!legacyExtension && !bufferExtension) return false
  delete owner.localStopStrings
  return true
}

function isZeroByte(value: unknown): boolean {
  return Array.isArray(value) && value.length === 1 && value[0] === 0 && Object.keys(value).length === 1
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
