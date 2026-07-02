import type { Chat, Database, Message, character, loreBook } from '../../../../src/ts/storage/database.svelte'
import type { OpenAIChat } from '../../../../src/ts/process/index.svelte'
import {
  assertModelProfileGenerationReady,
  resolveModelProfile,
  type ResolvedModelProfile,
} from '../../../../src/ts/model/modelProfileResolver.js'
import { applyAdditionalParameters } from '../generation/additionalParams.js'
import { readBoundedBodyText } from '../generation/body.js'
import { resolveOllamaRequest, runOllamaRaw } from '../generation/ollama.js'
import { formatUpstreamFetchError, formatUpstreamHttpError } from '../generation/upstreamError.js'
import { emitProtocolMetric } from '../protocolMetrics.js'
import {
  resolveChatProviderRoute,
  resolveOpenAIVariant,
  resolveProviderModel,
  reformatMessages,
} from './chatDispatch.js'
import { expandVariables, type ExpandContext } from './variables.js'
import { getActiveModules } from './modules.js'

const AGENT_CONTEXT_RE = /\{\{\s*(?:agent|slot::agent)\s*\}\}/i
const DEFAULT_MAX_OUTPUT_CHARS = 1200
const DEFAULT_MAX_TOOL_ROUNDS = 4
const MAX_TOOL_RESULT_CHARS = 7000
const MAX_TOOL_RESULTS = 10

interface PromptContextAgentSettings {
  enabled: boolean
  prompt: string
  maxOutputChars: number
  maxToolRounds: number
}

export interface PromptContextAgentInput {
  database: Database
  currentChar: character
  currentChat: Chat
  selectedCharID: number
  chatPage: number
  ctx: ExpandContext
  signal?: AbortSignal
}

export interface PromptContextAgentResult {
  text: string
  skipped: boolean
  reason?: string
  provider?: string
  model?: string
  toolCalls: number
}

type ToolName = 'find_chat' | 'find_lorebook' | 'get_chat_tail'

interface ToolCall {
  id?: string
  type?: 'function'
  function: {
    name?: unknown
    arguments?: unknown
  }
}

interface OpenAIToolMessage {
  role: 'assistant'
  content?: string | null
  tool_calls?: ToolCall[]
}

interface OpenAIToolChoice {
  message?: OpenAIToolMessage
  finish_reason?: unknown
}

interface OpenAIToolResponse {
  choices?: OpenAIToolChoice[]
  error?: { message?: unknown; code?: unknown }
}

interface OpenAIToolRequest {
  model: string
  messages: unknown[]
  tools?: readonly unknown[]
  apiKey?: string
  baseUrl?: string
  maxTokens: number
  temperature: number
  extraHeaders?: Record<string, string>
  additionalParams?: Array<[string, string]>
  signal: AbortSignal
}

interface OllamaToolRequest {
  model: string
  messages: unknown[]
  tools?: readonly unknown[]
  apiKey?: string
  baseUrl?: string
  maxTokens: number
  temperature: number
  signal: AbortSignal
}

type JsonRecord = Record<string, unknown>

const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'find_chat',
      description:
        'Search saved chat messages. Use this for prior events, relationships, plans, promises, or facts from previous conversations.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Words or phrases to search for.' },
          characterId: {
            type: 'string',
            description: 'Optional character id. Omit to search all loaded characters.',
          },
          limit: { type: 'number', description: 'Maximum results, 1 to 10.' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'find_lorebook',
      description:
        'Search global, character, chat, and active module lorebook entries for relevant world, character, or setting facts.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Words or phrases to search for.' },
          scope: {
            type: 'string',
            enum: ['current', 'all'],
            description: 'Use current for active character/chat/module lorebooks, all to include global lorebooks.',
          },
          limit: { type: 'number', description: 'Maximum results, 1 to 10.' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_chat_tail',
      description: 'Read the latest messages from the current chat.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Maximum recent messages, 1 to 10.' },
        },
      },
    },
  },
] as const

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : null
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = asNumber(value)
  if (numeric === undefined) return fallback
  return Math.min(max, Math.max(min, Math.trunc(numeric)))
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value
  return value.slice(0, Math.max(0, maxChars - 1)).trimEnd() + '…'
}

function settingsFromDb(db: Database): PromptContextAgentSettings {
  return {
    enabled: db.agentContextEnabled === true,
    prompt: typeof db.agentContextPrompt === 'string' ? db.agentContextPrompt.trim() : '',
    maxOutputChars: clampInt(db.agentContextMaxOutput, DEFAULT_MAX_OUTPUT_CHARS, 0, 12000),
    maxToolRounds: clampInt(db.agentContextMaxToolRounds, DEFAULT_MAX_TOOL_ROUNDS, 0, 12),
  }
}

function textFields(value: unknown, out: string[]): void {
  if (typeof value === 'string') {
    out.push(value)
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) textFields(item, out)
    return
  }
  const record = asRecord(value)
  if (!record) return
  for (const nested of Object.values(record)) textFields(nested, out)
}

export function promptUsesAgentContextSlot(input: PromptContextAgentInput): boolean {
  const texts: string[] = []
  const db = input.database
  const char = input.currentChar
  const chat = input.currentChat

  textFields(db.mainPrompt, texts)
  textFields(db.jailbreak, texts)
  textFields(db.globalNote, texts)
  textFields(db.additionalPrompt, texts)
  textFields(db.descriptionPrefix, texts)
  textFields(db.personaPrompt, texts)
  textFields(db.promptTemplate, texts)
  textFields(db.promptSettings, texts)
  textFields(char.systemPrompt, texts)
  textFields(char.desc, texts)
  textFields(char.personality, texts)
  textFields(char.scenario, texts)
  textFields(char.postHistoryInstructions, texts)
  textFields(chat.note, texts)

  return texts.some((text) => AGENT_CONTEXT_RE.test(text))
}

export function shouldRunPromptContextAgent(input: PromptContextAgentInput): boolean {
  const settings = settingsFromDb(input.database)
  return settings.enabled && settings.prompt.length > 0 && promptUsesAgentContextSlot(input)
}

function messageContent(message: Message): string {
  const raw = (message as { data?: unknown }).data
  if (typeof raw === 'string') return raw
  if (raw === undefined || raw === null) return ''
  return JSON.stringify(raw)
}

function messageRole(message: Message): string {
  const role = (message as { role?: unknown }).role
  return typeof role === 'string' ? role : 'unknown'
}

function messageId(message: Message, fallback: number): string {
  const id = (message as { chatId?: unknown; id?: unknown }).chatId ?? (message as { id?: unknown }).id
  return typeof id === 'string' && id.length > 0 ? id : `message-${fallback}`
}

function latestUserMessage(chat: Chat): string {
  const messages = Array.isArray(chat.message) ? chat.message : []
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (messageRole(message) === 'user') return messageContent(message)
  }
  return ''
}

function normalizeSearchTerms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^\p{L}\p{N}_'-]+/u)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2)
    .slice(0, 12)
}

function searchScore(haystack: string, query: string): number {
  const lower = haystack.toLowerCase()
  const trimmed = query.trim().toLowerCase()
  if (!trimmed) return 0
  let score = lower.includes(trimmed) ? 8 : 0
  for (const term of normalizeSearchTerms(query)) {
    if (lower.includes(term)) score += 2
  }
  return score
}

function safeJson(value: unknown, maxChars = MAX_TOOL_RESULT_CHARS): string {
  return truncate(JSON.stringify(value, null, 2), maxChars)
}

function readToolArgs(raw: unknown): JsonRecord {
  const record = asRecord(raw)
  if (record) return record
  if (typeof raw !== 'string') return {}
  try {
    return asRecord(JSON.parse(raw)) ?? {}
  } catch {
    return {}
  }
}

function clampLimit(raw: unknown, fallback = 5): number {
  return clampInt(raw, fallback, 1, MAX_TOOL_RESULTS)
}

function executeFindChat(input: PromptContextAgentInput, args: JsonRecord): string {
  const query = typeof args.query === 'string' ? args.query : ''
  const limit = clampLimit(args.limit)
  const characterId = typeof args.characterId === 'string' && args.characterId.length > 0 ? args.characterId : undefined
  const results: Array<{
    characterId: string
    characterName: string
    chatId: string
    chatName: string
    messageId: string
    role: string
    score: number
    text: string
  }> = []

  for (const char of input.database.characters ?? []) {
    if (characterId && char.chaId !== characterId) continue
    for (const chat of char.chats ?? []) {
      for (let i = 0; i < (chat.message ?? []).length; i++) {
        const message = chat.message[i]
        const text = messageContent(message)
        const score = searchScore(`${chat.name ?? ''}\n${text}`, query)
        if (score <= 0) continue
        results.push({
          characterId: char.chaId,
          characterName: char.name,
          chatId: chat.id ?? '',
          chatName: chat.name ?? '',
          messageId: messageId(message, i),
          role: messageRole(message),
          score,
          text: truncate(text, 700),
        })
      }
    }
  }

  results.sort((a, b) => b.score - a.score)
  return safeJson({ results: results.slice(0, limit) })
}

function loreEntryText(entry: loreBook): string {
  return [entry.comment, entry.key, entry.secondkey, entry.content].filter(Boolean).join('\n')
}

function collectLoreEntries(input: PromptContextAgentInput, scope: string): Array<{ source: string; entry: loreBook }> {
  const entries: Array<{ source: string; entry: loreBook }> = []

  for (const entry of input.currentChar.globalLore ?? []) {
    entries.push({ source: `character:${input.currentChar.chaId}`, entry })
  }
  for (const entry of input.currentChat.localLore ?? []) {
    entries.push({ source: `chat:${input.currentChat.id ?? input.chatPage}`, entry })
  }
  for (const module of getActiveModules(input.database, input.currentChar, input.currentChat)) {
    for (const entry of module.lorebook ?? []) {
      entries.push({ source: `module:${module.id ?? module.name ?? 'unknown'}`, entry })
    }
  }

  if (scope !== 'current') {
    for (const book of input.database.loreBook ?? []) {
      for (const entry of book.data ?? []) {
        entries.push({ source: `global:${book.name ?? 'Lorebook'}`, entry })
      }
    }
  }

  return entries
}

function executeFindLorebook(input: PromptContextAgentInput, args: JsonRecord): string {
  const query = typeof args.query === 'string' ? args.query : ''
  const scope = args.scope === 'current' ? 'current' : 'all'
  const limit = clampLimit(args.limit)
  const results = collectLoreEntries(input, scope)
    .map(({ source, entry }) => {
      const score = searchScore(loreEntryText(entry), query)
      return { source, entry, score }
    })
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ source, entry, score }) => ({
      source,
      id: entry.id ?? '',
      comment: entry.comment ?? '',
      keys: entry.key ?? '',
      secondaryKeys: entry.secondkey ?? '',
      alwaysActive: entry.alwaysActive === true,
      mode: entry.mode,
      score,
      content: truncate(entry.content ?? '', 900),
    }))

  return safeJson({ results })
}

function executeGetChatTail(input: PromptContextAgentInput, args: JsonRecord): string {
  const limit = clampLimit(args.limit, 6)
  const messages = (input.currentChat.message ?? []).slice(-limit).map((message, index) => ({
    id: messageId(message, index),
    role: messageRole(message),
    text: truncate(messageContent(message), 900),
  }))
  return safeJson({
    characterId: input.currentChar.chaId,
    characterName: input.currentChar.name,
    chatId: input.currentChat.id ?? '',
    chatName: input.currentChat.name ?? '',
    messages,
  })
}

function executeTool(input: PromptContextAgentInput, toolName: string, args: JsonRecord): string {
  switch (toolName as ToolName) {
    case 'find_chat':
      return executeFindChat(input, args)
    case 'find_lorebook':
      return executeFindLorebook(input, args)
    case 'get_chat_tail':
      return executeGetChatTail(input, args)
    default:
      return safeJson({ error: `Unknown tool: ${toolName}` })
  }
}

function baseUrl(req: OpenAIToolRequest): string {
  const base = (req.baseUrl ?? 'https://api.openai.com/v1').replace(/\/+$/, '')
  return `${base}/chat/completions`
}

function buildHeaders(req: OpenAIToolRequest): Record<string, string> {
  return {
    'content-type': 'application/json',
    ...(req.apiKey ? { authorization: `Bearer ${req.apiKey}` } : {}),
    ...(req.extraHeaders ?? {}),
  }
}

async function runOpenAIToolRequest(req: OpenAIToolRequest): Promise<OpenAIToolMessage | { error: string }> {
  if (req.signal.aborted) return { error: 'aborted' }

  const payload: Record<string, unknown> = {
    model: req.model,
    messages: req.messages,
    stream: false,
    temperature: req.temperature,
    max_tokens: req.maxTokens,
  }
  if (req.tools) {
    payload.tools = req.tools
    payload.tool_choice = 'auto'
  }

  const headers = buildHeaders(req)
  if (req.additionalParams !== undefined && req.additionalParams.length > 0) {
    applyAdditionalParameters(payload, headers, req.additionalParams)
  }

  const url = baseUrl(req)
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: req.signal,
    })
  } catch (err) {
    if (req.signal.aborted) return { error: 'aborted' }
    const msg = err instanceof Error ? err.message : String(err)
    return { error: formatUpstreamFetchError(url, msg) }
  }

  let raw: string
  try {
    raw = await readBoundedBodyText(response)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { error: `invalid upstream body: ${msg}` }
  }

  if (!response.ok) {
    let message: string | undefined
    let code: string | undefined
    try {
      const body = JSON.parse(raw) as OpenAIToolResponse
      if (typeof body.error?.message === 'string') message = body.error.message
      if (typeof body.error?.code === 'string') code = body.error.code
    } catch {
      if (raw.trim().length > 0) message = raw
    }
    return { error: formatUpstreamHttpError(response, url, { message, code }) }
  }

  let body: OpenAIToolResponse
  try {
    body = JSON.parse(raw) as OpenAIToolResponse
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { error: `invalid upstream JSON: ${msg}` }
  }

  const message = Array.isArray(body.choices) ? body.choices[0]?.message : undefined
  if (!message) return { error: 'upstream returned no message' }
  return message
}

function normalizeOllamaToolCalls(value: unknown): ToolCall[] {
  if (!Array.isArray(value)) return []
  const calls: ToolCall[] = []
  value.forEach((item, index) => {
    const record = asRecord(item)
    const fn = asRecord(record?.function)
    const name = typeof fn?.name === 'string' ? fn.name : ''
    if (!name) return
    calls.push({
      id: asString(record?.id) ?? `ollama-tool-call-${index}`,
      ...(record?.type === 'function' ? { type: 'function' as const } : {}),
      function: {
        name,
        arguments: fn?.arguments,
      },
    })
  })
  return calls
}

function normalizeOllamaToolMessage(value: unknown): OpenAIToolMessage | { error: string } {
  const message = asRecord(value)
  if (!message) return { error: 'upstream returned no message' }
  const toolCalls = normalizeOllamaToolCalls(message.tool_calls)
  return {
    role: 'assistant',
    content: typeof message.content === 'string' ? message.content : '',
    ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
  }
}

function resolveOllamaBaseUrl(profile: ResolvedModelProfile): string | undefined {
  return asString(profile.providerOptions.ollama?.url) ?? asString(profile.providerOptions.baseUrl)
}

function resolveOllamaApiKey(profile: ResolvedModelProfile): string | undefined {
  return asString(profile.providerOptions.apiKey) ?? asString(profile.providerOptions.ollama?.apiKey)
}

async function runOllamaToolRequest(req: OllamaToolRequest): Promise<OpenAIToolMessage | { error: string }> {
  const resolved = resolveOllamaRequest({
    model: req.model,
    messages: req.messages,
    tools: req.tools,
    baseUrl: req.baseUrl,
    apiKey: req.apiKey,
    maxTokens: req.maxTokens,
    temperature: req.temperature,
    signal: req.signal,
  })
  if (!resolved) return { error: 'options.ollama.baseUrl is required' }

  const result = await runOllamaRaw(resolved)
  if (result.type === 'fail') return { error: result.result }
  return normalizeOllamaToolMessage(result.body.message)
}

function buildAgentTask(input: PromptContextAgentInput, settings: PromptContextAgentSettings): string {
  const expandedPrompt = expandVariables(settings.prompt, input.ctx).text
  const recentMessages = (input.currentChat.message ?? []).slice(-6).map((message) => ({
    role: messageRole(message),
    text: truncate(messageContent(message), 700),
  }))

  return [
    'User-defined context-agent instructions:',
    expandedPrompt,
    '',
    'Current context:',
    safeJson(
      {
        userName: input.database.username ?? 'User',
        characterId: input.currentChar.chaId,
        characterName: input.currentChar.name,
        characterDescription: truncate(input.currentChar.desc ?? '', 1200),
        characterPersonality: truncate(input.currentChar.personality ?? '', 800),
        characterScenario: truncate(input.currentChar.scenario ?? '', 800),
        chatId: input.currentChat.id ?? '',
        chatName: input.currentChat.name ?? '',
        latestUserMessage: truncate(latestUserMessage(input.currentChat), 1000),
        recentMessages,
      },
      6000,
    ),
    '',
    'Return only the final concise context to inject into {{agent}}. Do not mention tool mechanics.',
  ].join('\n')
}

function maxTokensForOutput(maxOutputChars: number): number {
  if (maxOutputChars <= 0) return 64
  return Math.max(64, Math.min(4096, Math.ceil(maxOutputChars / 3)))
}

function normalizeFinalAgentText(text: string, maxOutputChars: number): string {
  const trimmed = text.trim()
  if (maxOutputChars <= 0) return ''
  return truncate(trimmed, maxOutputChars)
}

function skipped(reason: string, toolCalls = 0): PromptContextAgentResult {
  return { text: '', skipped: true, reason, toolCalls }
}

function emitAgentMetric(result: PromptContextAgentResult): void {
  emitProtocolMetric('generation_context_agent', () => ({
    skipped: result.skipped,
    reason: result.reason,
    provider: result.provider,
    model: result.model,
    toolCalls: result.toolCalls,
    outputLength: result.text.length,
  }))
}

export async function runPromptContextAgent(input: PromptContextAgentInput): Promise<PromptContextAgentResult> {
  const settings = settingsFromDb(input.database)
  if (!settings.enabled) return skipped('disabled')
  if (!settings.prompt) return skipped('missing_prompt')
  if (!promptUsesAgentContextSlot(input)) return skipped('slot_absent')

  const signal = input.signal ?? new AbortController().signal
  if (signal.aborted) return skipped('aborted')

  try {
    const profile = resolveModelProfile({ database: input.database })
    assertModelProfileGenerationReady(profile)
    const info = profile.modelInfo
    const route = resolveChatProviderRoute(input.database, profile)
    if (route.routable === false) return skipped(route.reason)
    const provider = route.provider
    if (provider !== 'openai' && provider !== 'openrouter' && provider !== 'nanogpt' && provider !== 'ollama') {
      return skipped(`unsupported_agent_provider:${provider}`)
    }

    const variant = provider === 'ollama' ? undefined : resolveOpenAIVariant(input.database, info, provider, profile)
    if (provider !== 'ollama' && !variant) return skipped(`missing_agent_provider_options:${provider}`)
    const ollamaBaseUrl = provider === 'ollama' ? resolveOllamaBaseUrl(profile) : undefined
    const ollamaApiKey = provider === 'ollama' ? resolveOllamaApiKey(profile) : undefined

    const model = resolveProviderModel(input.database, info, provider, profile)
    const system =
      'You are a read-only pre-prompt context agent. Gather only information relevant to the next chat reply. Use tools when useful. Never modify data. Prefer source-backed facts over guesses.'
    let messages: unknown[] = reformatMessages(
      input.database,
      [
        { role: 'system', content: system },
        { role: 'user', content: buildAgentTask(input, settings) },
      ] as OpenAIChat[],
      info.flags,
    )
    let toolCalls = 0
    let lastMessage: OpenAIToolMessage | undefined

    for (let round = 0; round <= settings.maxToolRounds; round++) {
      const allowTools = round < settings.maxToolRounds
      const message =
        provider === 'ollama'
          ? await runOllamaToolRequest({
              model,
              messages,
              tools: allowTools ? TOOL_DEFINITIONS : undefined,
              apiKey: ollamaApiKey,
              baseUrl: ollamaBaseUrl,
              maxTokens: maxTokensForOutput(settings.maxOutputChars),
              temperature: 0.2,
              signal,
            })
          : await runOpenAIToolRequest({
              model,
              messages,
              tools: allowTools ? TOOL_DEFINITIONS : undefined,
              apiKey: variant?.apiKey,
              baseUrl: variant?.baseUrl,
              maxTokens: maxTokensForOutput(settings.maxOutputChars),
              temperature: 0.2,
              extraHeaders: variant?.extraHeaders,
              additionalParams: variant?.additionalParams,
              signal,
            })

      if ('error' in message) {
        const result = skipped(message.error, toolCalls)
        result.provider = provider
        result.model = model
        emitAgentMetric(result)
        return result
      }

      lastMessage = message
      const calls = Array.isArray(message.tool_calls) ? message.tool_calls : []
      if (calls.length === 0) {
        const result: PromptContextAgentResult = {
          text: normalizeFinalAgentText(
            typeof message.content === 'string' ? message.content : '',
            settings.maxOutputChars,
          ),
          skipped: false,
          provider,
          model,
          toolCalls,
        }
        emitAgentMetric(result)
        return result
      }

      messages = [...messages, message]
      for (const call of calls) {
        const toolName = typeof call.function.name === 'string' ? call.function.name : ''
        const toolResult = executeTool(input, toolName, readToolArgs(call.function.arguments))
        toolCalls++
        const toolMessage: Record<string, unknown> = {
          role: 'tool',
          name: toolName,
          tool_name: toolName,
          content: toolResult,
        }
        if (call.id) toolMessage.tool_call_id = call.id
        messages.push(toolMessage)
      }
    }

    const result: PromptContextAgentResult = {
      text: normalizeFinalAgentText(
        typeof lastMessage?.content === 'string' ? lastMessage.content : '',
        settings.maxOutputChars,
      ),
      skipped: false,
      provider,
      model,
      toolCalls,
    }
    emitAgentMetric(result)
    return result
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    const result = skipped(reason)
    emitAgentMetric(result)
    return result
  }
}
