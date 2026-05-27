const WILDCARD = Symbol('secret-path-wildcard')

export const MASKED_PROVIDER_SECRET = '__RISU_SECRET_MASKED__'

type PathSegment = string | typeof WILDCARD

const SECRET_PATHS: PathSegment[][] = [
  ['account', 'token'],
  ['authRefreshes', WILDCARD, 'clientSecret'],
  ['authRefreshes', WILDCARD, 'refreshToken'],
  ['botPresets', WILDCARD, 'openAIKey'],
  ['botPresets', WILDCARD, 'proxyKey'],
  ['characters', WILDCARD, 'oaiTTSConfig', 'apiKey'],
  ['claudeAPIKey'],
  ['cohereAPIKey'],
  ['customModels', WILDCARD, 'key'],
  ['deeplOptions', 'key'],
  ['deeplXOptions', 'token'],
  ['elevenLabKey'],
  ['falToken'],
  ['fishSpeechKey'],
  ['google', 'accessToken'],
  ['hordeConfig', 'apiKey'],
  ['huggingfaceKey'],
  ['hypaCustomSettings', 'key'],
  ['hypaMemoryKey'],
  ['hypaV3Key'],
  ['mancerHeader'],
  ['mistralKey'],
  ['nanogptKey'],
  ['NAIApiKey'],
  ['novelai', 'token'],
  ['novellistAPI'],
  ['OaiCompAPIKeys', WILDCARD],
  ['ollamaApiKey'],
  ['openAIKey'],
  ['openaiCompatImage', 'key'],
  ['openrouterKey'],
  ['proxyKey'],
  ['stabilityKey'],
  ['supaMemoryKey'],
  ['vertexAccessToken'],
  ['vertexPrivateKey'],
  ['voyageApiKey'],
  ['wavespeedImage', 'key'],
]

export function maskProviderSecrets<T>(database: T): T {
  if (!isRecord(database)) return database
  const masked = cloneJsonValue(database)
  for (const path of SECRET_PATHS) {
    maskPath(masked, path)
  }
  return masked
}

export function resolveMaskedProviderSecretPlaceholders(
  database: unknown,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const resolved = cloneJsonValue(patch)
  if (!isRecord(database)) return resolved

  for (const path of SECRET_PATHS) {
    resolvePath(database, resolved, path)
  }
  return resolved
}

function maskPath(target: unknown, path: PathSegment[]): void {
  if (path.length === 0) return
  const [segment, ...rest] = path

  if (segment === WILDCARD) {
    if (Array.isArray(target)) {
      for (let i = 0; i < target.length; i += 1) {
        if (rest.length === 0) {
          if (typeof target[i] === 'string' && target[i].length > 0) {
            target[i] = MASKED_PROVIDER_SECRET
          }
        } else {
          maskPath(target[i], rest)
        }
      }
      return
    }
    if (isRecord(target)) {
      for (const key of Object.keys(target)) {
        if (rest.length === 0) {
          if (typeof target[key] === 'string' && target[key].length > 0) {
            target[key] = MASKED_PROVIDER_SECRET
          }
        } else {
          maskPath(target[key], rest)
        }
      }
    }
    return
  }

  if (!isRecord(target) || !(segment in target)) return
  if (rest.length === 0) {
    if (typeof target[segment] === 'string' && target[segment].length > 0) {
      target[segment] = MASKED_PROVIDER_SECRET
    }
    return
  }
  maskPath(target[segment], rest)
}

function resolvePath(source: unknown, target: unknown, path: PathSegment[]): void {
  if (path.length === 0) return
  const [segment, ...rest] = path

  if (segment === WILDCARD) {
    if (Array.isArray(target)) {
      for (let i = 0; i < target.length; i += 1) {
        if (rest.length === 0) {
          if (target[i] === MASKED_PROVIDER_SECRET && Array.isArray(source)) {
            target[i] = cloneJsonValue(source[i])
          }
        } else {
          resolvePath(Array.isArray(source) ? source[i] : undefined, target[i], rest)
        }
      }
      return
    }
    if (isRecord(target)) {
      for (const key of Object.keys(target)) {
        if (rest.length === 0) {
          if (target[key] === MASKED_PROVIDER_SECRET && isRecord(source) && key in source) {
            target[key] = cloneJsonValue(source[key])
          }
        } else {
          resolvePath(isRecord(source) ? source[key] : undefined, target[key], rest)
        }
      }
    }
    return
  }

  if (!isRecord(target) || !(segment in target)) return
  if (rest.length === 0) {
    if (target[segment] === MASKED_PROVIDER_SECRET && isRecord(source) && segment in source) {
      target[segment] = cloneJsonValue(source[segment])
    }
    return
  }
  resolvePath(isRecord(source) ? source[segment] : undefined, target[segment], rest)
}

function cloneJsonValue<T>(value: T): T {
  if (value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
