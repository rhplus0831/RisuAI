import {
  effectiveMemoryEmbeddingLimits,
  findMemoryEmbeddingContextualGroupLimitViolation,
  findMemoryEmbeddingLimitViolation,
  formatMemoryEmbeddingLimitViolation,
  type MemoryEmbeddingModelRequest,
} from './memoryEmbeddingModel.js'

export type EmbeddingProviderErrorCode =
  | 'configuration'
  | 'aborted'
  | 'fetch'
  | 'upstream'
  | 'invalid-json'
  | 'invalid-response'
  | 'dimension-mismatch'

export interface MemoryEmbeddingProviderError {
  error: string
  code: EmbeddingProviderErrorCode
}

export interface MemoryEmbeddingAdapterResult {
  model: string
  vectors: Float32Array[]
  dim: number
}

export interface EmbedTextsOptions {
  request: MemoryEmbeddingModelRequest
  input: readonly string[]
  expectedDim?: number
  signal: AbortSignal
}

export interface EmbedTextGroupsOptions {
  request: MemoryEmbeddingModelRequest
  groups: readonly (readonly string[])[]
  expectedDim?: number
  signal: AbortSignal
}

interface EmbeddingResponse {
  data?: unknown
  error?: { message?: unknown }
}

interface EmbeddingResponseItem {
  embedding?: unknown
  index?: unknown
}

export async function embedTexts(
  opts: EmbedTextsOptions,
): Promise<MemoryEmbeddingAdapterResult | MemoryEmbeddingProviderError> {
  const input = [...opts.input]
  if (input.length === 0) {
    return { error: 'embedding input must not be empty', code: 'configuration' }
  }
  if (input.some((value) => typeof value !== 'string')) {
    return { error: 'embedding input must contain only strings', code: 'configuration' }
  }
  const sizeViolation = findMemoryEmbeddingLimitViolation(opts.request, input, (index) => `embedding input ${index}`)
  if (sizeViolation) {
    return {
      error: formatMemoryEmbeddingLimitViolation(sizeViolation),
      code: 'configuration',
    }
  }
  if (opts.signal.aborted) return { error: 'aborted', code: 'aborted' }

  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (opts.request.apiKey) headers.authorization = `Bearer ${opts.request.apiKey}`

  const body: Record<string, unknown> = { input }
  if (opts.request.wireModel) body.model = opts.request.wireModel

  let response: Response
  try {
    response = await fetch(opts.request.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: opts.signal,
    })
  } catch (err) {
    if (opts.signal.aborted) return { error: 'aborted', code: 'aborted' }
    const msg = err instanceof Error ? err.message : String(err)
    return { error: `embedding fetch failed: ${msg}`, code: 'fetch' }
  }

  let json: EmbeddingResponse
  try {
    json = (await response.json()) as EmbeddingResponse
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { error: `invalid embedding JSON: ${msg}`, code: 'invalid-json' }
  }

  if (!response.ok) {
    const upstreamMsg = typeof json.error?.message === 'string' ? json.error.message : `HTTP ${response.status}`
    return { error: upstreamMsg, code: 'upstream' }
  }

  const normalized = normalizeEmbeddingData(json.data, input.length)
  if ('error' in normalized) return normalized

  const dim = opts.expectedDim ?? normalized.vectors[0]?.length
  if (typeof dim !== 'number' || !Number.isInteger(dim) || dim <= 0) {
    return { error: 'embedding dimension must be a positive integer', code: 'dimension-mismatch' }
  }
  for (const vector of normalized.vectors) {
    if (vector.length !== dim) {
      return {
        error: `embedding dimension mismatch: expected ${dim}, got ${vector.length}`,
        code: 'dimension-mismatch',
      }
    }
  }

  return { model: opts.request.model, vectors: normalized.vectors, dim }
}

export async function embedTextGroups(
  opts: EmbedTextGroupsOptions,
): Promise<{ model: string; groups: Float32Array[][]; dim: number } | MemoryEmbeddingProviderError> {
  const groups = opts.groups.map((group) => [...group])
  if (groups.length === 0) {
    return { error: 'contextual embedding groups must not be empty', code: 'configuration' }
  }
  if (groups.some((group) => group.length === 0)) {
    return {
      error: 'contextual embedding groups must not contain empty groups',
      code: 'configuration',
    }
  }
  if (groups.some((group) => group.some((value) => typeof value !== 'string'))) {
    return { error: 'contextual embedding groups must contain only strings', code: 'configuration' }
  }
  if (opts.request.provider !== 'voyage-contextual') {
    return {
      error: 'contextual embedding groups require a contextual provider',
      code: 'configuration',
    }
  }
  if (
    groups.some((group) => group.length > 1) &&
    typeof effectiveMemoryEmbeddingLimits(opts.request).contextualWindowTokens !== 'number'
  ) {
    return {
      error: `contextual embedding model ${opts.request.model} is missing contextualWindowTokens; refusing to send grouped contextual inputs`,
      code: 'configuration',
    }
  }
  const flattenedInputs = groups.flat()
  const sizeViolation = findMemoryEmbeddingLimitViolation(
    opts.request,
    flattenedInputs,
    (index) => `contextual embedding input ${index}`,
  )
  if (sizeViolation) {
    return {
      error: formatMemoryEmbeddingLimitViolation(sizeViolation),
      code: 'configuration',
    }
  }
  const groupSizeViolation = findMemoryEmbeddingContextualGroupLimitViolation(
    opts.request,
    groups,
    (index) => `contextual embedding group ${index}`,
  )
  if (groupSizeViolation) {
    return {
      error: formatMemoryEmbeddingLimitViolation(groupSizeViolation),
      code: 'configuration',
    }
  }
  if (opts.signal.aborted) return { error: 'aborted', code: 'aborted' }

  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (opts.request.apiKey) headers.authorization = `Bearer ${opts.request.apiKey}`

  let response: Response
  try {
    response = await fetch(opts.request.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        inputs: groups,
        model: opts.request.wireModel ?? opts.request.model,
        input_type: 'document',
      }),
      signal: opts.signal,
    })
  } catch (err) {
    if (opts.signal.aborted) return { error: 'aborted', code: 'aborted' }
    const msg = err instanceof Error ? err.message : String(err)
    return { error: `embedding fetch failed: ${msg}`, code: 'fetch' }
  }

  let json: EmbeddingResponse
  try {
    json = (await response.json()) as EmbeddingResponse
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { error: `invalid embedding JSON: ${msg}`, code: 'invalid-json' }
  }

  if (!response.ok) {
    const upstreamMsg = typeof json.error?.message === 'string' ? json.error.message : `HTTP ${response.status}`
    return { error: upstreamMsg, code: 'upstream' }
  }

  const normalized = normalizeEmbeddingGroupData(
    json.data,
    groups.map((group) => group.length),
  )
  if ('error' in normalized) return normalized

  const dim = opts.expectedDim ?? normalized.groups[0]?.[0]?.length
  if (typeof dim !== 'number' || !Number.isInteger(dim) || dim <= 0) {
    return { error: 'embedding dimension must be a positive integer', code: 'dimension-mismatch' }
  }
  for (const group of normalized.groups) {
    for (const vector of group) {
      if (vector.length !== dim) {
        return {
          error: `embedding dimension mismatch: expected ${dim}, got ${vector.length}`,
          code: 'dimension-mismatch',
        }
      }
    }
  }

  return { model: opts.request.model, groups: normalized.groups, dim }
}

function normalizeEmbeddingData(
  rawData: unknown,
  expectedCount: number,
): { vectors: Float32Array[] } | MemoryEmbeddingProviderError {
  if (!Array.isArray(rawData)) {
    return { error: 'embedding response data must be an array', code: 'invalid-response' }
  }
  if (rawData.length !== expectedCount) {
    return {
      error: `embedding response count mismatch: expected ${expectedCount}, got ${rawData.length}`,
      code: 'invalid-response',
    }
  }

  const vectors = new Array<Float32Array>(expectedCount)
  const hasIndexes = rawData.some((item) => typeof (item as EmbeddingResponseItem)?.index === 'number')

  for (let i = 0; i < rawData.length; i += 1) {
    const item = rawData[i] as EmbeddingResponseItem
    const rawIndex = hasIndexes ? item.index : i
    if (typeof rawIndex !== 'number' || !Number.isInteger(rawIndex) || rawIndex < 0 || rawIndex >= expectedCount) {
      return { error: 'embedding response contains an invalid index', code: 'invalid-response' }
    }
    const index = rawIndex
    if (vectors[index] !== undefined) {
      return { error: 'embedding response contains duplicate indexes', code: 'invalid-response' }
    }

    const vector = normalizeVector(item.embedding)
    if ('error' in vector) return vector
    vectors[index] = vector.vector
  }

  if (vectors.some((vector) => vector === undefined)) {
    return { error: 'embedding response is missing one or more indexes', code: 'invalid-response' }
  }

  return { vectors }
}

function normalizeEmbeddingGroupData(
  rawData: unknown,
  expectedGroupCounts: readonly number[],
): { groups: Float32Array[][] } | MemoryEmbeddingProviderError {
  if (!Array.isArray(rawData)) {
    return { error: 'embedding response data must be an array', code: 'invalid-response' }
  }
  if (rawData.length !== expectedGroupCounts.length) {
    return {
      error: `embedding response group count mismatch: expected ${expectedGroupCounts.length}, got ${rawData.length}`,
      code: 'invalid-response',
    }
  }

  const groups: Float32Array[][] = []
  for (let groupIndex = 0; groupIndex < rawData.length; groupIndex += 1) {
    const rawGroup = rawData[groupIndex] as { data?: unknown }
    if (!Array.isArray(rawGroup?.data)) {
      return { error: 'embedding response group data must be an array', code: 'invalid-response' }
    }
    const normalized = normalizeEmbeddingData(rawGroup.data, expectedGroupCounts[groupIndex])
    if ('error' in normalized) return normalized
    groups.push(normalized.vectors)
  }

  return { groups }
}

function normalizeVector(raw: unknown): { vector: Float32Array } | MemoryEmbeddingProviderError {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { error: 'embedding vector must be a non-empty number array', code: 'invalid-response' }
  }

  const vector = new Float32Array(raw.length)
  for (let i = 0; i < raw.length; i += 1) {
    const value = raw[i]
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return { error: 'embedding vector values must be finite numbers', code: 'invalid-response' }
    }
    vector[i] = value
  }
  return { vector }
}
