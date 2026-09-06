import { decode as decodeMsgpack, encode as encodeMsgpack } from 'msgpackr/index-no-eval'
import * as fflate from 'fflate'
import { decodeRPack, encodeRPack } from '../rpack/rpack_js.js'
import {
  defaultTranslatorPrompt,
  getCanonicalTranslatorPresets,
  normalizeTranslatorPreset,
  type TranslatorPreset,
} from '@risuai/shared-core/translator-presets'

export {
  createTranslatorPreset,
  defaultTranslatorPrompt,
  getCanonicalTranslatorPresets,
  getCurrentTranslatorPresetFromState,
  getTranslatorPresetFromState,
  isValidTranslatorPresetOutputKey,
  normalizeTranslatorPreset,
  normalizeTranslatorPresetState,
  normalizeTranslatorPresetStateWithLegacyCompatibility,
  syncCurrentTranslatorPresetToLegacyFields,
  TRANSLATOR_PRESET_MAX_STEPS,
  TRANSLATOR_PRESET_OUTPUT_KEY_PATTERN,
} from '@risuai/shared-core/translator-presets'
export type {
  TranslatorPreset,
  TranslatorPresetStateLike,
  TranslatorPresetStep,
  TranslatorPresetStepModel,
} from '@risuai/shared-core/translator-presets'

interface EncryptedTranslatorPresetFile {
  translatorPresetVersion: 1 | 2
  type: 'translator-preset'
  preset: Uint8Array | ArrayBuffer
}

export const translatorPresetFileExtension = 'risutl'
export const translatorPresetImportExtensions = [translatorPresetFileExtension]
const translatorPresetEncryptionKey = 'risutl'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getBytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
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

function isTranslatorPresetFileValue(value: unknown): value is TranslatorPreset {
  return (
    isRecord(value) &&
    (value.id === undefined || typeof value.id === 'string') &&
    typeof value.name === 'string' &&
    typeof value.prompt === 'string' &&
    typeof value.maxResponse === 'number' &&
    Number.isFinite(value.maxResponse)
  )
}

function isTrivialSingleStepPreset(preset: TranslatorPreset): boolean {
  const step = preset.steps[0]
  return (
    preset.steps.length === 1 && step.enabled && step.model.mode === 'inheritTranslate' && step.outputKey === undefined
  )
}

function sanitizeFileNamePart(value: string): string {
  const sanitized = value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim()
  return sanitized.length > 0 ? sanitized : 'preset'
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
  if (!encryptedPreset) throw new Error('Invalid translator preset file.')

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

  if (!isTranslatorPresetFileValue(parsedPreset)) throw new Error('Invalid translator preset file.')
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
