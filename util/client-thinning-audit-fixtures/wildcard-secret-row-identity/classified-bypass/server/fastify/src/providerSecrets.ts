// Invariant: wildcard object-array secrets restore by stable row identity, never
// by array index.

const WILDCARD = Symbol('secret-path-wildcard')

export const MASKED_PROVIDER_SECRET_ARRAY_ROW_REJECTED =
  'Masked provider secret placeholder cannot be resolved for an array row without stable identity'

type PathSegment = string | typeof WILDCARD

// Accepted: object-array secret paths have row identity keys; the flat
// string-array secret is separately classified.
const ARRAY_ROW_IDENTITY_KEYS: Record<string, string> = {
  botPresets: 'id',
  customModels: 'id',
}

const SECRET_PATHS: PathSegment[][] = [
  ['botPresets', WILDCARD, 'openAIKey'],
  ['customModels', WILDCARD, 'key'],
  ['OaiCompAPIKeys', WILDCARD],
]

function resolveArrayWildcard(target: unknown[], arrayKey?: string): void {
  if (target.length === 0) return
  const identityKey = arrayKey ? ARRAY_ROW_IDENTITY_KEYS[arrayKey] : undefined
  if (!identityKey) {
    throw new Error(MASKED_PROVIDER_SECRET_ARRAY_ROW_REJECTED)
  }
}

export { ARRAY_ROW_IDENTITY_KEYS, SECRET_PATHS, resolveArrayWildcard }
