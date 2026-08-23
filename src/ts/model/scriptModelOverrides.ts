export interface ScriptModelOverrides {
  llmProfileId?: string
  axLlmProfileId?: string
}

export type ScriptModelRole = 'scriptMain' | 'scriptAux'

const SCRIPT_MODEL_OVERRIDE_KEYS = new Set(['llmProfileId', 'axLlmProfileId'])

export class ScriptModelOverridesValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ScriptModelOverridesValidationError'
  }
}

function nonBlankString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : undefined
}

export function normalizeScriptModelOverrides(value: unknown): ScriptModelOverrides {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const source = value as Record<string, unknown>
  const llmProfileId = nonBlankString(source.llmProfileId)
  const axLlmProfileId = nonBlankString(source.axLlmProfileId)
  return {
    ...(llmProfileId ? { llmProfileId } : {}),
    ...(axLlmProfileId ? { axLlmProfileId } : {}),
  }
}

export function readScriptModelOverrides(value: unknown, path = 'scriptModelOverrides'): ScriptModelOverrides {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ScriptModelOverridesValidationError(`${path} must be an object`)
  }
  const source = value as Record<string, unknown>
  for (const key of Object.keys(source)) {
    if (!SCRIPT_MODEL_OVERRIDE_KEYS.has(key)) {
      throw new ScriptModelOverridesValidationError(`${path}.${key} is not supported`)
    }
  }
  for (const key of SCRIPT_MODEL_OVERRIDE_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue
    if (typeof source[key] !== 'string' || source[key].trim().length === 0) {
      throw new ScriptModelOverridesValidationError(`${path}.${key} must be a non-empty string`)
    }
  }
  return normalizeScriptModelOverrides(source)
}

export function scriptModelOverrideProfileId(
  value: ScriptModelOverrides | null | undefined,
  role: ScriptModelRole,
): string | undefined {
  const normalized = normalizeScriptModelOverrides(value)
  return role === 'scriptAux' ? normalized.axLlmProfileId : normalized.llmProfileId
}

export function updateScriptModelOverrideProfileId(
  value: ScriptModelOverrides | null | undefined,
  role: ScriptModelRole,
  profileId: string,
): ScriptModelOverrides {
  const normalized = normalizeScriptModelOverrides(value)
  const nextProfileId = nonBlankString(profileId)
  const key = role === 'scriptAux' ? 'axLlmProfileId' : 'llmProfileId'
  if (nextProfileId) {
    normalized[key] = nextProfileId
  } else {
    delete normalized[key]
  }
  return normalized
}
