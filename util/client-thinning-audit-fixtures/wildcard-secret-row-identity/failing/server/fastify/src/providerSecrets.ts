// Minimal fixture for the A4R6 wildcard secret row identity rule. The real
// declarations live in server/fastify/src/providerSecrets.ts. Masked provider
// secrets are restored against the durable source; wildcard object-array paths
// must restore by a stable row identity key, never by array index.

const WILDCARD = Symbol('secret-path-wildcard')

export const MASKED_PROVIDER_SECRET_ARRAY_ROW_REJECTED =
  'Masked provider secret placeholder cannot be resolved for an array row without stable identity'

type PathSegment = string | typeof WILDCARD

// Anti-pattern: `customModels` is a wildcard object-array secret path (length 3)
// but has no row identity key here, so masked rows would be restored by index.
const ARRAY_ROW_IDENTITY_KEYS: Record<string, string> = {
  botPresets: 'id',
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
