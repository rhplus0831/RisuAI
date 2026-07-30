import { requestProviderOperation } from '../server/providerOperations'
import { createKeyedRequestCache, type KeyedRequestOptions } from './keyedRequestCache'
import type { ModelGridItem } from './modelGrid'

export interface NeuralwattModelInfo {
  id: string
  name: string
  provider: string
  description: string
  contextLength: number
  maxOutputTokens?: number
  inputPricePerMillion?: number
  outputPricePerMillion?: number
  cachedInputPricePerMillion?: number
  pricingTbd: boolean
  capabilities: {
    tools: boolean
    jsonMode: boolean
    vision: boolean
    reasoning: boolean
    reasoningEffort: boolean
    streaming: boolean
    systemRole: boolean
    developerRole: boolean
  }
}

const NEURALWATT_CATALOG_CACHE_TTL_MS = 30_000
const neuralwattModelRequests = createKeyedRequestCache<NeuralwattModelInfo[]>({
  ttlMs: NEURALWATT_CATALOG_CACHE_TTL_MS,
})

export async function getNeuralwattModels(options?: KeyedRequestOptions): Promise<NeuralwattModelInfo[]> {
  try {
    return await neuralwattModelRequests.request(
      'public',
      async () => {
        const response = await requestProviderOperation<{ data?: unknown }>('neuralwatt.models', {
          credential: { source: 'none' },
        })
        return mapNeuralwattModels(response.data)
      },
      options,
    )
  } catch {
    return []
  }
}

export function clearNeuralwattRequestCacheForTests(): void {
  neuralwattModelRequests.clear()
}

export function toModelGridItem(model: NeuralwattModelInfo): ModelGridItem {
  const prices: Array<{ label: string; value: string }> = []
  if (model.pricingTbd) {
    prices.push({ label: 'Price', value: 'TBD' })
  } else {
    const input = formatPrice(model.inputPricePerMillion)
    const output = formatPrice(model.outputPricePerMillion)
    if (input !== null) prices.push({ label: 'In', value: input })
    if (output !== null) prices.push({ label: 'Out', value: output })
  }

  return {
    id: model.id,
    displayName: model.name,
    providerName: model.provider || 'Neuralwatt',
    description: model.description,
    context_length: model.contextLength,
    sortPrice: weightedPrice(model),
    prices,
  }
}

function mapNeuralwattModels(value: unknown): NeuralwattModelInfo[] {
  if (!Array.isArray(value)) throw new Error('Neuralwatt model response was malformed')

  return value
    .map((candidate): NeuralwattModelInfo | null => {
      if (!isRecord(candidate)) return null
      const id = nonBlankString(candidate.id)
      if (!id) return null

      const metadata = isRecord(candidate.metadata) ? candidate.metadata : {}
      const pricing = isRecord(metadata.pricing) ? metadata.pricing : {}
      const capabilities = isRecord(metadata.capabilities) ? metadata.capabilities : {}
      const limits = isRecord(metadata.limits) ? metadata.limits : {}
      const description = nonBlankString(metadata.description) ?? ''
      const deprecatedMessage = metadata.deprecated === true ? nonBlankString(metadata.deprecated_message) : undefined

      return {
        id,
        name: nonBlankString(metadata.display_name) ?? id,
        provider: nonBlankString(metadata.provider) ?? 'Neuralwatt',
        description: deprecatedMessage ? `${description}${description ? ' ' : ''}${deprecatedMessage}` : description,
        contextLength: nonNegativeNumber(limits.max_context_length) ?? nonNegativeNumber(candidate.max_model_len) ?? 0,
        maxOutputTokens: nonNegativeNumber(limits.max_output_tokens),
        inputPricePerMillion: nonNegativeNumber(pricing.input_per_million),
        outputPricePerMillion: nonNegativeNumber(pricing.output_per_million),
        cachedInputPricePerMillion: nonNegativeNumber(pricing.cached_input_per_million),
        pricingTbd: pricing.pricing_tbd === true,
        capabilities: {
          tools: capabilities.tools === true,
          jsonMode: capabilities.json_mode === true,
          vision: capabilities.vision === true,
          reasoning: capabilities.reasoning === true,
          reasoningEffort: capabilities.reasoning_effort === true,
          streaming: capabilities.streaming === true,
          systemRole: capabilities.system_role === true,
          developerRole: capabilities.developer_role === true,
        },
      }
    })
    .filter((model): model is NeuralwattModelInfo => model !== null)
    .sort((left, right) => weightedPrice(left) - weightedPrice(right) || left.name.localeCompare(right.name))
}

function weightedPrice(model: NeuralwattModelInfo): number {
  if (model.pricingTbd) return Number.POSITIVE_INFINITY
  if (model.inputPricePerMillion === undefined && model.outputPricePerMillion === undefined) {
    return Number.POSITIVE_INFINITY
  }
  return ((model.inputPricePerMillion ?? 0) * 3 + (model.outputPricePerMillion ?? 0)) / 4
}

function formatPrice(value: number | undefined): string | null {
  if (value === undefined) return null
  if (value === 0) return 'Free'
  return `$${value.toFixed(value < 0.01 ? 4 : 2)}`
}

function nonNegativeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function nonBlankString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
