import {
  validateGenerationSettings as settings,
  validateFastifyDatabase as database,
  validateGenerationPreflightInputs as preflight,
  validateProviderGenerationSettings as provider,
  validateMemoryGenerationSettings as memory,
  generationInputValidatorMetadata,
  type GenerationInputValidator,
} from './generationInputValidators.js'
import type {
  FastifyDatabase,
  GenerationSettings,
  GenerationPreflightInputs,
  ProviderGenerationSettings,
  MemoryGenerationSettings,
} from './serverTypes.js'

/** A persisted known field has a shape the generation domain cannot consume. */
export class GenerationInputValidationError extends Error {
  constructor(domain: string, field: string) {
    super(`Invalid ${domain} generation input at ${field || '/'}`)
    this.name = 'GenerationInputValidationError'
  }
}

// Validation neither coerces, supplies defaults, strips imported extensions,
// nor copies the selected graph. Its checked implementation is generated at build time.

/** Compilation is absent at runtime; module import/parsing is measured separately. */
export function generationInputDecoderInitializationMetrics() {
  return { ...generationInputValidatorMetadata, runtimeCompilationMs: 0 }
}

function checked<T>(value: unknown, validate: GenerationInputValidator<T>, domain: string): T {
  if (!validate(value)) throw new GenerationInputValidationError(domain, validate.errors?.[0]?.instancePath ?? '')
  return value
}

/** A malformed stable Hypa selection already means no selection, never numeric fallback. */
function normalizeLegacyHypaSelection(value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value) && 'selectedHypaV3PresetId' in value) {
    const selected = value.selectedHypaV3PresetId
    if (selected !== undefined && selected !== null && typeof selected !== 'string') {
      return { ...value, selectedHypaV3PresetId: null }
    }
  }
  return value
}

export function decodeGenerationSettings(value: unknown): GenerationSettings {
  return checked(normalizeLegacyHypaSelection(value), settings, 'settings')
}
export function decodeGenerationDatabase(value: unknown): FastifyDatabase {
  return checked(normalizeLegacyHypaSelection(value), database, 'database')
}
export function decodeGenerationPreflightInputs(value: unknown): GenerationPreflightInputs {
  if (value && typeof value === 'object' && 'database' in value) {
    const normalized = normalizeLegacyHypaSelection(value.database)
    if (normalized !== value.database) return checked({ ...value, database: normalized }, preflight, 'preflight')
  }
  return checked(value, preflight, 'preflight')
}

export function decodeProviderGenerationSettings(value: unknown): ProviderGenerationSettings {
  return checked(normalizeLegacyHypaSelection(value), provider, 'provider')
}
export function decodeMemoryGenerationSettings(value: unknown): MemoryGenerationSettings {
  return checked(normalizeLegacyHypaSelection(value), memory, 'memory')
}
