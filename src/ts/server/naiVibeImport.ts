import { createLatestOperationGuard, type LatestOperationToken } from './staleStateGuards'

const NAI_VIBE_IMPORT_TARGET = 'naiVibeImport' as const

export type NaiVibeModelSelection = 'v4full' | 'v4curated' | 'v4-5full' | 'v4-5curated'

export interface NaiVibeEncoding {
  readonly encoding?: unknown
  readonly params?: {
    readonly information_extracted?: unknown
  }
}

export interface NaiVibeData {
  readonly identifier: 'novelai-vibe-transfer'
  readonly version: 1
  readonly encodings: Record<string, Record<string, NaiVibeEncoding>>
  readonly thumbnail?: unknown
  readonly [key: string]: unknown
}

export type NaiVibeImportConfig = Record<string, unknown>

export interface NaiVibeImportFreshness {
  readonly provider: unknown
  readonly model: unknown
  readonly reference_mode: unknown
  readonly config: NaiVibeImportConfig | null | undefined
}

export interface NaiVibeImportTarget {
  readonly contextSnapshot: string
  readonly vibeFieldsSnapshot: string
  readonly model: string | null
}

export interface NaiVibeImportOperation extends NaiVibeImportTarget {
  readonly token: LatestOperationToken<typeof NAI_VIBE_IMPORT_TARGET>
}

export interface NaiVibeImportPatch {
  vibe_data: NaiVibeData
  reference_image_multiple?: string[]
  vibe_model_selection?: NaiVibeModelSelection
  InfoExtracted?: number
  reference_strength_multiple?: number[]
}

const naiVibeImportGuard = createLatestOperationGuard<typeof NAI_VIBE_IMPORT_TARGET>()

function snapshotJson(value: unknown): string {
  const snapshot = JSON.stringify(value)
  return snapshot === undefined ? '__undefined__' : snapshot
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function normalizeConfig(config: NaiVibeImportConfig | null | undefined): NaiVibeImportConfig {
  return config ? { ...config } : {}
}

function contextSnapshot(freshness: NaiVibeImportFreshness): string {
  return snapshotJson({
    provider: freshness.provider,
    model: freshness.model,
    reference_mode: freshness.reference_mode,
  })
}

function vibeFieldSnapshot(config: NaiVibeImportConfig | null | undefined): string {
  const source = normalizeConfig(config)
  return snapshotJson({
    vibe_data: source.vibe_data,
    reference_image_multiple: source.reference_image_multiple,
    vibe_model_selection: source.vibe_model_selection,
    InfoExtracted: source.InfoExtracted,
    reference_strength_multiple: source.reference_strength_multiple,
  })
}

function defaultVibeModelSelection(model: string | null): NaiVibeModelSelection | undefined {
  if (!model) return undefined
  if (model.includes('nai-diffusion-4-full')) return 'v4full'
  if (model.includes('nai-diffusion-4-curated')) return 'v4curated'
  if (model.includes('nai-diffusion-4-5-full')) return 'v4-5full'
  if (model.includes('nai-diffusion-4-5-curated')) return 'v4-5curated'
  return undefined
}

function firstInformationExtracted(vibeData: NaiVibeData, modelSelection: NaiVibeModelSelection): number | undefined {
  const encodings = vibeData.encodings[modelSelection]
  if (!isRecord(encodings)) return undefined

  const firstKey = Object.keys(encodings)[0]
  if (!firstKey) return undefined

  const encoding = encodings[firstKey]
  if (!isRecord(encoding) || !isRecord(encoding.params)) return undefined

  const value = Number(encoding.params.information_extracted)
  return Number.isFinite(value) ? value : undefined
}

export function parseNaiVibeImport(source: string): NaiVibeData | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch {
    return null
  }

  if (!isRecord(parsed)) return null
  if (parsed.version !== 1) return null
  if (parsed.identifier !== 'novelai-vibe-transfer') return null
  if (!isRecord(parsed.encodings)) return null

  return parsed as unknown as NaiVibeData
}

export function captureNaiVibeImportTarget(freshness: NaiVibeImportFreshness): NaiVibeImportTarget {
  return {
    contextSnapshot: contextSnapshot(freshness),
    vibeFieldsSnapshot: vibeFieldSnapshot(freshness.config),
    model: typeof freshness.model === 'string' ? freshness.model : null,
  }
}

export function beginNaiVibeImport(target: NaiVibeImportTarget): NaiVibeImportOperation {
  return {
    ...target,
    token: naiVibeImportGuard.issue(NAI_VIBE_IMPORT_TARGET),
  }
}

export function clearNaiVibeImport(operation: NaiVibeImportOperation): void {
  naiVibeImportGuard.clear(operation.token)
}

export function isFreshNaiVibeImport(operation: NaiVibeImportOperation, freshness: NaiVibeImportFreshness): boolean {
  if (!naiVibeImportGuard.isLatest(operation.token)) return false
  if (contextSnapshot(freshness) !== operation.contextSnapshot) return false
  return vibeFieldSnapshot(freshness.config) === operation.vibeFieldsSnapshot
}

export function resolveFreshNaiVibeImportPatch(input: {
  operation: NaiVibeImportOperation
  freshness: NaiVibeImportFreshness
  vibeData: NaiVibeData
}): NaiVibeImportPatch | null {
  if (!isFreshNaiVibeImport(input.operation, input.freshness)) return null

  const config = normalizeConfig(input.freshness.config)
  const patch: NaiVibeImportPatch = {
    vibe_data: input.vibeData,
  }

  if (input.vibeData.thumbnail) {
    patch.reference_image_multiple = []

    const modelSelection = defaultVibeModelSelection(input.operation.model)
    if (modelSelection) {
      patch.vibe_model_selection = modelSelection

      const informationExtracted = firstInformationExtracted(input.vibeData, modelSelection)
      if (informationExtracted !== undefined) {
        patch.InfoExtracted = informationExtracted
      }
    }
  }

  if (!Array.isArray(config.reference_strength_multiple)) {
    patch.reference_strength_multiple = [0.7]
  }

  return patch
}
