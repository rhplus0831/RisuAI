import { describe, expect, it } from 'vitest'

import {
  MASKED_PROVIDER_SECRET,
  PROVIDER_SECRET_PATHS,
  PROVIDER_SECRET_PATH_WILDCARD,
  maskRegisteredProviderSecretsInPlace,
  type ProviderSecretPathSegment,
} from './providerSecretMask'

const ARRAY_WILDCARD_ROOTS = new Set([
  'authRefreshes',
  'botPresets',
  'characters',
  'customModels',
  'modelPresets',
  'modelProfiles',
])

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('expected record while building provider-secret fixture')
  }
  return value as Record<string, unknown>
}

function writeSecret(root: Record<string, unknown>, path: readonly ProviderSecretPathSegment[], value: string): void {
  let target: unknown = root

  path.forEach((segment, index) => {
    const final = index === path.length - 1
    if (segment === PROVIDER_SECRET_PATH_WILDCARD) {
      if (Array.isArray(target)) {
        if (final) {
          target[0] = value
          return
        }
        target[0] ??= {}
        target = target[0]
        return
      }

      const targetRecord = record(target)
      if (final) {
        targetRecord['wildcard-row'] = value
        return
      }
      targetRecord['wildcard-row'] ??= {}
      target = targetRecord['wildcard-row']
      return
    }

    const targetRecord = record(target)
    if (final) {
      targetRecord[segment] = value
      return
    }

    targetRecord[segment] ??=
      path[index + 1] === PROVIDER_SECRET_PATH_WILDCARD && ARRAY_WILDCARD_ROOTS.has(segment) ? [] : {}
    target = targetRecord[segment]
  })
}

function readSecret(root: Record<string, unknown>, path: readonly ProviderSecretPathSegment[]): unknown {
  let target: unknown = root
  for (const segment of path) {
    if (segment === PROVIDER_SECRET_PATH_WILDCARD) {
      target = Array.isArray(target) ? target[0] : record(target)['wildcard-row']
    } else {
      target = record(target)[segment]
    }
  }
  return target
}

describe('registered provider-secret masking', () => {
  it('masks every registered top-level, nested, array-row, and record-row secret', () => {
    const database: Record<string, unknown> = { safeSetting: 'included' }
    const rawSecrets = PROVIDER_SECRET_PATHS.map((path, index) => {
      const secret = `raw-provider-secret-${index}`
      writeSecret(database, path, secret)
      return secret
    })

    expect(maskRegisteredProviderSecretsInPlace(database)).toBe(database)

    PROVIDER_SECRET_PATHS.forEach((path) => {
      expect(readSecret(database, path)).toBe(MASKED_PROVIDER_SECRET)
    })
    expect(database.safeSetting).toBe('included')
    expect(JSON.stringify(database)).not.toContain('raw-provider-secret-')
    rawSecrets.forEach((secret) => expect(JSON.stringify(database)).not.toContain(secret))
  })

  it('preserves empty registered fields and unrelated values', () => {
    const database = {
      falToken: '',
      openaiCompatImage: { key: '', model: 'image-model' },
      safeSetting: 'included',
    }

    maskRegisteredProviderSecretsInPlace(database)

    expect(database).toEqual({
      falToken: '',
      openaiCompatImage: { key: '', model: 'image-model' },
      safeSetting: 'included',
    })
  })
})
