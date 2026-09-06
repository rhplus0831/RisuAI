import { requestProviderOperation } from '../server/providerOperations'
import { createKeyedRequestCache, type KeyedRequestOptions } from './keyedRequestCache'
import type { ModelGridItem } from './modelGrid'

export interface LLMGatewayModelInfo {
  id: string
  name: string
  family: string
  description: string
  context_length: number
  inputModalities: string[]
  outputModalities: string[]
  promptPrice1M?: number
  completionPrice1M?: number
}

const LLM_GATEWAY_CATALOG_CACHE_TTL_MS = 30_000
const llmGatewayModelRequests = createKeyedRequestCache<LLMGatewayModelInfo[]>({
  ttlMs: LLM_GATEWAY_CATALOG_CACHE_TTL_MS,
})

export async function getLLMGatewayModels(options?: KeyedRequestOptions): Promise<LLMGatewayModelInfo[]> {
  try {
    return await llmGatewayModelRequests.request(
      'public',
      async () => {
        const response = await requestProviderOperation<{ data?: unknown }>('llmgateway.models', {
          credential: { source: 'none' },
        })
        return mapLLMGatewayModels(response.data)
      },
      options,
    )
  } catch {
    return []
  }
}

export function clearLLMGatewayRequestCacheForTests(): void {
  llmGatewayModelRequests.clear()
}

export function toModelGridItem(model: LLMGatewayModelInfo): ModelGridItem {
  const prices: Array<{ label: string; value: string }> = []
  const input = formatPrice(model.promptPrice1M)
  const output = formatPrice(model.completionPrice1M)
  if (input !== null) prices.push({ label: 'In', value: input })
  if (output !== null) prices.push({ label: 'Out', value: output })

  return {
    id: model.id,
    displayName: model.name,
    providerName: model.family || 'LLM Gateway',
    description: model.description,
    context_length: model.context_length,
    sortPrice: weightedPrice(model),
    prices,
  }
}

function mapLLMGatewayModels(value: unknown): LLMGatewayModelInfo[] {
  if (!Array.isArray(value)) throw new Error('LLM Gateway model response was malformed')

  return value
    .map((candidate): LLMGatewayModelInfo | null => {
      if (!isRecord(candidate) || typeof candidate.id !== 'string' || candidate.id.trim() === '') return null
      const architecture = isRecord(candidate.architecture) ? candidate.architecture : {}
      const outputModalities = stringArray(architecture.output_modalities)
      if (outputModalities.length > 0 && !outputModalities.includes('text')) return null
      const pricing = isRecord(candidate.pricing) ? candidate.pricing : {}

      return {
        id: candidate.id,
        name: nonBlankString(candidate.name) ?? candidate.id,
        family: nonBlankString(candidate.family) ?? '',
        description: nonBlankString(candidate.description) ?? '',
        context_length: nonNegativeNumber(candidate.context_length) ?? 0,
        inputModalities: stringArray(architecture.input_modalities),
        outputModalities,
        promptPrice1M: perTokenPriceToMillion(pricing.prompt),
        completionPrice1M: perTokenPriceToMillion(pricing.completion),
      }
    })
    .filter((model): model is LLMGatewayModelInfo => model !== null)
    .sort((left, right) => weightedPrice(left) - weightedPrice(right) || left.name.localeCompare(right.name))
}

function weightedPrice(model: LLMGatewayModelInfo): number {
  if (model.promptPrice1M === undefined && model.completionPrice1M === undefined) return Number.POSITIVE_INFINITY
  return ((model.promptPrice1M ?? 0) * 3 + (model.completionPrice1M ?? 0)) / 4
}

function formatPrice(value: number | undefined): string | null {
  if (value === undefined) return null
  if (value === 0) return 'Free'
  return `$${value.toFixed(value < 0.01 ? 4 : 2)}`
}

function perTokenPriceToMillion(value: unknown): number | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric >= 0 ? numeric * 1_000_000 : undefined
}

function nonNegativeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function nonBlankString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
