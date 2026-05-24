import { coerceAdditionalParams } from './additionalParams.js'

export const NANOGPT_BASE_URL = 'https://nano-gpt.com/api/v1'
export const NANOGPT_SUBSCRIPTION_BASE_URL = 'https://nano-gpt.com/api/subscription/v1'
export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'

export type OpenAICompatibleProvider = 'openai' | 'nanogpt' | 'openrouter'

export interface OpenAIOptions {
  apiKey?: unknown
  baseUrl?: unknown
  maxTokens?: unknown
  temperature?: unknown
  /**
   * Pre-parsed `[key, value][]` pairs from the SPA's xcustom `params` /
   * reverse_proxy `additionalParams` DSL. Applied after the dispatcher
   * builds the body + headers.
   */
  additionalParams?: unknown
  /**
   * Mirrors `db.reverseProxyOobaMode` — hoist every system message into a
   * single trailing system row before sending. Only used by reverse_proxy.
   */
  oobaSystemHoist?: unknown
  /**
   * Headers to merge into the upstream request. Used by reverse_proxy to
   * inject `X-Proxy-Risu: RisuAI` when the user prefixed their URL with
   * `risu::`.
   */
  extraHeaders?: Record<string, string>
}

export interface NanoGPTOptions {
  apiKey?: unknown
  providerHint?: unknown
  useSubscription?: unknown
  maxTokens?: unknown
  temperature?: unknown
}

export interface OpenRouterOptions {
  apiKey?: unknown
  maxTokens?: unknown
  temperature?: unknown
}

export interface OpenAICompatibleOptions {
  openai?: OpenAIOptions
  nanogpt?: NanoGPTOptions
  openrouter?: OpenRouterOptions
}

export interface OpenAICompatibleVariant {
  apiKey: string
  baseUrl: string
  maxTokens?: unknown
  temperature?: unknown
  extraHeaders?: Record<string, string>
  additionalParams?: Array<[string, string]>
  oobaSystemHoist?: boolean
}

export function resolveOpenAIVariant(
  o: OpenAIOptions,
): { ok: true; variant: OpenAICompatibleVariant } | { ok: false; error: string } {
  if (typeof o.apiKey !== 'string' || o.apiKey.length === 0) {
    return { ok: false, error: 'options.openai.apiKey is required' }
  }
  const baseUrl =
    typeof o.baseUrl === 'string' && o.baseUrl.length > 0 ? o.baseUrl : 'https://api.openai.com/v1'
  const variant: OpenAICompatibleVariant = {
    apiKey: o.apiKey,
    baseUrl,
    maxTokens: o.maxTokens,
    temperature: o.temperature,
  }
  if (o.extraHeaders !== undefined) {
    variant.extraHeaders = o.extraHeaders
  }
  if (o.additionalParams !== undefined) {
    const coerced = coerceAdditionalParams(o.additionalParams)
    if (coerced === null) {
      return {
        ok: false,
        error: 'options.openai.additionalParams must be an array of [string, string] pairs',
      }
    }
    if (coerced.length > 0) variant.additionalParams = coerced
  }
  if (o.oobaSystemHoist === true) variant.oobaSystemHoist = true
  return { ok: true, variant }
}

export function resolveNanoGPTVariant(o: NanoGPTOptions): OpenAICompatibleVariant | null {
  if (typeof o.apiKey !== 'string' || o.apiKey.length === 0) return null
  const baseUrl = o.useSubscription === true ? NANOGPT_SUBSCRIPTION_BASE_URL : NANOGPT_BASE_URL
  const extraHeaders: Record<string, string> = {}
  if (typeof o.providerHint === 'string' && o.providerHint.length > 0) {
    extraHeaders['X-Provider'] = o.providerHint
  }
  return {
    apiKey: o.apiKey,
    baseUrl,
    maxTokens: o.maxTokens,
    temperature: o.temperature,
    extraHeaders,
  }
}

export function resolveOpenRouterVariant(o: OpenRouterOptions): OpenAICompatibleVariant | null {
  if (typeof o.apiKey !== 'string' || o.apiKey.length === 0) return null
  return {
    apiKey: o.apiKey,
    baseUrl: OPENROUTER_BASE_URL,
    maxTokens: o.maxTokens,
    temperature: o.temperature,
    extraHeaders: {
      'X-Title': 'RisuAI',
      'HTTP-Referer': 'https://risuai.xyz',
    },
  }
}

export function resolveOpenAICompatibleVariant(
  provider: OpenAICompatibleProvider,
  options: OpenAICompatibleOptions,
): { ok: true; variant: OpenAICompatibleVariant } | { ok: false; error: string } {
  if (provider === 'openai') return resolveOpenAIVariant(options.openai ?? {})

  if (provider === 'nanogpt') {
    const variant = resolveNanoGPTVariant(options.nanogpt ?? {})
    return variant
      ? { ok: true, variant }
      : { ok: false, error: 'options.nanogpt.apiKey is required' }
  }

  const variant = resolveOpenRouterVariant(options.openrouter ?? {})
  return variant
    ? { ok: true, variant }
    : { ok: false, error: 'options.openrouter.apiKey is required' }
}
