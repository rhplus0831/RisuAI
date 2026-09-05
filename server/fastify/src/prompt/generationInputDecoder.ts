import Ajv, { type ValidateFunction } from 'ajv'
import schema from './generationInputSchema.json' with { type: 'json' }
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

// Compile once. Validation neither coerces, supplies defaults, strips imported
// extensions, nor copies a selected transcript/configuration graph.
const initializationStartedAt = performance.now()
const ajv = new Ajv({ allErrors: false, strict: false, strictNumbers: true, inlineRefs: false })
const schemaId = 'risu-generation-inputs-v1'
ajv.addSchema({ $id: schemaId, $defs: schema.$defs })
function compiled<T>(root: { $ref: string }): ValidateFunction<T> {
  return ajv.compile<T>({ $ref: `${schemaId}${root.$ref}` })
}
const settings = compiled<GenerationSettings>(schema.GenerationSettings)
const database = compiled<FastifyDatabase>(schema.FastifyDatabase)
const preflight = compiled<GenerationPreflightInputs>(schema.GenerationPreflightInputs)
const provider = compiled<ProviderGenerationSettings>(schema.ProviderGenerationSettings)
const memory = compiled<MemoryGenerationSettings>(schema.MemoryGenerationSettings)

const initializationDurationMs = performance.now() - initializationStartedAt

/** Diagnostic-only, once-per-process validator initialization; no request data. */
export function generationInputDecoderInitializationMetrics() {
  return { durationMs: initializationDurationMs, schemaDefinitions: Object.keys(schema.$defs).length, roots: 5 }
}

function checked<T>(value: unknown, validate: ValidateFunction<T>, domain: string): T {
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
