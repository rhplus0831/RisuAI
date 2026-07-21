import { decode as decodeMsgpack, encode as encodeMsgpack } from 'msgpackr/index-no-eval'
import * as fflate from 'fflate'
import { decodeRPack, encodeRPack } from '../rpack/rpack_js.js'
import { createNonSecurityUuid } from '../nonSecurityUuid'

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
  translatorPresetId?: number
}

interface EncryptedTranslatorPresetFile {
  translatorPresetVersion: 1 | 2
  type: 'translator-preset'
  preset: Uint8Array | ArrayBuffer
}

export const defaultTranslatorPrompt =
  'You are a translator. translate the following html or text into {{slot}}. do not output anything other than the translation.'
export const translatorPresetFileExtension = 'risutl'
export const translatorPresetImportExtensions = [translatorPresetFileExtension]
const translatorPresetEncryptionKey = 'risutl'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function createUniqueId(seen: Set<string>): string {
  let id = createNonSecurityUuid()
  while (seen.has(id)) id = createNonSecurityUuid()
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

function isTranslatorPresetFileValue(value: unknown): value is Record<string, unknown> & {
  id?: string
  name: string
  prompt: string
  maxResponse: number
  steps?: unknown
} {
  return (
    isRecord(value) &&
    (value.id === undefined || typeof value.id === 'string') &&
    typeof value.name === 'string' &&
    typeof value.prompt === 'string' &&
    typeof value.maxResponse === 'number' &&
    Number.isFinite(value.maxResponse)
  )
}

function isTranslatorPresetValue(value: unknown): value is TranslatorPreset {
  return isTranslatorPresetFileValue(value) && Array.isArray(value.steps) && value.steps.length > 0
}

function getBytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) {
    return value
  }

  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value)
  }

  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  }

  return null
}

function isEncryptedTranslatorPresetFile(value: unknown): value is EncryptedTranslatorPresetFile {
  return (
    isRecord(value) &&
    (value.translatorPresetVersion === 1 || value.translatorPresetVersion === 2) &&
    value.type === 'translator-preset' &&
    getBytes(value.preset) !== null
  )
}

function getDefaultTranslatorPreset(state: TranslatorPresetStateLike): TranslatorPreset {
  return createTranslatorPreset('Default', {
    prompt: state.translatorPrompt ?? '',
    maxResponse: state.translatorMaxResponse ?? 1000,
  })
}

function getNormalizedTranslatorPresetName(name: unknown, index: number): string {
  if (typeof name === 'string' && name.trim().length > 0) {
    return name
  }

  return `Preset ${index + 1}`
}

function sanitizeFileNamePart(value: string): string {
  const sanitized = value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim()
  return sanitized.length > 0 ? sanitized : 'preset'
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
  const defaultPreset = getDefaultTranslatorPreset(state)
  const sourcePresets =
    Array.isArray(state.translatorPresets) && state.translatorPresets.length > 0
      ? state.translatorPresets
      : [defaultPreset]
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

  const requestedId =
    typeof state.translatorPresetId === 'number' && Number.isInteger(state.translatorPresetId)
      ? state.translatorPresetId
      : 0

  state.translatorPresetId = Math.min(Math.max(requestedId, 0), Math.max(state.translatorPresets.length - 1, 0))

  return syncCurrentTranslatorPresetToLegacyFields(state)
}

export function syncCurrentTranslatorPresetToLegacyFields<T extends TranslatorPresetStateLike>(state: T): T {
  const preset = state.translatorPresets?.[state.translatorPresetId ?? 0]

  if (!isTranslatorPresetValue(preset)) {
    return normalizeTranslatorPresetState(state)
  }

  const firstStep = preset.steps[0]
  preset.prompt = firstStep.prompt
  preset.maxResponse = firstStep.maxResponse
  state.translatorPrompt = firstStep.prompt
  state.translatorMaxResponse = firstStep.maxResponse

  return state
}

export function getCurrentTranslatorPresetFromState<T extends TranslatorPresetStateLike>(state: T): TranslatorPreset {
  const presetId =
    typeof state.translatorPresetId === 'number' && Number.isInteger(state.translatorPresetId)
      ? state.translatorPresetId
      : -1
  const preset = Array.isArray(state.translatorPresets) ? state.translatorPresets[presetId] : undefined

  if (!isTranslatorPresetValue(preset)) {
    const normalizedState = normalizeTranslatorPresetState(state)
    const normalizedPreset = normalizedState.translatorPresets?.[normalizedState.translatorPresetId ?? 0]
    return isTranslatorPresetValue(normalizedPreset) ? normalizedPreset : getDefaultTranslatorPreset(normalizedState)
  }

  const firstStep = preset.steps[0]
  preset.prompt = firstStep.prompt
  preset.maxResponse = firstStep.maxResponse
  state.translatorPrompt = firstStep.prompt
  state.translatorMaxResponse = firstStep.maxResponse

  return preset
}

function isTrivialSingleStepPreset(preset: TranslatorPreset): boolean {
  const step = preset.steps[0]
  return (
    preset.steps.length === 1 && step.enabled && step.model.mode === 'inheritTranslate' && step.outputKey === undefined
  )
}

async function decodeEncryptedTranslatorPresetFile(data: Uint8Array): Promise<TranslatorPreset> {
  let encodedPreset: Uint8Array
  try {
    encodedPreset = await decodeRPack(data)
  } catch {
    throw new Error('Invalid translator preset file.')
  }

  let decodedContainer: unknown

  try {
    decodedContainer = decodeMsgpack(fflate.decompressSync(encodedPreset))
  } catch {
    throw new Error('Invalid translator preset file.')
  }

  if (!isEncryptedTranslatorPresetFile(decodedContainer)) {
    throw new Error('Invalid translator preset file.')
  }

  const encryptedPreset = getBytes(decodedContainer.preset)

  if (!encryptedPreset) {
    throw new Error('Invalid translator preset file.')
  }

  let decryptedPreset: ArrayBuffer

  try {
    const { decryptBuffer } = await import('../util')
    decryptedPreset = await decryptBuffer(encryptedPreset, translatorPresetEncryptionKey)
  } catch {
    throw new Error('Invalid translator preset file.')
  }

  let parsedPreset: unknown
  try {
    parsedPreset = decodeMsgpack(new Uint8Array(decryptedPreset))
  } catch {
    throw new Error('Invalid translator preset file.')
  }

  if (!isTranslatorPresetFileValue(parsedPreset)) {
    throw new Error('Invalid translator preset file.')
  }
  if (decodedContainer.translatorPresetVersion === 2 && !Array.isArray(parsedPreset.steps)) {
    throw new Error('Invalid translator preset file.')
  }

  const source = decodedContainer.translatorPresetVersion === 1 ? { ...parsedPreset, steps: undefined } : parsedPreset
  const importedName = typeof parsedPreset.name === 'string' ? parsedPreset.name : ''
  return normalizeTranslatorPreset(source, importedName.trim() ? importedName : 'Imported Preset')
}

export async function encodeTranslatorPresetFile(preset: TranslatorPreset): Promise<Uint8Array> {
  const normalizedPreset = normalizeTranslatorPreset(preset, preset.name.trim() ? preset.name : 'Preset')
  const version = isTrivialSingleStepPreset(normalizedPreset) ? 1 : 2
  const encodedPreset =
    version === 1
      ? {
          ...(normalizedPreset.id ? { id: normalizedPreset.id } : {}),
          name: normalizedPreset.name,
          prompt: normalizedPreset.prompt,
          maxResponse: normalizedPreset.maxResponse,
        }
      : normalizedPreset
  const { encryptBuffer } = await import('../util')
  const encryptedPreset = new Uint8Array(
    await encryptBuffer(encodeMsgpack(encodedPreset), translatorPresetEncryptionKey),
  )
  const payload: EncryptedTranslatorPresetFile = {
    translatorPresetVersion: version,
    type: 'translator-preset',
    preset: encryptedPreset,
  }

  return await encodeRPack(fflate.compressSync(encodeMsgpack(payload)))
}

export async function decodeTranslatorPresetFile(data: Uint8Array): Promise<TranslatorPreset> {
  return await decodeEncryptedTranslatorPresetFile(data)
}

export function getTranslatorPresetDownloadName(name: string): string {
  return `translator_preset_${sanitizeFileNamePart(name)}.${translatorPresetFileExtension}`
}
