// Minimal fixture for the A4R6 wildcard secret row identity rule. The real
// declarations live in server/fastify/src/providerSecrets.ts. Masked provider
// secrets are restored against the durable source; wildcard object-array paths
// must restore by a stable row identity key, never by array index.

const WILDCARD = Symbol('secret-path-wildcard')

export const MASKED_PROVIDER_SECRET_ARRAY_ROW_REJECTED =
  'Masked provider secret placeholder cannot be resolved for an array row without stable identity'

type PathSegment = string | typeof WILDCARD

// Accepted: every wildcard object-array secret path has a stable row identity
// key, and the flat string-array secret (`OaiCompAPIKeys`) is classified in the
// audit's FLAT_ARRAY_SECRETS_CLASSIFIED allowlist.
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
