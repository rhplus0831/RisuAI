export const MASKED_PROVIDER_SECRET = '__RISU_SECRET_MASKED__'

export const PROVIDER_SECRET_PATH_WILDCARD = Symbol('provider-secret-path-wildcard')

export type ProviderSecretPathSegment = string | typeof PROVIDER_SECRET_PATH_WILDCARD

/**
 * Every persisted provider credential path. This registry is shared by server
 * resource masking and client-side exports so an optimistic, not-yet-masked
 * setting can never bypass diagnostic redaction.
 */
export const PROVIDER_SECRET_PATHS: readonly (readonly ProviderSecretPathSegment[])[] = [
  ['account', 'token'],
  ['authRefreshes', PROVIDER_SECRET_PATH_WILDCARD, 'clientSecret'],
  ['authRefreshes', PROVIDER_SECRET_PATH_WILDCARD, 'refreshToken'],
  ['botPresets', PROVIDER_SECRET_PATH_WILDCARD, 'openAIKey'],
  ['botPresets', PROVIDER_SECRET_PATH_WILDCARD, 'proxyKey'],
  [
    'botPresets',
    PROVIDER_SECRET_PATH_WILDCARD,
    'modelProfiles',
    PROVIDER_SECRET_PATH_WILDCARD,
    'providerOptions',
    'apiKey',
  ],
  [
    'botPresets',
    PROVIDER_SECRET_PATH_WILDCARD,
    'modelProfiles',
    PROVIDER_SECRET_PATH_WILDCARD,
    'providerOptions',
    'vertex',
    'privateKey',
  ],
  [
    'botPresets',
    PROVIDER_SECRET_PATH_WILDCARD,
    'modelProfiles',
    PROVIDER_SECRET_PATH_WILDCARD,
    'providerOptions',
    'vertex',
    'clientEmail',
  ],
  ['characters', PROVIDER_SECRET_PATH_WILDCARD, 'oaiTTSConfig', 'apiKey'],
  ['claudeAPIKey'],
  ['cohereAPIKey'],
  ['customModels', PROVIDER_SECRET_PATH_WILDCARD, 'key'],
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
  ['modelPresets', PROVIDER_SECRET_PATH_WILDCARD, 'openAIKey'],
  ['modelPresets', PROVIDER_SECRET_PATH_WILDCARD, 'proxyKey'],
  [
    'modelPresets',
    PROVIDER_SECRET_PATH_WILDCARD,
    'modelProfiles',
    PROVIDER_SECRET_PATH_WILDCARD,
    'providerOptions',
    'apiKey',
  ],
  [
    'modelPresets',
    PROVIDER_SECRET_PATH_WILDCARD,
    'modelProfiles',
    PROVIDER_SECRET_PATH_WILDCARD,
    'providerOptions',
    'vertex',
    'privateKey',
  ],
  [
    'modelPresets',
    PROVIDER_SECRET_PATH_WILDCARD,
    'modelProfiles',
    PROVIDER_SECRET_PATH_WILDCARD,
    'providerOptions',
    'vertex',
    'clientEmail',
  ],
  ['providerCredentials', PROVIDER_SECRET_PATH_WILDCARD, 'apiKey'],
  ['providerCredentials', PROVIDER_SECRET_PATH_WILDCARD, 'vertex', 'privateKey'],
  ['nanogptKey'],
  ['NAIApiKey'],
  ['novelai', 'token'],
  ['novellistAPI'],
  ['OaiCompAPIKeys', PROVIDER_SECRET_PATH_WILDCARD],
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

export function isMaskedProviderSecret(value: unknown): value is typeof MASKED_PROVIDER_SECRET {
  return value === MASKED_PROVIDER_SECRET
}

/** Mutates an owned projection by replacing every registered non-empty secret. */
export function maskRegisteredProviderSecretsInPlace<T>(value: T): T {
  if (!isRecord(value)) return value
  for (const path of PROVIDER_SECRET_PATHS) {
    maskPath(value, path)
  }
  return value
}

function maskPath(target: unknown, path: readonly ProviderSecretPathSegment[]): void {
  if (path.length === 0) return
  const [segment, ...rest] = path

  if (segment === PROVIDER_SECRET_PATH_WILDCARD) {
    if (Array.isArray(target)) {
      for (let index = 0; index < target.length; index += 1) {
        if (rest.length === 0) {
          if (typeof target[index] === 'string' && target[index].length > 0) {
            target[index] = MASKED_PROVIDER_SECRET
          }
        } else {
          maskPath(target[index], rest)
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
