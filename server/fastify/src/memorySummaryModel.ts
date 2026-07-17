import type { ModelProfileProviderOptions } from '../../../src/ts/model/modelProfileResolver'
import { resolveModelProfile } from '../../../src/ts/model/modelProfileResolver.js'
import type { Database } from '../../../src/ts/storage/database.svelte'
import { resolveMemoryModelCapability } from '../../../src/ts/model/memoryModelCapability.js'
import { type OpenAICompatibleOptions, type OpenAICompatibleProvider } from './generation/openaiCompatible.js'

export interface MemorySummaryModelRequest {
  provider: OpenAICompatibleProvider
  model: string
  options: OpenAICompatibleOptions
}

export type ResolveMemorySummaryModelResult =
  | { ok: true; request: MemorySummaryModelRequest }
  | { ok: false; error: string }

export function resolveMemorySummaryModel(db: Database, requestedModel: string): ResolveMemorySummaryModelResult {
  if (requestedModel !== 'subModel' && requestedModel !== 'memory') {
    return {
      ok: false,
      error: 'server-side memory summarization currently supports only the memory/subModel API path',
    }
  }

  const profile = resolveModelProfile({ database: db, role: 'memory' })
  const provider = resolveMemoryModelCapability(profile)
  if (provider.ok === false) return provider

  if (!profile.requestModel) {
    return { ok: false, error: 'summarization model must be a non-empty string' }
  }

  return {
    ok: true,
    request: {
      provider: provider.provider,
      model: profile.requestModel,
      options: buildMemorySummaryOptions(provider.provider, profile.providerOptions),
    },
  }
}

function buildMemorySummaryOptions(
  provider: OpenAICompatibleProvider,
  options: ModelProfileProviderOptions,
): OpenAICompatibleOptions {
  if (provider === 'nanogpt') {
    return {
      nanogpt: withoutUndefined({
        apiKey: options.apiKey,
        providerHint: options.nanogpt?.providerHint,
        useSubscription: options.nanogpt?.useSubscriptionEndpoint,
      }),
    }
  }

  if (provider === 'openrouter') {
    return { openrouter: withoutUndefined({ apiKey: options.apiKey }) }
  }

  return {
    openai: withoutUndefined({
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
      extraHeaders: options.extraHeaders,
      additionalParams: options.additionalParams,
      oobaSystemHoist: options.reverseProxy?.oobaSystemHoist === true ? true : undefined,
    }),
  }
}

function withoutUndefined<T extends Record<string, unknown>>(value: T): T {
  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) result[key] = item
  }
  return result as T
}
