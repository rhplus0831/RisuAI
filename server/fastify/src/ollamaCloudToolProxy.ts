import { Readable } from 'node:stream'
import { finished } from 'node:stream/promises'
import { StringDecoder } from 'node:string_decoder'
import type { DatabaseSync } from 'node:sqlite'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { Database } from '../../../src/ts/storage/database.svelte.js'
import type { LegacyModelMode } from '../../../src/ts/model/modelRoles.js'
import { LLMFormat } from '../../../src/ts/model/types.js'
import {
  assertModelProfileGenerationReady,
  resolveModelProfile,
  resolveModelProfileByProfileId,
  type ResolvedModelProfile,
} from '../../../src/ts/model/modelProfileResolver.js'
import { filterResponseHeaders } from './proxy.js'
import { applyAdditionalParameters } from './generation/additionalParams.js'
import { MASKED_PROVIDER_SECRET } from './providerSecrets.js'
import { attachAbort } from './requestAbort.js'
import { loadServerIntentCompletionSettings } from './repository.js'
import {
  completeRequestHistory,
  createRequestHistoryResponseCapture,
  requestHistoryProfileSnapshot,
  tryBeginRequestHistory,
  type RequestHistoryCapturedResponse,
  type RequestHistoryHandle,
} from './requestHistory.js'

export const OLLAMA_CLOUD_TOOL_OPERATION = 'ollama-cloud-tool'

const TOOL_PROTOCOLS = ['native', 'openai-chat', 'openai-responses', 'anthropic'] as const
type OllamaCloudToolProtocol = (typeof TOOL_PROTOCOLS)[number]

const TOOL_PROTOCOL_SET = new Set<string>(TOOL_PROTOCOLS)
const COMPLETION_MODEL_MODES = [
  'model',
  'submodel',
  'memory',
  'emotion',
  'otherAx',
  'translate',
  'scriptMain',
  'scriptAux',
] as const satisfies readonly LegacyModelMode[]
const COMPLETION_MODEL_MODE_SET = new Set<string>(COMPLETION_MODEL_MODES)
const ALLOWED_QUERY_KEYS = new Set([
  'operation',
  'protocol',
  'mode',
  'profileId',
  'staticModel',
  'characterId',
  'chatId',
  'toggles',
])
const MAX_IDENTITY_LENGTH = 512

type JsonRecord = Record<string, unknown>

interface OllamaCloudToolQuery {
  operation: typeof OLLAMA_CLOUD_TOOL_OPERATION
  protocol: OllamaCloudToolProtocol
  mode: LegacyModelMode
  profileId?: string
  staticModel?: string
  characterId?: string
  chatId?: string
  toggles?: Record<string, string>
}

interface ResolvedOllamaCloudToolTarget {
  additionalParams: Array<[string, string]>
  apiKey: string
  extraHeaders: Record<string, string>
  model: string
  profile: ResolvedModelProfile
  protocol: OllamaCloudToolProtocol
  thinkingMode?: boolean | 'low' | 'medium' | 'high'
  url: string
}

export function isOllamaCloudToolOperation(query: unknown): boolean {
  return isRecord(query) && query.operation === OLLAMA_CLOUD_TOOL_OPERATION
}

export async function handleOllamaCloudToolProxy(
  req: FastifyRequest,
  reply: FastifyReply,
  db: DatabaseSync,
): Promise<void> {
  reply.header('cache-control', 'no-store')

  let query: OllamaCloudToolQuery
  let payload: JsonRecord
  let target: ResolvedOllamaCloudToolTarget
  let database: Database
  try {
    query = parseQuery(req.query)
    payload = parsePayload(req.body, query.protocol)
    const settings = loadServerIntentCompletionSettings(db)
    if (settings === null) throw new Error('database is not initialized')
    database = settings as unknown as Database
    target = resolveTarget(database, query)
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : 'invalid Ollama Cloud tool request'
    reply.code(400).send({ error: message })
    return
  }

  const upstreamPayload: JsonRecord = {
    ...payload,
  }
  const configuredHeaders = { ...target.extraHeaders }
  applyAdditionalParameters(upstreamPayload, configuredHeaders, target.additionalParams)
  const upstreamHeaders = safeExtraHeaders(configuredHeaders)
  upstreamPayload.model = target.model
  if (target.protocol === 'native') {
    if (target.thinkingMode === undefined) delete upstreamPayload.think
    else upstreamPayload.think = target.thinkingMode
  }

  const historyHandle = tryBeginRequestHistory({
    db,
    limit: database.requestHistoryLimit,
    source: query.chatId ? 'chat' : 'completion',
    profile: requestHistoryProfileSnapshot(target.profile),
    prompt: ollamaCloudPrompt(target.protocol, upstreamPayload),
    context:
      query.characterId || query.chatId
        ? {
            ...(query.characterId ? { characterId: query.characterId } : {}),
            ...(query.chatId ? { chatId: query.chatId } : {}),
          }
        : undefined,
    toggles: query.toggles,
    metadata: {
      mode: query.mode,
      protocol: target.protocol,
      streamingRequested: upstreamPayload.stream === true,
      toolProxy: true,
    },
  })

  const { signal, refresh, cleanup } = attachAbort(req, reply)
  try {
    const upstream = await fetch(target.url, {
      method: 'POST',
      redirect: 'error',
      headers: {
        ...upstreamHeaders,
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${target.apiKey}`,
        'content-type': 'application/json',
        ...(target.protocol === 'anthropic' ? { 'anthropic-version': '2023-06-01' } : {}),
      },
      body: JSON.stringify(upstreamPayload),
      signal,
    })

    for (const [key, value] of Object.entries(filterResponseHeaders(upstream.headers))) {
      reply.header(key, value)
    }
    reply.code(upstream.status)

    if (!upstream.body) {
      completeOllamaCloudHistory(historyHandle, upstream, {
        response: '',
        responseCharacters: 0,
        truncatedBytes: 0,
      })
      await reply.send()
      return
    }

    const stream = Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0])
    const decoder = new StringDecoder('utf8')
    const response = createRequestHistoryResponseCapture()
    stream.on('data', (chunk: Uint8Array) => {
      refresh()
      response.append(decoder.write(chunk))
    })
    reply.send(stream)
    await finished(stream, { cleanup: true })
    response.append(decoder.end())
    completeOllamaCloudHistory(historyHandle, upstream, response.snapshot())
  } catch (error) {
    completeRequestHistory(historyHandle, {
      status: signal.aborted ? 'cancelled' : 'error',
      error: error instanceof Error ? error.message : String(error),
    })
    if (signal.aborted) {
      if (!reply.raw.headersSent) reply.code(504).send({ error: 'Ollama Cloud tool request timed out or was aborted' })
      else reply.raw.end()
      return
    }
    const message = error instanceof Error && error.message ? error.message : 'upstream request failed'
    if (!reply.raw.headersSent) reply.code(502).send({ error: `Ollama Cloud tool request failed: ${message}` })
    else reply.raw.end()
  } finally {
    cleanup()
  }
}

function parseQuery(value: unknown): OllamaCloudToolQuery {
  if (!isRecord(value) || Object.keys(value).some((key) => !ALLOWED_QUERY_KEYS.has(key))) {
    throw new Error('invalid Ollama Cloud tool request identity')
  }
  if (value.operation !== OLLAMA_CLOUD_TOOL_OPERATION) {
    throw new Error('invalid Ollama Cloud tool operation')
  }
  if (typeof value.protocol !== 'string' || !TOOL_PROTOCOL_SET.has(value.protocol)) {
    throw new Error('invalid Ollama Cloud tool protocol')
  }
  const mode = value.mode === undefined ? 'model' : value.mode
  if (typeof mode !== 'string' || !COMPLETION_MODEL_MODE_SET.has(mode)) {
    throw new Error('invalid Ollama Cloud tool model mode')
  }
  const profileId = optionalIdentity(value.profileId)
  const staticModel = optionalIdentity(value.staticModel)
  const characterId = optionalIdentity(value.characterId)
  const chatId = optionalIdentity(value.chatId)
  const toggles = parseToggleStates(value.toggles)
  if (profileId && staticModel) {
    throw new Error('Ollama Cloud tool identity must select either profileId or staticModel')
  }
  return {
    operation: OLLAMA_CLOUD_TOOL_OPERATION,
    protocol: value.protocol as OllamaCloudToolProtocol,
    mode: mode as LegacyModelMode,
    ...(profileId ? { profileId } : {}),
    ...(staticModel ? { staticModel } : {}),
    ...(characterId ? { characterId } : {}),
    ...(chatId ? { chatId } : {}),
    ...(toggles ? { toggles } : {}),
  }
}

function parseToggleStates(value: unknown): Record<string, string> | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096) {
    throw new Error('invalid Ollama Cloud tool toggle states')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error('invalid Ollama Cloud tool toggle states')
  }
  if (!isRecord(parsed) || Object.values(parsed).some((item) => typeof item !== 'string')) {
    throw new Error('invalid Ollama Cloud tool toggle states')
  }
  return parsed as Record<string, string>
}

function parsePayload(value: unknown, protocol: OllamaCloudToolProtocol): JsonRecord {
  if (!isRecord(value)) throw new Error('Ollama Cloud tool payload must be a JSON object')
  if (value.stream !== undefined && typeof value.stream !== 'boolean') {
    throw new Error('Ollama Cloud tool payload stream must be a boolean')
  }
  if (value.stream === undefined && protocol !== 'openai-responses') {
    throw new Error('Ollama Cloud tool payload stream must be a boolean')
  }
  return value
}

function resolveTarget(database: Database, query: OllamaCloudToolQuery): ResolvedOllamaCloudToolTarget {
  const profile = selectedProfile(database, query)
  assertModelProfileGenerationReady(profile)
  const durableProviderOptions = query.profileId
    ? database.modelProfiles?.find((candidate) => candidate.id === query.profileId)?.providerOptions
    : undefined
  const ollama = profile.providerOptions.ollama
  const cloud = ollama?.cloud ?? profile.modelId === 'ollama-cloud'
  const ollamaProvider = profile.status.providerId === 'ollama' || profile.modelId === 'ollama-cloud'
  if (!ollamaProvider || !cloud) {
    throw new Error('selected model profile is not an Ollama Cloud profile')
  }

  const protocol = protocolForFormat(ollama?.requestFormat ?? database.ollamaRequestFormat)
  if (protocol !== query.protocol) {
    throw new Error('Ollama Cloud tool protocol no longer matches the selected profile')
  }

  const model =
    nonBlank(ollama?.model) ?? nonBlank(profile.providerOptions.requestModel) ?? nonBlank(database.ollamaCloudModel)
  if (!model) throw new Error('selected Ollama Cloud profile has no request model')
  const apiKey = nonBlank(ollama?.apiKey) ?? nonBlank(profile.providerOptions.apiKey) ?? nonBlank(database.ollamaApiKey)
  if (!apiKey || apiKey === MASKED_PROVIDER_SECRET) {
    throw new Error('selected Ollama Cloud credential is unavailable')
  }

  return {
    additionalParams: durableProviderOptions?.additionalParams ?? profile.providerOptions.additionalParams ?? [],
    apiKey,
    extraHeaders: durableProviderOptions?.extraHeaders ?? profile.providerOptions.extraHeaders ?? {},
    model,
    profile,
    protocol,
    url: urlForProtocol(protocol),
    ...(protocol === 'native'
      ? { thinkingMode: parseThinkingMode(ollama?.thinkingMode ?? database.ollamaThinkingMode) }
      : {}),
  }
}

function ollamaCloudPrompt(protocol: OllamaCloudToolProtocol, payload: JsonRecord): unknown {
  if (protocol === 'openai-responses') {
    return {
      ...(payload.instructions !== undefined ? { instructions: payload.instructions } : {}),
      ...(payload.input !== undefined ? { input: payload.input } : {}),
    }
  }
  return {
    ...(payload.system !== undefined ? { system: payload.system } : {}),
    ...(payload.messages !== undefined ? { messages: payload.messages } : {}),
  }
}

function completeOllamaCloudHistory(
  handle: RequestHistoryHandle | null,
  upstream: Response,
  captured: RequestHistoryCapturedResponse,
): void {
  completeRequestHistory(handle, {
    status: upstream.ok ? 'success' : 'error',
    response: captured.response,
    responseTruncatedBytes: captured.truncatedBytes,
    ...(upstream.ok ? {} : { error: `Ollama Cloud returned HTTP ${upstream.status}` }),
    metadata: {
      providerStatus: upstream.status,
      ...(upstream.statusText ? { providerStatusText: upstream.statusText } : {}),
      ...(upstream.headers.get('content-type') ? { responseContentType: upstream.headers.get('content-type') } : {}),
      responseCharacters: captured.responseCharacters,
    },
  })
}

function safeExtraHeaders(value: Record<string, string>): Record<string, string> {
  const forbidden = new Set([
    'accept',
    'authorization',
    'connection',
    'content-length',
    'content-type',
    'cookie',
    'host',
    'risu-auth',
    'transfer-encoding',
  ])
  return Object.fromEntries(
    Object.entries(value).filter(
      ([key, headerValue]) =>
        !forbidden.has(key.toLowerCase()) && typeof headerValue === 'string' && headerValue.length > 0,
    ),
  )
}

function selectedProfile(database: Database, query: OllamaCloudToolQuery): ResolvedModelProfile {
  if (query.profileId) {
    const profile = resolveModelProfileByProfileId({
      database,
      role: query.mode,
      profileId: query.profileId,
    })
    if (!profile) throw new Error(`Ollama Cloud profile not found: ${query.profileId}`)
    return profile
  }
  return resolveModelProfile({ database, role: query.mode, staticModel: query.staticModel })
}

function protocolForFormat(format: unknown): OllamaCloudToolProtocol {
  switch (format) {
    case LLMFormat.Ollama:
      return 'native'
    case LLMFormat.OpenAICompatible:
      return 'openai-chat'
    case LLMFormat.OpenAIResponseAPI:
      return 'openai-responses'
    case LLMFormat.Anthropic:
      return 'anthropic'
    default:
      throw new Error('selected Ollama Cloud request format does not support browser MCP tools')
  }
}

function urlForProtocol(protocol: OllamaCloudToolProtocol): string {
  switch (protocol) {
    case 'native':
      return 'https://ollama.com/api/chat'
    case 'openai-chat':
      return 'https://ollama.com/v1/chat/completions'
    case 'openai-responses':
      return 'https://ollama.com/v1/responses'
    case 'anthropic':
      return 'https://ollama.com/v1/messages'
  }
}

function parseThinkingMode(value: unknown): boolean | 'low' | 'medium' | 'high' | undefined {
  if (value === 'off') return false
  if (value === 'on') return true
  if (value === 'low' || value === 'medium' || value === 'high') return value
  return undefined
}

function optionalIdentity(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > MAX_IDENTITY_LENGTH) {
    throw new Error('invalid Ollama Cloud tool request identity')
  }
  return value
}

function nonBlank(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
