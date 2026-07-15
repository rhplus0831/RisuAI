import { getDatabase } from '../storage/database.svelte'
import { providerOperationCredential, requestProviderOperation } from '../server/providerOperations'
import type { ModelGridItem } from './modelGrid'
import { createKeyedRequestCache, type KeyedRequestOptions } from './keyedRequestCache'

export type NanoGPTCatalogFetchContext = {
  apiKey?: string | null
  profileId?: string | null
  refresh?: boolean
}

export type NanoGPTRequestOptions = KeyedRequestOptions

export type NanoGPTModelInfo = {
  id: string
  name: string
  owned_by: string
  context_length: number
  max_output_tokens: number
  description: string
  capabilities: {
    vision?: boolean
    reasoning?: boolean
    tool_calling?: boolean
    [key: string]: boolean | undefined
  }
  /** Input (prompt) price per 1M tokens in USD */
  promptPrice1M: number | undefined
  /** Output (completion) price per 1M tokens in USD */
  completionPrice1M: number | undefined
}

export type NanoGPTBalance = {
  usd_balance: string
  nano_balance: string
  nanoDepositAddress: string
}

type UsageBucket = {
  used: number
  remaining: number
  percentUsed: number
  resetAt: number
}

export type NanoGPTSubscriptionUsage = {
  active: boolean
  state: 'active' | 'grace' | 'inactive'
  graceUntil: string | null
  cancelAtPeriodEnd: boolean
  limits: {
    weeklyInputTokens: number | null
    dailyInputTokens: number | null
    dailyImages: number | null
  }
  weeklyInputTokens: UsageBucket | null
  dailyInputTokens: UsageBucket | null
  dailyImages: UsageBucket | null
  period: { currentPeriodEnd: string }
}

const NANO_GPT_CATALOG_CACHE_TTL_MS = 30_000
const nanoGPTBalanceRequests = createKeyedRequestCache<NanoGPTBalance>({ ttlMs: 0 })
const nanoGPTSubscriptionRequests = createKeyedRequestCache<NanoGPTSubscriptionUsage>({ ttlMs: 0 })
const nanoGPTProviderRequests = createKeyedRequestCache<NanoGPTModelProviders>({
  ttlMs: NANO_GPT_CATALOG_CACHE_TTL_MS,
})
const nanoGPTSubscriptionModelRequests = createKeyedRequestCache<NanoGPTModelInfo[]>({
  ttlMs: NANO_GPT_CATALOG_CACHE_TTL_MS,
})
const nanoGPTModelRequests = createKeyedRequestCache<NanoGPTModelInfo[]>({
  ttlMs: NANO_GPT_CATALOG_CACHE_TTL_MS,
})

export async function getNanoGPTBalance(key: string, options?: NanoGPTRequestOptions): Promise<NanoGPTBalance | null> {
  try {
    return await nanoGPTBalanceRequests.request(
      key,
      () =>
        requestProviderOperation<NanoGPTBalance>('nanogpt.balance', {
          credential: providerOperationCredential(key),
        }),
      options,
    )
  } catch {
    return null
  }
}

export async function getNanoGPTSubscription(
  key: string,
  options?: NanoGPTRequestOptions,
): Promise<NanoGPTSubscriptionUsage | null> {
  try {
    return await nanoGPTSubscriptionRequests.request(
      key,
      () =>
        requestProviderOperation<NanoGPTSubscriptionUsage>('nanogpt.subscription', {
          credential: providerOperationCredential(key),
        }),
      options,
    )
  } catch {
    return null
  }
}

type NanoGPTPriceComparison = {
  platformVsOfficial: {
    inputDiscountPct: number
    outputDiscountPct: number
    inputDirection: 'less' | 'more'
    outputDirection: 'less' | 'more'
  }
  hasUserDiscount: boolean
}

export type NanoGPTModelProvider = {
  provider: string
  pricing: {
    inputPer1kTokens: number
    outputPer1kTokens: number
    cacheReadInputPer1kTokens?: number
  }
  available: boolean
  supportsPromptCaching?: boolean
  quantization?: string
  comparison?: NanoGPTPriceComparison
}

export type NanoGPTModelProviders = {
  canonicalId: string
  displayName: string
  supportsProviderSelection: boolean
  defaultPrice: { inputPer1kTokens: number; outputPer1kTokens: number }
  providers: NanoGPTModelProvider[]
  autoTps?: number
  autoTtftMs?: number
  autoComparison?: NanoGPTPriceComparison
  officialBaseline?: {
    provider: string
    label: string
    officialModelId: string
    pricing: { inputPer1kTokens: number; outputPer1kTokens: number }
  }
}

export async function getNanoGPTModelProviders(
  key: string,
  modelId: string,
  options?: NanoGPTRequestOptions,
): Promise<NanoGPTModelProviders | null> {
  try {
    const credential = providerOperationCredential(key)
    return await nanoGPTProviderRequests.request(
      JSON.stringify([key, modelId]),
      async () => {
        const json = await requestProviderOperation<NanoGPTModelProviders>('nanogpt.model-providers', {
          credential,
          input: { modelId },
        })
        if (!json || !Array.isArray(json.providers)) throw new Error('NanoGPT provider response was malformed')
        return json
      },
      {
        ...options,
        refresh: options?.refresh || credential.source === 'stored' || credential.source === 'model-profile',
      },
    )
  } catch {
    return null
  }
}

export async function getNanoGPTSubscriptionModels(
  key: string,
  options?: NanoGPTRequestOptions,
): Promise<NanoGPTModelInfo[]> {
  if (!key) return []
  try {
    const credential = providerOperationCredential(key)
    return await nanoGPTSubscriptionModelRequests.request(
      key,
      async () => {
        const json = await requestProviderOperation<{ data?: unknown }>('nanogpt.subscription-models', {
          credential,
        })
        return mapNanoGPTModels(json?.data)
      },
      {
        ...options,
        refresh: options?.refresh || credential.source === 'stored' || credential.source === 'model-profile',
      },
    )
  } catch {
    return []
  }
}

function resolveNanoGPTCatalogContext(context?: NanoGPTCatalogFetchContext): {
  apiKey: string
  profileId?: string | null
} {
  if (context !== undefined) {
    return { apiKey: context.apiKey ?? '', profileId: context.profileId }
  }
  return { apiKey: getDatabase().nanogptKey }
}

export async function getNanoGPTModels(context?: NanoGPTCatalogFetchContext): Promise<NanoGPTModelInfo[]> {
  try {
    const { apiKey, profileId } = resolveNanoGPTCatalogContext(context)
    const credential = providerOperationCredential(apiKey, { profileId })

    return await nanoGPTModelRequests.request(
      JSON.stringify([apiKey, profileId ?? '']),
      async () => {
        const json = await requestProviderOperation<{ data?: unknown }>('nanogpt.models', {
          credential,
        })
        return mapNanoGPTModels(json?.data)
      },
      {
        refresh: context?.refresh || credential.source === 'stored' || credential.source === 'model-profile',
      },
    )
  } catch {
    return []
  }
}

export function getNanoGPTModelCatalog(
  apiKey: string,
  useSubscriptionEndpoint: boolean,
  options?: NanoGPTRequestOptions,
): Promise<NanoGPTModelInfo[]> {
  return useSubscriptionEndpoint
    ? getNanoGPTSubscriptionModels(apiKey, options)
    : getNanoGPTModels({ apiKey, refresh: options?.refresh })
}

export function clearNanoGPTRequestCachesForTests(): void {
  nanoGPTBalanceRequests.clear()
  nanoGPTSubscriptionRequests.clear()
  nanoGPTProviderRequests.clear()
  nanoGPTSubscriptionModelRequests.clear()
  nanoGPTModelRequests.clear()
}

export function toModelGridItem(m: NanoGPTModelInfo): ModelGridItem {
  const fmt = (p: number | undefined): string | null => {
    if (p === undefined) return null
    if (p === 0) return 'Free'
    return `$${p.toFixed(2)}`
  }

  const prices: { label: string; value: string }[] = []
  const pairs: [string, number | undefined][] = [
    ['In', m.promptPrice1M],
    ['Out', m.completionPrice1M],
  ]
  for (const [label, p] of pairs) {
    const v = fmt(p)
    if (v !== null) prices.push({ label, value: v })
  }

  return {
    id: m.id,
    displayName: m.name,
    providerName: m.owned_by,
    description: m.description,
    context_length: m.context_length,
    sortPrice: m.promptPrice1M ?? Infinity,
    prices,
  }
}

function parsePrice(raw: any): number | undefined {
  const n = Number(raw)
  return raw != null && raw !== '' && !isNaN(n) ? n : undefined
}

function mapNanoGPTModels(rawModels: unknown): NanoGPTModelInfo[] {
  if (!Array.isArray(rawModels)) throw new Error('NanoGPT model response was malformed')
  const models: any[] = rawModels
  return models.map((m) => ({
    id: m.id,
    name: m.name || m.id,
    owned_by: m.owned_by ?? '',
    context_length: m.context_length ?? 0,
    max_output_tokens: m.max_output_tokens ?? 0,
    description: m.description ?? '',
    capabilities: m.capabilities ?? {},
    promptPrice1M: parsePrice(m.pricing?.prompt),
    completionPrice1M: parsePrice(m.pricing?.completion),
  }))
}
