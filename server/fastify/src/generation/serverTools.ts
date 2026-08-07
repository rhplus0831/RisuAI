import {
  validateServerToolCalls,
  type ServerToolCall,
  type ServerToolDefinition,
  type ServerToolRound,
  type ServerToolValidation,
} from '../../../../src/ts/process/request/serverToolProtocol.js'

type JsonRecord = Record<string, unknown>

function plainRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function parseArguments(value: unknown): JsonRecord | null {
  if (plainRecord(value)) return value
  if (typeof value !== 'string') return null
  try {
    const parsed = JSON.parse(value) as unknown
    return plainRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function invalid<T>(error: string): ServerToolValidation<T> {
  return { ok: false, error }
}

export function openAIToolDefinitions(tools: readonly ServerToolDefinition[]): JsonRecord[] {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }))
}

export function openAIResponsesToolDefinitions(tools: readonly ServerToolDefinition[]): JsonRecord[] {
  return tools.map((tool) => ({
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
  }))
}

export function appendOpenAIToolRounds(messages: readonly unknown[], rounds: readonly ServerToolRound[]): unknown[] {
  const out = [...messages]
  for (const round of rounds) {
    out.push({
      role: 'assistant',
      content: round.assistantContent || null,
      tool_calls: round.calls.map((call) => ({
        id: call.id,
        type: 'function',
        function: { name: call.name, arguments: JSON.stringify(call.arguments) },
      })),
    })
    for (const result of round.results) {
      out.push({ role: 'tool', tool_call_id: result.callId, content: result.content })
    }
  }
  return out
}

/**
 * Rebuild Responses continuation items from the bounded tool-round contract.
 * Only complete call/result pairs are emitted, and provider output item ids are
 * deliberately not representable on this path.
 */
export function appendOpenAIResponsesToolRounds(
  input: readonly unknown[],
  rounds: readonly ServerToolRound[],
): unknown[] {
  const out = [...input]
  for (const round of rounds) {
    const resultsByCallId = new Map<string, { name: string; content: string }>()
    for (const rawResult of Array.isArray(round.results) ? round.results : []) {
      if (
        !plainRecord(rawResult) ||
        typeof rawResult.callId !== 'string' ||
        typeof rawResult.name !== 'string' ||
        typeof rawResult.content !== 'string' ||
        resultsByCallId.has(rawResult.callId)
      ) {
        continue
      }
      resultsByCallId.set(rawResult.callId, { name: rawResult.name, content: rawResult.content })
    }

    const pairs: Array<{
      callId: string
      name: string
      arguments: string
      output: string
    }> = []
    for (const rawCall of Array.isArray(round.calls) ? round.calls : []) {
      if (
        !plainRecord(rawCall) ||
        typeof rawCall.id !== 'string' ||
        rawCall.id.length === 0 ||
        typeof rawCall.name !== 'string' ||
        rawCall.name.length === 0 ||
        !plainRecord(rawCall.arguments)
      ) {
        continue
      }
      const result = resultsByCallId.get(rawCall.id)
      if (!result || result.name !== rawCall.name) continue
      try {
        pairs.push({
          callId: rawCall.id,
          name: rawCall.name,
          arguments: JSON.stringify(rawCall.arguments),
          output: result.content,
        })
      } catch {
        // The route validator already requires JSON-safe arguments. Keep this
        // helper defensive for internal/direct callers as well.
      }
    }
    if (pairs.length === 0) continue

    if (typeof round.assistantContent === 'string' && round.assistantContent.length > 0) {
      out.push({
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text: round.assistantContent, annotations: [] }],
      })
    }
    out.push(
      ...pairs.map((pair) => ({
        type: 'function_call',
        call_id: pair.callId,
        name: pair.name,
        arguments: pair.arguments,
        status: 'completed',
      })),
      ...pairs.map((pair) => ({
        type: 'function_call_output',
        call_id: pair.callId,
        output: pair.output,
      })),
    )
  }
  return out
}

export function anthropicToolDefinitions(tools: readonly ServerToolDefinition[]): JsonRecord[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  }))
}

export function appendAnthropicToolRounds(messages: readonly unknown[], rounds: readonly ServerToolRound[]): unknown[] {
  const out = [...messages]
  for (const round of rounds) {
    out.push({
      role: 'assistant',
      content: [
        ...(round.assistantContent ? [{ type: 'text', text: round.assistantContent }] : []),
        ...round.calls.map((call) => ({ type: 'tool_use', id: call.id, name: call.name, input: call.arguments })),
      ],
    })
    out.push({
      role: 'user',
      content: round.results.map((result) => ({
        type: 'tool_result',
        tool_use_id: result.callId,
        content: result.content,
      })),
    })
  }
  return out
}

export function geminiToolDefinitions(tools: readonly ServerToolDefinition[]): JsonRecord[] {
  return [
    {
      functionDeclarations: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      })),
    },
  ]
}

function geminiResponseContent(content: string): JsonRecord {
  try {
    return { data: JSON.parse(content) as unknown }
  } catch {
    return { data: content }
  }
}

export function appendGeminiToolRounds(contents: readonly unknown[], rounds: readonly ServerToolRound[]): unknown[] {
  const out = [...contents]
  for (const round of rounds) {
    out.push({
      role: 'model',
      parts: [
        ...(round.assistantContent ? [{ text: round.assistantContent }] : []),
        ...round.calls.map((call) => ({
          functionCall: { id: call.id, name: call.name, args: call.arguments },
          ...(call.thoughtSignature ? { thoughtSignature: call.thoughtSignature } : {}),
        })),
      ],
    })
    out.push({
      role: 'user',
      parts: round.results.map((result) => ({
        functionResponse: {
          id: result.callId,
          name: result.name,
          response: geminiResponseContent(result.content),
        },
      })),
    })
  }
  return out
}

export function parseOpenAIToolCalls(
  value: unknown,
  allowedToolNames: ReadonlySet<string>,
): ServerToolValidation<ServerToolCall[]> {
  if (!Array.isArray(value) || value.length === 0) return invalid('provider returned no tool calls')
  const calls: ServerToolCall[] = []
  for (const raw of value) {
    if (!plainRecord(raw) || !plainRecord(raw.function)) return invalid('provider returned a malformed tool call')
    const args = parseArguments(raw.function.arguments)
    if (typeof raw.id !== 'string' || typeof raw.function.name !== 'string' || !args) {
      return invalid('provider returned a malformed tool call')
    }
    calls.push({ id: raw.id, name: raw.function.name, arguments: args })
  }
  return validateServerToolCalls(calls, allowedToolNames)
}

export function parseOpenAIResponsesToolCalls(
  value: unknown,
  allowedToolNames: ReadonlySet<string>,
): ServerToolValidation<ServerToolCall[]> {
  if (!Array.isArray(value)) return invalid('provider returned malformed Responses output')
  const rawCalls = value.filter((raw) => plainRecord(raw) && raw.type === 'function_call')
  if (rawCalls.length === 0) return invalid('provider returned no tool calls')

  const calls: ServerToolCall[] = []
  for (const raw of rawCalls) {
    const args = parseArguments(raw.arguments)
    if (typeof raw.call_id !== 'string' || typeof raw.name !== 'string' || !args) {
      return invalid('provider returned a malformed Responses tool call')
    }
    calls.push({ id: raw.call_id, name: raw.name, arguments: args })
  }
  return validateServerToolCalls(calls, allowedToolNames)
}

export function parseAnthropicToolCalls(
  value: unknown,
  allowedToolNames: ReadonlySet<string>,
): ServerToolValidation<ServerToolCall[]> {
  if (!Array.isArray(value)) return invalid('provider returned malformed Anthropic content')
  const calls: ServerToolCall[] = []
  for (const raw of value) {
    if (!plainRecord(raw) || raw.type !== 'tool_use') continue
    if (typeof raw.id !== 'string' || typeof raw.name !== 'string' || !plainRecord(raw.input)) {
      return invalid('provider returned a malformed tool call')
    }
    calls.push({ id: raw.id, name: raw.name, arguments: raw.input })
  }
  if (calls.length === 0) return invalid('provider returned no tool calls')
  return validateServerToolCalls(calls, allowedToolNames)
}

export function parseGeminiToolCalls(
  value: unknown,
  allowedToolNames: ReadonlySet<string>,
): ServerToolValidation<ServerToolCall[]> {
  if (!Array.isArray(value)) return invalid('provider returned malformed Gemini parts')
  const calls: ServerToolCall[] = []
  let callIndex = 0
  for (const raw of value) {
    if (!plainRecord(raw) || !plainRecord(raw.functionCall)) continue
    const call = raw.functionCall
    if (typeof call.name !== 'string' || !plainRecord(call.args)) {
      return invalid('provider returned a malformed tool call')
    }
    const id = typeof call.id === 'string' && call.id.length > 0 ? call.id : `gemini-tool-call-${callIndex}`
    calls.push({
      id,
      name: call.name,
      arguments: call.args,
      ...(typeof raw.thoughtSignature === 'string' ? { thoughtSignature: raw.thoughtSignature } : {}),
    })
    callIndex += 1
  }
  if (calls.length === 0) return invalid('provider returned no tool calls')
  return validateServerToolCalls(calls, allowedToolNames)
}
