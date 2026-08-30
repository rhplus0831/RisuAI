export const TRANSLATOR_PRESET_MAX_STEPS = 5
export const TRANSLATOR_PRESET_OUTPUT_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/

export type TranslatorPresetStepModel = { mode: 'inheritTranslate' } | { mode: 'modelProfile'; profileId: string }

export interface TranslatorPresetStep {
  id: string
  name: string
  enabled: boolean
  prompt: string
  maxResponse: number
  model: TranslatorPresetStepModel
  outputKey?: string
}

export interface TranslatorPreset {
  id?: string
  name: string
  prompt: string
  maxResponse: number
  steps: TranslatorPresetStep[]
}

export interface TranslatorPresetStateLike {
  translatorPrompt?: string
  translatorMaxResponse?: number
  translatorPresets?: unknown[]
  /** Stable canonical preset owner. Numbers are accepted only by migration helpers. */
  translatorPresetId?: string | number | null
}

export const defaultTranslatorPrompt =
  'You are a translator. translate the following html or text into {{slot}}. do not output anything other than the translation.'

let fallbackCounter: number | undefined

function formatUuid(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function markAsUuidV4(bytes: Uint8Array): Uint8Array {
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  return bytes
}

function createFallbackUuid(): string {
  const bytes = new Uint8Array(16)
  let timestamp = Math.max(0, Math.floor(Date.now()))
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = timestamp % 256
    timestamp = Math.floor(timestamp / 256)
  }

  fallbackCounter = ((fallbackCounter ?? Math.floor(Math.random() * 0x1_0000_0000)) + 1) >>> 0
  bytes[9] = fallbackCounter >>> 24
  bytes[10] = fallbackCounter >>> 16
  bytes[11] = fallbackCounter >>> 8
  bytes[12] = fallbackCounter

  for (const index of [6, 7, 8, 13, 14, 15]) {
    bytes[index] = Math.floor(Math.random() * 256)
  }

  return formatUuid(markAsUuidV4(bytes))
}

function createTranslatorPresetId(): string {
  const cryptoApi = globalThis.crypto
  if (typeof cryptoApi?.randomUUID === 'function') {
    try {
      return cryptoApi.randomUUID()
    } catch {
      // Some supported LAN WebViews expose incomplete WebCrypto methods.
    }
  }

  if (typeof cryptoApi?.getRandomValues === 'function') {
    try {
      const bytes = new Uint8Array(16)
      cryptoApi.getRandomValues(bytes)
      return formatUuid(markAsUuidV4(bytes))
    } catch {
      // Fall through to a non-cryptographic entity ID.
    }
  }

  return createFallbackUuid()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function createUniqueId(seen: Set<string>): string {
  let id = createTranslatorPresetId()
  while (seen.has(id)) id = createTranslatorPresetId()
  return id
}

function normalizeStepModel(value: unknown): TranslatorPresetStepModel {
  if (!isRecord(value)) return { mode: 'inheritTranslate' }
  if (value.mode === 'inheritTranslate') return { mode: 'inheritTranslate' }
  if (value.mode === 'modelProfile' && typeof value.profileId === 'string' && value.profileId.trim()) {
    return { mode: 'modelProfile', profileId: value.profileId.trim() }
  }
  return { mode: 'inheritTranslate' }
}

function legacyStep(preset: Record<string, unknown>): Record<string, unknown> {
  return {
    name: 'Step 1',
    enabled: true,
    prompt: typeof preset.prompt === 'string' ? preset.prompt : '',
    maxResponse: finiteNumber(preset.maxResponse, 1000),
    model: { mode: 'inheritTranslate' },
  }
}

function normalizeTranslatorPresetSteps(preset: Record<string, unknown>): TranslatorPresetStep[] {
  const sourceSteps = Array.isArray(preset.steps) && preset.steps.length > 0 ? preset.steps : [legacyStep(preset)]
  const seenIds = new Set<string>()
  const seenOutputKeys = new Set<string>()

  return sourceSteps.slice(0, TRANSLATOR_PRESET_MAX_STEPS).map((value, index) => {
    const source = isRecord(value) ? value : {}
    const requestedId = typeof source.id === 'string' ? source.id.trim() : ''
    const id = requestedId && !seenIds.has(requestedId) ? requestedId : createUniqueId(seenIds)
    seenIds.add(id)

    const step: TranslatorPresetStep = {
      id,
      name: typeof source.name === 'string' && source.name.trim() ? source.name : `Step ${index + 1}`,
      enabled: typeof source.enabled === 'boolean' ? source.enabled : true,
      prompt: typeof source.prompt === 'string' ? source.prompt : '',
      maxResponse: finiteNumber(source.maxResponse, 1000),
      model: normalizeStepModel(source.model),
    }
    const outputKey = typeof source.outputKey === 'string' ? source.outputKey.trim() : ''
    if (isValidTranslatorPresetOutputKey(outputKey) && !seenOutputKeys.has(outputKey)) {
      step.outputKey = outputKey
      seenOutputKeys.add(outputKey)
    }
    return step
  })
}

function getDefaultTranslatorPreset(): TranslatorPreset {
  return createTranslatorPreset('Default', {
    prompt: defaultTranslatorPrompt,
    maxResponse: 1000,
  })
}

function getNormalizedTranslatorPresetName(name: unknown, index: number): string {
  if (typeof name === 'string' && name.trim().length > 0) return name
  return `Preset ${index + 1}`
}

export function isValidTranslatorPresetOutputKey(value: string): boolean {
  return TRANSLATOR_PRESET_OUTPUT_KEY_PATTERN.test(value)
}

export function normalizeTranslatorPreset(value: unknown, fallbackName = 'New Preset'): TranslatorPreset {
  const source = isRecord(value) ? value : {}
  const steps = normalizeTranslatorPresetSteps(source)
  const firstStep = steps[0]
  const preset: TranslatorPreset = {
    name: typeof source.name === 'string' && source.name.trim() ? source.name : fallbackName,
    prompt: firstStep.prompt,
    maxResponse: firstStep.maxResponse,
    steps,
  }
  if (typeof source.id === 'string' && source.id.trim()) preset.id = source.id.trim()
  return preset
}

export function createTranslatorPreset(
  name = 'New Preset',
  existing: Partial<TranslatorPreset> = {},
): TranslatorPreset {
  return normalizeTranslatorPreset({ ...existing, name }, name)
}

export function normalizeTranslatorPresetState<T extends TranslatorPresetStateLike>(state: T): T {
  const sourcePresets =
    Array.isArray(state.translatorPresets) && state.translatorPresets.length > 0
      ? state.translatorPresets
      : [getDefaultTranslatorPreset()]
  const seen = new Set<string>()

  state.translatorPresets = sourcePresets.map((preset, index) => {
    const normalizedPreset = isRecord(preset) ? preset : {}
    const normalized = normalizeTranslatorPreset(
      { ...normalizedPreset, name: getNormalizedTranslatorPresetName(normalizedPreset.name, index) },
      `Preset ${index + 1}`,
    )
    const requestedId = typeof normalized.id === 'string' ? normalized.id.trim() : ''
    normalized.id = requestedId && !seen.has(requestedId) ? requestedId : createUniqueId(seen)
    seen.add(normalized.id)
    return normalized
  })

  const requestedIndex =
    typeof state.translatorPresetId === 'number' && Number.isInteger(state.translatorPresetId)
      ? state.translatorPresetId
      : -1
  const normalizedPresets = state.translatorPresets as TranslatorPreset[]
  if (requestedIndex >= 0 && requestedIndex < normalizedPresets.length) {
    state.translatorPresetId = normalizedPresets[requestedIndex].id ?? normalizedPresets[0].id
  } else if (
    typeof state.translatorPresetId !== 'string' ||
    !state.translatorPresetId.trim() ||
    !normalizedPresets.some((preset) => preset.id === state.translatorPresetId)
  ) {
    state.translatorPresetId = normalizedPresets[0].id
  }

  return state
}

/**
 * Import/migration-only compatibility for databases that have not acquired a
 * canonical translator preset collection yet. Ordinary runtime reads and
 * preset commands must use getTranslatorPresetFromState/getCanonicalTranslatorPresets.
 */
export function normalizeTranslatorPresetStateWithLegacyCompatibility<T extends TranslatorPresetStateLike>(
  state: T,
): T {
  const missingCanonicalCollection = !Array.isArray(state.translatorPresets) || state.translatorPresets.length === 0
  if (missingCanonicalCollection) {
    state.translatorPresets = [
      createTranslatorPreset('Default', {
        prompt: state.translatorPrompt ?? '',
        maxResponse: state.translatorMaxResponse ?? 1000,
      }),
    ]
  }
  normalizeTranslatorPresetState(state)
  return missingCanonicalCollection ? syncCurrentTranslatorPresetToLegacyFields(state) : state
}

/** Explicit export/migration compatibility projection for legacy scalar fields. */
export function syncCurrentTranslatorPresetToLegacyFields<T extends TranslatorPresetStateLike>(state: T): T {
  const preset = resolveTranslatorPresetForMigration(state)

  if (!isTranslatorPresetValue(preset)) return normalizeTranslatorPresetState(state)

  const firstStep = preset.steps[0]
  preset.prompt = firstStep.prompt
  preset.maxResponse = firstStep.maxResponse
  state.translatorPrompt = firstStep.prompt
  state.translatorMaxResponse = firstStep.maxResponse

  return state
}

export function getCurrentTranslatorPresetFromState<T extends TranslatorPresetStateLike>(
  state: T,
): TranslatorPreset | null {
  return getTranslatorPresetFromState(state)
}

export function getTranslatorPresetFromState<T extends TranslatorPresetStateLike>(
  state: T,
  boundPresetId?: string | null,
): TranslatorPreset | null {
  const presets = getCanonicalTranslatorPresets(state)
  if (!presets) return null

  if (typeof boundPresetId === 'string' && boundPresetId.trim()) {
    const preset = presets.find((candidate) => candidate.id === boundPresetId)
    if (preset) return preset
  }

  if (typeof state.translatorPresetId !== 'string' || !state.translatorPresetId.trim()) return null
  return presets.find((candidate) => candidate.id === state.translatorPresetId) ?? null
}

/** Strict ordinary-runtime validation. Malformed ownership is unavailable, never repaired implicitly. */
export function getCanonicalTranslatorPresets(state: TranslatorPresetStateLike): TranslatorPreset[] | null {
  if (!Array.isArray(state.translatorPresets) || state.translatorPresets.length === 0) return null
  const seen = new Set<string>()
  const presets: TranslatorPreset[] = []
  for (const value of state.translatorPresets) {
    if (!isTranslatorPresetValue(value) || typeof value.id !== 'string' || !value.id.trim() || seen.has(value.id)) {
      return null
    }
    seen.add(value.id)
    presets.push(value)
  }
  return presets
}

function resolveTranslatorPresetForMigration(state: TranslatorPresetStateLike): TranslatorPreset | null {
  if (!Array.isArray(state.translatorPresets)) return null
  if (typeof state.translatorPresetId === 'string' && state.translatorPresetId.trim()) {
    for (const value of state.translatorPresets) {
      if (isTranslatorPresetValue(value) && value.id === state.translatorPresetId) return value
    }
    return null
  }
  if (typeof state.translatorPresetId === 'number' && Number.isInteger(state.translatorPresetId)) {
    const value = state.translatorPresets[state.translatorPresetId]
    return isTranslatorPresetValue(value) ? value : null
  }
  const value = state.translatorPresets[0]
  return isTranslatorPresetValue(value) ? value : null
}

function isTranslatorPresetFileValue(value: unknown): value is TranslatorPreset {
  return (
    isRecord(value) &&
    (value.id === undefined || typeof value.id === 'string') &&
    typeof value.name === 'string' &&
    typeof value.prompt === 'string' &&
    typeof value.maxResponse === 'number' &&
    Number.isFinite(value.maxResponse) &&
    Array.isArray(value.steps) &&
    value.steps.length > 0
  )
}

function isTranslatorPresetValue(value: unknown): value is TranslatorPreset {
  return isTranslatorPresetFileValue(value)
}
