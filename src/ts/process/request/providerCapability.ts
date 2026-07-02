import { LLMFormat } from '../../model/types'

/**
 * Single source of truth for the server provider-routing decision. Given a
 * resolved model (`format` + the config fields the gates read), it answers
 * "which server provider dispatches this, or is it unsupported and in which
 * category." The server `/chat` dispatcher
 * (`dispatchChatProvider`, `server/fastify/src/prompt/chatDispatch.ts`) calls it;
 * browser server completion now sends only a server-owned intent and reaches this
 * table through Fastify.
 *
 * This module is pure: no `getDatabase()`, no `isFastifyServer`, no I/O. It reads
 * only its `input`. The `db → modelInfo` derivation (registry on the browser,
 * string-prefix on the server) and the user-facing reason **prose** stay
 * per-side; see `docs/structure/providers-and-models.md`.
 */

/** Stable reason category. Each consumer maps it to its own user-facing prose. */
export type ProviderUnsupportedReason =
  | 'novelai'
  | 'novellist'
  | 'ooba'
  | 'plugin'
  | 'webllm'
  | 'format-not-server-routable'
  | 'config-incomplete'

export type ProviderCapabilityVerdict =
  | { routable: true; provider: string }
  | { routable: false; reason: ProviderUnsupportedReason }

/** A `db.customModels[*]` entry, as the gates read it (extra fields ignored). */
export interface CustomModelEntryLike {
  id?: unknown
  url?: unknown
  key?: unknown
  format?: unknown
}

/**
 * Only the config fields the capability gates read. Both consumers build this
 * from their own `db` (the browser via `getDatabase()`, the server from the
 * route's `db`). Kept narrow so the table documents exactly what the decision
 * depends on.
 */
export interface ProviderCapabilityConfig {
  forceReplaceUrl?: string
  proxyKey?: string
  oaiCompApiKeys?: Record<string, string | undefined>
  customModels?: CustomModelEntryLike[]
  googleProjectId?: string
  vertexRegion?: string
  vertexClientEmail?: string
  vertexPrivateKey?: string
  claudeAPIKey?: string
  instructChatTemplate?: string
  jinjaTemplate?: string
  ollamaApiKey?: string
  ollamaRequestFormat?: LLMFormat
  ollamaURL?: string
}

export interface ProviderCapabilityInput {
  /** The (possibly reverse_proxy-remapped) resolved format. */
  format: LLMFormat
  /** The raw model id (`db.aiModel`). Drives the reverse_proxy/xcustom/etc. arms. */
  aiModel: string
  /** `modelInfo.endpoint` — a hardcoded base URL for self-hosted/Azure shapes. */
  endpoint?: string
  /** `modelInfo.keyIdentifier` — the `db.OaiCompAPIKeys` lookup key (DeepSeek…). */
  keyIdentifier?: string
  /** `modelInfo.internalID` — required for Bedrock wire-model resolution. */
  internalID?: string
  config: ProviderCapabilityConfig
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

/**
 * `LLMFormat` → coarse server provider, or `null` when no server dispatcher
 * exists for the format. Identical to the map the two resolvers each carried;
 * extracted here as the table's first column.
 */
export function formatToServerProvider(format: LLMFormat): string | null {
  switch (format) {
    case LLMFormat.Echo:
      return 'echo'
    case LLMFormat.OpenAICompatible:
      return 'openai'
    case LLMFormat.NanoGPT:
      return 'nanogpt'
    case LLMFormat.Anthropic:
    case LLMFormat.AnthropicLegacy:
    case LLMFormat.NanoGPTMessages:
      return 'anthropic'
    case LLMFormat.Mistral:
      return 'mistral'
    case LLMFormat.Cohere:
      return 'cohere'
    case LLMFormat.GoogleCloud:
    case LLMFormat.VertexAIGemini:
      return 'gemini'
    case LLMFormat.OpenAILegacyInstruct:
    case LLMFormat.NanoGPTLegacy:
      return 'openai-legacy-instruct'
    case LLMFormat.OpenAIResponseAPI:
    case LLMFormat.NanoGPTResponses:
      return 'openai-responses'
    case LLMFormat.Ollama:
      return 'ollama'
    case LLMFormat.AWSBedrockClaude:
      return 'bedrock'
    case LLMFormat.Horde:
      return 'horde'
    case LLMFormat.Kobold:
      return 'kobold'
    case LLMFormat.OobaLegacy:
      return 'ooba-legacy'
    default:
      return null
  }
}

/**
 * The reason category for a format with no coarse provider. The categorically
 * browser-only formats carry their own code so `chatDispatch` can reproduce its
 * specific per-format message; everything else is the generic
 * `format-not-server-routable`.
 */
function unroutableFormatReason(format: LLMFormat): ProviderUnsupportedReason {
  switch (format) {
    case LLMFormat.NovelAI:
      return 'novelai'
    case LLMFormat.NovelList:
      return 'novellist'
    case LLMFormat.Ooba:
      return 'ooba'
    case LLMFormat.Plugin:
      return 'plugin'
    case LLMFormat.WebLLM:
      return 'webllm'
    default:
      return 'format-not-server-routable'
  }
}

/** `db.customModels` lookup that also enforces the URL + key presence gate. */
function findXcustomEntry(config: ProviderCapabilityConfig, aiModel: string): CustomModelEntryLike | null {
  const entry = (config.customModels ?? []).find((m) => m.id === aiModel)
  if (!entry) return null
  if (!nonEmpty(entry.url) || !nonEmpty(entry.key)) return null
  return entry
}

/**
 * Whether a reverse_proxy config carries the proxy URL + key both dispatchers
 * need. Shared by the OAI-compat / Anthropic / Mistral / Cohere / Responses /
 * LegacyInstruct reverse_proxy arms.
 */
function reverseProxyConfigured(config: ProviderCapabilityConfig): boolean {
  return nonEmpty(config.forceReplaceUrl) && nonEmpty(config.proxyKey)
}

/** OpenAI-compatible variant selection (`selectOpenAIVariant` precedent). */
function refineOpenAI(input: ProviderCapabilityInput): string | null {
  const { aiModel, config } = input
  if (aiModel === 'openrouter') return 'openrouter'
  if (aiModel === 'reverse_proxy') {
    if (input.format !== LLMFormat.OpenAICompatible) return null
    return reverseProxyConfigured(config) ? 'openai' : null
  }
  if (aiModel.startsWith('xcustom:::')) {
    const entry = findXcustomEntry(config, aiModel)
    if (entry === null) return null
    return entry.format === LLMFormat.OpenAICompatible ? 'openai' : null
  }
  if (nonEmpty(input.keyIdentifier)) {
    if (!nonEmpty(config.oaiCompApiKeys?.[input.keyIdentifier])) return null
    return nonEmpty(input.endpoint) ? 'openai' : null
  }
  // A hardcoded endpoint without a keyIdentifier is a self-hosted/proxy shape
  // whose auth path is undefined for server dispatch — stay unroutable.
  if (nonEmpty(input.endpoint)) return null
  return 'openai'
}

/**
 * The reverse_proxy + xcustom + hardcoded-endpoint shape shared by the
 * Anthropic / Mistral / Cohere arms: reverse_proxy needs URL + key; xcustom
 * rides only when its entry format matches the coarse format; a hardcoded
 * endpoint keeps local dispatch.
 */
function isVanillaProxyShaped(input: ProviderCapabilityInput, xcustomFormat: LLMFormat): boolean {
  const { aiModel, config } = input
  if (aiModel === 'reverse_proxy') return reverseProxyConfigured(config)
  if (aiModel.startsWith('xcustom:::')) {
    const entry = findXcustomEntry(config, aiModel)
    return entry !== null && entry.format === xcustomFormat
  }
  if (nonEmpty(input.endpoint)) return false
  return true
}

function isVanillaGemini(input: ProviderCapabilityInput): boolean {
  const { aiModel, config } = input
  if (aiModel === 'reverse_proxy') return false
  if (aiModel.startsWith('xcustom:::')) return false
  if (nonEmpty(input.endpoint)) return false
  if (input.format === LLMFormat.VertexAIGemini) {
    return (
      nonEmpty(config.googleProjectId) &&
      nonEmpty(config.vertexRegion) &&
      nonEmpty(config.vertexClientEmail) &&
      nonEmpty(config.vertexPrivateKey)
    )
  }
  return true
}

/** AWS credentials are stored as `accessKeyId:secretAccessKey:region`. */
function hasBedrockCredentials(claudeAPIKey: string | undefined): boolean {
  if (typeof claudeAPIKey !== 'string') return false
  const parts = claudeAPIKey.split(':')
  return parts.length >= 3 && nonEmpty(parts[0]) && nonEmpty(parts[1]) && nonEmpty(parts[2])
}

function isVanillaBedrock(input: ProviderCapabilityInput): boolean {
  const { aiModel, config } = input
  if (aiModel === 'reverse_proxy') return false
  if (aiModel.startsWith('xcustom:::')) return false
  if (!hasBedrockCredentials(config.claudeAPIKey)) return false
  return nonEmpty(input.internalID)
}

function isVanillaHorde(input: ProviderCapabilityInput): boolean {
  const { aiModel, config } = input
  if (!aiModel.startsWith('horde:::')) return false
  if (aiModel.slice('horde:::'.length).length === 0) return false
  // Horde dispatch needs a concrete instruct template for both server-intent
  // completion and /chat; prompt shaping happens later on the owning path.
  if (!nonEmpty(config.instructChatTemplate)) return false
  if (config.instructChatTemplate === 'jinja' && !nonEmpty(config.jinjaTemplate)) return false
  return true
}

function isVanillaLegacyInstruct(input: ProviderCapabilityInput): boolean {
  const { aiModel, config } = input
  if (aiModel === 'reverse_proxy') return reverseProxyConfigured(config)
  if (aiModel.startsWith('xcustom:::')) {
    const entry = findXcustomEntry(config, aiModel)
    return entry !== null && entry.format === LLMFormat.OpenAILegacyInstruct
  }
  // NanoGPTLegacy carries a fixed-format model id and stays routable; vanilla
  // LegacyInstruct endpoint overrides are unsupported.
  if (nonEmpty(input.endpoint) && input.format !== LLMFormat.NanoGPTLegacy) return false
  return true
}

function isVanillaResponses(input: ProviderCapabilityInput): boolean {
  const { aiModel, config } = input
  if (aiModel === 'reverse_proxy') return reverseProxyConfigured(config)
  if (aiModel.startsWith('xcustom:::')) {
    const entry = findXcustomEntry(config, aiModel)
    return entry !== null && entry.format === LLMFormat.OpenAIResponseAPI
  }
  // Responses accepts a `modelInfo.endpoint` as a baseUrl override (Azure-style).
  return true
}

/**
 * `ollama-cloud` remaps to openai / openai-responses / anthropic by
 * `db.ollamaRequestFormat`; native ollama (a configured `ollamaURL`) routes to
 * the dedicated `ollama` provider. Mirrors `resolveOllamaProvider`.
 */
function refineOllama(input: ProviderCapabilityInput): string | null {
  const { aiModel, config } = input
  if (aiModel === 'ollama-cloud') {
    if (!nonEmpty(config.ollamaApiKey)) return null
    switch (config.ollamaRequestFormat) {
      case LLMFormat.OpenAICompatible:
        return 'openai'
      case LLMFormat.OpenAIResponseAPI:
        return 'openai-responses'
      case LLMFormat.Anthropic:
        return 'anthropic'
      case LLMFormat.Ollama:
        return 'ollama'
      default:
        return null
    }
  }
  return nonEmpty(config.ollamaURL) ? 'ollama' : null
}

/**
 * The capability table. Returns the routed provider or an unsupported category.
 * Provider dispatch decision table (decision order: coarse map → per-provider
 * config refinement). Server chat and server-owned completion intent both reach
 * this table through the Fastify dispatcher; the browser no longer builds
 * provider wire payloads for server completion.
 */
export function resolveProviderCapability(input: ProviderCapabilityInput): ProviderCapabilityVerdict {
  const provider = formatToServerProvider(input.format)
  if (provider === null) {
    return { routable: false, reason: unroutableFormatReason(input.format) }
  }

  let routed: string | null = provider
  switch (provider) {
    case 'openai':
      routed = refineOpenAI(input)
      break
    case 'anthropic':
      routed = isVanillaProxyShaped(input, LLMFormat.Anthropic) ? provider : null
      break
    case 'mistral':
      routed = isVanillaProxyShaped(input, LLMFormat.Mistral) ? provider : null
      break
    case 'cohere':
      routed = isVanillaProxyShaped(input, LLMFormat.Cohere) ? provider : null
      break
    case 'gemini':
      routed = isVanillaGemini(input) ? provider : null
      break
    case 'openai-legacy-instruct':
      routed = isVanillaLegacyInstruct(input) ? provider : null
      break
    case 'openai-responses':
      routed = isVanillaResponses(input) ? provider : null
      break
    case 'bedrock':
      routed = isVanillaBedrock(input) ? provider : null
      break
    case 'horde':
      routed = isVanillaHorde(input) ? provider : null
      break
    case 'ollama':
      routed = refineOllama(input)
      break
    default:
      // echo, nanogpt, kobold, ooba-legacy: no per-provider config gate.
      routed = provider
  }

  if (routed === null) return { routable: false, reason: 'config-incomplete' }
  return { routable: true, provider: routed }
}
